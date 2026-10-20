// Antigravity Local Agent Engine - Google Gemini Provider

class GeminiProvider {
  constructor(apiKey, model = 'gemini-2.0-flash') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateStep(messages, tools = []) {
    if (!this.apiKey) {
      throw new Error('Google Gemini API Key is missing. Set GEMINI_API_KEY in .env or Settings.');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Map messages to Gemini format
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Map tools to Gemini function declarations
    const geminiTools = tools.length > 0 ? [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }] : undefined;

    const payload = {
      contents,
      tools: geminiTools,
      generationConfig: {
        temperature: 0.2
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0];

    if (!candidate) {
      throw new Error('Gemini returned empty response');
    }

    if (candidate.functionCall) {
      return {
        type: 'tool_call',
        tool: candidate.functionCall.name,
        params: candidate.functionCall.args || {}
      };
    }

    return {
      type: 'message',
      content: candidate.text || ''
    };
  }
}

module.exports = GeminiProvider;
