export type PromptSurface = 'voice' | 'chat' | 'cli';

export interface PromptBuildOptions {
  assistantName?: string;
  assistantDescription?: string;
  personality?: string;
  timezone?: string;
  surface?: PromptSurface;
  promptVersion?: string;
}

export interface ResolvedPromptContext {
  assistantName: string;
  assistantDescription: string;
  personality: string;
  timezone: string;
  surface: PromptSurface;
  promptVersion: string;
}
