import type { ResolvedPromptContext } from './types.js';

export function contextSection(context: ResolvedPromptContext): string {
  const surfaceRule = context.surface === 'voice'
    ? `Esta respuesta se leerá en voz alta. Usa frases cortas, prosa natural, fechas habladas y nada de Markdown, tablas, emojis ni URLs largas.`
    : context.surface === 'chat'
      ? `Estás en chat. Prefiere respuestas breves; usa Markdown ligero solo cuando una lista, comparación o bloque técnico facilite realmente la lectura.`
      : `Estás en una terminal. Sé breve y usa formato de texto simple.`;

  return `# Contexto de ejecución
- Zona horaria del usuario: ${context.timezone}.
- Cada mensaje del usuario empieza con su fecha y hora. El timestamp del último mensaje es "ahora"; úsalo para resolver fechas relativas.
- Responde en el idioma del usuario. Por defecto usa español neutro, tuteo natural y sin regionalismos.
- Superficie activa: ${context.surface}. ${surfaceRule}`;
}
