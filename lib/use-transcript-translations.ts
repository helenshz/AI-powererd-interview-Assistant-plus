"use client";

import { useEffect, useRef, useState } from 'react';
import type { InterviewLanguage } from './types';
import { TranscriptTranslationQueue, TranslationLanguage, TranslationState, TranscriptForTranslation } from './transcript-translation-queue';

export function useTranscriptTranslations(messages: TranscriptForTranslation[], source: InterviewLanguage, target: TranslationLanguage) {
  const [translations, setTranslations] = useState<Record<string, TranslationState>>({});
  const queue = useRef<TranscriptTranslationQueue | null>(null);
  useEffect(() => {
    const instance = new TranscriptTranslationQueue(async (text, sourceLanguage, targetLanguage, signal) => {
      const response = await fetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ text, sourceLanguage, targetLanguage }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Translation service unavailable.');
      if (typeof body?.translation !== 'string') throw new Error('Invalid translation response.');
      return body.translation;
    }, setTranslations);
    queue.current = instance;
    return () => { instance.dispose(); queue.current = null; };
  }, []);
  useEffect(() => { queue.current?.sync(messages, source, target); }, [messages, source, target]);
  return { translations, retryTranslation: (id: string) => queue.current?.retry(id) };
}
