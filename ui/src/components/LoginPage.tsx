import { useEffect, useRef, useState } from 'react';

type Profile={displayName:string;deviceId:string;firebaseUid?:string|null};
type AuthState={configured:boolean;username?:string;windowsHelloAvailable?:boolean;windowsHelloEnabled?:boolean;rememberSession?:boolean};
type Identified={username:string;exists:boolean;windowsHelloEnabled:boolean;windowsHelloAvailable:boolean}|null;
interface Props { profile:Profile|null; auth:AuthState; identified:Identified; error?:string; onSetup:(username:string,password:string,enableWindowsHello:boolean,rememberSession:boolean)=>void; onLogin:(username:string,password:string,rememberSession:boolean)=>void; onIdentify:(username:string)=>void; onGoogle:(uid:string)=>void; onHello:(username:string,rememberSession:boolean)=>void; }

const config={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID};
const firebaseReady=Boolean(config.apiKey&&config.authDomain&&config.projectId&&config.appId);

export function LoginPage({profile,auth,identified,error,onSetup,onLogin,onIdentify,onGoogle,onHello}:Props){
  const [localOpen,setLocalOpen]=useState(!auth.configured);const [stage,setStage]=useState<'username'|'password'>(auth.configured?'username':'password');const [username,setUsername]=useState(auth.username||profile?.displayName||'');const [password,setPassword]=useState('');
  const [message,setMessage]=useState('Elige cómo quieres abrir Escarlata.');const [formError,setFormError]=useState('');const [showPassword,setShowPassword]=useState(false);const [busy,setBusy]=useState(false);const [enableWindowsHello,setEnableWindowsHello]=useState(Boolean(auth.windowsHelloAvailable));const [rememberSession,setRememberSession]=useState(Boolean(auth.rememberSession));const helloAttempted=useRef('');const openedByUser=useRef(false);
  // La página se monta antes de que llegue auth_state; si el perfil resulta estar configurado,
  // vuelve a la portada salvo que el usuario ya haya abierto el formulario a mano.
  useEffect(()=>{if(auth.configured&&!openedByUser.current){setLocalOpen(false);setStage('username');setPassword('');}},[auth.configured]);
  useEffect(()=>{if(auth.username&&!openedByUser.current)setUsername(current=>current||auth.username||'');},[auth.username]);
  useEffect(()=>{setRememberSession(Boolean(auth.rememberSession));},[auth.rememberSession]);
  useEffect(()=>{if(!identified)return;if(!identified.exists){setFormError('No encontramos ese usuario local.');setStage('username');return;}setFormError('');if(identified.windowsHelloEnabled&&identified.windowsHelloAvailable&&helloAttempted.current!==identified.username){helloAttempted.current=identified.username;onHello(identified.username,rememberSession);return;}setStage('password');},[identified,onHello,rememberSession]);
  async function google(){if(!firebaseReady){setMessage('Firebase aún no está configurado en esta compilación. Puedes continuar con el perfil local.');return;}setBusy(true);try{const [{initializeApp,getApps},{getAuth,GoogleAuthProvider,signInWithPopup}]=await Promise.all([import('firebase/app'),import('firebase/auth')]);const app=getApps().find(item=>item.name==='escarlata-sync')||initializeApp(config,'escarlata-sync');const result=await signInWithPopup(getAuth(app),new GoogleAuthProvider());onGoogle(result.user.uid);}catch(problem){setMessage(problem instanceof Error?problem.message:'No se pudo iniciar sesión con Google.');}finally{setBusy(false);}}
  function submit(event:React.FormEvent){event.preventDefault();const clean=username.trim();
    if(!auth.configured){if(clean.length<2){setFormError('El usuario debe tener al menos 2 caracteres.');return;}if(password.length<10){setFormError(`La contraseña debe tener al menos 10 caracteres (llevas ${password.length}).`);return;}setFormError('');onSetup(clean,password,enableWindowsHello,rememberSession);return;}
    if(stage==='username'){if(!clean){setFormError('Escribe tu nombre de usuario para continuar.');return;}setFormError('');helloAttempted.current='';onIdentify(clean);return;}
    if(!password){setFormError('Introduce tu contraseña.');return;}setFormError('');onLogin(clean,password,rememberSession);}
  function back(){setFormError('');setShowPassword(false);if(auth.configured&&stage==='password'){setStage('username');setPassword('');return;}openedByUser.current=false;setLocalOpen(false);setStage(auth.configured?'username':'password');setPassword('');setMessage('Elige cómo quieres abrir Escarlata.');}
  return <main className="token-gate launch-page" aria-label="Inicio de sesión de Escarlata"><section className="hud-panel token-gate-panel launch-card">
    <div className="hud-corner tl"/><div className="hud-corner tr"/><div className="hud-corner bl"/><div className="hud-corner br"/>
    <div className="token-gate-title">E.S.C.A.R.L.A.T.A</div><div className="token-gate-sub">{auth.configured?'IDENTIFÍCATE PARA CONTINUAR':'CREA TU PERFIL LOCAL'}</div>
    {!localOpen?<><p className="launch-copy">Tu perfil local se protege en esta PC. Google es opcional y solo vincula la sincronización.</p><div className="launch-actions"><button className="pill-btn launch-primary" onClick={()=>{openedByUser.current=true;setLocalOpen(true);setStage(auth.configured?'username':'password');setMessage(auth.configured?'Escribe tu usuario local para continuar.':'Crea tu perfil local: usuario y una contraseña de 10+ caracteres.');}}>{auth.configured?'INICIAR SESIÓN':'CREAR USUARIO LOCAL'}</button><button className="pill-btn launch-primary" disabled={busy} onClick={()=>void google()}>{busy?'ABRIENDO GOOGLE…':'CONTINUAR CON GOOGLE'}</button></div></>:<form onSubmit={submit} className="launch-form">
      {auth.configured&&stage==='password'&&<button type="button" className="launch-user" onClick={back} title="Cambiar de usuario">USUARIO · {username||identified?.username||'—'} <span aria-hidden="true">✕</span></button>}
      {(stage==='username'||!auth.configured)&&<label>USUARIO<input autoFocus autoComplete="username" value={username} onChange={event=>{setUsername(event.target.value);if(formError)setFormError('');}} placeholder="Tu nombre de usuario"/></label>}
      {(stage==='password'||!auth.configured)&&<label>CONTRASEÑA<span className="launch-password"><input autoFocus={stage==='password'} type={showPassword?'text':'password'} autoComplete={auth.configured?'current-password':'new-password'} value={password} onChange={event=>{setPassword(event.target.value);if(formError)setFormError('');}} placeholder={auth.configured?'Introduce tu contraseña':'Mínimo 10 caracteres'}/><button type="button" className="launch-password-toggle" onClick={()=>setShowPassword(current=>!current)} aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'}>{showPassword?'OCULTAR':'VER'}</button></span></label>}
      <label className="wizard-check"><input type="checkbox" checked={rememberSession} onChange={event=>setRememberSession(event.target.checked)}/> Recordar sesión en este equipo</label>
      {!auth.configured&&auth.windowsHelloAvailable&&<label className="wizard-check"><input type="checkbox" checked={enableWindowsHello} onChange={event=>setEnableWindowsHello(event.target.checked)}/> Activar Windows Hello como segundo método de inicio</label>}
      <button className="pill-btn launch-primary" type="submit">{!auth.configured?'CREAR PERFIL Y CONTINUAR':stage==='username'?'CONTINUAR':'INICIAR SESIÓN'}</button>
      {auth.configured&&stage==='password'&&identified?.windowsHelloEnabled&&identified?.windowsHelloAvailable&&<button className="pill-btn" type="button" onClick={()=>onHello(username,rememberSession)}>USAR WINDOWS HELLO</button>}
      <button className="pill-btn" type="button" onClick={back}>VOLVER</button>
    </form>}
    <p className="launch-status">{(formError||error)?<span className="launch-error" role="alert">{formError||error}</span>:message}<br/>Dispositivo: {profile?.deviceId?.slice(0,8)||'—'}{auth.windowsHelloAvailable?' · Windows Hello disponible':''}</p>
  </section></main>;
}
