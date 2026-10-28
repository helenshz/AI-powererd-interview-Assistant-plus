// Test embeddings offline by default. --live checks credentials without uploading a PDF.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const compiled = ts.transpileModule(fs.readFileSync('lib/gemini-embeddings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

async function main() {
  const live = process.argv.includes('--live');
  const env = live ? require('dotenv').parse(fs.readFileSync('.env.local')) : { GEMINI_API_KEY: 'test-secret' };
  let fixtureStatus = 200;
  let invalidDimensions = false;
  const sandbox = { exports: {}, process: { env }, AbortSignal,
    fetch: live ? fetch : async (url, options) => {
      assert.ok(url.includes('gemini-embedding-001:embedContent'));
      assert.equal(JSON.parse(options.body).outputDimensionality, 768);
      return { ok: fixtureStatus === 200, status: fixtureStatus,
        json: async () => ({ embedding: { values: new Array(invalidDimensions ? 3072 : 768).fill(1) } }) };
    },
  };
  vm.runInNewContext(compiled, sandbox);
  const values = await sandbox.exports.generateTextEmbedding('Knowledge base connection test.');
  assert.equal(values.length, 768);
  assert.ok(Math.abs(Math.hypot(...values) - 1) < 1e-10);
  console.log('PASS: Gemini embedding model, 768 dimensions, and normalization');
  if (live) {
    if (!env.PINECONE_API_KEY) throw new Error('PINECONE_API_KEY is missing');
    const pinecone = new (require('@pinecone-database/pinecone').Pinecone)({ apiKey: env.PINECONE_API_KEY });
    const index = await pinecone.describeIndex(env.PINECONE_INDEX_NAME || 'interview-docs');
    assert.equal(index.dimension, 768, 'Pinecone index must have 768 dimensions');
    console.log('PASS: Pinecone index exists with 768 dimensions');
    if (process.argv.includes('--search-intro')) {
      const querySandbox = { exports: {} };
      vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/interview-query.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText, querySandbox);
      const helpers = querySandbox.exports;
      const vector = await sandbox.exports.generateTextEmbedding(helpers.pdfSearchQuery('Please introduce yourself.'));
      const found = await pinecone.index(env.PINECONE_INDEX_NAME || 'interview-docs').query({
        vector, topK: 20, includeMetadata: true,
      });
      const matches = found.matches || [];
      const ranked = matches.slice().sort((a, b) =>
        ((b.score || 0) + helpers.introductionRelevance(String(b.metadata?.content || ''))) -
        ((a.score || 0) + helpers.introductionRelevance(String(a.metadata?.content || ''))));
      // Report only counts, never personal document text.
      console.log(JSON.stringify({ matches: matches.length,
        introPassagesInTop4: ranked.slice(0, 4).filter(match => helpers.introductionRelevance(String(match.metadata?.content || '')) > 0).length }));
    }
  } else {
    for (const status of [400, 401, 403, 404, 429, 500]) {
      fixtureStatus = status;
      await assert.rejects(() => sandbox.exports.generateTextEmbedding('test'));
    }
    fixtureStatus = 200;
    invalidDimensions = true;
    await assert.rejects(() => sandbox.exports.generateTextEmbedding('test'));
    console.log('PASS: API failures and incompatible vectors are rejected');
  }
}
main().catch(error => {
  // Do not print upstream messages that might include credentials or request contents.
  console.error('PDF setup check failed:', error instanceof assert.AssertionError ? 'Index/vector validation failed' : error.name);
  process.exitCode = 1;
});
