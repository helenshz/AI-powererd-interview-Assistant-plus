import type { InterviewLanguage } from './types';

export type TranslationLanguage = InterviewLanguage | 'off';
export interface TranscriptForTranslation { id: string; text: string; isInterim?: boolean; language?: InterviewLanguage }
export interface TranslationState { status: 'queued' | 'translating' | 'done' | 'error'; text?: string; error?: string }
type Job = { message: TranscriptForTranslation; source: InterviewLanguage; state: TranslationState; controller: AbortController };
type Translate = (text: string, source: InterviewLanguage, target: InterviewLanguage, signal: AbortSignal) => Promise<string>;

// Serial requests avoid duplicate calls on transcript polling and limit API bursts.
export class TranscriptTranslationQueue {
  private jobs = new Map<string, Job>();
  private source: InterviewLanguage = 'en';
  private target: TranslationLanguage = 'off';
  private active = false;
  private disposed = false;

  constructor(private translate: Translate, private update: (states: Record<string, TranslationState>) => void) {}

  sync(messages: TranscriptForTranslation[], source: InterviewLanguage, target: TranslationLanguage) {
    if (this.disposed) return;
    let changed = false;
    if (this.source !== source || this.target !== target) {
      this.jobs.forEach(job => job.controller.abort());
      this.jobs.clear();
      this.source = source;
      this.target = target;
      changed = true;
    }
    const eligible = target === 'off' ? [] : messages.filter(message => !message.isInterim && message.text.trim() && (message.language || source) !== target);
    const retained = new Set(eligible.map(message => message.id));
    this.jobs.forEach((job, id) => {
      if (!retained.has(id)) { job.controller.abort(); this.jobs.delete(id); changed = true; }
    });
    for (const message of eligible) {
      const job = this.jobs.get(message.id);
      const messageSource = message.language || source;
      if (job?.message.text === message.text && job.source === messageSource) continue;
      job?.controller.abort();
      this.jobs.set(message.id, { message: { ...message }, source: messageSource, state: { status: 'queued' }, controller: new AbortController() });
      changed = true;
    }
    if (changed) this.emit();
    this.pump();
  }

  retry(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.state.status !== 'error') return;
    job.state = { status: 'queued' };
    job.controller = new AbortController();
    this.emit();
    this.pump();
  }

  dispose() {
    this.disposed = true;
    this.jobs.forEach(job => job.controller.abort());
    this.jobs.clear();
  }

  private emit() {
    if (!this.disposed) this.update(Object.fromEntries(Array.from(this.jobs, ([id, job]) => [id, { ...job.state }])));
  }

  private pump() {
    if (this.active || this.disposed || this.target === 'off') return;
    const next = Array.from(this.jobs.values()).find(job => job.state.status === 'queued');
    if (!next) return;
    const source = next.source, target = this.target;
    this.active = true;
    next.state = { status: 'translating' };
    this.emit();
    void (async () => {
      try {
        const text = await this.translate(next.message.text, source, target, next.controller.signal);
        if (!text.trim()) throw new Error('The translation service returned no text.');
        if (!next.controller.signal.aborted && this.jobs.get(next.message.id) === next) next.state = { status: 'done', text };
      } catch (error) {
        if (!next.controller.signal.aborted && this.jobs.get(next.message.id) === next) {
          next.state = { status: 'error', error: error instanceof Error ? error.message : 'Translation failed.' };
        }
      } finally {
        this.active = false;
        this.emit();
        this.pump();
      }
    })();
  }
}
