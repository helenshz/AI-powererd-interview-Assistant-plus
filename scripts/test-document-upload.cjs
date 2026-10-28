const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
function load(file, imports) {
  const scope = { exports: {}, Buffer, TextDecoder, console: { log() {}, error() {} },
    process: { env: { PINECONE_API_KEY: 'test', GEMINI_API_KEY: 'test' } },
    require(name) { if (!(name in imports)) throw new Error(`Unexpected import: ${name}`); return imports[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, scope);
  return scope.exports;
}
const formats = load('lib/document-formats.ts', {});
let parsedPDFs = 0;
const text = load('lib/document-text.ts', {
  './document-formats': formats,
  './safePdfParse': { safePdfParse: async () => { parsedPDFs++; return { text: 'PDF fixture text' }; } },
});
const stored = [];
const route = load('app/api/pdf/route.ts', {
  'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
  '@pinecone-database/pinecone': { Pinecone: class { index() { return { upsert: async vectors => stored.push(...vectors) }; } } },
  '@/lib/document-text': text,
  '@/lib/gemini-embeddings': { generateTextEmbedding: async () => new Array(768).fill(0.1) },
  '@/lib/document-vector-id': { documentVectorId: (name, index) => `test-${index}` },
});
(async () => {
  const markdown = '# Introduction\n\nEnglish: Prepared answer.\n日本語: 用意した回答です。';
  for (const name of ['notes.md', 'NOTES.MARKDOWN', 'notes.txt']) {
    const file = new File([markdown], name, { type: '' });
    assert.equal(await text.extractDocumentText(file), markdown);
    const before = stored.length;
    const result = await route.POST({ formData: async () => ({ get: () => file }) });
    assert.equal(result.status, 200);
    assert.equal(stored[before].metadata.content, markdown);
    assert.equal(stored[before].metadata.filename, name);
  }
  assert.equal(parsedPDFs, 0); // Text imports must not invoke the PDF parser.
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('日本語のメモ', 'utf16le')]);
  assert.equal(await text.extractDocumentText(new File([utf16], 'notes.txt')), '日本語のメモ');
  await assert.rejects(() => text.extractDocumentText(new File([Buffer.from([0xff])], 'notes.txt')));
  await assert.rejects(() => text.extractDocumentText(new File(['binary\0data'], 'notes.md')));
  for (const file of [new File([], 'empty.txt'), new File(['x'], 'bad.exe')]) {
    const result = await route.POST({ formData: async () => ({ get: () => file }) });
    assert.equal(result.status, 400);
  }
  await assert.rejects(() => text.extractDocumentText({ name: 'large.txt', size: 11 * 1024 * 1024 }), error => error.status === 413);
  assert.equal(await text.extractDocumentText(new File(['%PDF-test'], 'notes.pdf')), 'PDF fixture text');
  assert.equal(parsedPDFs, 1);
  console.log('PASS: Markdown/TXT ingestion, Unicode, UTF-16 BOM, binary/encoding errors, input validation, and PDF dispatch');
})().catch(error => { console.error(error); process.exitCode = 1; });
