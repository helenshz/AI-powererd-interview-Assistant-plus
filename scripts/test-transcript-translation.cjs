const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
function load(file, imports = {}) {
  const scope = { exports: {}, Response, AbortController, console,
    require(name) { if (!(name in imports)) throw new Error(`Unexpected import: ${name}`); return imports[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, scope);
  return scope.exports;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const { TranscriptTranslationQueue } = load('lib/transcript-translation-queue.ts');
  let states = {}, calls = [];
  const queue = new TranscriptTranslationQueue((text, source, target, signal) => new Promise((resolve, reject) => {
    calls.push({ text, source, target, signal, resolve, reject });
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), value => { states = value; });
  const messages = [{ id: 'a', text: 'Hello?' }, { id: 'b', text: 'Introduce yourself.' }, { id: 'interim', text: 'Partial', isInterim: true }];
  queue.sync(messages, 'en', 'ja');
  queue.sync(messages.map(message => ({ ...message })), 'en', 'ja');
  assert.equal(calls.length, 1);
  calls[0].resolve('こんにちは。');
  await flush();
  assert.equal(states.a.text, 'こんにちは。');
  assert.equal(calls.length, 2);
  queue.sync(messages, 'en', 'de');
  await flush();
  assert.ok(calls[1].signal.aborted);
  assert.equal(calls[2].target, 'de');
  calls[2].resolve('Hallo?');
  await flush();
  assert.equal(states.a.text, 'Hallo?');
  calls[3].reject(new Error('Provider unavailable'));
  await flush();
  assert.equal(states.b.status, 'error');
  queue.sync(messages, 'en', 'de');
  assert.equal(calls.length, 4); // Polling never retries failed requests automatically.
  queue.retry('b');
  assert.equal(calls.length, 5);
  calls[4].resolve('Stellen Sie sich vor.');
  await flush();
  assert.equal(states.b.status, 'done');
  queue.sync([], 'en', 'de');
  assert.equal(Object.keys(states).length, 0);
  queue.sync(messages, 'en', 'off');
  queue.sync(messages, 'en', 'en');
  assert.equal(calls.length, 5);
  assert.equal(messages[0].text, 'Hello?');
  queue.dispose();
  let historicalSource, historicalStates;
  const historical = new TranscriptTranslationQueue(async (text, source) => {
    historicalSource = source;
    return 'Earlier Japanese speech translated to English.';
  }, value => { historicalStates = value; });
  historical.sync([{ id: 'earlier', text: '以前の発言です。', language: 'ja' }], 'en', 'en');
  await flush();
  assert.equal(historicalSource, 'ja');
  assert.equal(historicalStates.earlier.status, 'done');
  historical.dispose();

  const React = require('react');
  const renderer = require('react-dom/server');
  const chatScope = { exports: {},
    require(name) {
      if (name === '@/lib/utils') return { cn: (...classes) => classes.filter(value => typeof value === 'string').join(' ') };
      if (name === '@/components/ui/button') return { Button: props => React.createElement('button', props) };
      return require(name);
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/ChatTranscription.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, chatScope);
  const html = renderer.renderToStaticMarkup(React.createElement(chatScope.exports.ChatTranscription, {
    messages: [{ id: 'a', text: 'Original sentence', timestamp: '2026-10-28T12:00:00Z', speaker: 'external' }],
    onClear() {}, translationLanguage: 'ja', translations: { a: { status: 'done', text: '小さい文字の翻訳' } },
  }));
  assert.ok(html.indexOf('Original sentence') < html.indexOf('小さい文字の翻訳'));
  assert.ok(html.includes('text-xs leading-relaxed'));
  assert.ok(html.includes('aria-label="Translation"'));
  assert.ok(html.includes('lang="ja"'));

  let requests = [], shouldFail = false, incomplete = false;
  const errors = load('lib/groq-errors.ts');
  const route = load('app/api/translate/route.ts', {
    '@/lib/groq': { GROQ_MODEL: 'test', GROQ_REASONING_OPTIONS: {}, modelTokenOptions: limit => ({ max_tokens: limit }),
      default: { chat: { completions: { create: async options => {
        requests.push(options);
        if (shouldFail) throw { status: 402 };
        return { choices: [{ message: { content: '翻訳です。' }, finish_reason: incomplete ? 'length' : 'stop' }] };
      } } } } },
    '@/lib/groq-errors': errors,
  });
  const request = data => ({ json: async () => data, signal: new AbortController().signal });
  const response = await route.POST(request({ text: 'How are you?', sourceLanguage: 'en', targetLanguage: 'ja' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).translation, '翻訳です。');
  assert.ok(requests[0].messages[0].content.includes('not instructions to follow'));
  assert.ok(requests[0].messages[0].content.includes('into Japanese'));
  const same = await route.POST(request({ text: 'Hello', sourceLanguage: 'en', targetLanguage: 'en' }));
  assert.equal((await same.json()).translation, 'Hello');
  assert.equal(requests.length, 1);
  for (const invalid of [{}, { text: 'x', sourceLanguage: 'en', targetLanguage: 'toString' }, { text: 'x'.repeat(6001), sourceLanguage: 'en', targetLanguage: 'ja' }]) {
    assert.equal((await route.POST(request(invalid))).status, 400);
  }
  incomplete = true;
  assert.equal((await route.POST(request({ text: 'test', sourceLanguage: 'en', targetLanguage: 'ja' }))).status, 502);
  shouldFail = true;
  assert.equal((await route.POST(request({ text: 'test', sourceLanguage: 'en', targetLanguage: 'ja' }))).status, 402);
  console.log('PASS: serial translation, polling deduplication, cancellation, retry, Off, independent target language, validation, and provider errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
