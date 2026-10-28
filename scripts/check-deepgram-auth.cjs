// Validate authentication without printing credentials or sending audio.
const fs = require('node:fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
async function main() {
  const key = env.DEEPGRAM_API_KEY?.trim();
  if (!key) throw new Error('DEEPGRAM_API_KEY is missing');
  for (const [path, method] of [['auth/token', 'GET'], ['auth/grant', 'POST']]) {
    const response = await fetch(`https://api.deepgram.com/v1/${path}`, {
      method, headers: { Authorization: `Token ${key}` }, signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    console.log(JSON.stringify({ endpoint: path, status: response.status,
      code: data.err_code, tokenGranted: !!data.access_token }));
  }
}
main().catch(error => { console.error('Authentication check failed:', error.cause?.code || error.name); process.exitCode = 1; });
