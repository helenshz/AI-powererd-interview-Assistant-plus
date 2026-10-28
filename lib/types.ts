export type InterviewLanguage = "en" | "ja" | "zh-CN" | "de";
export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' }, { value: 'ja', label: 'Japanese' },
  { value: 'zh-CN', label: 'Chinese (Mandarin)' }, { value: 'de', label: 'German' },
] as const;

export enum FLAGS {
  COPILOT = "copilot",
  SUMMERIZER = "summerizer",
}

export interface HistoryData {
  createdAt: string;
  data: string;
  tag: string;
}
