import { randomUUID } from 'node:crypto';
import { Agent, buildSystemPrompt, type ConfirmationResult } from '../../../../src/agent/core.js';
import { createProvider } from '../../../../src/provider/provider.js';
import { createTeam, historyToTranscript, type Team } from '../../../../src/agents/team.js';
import { getConfigManager } from '../../../../src/config/manager.js';
import { getMemoryStore } from '../../../../src/memory/store.js';
import { getProviderAuthService, type OAuthProvider } from '../../../../src/provider/auth-service.js';
import { UsageService, type VitalMetric, type VitalsProvider } from '../../../../src/server/usage.js';
import { UsageStatsService, type UsageStatsDay } from '../../../../src/server/stats.js';
import { getInstalledOllamaModels, scanLocalModelsDir } from '../../../../src/server/health.js';
import type { Provider, AuthMethod } from '../../../../src/provider/types.js';
import type { EscarlataConfig } from '../../../../src/config/manager.js';
import type { DesktopCommand } from '@escarlata/protocol';
import { LocalStore } from './local-store.js';
import { SecretVault } from './secret-vault.js';
import { LocalAuth } from './local-auth.js';
import { windowsHelloAvailable, verifyWindowsHello } from './windows-hello.js';
import { cpSync, existsSync, mkdirSync, type Dirent, writeFileSync } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { readDirectives } from '../../../../src/tools/directives.js';
import { setConversationSource } from '../../../../src/tools/conversations.js';
import { Heartbeat } from '../../../../src/heartbeat/index.js';
import { getNoticeBoard, type Notice } from '../../../../src/heartbeat/notices.js';
import { createSTTProvider } from '../../../../src/voice/stt.js';
import { convertToWav16k } from '../../../../src/voice/audio.js';
import { DEFAULT_MODELS } from '../../../../src/config/models.js';

type PendingConfirmation={resolve:(value:ConfirmationResult)=>void;timer:NodeJS.Timeout};
type TelemetryCache={metrics:VitalMetric[];updatedAt:string};
type UsageStatsCache={days:UsageStatsDay[];updatedAt:string};
type OnboardingWorkspace={completed?:boolean;vaultDirectory?:string;directivesFile?:string};
type VaultFile={name:string;path:string;modifiedAt:string};
const VAULT_EXTENSIONS=new Set(['.md','.markdown','.txt','.org','.rst','.json','.csv']);
export class DesktopAgentService {
  private agent!:Agent; private conversationId:string=randomUUID(); private active=false; private unlocked=false; private pending=new Map<string,PendingConfirmation>();
  private readonly localAuth:LocalAuth;
  private readonly providerAuth=getProviderAuthService();
  private readonly usage=new UsageService();
  private readonly usageStats=new UsageStatsService();
  private removeAuthListener: (() => void) | null = null;
  private telemetryTimer: NodeJS.Timeout | null = null;
  private heartbeat: Heartbeat | null = null;
  private team: Team | null = null;
  private readonly noticeBoard = getNoticeBoard();
  private noticeListener: ((notice: Notice) => void) | null = null;
  constructor(private readonly store:LocalStore,private readonly vault:SecretVault,private readonly emit:(event:Record<string,unknown>)=>void){this.localAuth=new LocalAuth(vault);}
  async init():Promise<void>{
    this.restoreWorkspaceConfiguration();
    this.migrateHeartWorkspace();
    // Amatista lee conversaciones reales del SQLite local, no del legado JSON.
    setConversationSource({
      list:()=>this.store.listConversations(),
      read:(id)=>{const messages=this.store.loadConversation(id);return messages.length?messages:null;},
    });
    this.unlocked=this.localAuth.restoreSession();
    const manager=getConfigManager();await manager.load();const config=manager.get();
    // Move credentials written by older versions out of JSON on the first desktop launch.
    for(const [name,secret] of Object.entries(config.apiKeys)) if(secret) this.vault.set(name,secret);
    if(Object.keys(config.apiKeys).length){ await manager.set('apiKeys',{}); }
    const selected=await this.resolveStartupProvider(config);
    const provider=selected.provider;
    const team=createTeam({getProvider:()=>this.agent?.getProvider()??provider,getConfirmationGate:()=>this.confirm,getSafetyRuleResolver:()=>action=>manager.getRule(action),onToolEvent:event=>this.emit({type:'tool_event',sub:event.type,name:event.name,input:event.input,result:event.result,duration:event.duration}),onMemoryCandidates:candidates=>{const inserted=this.store.addMemoryCandidates(candidates,this.conversationId);if(inserted)this.emitMemoryCandidates();}});
    this.team=team;
    this.agent=new Agent({provider,toolRegistry:team.registry,systemPrompt:buildSystemPrompt(team.registry,{surface:'chat'}),confirmationGate:this.confirm,onToolEvent:event=>this.emit({type:'tool_event',sub:event.type,name:event.name,input:event.input,result:event.result,duration:event.duration}),safetyRuleResolver:action=>manager.getRule(action)});
    this.agent.setProvider(provider,selected.name,selected.model);
    await this.agent.init();
    this.heartbeat = new Heartbeat({ registry: team.registry, tickInterval: config.heartbeatTickInterval * 1000, quietStart: config.heartbeatQuietStart, quietEnd: config.heartbeatQuietEnd });
    await this.heartbeat.init();
    this.noticeListener = (notice) => { this.emit({ type: 'notice_added', notice }); void this.emitNotices(); };
    this.noticeBoard.on('added', this.noticeListener);
    this.noticeBoard.on('change', () => { void this.emitNotices(); });
    this.heartbeat.start();
    this.removeAuthListener=this.providerAuth.onStatus(status=>{
      this.emit({type:'provider_auth_status',...status});
      if(status.state==='connected') void this.refreshProviderTelemetry(status.provider);
    });
    await this.sendState();
    void this.refreshWorkspaceState();
    void this.refreshProviderTelemetry('anthropic');
    void this.refreshProviderTelemetry('openai');
    void this.refreshLocalModelInventory();
    this.telemetryTimer=setInterval(()=>{void this.refreshProviderTelemetry('anthropic');void this.refreshProviderTelemetry('openai');},5*60_000);
  }
  private async resolveStartupProvider(config:EscarlataConfig):Promise<{provider:Provider;name:string;model:string}>{
    const preferred=process.env.MODEL_PROVIDER||config.modelProvider;
    const preferredModel=process.env.MODEL_NAME||config.modelName;
    const usable=async(name:string,model:string):Promise<{provider:Provider;name:string;model:string}|null>=>{
      const normalized=name.toLowerCase();const authMethod=config.authMethods[normalized]||'api_key';
      if(normalized==='anthropic'||normalized==='openai'){
        const connected=authMethod==='oauth_local'?(await this.providerAuth.getStatus(normalized)).state==='connected':Boolean(this.vault.get(normalized));
        if(!connected)return null;
      }
      try{return{provider:createProvider({provider:normalized,model,apiKey:this.vault.get(normalized),authMethod:authMethod as AuthMethod}),name:normalized,model};}catch{return null;}
    };
    if(preferred&&preferred!=='mock'){
      const chosen=await usable(preferred,preferredModel||'default');if(chosen)return chosen;
    }
    for(const name of ['anthropic','openai'] as const){
      const status=await this.providerAuth.getStatus(name);if(status.state==='connected'){
        const chosen=await usable(name,DEFAULT_MODELS[name]);if(chosen)return chosen;
      }
    }
    const local=await getInstalledOllamaModels();
    if(local.length){const chosen=await usable('ollama',preferred==='ollama'&&preferredModel?preferredModel:local[0].name);if(chosen)return chosen;}
    // Mock remains an offline implementation detail, never a provider presented in the UI.
    return{provider:createProvider({provider:'mock',model:'mock'}),name:'unconfigured',model:'Conecta un proveedor'};
  }
  private restoreWorkspaceConfiguration():void{
    const setup=this.store.setting<OnboardingWorkspace>('onboarding');
    if(setup?.vaultDirectory) process.env.OBSIDIAN_VAULT=setup.vaultDirectory;
    if(setup?.directivesFile) process.env.ESCARLATA_DIRECTIVES_FILE=setup.directivesFile;
  }
  // Debe cubrir TODO archivo con env-override propio: cualquier variable ya seteada
  // (p. ej. NOTICES_FILE en createWindow) le ganaría al fallback ESCARLATA_DATA_DIR.
  private setHeartEnvironment(heart:string):void{Object.assign(process.env,{CONFIG_FILE:join(heart,'config.json'),MEMORY_FILE:join(heart,'memories.json'),NOTES_DIR:join(heart,'notes'),CALENDAR_FILE:join(heart,'calendar.json'),SCHEDULE_FILE:join(heart,'schedule.json'),NOTICES_FILE:join(heart,'notices.json'),REMINDERS_FILE:join(heart,'reminders.json'),AUDIT_FILE:join(heart,'audit.log'),ESCARLATA_DATA_DIR:heart});}
  private migrateHeartWorkspace():void{
    const setup=this.store.setting<OnboardingWorkspace>('onboarding');const vault=setup?.vaultDirectory;
    if(!vault)return;
    const heart=join(resolve(vault),'heart');const userData=process.env.ESCARLATA_BOOTSTRAP_DIR||'';
    if(resolve(this.store.filePath())!==resolve(join(heart,'escarlata.db'))){
      mkdirSync(heart,{recursive:true});
      for(const name of ['config.json','memories.json','calendar.json','schedule.json','notices.json','reminders.json','audit.log','plan-vitals.json']){
        const source=join(userData,name),target=join(heart,name);if(existsSync(source)&&!existsSync(target))cpSync(source,target);
      }
      const notes=join(userData,'notes');if(existsSync(notes)&&!existsSync(join(heart,'notes')))cpSync(notes,join(heart,'notes'),{recursive:true});
      this.store.relocate(join(heart,'escarlata.db'));
      writeFileSync(join(userData,'heart-location.json'),JSON.stringify({vaultDirectory:resolve(vault),heartDirectory:heart,updatedAt:new Date().toISOString()}));
    }
    this.setHeartEnvironment(heart);
  }
  private async listVaultFiles(vaultDirectory:string):Promise<VaultFile[]>{
    const root=resolve(vaultDirectory);const files:VaultFile[]=[];
    const visit=async(directory:string,depth:number):Promise<void>=>{
      if(depth>6||files.length>=500)return;
      let entries:Dirent<string>[];
      try{entries=await readdir(directory,{withFileTypes:true,encoding:'utf8'});}catch{return;}
      for(const entry of entries){
        if(files.length>=500)break;
        if(entry.name==='.git'||entry.name==='node_modules'||entry.name==='heart'||entry.name.startsWith('.'))continue;
        const full=join(directory,entry.name);
        if(entry.isDirectory()){await visit(full,depth+1);continue;}
        if(!entry.isFile()||!VAULT_EXTENSIONS.has(extname(entry.name).toLowerCase()))continue;
        try{const info=await stat(full);files.push({name:entry.name,path:relative(root,full).replace(/\\/g,'/'),modifiedAt:info.mtime.toISOString()});}catch{/* File may change during the scan. */}
      }
    };
    await visit(root,0);return files.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));
  }
  private async refreshWorkspaceState():Promise<void>{
    const setup=this.store.setting<OnboardingWorkspace>('onboarding');
    const vaultDirectory=process.env.OBSIDIAN_VAULT||setup?.vaultDirectory;
    const files=vaultDirectory?await this.listVaultFiles(vaultDirectory):[];
    this.emit({type:'vault_files',files});
    this.emit({type:'directives',items:await readDirectives()});
  }
  private confirm=async(tool:string,input:Record<string,unknown>,description:string):Promise<ConfirmationResult>=>new Promise(resolve=>{const id=randomUUID();const timer=setTimeout(()=>{this.pending.delete(id);resolve('denied');},120_000);this.pending.set(id,{resolve,timer});this.emit({type:'confirmation',id,tool,input,description});});
  private defaultModelsDirectory():string{return process.env.OLLAMA_MODELS||join(homedir(),'.ollama','models');}
  private modelsDirectory():string{return this.store.setting<string>('modelsDirectory')||this.defaultModelsDirectory();}
  private async scanModelsDirectory(directory:string):Promise<void>{
    const selected=resolve(directory.trim()||this.defaultModelsDirectory());
    try{
      const info=await stat(selected);
      if(!info.isDirectory()) throw new Error('La ruta seleccionada no es una carpeta.');
      const files=await scanLocalModelsDir(selected);
      this.store.setSetting('modelsDirectory',selected);
      this.emit({type:'models_dir_result',directory:selected,files,scannedAt:new Date().toISOString()});
    }catch(error){
      this.emit({type:'models_dir_result',directory:selected,files:[],error:error instanceof Error?error.message:'No se pudo leer la carpeta de modelos.'});
    }
  }
  private async refreshLocalModelInventory():Promise<void>{
    const [ollamaModels]=await Promise.all([getInstalledOllamaModels(),this.scanModelsDirectory(this.modelsDirectory())]);
    this.emit({type:'ollama_models',models:ollamaModels});
  }
  private cachedTelemetry(provider:VitalsProvider):TelemetryCache|undefined{return this.store.setting<TelemetryCache>(`telemetry:${provider}`);}
  private cachedUsageStats():UsageStatsCache|undefined{return this.store.setting<UsageStatsCache>('usageStatsCache');}
  private async sendState():Promise<void>{const config=getConfigManager().get();const auth={...this.localAuth.status(),windowsHelloAvailable:false,unlocked:this.unlocked};const anthropicCache=this.cachedTelemetry('anthropic');const openAICache=this.cachedTelemetry('openai');const statsCache=this.cachedUsageStats();this.emit({type:'auth_ok'});this.emit({type:'state',desktop:true,profile:this.store.profile(),auth,onboarding:this.store.setting('onboarding')||{completed:false},defaultVaultDirectory:process.env.DEFAULT_VAULT_DIR||'vault',modelsDir:this.modelsDirectory(),history:this.agent.getHistory(),tools:this.agent.getToolDefinitions(),config:{...config,apiKeys:{}},facts:await getMemoryStore().getAll(),memoryCandidates:this.store.listMemoryCandidates(),conversations:this.store.listConversations(),currentConvId:this.conversationId,vitalsByProvider:{anthropic:anthropicCache?.metrics||null,openai:openAICache?.metrics||null},telemetryCache:{anthropic:anthropicCache?.updatedAt,openai:openAICache?.updatedAt},usageStats:statsCache?.days||[]});void windowsHelloAvailable().then(available=>this.emit({type:'auth_state',...this.localAuth.status(),windowsHelloAvailable:available,unlocked:this.unlocked}));}
  private async emitNotices(): Promise<void> { this.emit({ type: 'notices', active: await this.noticeBoard.getActive(), all: await this.noticeBoard.getAll() }); }
  private emitMemoryCandidates(): void { this.emit({ type: 'memory_candidates', candidates: this.store.listMemoryCandidates() }); }
  /** Análisis Amatista en background sobre la conversación al abandonarla (cambio de chat, chat nuevo, cierre). */
  private analyzeCurrentConversation(): void {
    const history = this.agent?.getHistory() ?? [];
    if (history.length < 2) return;
    this.team?.analyzeConversation(historyToTranscript(history));
  }
  private telemetryPlaceholder(provider: VitalsProvider, status: string): VitalMetric[] {
    const label=provider==='openai'?'CHATGPT':'CLAUDE';
    return [
      {label:'ACCOUNT',value:label,subvalue:'CONNECTED',visual:'none',sparkData:[]},
      {label:'TELEMETRY',value:'SYNCING',note:status,visual:'none',sparkData:[]},
    ];
  }
  private async refreshProviderTelemetry(provider: OAuthProvider):Promise<void>{
    const status=await this.providerAuth.getStatus(provider);
    const cached=this.cachedTelemetry(provider);
    this.emit({type:'provider_auth_status',...status});
    if(status.state!=='connected'){
      if(cached?.metrics.length){
        this.emit({type:'vitals',provider,metrics:cached.metrics,cached:true,updatedAt:cached.updatedAt,error:`${status.message||'Sin conexión.'} Mostrando la última lectura guardada.`});
      }else this.emit({type:'vitals',provider,metrics:[],error:status.message||'Conecta esta cuenta para consultar métricas.'});
      return;
    }
    // Never leave a connected account visually blank while its provider data is loading.
    this.emit({type:'vitals',provider,metrics:cached?.metrics||this.usage.getVitals(provider)||this.telemetryPlaceholder(provider,status.message||'Consultando datos de la cuenta…'),cached:Boolean(cached),updatedAt:cached?.updatedAt});
    try{
      const metrics=await this.usage.refreshProvider(provider);
      const updatedAt=new Date().toISOString();
      this.store.setSetting(`telemetry:${provider}`,{metrics,updatedAt} satisfies TelemetryCache);
      this.emit({type:'vitals',provider,metrics,cached:false,updatedAt});
    }catch(error){
      const message=error instanceof Error?error.message:'No se pudieron actualizar las métricas.';
      this.emit({type:'vitals',provider,metrics:cached?.metrics||this.telemetryPlaceholder(provider,'Los datos del proveedor aún no están disponibles.'),cached:Boolean(cached),updatedAt:cached?.updatedAt,error:cached?'Mostrando la última lectura guardada.':'No se pudo actualizar la telemetría: '+message});
    }
    try{const days=await this.usageStats.refresh();const updatedAt=new Date().toISOString();this.store.setSetting('usageStatsCache',{days,updatedAt} satisfies UsageStatsCache);this.emit({type:'usage_stats',days,cached:false,updatedAt});}catch{/* Usage history is supplementary to account metrics. */}
  }
  /** Voz push-to-talk: webm/opus del renderer -> WAV 16k (ffmpeg) -> whisper local -> turno normal. */
  private async handleAudio(data:string,mime?:string):Promise<void>{
    if(!this.unlocked){this.emit({type:'error',code:'AUTH_REQUIRED',message:'Inicia sesión para usar Escarlata.'});return;}
    if(this.active){this.emit({type:'error',code:'TURN_ACTIVE',message:'Ya hay una respuesta en curso.'});return;}
    try{
      const audio=Buffer.from(data,'base64');
      if(!audio.length)throw new Error('El audio llegó vacío.');
      const ext=/ogg/i.test(mime||'')?'ogg':/wav/i.test(mime||'')?'wav':/mp4|m4a|aac/i.test(mime||'')?'m4a':'webm';
      const wav=await convertToWav16k(audio,ext);
      const stt=createSTTProvider('whisper');
      let text='';
      for await(const part of stt.transcribe(wav,'audio/wav'))text+=part;
      text=text.trim();
      if(!text)throw new Error('No se entendió nada en el audio. Intenta de nuevo.');
      this.emit({type:'transcript',text});
      await this.runTurn(text);
    }catch(error){
      this.emit({type:'error',code:'VOICE_FAILED',message:error instanceof Error?error.message:'No se pudo transcribir el audio.'});
    }
  }
  /** Prueba mínima de credencial: pide un token y cancela el stream. Devuelve el error o null si funciona. */
  private async probeProvider(provider:Provider):Promise<string|null>{
    try{
      const iterator=provider.complete([
        {role:'system',content:'Prueba de conexión. Responde solo "ok".'},
        {role:'user',content:'ok'},
      ])[Symbol.asyncIterator]();
      const timeout=new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('El proveedor no respondió en 15 segundos.')),15_000));
      await Promise.race([iterator.next(),timeout]);
      await iterator.return?.(undefined);
      return null;
    }catch(error){
      return error instanceof Error?error.message:'No se pudo validar la credencial.';
    }
  }
  private async runTurn(content:string):Promise<void>{if(!this.unlocked){this.emit({type:'error',code:'AUTH_REQUIRED',message:'Inicia sesión para usar Escarlata.'});return;}if(this.active){this.emit({type:'error',code:'TURN_ACTIVE',message:'Ya hay una respuesta en curso.'});return;}this.active=true;let full='';try{for await(const token of this.agent.processTurn(content)){full+=token;this.emit({type:'token',token});}this.store.saveConversation(this.conversationId,this.agent.getHistory());this.emit({type:'response',content:full});this.emit({type:'conversations',list:this.store.listConversations(),currentConvId:this.conversationId});this.emit({type:'memories',facts:await getMemoryStore().getAll()});}catch(error){this.emit({type:'error',code:'TURN_FAILED',message:error instanceof Error?error.message:String(error)});}finally{this.active=false;}}
  async command(command:DesktopCommand):Promise<void>{switch(command.type){
    case 'message':return this.runTurn(command.content);
    case 'audio':return this.handleAudio(command.data,command.mime);
    case 'confirm':{const pending=this.pending.get(command.id);if(pending){clearTimeout(pending.timer);this.pending.delete(command.id);pending.resolve(command.decision);this.emit({type:'confirm_result',id:command.id,decision:command.decision});}return;}
    case 'abort':this.agent.stop();this.emit({type:'aborted'});return;
    case 'get_state':await this.sendState();void this.refreshWorkspaceState();return;
    case 'get_notices': return this.emitNotices();
    case 'dismiss_notice': { const dismissed = await this.noticeBoard.dismiss(command.id); if (dismissed) this.emit({ type: 'notice_dismissed', id: command.id }); return; }
    case 'set_heartbeat': if (command.paused) this.heartbeat?.pause(); else this.heartbeat?.resume(); return;
    case 'new_chat':this.analyzeCurrentConversation();this.conversationId=randomUUID();this.agent.clearHistory();this.emit({type:'history_cleared'});this.emit({type:'greeting',content:'¡Hola! ¿En qué puedo ayudarte hoy?'});return;
    case 'switch_chat':this.analyzeCurrentConversation();this.conversationId=command.id;this.agent.restoreHistory(this.store.loadConversation(command.id));return this.sendState();
    case 'delete_conversation':this.store.deleteConversation(command.id);if(command.id===this.conversationId){this.conversationId=randomUUID();this.agent.clearHistory();}this.emit({type:'conversations',list:this.store.listConversations(),currentConvId:this.conversationId});return;
    case 'rename_conversation':this.store.renameConversation(command.id,command.title);this.emit({type:'conversations',list:this.store.listConversations(),currentConvId:this.conversationId});return;
    case 'clear_history':this.agent.clearHistory();this.store.saveConversation(this.conversationId,[]);this.emit({type:'history_cleared'});return;
    case 'get_memories':this.emit({type:'memories',facts:await getMemoryStore().getAll()});return;
    case 'get_vault_files':return this.refreshWorkspaceState();
    case 'get_directives':this.emit({type:'directives',items:await readDirectives()});return;
    case 'delete_memory':await getMemoryStore().remove(command.id);this.emit({type:'memories',facts:await getMemoryStore().getAll()});return;
    case 'get_memory_candidates':return this.emitMemoryCandidates();
    case 'review_memory_candidate':{
      const candidate=this.store.reviewMemoryCandidate(command.id,command.decision);
      if(candidate&&command.decision==='approved'){await getMemoryStore().add(candidate.content,candidate.category);this.emit({type:'memories',facts:await getMemoryStore().getAll()});}
      this.emitMemoryCandidates();return;
    }
    case 'set_provider':{
      const manager=getConfigManager();
      // La key candidata NO se persiste todavía: primero se valida contra el proveedor.
      const candidateKey=command.apiKey||this.vault.get(command.provider);
      const remoteProvider=['anthropic','openai','openrouter','nvidia'].includes(command.provider);
      if(command.authMethod==='oauth_local'){
        if(command.provider!=='anthropic'&&command.provider!=='openai'){
          this.emit({type:'error',code:'OAUTH_UNSUPPORTED',message:'Este proveedor solo admite API key en Escarlata.'});return;
        }
        const status=await this.providerAuth.getStatus(command.provider);
        this.emit({type:'provider_auth_status',...status});
        if(status.state!=='connected'){
          this.emit({type:'error',code:'PROVIDER_AUTH_REQUIRED',message:'Conecta la cuenta antes de activar este proveedor.'});return;
        }
      }else if(remoteProvider&&!candidateKey){
        this.emit({type:'error',code:'PROVIDER_CREDENTIAL_REQUIRED',message:'Introduce una API key antes de activar este proveedor.'});return;
      }
      let provider:Provider;
      try{provider=createProvider({provider:command.provider,model:command.model,apiKey:candidateKey,authMethod:command.authMethod});}
      catch(error){this.emit({type:'error',code:'PROVIDER_INVALID',message:error instanceof Error?error.message:'No se pudo configurar el proveedor.'});return;}
      if(remoteProvider&&command.authMethod==='api_key'&&command.apiKey){
        const probeError=await this.probeProvider(provider);
        if(probeError){this.emit({type:'error',code:'PROVIDER_VALIDATION_FAILED',message:`La API key no funcionó: ${probeError}`});return;}
      }
      if(command.apiKey) this.vault.set(command.provider,command.apiKey);
      const credentialConfigured=Boolean(this.vault.get(command.provider));
      this.agent.setProvider(provider,command.provider,command.model);
      await manager.set('modelProvider',command.provider); await manager.set('modelName',command.model);
      await manager.set('authMethods',{...manager.get().authMethods,[command.provider]:command.authMethod});
      this.emit({type:'provider_updated',provider:command.provider,model:command.model,authMethod:command.authMethod,credentialConfigured});
      if(command.provider==='anthropic'||command.provider==='openai') void this.refreshProviderTelemetry(command.provider);
      return;
    }
    case 'get_provider_auth':{
      const status=await this.providerAuth.getStatus(command.provider);
      this.emit({type:'provider_auth_status',...status});
      if(status.state==='connected') void this.refreshProviderTelemetry(command.provider);
      return;
    }
    case 'start_provider_auth':{
      const status=await this.providerAuth.start(command.provider);
      this.emit({type:'provider_auth_started',...status});return;
    }
    case 'cancel_provider_auth':{
      const status=await this.providerAuth.cancel(command.provider);
      this.emit({type:'provider_auth_status',...status});return;
    }
    case 'get_vitals':return this.refreshProviderTelemetry(command.provider);
    case 'get_ollama_models':return this.refreshLocalModelInventory();
    case 'scan_models_dir':return this.scanModelsDirectory(command.directory);
    case 'set_models_dir':{
      const directory=command.directory.trim();
      if(!directory){this.store.setSetting('modelsDirectory',this.defaultModelsDirectory());this.emit({type:'models_dir_result',directory:this.defaultModelsDirectory(),files:[]});return;}
      return this.scanModelsDirectory(directory);
    }
    case 'sync_link':{
      const profile=this.store.linkFirebase(command.uid);
      this.unlocked=true;this.emit({type:'auth_result',success:true,method:'google'});this.emit({type:'sync_state',status:'linked',profile}); return;
    }
    case 'sync_unlink':{
      const profile=this.store.unlinkFirebase();
      this.emit({type:'sync_state',status:'offline',profile}); return;
    }
    case 'sync_now':{
      const profile=this.store.profile();
      if(!profile.firebaseUid){this.emit({type:'sync_state',status:'offline',profile,message:'Conecta Google antes de sincronizar.'});return;}
      const scope=command.scope||this.store.setting<'heart'|'vault'>('syncScope')||'heart';this.store.setSetting('syncScope',scope);
      this.emit({type:'sync_snapshot',profile,scope,heart:{format:1,conversations:this.store.syncConversations(),facts:await getMemoryStore().getAll(),preferences:{onboarding:this.store.setting('onboarding')}},vault:scope==='vault'?{status:'storage_required',message:'La bóveda completa requiere Firebase Storage y sus reglas antes de transferir archivos.'}:undefined});return;
    }
    case 'get_auth_status':this.emit({type:'auth_state',...this.localAuth.status(),windowsHelloAvailable:await windowsHelloAvailable(),unlocked:this.unlocked});return;
    case 'setup_local_account':{
      try{const hello=Boolean(command.enableWindowsHello&&await windowsHelloAvailable());this.localAuth.setup(command.username,command.password,hello);this.localAuth.remember(command.username,Boolean(command.rememberSession));const profile=this.store.updateProfileName(command.username);this.unlocked=true;this.emit({type:'auth_result',success:true,method:'local',profile,windowsHelloEnabled:hello});}catch(error){this.emit({type:'auth_result',success:false,message:error instanceof Error?error.message:'No se pudo crear el perfil local.'});}return;
    }
    case 'login_local':{
      const success=this.localAuth.verify(command.username,command.password);this.unlocked=success;if(success)this.localAuth.remember(command.username,Boolean(command.rememberSession));this.emit({type:'auth_result',success,method:'local',message:success?undefined:'Usuario o contraseña incorrectos.',profile:success?this.store.profile():undefined});return;
    }
    case 'identify_local_account':{
      const account=this.localAuth.identify(command.username);
      this.emit({type:'local_account_identified',username:command.username,exists:account.exists,windowsHelloEnabled:account.windowsHelloEnabled,windowsHelloAvailable:await windowsHelloAvailable()});return;
    }
    case 'login_windows_hello':{
      const status=this.localAuth.status();
      if(command.username&&!this.localAuth.identify(command.username).exists){this.emit({type:'auth_result',success:false,method:'windows_hello',message:'Usuario o método de inicio no disponible.'});return;}
      if(!status.windowsHelloEnabled){this.emit({type:'auth_result',success:false,method:'windows_hello',message:'Windows Hello no está activado para este perfil.'});return;}
      const success=await verifyWindowsHello();this.unlocked=success;if(success)this.localAuth.remember(command.username||status.username||'',Boolean(command.rememberSession));this.emit({type:'auth_result',success,method:'windows_hello',windowsHelloEnabled:status.windowsHelloEnabled,message:success?undefined:'Windows Hello no pudo verificarte.',profile:success?this.store.profile():undefined});return;
    }
    case 'set_windows_hello':{
      if(!this.unlocked){this.emit({type:'error',code:'AUTH_REQUIRED',message:'Inicia sesión antes de cambiar Windows Hello.'});return;}
      if(command.enabled){
        if(!await windowsHelloAvailable()){this.emit({type:'error',code:'WINDOWS_HELLO_UNAVAILABLE',message:'Windows Hello no está disponible en este dispositivo.'});return;}
        if(!await verifyWindowsHello()){this.emit({type:'error',code:'WINDOWS_HELLO_VERIFICATION_FAILED',message:'No se pudo verificar Windows Hello.'});return;}
      }
      this.localAuth.setWindowsHello(command.enabled);
      this.emit({type:'auth_state',...this.localAuth.status(),windowsHelloAvailable:await windowsHelloAvailable(),unlocked:this.unlocked});return;
    }
    case 'set_remember_session':{
      if(!this.unlocked){this.emit({type:'error',code:'AUTH_REQUIRED',message:'Inicia sesión antes de cambiar esta preferencia.'});return;}
      const username=this.localAuth.status().username;
      if(username)this.localAuth.remember(username,command.enabled);
      this.emit({type:'auth_state',...this.localAuth.status(),windowsHelloAvailable:await windowsHelloAvailable(),unlocked:this.unlocked});return;
    }
    case 'verify_windows_hello':{
      const success=await verifyWindowsHello();this.emit({type:'windows_hello_result',success,message:success?'Verificación Windows Hello correcta.':'Windows Hello no pudo verificarte.'});return;
    }
    case 'complete_onboarding':{
      try{mkdirSync(command.vaultDirectory,{recursive:true});}catch{this.emit({type:'error',code:'VAULT_UNAVAILABLE',message:'No se pudo crear o abrir la bóveda seleccionada.'});return;}
      const directivesMode=command.directivesMode||'create';let directivesFile='';
      if(directivesMode==='existing'){
        directivesFile=resolve(command.directivesFile||'');
        if(!directivesFile||!['.md','.markdown','.txt','.org','.rst'].includes(extname(directivesFile).toLowerCase())){this.emit({type:'error',code:'DIRECTIVES_INVALID',message:'Selecciona un archivo de pendientes compatible (.md, .markdown, .txt, .org o .rst).'});return;}
        try{if(!(await stat(directivesFile)).isFile())throw new Error('not a file');}catch{this.emit({type:'error',code:'DIRECTIVES_UNAVAILABLE',message:'No se pudo abrir el archivo de pendientes seleccionado.'});return;}
      }else{
        directivesFile=join(resolve(command.vaultDirectory),'directives','pending.md');
        try{mkdirSync(join(resolve(command.vaultDirectory),'directives'),{recursive:true});await stat(directivesFile).catch(()=>writeFile(directivesFile,'# Pendientes\n\n','utf8'));}catch{this.emit({type:'error',code:'DIRECTIVES_CREATE_FAILED',message:'No se pudo crear directives/pending.md en la bóveda.'});return;}
      }
      const setup={completed:true,modelProvider:command.modelProvider,modelName:command.modelName,configureMultiple:command.configureMultiple,vaultDirectory:resolve(command.vaultDirectory),directivesMode,directivesFile,primaryUses:command.primaryUses,otherUse:command.otherUse||'',completedAt:new Date().toISOString()};this.store.setSetting('onboarding',setup);process.env.OBSIDIAN_VAULT=setup.vaultDirectory;process.env.ESCARLATA_DIRECTIVES_FILE=directivesFile;
      this.migrateHeartWorkspace();
      const manager=getConfigManager();await manager.set('modelProvider',command.modelProvider);await manager.set('modelName',command.modelName);
      if(command.modelProvider==='ollama'){const provider=createProvider({provider:command.modelProvider,model:command.modelName});this.agent.setProvider(provider,command.modelProvider,command.modelName);}
      this.emit({type:'onboarding_complete',setup});await this.refreshWorkspaceState();this.emit({type:'provider_updated',provider:this.agent.providerName,model:this.agent.modelName,authMethod:getConfigManager().get().authMethods[this.agent.providerName]||'api_key'});return;
    }
    default:this.emit({type:'error',code:'NOT_IMPLEMENTED',message:`El comando ${command.type} aún no está disponible en desktop.`});
  }}
  denyPendingConfirmations():void{for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.resolve('denied');}this.pending.clear();}
  dispose():void{this.analyzeCurrentConversation();this.denyPendingConfirmations();this.removeAuthListener?.();this.removeAuthListener=null;if(this.telemetryTimer)clearInterval(this.telemetryTimer);this.telemetryTimer=null;this.heartbeat?.stop();this.heartbeat=null;if(this.noticeListener)this.noticeBoard.off('added',this.noticeListener);this.noticeListener=null;}
}
