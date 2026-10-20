// Antigravity Local Agent Engine - Multi-Provider Factory & Hybrid Router

const GeminiProvider = require('./gemini');
const AnthropicProvider = require('./anthropic');
const OpenAIProvider = require('./openai');
const OllamaProvider = require('./ollama');
const FallbackAgentProvider = require('./fallback');

function createProvider(providerName, config = {}, toolRegistry = null) {
  const requested = (providerName || config.activeProvider || 'hybrid').toLowerCase();

  // Helper to check provider keys
  const geminiKey = process.env.GEMINI_API_KEY || config.geminiKey;
  const anthropicKey = process.env.ANTHROPIC_API_KEY || config.anthropicKey;
  const openAiKey = process.env.OPENAI_API_KEY || config.openAiKey;
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaUrl || config.providers?.ollama?.baseUrl || 'http://localhost:11434';

  // 1. Explicit Hybrid Routing Strategy:
  // Select best available provider in priority (Gemini -> Claude -> OpenAI -> Ollama -> Autonomous Engine)
  if (requested === 'hybrid') {
    if (geminiKey) {
      const model = config.providers?.gemini?.model || 'gemini-2.0-flash';
      return {
        provider: new GeminiProvider(geminiKey, model),
        activeProviderName: 'gemini',
        requestedProvider: 'hybrid',
        isFallback: false,
        model
      };
    }
    if (anthropicKey) {
      const model = config.providers?.anthropic?.model || 'claude-3-5-sonnet-20241022';
      return {
        provider: new AnthropicProvider(anthropicKey, model),
        activeProviderName: 'anthropic',
        requestedProvider: 'hybrid',
        isFallback: false,
        model
      };
    }
    if (openAiKey) {
      const model = config.providers?.openai?.model || 'gpt-4o';
      return {
        provider: new OpenAIProvider(openAiKey, model),
        activeProviderName: 'openai',
        requestedProvider: 'hybrid',
        isFallback: false,
        model
      };
    }
    // Zero-config offline autonomous engine
    return {
      provider: new FallbackAgentProvider(toolRegistry),
      activeProviderName: 'autonomous',
      requestedProvider: 'hybrid',
      isFallback: true,
      fallbackReason: 'Hybrid AI active: No external LLM keys detected. Operating via Built-in Autonomous Engine.'
    };
  }

  // 2. Specific Cloud / Local Provider Selection with Explicit Fallback
  switch (requested) {
    case 'gemini': {
      const model = config.providers?.gemini?.model || 'gemini-2.0-flash';
      if (!geminiKey) {
        return {
          provider: new FallbackAgentProvider(toolRegistry),
          activeProviderName: 'autonomous',
          requestedProvider: 'gemini',
          isFallback: true,
          fallbackReason: 'Gemini API key missing. Configure GEMINI_API_KEY in .env or Settings. Fell back to Autonomous Engine.'
        };
      }
      return {
        provider: new GeminiProvider(geminiKey, model),
        activeProviderName: 'gemini',
        requestedProvider: 'gemini',
        isFallback: false,
        model
      };
    }

    case 'claude':
    case 'anthropic': {
      const model = config.providers?.anthropic?.model || 'claude-3-5-sonnet-20241022';
      if (!anthropicKey) {
        return {
          provider: new FallbackAgentProvider(toolRegistry),
          activeProviderName: 'autonomous',
          requestedProvider: 'anthropic',
          isFallback: true,
          fallbackReason: 'Anthropic API key missing. Configure ANTHROPIC_API_KEY in .env or Settings. Fell back to Autonomous Engine.'
        };
      }
      return {
        provider: new AnthropicProvider(anthropicKey, model),
        activeProviderName: 'anthropic',
        requestedProvider: 'anthropic',
        isFallback: false,
        model
      };
    }

    case 'openai': {
      const model = config.providers?.openai?.model || 'gpt-4o';
      if (!openAiKey) {
        return {
          provider: new FallbackAgentProvider(toolRegistry),
          activeProviderName: 'autonomous',
          requestedProvider: 'openai',
          isFallback: true,
          fallbackReason: 'OpenAI API key missing. Configure OPENAI_API_KEY in .env or Settings. Fell back to Autonomous Engine.'
        };
      }
      return {
        provider: new OpenAIProvider(openAiKey, model),
        activeProviderName: 'openai',
        requestedProvider: 'openai',
        isFallback: false,
        model
      };
    }

    case 'ollama': {
      const model = config.providers?.ollama?.model || 'llama3.2';
      return {
        provider: new OllamaProvider(ollamaBaseUrl, model),
        activeProviderName: 'ollama',
        requestedProvider: 'ollama',
        isFallback: false,
        model
      };
    }

    case 'fallback':
    case 'autonomous':
    default:
      return {
        provider: new FallbackAgentProvider(toolRegistry),
        activeProviderName: 'autonomous',
        requestedProvider: requested,
        isFallback: false
      };
  }
}

module.exports = {
  createProvider,
  GeminiProvider,
  AnthropicProvider,
  OpenAIProvider,
  OllamaProvider,
  FallbackAgentProvider
};
