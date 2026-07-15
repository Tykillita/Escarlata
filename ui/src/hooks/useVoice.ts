import { useState, useRef, useCallback, useEffect } from 'react';

export type VoiceStatus = 'standby' | 'recording' | 'transcribing' | 'speaking';

export interface VoiceApi {
  status: VoiceStatus;
  level: number; // 0..1 mic/tts activity level
  ttsEnabled: boolean;
  toggleTts: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  speak: (text: string, append?: boolean) => void;
  onTranscript: () => void;
  onError: () => void;
}

const TTS_KEY = 'escarlata.tts';

// Known female Spanish voice names across Windows/Chrome/Edge/macOS/Android
const FEMALE_HINTS = /sabina|helena|laura|elvira|dalia|paloma|paulina|m[oó]nica|luc[ií]a|camila|ximena|salom[eé]|isidora|catalina|esperanza|female|mujer/i;

let cachedVoices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  cachedVoices = window.speechSynthesis?.getVoices() ?? [];
}

function pickSpanishVoice(): SpeechSynthesisVoice | null {
  if (!cachedVoices.length) loadVoices();
  const es = cachedVoices.filter(v => v.lang.toLowerCase().replace('_', '-').startsWith('es'));
  if (!es.length) {
    if (cachedVoices.length) {
      console.warn('[voice] no hay voz en español disponible en este navegador, usando default del sistema (probable acento inglés). Voces vistas:', cachedVoices.map(v => `${v.name} (${v.lang})`));
    } else {
      console.warn('[voice] speechSynthesis.getVoices() devolvió vacío — este navegador puede estar bloqueando el motor TTS.');
    }
    return null;
  }
  const rank = (v: SpeechSynthesisVoice) => {
    let s = 0;
    if (FEMALE_HINTS.test(v.name)) s += 8;
    if (/es[-_]mx/i.test(v.lang)) s += 4;
    else if (/es[-_]us/i.test(v.lang)) s += 2;
    if (/natural|neural|online|google/i.test(v.name)) s += 1; // higher-quality voices
    return s;
  };
  return [...es].sort((a, b) => rank(b) - rank(a))[0];
}

// Strip markdown so TTS doesn't read symbols aloud
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (código omitido) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/#+\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\w+\([^)]*\)/g, '')
    .replace(/(?:^|\n)\s*[-*+]\s+/g, ' ')
    .replace(/(?:^|\n)\s*\d+[.)]\s+/g, ' ')
    .replace(/---+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function useVoice({ onAudio, onBoundary }: { onAudio: (base64: string, mime: string) => void; onBoundary?: () => void }): VoiceApi {
  const [status, setStatus] = useState<VoiceStatus>('standby');
  const [level, setLevel] = useState(0);
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem(TTS_KEY) !== 'off');

  const statusRef = useRef(status);
  statusRef.current = status;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const onAudioRef = useRef(onAudio);
  onAudioRef.current = onAudio;
  const onBoundaryRef = useRef(onBoundary);
  onBoundaryRef.current = onBoundary;

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setLevel(0);
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 80) { // ~12fps is enough for the equalizer
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setLevel(Math.min(1, (sum / data.length / 255) * 3));
        last = t;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startRecording = useCallback(async () => {
    if (statusRef.current !== 'standby') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mime });
        const elapsed = Date.now() - startTimeRef.current;
        if (blob.size < 1000 || elapsed < 800) { // too short / empty
          setStatus('standby');
          return;
        }
        setStatus('transcribing');
        const fr = new FileReader();
        fr.onload = () => {
          const base64 = String(fr.result).split(',')[1] || '';
          onAudioRef.current(base64, mime);
        };
        fr.readAsDataURL(blob);
      };
      recorderRef.current = recorder;
      startTimeRef.current = Date.now();
      recorder.start();
      startMeter(stream);
      setStatus('recording');
    } catch (err) {
      console.error('[voice] mic error:', err);
      setStatus('standby');
    }
  }, [startMeter]);

  const stopRecording = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    stopMeter();
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, [stopMeter]);

  const speak = useCallback((text: string, append = false) => {
    if (!ttsEnabled || !('speechSynthesis' in window)) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    if (!append && window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(clean);
    const voice = pickSpanishVoice();
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang || 'es-MX';
    utter.rate = 1.05;
    utter.onstart = () => setStatus('speaking');
    utter.onboundary = (e) => { if (e.name === 'word') onBoundaryRef.current?.(); };
    utter.onend = () => setStatus(s => (s === 'speaking' ? 'standby' : s));
    utter.onerror = () => setStatus(s => (s === 'speaking' ? 'standby' : s));
    window.speechSynthesis.speak(utter);
  }, [ttsEnabled]);

  const onTranscript = useCallback(() => {
    setStatus(s => (s === 'transcribing' ? 'standby' : s));
  }, []);

  const onError = useCallback(() => {
    window.speechSynthesis?.cancel();
    stopMeter();
    setStatus('standby');
  }, [stopMeter]);

  const toggleTts = useCallback(() => {
    setTtsEnabled(prev => {
      const next = !prev;
      localStorage.setItem(TTS_KEY, next ? 'on' : 'off');
      if (!next) window.speechSynthesis?.cancel();
      return next;
    });
  }, []);

  // Push-to-talk: hold V (outside inputs) to record, release to send.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'v' && !e.repeat && !e.ctrlKey && !e.metaKey && !isTyping(e)) {
        e.preventDefault();
        startRecording();
      }
      if (e.key === 'Escape' && statusRef.current === 'speaking') {
        window.speechSynthesis?.cancel();
        setStatus('standby');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'v') stopRecording();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [startRecording, stopRecording]);

  // Preload voices (Chrome loads them async and fires voiceschanged later)
  useEffect(() => {
    loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
  }, []);

  return { status, level, ttsEnabled, toggleTts, startRecording, stopRecording, speak, onTranscript, onError };
}
