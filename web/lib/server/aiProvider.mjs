// Server-only: which AI the web app's routes call. Writing (notes, titles, lecture outlines) goes
// to Anthropic when ANTHROPIC_API_KEY is set (chatProvider below). Transcription stays here:
// Groq when GROQ_API_KEY is set (Whisper), otherwise OpenAI with OPENAI_API_KEY. `key` is ''
// when neither is set.
export function aiProvider(env = process.env) {
  if (env.GROQ_API_KEY) {
    return {
      name: 'groq',
      key: env.GROQ_API_KEY,
      base: 'https://api.groq.com/openai/v1',
      chatModel: env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b',
      transcribeModel: env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo',
    };
  }
  return {
    name: env.OPENAI_API_KEY ? 'openai' : '',
    key: env.OPENAI_API_KEY || '',
    base: 'https://api.openai.com/v1',
    chatModel: env.CLASSROOM_LECTURE_CHAT_MODEL || 'gpt-4o-mini',
    transcribeModel: env.CLASSROOM_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  };
}

// The provider for writing: Claude when ANTHROPIC_API_KEY is set, else the one above.
export function chatProvider(env = process.env) {
  if (env.ANTHROPIC_API_KEY) {
    // Sonnet; ANTHROPIC_MODEL can pick another Claude model, but never Opus (anything else is ignored).
    const chosen = String(env.ANTHROPIC_MODEL || '').trim();
    return { name: 'anthropic', key: env.ANTHROPIC_API_KEY, chatModel: /^claude-/i.test(chosen) && !/opus/i.test(chosen) ? chosen : 'claude-sonnet-5-5' };
  }
  return aiProvider(env);
}

// Small, quick jobs (picking a class's cover icons): Haiku when Claude is set up.
export function smallChatProvider(env = process.env) {
  const provider = chatProvider(env);
  return provider.name === 'anthropic' ? { ...provider, chatModel: 'claude-haiku-5-5' } : provider;
}
