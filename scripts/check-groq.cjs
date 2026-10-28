// Print only status and error codes; never print credentials or model output.
const fs = require('node:fs');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
async function main() {
  const key = env.GROQ_API_KEY?.trim();
  if (!key || key.startsWith('your-')) throw new Error('GROQ_API_KEY is not configured');
  const model = process.argv[2] || env.GROQ_MODEL || 'openai/gpt-oss-20b';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 32 }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  console.log(JSON.stringify({ status: response.status, model, code: data.error?.code,
    type: data.error?.type, hasResponse: !!data.choices?.length }));
  if (!response.ok) process.exitCode = 1;
}
main().catch(error => { console.error('Groq check failed:', error.cause?.code || error.name); process.exitCode = 1; });
