import OpenAI from 'openai';

// Keep existing imports stable while supporting OpenAI-compatible chat providers.
export const CHAT_PROVIDER = process.env.LLM_PROVIDER || 'groq';
const apiKey = process.env.LLM_API_KEY || (CHAT_PROVIDER === 'groq' ? process.env.GROQ_API_KEY
  : CHAT_PROVIDER === 'deepseek' ? process.env.DEEPSEEK_API_KEY : undefined);
const baseURL = process.env.LLM_BASE_URL || (CHAT_PROVIDER === 'groq' ? 'https://api.groq.com/openai/v1'
  : CHAT_PROVIDER === 'deepseek' ? 'https://api.deepseek.com' : undefined);
export const GROQ_MODEL = process.env.LLM_MODEL || (CHAT_PROVIDER === 'groq'
  ? process.env.GROQ_MODEL || 'openai/gpt-oss-20b'
  : CHAT_PROVIDER === 'deepseek' ? 'deepseek-flash' : '');
export const CHAT_CONFIG_ERROR = !['groq', 'deepseek', 'openai-compatible'].includes(CHAT_PROVIDER)
  ? 'Unsupported LLM_PROVIDER. Use groq, deepseek, or openai-compatible.'
  : !apiKey || apiKey.startsWith('your-') ? 'Configure the selected provider API key in .env.local.'
  : !baseURL || !GROQ_MODEL ? 'Configure LLM_BASE_URL and LLM_MODEL for the selected provider.' : '';
const groq = new OpenAI({ apiKey: apiKey || 'not-configured', baseURL: baseURL || 'https://api.openai.com/v1' });

export default groq;

export const GROQ_MODEL_FAST = GROQ_MODEL;
export const GROQ_MODEL_BALANCED = GROQ_MODEL;

// Send provider-specific options only to the provider that supports them.
export const GROQ_REASONING_OPTIONS: Record<string, unknown> = CHAT_PROVIDER === 'groq' && GROQ_MODEL.startsWith('openai/gpt-oss-')
  ? { reasoning_effort: 'low' }
  : CHAT_PROVIDER === 'deepseek' ? { thinking: { type: 'disabled' } } : {};

export function modelTokenOptions(limit: number): { max_completion_tokens: number } | { max_tokens: number } {
  return CHAT_PROVIDER === 'groq' ? { max_completion_tokens: limit } : { max_tokens: limit };
}

export class EmptyGroqAnswerError extends Error {
  code = 'empty_completion';
  constructor() { super('Groq did not return answer text after retry'); }
}

// Helper function for Groq streaming responses
export async function streamGroq(prompt: string, model: string = GROQ_MODEL) {
  if (CHAT_CONFIG_ERROR) throw Object.assign(new Error(CHAT_CONFIG_ERROR), { code: 'configuration_error' });
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = await groq.chat.completions.create({
      ...(model === GROQ_MODEL ? GROQ_REASONING_OPTIONS : {}),
      messages: [{ role: 'user', content: attempt === 0 ? prompt
        : `${prompt}\nGive the final answer directly in at most five short sentences.` }],
      model,
      temperature: 0.5,
      ...modelTokenOptions(attempt === 0 ? 4096 : 8192),
      stream: true,
    });
    const iterator = stream[Symbol.asyncIterator]();
    let finishReason: string | null = null;
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      finishReason = next.value.choices[0]?.finish_reason || finishReason;
      const content = next.value.choices[0]?.delta?.content;
      if (content?.trim()) {
        // Do not return HTTP 200 until at least one real answer chunk arrives.
        return (async function* () {
          try {
            yield content;
            while (true) {
              const remaining = await iterator.next();
              if (remaining.done) break;
              const text = remaining.value.choices[0]?.delta?.content;
              if (text) yield text;
            }
          } finally {
            await iterator.return?.();
          }
        })();
      }
    }
    console.warn('Groq returned no answer text', { attempt: attempt + 1, finishReason });
  }
  throw new EmptyGroqAnswerError();
}

// Helper function for non-streaming responses
export async function queryGroq(prompt: string, model: string = GROQ_MODEL) {
  const response = await groq.chat.completions.create({
    ...GROQ_REASONING_OPTIONS,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    model: model,
    temperature: 0.7,
    ...modelTokenOptions(4000),
  });

  return response;
}
