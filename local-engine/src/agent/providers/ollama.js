// Antigravity Local Agent Engine - Ollama & Local LLM Provider

class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'llama3.2') {
    this.name = 'ollama';
    this.baseUrl = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.model = model || 'llama3.2';
    this.isLocal = true;
    this.isRemote = false;
    this.category = 'local';
    this.supportsTools = true;
    this.supportsStreaming = false;
  }

  // Check if Ollama daemon is reachable and whether models are installed
  async checkHealth(timeoutMs = 1500) {
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
        activeModel: this.model
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

  async generateStep(messages, tools = []) {
    const endpoint = `${this.baseUrl}/api/chat`;

    // Map tools for Ollama function calling
    const formattedTools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const payload = {
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      stream: false
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Ollama Error (${res.status}): ${err}`);
      }

      const data = await res.json();
      const msg = data.message;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const call = msg.tool_calls[0];
        let args = call.function.arguments || {};
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch (e) {}
        }
        return {
          type: 'tool_call',
          tool: call.function.name,
          params: args
        };
      }

      return {
        type: 'message',
        content: msg.content || ''
      };
    } catch (err) {
      throw new Error(`Failed to connect to local Ollama at ${this.baseUrl}: ${err.message}. Make sure Ollama is running ('ollama serve').`);
    }
  }
}

module.exports = OllamaProvider;
