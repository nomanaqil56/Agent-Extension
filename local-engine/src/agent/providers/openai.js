// Antigravity Local Agent Engine - OpenAI Provider
// Section 5 & 7: OpenAI Chat Completions API with Function Calling & AbortSignal

class OpenAIProvider {
  constructor(apiKey, model = 'gpt-4o', options = {}) {
    this.name = 'openai';
    this.apiKey = apiKey || '';
    this.model = model || 'gpt-4o';
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.isLocal = false;
    this.isRemote = true;
    this.category = 'cloud';
    this.supportsTools = true;
    this.supportsStreaming = false;
    this.timeoutMs = options.timeoutMs || 60000;
  }

  async checkHealth() {
    if (!this.apiKey) {
      return { healthy: false, error: 'OpenAI API key is missing. Configure in Settings or Credential Vault' };
    }
    return {
      healthy: true,
      model: this.model,
      provider: 'openai',
      disclaimer: 'Requests to OpenAI are processed on OpenAI Cloud servers subject to OpenAI terms.'
    };
  }

  async generateStep(messages, tools = [], abortSignal = null) {
    if (!this.apiKey) {
      throw new Error('OpenAI API Key is missing. Please set your OpenAI API Key in Settings.');
    }

    const endpoint = `${this.baseUrl}/chat/completions`;

    // Map messages
    const formattedMessages = messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.tool_call_id || 'call_default',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        };
      }
      return {
        role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      };
    });

    // Format tools for OpenAI function calling
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
      messages: formattedMessages,
      tools: formattedTools,
      tool_choice: formattedTools ? 'auto' : undefined,
      temperature: 0.2
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`OpenAI request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);

    let abortListener;
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timeout);
        throw new Error('Task was cancelled before calling OpenAI API.');
      }
      abortListener = () => controller.abort(new Error('Task was cancelled by user.'));
      abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text();
        let message = `OpenAI API Error (HTTP ${res.status})`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.error && parsed.error.message) {
            message = `OpenAI API Error: ${parsed.error.message}`;
          }
        } catch (e) {
          message = `OpenAI API Error: ${errText.slice(0, 300)}`;
        }
        throw new Error(message);
      }

      const data = await res.json();
      const msg = data.choices?.[0]?.message;

      if (!msg) throw new Error('OpenAI returned an empty message response.');

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const call = msg.tool_calls[0];
        let args = {};
        try {
          args = typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments)
            : (call.function.arguments || {});
        } catch (e) {}

        return {
          type: 'tool_call',
          tool: call.function.name,
          params: args,
          tool_call_id: call.id
        };
      }

      return {
        type: 'message',
        content: msg.content || ''
      };
    } finally {
      clearTimeout(timeout);
      if (abortSignal && abortListener) {
        abortSignal.removeEventListener('abort', abortListener);
      }
    }
  }
}

module.exports = OpenAIProvider;
