// Server-only: which AI the web app's routes call (notes, titles, lecture analysis, transcription).
// Groq when GROQ_API_KEY is set (an OpenAI-compatible API, including Whisper transcription),
// otherwise OpenAI with OPENAI_API_KEY. `key` is '' when neither is set.
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
