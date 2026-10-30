import type { RuleCommand, RuleInput } from "./rules";
export interface SavedRuleSummary {
  hash: string;
  name: string;
  description: string;
  author: string;
  savedAt: string;
}
export interface RulePreview {
  hash: string;
  name: string;
  author: string;
  samples: { input: RuleInput; commands: RuleCommand[] }[];
}
