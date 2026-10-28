# Configure the answer model

The chat client supports Groq, DeepSeek, and services exposing an OpenAI-compatible `/chat/completions` endpoint with Bearer authentication and streaming text responses. Configure `.env.local` and restart the development server after changing providers. The selected provider is used for answer generation and question extraction.

## Groq (default)

Existing Groq configurations continue to work:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=openai/gpt-oss-20b
```

Change `GROQ_MODEL` to another model available to your Groq account. GPT-OSS models use low reasoning effort; unrelated model families receive no GPT-OSS-specific reasoning options.

## DeepSeek

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your-deepseek-api-key
LLM_MODEL=deepseek-flash
```

The default DeepSeek URL is `https://api.deepseek.com`. The DeepSeek preset disables thinking for direct interview answers and uses the provider's `max_tokens` parameter. Model availability and API billing depend on your account. See the [official API quickstart](https://api-docs.deepseek.com/) and [thinking-mode documentation](https://api-docs.deepseek.com/guides/thinking_mode/).

## Other compatible services

```env
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=your-provider-api-key
LLM_MODEL=your-model-id
```

Use the provider's API root, including `/v1` when required, rather than the full `/chat/completions` URL. This preset sends standard chat messages, streaming options, and `max_tokens`; model-specific thinking parameters are omitted. Compatibility still depends on the service accepting these parameters and supporting streaming text chat. Native Anthropic, Gemini, and other incompatible protocols require a separate adapter.

`LLM_MODEL`, `LLM_BASE_URL`, and `LLM_API_KEY`, when set, override the selected preset. Clear obsolete overrides when switching services. A Groq key is never used as a fallback for DeepSeek or a custom endpoint. Only configure endpoints you intend to send your transcripts and retrieved notes to.

Changing the chat provider does not replace Deepgram speech recognition or Gemini/Pinecone document indexing. Keep those keys if you use those features. Keep `.env.local` private; only `.env.example` is committed.

## Diagnose the selected configuration

`.env.local` is loaded by the local Next.js server; it does not mean the model runs locally. Restart `npm run dev` (PowerShell: `npm.cmd run dev`) after editing it. The old `MODEL=gemini-1.5-flash` field is not used to select this chat client.

```powershell
node scripts/check-model-connection.cjs
```

This reads the selected provider's model list and sends a short synthetic prompt. It prints model availability, status codes, and whether an answer was received, without printing credentials or personal documents. The short chat request uses the provider's normal API billing.

For DeepSeek, HTTP 402 means insufficient API account balance. Model listing can still succeed even when generation fails for this reason. Check the provider's billing console or explicitly switch `LLM_PROVIDER` back to `groq` if your Groq key is configured; restart the server afterwards. The application does not silently switch providers. See the [official error-code reference](https://api-docs.deepseek.com/quick_start/error_codes/).

Offline verification (no network or real credentials):

```powershell
node scripts/test-model-providers.cjs
```
