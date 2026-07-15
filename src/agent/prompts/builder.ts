import { loadConfig } from '../../config/index.js';
import type { ToolRegistry } from '../../tools/registry.js';
import { behaviorSection } from './behavior.js';
import { contextSection } from './context.js';
import { identitySection } from './identity.js';
import { memorySection } from './memory.js';
import { safetySection } from './safety.js';
import { teamSection } from './team.js';
import { toolsSection } from './tools.js';
import type { PromptBuildOptions, ResolvedPromptContext } from './types.js';

export const DEFAULT_PROMPT_VERSION = 'escarlata-v2';

export function resolvePromptContext(options: PromptBuildOptions = {}): ResolvedPromptContext {
  const fallback = loadConfig();
  return {
    assistantName: options.assistantName || fallback.assistantName,
    assistantDescription: options.assistantDescription || fallback.assistantDescription,
    personality: options.personality || fallback.personality,
    timezone: options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    surface: options.surface || 'chat',
    promptVersion: options.promptVersion || process.env.PROMPT_VERSION || DEFAULT_PROMPT_VERSION,
  };
}

export function buildEscarlataPrompt(registry?: ToolRegistry, options: PromptBuildOptions = {}): string {
  const context = resolvePromptContext(options);
  return [
    `<!-- prompt:${context.promptVersion} -->`,
    identitySection(context),
    contextSection(context),
    behaviorSection(),
    toolsSection(registry),
    teamSection(Boolean(registry?.get('delegate_task'))),
    memorySection(),
    safetySection(),
  ].filter(Boolean).join('\n\n');
}

export type { PromptBuildOptions, PromptSurface } from './types.js';
