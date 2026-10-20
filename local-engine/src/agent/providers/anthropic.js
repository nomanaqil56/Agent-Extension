// Antigravity Local Agent Engine - Anthropic Claude Provider

class AnthropicProvider {
  constructor(apiKey, model = 'claude-3-5-sonnet-20241022') {
    this.name = 'anthropic';
    this.apiKey = apiKey;
    this.model = model || 'claude-3-5-sonnet-20241022';
    this.supportsTools = true;
    this.supportsStreaming = false;
  }

  async checkHealth() {
    if (!this.apiKey) {
      return { healthy: false, error: 'Anthropic API Key missing' };
    }
    return { healthy: true, model: this.model, provider: 'anthropic' };
  }

  async generateStep(messages, tools = []) {
    if (!this.apiKey) {
      throw new Error('Anthropic API Key is missing. Set ANTHROPIC_API_KEY in .env or Settings.');
    }

    const endpoint = 'https://api.anthropic.com/v1/messages';

    // Format tools for Claude
    const claudeTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    // Filter system prompt if present
    let system = 'You are an autonomous computer and browser agent.';
    const formattedMessages = [];

    messages.forEach(m => {
      if (m.role === 'system') {
        system = m.content;
      } else {
        formattedMessages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        });
      }
    });

    const payload = {
      model: this.model,
      max_tokens: 2048,
      system,
      messages: formattedMessages,
      tools: claudeTools.length > 0 ? claudeTools : undefined
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API Error (${res.status}): ${err}`);
    }

    const data = await res.json();
    for (const block of data.content || []) {
      if (block.type === 'tool_use') {
        return {
          type: 'tool_call',
          tool: block.name,
          params: block.input || {}
        };
      }
    }

    const textBlock = (data.content || []).find(b => b.type === 'text');
    return {
      type: 'message',
      content: textBlock?.text || ''
    };
  }
}

module.exports = AnthropicProvider;
