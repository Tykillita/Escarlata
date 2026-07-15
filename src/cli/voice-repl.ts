import 'dotenv/config';
import * as readline from 'readline';
import { Agent, buildSystemPrompt } from '../agent/core.js';
import { createProvider } from '../provider/provider.js';
import { createEscarlataRegistry } from '../agents/team.js';
import { createSTTProvider, createTTSProvider, captureAudio, playAudio, hasAudioCapture } from '../voice/index.js';
import { getConfigManager } from '../config/manager.js';

const MODE_TEXT = 'text';
const MODE_VOICE = 'voice';

async function main() {
  const mode = process.argv.includes('--voice') ? MODE_VOICE : MODE_TEXT;

  console.log(`🎙️  Escarlata — Tier 3: ${mode === MODE_VOICE ? 'Voice +' : ''} Text Interface`);
  console.log(`Type "exit" to quit. Type "mode" to toggle voice. Type "help" for commands.\n`);

  const provider = createProvider({
    model: process.env.MODEL_NAME || 'mock',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.OLLAMA_BASE_URL,
  });

  const configMgr = getConfigManager();
  await configMgr.load();

  const registry = createEscarlataRegistry({
    getProvider: () => agent.getProvider(),
    getSafetyRuleResolver: () => action => configMgr.getRule(action),
  });

  const agent = new Agent({
    provider,
    systemPrompt: buildSystemPrompt(registry, {
      assistantName: configMgr.get().assistantName,
      assistantDescription: configMgr.get().assistantDescription,
      personality: configMgr.get().personality,
      surface: mode === MODE_VOICE ? 'voice' : 'cli',
    }),
    toolRegistry: registry,
  });
  await agent.init();

  console.log(`Tools: ${registry.getDefinitions().length} registered`);
  const voiceAvailable = hasAudioCapture();
  if (voiceAvailable) {
    console.log('Voice: available (hold SPACE to record, release to send)');
  }

  const stt = process.env.DEEPGRAM_API_KEY
    ? createSTTProvider('deepgram', { apiKey: process.env.DEEPGRAM_API_KEY })
    : null;

  const tts = process.env.ELEVENLABS_API_KEY
    ? createTTSProvider('elevenlabs', {
        apiKey: process.env.ELEVENLABS_API_KEY,
        voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
      })
    : null;

  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  let currentMode = mode;

  rl.on('line', async (input: string) => {
    const trimmed = input.trim().toLowerCase();

    if (['exit', 'quit'].includes(trimmed)) {
      console.log('\n👋 Goodbye!');
      rl.close();
      process.exit(0);
    }

    if (trimmed === 'mode') {
      currentMode = currentMode === MODE_TEXT ? MODE_VOICE : MODE_TEXT;
      console.log(`\n📢 Switched to ${currentMode} mode.\n`);
      rl.prompt();
      return;
    }

    if (trimmed === 'help') {
      console.log(`
Commands:
  exit/quit  — Exit Escarlata
  mode       — Toggle voice/text mode
  help       — Show this help

In voice mode, type 'r' or press SPACE to start recording.
In text mode, just type your message and press Enter.
`);
      rl.prompt();
      return;
    }

    try {
      // In voice mode, 'r' triggers recording
      if (currentMode === MODE_VOICE && voiceAvailable && trimmed === 'r') {
        await handleVoiceInput(agent, stt, tts, rl);
        rl.prompt();
        return;
      }

      // Normal text input
      process.stdout.write('Escarlata: ');
      for await (const chunk of agent.processTurn(trimmed)) {
        process.stdout.write(chunk);
      }
      console.log('\n');
    } catch (err) {
      console.error('\n❌ Error:', err instanceof Error ? err.message : err);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n👋 Goodbye!');
    process.exit(0);
  });
}

async function handleVoiceInput(
  agent: Agent,
  stt: any,
  tts: any,
  rl: readline.Interface
) {
  try {
    console.log('\n🔴 Recording... (press Ctrl+C to stop, max 30s)');
    const audioBuffer = await captureAudio({ maxSeconds: 30 });

    if (!audioBuffer || audioBuffer.length === 0) {
      console.log('⚠️  No audio captured.');
      return;
    }

    console.log('📝 Transcribing...');
    let transcript = '';
    if (stt) {
      for await (const text of stt.transcribe(audioBuffer, 'audio/wav')) {
        transcript += text;
      }
    } else {
      // No STT configured - use filename as fallback
      transcript = `[audio captured, ${(audioBuffer.length / 1024).toFixed(0)}KB]`;
    }

    console.log(`You: ${transcript}`);

    // Run the brain
    console.log('Escarlata: ');
    let reply = '';
    for await (const chunk of agent.processTurn(transcript)) {
      process.stdout.write(chunk);
      reply += chunk;
    }
    console.log('');

    // Speak the reply if TTS is available
    if (tts && reply) {
      console.log('🔊 Speaking...');
      const audioChunks: Buffer[] = [];
      for await (const chunk of tts.synthesize(reply)) {
        audioChunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(audioChunks);
      await playAudio(audioBuffer);
    }
  } catch (err) {
    console.error('\n❌ Voice error:', err instanceof Error ? err.message : err);
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
