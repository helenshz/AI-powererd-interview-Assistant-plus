// Safe diagnostics: no credentials, transcripts, retrieved notes, or answer text in output.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
const scope = { exports: {}, require, process: { env }, console };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/groq.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, scope);
const config = scope.exports;
async function main() {
  console.log(JSON.stringify({ provider: config.CHAT_PROVIDER, model: config.GROQ_MODEL,
    configured: !config.CHAT_CONFIG_ERROR }));
  if (config.CHAT_CONFIG_ERROR) { process.exitCode = 1; return; }
  const client = config.default;
  const models = await client.models.list({ timeout: 20000, maxRetries: 0 });
  console.log(JSON.stringify({ availableModels: models.data.map(model => model.id),
    configuredModelAvailable: models.data.some(model => model.id === config.GROQ_MODEL) }));
  const result = await client.chat.completions.create({
    model: config.GROQ_MODEL, ...config.GROQ_REASONING_OPTIONS,
    ...config.modelTokenOptions(128), messages: [{ role: 'user', content: 'Reply with OK only.' }],
  }, { timeout: 20000, maxRetries: 0 });
  console.log(JSON.stringify({ chatSucceeded: true, hasAnswer: !!result.choices[0]?.message?.content?.trim(),
    finishReason: result.choices[0]?.finish_reason }));
}
main().catch(error => {
  console.error(JSON.stringify({ diagnosticError: error.name, status: error.status,
    code: error.code, networkCause: error.cause?.code || error.cause?.name }));
  process.exitCode = 1;
});
