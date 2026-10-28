import Groq from 'groq-sdk';

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export default groq;

// Configure independently from the legacy Gemini MODEL setting.
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
export const GROQ_MODEL_FAST = GROQ_MODEL;
export const GROQ_MODEL_BALANCED = GROQ_MODEL;

// The installed SDK predates GPT-OSS reasoning levels, but forwards these API fields.
export const GROQ_REASONING_OPTIONS: Record<string, unknown> = GROQ_MODEL.startsWith('openai/gpt-oss-')
  ? { reasoning_effort: 'low' }
  : {};

export class EmptyGroqAnswerError extends Error {
  code = 'empty_completion';
  constructor() { super('Groq did not return answer text after retry'); }
}

// Helper function for Groq streaming responses
export async function streamGroq(prompt: string, model: string = GROQ_MODEL) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = await groq.chat.completions.create({
      ...(model === GROQ_MODEL ? GROQ_REASONING_OPTIONS : {}),
      messages: [{ role: 'user', content: attempt === 0 ? prompt
        : `${prompt}\nGive the final answer directly in at most five short sentences.` }],
      model,
      temperature: 0.5,
      max_completion_tokens: attempt === 0 ? 4096 : 8192,
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
    max_tokens: 4000,
  });

  return response;
}
