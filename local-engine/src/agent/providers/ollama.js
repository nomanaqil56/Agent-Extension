// Antigravity Local Agent Engine - Ollama & Local LLM Provider

class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'llama3.2') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
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
        return {
          type: 'tool_call',
          tool: call.function.name,
          params: call.function.arguments || {}
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
