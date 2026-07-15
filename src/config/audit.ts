import { promises as fs } from 'fs';
import * as path from 'path';

export interface AuditEntry {
  timestamp: string;
  type: 'tool_run' | 'confirmation' | 'heartbeat' | 'error' | 'injection_attempt';
  detail: string;
  metadata?: Record<string, unknown>;
}

const AUDIT_FILE = process.env.AUDIT_FILE || path.join(process.cwd(), 'data', 'audit.log');

function getAuditPath(): string {
  return process.env.AUDIT_FILE || path.join(process.cwd(), 'data', 'audit.log');
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(getAuditPath()), { recursive: true });
}

export async function audit(entry: AuditEntry): Promise<void> {
  await ensureDir();
  const line = JSON.stringify({
    t: entry.timestamp,
    type: entry.type,
    detail: entry.detail,
    ...(entry.metadata ? { meta: entry.metadata } : {}),
  });
  await fs.appendFile(getAuditPath(), line + '\n', 'utf-8');
}

export async function readAuditLog(lines: number = 50): Promise<AuditEntry[]> {
  try {
    const content = await fs.readFile(getAuditPath(), 'utf-8');
    const allLines = content.trim().split('\n').filter(Boolean);
    const lastLines = allLines.slice(-lines);
    return lastLines.map(l => {
      const parsed = JSON.parse(l);
      return {
        timestamp: parsed.t,
        type: parsed.type,
        detail: parsed.detail,
        metadata: parsed.meta,
      };
    });
  } catch {
    return [];
  }
}

export async function formatAuditLog(count: number = 20): Promise<string> {
  const entries = await readAuditLog(count);
  if (entries.length === 0) return 'No audit entries.';
  return entries.map(e =>
    `[${e.timestamp.split('.')[0].replace('T', ' ')}] ${e.type.toUpperCase()}: ${e.detail}`
  ).join('\n');
}