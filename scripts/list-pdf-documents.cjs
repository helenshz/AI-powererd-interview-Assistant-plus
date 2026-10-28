// Read-only inventory of the default knowledge-base namespace. Never print document text or keys.
const fs = require('node:fs');
const { Pinecone } = require('@pinecone-database/pinecone');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
async function main() {
  const index = new Pinecone({ apiKey: env.PINECONE_API_KEY }).index(env.PINECONE_INDEX_NAME || 'interview-docs');
  const files = new Map();
  let paginationToken;
  do {
    const page = await index.listPaginated({ limit: 100, ...(paginationToken ? { paginationToken } : {}) });
    const ids = (page.vectors || []).map(vector => vector.id).filter(Boolean);
    if (ids.length) {
      const fetched = await index.fetch(ids);
      for (const record of Object.values(fetched.records || {})) {
        const name = record.metadata?.filename || '(missing filename)';
        files.set(name, (files.get(name) || 0) + 1);
      }
    }
    paginationToken = page.pagination?.next;
  } while (paginationToken);
  console.log(JSON.stringify([...files].map(([filename, chunks]) => ({ filename, chunks })), null, 2));
}
main().catch(error => { console.error('Inventory failed:', error.name); process.exitCode = 1; });
