import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { SecretVault } from './secret-vault.js';

type PasswordRecord={username:string;salt:string;hash:string;windowsHelloEnabled?:boolean};
type SessionRecord={username:string;createdAt:string};

/** Local account verifier. Its only persisted copy is DPAPI-protected. */
export class LocalAuth {
  constructor(private readonly vault:SecretVault) {}
  private record():PasswordRecord|undefined { const raw=this.vault.get('local-account'); if(!raw)return; try{return JSON.parse(raw) as PasswordRecord;}catch{return;} }
  status():{configured:boolean;username?:string;windowsHelloEnabled?:boolean;rememberSession?:boolean}{const account=this.record();return{configured:Boolean(account),username:account?.username,windowsHelloEnabled:Boolean(account?.windowsHelloEnabled),rememberSession:Boolean(this.session())};}
  private session():SessionRecord|undefined {const raw=this.vault.get('local-session');if(!raw)return;try{return JSON.parse(raw) as SessionRecord;}catch{return;}}
  remember(username:string, enabled:boolean):void {if(!enabled){this.vault.remove('local-session');return;}this.vault.set('local-session',JSON.stringify({username:username.trim(),createdAt:new Date().toISOString()} satisfies SessionRecord));}
  restoreSession():boolean {const account=this.record();const session=this.session();if(!account||!session||account.username!==session.username)return false;return true;}
  identify(username:string):{exists:boolean;windowsHelloEnabled:boolean}{const account=this.record();const exists=Boolean(account&&account.username.toLocaleLowerCase()===username.trim().toLocaleLowerCase());return{exists,windowsHelloEnabled:Boolean(exists&&account?.windowsHelloEnabled)};}
  setWindowsHello(enabled:boolean):void {const account=this.record();if(!account)throw new Error('No hay un perfil local configurado.');this.vault.set('local-account',JSON.stringify({...account,windowsHelloEnabled:enabled}));}
  setup(username:string,password:string,windowsHelloEnabled=false):void { const clean=username.trim().slice(0,80);if(clean.length<2)throw new Error('El usuario debe tener al menos 2 caracteres.');if(password.length<10)throw new Error('La contraseña debe tener al menos 10 caracteres.');const salt=randomBytes(16).toString('base64');const hash=scryptSync(password,salt,64).toString('base64');this.vault.set('local-account',JSON.stringify({username:clean,salt,hash,windowsHelloEnabled})); }
  verify(username:string,password:string):boolean {const account=this.record();if(!account)return false;const actual=scryptSync(password,account.salt,64);const expected=Buffer.from(account.hash,'base64');return account.username===username.trim()&&expected.length===actual.length&&timingSafeEqual(expected,actual);}
}
