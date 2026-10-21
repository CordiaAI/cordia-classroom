import Anthropic from '@anthropic-ai/sdk';

// One writing call (a system prompt and one user message) to whichever provider chatProvider()
// picked. Returns { text, cutOff } or null when the call failed. `json` asks for a JSON object.
export async function aiChat(provider, { system, user, maxTokens, json = false, timeoutMs = 30000, fetchImpl = globalThis.fetch }) {
  if (!provider?.key) return null;
  if (provider.name === 'anthropic') return claude(provider, { system, user, maxTokens, json, timeoutMs, fetchImpl });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${provider.base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.chatModel, temperature: 0.2, max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        // Groq's gpt-oss reasons before answering and that counts against max_tokens.
        ...(provider.name === 'groq' ? { reasoning_effort: 'low' } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error('AI call failed', response.status, (await response.text().catch(() => '')).slice(0, 300));
      return null;
    }
    const choice = (await response.json())?.choices?.[0];
    return { text: choice?.message?.content || '', cutOff: choice?.finish_reason === 'length' };
  } catch (error) {
    console.error('AI call failed', error?.name || error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Claude thinks before it answers and the thinking counts against max_tokens, so the budget
// gets headroom. These are short writing jobs: low effort. No server-side `fallbacks`: its
// targets are Opus models only, which Classroom never uses.
const THINKING_HEADROOM = 4000;

async function claude(provider, { system, user, maxTokens, json, timeoutMs, fetchImpl }) {
  const client = new Anthropic({ apiKey: provider.key, fetch: fetchImpl, timeout: timeoutMs, maxRetries: 1 });
  try {
    const message = await client.beta.messages.create({
      model: provider.chatModel,
      max_tokens: maxTokens + THINKING_HEADROOM,
      output_config: { effort: 'low' },
      // As a text block: the API can refuse a plain-string system prompt ("Input should be a valid array").
      system: [{ type: 'text', text: json ? `${system}\n\nRespond with only the JSON object: no code fences and no other text.` : system }],
      messages: [{ role: 'user', content: user }],
    });
    if (message.stop_reason === 'refusal') return null;
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('').trim();
    return { text: json ? text.replace(/^```(?:json)?\s*|\s*```$/g, '') : text, cutOff: message.stop_reason === 'max_tokens' };
  } catch (error) {
    if (error instanceof Anthropic.APIError) console.error('Claude call failed', error.status, String(error.message).slice(0, 300));
    else console.error('Claude call failed', error?.name || error);
    return null;
  }
}
