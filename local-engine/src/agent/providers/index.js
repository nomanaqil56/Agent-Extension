// Antigravity Local Agent Engine - Multi-Provider Factory

const GeminiProvider = require('./gemini');
const AnthropicProvider = require('./anthropic');
const OpenAIProvider = require('./openai');
const OllamaProvider = require('./ollama');
const FallbackAgentProvider = require('./fallback');

function createProvider(providerName, config = {}, toolRegistry = null) {
  const name = (providerName || 'fallback').toLowerCase();

  switch (name) {
    case 'gemini': {
      const key = process.env.GEMINI_API_KEY || config.geminiKey;
      const model = config.providers?.gemini?.model || 'gemini-2.0-flash';
      if (!key) {
        console.warn('[Provider] Gemini key not provided. Falling back to Autonomous Engine.');
        return new FallbackAgentProvider(toolRegistry);
      }
      return new GeminiProvider(key, model);
    }

    case 'claude':
    case 'anthropic': {
      const key = process.env.ANTHROPIC_API_KEY || config.anthropicKey;
      const model = config.providers?.anthropic?.model || 'claude-3-5-sonnet-20241022';
      if (!key) {
        console.warn('[Provider] Anthropic key not provided. Falling back to Autonomous Engine.');
        return new FallbackAgentProvider(toolRegistry);
      }
      return new AnthropicProvider(key, model);
    }

    case 'openai': {
      const key = process.env.OPENAI_API_KEY || config.openAiKey;
      const model = config.providers?.openai?.model || 'gpt-4o';
      if (!key) {
        console.warn('[Provider] OpenAI key not provided. Falling back to Autonomous Engine.');
        return new FallbackAgentProvider(toolRegistry);
      }
      return new OpenAIProvider(key, model);
    }

    case 'ollama': {
      const baseUrl = process.env.OLLAMA_BASE_URL || config.ollamaUrl || config.providers?.ollama?.baseUrl || 'http://localhost:11434';
      const model = config.providers?.ollama?.model || 'llama3.2';
      return new OllamaProvider(baseUrl, model);
    }

    case 'fallback':
    case 'hybrid':
    default:
      return new FallbackAgentProvider(toolRegistry);
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
