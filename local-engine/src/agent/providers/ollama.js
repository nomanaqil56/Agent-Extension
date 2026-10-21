// Antigravity Local Agent Engine - Ollama & Local LLM Provider
// Section 5: Local inference with Ollama function calling & cancellation

class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'llama3.2', options = {}) {
    this.name = 'ollama';
    this.baseUrl = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.model = model || 'llama3.2';
    this.isLocal = true;
    this.isRemote = false;
    this.category = 'local';
    this.supportsTools = true;
    this.supportsStreaming = false;
    this.timeoutMs = options.timeoutMs || 120000;
  }

  // Check if Ollama daemon is reachable and whether models are installed
  async checkHealth(timeoutMs = 2500) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        return {
          healthy: false,
          error: `Ollama returned HTTP ${res.status}`
        };
      }

      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      const hasConfiguredModel = models.some(m => m === this.model || m.startsWith(`${this.model}:`));

      return {
        healthy: true,
        installedModels: models,
        hasConfiguredModel,
        activeModel: this.model,
        provider: 'ollama',
        disclaimer: 'Ollama runs entirely locally on this machine; zero data leaves your device.'
      };
    } catch (err) {
      return {
        healthy: false,
        error: `Ollama service unreachable at ${this.baseUrl}: ${err.message}`
      };
    }
  }

  async listModels() {
    const health = await this.checkHealth();
    return health.installedModels || [];
  }

  async generateStep(messages, tools = [], abortSignal = null) {
    const endpoint = `${this.baseUrl}/api/chat`;

    // Map tools for Ollama function calling
    const formattedTools = tools && tools.length > 0 ? tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} }
      }
    })) : undefined;

    const payload = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role === 'tool' ? 'tool' : m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      })),
      tools: formattedTools,
      stream: false
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Ollama request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);

    let abortListener;
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timeout);
        throw new Error('Task was cancelled before calling Ollama.');
      }
      abortListener = () => controller.abort(new Error('Task was cancelled by user.'));
      abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Ollama Error (${res.status}): ${err}`);
      }

      const data = await res.json();
      const msg = data.message;

      if (!msg) throw new Error('Ollama returned empty response message.');

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const call = msg.tool_calls[0];
        let args = call.function.arguments || {};
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch (e) {}
        }
        return {
          type: 'tool_call',
          tool: call.function.name,
          params: args,
          tool_call_id: call.id || `call_${Date.now()}`
        };
      }

      return {
        type: 'message',
        content: msg.content || ''
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Ollama request cancelled.');
      }
      throw new Error(`Failed to connect to local Ollama at ${this.baseUrl}: ${err.message}. Make sure Ollama is running ('ollama serve').`);
    } finally {
      clearTimeout(timeout);
      if (abortSignal && abortListener) {
        abortSignal.removeEventListener('abort', abortListener);
      }
    }
  }
}

module.exports = OllamaProvider;
