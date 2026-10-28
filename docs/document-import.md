# Import PDF, Markdown, and text notes

The **Document Knowledge Base** upload button accepts `.pdf`, `.md`, `.markdown`, and `.txt` files, up to 10 MB each. Select a file, wait for successful ingestion, then ask a question and click **Process**.

Markdown and plain text are read directly, without conversion to PDF. Markdown headings and source wording are retained. Use UTF-8; UTF-16 files with a byte-order mark are also accepted. A decoding error asks you to save the file as UTF-8. Scanned PDFs still require OCR first.

All supported formats use the same Gemini embeddings and Pinecone index, so `GEMINI_API_KEY`, `PINECONE_API_KEY`, and `PINECONE_INDEX_NAME` are still required. Source text is sent to the embedding service and stored in Pinecone; retrieved passages are sent to the configured answer model. Existing PDF uploads remain searchable without re-uploading them. Source badges distinguish PDF, Markdown, and text.

Uploads import one selected file at a time. They do not watch a local folder or automatically reread files after editing. For a full replacement, delete the prior document and upload the updated version. The selected response language prioritizes relevant original-language passages before translating another version.

Keep private notes under the ignored `personal-documents/` folder. Do not place personal Markdown/TXT files in source-code directories before committing.

Offline verification:

```powershell
node scripts/test-document-upload.cjs
```
