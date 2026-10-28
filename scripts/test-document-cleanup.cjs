// Offline deletion checks. No real files, credentials, or database requests are used.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const script = fs.readFileSync('scripts/delete-pdf-document.cjs', 'utf8');
const source = script.slice(0, script.lastIndexOf('main().catch')) + 'exports.done = main();';
async function check(filename, matching = true) {
  const records = {
    a: { id: 'a', values: [0.1], metadata: { filename: matching ? filename : 'other.pdf' } },
    b: { id: 'b', values: [0.2], metadata: { filename: 'keep.pdf' } },
  };
  let backup, events = [], verificationReads = 0, deleted = [];
  const index = {
    async listPaginated() { return { vectors: [{ id: 'a' }, { id: 'b' }] }; },
    async fetch(ids) {
      const stale = deleted.length && verificationReads++ === 0;
      return { records: Object.fromEntries(ids.filter(id => records[id] && (stale || !deleted.includes(id))).map(id => [id, records[id]])) };
    },
    async deleteMany(ids) { assert.ok(backup); events.push('delete'); deleted.push(...ids); },
  };
  const scope = { exports: {}, console: { log() {}, error() {} },
    process: { argv: ['node', 'test', filename], cwd: () => process.cwd() },
    setTimeout(callback) { callback(); return 0; },
    require(name) {
      if (name === 'node:fs') return {
        readFileSync: () => Buffer.from(''), mkdirSync() {},
        writeFileSync(file, content) { events.push('backup'); backup = JSON.parse(content); },
      };
      if (name === 'dotenv') return { parse: () => ({ PINECONE_API_KEY: 'fake-key' }) };
      if (name === '@pinecone-database/pinecone') return { Pinecone: class { index() { return index; } } };
      return require(name);
    },
  };
  vm.runInNewContext(source, scope);
  if (!matching || filename.endsWith('.exe')) {
    await assert.rejects(scope.exports.done);
    assert.equal(deleted.length, 0);
  } else {
    await scope.exports.done;
    assert.equal(JSON.stringify(deleted), JSON.stringify(['a']));
    assert.equal(backup.records.length, 1);
    assert.equal(backup.filename, filename);
    assert.equal(events[0], 'backup');
    assert.ok(verificationReads >= 2);
    assert.equal(scope.process.exitCode, undefined);
  }
}
(async () => {
  for (const filename of ['notes.pdf', 'notes.md', 'notes.markdown', 'notes.txt']) await check(filename);
  await check('missing.pdf', false);
  await check('invalid.exe');
  console.log('PASS: exact-document deletion, backup before removal, other records retained, supported formats, and consistency retries');
})().catch(error => { console.error(error); process.exitCode = 1; });
