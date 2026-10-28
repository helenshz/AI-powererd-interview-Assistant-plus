const SOURCES_MARKER = '---SOURCES---';

export interface CompletionSnapshot {
  completion: string;
  citations?: unknown[];
  extractedQuestion?: string;
}

// Return snapshots, not deltas: source metadata must never re-append already rendered text.
export class CompletionStreamParser {
  private received = '';

  push(text: string): CompletionSnapshot {
    this.received += text;
    return this.snapshot(false);
  }

  finish(): CompletionSnapshot {
    return this.snapshot(true);
  }

  private snapshot(final: boolean): CompletionSnapshot {
    const markerIndex = this.received.indexOf(SOURCES_MARKER);
    if (markerIndex >= 0) {
      const snapshot: CompletionSnapshot = { completion: this.received.slice(0, markerIndex).trimEnd() };
      try {
        const metadata = JSON.parse(this.received.slice(markerIndex + SOURCES_MARKER.length).trim());
        if (metadata?.type === 'citations') {
          if (Array.isArray(metadata.citations)) snapshot.citations = metadata.citations;
          if (typeof metadata.extractedQuestion === 'string') snapshot.extractedQuestion = metadata.extractedQuestion;
        }
      } catch {
        // Keep the full metadata buffer until a subsequent chunk completes the JSON.
      }
      return snapshot;
    }
    let completion = this.received;
    if (!final) {
      // Hide a partial source marker split across transport chunks.
      for (let length = SOURCES_MARKER.length - 1; length > 0; length--) {
        if (completion.endsWith(SOURCES_MARKER.slice(0, length))) {
          completion = completion.slice(0, -length);
          break;
        }
      }
    }
    return { completion };
  }
}
