// Offline regression checks: no credentials, external requests, or personal documents.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
function load(file, dependencies = {}) {
  const sandbox = { exports: {}, console: { log() {}, warn() {}, error() {} },
    process: { env: { PINECONE_API_KEY: 'test', GEMINI_API_KEY: 'test' } },
    Response, TextEncoder, ReadableStream,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected import ${name} in ${file}`);
      return dependencies[name];
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, sandbox);
  return sandbox.exports;
}
const query = load('lib/interview-query.ts');
const sourceLanguage = load('lib/pdf-source-language.ts');
const local = load('lib/agents/localQuestionExtractor.ts', { '../interview-query': query });
const utils = load('lib/utils.ts', { clsx: { clsx() {} }, 'tailwind-merge': { twMerge() {} } });
let extractionCalls = 0;
let webCalls = 0;
let searchedQuery;
let searchFixtures;
const intro = 'Self introduction 自我介绍: My name is TEST_CANDIDATE. ' + 'Prepared background details. '.repeat(35);
const rag = load('lib/agents/ragOrchestrator.ts', {
  './questionExtractor': { extractQuestionFromTranscript: async () => { extractionCalls++; return null; } },
  './localQuestionExtractor': local,
  '../interview-query': query,
  '../pdf-source-language': sourceLanguage,
  './pineconeService': { pineconeService: { searchSimilarContent: async search => {
    searchedQuery = search;
    return searchFixtures || [
      { content: 'Robot controller unrelated passage', score: 0.65, source: 'Other.pdf', metadata: {} },
      { content: intro, score: 0.6, source: 'Notes.pdf', metadata: { filename: 'Notes.pdf' } },
    ];
  } } },
  './simpleWebSearchAgent': { webSearchAgent: { searchWeb: async () => { webCalls++; return { results: [] }; } } },
  '@google/generative-ai': { GoogleGenerativeAI: class {} },
});

(async () => {
  const result = await rag.ragOrchestrator.processTranscript('okay hear briefly introduce');
  assert.ok(searchedQuery.includes('自我介绍'));
  assert.ok(result.extractedQuestion);
  assert.equal(extractionCalls, 0);
  assert.equal(webCalls, 0);
  assert.equal(result.context.citations[0].filename, 'Notes.pdf');
  assert.equal(result.context.citations[0].score, 0.6); // Do not fabricate similarity scores.
  assert.ok(result.context.combinedContext.includes(intro)); // No 500-character truncation.

  const fallback = await rag.ragOrchestrator.processTranscript('discuss synchronization primitives');
  assert.ok(fallback.extractedQuestion); // Extraction returning null must not discard retrieval.
  let submittedPrompt;
  const route = load('app/api/completion/route.ts', {
    '@/lib/gemini': {},
    '@/lib/groq': { GROQ_MODEL: 'test', streamGroq: async prompt => {
      submittedPrompt = prompt;
      return (async function* () { yield 'A grounded answer.'; })();
    }, default: { chat: { completions: { create: async options => {
      if (!options.stream) return { choices: [{ message: { content: 'KNOWN: generic answer' } }] };
      submittedPrompt = options.messages[0].content;
      return (async function* () { yield { choices: [{ delta: { content: 'A grounded answer.' } }] }; })();
    } } } } },
    '@/lib/groq-errors': { groqErrorResponse() { throw new Error('Unexpected model error'); } },
    '@/lib/types': { FLAGS: { COPILOT: 'copilot', SUMMERIZER: 'summerizer' } },
    '@/lib/utils': utils,
    '@/lib/agents/ragOrchestrator': { ragOrchestrator: { processTranscript: async () => ({
      extractedQuestion: null, searchPerformed: true, context: result.context,
    }) } },
  });
  const response = await route.POST({ json: async () => ({ flag: 'copilot', prompt: 'Please introduce yourself.' }) });
  const body = await response.text();
  assert.ok(submittedPrompt.includes('TEST_CANDIDATE'));
  assert.ok(submittedPrompt.includes('never output placeholders') || submittedPrompt.includes('Do not invent personal facts'));
  assert.ok(body.includes('---SOURCES---'));
  for (const [language, name] of [['en', 'English'], ['ja', 'Japanese'], ['zh-CN', 'Simplified Chinese'], ['de', 'German']]) {
    for (const flag of ['copilot', 'summerizer']) {
      const localized = await route.POST({ json: async () => ({ flag, responseLanguage: language, prompt: '応募理由を教えてください。' }) });
      await localized.text();
      assert.ok(submittedPrompt.includes(`REQUIRED RESPONSE LANGUAGE: ${name}`));
      assert.ok(submittedPrompt.includes('without added kana readings'));
    }
  }
  const noWeb = load('lib/agents/simpleWebSearchAgent.ts');
  assert.equal((await noWeb.webSearchAgent.searchWeb('test')).results.length, 0);
  const englishOriginal = 'I applied for this position because I want to build reliable robot systems with the team.';
  const japaneseOriginal = 'このポジションに応募した理由は、チームと一緒にロボットの開発に取り組みたいからです。';
  const mixed = `日本語\n${japaneseOriginal}\nEnglish\n${englishOriginal}\n中文\n我希望参与机器人开发，并运用自己的开发和测试经验。`;
  assert.equal(sourceLanguage.preferOriginalPassage(mixed, 'en').content, englishOriginal);
  assert.equal(sourceLanguage.preferOriginalPassage(mixed, 'ja').content, japaneseOriginal);
  assert.equal(sourceLanguage.preferOriginalPassage(japaneseOriginal, 'en').matched, false);
  assert.equal(sourceLanguage.preferOriginalPassage(mixed, 'zh-CN').matched, true);
  searchFixtures = [
    { content: japaneseOriginal, score: 0.73, source: 'Notes.pdf', metadata: {} },
    { content: mixed, score: 0.70, source: 'Notes.pdf', metadata: {} },
    { content: 'An unrelated English passage about cooking and gardening at home.', score: 0.3, source: 'Other.pdf', metadata: {} },
  ];
  const native = await rag.ragOrchestrator.processTranscript('Why did you apply for this position?', '', 'en');
  assert.equal(native.context.pdfResults[0].content, englishOriginal);
  assert.equal(native.context.pdfResults[0].score, 0.70);
  assert.equal(native.context.pdfResults[0].metadata.sourceLanguage, 'en');
  assert.ok(native.context.combinedContext.includes('[Original source language: en]'));
  assert.ok(utils.buildRAGPrompt('', 'test', 'test', mixed, 'en').includes('ORIGINAL-LANGUAGE SOURCE PRIORITY'));
  console.log('PASS: self-introduction query, reranking, full context, extraction fallback, grounded model prompt, citations, and no fake web results');
})().catch(error => { console.error(error); process.exitCode = 1; });
