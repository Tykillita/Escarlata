/**
 * Modelos por defecto por proveedor — único lugar a actualizar cuando
 * cambie la generación recomendada. Las superficies (desktop, CLI, config)
 * deben leer de aquí en vez de repetir ids literales.
 */
export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5-20260512',
  openai: 'gpt-5.4',
  ollama: 'llama3.1',
} as const;
