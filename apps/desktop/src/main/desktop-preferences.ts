import type { LocalStore } from './local-store.js';

export type NotificationSeverity = 'info' | 'notice' | 'important';
export interface DesktopPreferences {
  notifications: { enabled: boolean; minimumSeverity: NotificationSeverity; sound: boolean; doNotDisturb: { enabled: boolean; startHour: number; endHour: number; allowImportant: boolean } };
  tray: { enabled: boolean; showUnreadBadge: boolean; closeToTray: boolean; minimizeToTray: boolean };
  startup: { enabled: boolean; startMinimized: boolean };
}

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  notifications: { enabled: true, minimumSeverity: 'important', sound: true, doNotDisturb: { enabled: false, startHour: 23, endHour: 7, allowImportant: true } },
  tray: { enabled: true, showUnreadBadge: true, closeToTray: false, minimizeToTray: false },
  startup: { enabled: false, startMinimized: false },
};

export function getDesktopPreferences(store: LocalStore): DesktopPreferences {
  const saved = store.setting<Partial<DesktopPreferences>>('desktopPreferences');
  return {
    notifications: { ...DEFAULT_DESKTOP_PREFERENCES.notifications, ...saved?.notifications, doNotDisturb: { ...DEFAULT_DESKTOP_PREFERENCES.notifications.doNotDisturb, ...saved?.notifications?.doNotDisturb } },
    tray: { ...DEFAULT_DESKTOP_PREFERENCES.tray, ...saved?.tray },
    startup: { ...DEFAULT_DESKTOP_PREFERENCES.startup, ...saved?.startup },
  };
}

export function normalizeDesktopPreferences(input: DesktopPreferences): DesktopPreferences {
  const preferences: DesktopPreferences = structuredClone(input);
  // A hidden application must retain a visible way back in.
  if (!preferences.tray.enabled) {
    preferences.tray.closeToTray = false;
    preferences.tray.minimizeToTray = false;
    preferences.startup.startMinimized = false;
  }
  return preferences;
}
