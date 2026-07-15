import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronDown, Cloud, Cpu, FolderHeart, HardDrive, LockKeyhole, Monitor, Search, Settings2, ShieldCheck, UserRound, Wrench, X } from 'lucide-react';
import type { DesktopPreferences } from '../types';

type Section = 'general' | 'profile' | 'heart' | 'providers' | 'sync' | 'privacy' | 'developer';
type Profile = { displayName: string; deviceId: string; firebaseUid?: string | null } | null;

// Ordenadas por grupo: la cabecera de grupo se pinta cuando cambia respecto a la entrada anterior.
const entries: { id: Section; label: string; group: string; icon: typeof Settings2; detail: string }[] = [
  { id: 'general', label: 'General', group: 'Aplicación', icon: Settings2, detail: 'Apariencia y comportamiento' },
  { id: 'developer', label: 'Diagnóstico', group: 'Aplicación', icon: Wrench, detail: 'Información de instalación' },
  { id: 'profile', label: 'Perfil', group: 'Cuenta', icon: UserRound, detail: 'Identidad local y acceso' },
  { id: 'privacy', label: 'Privacidad', group: 'Cuenta', icon: LockKeyhole, detail: 'Secretos y protección' },
  { id: 'heart', label: 'Heart y bóveda', group: 'Datos', icon: FolderHeart, detail: 'Datos locales y documentos' },
  { id: 'sync', label: 'Sincronización', group: 'Datos', icon: Cloud, detail: 'Google y dispositivos' },
  { id: 'providers', label: 'Proveedores', group: 'Modelos', icon: Cpu, detail: 'Modelos disponibles en esta PC' },
];

function Row({ label, children, note }: { label: string; children?: React.ReactNode; note?: string }) {
  return <div className="app-settings-row"><div><strong>{label}</strong>{note && <small>{note}</small>}</div>{children}</div>;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (next: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`app-settings-toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)} />;
}

function MenuSelect({ value, options, ariaLabel, onChange }: { value: string; options: { value: string; label: string }[]; ariaLabel: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPress = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    // Captura para que Escape cierre el menú sin llegar al handler que cierra el diálogo entero.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', onPress);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onPress); window.removeEventListener('keydown', onKey, true); };
  }, [open]);
  const current = options.find(option => option.value === value);
  return <div className="app-settings-select" ref={rootRef}>
    <button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}>{current?.label ?? value}<ChevronDown size={13}/></button>
    {open && <div className="app-settings-select-menu" role="listbox">
      {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'selected' : ''} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}
    </div>}
  </div>;
}

const hourOptions = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, '0')}:00` }));

const fallbackPreferences: DesktopPreferences = { notifications: { enabled: true, minimumSeverity: 'important', sound: true, doNotDisturb: { enabled: false, startHour: 23, endHour: 7, allowImportant: true } }, tray: { enabled: true, showUnreadBadge: true, closeToTray: false, minimizeToTray: false }, startup: { enabled: false, startMinimized: false } };

export function AppSettings({ profile, vaultDirectory, preferences, windowsHelloAvailable, windowsHelloEnabled, rememberSession, onSetWindowsHello, onSetRememberSession, onSavePreferences, onTestNotification, onClose, onOpenProviders, onOpenSync }: { profile: Profile; vaultDirectory?: string; preferences: DesktopPreferences | null; windowsHelloAvailable: boolean; windowsHelloEnabled: boolean; rememberSession: boolean; onSetWindowsHello: (enabled: boolean) => void; onSetRememberSession: (enabled: boolean) => void; onSavePreferences: (preferences: DesktopPreferences) => void; onTestNotification: () => void; onClose: () => void; onOpenProviders: () => void; onOpenSync: () => void }) {
  const [section, setSection] = useState<Section>('general');
  const [query, setQuery] = useState('');
  const [appearance, setAppearance] = useState<'system' | 'dark'>(() => (localStorage.getItem('escarlata.appearance') === 'dark' ? 'dark' : 'system'));
  const pickAppearance = (mode: 'system' | 'dark') => { setAppearance(mode); localStorage.setItem('escarlata.appearance', mode); };
  const [desktop, setDesktop] = useState<DesktopPreferences>(preferences || fallbackPreferences);
  useEffect(() => { if (preferences) setDesktop(preferences); }, [preferences]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  const updateDesktop = (next: DesktopPreferences) => { setDesktop(next); onSavePreferences(next); };
  const visible = useMemo(() => entries.filter(item => `${item.label} ${item.detail} ${item.group}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const title = entries.find(item => item.id === section)?.label || 'Configuración';
  const open = (callback: () => void) => { onClose(); callback(); };
  return <div className="app-settings-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="app-settings-shell" role="dialog" aria-modal="true" aria-label="Configuración de Escarlata" onMouseDown={event => event.stopPropagation()}>
      <aside className="app-settings-nav">
        <div className="app-settings-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar" aria-label="Buscar configuración"/></div>
        {visible.map((item, index) => <div key={item.id}>{(index === 0 || visible[index - 1].group !== item.group) && <div className="app-settings-group">{item.group}</div>}<button className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><item.icon size={16}/><span>{item.label}</span></button></div>)}
        {visible.length === 0 && <div className="app-settings-empty">Sin resultados para «{query}»</div>}
      </aside>
      <main className="app-settings-main">
        <header><div><span>ESCARLATA · AJUSTES</span><h1>{title}</h1></div><button className="app-settings-close" onClick={onClose} aria-label="Cerrar configuración"><X size={18}/></button></header>
        {section === 'general' && <div className="app-settings-page"><h2>Experiencia</h2><Row label="Apariencia" note="El marco de la ventana sigue el modo del sistema."><div className="app-settings-segment"><button className={appearance === 'system' ? 'selected' : ''} onClick={() => pickAppearance('system')}><Monitor size={14}/> Sistema</button><button className={appearance === 'dark' ? 'selected' : ''} onClick={() => pickAppearance('dark')}><Settings2 size={14}/> Oscuro</button></div></Row><Row label="Atajos" note="Espacio abre la terminal; V activa voz cuando el foco no está en un campo."><span className="app-settings-value">ACTIVOS</span></Row><h2 style={{marginTop:28}}>Notificaciones y bandeja</h2><Row label="Notificaciones del sistema" note="Avisos nativos incluso cuando la ventana está oculta."><Toggle label="Notificaciones del sistema" checked={desktop.notifications.enabled} onChange={enabled => updateDesktop({...desktop, notifications: {...desktop.notifications, enabled}})} /></Row><Row label="Avisarme desde"><div className="app-settings-segment">{([['important','Importantes'],['notice','Avisos'],['info','Todo']] as const).map(([value, text]) => <button key={value} className={desktop.notifications.minimumSeverity === value ? 'selected' : ''} onClick={() => updateDesktop({...desktop, notifications: {...desktop.notifications, minimumSeverity: value}})}>{text}</button>)}</div></Row><Row label="Sonido"><Toggle label="Sonido de notificaciones" checked={desktop.notifications.sound} onChange={sound => updateDesktop({...desktop, notifications: {...desktop.notifications, sound}})} /></Row><Row label="No molestar" note="No envía avisos durante este horario."><Toggle label="No molestar" checked={desktop.notifications.doNotDisturb.enabled} onChange={enabled => updateDesktop({...desktop, notifications: {...desktop.notifications, doNotDisturb: {...desktop.notifications.doNotDisturb, enabled}}})} /></Row>{desktop.notifications.doNotDisturb.enabled && <Row label="Horario de silencio" note="Desde la hora de inicio hasta la de fin, cada día."><span className="app-settings-hours"><MenuSelect ariaLabel="Hora de inicio de No molestar" value={String(desktop.notifications.doNotDisturb.startHour)} options={hourOptions} onChange={value => updateDesktop({...desktop, notifications: {...desktop.notifications, doNotDisturb: {...desktop.notifications.doNotDisturb, startHour: Number(value)}}})} /><span>a</span><MenuSelect ariaLabel="Hora de fin de No molestar" value={String(desktop.notifications.doNotDisturb.endHour)} options={hourOptions} onChange={value => updateDesktop({...desktop, notifications: {...desktop.notifications, doNotDisturb: {...desktop.notifications.doNotDisturb, endHour: Number(value)}}})} /></span></Row>}{desktop.notifications.doNotDisturb.enabled && <Row label="Permitir importantes en No molestar" note="Los avisos críticos atraviesan el horario de silencio."><Toggle label="Permitir importantes en No molestar" checked={desktop.notifications.doNotDisturb.allowImportant} onChange={allowImportant => updateDesktop({...desktop, notifications: {...desktop.notifications, doNotDisturb: {...desktop.notifications.doNotDisturb, allowImportant}}})} /></Row>}<Row label="Icono en bandeja del sistema"><Toggle label="Icono en bandeja del sistema" checked={desktop.tray.enabled} onChange={enabled => updateDesktop({...desktop, tray: {...desktop.tray, enabled, closeToTray: enabled ? desktop.tray.closeToTray : false, minimizeToTray: enabled ? desktop.tray.minimizeToTray : false}, startup: {...desktop.startup, startMinimized: enabled ? desktop.startup.startMinimized : false}})} /></Row><Row label="Minimizar a bandeja" note="Requiere el icono de bandeja activo."><Toggle label="Minimizar a bandeja" disabled={!desktop.tray.enabled} checked={desktop.tray.minimizeToTray} onChange={minimizeToTray => updateDesktop({...desktop, tray: {...desktop.tray, minimizeToTray}})} /></Row><Row label="Cerrar a bandeja" note="La X ocultará Escarlata; usa Salir desde el icono para terminarla."><Toggle label="Cerrar a bandeja" disabled={!desktop.tray.enabled} checked={desktop.tray.closeToTray} onChange={closeToTray => updateDesktop({...desktop, tray: {...desktop.tray, closeToTray}})} /></Row><Row label="Abrir al iniciar Windows"><Toggle label="Abrir al iniciar Windows" checked={desktop.startup.enabled} onChange={enabled => updateDesktop({...desktop, startup: {...desktop.startup, enabled}})} /></Row><Row label="Iniciar minimizada" note="Requiere icono de bandeja e inicio automático."><Toggle label="Iniciar minimizada" disabled={!desktop.tray.enabled || !desktop.startup.enabled} checked={desktop.startup.startMinimized} onChange={startMinimized => updateDesktop({...desktop, startup: {...desktop.startup, startMinimized}})} /></Row><button className="app-settings-action" onClick={onTestNotification}><Bell size={16}/> Enviar notificación de prueba</button></div>}
        {section === 'profile' && <div className="app-settings-page"><h2>Perfil local</h2><Row label="Nombre"><span className="app-settings-value">{profile?.displayName || 'Usuario local'}</span></Row><Row label="Dispositivo"><code>{profile?.deviceId?.slice(0, 8) || '—'}</code></Row><Row label="Cuenta Google" note="Solo vincula sincronización; no sustituye tu cuenta Windows."><span className="app-settings-value">{profile?.firebaseUid ? 'VINCULADA' : 'NO VINCULADA'}</span></Row></div>}
        {section === 'heart' && <div className="app-settings-page"><h2>Heart y bóveda</h2><p className="app-settings-copy">Heart guarda los datos de Escarlata dentro de la bóveda elegida. Las claves y credenciales protegidas por Windows quedan fuera.</p><Row label="Bóveda"><code>{vaultDirectory || 'Aún no configurada'}</code></Row><Row label="Directorio Heart" note="Base local, conversaciones, memorias, preferencias y auditoría."><code>{vaultDirectory ? `${vaultDirectory}\\heart` : '—'}</code></Row><Row label="Documentos"><span className="app-settings-value">SE INDEXAN LOCALMENTE</span></Row></div>}
        {section === 'providers' && <div className="app-settings-page"><h2>Proveedores y modelos</h2><p className="app-settings-copy">Cada PC conserva su propia disponibilidad de Claude, ChatGPT/Codex, API keys y modelos locales.</p><button className="app-settings-action" onClick={() => open(onOpenProviders)}><Cpu size={16}/> Abrir proveedores y modelos</button></div>}
        {section === 'sync' && <div className="app-settings-page"><h2>Sincronización</h2><p className="app-settings-copy">Heart se sincroniza como datos estructurados con Firestore. La bóveda completa requiere Firebase Storage para transferir archivos de forma fiable.</p><Row label="Estado"><span className="app-settings-value">{profile?.firebaseUid ? 'GOOGLE VINCULADO' : 'SOLO LOCAL'}</span></Row><button className="app-settings-action" onClick={() => open(onOpenSync)}><Cloud size={16}/> Abrir sincronización</button></div>}
        {section === 'privacy' && <div className="app-settings-page"><h2>Privacidad y seguridad</h2><Row label="Credenciales"><span className="app-settings-value"><ShieldCheck size={14}/> DPAPI · SOLO ESTA PC</span></Row><Row label="Contenido Heart" note="Protegido por Firebase Auth y reglas al sincronizarse."><span className="app-settings-value">CONTROLADO</span></Row><Row label="Modelo y secretos"><span className="app-settings-value">NUNCA SE SINCRONIZAN</span></Row><h2 style={{marginTop:28}}>Métodos de inicio y 2FA</h2><Row label="Contraseña local" note="Método de recuperación obligatorio para este perfil."><span className="app-settings-value">ACTIVA</span></Row><Row label="Windows Hello" note={windowsHelloAvailable?'Usa el PIN, rostro o huella de Windows después de reconocer tu usuario.':'Windows Hello no está disponible en este equipo.'}><Toggle label="Windows Hello" disabled={!windowsHelloAvailable} checked={windowsHelloEnabled} onChange={onSetWindowsHello} /></Row><Row label="Recordar sesión" note="Desbloquea Escarlata automáticamente solo en esta cuenta de Windows."><Toggle label="Recordar sesión" checked={rememberSession} onChange={onSetRememberSession} /></Row><p className="app-settings-copy">Windows Hello y la sesión recordada nunca se sincronizan ni reemplazan la contraseña de recuperación.</p></div>}
        {section === 'developer' && <div className="app-settings-page"><h2>Diagnóstico</h2><Row label="Plataforma"><span className="app-settings-value">WINDOWS · ELECTRON</span></Row><Row label="Almacenamiento"><span className="app-settings-value"><HardDrive size={14}/> HEART LOCAL</span></Row></div>}
      </main>
    </section>
  </div>;
}
