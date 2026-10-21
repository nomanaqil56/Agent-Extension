// Antigravity Local Agent Engine - Google Gemini Provider (Official REST API with Function Calling)
// Section 5 & 6: Real Language Model with Tool Calling and AbortSignal support

class GeminiProvider {
  constructor(apiKey, model = 'gemini-2.0-flash', options = {}) {
    this.name = 'gemini';
    this.apiKey = apiKey || '';
    this.model = model || 'gemini-2.0-flash';
    this.baseUrl = options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    this.isLocal = false;
    this.isRemote = true;
    this.category = 'cloud';
    this.supportsTools = true;
    this.supportsStreaming = false;
    this.timeoutMs = options.timeoutMs || 60000;
  }

  async checkHealth() {
    if (!this.apiKey) {
      return { healthy: false, error: 'Google Gemini API key is missing. Configure in Settings or .secrets.json' };
    }
    return {
      healthy: true,
      model: this.model,
      provider: 'gemini',
      disclaimer: 'Requests to Gemini are processed on Google Cloud servers subject to Google API terms.'
    };
  }

  async generateStep(messages, tools = [], abortSignal = null) {
    if (!this.apiKey) {
      throw new Error('Google Gemini API Key is missing. Please set your Gemini API Key in Settings.');
    }

    const endpoint = `${this.baseUrl}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    // 1. Separate system instructions from conversation contents per Gemini specification
    let systemInstruction = undefined;
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = {
          parts: [{ text: msg.content }]
        };
      } else if (msg.role === 'assistant') {
        if (msg.toolCall) {
          contents.push({
            role: 'model',
            parts: [{
              functionCall: {
                name: msg.toolCall.name,
                args: msg.toolCall.args || {}
              }
            }]
          });
        } else {
          contents.push({
            role: 'model',
            parts: [{ text: msg.content || '' }]
          });
        }
      } else if (msg.role === 'function' || msg.role === 'tool') {
        // Tool result observation
        contents.push({
          role: 'function',
          parts: [{
            functionResponse: {
              name: msg.name || 'tool_response',
              response: {
                output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
              }
            }
          }]
        });
      } else {
        // User message
        contents.push({
          role: 'user',
          parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
        });
      }
    }

    // Ensure at least one user message exists
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Begin task' }] });
    }

    // 2. Format function declarations
    const geminiTools = tools && tools.length > 0 ? [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} }
      }))
    }] : undefined;

    const payload = {
      systemInstruction,
      contents,
      tools: geminiTools,
      generationConfig: {
        temperature: 0.2
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Gemini request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);

    let abortListener;
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timeout);
        throw new Error('Task was cancelled before calling Gemini API.');
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
        const errText = await res.text();
        let message = `Gemini API Error (HTTP ${res.status})`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.error && parsed.error.message) {
            message = `Gemini API Error: ${parsed.error.message}`;
          }
        } catch (e) {
          message = `Gemini API Error: ${errText.slice(0, 300)}`;
        }
        throw new Error(message);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0]?.content?.parts?.[0];

      if (!candidate) {
        // Check if blocked by safety settings or finishReason
        const finishReason = data.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== 'STOP') {
          throw new Error(`Gemini finished with reason: ${finishReason}`);
        }
        throw new Error('Gemini returned an empty response candidate.');
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
    } finally {
      clearTimeout(timeout);
      if (abortSignal && abortListener) {
        abortSignal.removeEventListener('abort', abortListener);
      }
    }
  }
}

module.exports = GeminiProvider;
