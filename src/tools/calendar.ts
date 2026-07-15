import { Tool } from './registry.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import { dataPath } from '../config/paths.js';

function getCalendarPath(): string {
  return process.env.CALENDAR_FILE || dataPath('calendar.json');
}

/** Fecha YYYY-MM-DD en hora LOCAL (toISOString daría la fecha UTC: en
 * husos negativos, desde la tarde "hoy" sería mañana). */
function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface CalendarEvent {
  title: string;
  date: string; // YYYY-MM-DD
  time?: string;
  duration?: string;
  notes?: string;
  done?: boolean;
}

async function loadEvents(): Promise<CalendarEvent[]> {
  try {
    const data = await fs.readFile(getCalendarPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveEvents(events: CalendarEvent[]): Promise<void> {
  await fs.mkdir(path.dirname(getCalendarPath()), { recursive: true });
  await fs.writeFile(getCalendarPath(), JSON.stringify(events, null, 2), 'utf-8');
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { weekday: 'long', month: 'long', day: 'numeric' });
}

function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday start
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: localDate(monday),
    end: localDate(sunday),
  };
}

export const getTodayTool: Tool = {
  definition: {
    name: 'get_today',
    description: 'Get events scheduled for today. Use this when the user asks "what\'s today?", "what do I have today?", or for a daily briefing.',
    parameters: [],
    requiresConfirmation: false,
  },
  handler: async () => {
    const today = localDate();
    const events = await loadEvents();
    const todayEvents = events.filter(e => e.date === today);
    const dateStr = formatDate(today);

    if (todayEvents.length === 0) {
      return `${dateStr} — No events scheduled.`;
    }

    return `${dateStr} — ${todayEvents.length} event(s):\n` + todayEvents
      .map(e => `- ${e.time || 'All day'}: ${e.title}${e.duration ? ` (${e.duration})` : ''}${e.notes ? ` — ${e.notes}` : ''}`)
      .join('\n');
  },
};

export const getWeekTool: Tool = {
  definition: {
    name: 'get_week',
    description: 'Get all events scheduled for this week (Monday through Sunday). Use this for weekly briefings or planning.',
    parameters: [],
    requiresConfirmation: false,
  },
  handler: async () => {
    const week = getWeekRange();
    const events = await loadEvents();
    const weekEvents = events.filter(e => e.date >= week.start && e.date <= week.end);

    if (weekEvents.length === 0) {
      return `This week (${formatDate(week.start)} — ${formatDate(week.end)}) — No events scheduled.`;
    }

    // Group by date
    const byDate: Record<string, CalendarEvent[]> = {};
    for (const e of weekEvents) {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    }

    let output = `This week (${formatDate(week.start)} — ${formatDate(week.end)}):\n`;
    for (const [date, evts] of Object.entries(byDate).sort()) {
      output += `\n${formatDate(date)}:\n`;
      for (const e of evts) {
        output += `  ${e.time || 'All day'}: ${e.title}${e.duration ? ` (${e.duration})` : ''}${e.done ? ' ✅' : ''}\n`;
      }
    }
    return output;
  },
};

export const addEventTool: Tool = {
  definition: {
    name: 'add_event',
    description: 'Agrega un evento al calendario. Úsalo cuando el usuario quiera agendar algo: una cita, reunión, cumpleaños o compromiso en una fecha concreta.',
    parameters: [
      { name: 'title', type: 'string', description: 'Título del evento', required: true },
      { name: 'date', type: 'string', description: 'Fecha en formato YYYY-MM-DD', required: true },
      { name: 'time', type: 'string', description: 'Hora en formato HH:MM (24h), opcional', required: false },
      { name: 'duration', type: 'string', description: 'Duración estimada (ej: "1h", "30min"), opcional', required: false },
      { name: 'notes', type: 'string', description: 'Notas adicionales, opcional', required: false },
    ],
    requiresConfirmation: false,
    safetyAction: 'modify_calendar',
  },
  handler: async (input) => {
    const title = String(input.title || '').trim();
    const date = String(input.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00').getTime())) {
      return `Fecha inválida "${date}". Usa el formato YYYY-MM-DD (ej: 2026-07-15).`;
    }
    const time = input.time ? String(input.time).trim() : undefined;
    if (time && !/^\d{1,2}:\d{2}$/.test(time)) {
      return `Hora inválida "${time}". Usa el formato HH:MM en 24 horas (ej: 15:30).`;
    }
    const events = await loadEvents();
    if (events.some(e => e.date === date && e.title.toLowerCase() === title.toLowerCase() && e.time === time)) {
      return `Ya existe el evento "${title}" el ${formatDate(date)}${time ? ` a las ${time}` : ''}.`;
    }
    events.push({
      title,
      date,
      time,
      duration: input.duration ? String(input.duration) : undefined,
      notes: input.notes ? String(input.notes) : undefined,
    });
    await saveEvents(events);
    return `Evento agendado: "${title}" el ${formatDate(date)}${time ? ` a las ${time}` : ' (todo el día)'}.`;
  },
};

export const upcomingEventsTool: Tool = {
  definition: {
    name: 'upcoming_events',
    description: 'Get upcoming events within a given number of days from today. Use this for planning ahead or checking what\'s coming.',
    parameters: [
      { name: 'days', type: 'number', description: 'Number of days to look ahead (default: 7)', required: false },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const days = typeof input.days === 'number' ? input.days : 7;
    const today = localDate();
    const future = localDate(new Date(Date.now() + days * 86400000));
    const events = await loadEvents();
    const upcoming = events.filter(e => e.date >= today && e.date <= future);

    if (upcoming.length === 0) {
      return `No upcoming events in the next ${days} days.`;
    }

    const byDate: Record<string, CalendarEvent[]> = {};
    for (const e of upcoming) {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    }

    let output = `Upcoming (next ${days} days):\n`;
    for (const [date, evts] of Object.entries(byDate).sort()) {
      output += `\n${formatDate(date)}:\n`;
      for (const e of evts) {
        output += `  ${e.time || 'All day'}: ${e.title}${e.done ? ' ✅' : ''}\n`;
      }
    }
    return output;
  },
};
