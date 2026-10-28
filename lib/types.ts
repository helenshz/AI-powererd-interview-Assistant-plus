export type InterviewLanguage = "en" | "ja" | "zh-CN" | "de";

export enum FLAGS {
  COPILOT = "copilot",
  SUMMERIZER = "summerizer",
}

export interface HistoryData {
  createdAt: string;
  data: string;
  tag: string;
}
