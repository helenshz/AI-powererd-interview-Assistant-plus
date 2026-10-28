// Delete only exact filename matches, with a local ignored backup before any remote mutation.
const fs = require('node:fs');
const path = require('node:path');
const { Pinecone } = require('@pinecone-database/pinecone');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
async function main() {
  const filename = process.argv[2];
  if (!filename || !/\.(pdf|md|markdown|txt)$/i.test(filename)) throw new Error('An exact supported document filename is required');
  const indexName = env.PINECONE_INDEX_NAME || 'interview-docs';
  const index = new Pinecone({ apiKey: env.PINECONE_API_KEY }).index(indexName);
  const records = [];
  let paginationToken;
  do {
    const page = await index.listPaginated({ limit: 100, ...(paginationToken ? { paginationToken } : {}) });
    const ids = (page.vectors || []).map(vector => vector.id).filter(Boolean);
    if (ids.length) {
      const fetched = await index.fetch(ids);
      records.push(...Object.values(fetched.records || {}).filter(record => record.metadata?.filename === filename));
    }
    paginationToken = page.pagination?.next;
  } while (paginationToken);
  if (!records.length) throw new Error('No exact filename match; nothing deleted');
  const backupDir = path.resolve('.local-data', 'pinecone-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${Date.now()}-document.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ indexName, namespace: '', filename, records }), { flag: 'wx' });
  const ids = records.map(record => record.id);
  for (let offset = 0; offset < ids.length; offset += 100) {
    await index.deleteMany(ids.slice(offset, offset + 100));
  }
  // Pinecone deletion is eventually consistent; allow a bounded verification window.
  let remaining = ids;
  for (let attempt = 0; attempt < 5 && remaining.length; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    const pending = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const fetched = await index.fetch(ids.slice(offset, offset + 100));
      pending.push(...Object.keys(fetched.records || {}));
    }
    remaining = pending;
  }
  console.log(JSON.stringify({ filename, deletedChunks: ids.length, remainingChunks: remaining.length,
    backup: path.relative(process.cwd(), backupPath) }));
  if (remaining.length) process.exitCode = 1;
}
main().catch(error => { console.error('Document cleanup failed:', error.name); process.exitCode = 1; });
