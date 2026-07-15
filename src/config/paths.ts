import * as path from 'path';

/**
 * Base de datos locales de Escarlata. El desktop la apunta al directorio
 * "heart" vía ESCARLATA_DATA_DIR; el CLI y los tests caen a ./data.
 * Se resuelve en tiempo de llamada (nunca al importar) para que el env
 * configurado por el proceso main de Electron siempre tenga efecto.
 */
export function dataDir(): string {
  return process.env.ESCARLATA_DATA_DIR || path.join(process.cwd(), 'data');
}

export function dataPath(...segments: string[]): string {
  return path.join(dataDir(), ...segments);
}
