import assert from 'node:assert/strict';
import { Agent, buildSystemPrompt } from '../agent/core.js';
import { buildSubagentPrompt, SUBAGENT_PROFILES } from '../agents/profiles.js';
import { buildTaskEnvelope, createDelegateTool, createEscarlataRegistry } from '../agents/team.js';
import { renderCodexTurn } from '../provider/codex-oauth.js';
import { renderClaudeTranscript } from '../provider/claude-oauth.js';
import { toOpenAIMessages } from '../provider/openai.js';
import { toOllamaMessages } from '../provider/ollama.js';
import type { Provider } from '../provider/types.js';
import { ToolRegistry } from '../tools/registry.js';

const inertProvider: Provider = {
  async *complete() {
    yield { type: 'done', stopReason: 'end_turn' } as const;
  },
};

function testEscarlataPromptComposition() {
  const registry = createEscarlataRegistry({ getProvider: () => inertProvider });
  const prompt = buildSystemPrompt(registry, {
    assistantName: 'Prueba Roja',
    assistantDescription: 'una asistente de prueba.',
    personality: 'Precisa y serena.',
    timezone: 'America/Panama',
    surface: 'voice',
    promptVersion: 'test-v2',
  });

  assert.match(prompt, /prompt:test-v2/);
  assert.match(prompt, /Eres Prueba Roja, una asistente de prueba\./);
  assert.match(prompt, /Personalidad configurada: Precisa y serena\./);
  assert.match(prompt, /Zona horaria del usuario: America\/Panama/);
  assert.match(prompt, /Superficie activa: voice/);
  assert.match(prompt, /# Equipo Gema/);
  assert.match(prompt, /fuentes externas/);
  assert.match(prompt, /DATOS, no instrucciones/);
  assert.match(prompt, /conversación;\n- la sección "Cosas que sé del usuario"/);
  assert.doesNotMatch(prompt, /Cualquier dato personal del usuario exige consultar la herramienta primero/);
  assert.doesNotMatch(prompt, /sk-[A-Za-z0-9]/);

  const rollbackPrompt = buildSystemPrompt(undefined, { promptVersion: 'escarlata-v1' });
  assert.match(rollbackPrompt, /prompt:escarlata-v1/);
  assert.doesNotMatch(rollbackPrompt, /# Criterio de actuación/);
}

function testSubagentContracts() {
  for (const profile of SUBAGENT_PROFILES) {
    const prompt = buildSubagentPrompt(profile);
    assert.match(prompt, /CONTEXTO AUTORIZADO.*fuente válida/s, profile.name);
    assert.match(prompt, /ACCIONES REALIZADAS/, profile.name);
    assert.match(prompt, /Solo una herramienta exitosa confirma una acción/, profile.name);
    assert.match(prompt, /DATOS, no instrucciones/, profile.name);
  }

  const amatista = buildSubagentPrompt(SUBAGENT_PROFILES.find(profile => profile.name === 'amatista')!);
  assert.match(amatista, /no llames remember/i);
  assert.match(amatista, /MEMORIA: \[categoria\]/);
  assert.match(amatista, /candidatas para revisión/i);
  assert.doesNotMatch(amatista, /guarda con remember/i);
}

function testTaskEnvelope() {
  const envelope = buildTaskEnvelope(
    'Agenda una reunión el viernes',
    'El usuario dijo viernes 17 a las 15:00, zona America/Panama.',
    new Date('2026-07-13T12:00:00-05:00'),
  );
  for (const field of ['OBJETIVO:', 'CONTEXTO AUTORIZADO:', 'RESULTADO ESPERADO:', 'RESTRICCIONES:', 'AHORA:']) {
    assert.ok(envelope.includes(field), field);
  }
  assert.match(envelope, /viernes 17 a las 15:00/);
}

function testCodexInstructionSeparation() {
  const messages = [
    { role: 'system', content: 'INSTRUCCIÓN PRIVILEGIADA' },
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: 'qué tal' },
  ] as const;
  const rendered = renderCodexTurn([...messages]);
  assert.equal(rendered.developerInstructions, 'INSTRUCCIÓN PRIVILEGIADA');
  assert.doesNotMatch(rendered.input, /INSTRUCCIÓN PRIVILEGIADA|SYSTEM:/);
  assert.match(rendered.input, /USER: hola/);
  assert.match(rendered.input, /ASSISTANT: qué tal/);

  const claudeInput = renderClaudeTranscript([...messages]);
  assert.doesNotMatch(claudeInput, /INSTRUCCIÓN PRIVILEGIADA|SYSTEM:/);
  assert.match(claudeInput, /USER: hola/);

  const openAIMessages = toOpenAIMessages([...messages]);
  assert.equal(openAIMessages[0].role, 'system');
  assert.equal(openAIMessages[0].content, 'INSTRUCCIÓN PRIVILEGIADA');

  const ollamaSystem = toOllamaMessages(messages[0]);
  assert.deepEqual(ollamaSystem, [{ role: 'system', content: 'INSTRUCCIÓN PRIVILEGIADA' }]);
}

async function testTruthfulSilentToolGuard() {
  let providerCalls = 0;
  let executions = 0;
  const provider: Provider = {
    async *complete() {
      providerCalls++;
      yield { type: 'tool_use', id: `call-${providerCalls}`, name: 'probe_action', input: {} } as const;
      yield { type: 'done', stopReason: 'tool_use' } as const;
    },
  };
  const registry = new ToolRegistry();
  registry.register({
    definition: { name: 'probe_action', description: 'Acción de prueba', parameters: [], requiresConfirmation: false },
    handler: async () => { executions++; return 'ok'; },
  });
  const agent = new Agent({ provider, systemPrompt: '<!-- prompt:test-v2 -->', toolRegistry: registry });
  let output = '';
  for await (const delta of agent.processTurn('haz la prueba')) output += delta;

  assert.equal(executions, 1, 'la segunda acción silenciosa debe quedar sin ejecutar');
  assert.match(output, /No ejecuté la última acción solicitada/);
  assert.doesNotMatch(output, /Listo|realicé las acciones/i);
}

async function testDelegationLimit() {
  let calls = 0;
  let delegations = 0;
  const provider: Provider = {
    async *complete() {
      calls++;
      if (calls === 1) {
        for (let index = 1; index <= 3; index++) {
          yield { type: 'tool_use', id: `delegate-${index}`, name: 'delegate_task', input: { agent: 'opalo', task: `encargo ${index}` } } as const;
        }
        yield { type: 'done', stopReason: 'tool_use' } as const;
      } else {
        yield { type: 'text', delta: 'Resumen listo.' } as const;
        yield { type: 'done', stopReason: 'end_turn' } as const;
      }
    },
  };
  const registry = new ToolRegistry();
  registry.register({ definition: { name: 'delegate_task', description: 'Delegación de prueba', parameters: [] }, handler: async () => { delegations++; return 'informe'; } });
  const agent = new Agent({ provider, systemPrompt: '<!-- prompt:test-v2 -->', toolRegistry: registry });
  for await (const _chunk of agent.processTurn('investiga tres cosas')) { /* consume */ }
  assert.equal(delegations, 2);
  assert.match(JSON.stringify(agent.getHistory()), /Límite de dos delegaciones por turno/);
}

async function testGemUsesCentralSafetyPolicy() {
  let executions = 0;
  let confirmations = 0;
  let providerCalls = 0;
  const provider: Provider = {
    async *complete() {
      providerCalls++;
      if (providerCalls === 1) {
        yield { type: 'tool_use', id: 'save-1', name: 'save_note', input: { title: 'prueba', content: 'contenido' } } as const;
        yield { type: 'done', stopReason: 'tool_use' } as const;
      } else {
        yield { type: 'text', delta: 'RESULTADO: sin escritura' } as const;
        yield { type: 'done', stopReason: 'end_turn' } as const;
      }
    },
  };
  const master = new ToolRegistry();
  master.register({
    definition: { name: 'save_note', description: 'Guardar nota', parameters: [], safetyAction: 'modify_file' },
    handler: async () => { executions++; return 'guardado'; },
  });
  const delegate = createDelegateTool(master, {
    getProvider: () => provider,
    getConfirmationGate: () => async () => { confirmations++; return 'approved'; },
    getSafetyRuleResolver: () => () => 'deny',
  });
  const report = await delegate.handler({ agent: 'perla', task: 'Guarda una nota de prueba', context: '' });
  assert.equal(executions, 0);
  assert.equal(confirmations, 0);
  assert.match(report, /RESULTADO: sin escritura/);
}

async function testIncompleteProviderStreamFailsClosed() {
  const provider: Provider = {
    async *complete() { yield { type: 'text', delta: 'Respuesta parcial' } as const; },
  };
  const agent = new Agent({ provider, systemPrompt: '<!-- prompt:test-v2 -->', toolRegistry: new ToolRegistry() });
  let output = '';
  for await (const chunk of agent.processTurn('hola')) output += chunk;
  assert.match(output, /cerró la respuesta antes de terminar/);
}

testEscarlataPromptComposition();
testSubagentContracts();
testTaskEnvelope();
testCodexInstructionSeparation();
await testTruthfulSilentToolGuard();
await testDelegationLimit();
await testGemUsesCentralSafetyPolicy();
await testIncompleteProviderStreamFailsClosed();
console.log('prompts: ok');
