export interface STTProvider {
  transcribe(audioBuffer: Buffer, mimeType: string): AsyncIterable<string>;
}

export interface STTConfig {
  apiKey?: string;
  baseUrl?: string;
  language?: string;
}

export function createSTTProvider(type: 'deepgram' | 'whisper', config: STTConfig = {}): STTProvider {
  switch (type) {
    case 'deepgram':
      return new DeepgramSTTProvider(config);
    case 'whisper':
      return new WhisperLocalSTTProvider(config);
    default:
      throw new Error(`Unknown STT provider: ${type}`);
  }
}

/**
 * Local whisper.cpp server (https://github.com/ggml-org/whisper.cpp).
 * Expects the server running with e.g.:
 *   whisper-server.exe -m ggml-small.bin --port 8080 -l es
 * Audio must be WAV 16kHz mono (use convertToWav16k from audio.ts first).
 */
class WhisperLocalSTTProvider implements STTProvider {
  private baseUrl: string;
  private language: string;

  constructor(config: STTConfig) {
    this.baseUrl = (config.baseUrl || process.env.WHISPER_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
    this.language = config.language || process.env.WHISPER_LANGUAGE || 'es';
  }

  async *transcribe(audioBuffer: Buffer, mimeType: string): AsyncIterable<string> {
    // Build multipart body by hand (Node's global FormData typings are unreliable here)
    const boundary = `----escarlata${Date.now().toString(16)}`;
    const parts: Buffer[] = [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: ${mimeType || 'audio/wav'}\r\n\r\n`
      ),
      audioBuffer,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${this.language}`),
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson`),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    const body = Buffer.concat(parts);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/inference`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        // Copia a Uint8Array<ArrayBuffer>: BodyInit no acepta Buffer bajo lib DOM
        body: new Uint8Array(body),
      });
    } catch (err) {
      throw new Error(
        `No se pudo conectar con whisper-server en ${this.baseUrl}. ` +
        `¿Está corriendo? (npm run whisper)`
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Whisper STT error (${response.status}): ${errText}`);
    }

    const data = await response.json() as { text?: string };
    const transcript = (data.text || '').trim();
    if (!transcript) {
      throw new Error('Whisper devolvió una transcripción vacía');
    }
    yield transcript;
  }
}

class DeepgramSTTProvider implements STTProvider {
  private apiKey: string;

  constructor(config: STTConfig) {
    this.apiKey = config.apiKey || '';
  }

  async *transcribe(audioBuffer: Buffer, mimeType: string): AsyncIterable<string> {
    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': mimeType,
      },
      body: new Uint8Array(audioBuffer),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Deepgram STT error (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

    if (!transcript) {
      throw new Error('Deepgram returned empty transcript');
    }

    // Yield the full transcript (Deepgram streams per-utterance, but for push-to-talk we send the whole file)
    yield transcript;
  }
}