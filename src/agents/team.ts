import { Tool, ToolRegistry } from '../tools/registry.js';
import { registerAllTools } from '../tools/index.js';
import { Agent, ConfirmationGate, SafetyRuleResolver, ToolEventCallback } from '../agent/core.js';
import { Provider, Message } from '../provider/types.js';
import { audit } from '../config/audit.js';
import { SUBAGENT_PROFILES, ESCARLATA_DIRECT_TOOLS, getProfile, buildSubagentPrompt } from './profiles.js';

export interface TeamOptions {
  /** Getter so subagents always use the CURRENT provider (model can be switched at runtime). */
  getProvider: () => Provider;
  /** Confirmation gate shared with the main agent; subagent confirmations reach the same user. */
  getConfirmationGate?: () => ConfirmationGate | null;
  /** Forwarded so the UI shows the specialist's inner tool activity. */
  onToolEvent?: ToolEventCallback | null;
  /** The same centrally configured policy used by Escarlata must govern every gem. */
  getSafetyRuleResolver?: () => SafetyRuleResolver | null;
}

function buildProfileRegistry(master: ToolRegistry, toolNames: string[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const name of toolNames) {
    const tool = master.get(name);
    if (tool) registry.register(tool);
  }
  return registry;
}

export function buildTaskEnvelope(task: string, context: string, issuedAt: Date = new Date()): string {
  const now = issuedAt.toLocaleString('es-PA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  });
  return `ENCARGO DE ESCARLATA
OBJETIVO: ${task}
CONTEXTO AUTORIZADO:
${context || 'No se proporcionó contexto adicional. Usa solo el objetivo y tus herramientas.'}
RESULTADO ESPERADO: completa exactamente el objetivo y devuelve el informe interno requerido por tu contrato.
RESTRICCIONES: no amplíes el alcance, no inventes datos y no ejecutes acciones que el objetivo no solicite.
AHORA: ${now}`;
}

async function executeProfileTask(
  master: ToolRegistry,
  opts: TeamOptions,
  profileName: string,
  task: string,
  context: string
): Promise<string> {
  const profile = getProfile(profileName);
  if (!profile) {
    return `No existe el especialista "${profileName}". Equipo: ${SUBAGENT_PROFILES.map(p => p.name).join(', ')}.`;
  }

  const subagent = new Agent({
    provider: opts.getProvider(),
    systemPrompt: buildSubagentPrompt(profile),
    toolRegistry: buildProfileRegistry(master, profile.tools),
    confirmationGate: opts.getConfirmationGate ? opts.getConfirmationGate() : null,
    onToolEvent: opts.onToolEvent ?? null,
    safetyRuleResolver: opts.getSafetyRuleResolver ? opts.getSafetyRuleResolver() : null,
    maxToolCalls: profile.maxToolCalls,
  });

  const prompt = buildTaskEnvelope(task, context);

  await audit({
    timestamp: new Date().toISOString(),
    type: 'tool_run',
    detail: `Delegación a ${profile.displayName}`,
    metadata: { agent: profile.name, promptVersion: `gemas-v2/${profile.name}`, task: task.slice(0, 200) },
  });

  let report = '';
  try {
    for await (const delta of subagent.processTurn(prompt)) {
      report += delta;
    }
  } catch (err) {
    return `${profile.displayName} no pudo completar el encargo: ${err instanceof Error ? err.message : String(err)}`;
  }

  report = report.trim();
  if (!report) return `${profile.displayName} no devolvió informe. Reintenta con un encargo más específico o resuélvelo tú.`;
  return `Informe de ${profile.displayName}:\n${report}`;
}

export function createDelegateTool(master: ToolRegistry, opts: TeamOptions): Tool {
  return {
    definition: {
      name: 'delegate_task',
      description: 'Delega un encargo a un especialista de tu equipo y devuelve su informe. El encargo debe ser autocontenido: el especialista no ve la conversación, así que incluye en task/context todos los datos que necesita (nombres, fechas, contenido).',
      parameters: [
        {
          name: 'agent',
          type: 'string',
          description: `Especialista: ${SUBAGENT_PROFILES.map(p => `${p.name} (${p.role})`).join(', ')}`,
          required: true,
          enum: SUBAGENT_PROFILES.map(p => p.name),
        },
        { name: 'task', type: 'string', description: 'El encargo, como instrucción clara y completa', required: true },
        { name: 'context', type: 'string', description: 'Contexto autorizado y autocontenido: datos relevantes de la conversación, timestamp y restricciones. Es obligatorio en la práctica cuando el encargo depende de lo dicho antes.', required: false },
      ],
      requiresConfirmation: false,
    },
    handler: async (input) => {
      const agentName = String(input.agent || '').toLowerCase().trim();
      const task = String(input.task || '').trim();
      const context = String(input.context || '').trim();
      if (!task) return 'El encargo para la gema está vacío. Define un objetivo concreto antes de delegar.';
      if (task.length > 6_000 || context.length > 12_000) {
        return 'El encargo es demasiado extenso para delegarlo de forma segura. Resúmelo y conserva solo el contexto necesario.';
      }
      const report = await executeProfileTask(master, opts, agentName, task, context);
      // Amatista produces reviewable proposals. Persisting inferred personal data
      // without a user review would bypass the memory safety policy.
      return agentName === 'amatista'
        ? `${report}\n\n[Sistema: las líneas MEMORIA son propuestas; no se guardaron automáticamente.]`
        : report;
    },
  };
}

/**
 * Build Escarlata's slim registry: her direct-use tools + delegate_task.
 * The full toolset lives in the master registry and is exposed to the
 * specialists through their filtered registries.
 */
export function createEscarlataRegistry(opts: TeamOptions): ToolRegistry {
  const master = new ToolRegistry();
  registerAllTools(master);

  const registry = new ToolRegistry();
  for (const name of ESCARLATA_DIRECT_TOOLS) {
    const tool = master.get(name);
    if (tool) registry.register(tool);
  }
  registry.register(createDelegateTool(master, opts));
  return registry;
}

/** Flatten agent history into a USUARIO/ESCARLATA transcript for analysis. */
export function historyToTranscript(history: Message[]): string {
  return history
    .map(m => {
      const text = typeof m.content === 'string'
        ? m.content
        : m.content.map(b => (b.type === 'text' && 'text' in b) ? b.text : '').filter(Boolean).join('\n');
      if (!text.trim() || m.role === 'system') return '';
      return `${m.role === 'user' ? 'USUARIO' : 'ESCARLATA'}: ${text.trim()}`;
    })
    .filter(Boolean)
    .join('\n---\n');
}

export interface Team {
  registry: ToolRegistry;
  /**
   * Fire-and-forget background run of Amatista over the current conversation.
   * Skips if a previous analysis is still running (never overlaps, never throws).
   */
  analyzeConversation(transcript: string): void;
}

/** Like createEscarlataRegistry, but also exposes background Amatista runs. */
export function createTeam(opts: TeamOptions): Team {
  const master = new ToolRegistry();
  registerAllTools(master);

  const registry = new ToolRegistry();
  for (const name of ESCARLATA_DIRECT_TOOLS) {
    const tool = master.get(name);
    if (tool) registry.register(tool);
  }
  registry.register(createDelegateTool(master, opts));

  let analyzing = false;
  return {
    registry,
    analyzeConversation(transcript: string) {
      if (analyzing || !transcript.trim()) return;
      analyzing = true;
      const context = transcript.length > 6000 ? transcript.slice(-6000) : transcript;
      // Silent background run: no UI cards for the analysis or its inner tools
      executeProfileTask(
        master,
        { ...opts, onToolEvent: null },
        'amatista',
        'Analiza la conversación actual y propón con líneas MEMORIA únicamente hechos duraderos nuevos y aprendizajes de comportamiento para Escarlata (categoría "escarlata"). No llames remember; las líneas quedarán como candidatas para revisión. Si no hay nada nuevo, no emitas líneas MEMORIA.',
        context
      )
        .then(report => audit({
          timestamp: new Date().toISOString(),
          type: 'tool_run',
          detail: 'Amatista generó candidatos de memoria para revisión',
          metadata: { candidateCount: (report.match(/^\s*MEMORIA:/gim) || []).length },
        }))
        .catch(err => {
          console.error('[amatista] background analysis failed:', err instanceof Error ? err.message : err);
        })
        .finally(() => { analyzing = false; });
    },
  };
}
