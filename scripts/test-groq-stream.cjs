const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const source = ts.transpileModule(fs.readFileSync('lib/groq.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
async function run(fixtures, expectedCalls, expectFailure = false) {
  let calls = 0;
  const sandbox = { exports: {}, process: { env: { GROQ_API_KEY: 'fake' } }, console: { warn() {} },
    require() { return { default: class { chat = { completions: { create: async options => {
      assert.equal(options.reasoning_effort, 'low');
      assert.equal(options.max_completion_tokens, calls === 0 ? 4096 : 8192);
      const fixture = fixtures[calls++];
      return (async function* () { yield* fixture; })();
    } } }; } }; },
  };
  vm.runInNewContext(source, sandbox);
  if (expectFailure) {
    await assert.rejects(() => sandbox.exports.streamGroq('test'), error => error.code === 'empty_completion');
  } else {
    let result = '';
    for await (const text of await sandbox.exports.streamGroq('test')) result += text;
    assert.equal(result, '回答です。');
  }
  assert.equal(calls, expectedCalls);
}
const empty = [{ choices: [{ delta: {}, finish_reason: 'length' }] }];
const answer = [
  { choices: [{ delta: { content: '回答' } }] },
  { choices: [{ delta: { content: 'です。' }, finish_reason: 'stop' }] },
];
(async () => {
  await run([answer], 1);
  await run([empty, answer], 2);
  await run([empty, empty], 2, true);
  console.log('PASS: final text streaming, empty-answer retry, low reasoning effort, and failure after two empty completions');
})().catch(error => { console.error(error); process.exitCode = 1; });
