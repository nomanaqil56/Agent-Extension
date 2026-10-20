// Antigravity Local Agent Engine - Advanced Hybrid AI Router & Policy Engine
// Intelligently routes tasks between Local LLM (Ollama), Cloud AI (Gemini/Claude/OpenAI),
// and the Built-in Deterministic Autonomous Engine based on transparency, capabilities, and privacy rules.

const GeminiProvider = require('./gemini');
const AnthropicProvider = require('./anthropic');
const OpenAIProvider = require('./openai');
const OllamaProvider = require('./ollama');
const FallbackAgentProvider = require('./fallback');

class HybridRouter {
  constructor(config = {}) {
    this.config = config;
  }

  // Classify task requirements, privacy scope, and complexity
  classifyTask(task = '', context = {}) {
    const text = (task || '').toLowerCase();

    // Check for local filesystem / terminal execution / local project indicators
    const localKeywords = [
      'file', 'files', 'dir', 'directory', 'read', 'write', 'patch', 'delete',
      'folder', 'workspace', 'terminal', 'shell', 'command', 'bash', 'powershell',
      'npm', 'git', 'run test', 'tests', 'system info', 'cpu', 'memory', 'disk', 'clipboard'
    ];
    const isLocalOperation = localKeywords.some(kw => text.includes(kw));

    // Check for browser automation indicators
    const browserKeywords = [
      'page', 'web', 'tab', 'tabs', 'click', 'dom', 'fill', 'scroll', 'url',
      'navigate', 'browser', 'screenshot', 'button', 'input', 'summarize'
    ];
    const isBrowserOperation = browserKeywords.some(kw => text.includes(kw)) || Boolean(context.page || context.dom);

    // Check for complex reasoning / code synthesis
    const complexKeywords = [
      'refactor', 'architect', 'design', 'debug', 'explain', 'optimize',
      'algorithm', 'analyze complex', 'deep reasoning', 'plan strategy'
    ];
    const isComplexReasoning = complexKeywords.some(kw => text.includes(kw));

    // Check for sensitive credentials or private tokens
    const sensitiveKeywords = [
      '.env', 'password', 'token', 'secret', 'id_rsa', 'key', 'credential', 'auth'
    ];
    const isSensitive = sensitiveKeywords.some(kw => text.includes(kw));

    return {
      isLocalOperation,
      isBrowserOperation,
      isComplexReasoning,
      isSensitive,
      hasBrowserContext: Boolean(context.page || context.dom)
    };
  }

  // Check which providers are configured and ready
  getProviderAvailability(config = {}) {
    const geminiKey = process.env.GEMINI_API_KEY || config.geminiKey;
    const anthropicKey = process.env.ANTHROPIC_API_KEY || config.anthropicKey;
    const openAiKey = process.env.OPENAI_API_KEY || config.openAiKey;
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaUrl || config.providers?.ollama?.baseUrl || 'http://localhost:11434';
    const ollamaModel = config.providers?.ollama?.model || 'llama3.2';

    return {
      gemini: { available: Boolean(geminiKey), key: geminiKey, model: config.providers?.gemini?.model || 'gemini-2.0-flash' },
      anthropic: { available: Boolean(anthropicKey), key: anthropicKey, model: config.providers?.anthropic?.model || 'claude-3-5-sonnet-20241022' },
      openai: { available: Boolean(openAiKey), key: openAiKey, model: config.providers?.openai?.model || 'gpt-4o' },
      ollama: { baseUrl: ollamaBaseUrl, model: ollamaModel },
      hasCloud: Boolean(geminiKey || anthropicKey || openAiKey)
    };
  }

  // Route task according to requested provider, routing policy, and task classification
  routeTask({
    task = '',
    context = {},
    providerName = 'hybrid',
    config = {},
    toolRegistry = null
  }) {
    const effectiveConfig = { ...this.config, ...config };
    const requested = (providerName || effectiveConfig.activeProvider || 'hybrid').toLowerCase();
    const policy = (effectiveConfig.hybridRoutingPolicy || 'balanced').toLowerCase();
    const classification = this.classifyTask(task, context);
    const availability = this.getProviderAvailability(effectiveConfig);

    // 1. Explicit Non-Hybrid Manual Provider Selection
    if (requested !== 'hybrid') {
      switch (requested) {
        case 'gemini': {
          if (!availability.gemini.available) {
            return {
              provider: new FallbackAgentProvider(toolRegistry),
              activeProviderName: 'autonomous',
              requestedProvider: 'gemini',
              policy: 'manual',
              isFallback: true,
              fallbackReason: 'Gemini API key missing. Configure GEMINI_API_KEY in .env or Settings. Fell back to Autonomous Engine.',
              model: availability.gemini.model
            };
          }
          return {
            provider: new GeminiProvider(availability.gemini.key, availability.gemini.model),
            activeProviderName: 'gemini',
            requestedProvider: 'gemini',
            policy: 'manual',
            isFallback: false,
            model: availability.gemini.model
          };
        }

        case 'claude':
        case 'anthropic': {
          if (!availability.anthropic.available) {
            return {
              provider: new FallbackAgentProvider(toolRegistry),
              activeProviderName: 'autonomous',
              requestedProvider: 'anthropic',
              policy: 'manual',
              isFallback: true,
              fallbackReason: 'Anthropic API key missing. Configure ANTHROPIC_API_KEY in .env or Settings. Fell back to Autonomous Engine.',
              model: availability.anthropic.model
            };
          }
          return {
            provider: new AnthropicProvider(availability.anthropic.key, availability.anthropic.model),
            activeProviderName: 'anthropic',
            requestedProvider: 'anthropic',
            policy: 'manual',
            isFallback: false,
            model: availability.anthropic.model
          };
        }

        case 'openai': {
          if (!availability.openai.available) {
            return {
              provider: new FallbackAgentProvider(toolRegistry),
              activeProviderName: 'autonomous',
              requestedProvider: 'openai',
              policy: 'manual',
              isFallback: true,
              fallbackReason: 'OpenAI API key missing. Configure OPENAI_API_KEY in .env or Settings. Fell back to Autonomous Engine.',
              model: availability.openai.model
            };
          }
          return {
            provider: new OpenAIProvider(availability.openai.key, availability.openai.model),
            activeProviderName: 'openai',
            requestedProvider: 'openai',
            policy: 'manual',
            isFallback: false,
            model: availability.openai.model
          };
        }

        case 'ollama': {
          return {
            provider: new OllamaProvider(availability.ollama.baseUrl, availability.ollama.model),
            activeProviderName: 'ollama',
            requestedProvider: 'ollama',
            policy: 'manual',
            isFallback: false,
            model: availability.ollama.model
          };
        }

        case 'fallback':
        case 'autonomous':
        default: {
          return {
            provider: new FallbackAgentProvider(toolRegistry),
            activeProviderName: 'autonomous',
            requestedProvider: requested,
            policy: 'manual',
            isFallback: false,
            model: 'deterministic-rules'
          };
        }
      }
    }

    // 2. Hybrid AI Routing Logic based on Configured Policy

    // Policy A: Privacy-First
    // Strict isolation: Local private files and commands are NEVER sent to cloud models.
    if (policy === 'privacy-first') {
      if (classification.isLocalOperation || classification.isSensitive) {
        // Use local Ollama if configured
        if (effectiveConfig.preferLocalOllama || effectiveConfig.ollamaUrl) {
          return {
            provider: new OllamaProvider(availability.ollama.baseUrl, availability.ollama.model),
            activeProviderName: 'ollama',
            requestedProvider: 'hybrid',
            policy: 'privacy-first',
            isFallback: false,
            model: availability.ollama.model,
            reason: 'Privacy-First Policy: Local workspace content routed to local Ollama LLM.'
          };
        }
        // Zero-config offline Autonomous Engine for absolute local privacy
        return {
          provider: new FallbackAgentProvider(toolRegistry),
          activeProviderName: 'autonomous',
          requestedProvider: 'hybrid',
          policy: 'privacy-first',
          isFallback: false,
          model: 'deterministic-rules',
          reason: 'Privacy-First Policy: Kept inside local environment via Built-in Autonomous Engine.'
        };
      }
    }

    // Policy B: Cloud-Preferred
    // Uses highest priority available cloud provider, falling back to local
    if (policy === 'cloud-preferred' && availability.hasCloud) {
      return this.selectCloudProvider(availability, policy, 'Cloud-Preferred Policy: Routed to top cloud provider.');
    }

    // Policy C: Balanced (Default)
    // Local execution for simple local diagnostics and DOM parsing; cloud escalation for complex reasoning
    if (policy === 'balanced') {
      // If task is purely querying local telemetry, simple file listing, or simple DOM distill without complex reasoning
      if ((classification.isLocalOperation || classification.isBrowserOperation) && !classification.isComplexReasoning && !availability.hasCloud) {
        return {
          provider: new FallbackAgentProvider(toolRegistry),
          activeProviderName: 'autonomous',
          requestedProvider: 'hybrid',
          policy: 'balanced',
          isFallback: false,
          model: 'deterministic-rules',
          reason: 'Balanced Policy: Local execution handled via Built-in Autonomous Engine.'
        };
      }

      // If cloud keys are available, escalate for higher cognitive reasoning
      if (availability.hasCloud) {
        return this.selectCloudProvider(
          availability,
          policy,
          classification.isComplexReasoning
            ? 'Balanced Hybrid: Escalated to Cloud LLM for complex reasoning.'
            : 'Balanced Hybrid: Cloud provider active.'
        );
      }
    }

    // 3. Fallback: No cloud keys configured in Hybrid mode
    // Check if user has explicit Ollama endpoint configured
    if (effectiveConfig.preferLocalOllama) {
      return {
        provider: new OllamaProvider(availability.ollama.baseUrl, availability.ollama.model),
        activeProviderName: 'ollama',
        requestedProvider: 'hybrid',
        policy,
        isFallback: false,
        model: availability.ollama.model,
        reason: 'Hybrid AI active: Operating via local Ollama LLM.'
      };
    }

    // Standard zero-config offline Autonomous Engine
    return {
      provider: new FallbackAgentProvider(toolRegistry),
      activeProviderName: 'autonomous',
      requestedProvider: 'hybrid',
      policy,
      isFallback: true,
      fallbackReason: 'Hybrid AI active: No external LLM keys detected. Operating via Built-in Autonomous Engine.',
      model: 'deterministic-rules'
    };
  }

  // Select top priority available cloud provider (Gemini -> Claude -> OpenAI)
  selectCloudProvider(availability, policy, reason = '') {
    if (availability.gemini.available) {
      return {
        provider: new GeminiProvider(availability.gemini.key, availability.gemini.model),
        activeProviderName: 'gemini',
        requestedProvider: 'hybrid',
        policy,
        isFallback: false,
        model: availability.gemini.model,
        reason
      };
    }

    if (availability.anthropic.available) {
      return {
        provider: new AnthropicProvider(availability.anthropic.key, availability.anthropic.model),
        activeProviderName: 'anthropic',
        requestedProvider: 'hybrid',
        policy,
        isFallback: false,
        model: availability.anthropic.model,
        reason
      };
    }

    if (availability.openai.available) {
      return {
        provider: new OpenAIProvider(availability.openai.key, availability.openai.model),
        activeProviderName: 'openai',
        requestedProvider: 'hybrid',
        policy,
        isFallback: false,
        model: availability.openai.model,
        reason
      };
    }

    return null;
  }
}

module.exports = HybridRouter;
