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

    // Check for complex reasoning / architectural code synthesis
    const complexKeywords = [
      'refactor', 'architect', 'architecture', 'design pattern', 'optimize algorithm',
      'complex algorithm', 'deep reasoning', 'plan complex', 'synthesize architecture',
      'security audit analysis'
    ];
    const isComplexReasoning = complexKeywords.some(kw => text.includes(kw));

    // Check for sensitive credentials or private tokens
    const sensitiveKeywords = [
      '.env', 'password', 'token', 'secret', 'id_rsa', 'id_ed25519', 'key', 'credential', 'auth'
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

  // Check which providers are configured and ready using canonical configuration schema
  getProviderAvailability(config = {}) {
    const customProviders = config.providerInstances || this.config.providerInstances || {};
    const geminiKey = process.env.GEMINI_API_KEY || config.geminiApiKey || config.geminiKey || config.providers?.gemini?.apiKey;
    const anthropicKey = process.env.ANTHROPIC_API_KEY || config.anthropicApiKey || config.anthropicKey || config.providers?.anthropic?.apiKey;
    const openAiKey = process.env.OPENAI_API_KEY || config.openaiApiKey || config.openAiKey || config.openaiKey || config.providers?.openai?.apiKey;
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaUrl || config.providers?.ollama?.baseUrl || 'http://localhost:11434';
    const ollamaModel = config.ollamaModel || config.providers?.ollama?.model || process.env.OLLAMA_MODEL || 'llama3';

    return {
      gemini: {
        available: Boolean(customProviders.gemini || geminiKey),
        key: geminiKey,
        model: config.providers?.gemini?.model || 'gemini-2.0-flash',
        instance: customProviders.gemini || null
      },
      anthropic: {
        available: Boolean(customProviders.anthropic || customProviders.claude || anthropicKey),
        key: anthropicKey,
        model: config.providers?.anthropic?.model || 'claude-3-5-sonnet-20241022',
        instance: customProviders.anthropic || customProviders.claude || null
      },
      openai: {
        available: Boolean(customProviders.openai || openAiKey),
        key: openAiKey,
        model: config.providers?.openai?.model || 'gpt-4o',
        instance: customProviders.openai || null
      },
      ollama: {
        baseUrl: ollamaBaseUrl,
        model: ollamaModel,
        available: Boolean(customProviders.ollama || ollamaBaseUrl),
        instance: customProviders.ollama || null
      },
      hasCloud: Boolean(customProviders.gemini || customProviders.anthropic || customProviders.claude || customProviders.openai || geminiKey || anthropicKey || openAiKey)
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
    const allowFallback = Boolean(effectiveConfig.allowFallbackOnMissingCredentials);

    // 1. Explicit Non-Hybrid Manual Provider Selection
    // In Manual mode: strictly respect chosen provider; do NOT silently substitute Autonomous Engine unless fallback is explicitly enabled!
    if (requested !== 'hybrid') {
      // In Privacy-First mode, cloud models are strictly forbidden from receiving local operations or private data
      if (policy === 'privacy-first' && (classification.isLocalOperation || classification.isSensitive)) {
        if (['gemini', 'claude', 'anthropic', 'openai'].includes(requested)) {
          return {
            provider: null,
            activeProviderName: requested,
            requestedProvider: requested,
            policy: 'privacy-first',
            blocked: true,
            error: `Privacy-First Policy Violation: Task contains local files or private operations and cannot be transmitted to cloud provider "${requested}". Select Ollama or Autonomous Engine, or adjust your routing policy.`,
            fallbackReason: 'Blocked outbound cloud transmission of local private data under Privacy-First policy.'
          };
        }
      }

      switch (requested) {
        case 'gemini': {
          if (!availability.gemini.available) {
            if (allowFallback) {
              return {
                provider: new FallbackAgentProvider(toolRegistry),
                activeProviderName: 'autonomous',
                requestedProvider: 'gemini',
                policy: 'manual',
                isFallback: true,
                fallbackReason: 'Gemini API key missing. Fell back to Autonomous Engine (Fallback Allowed).',
                model: availability.gemini.model
              };
            }
            return {
              provider: null,
              activeProviderName: 'gemini',
              requestedProvider: 'gemini',
              policy: 'manual',
              blocked: true,
              error: 'Gemini API key is not configured. Please add GEMINI_API_KEY in Settings or select an available provider.',
              fallbackReason: 'Gemini API key missing. Execution blocked (Manual Mode).'
            };
          }
          return {
            provider: availability.gemini.instance || new GeminiProvider(availability.gemini.key, availability.gemini.model),
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
            if (allowFallback) {
              return {
                provider: new FallbackAgentProvider(toolRegistry),
                activeProviderName: 'autonomous',
                requestedProvider: 'anthropic',
                policy: 'manual',
                isFallback: true,
                fallbackReason: 'Anthropic API key missing. Fell back to Autonomous Engine (Fallback Allowed).',
                model: availability.anthropic.model
              };
            }
            return {
              provider: null,
              activeProviderName: 'anthropic',
              requestedProvider: 'anthropic',
              policy: 'manual',
              blocked: true,
              error: 'Anthropic API key is not configured. Please add ANTHROPIC_API_KEY in Settings or select an available provider.',
              fallbackReason: 'Anthropic API key missing. Execution blocked (Manual Mode).'
            };
          }
          return {
            provider: availability.anthropic.instance || new AnthropicProvider(availability.anthropic.key, availability.anthropic.model),
            activeProviderName: 'anthropic',
            requestedProvider: 'anthropic',
            policy: 'manual',
            isFallback: false,
            model: availability.anthropic.model
          };
        }

        case 'openai': {
          if (!availability.openai.available) {
            if (allowFallback) {
              return {
                provider: new FallbackAgentProvider(toolRegistry),
                activeProviderName: 'autonomous',
                requestedProvider: 'openai',
                policy: 'manual',
                isFallback: true,
                fallbackReason: 'OpenAI API key missing. Fell back to Autonomous Engine (Fallback Allowed).',
                model: availability.openai.model
              };
            }
            return {
              provider: null,
              activeProviderName: 'openai',
              requestedProvider: 'openai',
              policy: 'manual',
              blocked: true,
              error: 'OpenAI API key is not configured. Please add OPENAI_API_KEY in Settings or select an available provider.',
              fallbackReason: 'OpenAI API key missing. Execution blocked (Manual Mode).'
            };
          }
          return {
            provider: availability.openai.instance || new OpenAIProvider(availability.openai.key, availability.openai.model),
            activeProviderName: 'openai',
            requestedProvider: 'openai',
            policy: 'manual',
            isFallback: false,
            model: availability.openai.model
          };
        }

        case 'ollama': {
          return {
            provider: availability.ollama.instance || new OllamaProvider(availability.ollama.baseUrl, availability.ollama.model),
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
    // Strict isolation: Local private files, commands, and code are NEVER sent to cloud models.
    if (policy === 'privacy-first') {
      if (classification.isLocalOperation || classification.isSensitive) {
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
    // Prioritizes cloud models if configured, falling back to local
    if (policy === 'cloud-preferred' && availability.hasCloud) {
      return this.selectCloudProvider(availability, policy, 'Cloud-Preferred Policy: Routed to top cloud provider.');
    }

    // Policy C: Balanced (Default)
    // Ordinary tasks (local files, telemetry, DOM parsing, simple actions) stay LOCAL.
    // Cloud escalation occurs ONLY when task requires complex cognitive reasoning and cloud is available.
    if (policy === 'balanced') {
      // 1. If task requires complex cognitive reasoning and cloud keys are available, escalate
      if (classification.isComplexReasoning && availability.hasCloud) {
        return this.selectCloudProvider(
          availability,
          policy,
          'Balanced Hybrid: Escalated to Cloud LLM for complex cognitive reasoning.'
        );
      }

      // 2. Ordinary tasks (local inspection, reading/writing files, basic commands, DOM distill, screenshots) stay LOCAL
      if (effectiveConfig.preferLocalOllama) {
        return {
          provider: new OllamaProvider(availability.ollama.baseUrl, availability.ollama.model),
          activeProviderName: 'ollama',
          requestedProvider: 'hybrid',
          policy: 'balanced',
          isFallback: false,
          model: availability.ollama.model,
          reason: 'Balanced Policy: Handled locally via Ollama LLM.'
        };
      }

      // Default local engine for ordinary tasks
      return {
        provider: new FallbackAgentProvider(toolRegistry),
        activeProviderName: 'autonomous',
        requestedProvider: 'hybrid',
        policy: 'balanced',
        isFallback: false,
        model: 'deterministic-rules',
        reason: 'Balanced Policy: Handled locally via Built-in Autonomous Engine.'
      };
    }

    // 3. Fallback: No cloud keys configured or local preferred
    if (effectiveConfig.preferLocalOllama) {
      return {
        provider: availability.ollama.instance || new OllamaProvider(availability.ollama.baseUrl, availability.ollama.model),
        activeProviderName: 'ollama',
        requestedProvider: 'hybrid',
        policy,
        isFallback: false,
        model: availability.ollama.model,
        reason: 'Hybrid AI active: Operating via local Ollama LLM.'
      };
    }

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
        provider: availability.gemini.instance || new GeminiProvider(availability.gemini.key, availability.gemini.model),
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
        provider: availability.anthropic.instance || new AnthropicProvider(availability.anthropic.key, availability.anthropic.model),
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
        provider: availability.openai.instance || new OpenAIProvider(availability.openai.key, availability.openai.model),
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
