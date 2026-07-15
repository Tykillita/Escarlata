import { app, BrowserWindow, ipcMain, shell, session, dialog, nativeTheme, Tray, Menu, nativeImage } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { desktopCommandSchema } from '@escarlata/protocol';
import { LocalStore, defaultDatabasePath } from './local-store.js';
import { DesktopAgentService } from './desktop-agent-service.js';
import { SecretVault } from './secret-vault.js';
import { getDesktopPreferences, normalizeDesktopPreferences, type DesktopPreferences } from './desktop-preferences.js';
import { DesktopNotificationService } from './desktop-notifications.js';
import { setWindowsHelloWindowProvider } from './windows-hello.js';

let windowRef: BrowserWindow | null = null;
let store: LocalStore | null = null;
let service: DesktopAgentService | null = null;
let tray: Tray | null = null;
let notificationService: DesktopNotificationService | null = null;
let isQuitting = false;

// Windows uses this identifier to associate toast notifications with Escarlata.
// Without it, notifications launched from the development executable can be
// discarded or grouped under Electron instead of appearing for this app.
if (process.platform === 'win32') app.setAppUserModelId('com.escarlata.desktop');

const emit = (event: Record<string, unknown>) => windowRef?.webContents.send('escarlata:event', event);
setWindowsHelloWindowProvider(() => {
  try {
    if (!windowRef || windowRef.isDestroyed()) return undefined;
    const handle = windowRef.getNativeWindowHandle();
    return (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString();
  } catch { return undefined; }
});
const preferences = (): DesktopPreferences => store ? getDesktopPreferences(store) : normalizeDesktopPreferences({ notifications: { enabled: true, minimumSeverity: 'important', sound: true, doNotDisturb: { enabled: false, startHour: 23, endHour: 7, allowImportant: true } }, tray: { enabled: true, showUnreadBadge: true, closeToTray: false, minimizeToTray: false }, startup: { enabled: false, startMinimized: false } });
function applyWindowChrome(window: BrowserWindow): void { window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#101014' : '#f7f7f9'); }
function heartRoot(userData: string): string { const pointer = join(userData, 'heart-location.json'); if (!existsSync(pointer)) return userData; try { const data = JSON.parse(readFileSync(pointer, 'utf8')) as { heartDirectory?: string }; return data.heartDirectory && existsSync(data.heartDirectory) ? data.heartDirectory : userData; } catch { return userData; } }
function showWindow(notificationId?: string): void { if (!windowRef) { void createWindow(); return; } if (windowRef.isMinimized()) windowRef.restore(); windowRef.show(); windowRef.focus(); if (notificationId) emit({ type: 'notification_activated', id: notificationId }); }
function trayImage() { return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#bb2549"/><path d="M10 16h12M16 10v12" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>').toString('base64')); }
function updateTray(): void {
  const prefs = preferences();
  if (!prefs.tray.enabled) { tray?.destroy(); tray = null; return; }
  if (!tray) { tray = new Tray(trayImage()); tray.on('click', () => windowRef?.isVisible() ? windowRef.hide() : showWindow()); }
  const notices = store?.setting<{ count?: number }>('trayNoticeCount')?.count || 0;
  tray.setToolTip(notices ? `Escarlata — ${notices} pendientes` : 'Escarlata');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Escarlata', click: () => showWindow() },
    { label: 'Nueva conversación', click: () => { showWindow(); emit({ type: 'tray_new_chat' }); } },
    { label: notices ? `Notificaciones (${notices})` : 'Notificaciones', click: () => { showWindow(); emit({ type: 'open_notification_center' }); } },
    { type: 'separator' },
    { label: 'Pausar/Reanudar Heart', click: () => emit({ type: 'tray_toggle_heartbeat' }) },
    { label: 'Configuración', click: () => { showWindow(); emit({ type: 'open_app_settings' }); } },
    { type: 'separator' },
    { label: 'Salir de Escarlata', click: () => { isQuitting = true; app.quit(); } },
  ]));
}
function applyStartup(): void { const prefs = preferences(); app.setLoginItemSettings({ openAtLogin: prefs.startup.enabled, openAsHidden: prefs.startup.enabled && prefs.startup.startMinimized }); }
function savePreferences(value: DesktopPreferences): void { if (!store) return; const normalized = normalizeDesktopPreferences(value); store.setSetting('desktopPreferences', normalized); applyStartup(); updateTray(); emit({ type: 'desktop_preferences', preferences: normalized, startup: app.getLoginItemSettings().openAtLogin }); }
function controlWindow(action: 'minimize' | 'toggle_maximize' | 'close'): void { if (!windowRef) return; if (action === 'minimize') { windowRef.minimize(); return; } if (action === 'toggle_maximize') { windowRef.isMaximized() ? windowRef.unmaximize() : windowRef.maximize(); return; } windowRef.close(); }
async function createWindow(): Promise<void> {
  const userData = app.getPath('userData'); mkdirSync(userData, { recursive: true }); const heart = heartRoot(userData);
  Object.assign(process.env, { CONFIG_FILE: join(heart, 'config.json'), MEMORY_FILE: join(heart, 'memories.json'), NOTES_DIR: join(heart, 'notes'), CALENDAR_FILE: join(heart, 'calendar.json'), SCHEDULE_FILE: join(heart, 'schedule.json'), NOTICES_FILE: join(heart, 'notices.json'), DEFAULT_VAULT_DIR: join(userData, 'vault'), ESCARLATA_DATA_DIR: heart, ESCARLATA_BOOTSTRAP_DIR: userData });
  store = await LocalStore.open(defaultDatabasePath(heart)); store.importLegacy(join(process.cwd(), 'data'));
  service = new DesktopAgentService(store, new SecretVault(userData), event => {
    emit(event);
    if (event.type === 'notices') { const active = Array.isArray(event.active) ? event.active : []; store?.setSetting('trayNoticeCount', active.length); updateTray(); }
    if (event.type === 'notice_added') notificationService?.notify(event.notice as import('../../../../src/heartbeat/notices.js').Notice);
  });
  await service.init();
  notificationService = new DesktopNotificationService(preferences, id => showWindow(id));
  windowRef = new BrowserWindow({ width: 1440, height: 960, minWidth: 1000, minHeight: 700, show: !(preferences().startup.enabled && preferences().startup.startMinimized), frame: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#101014' : '#f7f7f9', webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  applyWindowChrome(windowRef); windowRef.once('ready-to-show', () => { if (!(preferences().startup.enabled && preferences().startup.startMinimized)) windowRef?.show(); });
  windowRef.on('close', event => { if (!isQuitting && preferences().tray.enabled && preferences().tray.closeToTray) { event.preventDefault(); windowRef?.hide(); } });
  (windowRef as BrowserWindow & { on(event: 'minimize', listener: (event: { preventDefault(): void }) => void): BrowserWindow }).on('minimize', (event: { preventDefault(): void }) => { if (preferences().tray.enabled && preferences().tray.minimizeToTray) { event.preventDefault(); windowRef?.hide(); } });
  windowRef.on('closed', () => { service?.denyPendingConfirmations(); windowRef = null; });
  windowRef.webContents.setWindowOpenHandler(({ url }) => { const googleAuth = url.startsWith('https://accounts.google.com/') || /^https:\/\/[^/]+\.firebaseapp\.com\/__\/auth\//.test(url); if (googleAuth) return { action: 'allow' }; void shell.openExternal(url); return { action: 'deny' }; });
  windowRef.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:') && !url.startsWith('http://localhost:5173')) event.preventDefault(); });
  if (process.env.ELECTRON_RENDERER_URL) await windowRef.loadURL(process.env.ELECTRON_RENDERER_URL); else await windowRef.loadFile(join(__dirname, '../renderer/index.html'));
  updateTray(); applyStartup(); emit({ type: 'desktop_preferences', preferences: preferences(), startup: app.getLoginItemSettings().openAtLogin });
}

app.whenReady().then(async () => {
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.googleapis.com https://securetoken.googleapis.com; frame-src https://accounts.google.com https://*.firebaseapp.com; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } }));
  nativeTheme.on('updated', () => { if (windowRef) applyWindowChrome(windowRef); });
  ipcMain.handle('escarlata:command', async (_event, raw) => {
    const parsed = desktopCommandSchema.safeParse(raw); if (!parsed.success) { emit({ type: 'error', code: 'INVALID_COMMAND', message: 'Comando inválido.' }); return null; }
    const command = parsed.data;
    if (command.type === 'window_control') { controlWindow(command.action); return null; }
    if (command.type === 'get_desktop_preferences') { emit({ type: 'desktop_preferences', preferences: preferences(), startup: app.getLoginItemSettings().openAtLogin }); return null; }
    if (command.type === 'set_desktop_preferences') { savePreferences(command.preferences); return null; }
    if (command.type === 'open_notification_center') { showWindow(); emit({ type: 'open_notification_center' }); return null; }
    if (command.type === 'test_desktop_notification') { notificationService?.test(); return null; }
    if (command.type === 'choose_directives_file') { const result = windowRef ? await dialog.showOpenDialog(windowRef, { title: 'Selecciona el archivo de pendientes', properties: ['openFile'], filters: [{ name: 'Pendientes y directivas', extensions: ['md', 'markdown', 'txt', 'org', 'rst'] }] }) : await dialog.showOpenDialog({ properties: ['openFile'] }); return result.canceled ? null : result.filePaths[0] || null; }
    if (command.type === 'choose_vault_directory' || command.type === 'choose_models_directory') { const result = windowRef ? await dialog.showOpenDialog(windowRef, { title: command.type === 'choose_models_directory' ? 'Selecciona la carpeta de modelos' : 'Selecciona la bóveda de Escarlata', properties: ['openDirectory', 'createDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0] || null; }
    await service?.command(command); return null;
  });
  await createWindow();
  app.on('activate', () => { if (!windowRef) void createWindow(); else showWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !preferences().tray.enabled) app.quit(); });
app.on('before-quit', () => { isQuitting = true; service?.dispose(); store?.close(); tray?.destroy(); tray = null; });
