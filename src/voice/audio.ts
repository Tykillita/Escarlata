import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), 'escarlata-audio');

async function ensureTempDir() {
  await fs.promises.mkdir(TEMP_DIR, { recursive: true });
}

// Check if a command is available
function commandExists(cmd: string): boolean {
  try {
    execSync(`where ${cmd} 2>nul || which ${cmd} 2>/dev/null`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture audio from the default microphone.
 * Returns a WAV buffer.
 * Duration: maxSeconds (default 30), or stopImmediate for push-to-talk mode
 */
export async function captureAudio(options: {
  maxSeconds?: number;
  onStart?: () => void;
  onData?: (chunk: Buffer) => void;
} = {}): Promise<Buffer> {
  await ensureTempDir();
  const maxSec = options.maxSeconds || 30;
  const outputFile = path.join(TEMP_DIR, `capture-${Date.now()}.wav`);

  // Try sox first (cross-platform)
  if (commandExists('sox') || commandExists('rec')) {
    const recCmd = commandExists('sox') ? 'sox' : 'rec';
    const args = [
      '-d',                    // default device
      '--rate', '16000',       // 16kHz (good for STT)
      '--channels', '1',       // mono
      '--encoding', 'signed-integer',
      '--bits', '16',
      outputFile,
      'trim', '0', String(maxSec),
    ];

    options.onStart?.();
    execSync(`"${recCmd}" ${args.join(' ')}`, {
      stdio: 'inherit',
      timeout: maxSec * 1000 + 5000,
    });

  }
  // Try ffmpeg (Windows: dshow, Linux: pulse/alsa)
  else if (commandExists('ffmpeg')) {
    const isWin = process.platform === 'win32';
    const input = isWin
      ? '-f dshow -i audio="Microphone"'
      : '-f pulse -i default';

    options.onStart?.();
    execSync(
      `ffmpeg ${input} -ar 16000 -ac 1 -y ${outputFile}`,
      { stdio: 'inherit', timeout: maxSec * 1000 + 5000 }
    );
  }
  else {
    throw new Error(
      'No audio capture tool found. Install sox or ffmpeg:\n' +
      '  choco install sox.portable\n' +
      '  choco install ffmpeg\n' +
      '  winget install ffmpeg'
    );
  }

  const buffer = await fs.promises.readFile(outputFile);
  // Clean up
  try { await fs.promises.unlink(outputFile); } catch {}
  return buffer;
}

// Resolve the ffmpeg executable even when the server was launched from a shell
// that predates the winget install (winget only updates PATH for new shells).
let ffmpegPathCache: string | null | undefined;

function resolveFfmpeg(): string | null {
  if (ffmpegPathCache !== undefined) return ffmpegPathCache;

  const envPath = process.env.FFMPEG_PATH;
  if (envPath && fs.existsSync(envPath)) {
    ffmpegPathCache = envPath;
    return envPath;
  }

  if (commandExists('ffmpeg')) {
    ffmpegPathCache = 'ffmpeg';
    return 'ffmpeg';
  }

  // Winget install location: %LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\<build>\bin\ffmpeg.exe
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const pkgsDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const pkg of fs.readdirSync(pkgsDir)) {
        if (!pkg.startsWith('Gyan.FFmpeg')) continue;
        const pkgDir = path.join(pkgsDir, pkg);
        for (const build of fs.readdirSync(pkgDir)) {
          const candidate = path.join(pkgDir, build, 'bin', 'ffmpeg.exe');
          if (fs.existsSync(candidate)) {
            ffmpegPathCache = candidate;
            return candidate;
          }
        }
      }
    } catch { /* fall through */ }
  }

  ffmpegPathCache = null;
  return null;
}

/**
 * Convert any audio buffer (webm/opus from the browser, mp3, etc.) to
 * WAV 16kHz mono using ffmpeg — the format whisper.cpp requires.
 */
export async function convertToWav16k(input: Buffer, inputExt: string = 'webm'): Promise<Buffer> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    throw new Error(
      'No se encontró ffmpeg (necesario para convertir audio del navegador). ' +
      'Instálalo con "winget install ffmpeg" y reinicia la terminal donde corre el servidor, ' +
      'o define FFMPEG_PATH en .env con la ruta completa a ffmpeg.exe'
    );
  }
  await ensureTempDir();
  const inFile = path.join(TEMP_DIR, `in-${Date.now()}.${inputExt}`);
  const outFile = path.join(TEMP_DIR, `out-${Date.now()}.wav`);
  await fs.promises.writeFile(inFile, input);
  try {
    execSync(`"${ffmpeg}" -y -i "${inFile}" -ar 16000 -ac 1 -c:a pcm_s16le "${outFile}"`, {
      stdio: 'ignore',
      timeout: 30000,
    });
    return await fs.promises.readFile(outFile);
  } finally {
    try { await fs.promises.unlink(inFile); } catch {}
    try { await fs.promises.unlink(outFile); } catch {}
  }
}

/**
 * Play audio from a buffer (MP3 or WAV).
 */
export async function playAudio(audioBuffer: Buffer): Promise<void> {
  await ensureTempDir();
  const outputFile = path.join(TEMP_DIR, `play-${Date.now()}.wav`);
  await fs.promises.writeFile(outputFile, audioBuffer);

  try {
    if (process.platform === 'win32') {
      // Use PowerShell to play via Windows Media Player
      const psScript = `
        $player = New-Object System.Media.SoundPlayer '${outputFile.replace(/'/g, "''")}';
        $player.PlaySync();
      `;
      execSync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, {
        stdio: 'inherit',
        timeout: 60000,
      });
    } else if (commandExists('ffplay')) {
      execSync(`ffplay -nodisp -autoexit "${outputFile}"`, {
        stdio: 'inherit',
        timeout: 60000,
      });
    } else if (commandExists('aplay')) {
      execSync(`aplay "${outputFile}"`, { stdio: 'inherit', timeout: 60000 });
    }
  } finally {
    try { await fs.promises.unlink(outputFile); } catch {}
  }
}

/**
 * Play audio and return a cancel function.
 */
export function playAudioStream(audioBuffer: Buffer): () => void {
  let cancelled = false;

  playAudio(audioBuffer).catch(() => {});

  return () => {
    cancelled = true;
  };
}

export function hasAudioCapture(): boolean {
  return commandExists('sox') || commandExists('rec') || commandExists('ffmpeg');
}

/**
 * Wait for a keypress, capture audio while key is held, then return the buffer.
 * For push-to-talk: call this in a loop; it blocks until the user presses 'r' to record,
 * or implements a Space-hold pattern.
 */
export async function capturePushToTalk(): Promise<Buffer | null> {
  if (!hasAudioCapture()) {
    console.log('\n🎙️  Audio capture not available (install sox or ffmpeg).');
    console.log('   Type your message instead, or type "exit" to quit.\n');
    return null;
  }

  console.log('\n🎙️  Hold SPACE to record, release when done... (or press Ctrl+C to cancel)');

  // For now, we use a simpler approach: press 'r' to start recording, press 'r' again to stop
  // True push-to-talk with key hold detection requires native key event handling
  // which is complex in Node.js CLI. We'll implement it properly with the Tauri frontend.

  return await captureAudio({ maxSeconds: 30, onStart: () => {
    console.log('🔴 Recording... (press Ctrl+C to stop)');
  }});
}