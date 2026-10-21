// Antigravity Local Agent Engine - Anthropic Claude Provider
// Section 5: Anthropic Messages API with Tool Calling & AbortSignal

class AnthropicProvider {
  constructor(apiKey, model = 'claude-3-5-sonnet-20241022', options = {}) {
    this.name = 'anthropic';
    this.apiKey = apiKey || '';
    this.model = model || 'claude-3-5-sonnet-20241022';
    this.baseUrl = (options.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '');
    this.isLocal = false;
    this.isRemote = true;
    this.category = 'cloud';
    this.supportsTools = true;
    this.supportsStreaming = false;
    this.timeoutMs = options.timeoutMs || 60000;
  }

  async checkHealth() {
    if (!this.apiKey) {
      return { healthy: false, error: 'Anthropic API key is missing. Configure in Settings or .secrets.json' };
    }
    return {
      healthy: true,
      model: this.model,
      provider: 'anthropic',
      disclaimer: 'Requests to Claude are processed on Anthropic Cloud servers subject to Anthropic terms.'
    };
  }

  async generateStep(messages, tools = [], abortSignal = null) {
    if (!this.apiKey) {
      throw new Error('Anthropic API Key is missing. Please set your Anthropic API Key in Settings.');
    }

    const endpoint = `${this.baseUrl}/messages`;

    // Format tools for Claude
    const claudeTools = tools && tools.length > 0 ? tools.map(t => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.parameters || { type: 'object', properties: {} }
    })) : undefined;

    // Filter system prompt if present
    let system = 'You are an autonomous computer and browser agent.';
    const formattedMessages = [];

    for (const m of messages) {
      if (m.role === 'system') {
        system = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      } else if (m.role === 'tool') {
        formattedMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: m.tool_call_id || 'tool_use_default',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          }]
        });
      } else {
        formattedMessages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        });
      }
    }

    if (formattedMessages.length === 0) {
      formattedMessages.push({ role: 'user', content: 'Begin task' });
    }

    const payload = {
      model: this.model,
      max_tokens: 2048,
      system,
      messages: formattedMessages,
      tools: claudeTools
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Anthropic request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);

    let abortListener;
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timeout);
        throw new Error('Task was cancelled before calling Anthropic API.');
      }
      abortListener = () => controller.abort(new Error('Task was cancelled by user.'));
      abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text();
        let message = `Anthropic API Error (HTTP ${res.status})`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.error && parsed.error.message) {
            message = `Anthropic API Error: ${parsed.error.message}`;
          }
        } catch (e) {
          message = `Anthropic API Error: ${errText.slice(0, 300)}`;
        }
        throw new Error(message);
      }

      const data = await res.json();
      for (const block of data.content || []) {
        if (block.type === 'tool_use') {
          return {
            type: 'tool_call',
            tool: block.name,
            params: block.input || {},
            tool_call_id: block.id
          };
        }
      }

      const textBlock = (data.content || []).find(b => b.type === 'text');
      return {
        type: 'message',
        content: textBlock?.text || ''
      };
    } finally {
      clearTimeout(timeout);
      if (abortSignal && abortListener) {
        abortSignal.removeEventListener('abort', abortListener);
      }
    }
  }
}

module.exports = AnthropicProvider;
