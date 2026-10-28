import { documentExtension, isSupportedDocument } from './document-formats';
export { documentExtension, isSupportedDocument } from './document-formats';

export class DocumentInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function extractDocumentText(file: File): Promise<string> {
  if (!isSupportedDocument(file.name)) throw new DocumentInputError('Supported files: PDF, Markdown (.md/.markdown), and TXT.');
  if (!file.size) throw new DocumentInputError('The document is empty.');
  if (file.size > 10 * 1024 * 1024) throw new DocumentInputError('Document exceeds the 10 MB limit.', 413);
  const buffer = Buffer.from(await file.arrayBuffer());
  let text: string;
  if (documentExtension(file.name) === 'pdf') {
    const { safePdfParse } = await import('./safePdfParse');
    const parsed = await safePdfParse(buffer);
    text = parsed.text || '';
  } else {
    const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le'
      : buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be' : 'utf-8';
    try {
      text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      throw new DocumentInputError('Text decoding failed. Save the file as UTF-8 and upload it again.');
    }
    if (text.includes('\0')) throw new DocumentInputError('This file contains binary data rather than plain text.');
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new DocumentInputError('No text found. Scanned PDFs require OCR before uploading.');
  return text;
}
