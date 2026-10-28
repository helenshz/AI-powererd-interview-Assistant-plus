const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
const source = ts.transpileModule(fs.readFileSync('lib/groq.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
async function check(env, expected) {
  let connection, request;
  const scope = { exports: {}, process: { env }, console: { warn() {} },
    require() { return { default: class {
      constructor(options) { connection = options; }
      chat = { completions: { create: async options => {
        request = options;
        return (async function* () { yield { choices: [{ delta: { content: 'Test answer' } }] }; })();
      } } };
    } }; },
  };
  vm.runInNewContext(source, scope);
  if (expected.error) {
    await assert.rejects(() => scope.exports.streamGroq('test'), error => error.code === 'configuration_error');
    assert.equal(request, undefined);
    return;
  }
  let result = '';
  for await (const text of await scope.exports.streamGroq('test')) result += text;
  assert.equal(result, 'Test answer');
  assert.equal(connection.apiKey, expected.key);
  assert.equal(connection.baseURL, expected.url);
  assert.equal(request.model, expected.model);
  if (env.LLM_PROVIDER === 'deepseek') {
    assert.equal(request.thinking.type, 'disabled');
    assert.equal(request.max_tokens, 4096);
    assert.equal(request.reasoning_effort, undefined);
  } else if (!env.LLM_PROVIDER) {
    assert.equal(request.reasoning_effort, 'low');
    assert.equal(request.max_completion_tokens, 4096);
  } else {
    assert.equal(request.thinking, undefined);
    assert.equal(request.reasoning_effort, undefined);
  }
}
(async () => {
  await check({ GROQ_API_KEY: 'fake-groq' }, { key: 'fake-groq', url: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b' });
  await check({ LLM_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'fake-deepseek', GROQ_API_KEY: 'never-send-this' }, { key: 'fake-deepseek', url: 'https://api.deepseek.com', model: 'deepseek-flash' });
  await check({ LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'fake-custom', LLM_BASE_URL: 'https://example.com/v1', LLM_MODEL: 'custom-model' }, { key: 'fake-custom', url: 'https://example.com/v1', model: 'custom-model' });
  await check({ LLM_PROVIDER: 'deepseek', GROQ_API_KEY: 'never-send-this' }, { error: true });
  await check({ LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'fake' }, { error: true });
  await check({ LLM_PROVIDER: 'unknown', LLM_API_KEY: 'fake' }, { error: true });
  console.log('PASS: Groq, DeepSeek, compatible endpoints, token parameters, missing configuration, and provider key isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
