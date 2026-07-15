import { Readable } from 'stream';

export interface TTSProvider {
  synthesize(text: string): AsyncIterable<Buffer>;
}

export interface TTSConfig {
  apiKey: string;
  voiceId: string;
}

export function createTTSProvider(type: 'elevenlabs', config: TTSConfig): TTSProvider {
  switch (type) {
    case 'elevenlabs':
      return new ElevenLabsTTSProvider(config);
    default:
      throw new Error(`Unknown TTS provider: ${type}`);
  }
}

class ElevenLabsTTSProvider implements TTSProvider {
  private apiKey: string;
  private voiceId: string;

  constructor(config: TTSConfig) {
    this.apiKey = config.apiKey;
    this.voiceId = config.voiceId;
  }

  async *synthesize(text: string): AsyncIterable<Buffer> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: 1.0,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs TTS error (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error('ElevenLabs returned empty response body');
    }

    // Stream the audio chunks as they arrive
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        yield chunk;
      }
    }
  }
}