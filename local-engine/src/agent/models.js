// Antigravity Local Agent Engine - Model Manager
// Section 5, 6 & 7: Explicit model selection, credential binding & provider management

const GeminiProvider = require('./providers/gemini');
const OpenAIProvider = require('./providers/openai');
const AnthropicProvider = require('./providers/anthropic');
const OllamaProvider = require('./providers/ollama');
const FallbackAgentProvider = require('./providers/fallback');

class ModelManager {
  constructor(config = {}, credentialVault = null) {
    this.config = config;
    this.vault = credentialVault;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  // Retrieve API key for a provider from CredentialVault or environment or config
  getProviderKey(providerName) {
    const norm = (providerName || '').toLowerCase();
    const vaultKey = this.vault ? this.vault.getSecret(norm) : null;
    if (vaultKey) return vaultKey;

    switch (norm) {
      case 'gemini':
        return process.env.GEMINI_API_KEY || this.config.geminiApiKey || this.config.geminiKey || this.config.providers?.gemini?.apiKey || '';
      case 'openai':
        return process.env.OPENAI_API_KEY || this.config.openaiApiKey || this.config.openAiKey || this.config.providers?.openai?.apiKey || '';
      case 'anthropic':
      case 'claude':
        return process.env.ANTHROPIC_API_KEY || this.config.anthropicApiKey || this.config.anthropicKey || this.config.providers?.anthropic?.apiKey || '';
      default:
        return '';
    }
  }

  // Get active provider instance based on explicit configuration
  getActiveProvider(requestedProvider = null, toolRegistry = null) {
    const providerName = (requestedProvider || this.config.activeProvider || 'gemini').toLowerCase();

    // 1. Gemini (Default experience per Section 6)
    if (providerName === 'gemini') {
      const apiKey = this.getProviderKey('gemini');
      const model = this.config.providers?.gemini?.model || this.config.geminiModel || 'gemini-2.0-flash';
      const baseUrl = this.config.providers?.gemini?.baseUrl || this.config.geminiBaseUrl;
      const provider = new GeminiProvider(apiKey, model, { baseUrl });
      return {
        provider,
        providerName: 'gemini',
        model,
        isConfigured: Boolean(apiKey),
        isLocal: false,
        requiresKey: true
      };
    }

    // 2. OpenAI
    if (providerName === 'openai') {
      const apiKey = this.getProviderKey('openai');
      const model = this.config.providers?.openai?.model || this.config.openaiModel || 'gpt-4o';
      const baseUrl = this.config.providers?.openai?.baseUrl || this.config.openaiBaseUrl;
      const provider = new OpenAIProvider(apiKey, model, { baseUrl });
      return {
        provider,
        providerName: 'openai',
        model,
        isConfigured: Boolean(apiKey),
        isLocal: false,
        requiresKey: true
      };
    }

    // 3. Anthropic
    if (providerName === 'anthropic' || providerName === 'claude') {
      const apiKey = this.getProviderKey('anthropic');
      const model = this.config.providers?.anthropic?.model || this.config.anthropicModel || 'claude-3-5-sonnet-20241022';
      const baseUrl = this.config.providers?.anthropic?.baseUrl;
      const provider = new AnthropicProvider(apiKey, model, { baseUrl });
      return {
        provider,
        providerName: 'anthropic',
        model,
        isConfigured: Boolean(apiKey),
        isLocal: false,
        requiresKey: true
      };
    }

    // 4. Ollama (Local LLM)
    if (providerName === 'ollama') {
      const baseUrl = this.config.ollamaUrl || this.config.providers?.ollama?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const model = this.config.ollamaModel || this.config.providers?.ollama?.model || 'llama3.2';
      const provider = new OllamaProvider(baseUrl, model);
      return {
        provider,
        providerName: 'ollama',
        model,
        isConfigured: true,
        isLocal: true,
        requiresKey: false
      };
    }

    // 5. Offline deterministic helper (Explicitly requested)
    if (providerName === 'autonomous' || providerName === 'fallback') {
      const provider = new FallbackAgentProvider(toolRegistry);
      return {
        provider,
        providerName: 'autonomous',
        model: 'deterministic-rules',
        isConfigured: true,
        isLocal: true,
        requiresKey: false
      };
    }

    // Default fallback to Gemini
    const apiKey = this.getProviderKey('gemini');
    const model = 'gemini-2.0-flash';
    return {
      provider: new GeminiProvider(apiKey, model),
      providerName: 'gemini',
      model,
      isConfigured: Boolean(apiKey),
      isLocal: false,
      requiresKey: true
    };
  }

  // Test provider connection
  async testConnection(providerName) {
    const { provider, isConfigured, requiresKey } = this.getActiveProvider(providerName);
    if (requiresKey && !isConfigured) {
      return {
        success: false,
        error: `API key for ${providerName} is not configured.`
      };
    }
    try {
      const health = await provider.checkHealth();
      return {
        success: health.healthy !== false,
        ...health
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  // List all supported providers and their readiness status
  getReadinessStatus() {
    return {
      gemini: {
        configured: Boolean(this.getProviderKey('gemini')),
        model: this.config.providers?.gemini?.model || 'gemini-2.0-flash',
        isDefault: true
      },
      openai: {
        configured: Boolean(this.getProviderKey('openai')),
        model: this.config.providers?.openai?.model || 'gpt-4o'
      },
      anthropic: {
        configured: Boolean(this.getProviderKey('anthropic')),
        model: this.config.providers?.anthropic?.model || 'claude-3-5-sonnet-20241022'
      },
      ollama: {
        configured: true,
        url: this.config.ollamaUrl || 'http://localhost:11434',
        model: this.config.ollamaModel || 'llama3.2'
      }
    };
  }
}

module.exports = ModelManager;
