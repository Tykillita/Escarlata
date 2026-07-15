import type { Tool } from './registry.js';
import { getReminderStore } from '../heartbeat/reminders.js';

const WEEKDAYS: Record<string, number> = {
  domingo: 0, sunday: 0,
  lunes: 1, monday: 1,
  martes: 2, tuesday: 2,
  miercoles: 3, miércoles: 3, wednesday: 3,
  jueves: 4, thursday: 4,
  viernes: 5, friday: 5,
  sabado: 6, sábado: 6, saturday: 6,
};

function formatTarget(target: Date, includeDay: boolean): string {
  const time = target.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  if (!includeDay) return time;
  return target.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' a las ' + time;
}

export function parseNaturalTime(input: string): { datetime: string; display: string } | null {
  const now = new Date();
  const lower = input.toLowerCase().trim();

  // Relative: "en X segundos/minutos/horas/días", "in X minutes/hours/days"
  const relMatch = lower.match(/(?:in|en)\s+(\d+)\s*(seg|segundos?|sec|seconds?|min|minutos?|minutes?|h|hrs?|horas?|hours?|d[ií]as?|days?)\b/);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    let ms: number;
    let display: string;
    if (/^(seg|sec)/.test(unit)) { ms = n * 1000; display = `en ${n} segundos`; }
    else if (/^min/.test(unit)) { ms = n * 60000; display = `en ${n} minuto${n === 1 ? '' : 's'}`; }
    else if (/^(h|hr|hora|hour)/.test(unit)) { ms = n * 3600000; display = `en ${n} hora${n === 1 ? '' : 's'}`; }
    else { ms = n * 86400000; display = `en ${n} día${n === 1 ? '' : 's'}`; }
    const target = new Date(now.getTime() + ms);
    return { datetime: target.toISOString(), display };
  }

  // Day offset: "hoy", "mañana", "pasado mañana", weekday names ("el viernes")
  let dayOffset: number | null = null;
  if (/\bpasado\s+mañana\b/.test(lower)) dayOffset = 2;
  else if (/\b(tomorrow|mañana)\b/.test(lower)) dayOffset = 1;
  else if (/\b(today|hoy|esta\s+(tarde|noche)|esta\s+mañana)\b/.test(lower)) dayOffset = 0;
  else {
    const dayMatch = lower.match(/\b(?:el\s+|on\s+)?(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (dayMatch) {
      const targetDow = WEEKDAYS[dayMatch[1]];
      let diff = (targetDow - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7; // next occurrence, not today
      dayOffset = diff;
    }
  }

  // Time of day: "a las HH(:MM) (am/pm)", "al mediodía", "a la medianoche"
  let hour: number | null = null;
  let min = 0;
  if (/\bmediod[ií]a\b/.test(lower)) {
    hour = 12;
  } else if (/\bmedianoche\b|\bmidnight\b/.test(lower)) {
    hour = 0;
  } else {
    const timeMatch = lower.match(/(?:at|a\s+las?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?\s*m\.?|p\.?\s*m\.?)?/i);
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const meridiem = timeMatch[3]?.toLowerCase();
      if (meridiem?.startsWith('p')) {
        if (hour < 12) hour += 12;
      } else if (meridiem?.startsWith('a')) {
        if (hour === 12) hour = 0;
      } else {
        // No meridiem: "esta noche" implies PM; otherwise small hours default to PM
        if (/\bnoche\b|\btarde\b/.test(lower) && hour < 12) hour += 12;
        else if (hour <= 6) hour += 12;
      }
    }
  }

  if (dayOffset === null && hour === null) return null;

  const target = new Date(now);
  target.setDate(target.getDate() + (dayOffset ?? 0));
  if (hour !== null) {
    target.setHours(hour, min, 0, 0);
  } else {
    // Day given without time: default 9:00
    target.setHours(9, 0, 0, 0);
  }

  // Time-only reference that already passed today: push to tomorrow
  if (dayOffset === null && target <= now) {
    target.setDate(target.getDate() + 1);
  }
  if (target <= now) return null;

  return {
    datetime: target.toISOString(),
    display: formatTarget(target, target.toDateString() !== now.toDateString()),
  };
}

export const setReminderTool: Tool = {
  definition: {
    name: 'set_reminder',
    description: 'Set a timed reminder. The user will get a notification when the time arrives. Provide the reminder message and the time in natural language (e.g., "a las 3pm", "en 10 minutos", "mañana a las 9am").',
    parameters: [
      { name: 'message', type: 'string', description: 'What to remind the user about', required: true },
      { name: 'time', type: 'string', description: 'When to remind, in natural language (e.g. "a las 3pm", "en 5 minutos", "mañana a las 9")', required: true },
    ],
    requiresConfirmation: false,
    safetyAction: 'modify_calendar',
  },
  handler: async (input) => {
    const msg = String(input.message || '').trim();
    const timeStr = String(input.time || '').trim();
    if (!msg || !timeStr) return 'Necesito el mensaje y la hora. Ejemplo: set_reminder(message: "llamar a mamá", time: "a las 3pm")';

    const parsed = parseNaturalTime(timeStr);
    if (!parsed) {
      return `No entendí la hora "${timeStr}". Prueba formatos como: "a las 3pm", "en 10 minutos", "mañana a las 9".`;
    }

    const store = getReminderStore();
    const reminder = await store.add(msg, parsed.datetime);

    return `Recordatorio creado: te recordaré "${msg}" ${parsed.display}. Id: ${reminder.id}`;
  },
};

export const listRemindersTool: Tool = {
  definition: {
    name: 'list_reminders',
    description: 'List all reminders (pending and already fired)',
    parameters: [],
    requiresConfirmation: false,
  },
  handler: async () => {
    const store = getReminderStore();
    const all = await store.getAll();
    if (all.length === 0) return 'No hay recordatorios.';
    const pending = all.filter(r => !r.fired);
    const fired = all.filter(r => r.fired);
    const lines: string[] = [];
    if (pending.length > 0) {
      lines.push(`📋 Recordatorios pendientes (${pending.length}):`);
      for (const r of pending) {
        const t = new Date(r.time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        lines.push(`  ${r.id}: "${r.message}" a las ${t}`);
      }
    }
    if (fired.length > 0) {
      lines.push(`✅ Recordatorios ya avisados (${fired.length}):`);
      for (const r of fired) {
        lines.push(`  ${r.id}: "${r.message}"`);
      }
    }
    return lines.join('\n');
  },
};

export const cancelReminderTool: Tool = {
  definition: {
    name: 'cancel_reminder',
    description: 'Cancel a pending reminder by its ID',
    parameters: [
      { name: 'id', type: 'string', description: 'The reminder ID to cancel', required: true },
    ],
    requiresConfirmation: false,
    safetyAction: 'modify_calendar',
  },
  handler: async (input) => {
    const id = String(input.id || '').trim();
    if (!id) return 'Indica el id del recordatorio a cancelar.';
    const store = getReminderStore();
    const ok = await store.cancel(id);
    return ok ? `Recordatorio ${id} cancelado.` : `No encontré el recordatorio ${id}. Usa list_reminders para ver los activos.`;
  },
};
