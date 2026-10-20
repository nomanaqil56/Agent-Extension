// Antigravity Local Agent Engine - Multi-Provider Factory & Hybrid Router Bridge

const GeminiProvider = require('./gemini');
const AnthropicProvider = require('./anthropic');
const OpenAIProvider = require('./openai');
const OllamaProvider = require('./ollama');
const FallbackAgentProvider = require('./fallback');
const HybridRouter = require('./router');

function createProvider(providerName, config = {}, toolRegistry = null) {
  const router = new HybridRouter(config);
  return router.routeTask({
    providerName,
    config,
    toolRegistry
  });
}

module.exports = {
  createProvider,
  HybridRouter,
  GeminiProvider,
  AnthropicProvider,
  OpenAIProvider,
  OllamaProvider,
  FallbackAgentProvider
};
