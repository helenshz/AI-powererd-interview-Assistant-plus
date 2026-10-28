const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const sandbox = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/completion-stream.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, sandbox);
const { CompletionStreamParser } = sandbox.exports;
const answer = 'I collaborate by sharing progress.\n私は相談します。';
const metadata = { type: 'citations', citations: [{ filename: 'Notes.pdf', content: '日本語 / English' }], extractedQuestion: 'How do you collaborate?' };
const wire = answer + '\n\n---SOURCES---\n' + JSON.stringify(metadata) + '\n';
function check(chunks) {
  const parser = new CompletionStreamParser();
  for (const chunk of chunks) {
    const snapshot = parser.push(chunk);
    assert.ok(!snapshot.completion.includes('---SOURCES---'));
    assert.ok(!snapshot.completion.includes('"citations"'));
  }
  const result = parser.finish();
  assert.equal(result.completion, answer);
  assert.equal(JSON.stringify(result.citations), JSON.stringify(metadata.citations));
  assert.equal(result.extractedQuestion, metadata.extractedQuestion);
}
check([wire]);
check([answer, '\n\n---SOURCES---\n', JSON.stringify(metadata)]);
for (let split = 1; split < wire.length; split++) check([wire.slice(0, split), wire.slice(split)]);
check(Array.from(wire));
// Real network chunks can split a multibyte Japanese character.
const bytes = new TextEncoder().encode(wire);
const decoder = new TextDecoder();
check([...bytes].map(byte => decoder.decode(Uint8Array.of(byte), { stream: true })).concat(decoder.decode()));
for (const text of [answer, 'An answer ending in ---', '']) {
  const parser = new CompletionStreamParser();
  parser.push(text);
  assert.equal(parser.finish().completion, text);
}
console.log('PASS: no duplicated answers, all marker/JSON split positions, bytewise Japanese, citations, and plain answers');
