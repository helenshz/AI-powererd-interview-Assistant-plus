import { createHash } from "node:crypto";

// Preserve existing ASCII IDs; hash Unicode names without losing the display filename in metadata.
export function documentVectorId(filename: string, chunkIndex: number): string {
  const documentId = /^[\x20-\x7E]+$/.test(filename) && filename.length <= 400
    ? filename
    : `pdf-${createHash("sha256").update(filename, "utf8").digest("hex")}`;
  return `${documentId}-chunk-${chunkIndex}`;
}
