import { useEffect, useState } from 'react';

type Profile={id:string;displayName:string;deviceId:string;firebaseUid?:string|null;lastSyncAt?:string|null};
type Snapshot={profile:Profile;scope:'heart'|'vault';heart:{format:number;conversations:{id:string;title:string;createdAt:string;updatedAt:string;messages:{id:string;role:string;content:unknown;createdAt:string;sequence:number}[]}[];facts:{id:string;content:string;category:string;createdAt:string;updatedAt:string}[];preferences?:Record<string,unknown>};vault?:{status:string;message:string}};

interface Props { profile:Profile|null; snapshot:Snapshot|null; onCommand:(command:unknown)=>void; onClose:()=>void; }
const firebaseConfig={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID};
const configured=Boolean(firebaseConfig.apiKey&&firebaseConfig.authDomain&&firebaseConfig.projectId&&firebaseConfig.appId);

/** Cloud sync is deliberately isolated from providers: this component never sees API keys. */
export function SyncSettings({profile,snapshot,onCommand,onClose}:Props){
  const [status,setStatus]=useState(profile?.firebaseUid?'Conectado a Google.':'Solo local.');
  const [busy,setBusy]=useState(false);
  const [scope,setScope]=useState<'heart'|'vault'>('heart');
  useEffect(()=>{if(profile?.firebaseUid)setStatus('Conectado a Google.');},[profile?.firebaseUid]);
  useEffect(()=>{if(snapshot)void upload(snapshot);},[snapshot]);
  async function connect(){
    if(!configured){setStatus('Falta la configuración pública VITE_FIREBASE_* para Escarlata-ia.');return;}
    setBusy(true);try{
      const [{initializeApp,getApps},{getAuth,GoogleAuthProvider,signInWithPopup}]=await Promise.all([import('firebase/app'),import('firebase/auth')]);
      const app=getApps().find(item=>item.name==='escarlata-sync')||initializeApp(firebaseConfig,'escarlata-sync');
      const result=await signInWithPopup(getAuth(app),new GoogleAuthProvider());
      onCommand({type:'sync_link',uid:result.user.uid});setStatus(`Vinculado como ${result.user.email||'Google'}.`);
    }catch(error){setStatus(error instanceof Error?error.message:'No fue posible conectar Google.');}finally{setBusy(false);}
  }
  async function upload(data:Snapshot){
    if(!configured||!data.profile.firebaseUid){setStatus('Sin cuenta Google vinculada.');return;}
    setBusy(true);try{
      const [{initializeApp,getApps},{getAuth},{getFirestore,doc,writeBatch,serverTimestamp}]=await Promise.all([import('firebase/app'),import('firebase/auth'),import('firebase/firestore')]);
      const app=getApps().find(item=>item.name==='escarlata-sync')||initializeApp(firebaseConfig,'escarlata-sync');const auth=getAuth(app);if(auth.currentUser?.uid!==data.profile.firebaseUid)throw new Error('La sesión Google actual no coincide con el perfil local.');
      const db=getFirestore(app);const batch=writeBatch(db);const root=`users/${data.profile.firebaseUid}`;const heart=data.heart;
      batch.set(doc(db,root,'profile'),{localProfileId:data.profile.id,displayName:data.profile.displayName,syncScope:data.scope,heartFormat:heart.format,updatedAt:serverTimestamp()},{merge:true});
      batch.set(doc(db,root,'devices',data.profile.deviceId),{deviceId:data.profile.deviceId,updatedAt:serverTimestamp()},{merge:true});
      for(const conversation of heart.conversations){batch.set(doc(db,root,'conversations',conversation.id),{title:conversation.title,createdAt:conversation.createdAt,updatedAt:conversation.updatedAt,deviceId:data.profile.deviceId},{merge:true});for(const message of conversation.messages)batch.set(doc(db,root,'conversations',conversation.id,'messages',message.id),{role:message.role,content:message.content,createdAt:message.createdAt,sequence:message.sequence,deviceId:data.profile.deviceId},{merge:true});}
      for(const fact of heart.facts)batch.set(doc(db,root,'memories',fact.id),{...fact,deviceId:data.profile.deviceId},{merge:true});
      if(heart.preferences)batch.set(doc(db,root,'preferences','heart'),{...heart.preferences,updatedAt:serverTimestamp()},{merge:true});
      await batch.commit();setStatus(data.scope==='vault'?`Heart sincronizado: ${heart.conversations.length} conversaciones. ${data.vault?.message||''}`:`Heart sincronizado: ${heart.conversations.length} conversaciones.`);
    }catch(error){setStatus(error instanceof Error?error.message:'La sincronización falló.');}finally{setBusy(false);}
  }
  return <div onClick={onClose} style={{position:'fixed',inset:0,zIndex:10000,display:'grid',placeItems:'center',background:'rgba(0,0,0,.72)'}}><section onClick={event=>event.stopPropagation()} style={{width:'min(480px,calc(100vw - 32px))',padding:24,border:'1px solid var(--accent-line)',background:'var(--bg-overlay)',fontFamily:'var(--font-mono,monospace)'}}>
    <div style={{color:'var(--accent-bright)',letterSpacing:'.13em',marginBottom:14}}>SINCRONIZACIÓN EN LA NUBE</div>
    <p style={{fontSize:11,color:'var(--text-secondary)',lineHeight:1.6}}>Perfil local: {profile?.displayName||'cargando'} · Dispositivo: {profile?.deviceId?.slice(0,8)||'—'}</p>
    <p style={{fontSize:11,color:'var(--text-secondary)',lineHeight:1.6}}>Heart sincroniza conversaciones, memorias y preferencias seguras. Las claves de modelos y las credenciales DPAPI nunca salen de esta PC.</p>
    <fieldset style={{border:'1px solid var(--border-subtle)',padding:'10px 12px',margin:'14px 0',display:'grid',gap:8}}><legend style={{padding:'0 5px',fontSize:9,letterSpacing:'.12em',color:'var(--accent-text)'}}>QUÉ SINCRONIZAR</legend><label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:11,color:'var(--text-secondary)',cursor:'pointer'}}><input type="radio" name="sync-scope" checked={scope==='heart'} onChange={()=>setScope('heart')}/><span><b style={{color:'var(--text-primary)'}}>Solo Heart</b><br/>Datos de Escarlata; puedes usar otra bóveda en cada dispositivo.</span></label><label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:11,color:'var(--text-secondary)',cursor:'pointer'}}><input type="radio" name="sync-scope" checked={scope==='vault'} onChange={()=>setScope('vault')}/><span><b style={{color:'var(--text-primary)'}}>Heart y bóveda completa</b><br/>Heart se sincroniza ahora. Los archivos de bóveda requieren Firebase Storage y se pedirá una carpeta destino al importarlos.</span></label></fieldset>
    <div style={{fontSize:11,color:'var(--accent-text)',minHeight:34}}>{status}</div>
    <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>{profile?.firebaseUid?<><button className="pill-btn" disabled={busy} onClick={()=>onCommand({type:'sync_now',scope})}>SINCRONIZAR AHORA</button><button className="pill-btn" disabled={busy} onClick={()=>{onCommand({type:'sync_unlink'});setStatus('Desconectado.');}}>DESCONECTAR</button></>:<button className="pill-btn" disabled={busy} onClick={()=>void connect()}>CONECTAR GOOGLE</button>}<button className="pill-btn" onClick={onClose}>CERRAR</button></div>
  </section></div>;
}
