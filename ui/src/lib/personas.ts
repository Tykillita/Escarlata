// Maps backend tool names to the gem-team persona that "does" the work,
// per docs/PLAN-SUBAGENTES.md. The UI never shows raw tool names to the user.

export interface ToolPersona {
  gem: string;
  action: string; // short Spanish gerund, e.g. "buscando en la web"
}

const PERSONAS: Record<string, ToolPersona> = {
  // Escarlata — jefa coordinando al equipo
  delegate_task: { gem: 'Escarlata', action: 'coordinando al equipo' },

  // Ópalo — investigador
  web_search: { gem: 'Ópalo', action: 'buscando en la web' },
  read_local_file: { gem: 'Ópalo', action: 'leyendo un archivo' },

  // Perla — escriba
  save_note: { gem: 'Perla', action: 'guardando una nota' },
  get_note: { gem: 'Perla', action: 'leyendo una nota' },
  list_notes: { gem: 'Perla', action: 'revisando las notas' },
  search_notes: { gem: 'Perla', action: 'buscando en las notas' },
  edit_local_file: { gem: 'Perla', action: 'editando un archivo' },

  // Cuarzo — guardián del tiempo
  get_today: { gem: 'Cuarzo', action: 'mirando la agenda de hoy' },
  get_week: { gem: 'Cuarzo', action: 'mirando la semana' },
  upcoming_events: { gem: 'Cuarzo', action: 'revisando próximos eventos' },
  add_event: { gem: 'Cuarzo', action: 'agendando un evento' },
  set_reminder: { gem: 'Cuarzo', action: 'creando un recordatorio' },
  list_reminders: { gem: 'Cuarzo', action: 'revisando recordatorios' },
  cancel_reminder: { gem: 'Cuarzo', action: 'cancelando un recordatorio' },

  // Ámbar — archivista
  remember: { gem: 'Ámbar', action: 'guardando en la memoria' },
  recall: { gem: 'Ámbar', action: 'buscando en la memoria' },
  list_memories: { gem: 'Ámbar', action: 'repasando la memoria' },
  forget: { gem: 'Ámbar', action: 'borrando una memoria' },

  // Amatista — analista introspectiva
  analyze_conversation: { gem: 'Amatista', action: 'analizando la conversación' },
  list_conversations: { gem: 'Amatista', action: 'revisando conversaciones pasadas' },
  read_conversation: { gem: 'Amatista', action: 'releyendo una conversación' },

  // Rubí — ejecutora de pendientes
  get_directives: { gem: 'Rubí', action: 'revisando los pendientes' },
  add_todo: { gem: 'Rubí', action: 'agregando un pendiente' },
  done_todo: { gem: 'Rubí', action: 'marcando un pendiente como hecho' },
};

export function toolPersona(toolName: string): ToolPersona {
  return PERSONAS[toolName] ?? { gem: 'Escarlata', action: toolName.replace(/_/g, ' ') };
}

/** "Ópalo · buscando en la web" */
export function personaLabel(toolName: string): string {
  const p = toolPersona(toolName);
  return `${p.gem} · ${p.action}`;
}

// Natural-language request sent to Escarlata when a Command Deck button is pressed.
const COMMANDS: Record<string, string> = {
  delegate_task: 'Preséntame a tu equipo: quién es cada uno y en qué me pueden ayudar.',
  web_search: 'Búscame las noticias más importantes de hoy.',
  read_local_file: '¿Qué archivos tienes en los documentos locales?',
  save_note: 'Quiero guardar una nota. Pregúntame el título y el contenido.',
  get_note: '¿Qué notas guardadas tengo? Léeme la que te pida.',
  list_notes: 'Lístame mis notas guardadas.',
  search_notes: 'Quiero buscar algo en mis notas. Pregúntame qué.',
  edit_local_file: 'Quiero editar un archivo del vault. Pregúntame cuál y qué cambio.',
  get_today: '¿Qué tengo en la agenda hoy?',
  get_week: 'Dame el resumen de mi semana.',
  upcoming_events: '¿Qué eventos se vienen en los próximos días?',
  add_event: 'Quiero agendar un evento. Pregúntame los datos.',
  set_reminder: 'Quiero crear un recordatorio. Pregúntame qué y cuándo.',
  list_reminders: '¿Qué recordatorios tengo activos?',
  cancel_reminder: 'Quiero cancelar un recordatorio. Muéstrame los activos primero.',
  remember: 'Quiero que guardes un dato sobre mí. Pregúntame cuál.',
  recall: '¿Qué sabes de mí? Repasa tu memoria y cuéntame.',
  list_memories: 'Lístame todo lo que tienes guardado en tu memoria sobre mí.',
  forget: 'Quiero borrar algo de tu memoria. Muéstrame qué tienes guardado primero.',
  get_directives: '¿Qué pendientes tengo en el TODO-list?',
  add_todo: 'Quiero agregar un pendiente al TODO-list. Pregúntame cuál.',
  done_todo: 'Terminé una tarea. Pregúntame cuál para marcarla completada.',
};

export function commandPhrase(toolName: string): string {
  return COMMANDS[toolName] ?? `Ayúdame con esto: ${toolPersona(toolName).action}.`;
}

/** Curated quick actions for the Command Deck — essential tasks, one tap each. */
export interface QuickAction {
  label: string;   // shown on the button
  phrase: string;  // sent to Escarlata
}

export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'AGENDA HOY', phrase: '¿Qué tengo en la agenda hoy?' },
  { label: 'MI SEMANA', phrase: 'Dame el resumen de mi semana.' },
  { label: 'PENDIENTES', phrase: '¿Qué pendientes tengo en el TODO-list?' },
  { label: 'NUEVO PENDIENTE', phrase: 'Quiero agregar un pendiente al TODO-list. Pregúntame cuál.' },
  { label: 'RECORDATORIOS', phrase: '¿Qué recordatorios tengo activos?' },
  { label: 'NUEVO RECORDATORIO', phrase: 'Quiero crear un recordatorio. Pregúntame qué y cuándo.' },
  { label: 'AGENDAR EVENTO', phrase: 'Quiero agendar un evento. Pregúntame los datos.' },
  { label: 'NUEVA NOTA', phrase: 'Quiero guardar una nota. Pregúntame el título y el contenido.' },
  { label: 'NOTICIAS DE HOY', phrase: 'Búscame las noticias más importantes de hoy.' },
  { label: 'BRIEFING COMPLETO', phrase: 'Dame un briefing: agenda de hoy, pendientes y recordatorios activos.' },
  { label: 'TU MEMORIA', phrase: '¿Qué sabes de mí? Repasa tu memoria y cuéntame.' },
  { label: 'TU EQUIPO', phrase: 'Preséntame a tu equipo: quién es cada uno y en qué me pueden ayudar.' },
  { label: 'APRENDE DE MÍ', phrase: 'Pídele a Amatista que analice nuestras conversaciones recientes y guarde lo que valga la pena recordar sobre mí y sobre cómo prefiero que me trates.' },
];
