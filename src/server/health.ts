import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';

export interface OllamaModelInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export async function getInstalledOllamaModels(): Promise<OllamaModelInfo[]> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ac.signal });
    if (!res.ok) return [];
    const data: any = await res.json();
    if (!Array.isArray(data.models)) return [];
    return data.models.map((m: any) => ({
      name: m.name,
      size: m.size || 0,
      modifiedAt: m.modified_at || '',
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const MODEL_EXTENSIONS = new Set(['.gguf', '.ggml', '.bin', '.pt', '.pth', '.safetensors']);

export interface LocalModelFile {
  name: string;
  path: string;
  size: number;
  modelName?: string;
}

async function buildDigestMap(baseDir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const libDir = path.join(baseDir, 'manifests', 'registry.ollama.ai', 'library');
  try {
    const models = await fs.readdir(libDir, { withFileTypes: true });
    for (const model of models) {
      if (!model.isDirectory()) continue;
      try {
        const tags = await fs.readdir(path.join(libDir, model.name), { withFileTypes: true });
        for (const tag of tags) {
          if (!tag.isFile()) continue;
          try {
            const content = await fs.readFile(path.join(libDir, model.name, tag.name), 'utf-8');
            const manifest = JSON.parse(content);
            const modelTag = `${model.name}:${tag.name}`;
            if (manifest.layers) {
              for (const layer of manifest.layers) {
                const digest = layer.digest?.replace('sha256:', 'sha256-') || '';
                if (digest) map.set(digest, modelTag);
              }
            }
            if (manifest.config?.digest) {
              const digest = manifest.config.digest.replace('sha256:', 'sha256-') || '';
              if (digest) map.set(digest, modelTag);
            }
          } catch { /* skip unreadable manifests */ }
        }
      } catch { /* skip unreadable model dirs */ }
    }
  } catch { /* no manifests dir */ }
  return map;
}

const MAX_MODEL_FILES = 1_000;

async function scanDir(dirPath: string, depth: number, digestMap?: Map<string, string>, results: LocalModelFile[] = []): Promise<LocalModelFile[]> {
  if (results.length >= MAX_MODEL_FILES) return results;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (results.length >= MAX_MODEL_FILES || entry.isSymbolicLink()) continue;
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (MODEL_EXTENSIONS.has(ext)) {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        results.push({ name: entry.name, path: path.join(dirPath, entry.name), size: stat.size });
      } else if (!ext) {
        try {
          const stat = await fs.stat(path.join(dirPath, entry.name));
          if (digestMap?.has(entry.name) || (entry.name.startsWith('sha256-') && stat.size > 50 * 1024 * 1024)) {
            const modelName = digestMap?.get(entry.name);
            results.push({ name: entry.name, path: path.join(dirPath, entry.name), size: stat.size, modelName });
          }
        } catch { /* skip unreadable */ }
      }
    } else if (entry.isDirectory() && depth > 0) {
      await scanDir(path.join(dirPath, entry.name), depth - 1, digestMap, results);
    }
  }
  return results;
}

export async function scanLocalModelsDir(dirPath: string): Promise<LocalModelFile[]> {
  const digestMap = await buildDigestMap(dirPath);
  return scanDir(dirPath, 4, digestMap);
}

export interface HealthStatus {
  ollama: boolean;
  whisper: boolean;
  ngrok: boolean;
}

export class HealthChecker {
  private status: HealthStatus = { ollama: false, whisper: false, ngrok: false };
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(intervalMs: number): void {
    if (this.intervalId) return;
    this.tick();
    this.intervalId = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getStatus(): HealthStatus {
    return { ...this.status };
  }

  private async tick(): Promise<void> {
    const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const whisperBase = process.env.WHISPER_BASE_URL || 'http://127.0.0.1:8080';

    const [ollama, whisper, ngrok] = await Promise.all([
      this.pingOllama(ollamaBase),
      this.pingUrl(whisperBase),
      this.pingNgrok(),
    ]);

    this.status = { ollama, whisper, ngrok };
  }

  private async pingOllama(baseUrl: string): Promise<boolean> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: ac.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async pingUrl(url: string): Promise<boolean> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    try {
      const res = await fetch(url, { signal: ac.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async pingNgrok(): Promise<boolean> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: ac.signal });
      if (!res.ok) return false;
      const data: any = await res.json();
      return Array.isArray(data.tunnels) && data.tunnels.length > 0;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
