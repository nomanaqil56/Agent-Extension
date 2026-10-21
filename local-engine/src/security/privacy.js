// Antigravity Local Agent Engine - Centralized Outbound Privacy Enforcer
// Evaluates every outbound payload immediately before external cloud provider transmission.
// Enforces strict isolation under Privacy-First policy and guards sensitive credentials across all policies.

class PrivacyEnforcer {
  constructor(config = {}) {
    this.config = config;

    // High-risk credential and secret patterns
    this.credentialPatterns = [
      /(?:api[_-]?key|apikey|secret|token|password|passwd|auth)\s*[:=]\s*["']?([A-Za-z0-9_\-\.]{8,})["']?/i,
      /Bearer\s+([A-Za-z0-9\-_]{8,})/i,
      /AIza[0-9A-Za-z\-_]{35}/, // Google / Gemini API key
      /sk-ant-[a-zA-Z0-9_\-]{32,}/, // Anthropic API key
      /sk-[a-zA-Z0-9_\-]{20,}/, // OpenAI API key
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
      /DATABASE_URL\s*=\s*["']?[^"'\s]+["']?/i,
      /\.env(?:\.local|\.production|\.development)?/i
    ];

    // Local execution tool names whose results and parameters originate from local machine
    this.localTools = new Set([
      'read_file', 'write_file', 'patch_file', 'delete_file',
      'list_files', 'search_files', 'file_info',
      'execute_command',
      'clipboard_read', 'clipboard_write',
      'launch_application', 'get_system_info'
    ]);

    // Sensitive DOM patterns
    this.sensitiveDomPatterns = [
      /<input[^>]+type=["']password["'][^>]*>/i,
      /name=["'](?:password|passwd|pin|cvv|creditcard|auth_token|ssn)["']/i,
      /autocomplete=["'](?:current-password|new-password|cc-number)["']/i,
      /data-sensitive=["']true["']/i
    ];

    // Local filesystem path indicators (POSIX and Windows)
    this.localPathPatterns = [
      /[A-Za-z]:\\[^"'\n\r\t]+/,
      /(?:\/|\\\\)[a-zA-Z0-9_\-\.]+(?:\/[a-zA-Z0-9_\-\.]+){2,}/,
      /[\\\/]\.agents[\\\/]/,
      /[\\\/]\.gemini[\\\/]/
    ];
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  // Determine whether a provider instance is an external remote/cloud provider
  isCloudProvider(provider) {
    if (!provider) return false;
    if (typeof provider.isLocal === 'boolean') return !provider.isLocal;
    if (typeof provider.isRemote === 'boolean') return provider.isRemote;
    if (provider.category) return provider.category === 'cloud' || provider.category === 'remote';

    const name = (provider.name || provider.constructor?.name || '').toLowerCase();
    if (name.includes('ollama') || name.includes('fallback') || name.includes('autonomous')) {
      return false;
    }
    if (name.includes('gemini') || name.includes('anthropic') || name.includes('claude') ||
        name.includes('openai') || name.includes('mockcloud')) {
      return true;
    }
    return false;
  }

  // Deep inspection of outbound payload content and provenance
  analyzePayload({ messages = [], tools = [], context = {} }) {
    const findings = {
      hasCredentials: false,
      hasLocalToolObservations: false,
      hasLocalPaths: false,
      hasSensitiveDom: false,
      hasClipboardContent: false,
      hasTerminalOutput: false,
      hasProtectedFiles: false,
      hasScreenshotVisual: false,
      hasSensitiveContext: false,
      detectedItems: []
    };

    // 1. Inspect Browser Context
    if (context) {
      const isVisual = Boolean(
        context.screenshot ||
        context.visualContext ||
        context.screenCapture ||
        context.image ||
        context.imageData ||
        context.hasScreenshot
      );

      if (isVisual) {
        findings.hasScreenshotVisual = true;
        if (context.isSensitive || context.containsCredentials || context.dom?.toLowerCase().includes('password')) {
          findings.detectedItems.push('Screenshot of sensitive browser context');
        } else {
          findings.detectedItems.push('Screenshot / visual context data');
        }
      }

      if (context.isSensitive) {
        findings.hasSensitiveContext = true;
        findings.detectedItems.push('Context explicitly flagged as sensitive');
      }

      if (context.containsCredentials) {
        findings.hasCredentials = true;
        findings.detectedItems.push('Context explicitly flagged as containing credentials');
      }

      if (context.dom && typeof context.dom === 'string') {
        for (const pattern of this.sensitiveDomPatterns) {
          if (pattern.test(context.dom)) {
            findings.hasSensitiveDom = true;
            findings.detectedItems.push(`Sensitive DOM pattern (${pattern.source.slice(0, 30)})`);
            break;
          }
        }
      }

      // Check URL and page content in context
      if (context.page) {
        const pageStr = JSON.stringify(context.page);
        for (const pat of this.credentialPatterns) {
          if (pat.test(pageStr)) {
            findings.hasCredentials = true;
            findings.detectedItems.push('Credential detected in browser page context');
            break;
          }
        }
      }
    }

    // 2. Inspect Conversation Messages (System, User, Assistant, Tool Observations)
    for (const msg of messages) {
      // Check for multimodal visual parts or image attachments
      if (Array.isArray(msg.parts)) {
        for (const part of msg.parts) {
          if (part && (part.inlineData || part.image_url || part.type === 'image_url' || part.type === 'image')) {
            findings.hasScreenshotVisual = true;
            findings.detectedItems.push('Multimodal visual / image part in message');
          }
        }
      }
      if (msg.image || msg.images || msg.screenshot || msg.visualContext) {
        findings.hasScreenshotVisual = true;
        findings.detectedItems.push('Visual context / screenshot data in message object');
      }

      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');

      // Check for credentials
      for (const pattern of this.credentialPatterns) {
        if (pattern.test(content)) {
          findings.hasCredentials = true;
          findings.detectedItems.push(`Credential or token matching pattern ${pattern.source.slice(0, 30)}`);
          break;
        }
      }

      // Check provenance: Did this message originate from a local tool observation?
      for (const toolName of this.localTools) {
        if (content.includes(`Observation from ${toolName}`) ||
            content.includes(`Error executing ${toolName}`) ||
            content.includes(`Called tool ${toolName}`)) {
          findings.hasLocalToolObservations = true;
          findings.detectedItems.push(`Observation from local execution tool "${toolName}"`);

          if (toolName.includes('file')) {
            findings.hasProtectedFiles = true;
          }
          if (toolName.includes('clipboard')) {
            findings.hasClipboardContent = true;
          }
          if (toolName === 'execute_command') {
            findings.hasTerminalOutput = true;
          }
        }
      }

      // Check for local file paths / system paths in observations or error messages
      for (const pathPat of this.localPathPatterns) {
        if (pathPat.test(content)) {
          findings.hasLocalPaths = true;
          findings.detectedItems.push('Local filesystem path in message payload');
          break;
        }
      }
    }

    // Summarize if any protected data is present
    findings.isProtected = findings.hasCredentials ||
                           findings.hasLocalToolObservations ||
                           findings.hasLocalPaths ||
                           findings.hasSensitiveDom ||
                           findings.hasClipboardContent ||
                           findings.hasTerminalOutput ||
                           findings.hasProtectedFiles ||
                           findings.hasScreenshotVisual ||
                           findings.hasSensitiveContext;

    return findings;
  }

  // Centralized Outbound Enforcement Check
  // Called immediately before every external provider request
  inspectOutboundPayload({
    messages = [],
    tools = [],
    context = {},
    activePolicy = 'balanced',
    provider = null,
    isManual = false,
    allowFallback = false,
    bypassGuard = false,
    conversationId = null
  }) {
    const isCloud = this.isCloudProvider(provider);

    // Negative control bypass for verification testing
    if (bypassGuard || this.config.bypassPrivacyGuardForTest) {
      return {
        allowed: true,
        bypassed: true,
        reason: 'Privacy guard explicitly bypassed for negative-control verification testing.'
      };
    }

    // Local providers (Ollama, Autonomous Engine) are safe for local data
    if (!isCloud) {
      return {
        allowed: true,
        isCloud: false,
        reason: 'Local provider: payload remains within local execution boundary.'
      };
    }

    // Provider is CLOUD. Perform deep content & provenance inspection
    const analysis = this.analyzePayload({ messages, tools, context });

    // Under Privacy-First policy: Zero tolerance for outbound transmission of local data
    if (activePolicy === 'privacy-first') {
      if (analysis.isProtected) {
        const reasons = analysis.detectedItems.join('; ');

        // If user explicitly configured Manual Cloud mode with fallback forbidden, STOP and BLOCK
        if (isManual && !allowFallback) {
          return {
            allowed: false,
            action: 'block',
            policy: 'privacy-first',
            reasons: analysis.detectedItems,
            error: `Privacy-First Policy Violation: Payload contains protected local data (${reasons}). Cloud transmission blocked in Manual mode without fallback authorization.`
          };
        }

        // Otherwise divert to local Autonomous Engine or Ollama
        return {
          allowed: false,
          action: 'divert',
          targetProvider: 'autonomous',
          policy: 'privacy-first',
          reasons: analysis.detectedItems,
          reason: `Privacy-First Policy: Protected local data detected (${reasons}). Outbound cloud transmission diverted to Built-in Autonomous Engine.`
        };
      }
    }

    // Under ALL policies: Credentials and secrets must NEVER be transmitted to external models
    if (analysis.hasCredentials) {
      return {
        allowed: false,
        action: 'block',
        policy: activePolicy,
        reasons: analysis.detectedItems,
        error: `Outbound Security Block: Payload contains sensitive credentials or secrets (${analysis.detectedItems.join('; ')}). Transmission aborted.`
      };
    }

    // Allowed
    return {
      allowed: true,
      isCloud: true,
      policy: activePolicy,
      reasons: []
    };
  }
}

module.exports = PrivacyEnforcer;
