export const DOCUMENT_EXTENSIONS = ['pdf', 'md', 'markdown', 'txt'] as const;

export function documentExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

export function isSupportedDocument(filename: string): boolean {
  return DOCUMENT_EXTENSIONS.some(extension => extension === documentExtension(filename));
}
