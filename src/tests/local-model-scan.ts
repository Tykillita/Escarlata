import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanLocalModelsDir } from '../server/health.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'escarlata-model-scan-'));
try {
  await writeFile(path.join(root, 'assistant.gguf'), 'model');
  await writeFile(path.join(root, 'readme.txt'), 'not a model');
  const nested = path.join(root, 'one', 'two', 'three', 'four');
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, 'embedder.safetensors'), 'model');

  const files = await scanLocalModelsDir(root);
  assert.deepEqual(files.map(file => file.name).sort(), ['assistant.gguf', 'embedder.safetensors']);
  assert.ok(files.every(file => path.isAbsolute(file.path)));
  assert.ok(files.every(file => file.size > 0));
  console.log('local-model-scan: ok');
} finally {
  await rm(root, { recursive: true, force: true });
}
