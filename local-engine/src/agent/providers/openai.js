// Antigravity Local Agent Engine - OpenAI Provider

class OpenAIProvider {
  constructor(apiKey, model = 'gpt-4o') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateStep(messages, tools = []) {
    if (!this.apiKey) {
      throw new Error('OpenAI API Key is missing. Set OPENAI_API_KEY in .env or Settings.');
    }

    const endpoint = 'https://api.openai.com/v1/chat/completions';

    // Format tools for OpenAI function calling
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
      tool_choice: formattedTools.length > 0 ? 'auto' : undefined,
      temperature: 0.2
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API Error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message;

    if (!msg) throw new Error('OpenAI returned empty message');

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const call = msg.tool_calls[0];
      let args = {};
      try {
        args = JSON.parse(call.function.arguments);
      } catch (e) {}

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
  }
}

module.exports = OpenAIProvider;
