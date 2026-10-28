// Live check using synthetic notes only; print counts, never credentials or answer text.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
function load(file) {
  const sandbox = { exports: {}, require, process: { env }, console };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, sandbox);
  return sandbox.exports;
}
(async () => {
  const utils = load('lib/utils.ts');
  const groq = load('lib/groq.ts');
  const question = 'このポジションに応募した理由は何ですか。';
  const notes = 'Synthetic test notes: 応募理由は、ロボット開発に関心があり、Pythonを用いた開発とテストの経験を生かしてチームに貢献したいからです。';
  let answer = '';
  for await (const text of await groq.streamGroq(utils.buildRAGPrompt('', question, question, notes))) answer += text;
  const hasJapanese = /[ぁ-んァ-ン]/.test(answer);
  console.log(JSON.stringify({ hasAnswer: !!answer.trim(), hasJapanese, characters: answer.length }));
  if (!answer.trim() || !hasJapanese) process.exitCode = 1;
})().catch(error => { console.error('Answer check failed:', error.code || error.name); process.exitCode = 1; });
