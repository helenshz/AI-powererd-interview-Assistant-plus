// Offline checks: no real keys, network calls, or billable API requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync('app/api/deepgram/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

async function check({ key = 'server-secret', projects, projectError, keyError, throws = false } = {}) {
  const calls = [];
  const sandbox = {
    exports: {},
    process: { env: { DEEPGRAM_API_KEY: key } },
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, ...options }) } };
      if (name === '@deepgram/sdk') return {
        createClient(receivedKey) {
          assert.equal(receivedKey, 'server-secret');
          calls.push('client');
          return { manage: {
            async getProjects() {
              if (throws) throw new Error('Network unavailable');
              return { result: { projects: projects ?? [{ project_id: 'test-project' }] }, error: projectError };
            },
            async createProjectKey(projectId, options) {
              assert.equal(projectId, 'test-project');
              assert.equal(options.time_to_live_in_seconds, 60);
              assert.deepEqual(Array.from(options.scopes), ['usage:write']);
              return { result: { key: 'temporary-key', privateMetadata: 'not-for-client' }, error: keyError };
            },
          } };
        },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  vm.runInNewContext(compiled, sandbox);
  const result = await sandbox.exports.GET();
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.ok(!JSON.stringify(result).includes('server-secret'));
  assert.ok(!JSON.stringify(result).includes('privateMetadata'));
  return { result, calls };
}

(async () => {
  const success = await check();
  assert.equal(success.result.body.key, 'temporary-key');
  for (const key of ['', null, 'your-deepgram-api-key']) {
    const missing = await check({ key });
    assert.equal(missing.result.status, 503);
    assert.equal(missing.calls.length, 0);
  }
  for (const fixture of [{ projectError: true }, { projects: [] }, { keyError: true }, { throws: true }]) {
    const { result } = await check(fixture);
    assert.equal(result.status, 502);
    assert.equal(typeof result.body.error, 'string');
    assert.ok(!result.body.key);
  }
  console.log('PASS: temporary key response, missing configuration, permissions, empty projects, network errors, no-store, and secret isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
