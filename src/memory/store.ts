import { promises as fs } from 'fs';
import * as path from 'path';
import { dataPath } from '../config/paths.js';

export interface MemoryFact {
  id: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

function getMemoryFilePath(): string {
  return process.env.MEMORY_FILE || dataPath('memories.json');
}

export class MemoryStore {
  private facts: MemoryFact[] = [];
  private loaded = false;

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(getMemoryFilePath(), 'utf-8');
      this.facts = JSON.parse(data);
    } catch {
      this.facts = [];
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(getMemoryFilePath()), { recursive: true });
    await fs.writeFile(getMemoryFilePath(), JSON.stringify(this.facts, null, 2), 'utf-8');
  }

  async getAll(): Promise<MemoryFact[]> {
    if (!this.loaded) await this.load();
    return [...this.facts];
  }

  async add(content: string, category: string = 'general'): Promise<MemoryFact> {
    if (!this.loaded) await this.load();
    const fact: MemoryFact = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content,
      category,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.facts.push(fact);
    await this.save();
    return fact;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.loaded) await this.load();
    const idx = this.facts.findIndex(f => f.id === id);
    if (idx === -1) return false;
    this.facts.splice(idx, 1);
    await this.save();
    return true;
  }

  async update(id: string, content: string): Promise<boolean> {
    if (!this.loaded) await this.load();
    const fact = this.facts.find(f => f.id === id);
    if (!fact) return false;
    fact.content = content;
    fact.updatedAt = new Date().toISOString();
    await this.save();
    return true;
  }

  async search(query: string): Promise<MemoryFact[]> {
    if (!this.loaded) await this.load();
    const lower = query.toLowerCase();
    return this.facts.filter(f =>
      f.content.toLowerCase().includes(lower) ||
      f.category.toLowerCase().includes(lower)
    );
  }

  async getByCategory(category: string): Promise<MemoryFact[]> {
    if (!this.loaded) await this.load();
    return this.facts.filter(f => f.category === category);
  }

  /** Format all memories as a readable string for the system prompt */
  async formatForPrompt(): Promise<string> {
    const facts = await this.getAll();
    if (facts.length === 0) return '';
    // "escarlata" memories are self-learnings (style corrections, behavior guidance)
    // mined from past chats; they shape her behavior, not her knowledge of the user.
    const selfFacts = facts.filter(f => f.category === 'escarlata');
    const userFacts = facts.filter(f => f.category !== 'escarlata');
    const parts: string[] = [];
    if (userFacts.length > 0) {
      parts.push(`Cosas que sé del usuario:\n${userFacts.map(f => `- [${f.category}] ${f.content}`).join('\n')}`);
    }
    if (selfFacts.length > 0) {
      parts.push(`Aprendizajes sobre cómo comportarte (de conversaciones anteriores — aplícalos siempre):\n${selfFacts.map(f => `- ${f.content}`).join('\n')}`);
    }
    return `\n${parts.join('\n\n')}`;
  }
}

// Singleton shared across the app
let _instance: MemoryStore | null = null;

export function getMemoryStore(): MemoryStore {
  if (!_instance) {
    _instance = new MemoryStore();
  }
  return _instance;
}

/** Reset the singleton (for testing restart behavior) */
export function resetMemoryStore(): void {
  _instance = null;
}