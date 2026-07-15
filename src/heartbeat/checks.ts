import { getNoticeBoard } from './notices.js';
import { ToolRegistry } from '../tools/registry.js';

export interface HeartbeatCheck {
  id: string;
  interval: string | number;
  description: string;
  /** Corre incluso en quiet hours (ej. recordatorios con hora exacta) */
  bypassQuietHours?: boolean;
  run(registry: ToolRegistry): Promise<void>;
}

/** Time-of-day greeting based on the local hour. (Icons are SVG, UI-side.) */
function timeGreeting(now: Date): { greeting: string } {
  const h = now.getHours();
  if (h >= 5 && h < 12) return { greeting: 'Buenos días' };
  if (h >= 12 && h < 20) return { greeting: 'Buenas tardes' };
  return { greeting: 'Buenas noches' };
}

/**
 * Startup intel: greet the user by time of day and surface real-time data —
 * live clock, today's/weekly schedule, pending reminders and directives.
 */
export const startupBriefingCheck: HeartbeatCheck = {
  id: 'startup_briefing',
  interval: 'startup',
  description: 'Greet the user on launch with a live intel report (clock, schedule, reminders, directives)',
  run: async (registry: ToolRegistry) => {
    const notices = getNoticeBoard();
    const now = new Date();
    const { greeting } = timeGreeting(now);

    // Live timestamp — real-time header line
    const stamp = now.toLocaleString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit',
    });

    // Helper to run a tool by name, ignoring failures
    const run = async (name: string, args: Record<string, unknown> = {}, fallback = '') => {
      const tool = registry.get(name);
      if (!tool) return fallback;
      try { return await tool.handler(args); } catch { return fallback; }
    };

    const todaySummary = await run('get_today', {}, 'Sin eventos agendados para hoy.');
    const weekSummary = await run('get_week', {}, 'Sin eventos esta semana.');
    const upcomingSummary = await run('upcoming_events', { days: 7 }, '');
    const reminders = await run('list_reminders', {}, '');
    const directives = await run('get_directives', {}, '');

    // Existing undismissed items (el briefing anterior se reemplaza, no cuenta)
    const existingNotices = (await notices.getActive()).filter(n => n.source !== 'startup_briefing');
    const followUp = existingNotices.length > 0
      ? `\n${existingNotices.length} aviso(s) sin descartar:\n${existingNotices.map(n => `  - ${n.title}`).join('\n')}`
      : '';

    const body = [
      stamp.toUpperCase(),
      '',
      `HOY\n${todaySummary}`,
      `\nSEMANA\n${weekSummary}`,
      upcomingSummary ? `\n${upcomingSummary}` : '',
      reminders && !/^No hay recordatorios/i.test(reminders) ? `\nRECORDATORIOS\n${reminders}` : '',
      directives && !/^No hay pendientes/i.test(directives) ? `\nPENDIENTES\n${directives}` : '',
      followUp,
    ].filter(Boolean).join('\n');

    // Upsert: cada arranque reemplaza el briefing anterior en vez de apilar
    await notices.replaceBySource(
      'startup_briefing',
      `${greeting}. Tu resumen del día`,
      body,
      'notice'
    );
  },
};

/**
 * Periodic check: re-surface undismissed notices if any have been sitting for hours.
 */
export const followUpCheck: HeartbeatCheck = {
  id: 'follow_up',
  interval: 60, // every 60 minutes
  description: 'Check for stale undismissed notices and follow up',
  run: async () => {
    const notices = getNoticeBoard();
    const active = await notices.getActive();
    // Excluir sus propios avisos: un follow-up nunca genera follow-ups de sí mismo
    const stale = active.filter(n => {
      if (n.source === 'follow_up') return false;
      const age = Date.now() - new Date(n.createdAt).getTime();
      return age > 4 * 3600000; // > 4 hours old
    });

    if (stale.length > 0) {
      // Upsert: un solo follow-up vivo, actualizado — no uno nuevo por hora
      await notices.replaceBySource(
        'follow_up',
        'Sigue pendiente',
        `Todavía tienes ${stale.length} aviso(s) sin descartar:\n${
          stale.map(n => `  - ${n.title}`).join('\n')
        }`,
        'info'
      );
    } else {
      // Nada pendiente: retirar el follow-up viejo si quedó colgado
      await notices.clearSource('follow_up');
    }
  },
};

export const remindersCheck: HeartbeatCheck = {
  id: 'reminders',
  interval: 0.5, // every 30 seconds
  description: 'Check for pending reminders that are due and surface them as notices',
  // Un recordatorio con hora exacta debe sonar aunque sean quiet hours
  bypassQuietHours: true,
  run: async () => {
    const { getReminderStore } = await import('./reminders.js');
    const store = getReminderStore();
    const pending = await store.getPending();

    for (const r of pending) {
      await store.markFired(r.id);
      const notices = getNoticeBoard();
      await notices.add(
        `Recordatorio: ${r.message}`,
        `Pediste que te recordara esto. ¡Ya es la hora!`,
        'important',
        'reminders_check',
        [{ label: 'Posponer 10 min', command: `Recuérdame en 10 minutos: ${r.message}` }]
      );
    }
  },
};

export const defaultChecks: HeartbeatCheck[] = [
  startupBriefingCheck,
  followUpCheck,
  remindersCheck,
];