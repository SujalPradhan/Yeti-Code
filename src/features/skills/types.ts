export interface Skill {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
}
