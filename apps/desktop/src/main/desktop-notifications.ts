import { Notification } from 'electron';
import type { Notice } from '../../../../src/heartbeat/notices.js';
import type { DesktopPreferences } from './desktop-preferences.js';

const severityRank = { info: 0, notice: 1, important: 2 } as const;

function isQuietNow(preferences: DesktopPreferences): boolean {
  const { enabled, startHour, endHour } = preferences.notifications.doNotDisturb;
  if (!enabled || startHour === endHour) return false;
  const hour = new Date().getHours();
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

export class DesktopNotificationService {
  private delivered = new Set<string>();
  constructor(private readonly preferences: () => DesktopPreferences, private readonly onClick: (noticeId: string) => void) {}

  notify(notice: Notice): void {
    const prefs = this.preferences();
    if (this.delivered.has(notice.id) || !prefs.notifications.enabled || !Notification.isSupported()) return;
    if (severityRank[notice.severity] < severityRank[prefs.notifications.minimumSeverity]) return;
    if (isQuietNow(prefs) && !(notice.severity === 'important' && prefs.notifications.doNotDisturb.allowImportant)) return;
    this.delivered.add(notice.id);
    const notification = new Notification({
      title: notice.title.slice(0, 120), body: notice.body.slice(0, 240), silent: !prefs.notifications.sound,
      urgency: notice.severity === 'important' ? 'critical' : notice.severity === 'notice' ? 'normal' : 'low',
    });
    notification.on('click', () => this.onClick(notice.id));
    notification.show();
  }

  test(): void {
    const notification = new Notification({ title: 'Escarlata', body: 'Las notificaciones de escritorio están funcionando.', silent: !this.preferences().notifications.sound });
    notification.show();
  }
}
