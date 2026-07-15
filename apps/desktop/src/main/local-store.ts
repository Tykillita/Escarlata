import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { Message } from '../../../../src/provider/types.js';

export interface LocalProfile { id:string; displayName:string; deviceId:string; firebaseUid?:string|null; lastSyncAt?:string|null }
export interface ConversationSummary { id:string; title:string; createdAt:string; updatedAt:string; messageCount:number }
export interface SyncConversation extends ConversationSummary { messages:{id:string;role:string;content:unknown;createdAt:string;sequence:number}[] }
export interface MemoryCandidateRow { id:string; content:string; category:string; sourceConversationId?:string|null; createdAt:string }
type Row=Record<string, unknown>;

export class LocalStore {
  private constructor(private readonly db:Database,private file:string){}
  static async open(file:string):Promise<LocalStore>{
    mkdirSync(dirname(file),{recursive:true});
    const sqlJsDirectory=app.isPackaged
      ?join(process.resourcesPath,'app.asar.unpacked','node_modules','sql.js','dist')
      :join(process.cwd(),'node_modules','sql.js','dist');
    const SQL=await initSqlJs({locateFile:name=>join(sqlJsDirectory,name)});
    const store=new LocalStore(existsSync(file)?new SQL.Database(readFileSync(file)):new SQL.Database(),file);
    store.db.run(`CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, device_id TEXT NOT NULL, firebase_uid TEXT, last_sync_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sequence INTEGER NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(conversation_id,sequence));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_candidates (id TEXT PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL, confidence REAL, evidence TEXT, source_conversation_id TEXT, created_at TEXT NOT NULL, reviewed_at TEXT, decision TEXT);
      CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, conversation_id TEXT, parent_run_id TEXT, profile TEXT, status TEXT NOT NULL, payload_json TEXT, started_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, payload_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_outbox (operation_id TEXT PRIMARY KEY, entity TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, revision INTEGER NOT NULL, payload_json TEXT, created_at TEXT NOT NULL, sent_at TEXT);
      CREATE TABLE IF NOT EXISTS sync_conflicts (id TEXT PRIMARY KEY, entity TEXT NOT NULL, entity_id TEXT NOT NULL, local_json TEXT NOT NULL, remote_json TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);`);store.flush();return store;
  }
  private rows(sql:string,params:SqlValue[]=[]):Row[]{const result=this.db.exec(sql,params);if(!result[0])return[];const {columns,values}=result[0];return values.map(value=>Object.fromEntries(columns.map((column,index)=>[column,value[index]])));}
  private flush():void{writeFileSync(this.file,Buffer.from(this.db.export()));}
  profile():LocalProfile{const row=this.rows('SELECT id,display_name AS displayName,device_id AS deviceId,firebase_uid AS firebaseUid,last_sync_at AS lastSyncAt FROM profiles LIMIT 1')[0] as unknown as LocalProfile|undefined;if(row)return row;const p:LocalProfile={id:randomUUID(),displayName:process.env.USERNAME||'Usuario',deviceId:randomUUID()};this.db.run('INSERT INTO profiles(id,display_name,device_id,created_at) VALUES(?,?,?,?)',[p.id,p.displayName,p.deviceId,new Date().toISOString()]);this.flush();return p;}
  linkFirebase(uid:string):LocalProfile{this.db.run('UPDATE profiles SET firebase_uid=?',[uid]);this.flush();return this.profile();}
  updateProfileName(name:string):LocalProfile{this.db.run('UPDATE profiles SET display_name=?',[name.trim().slice(0,80)]);this.flush();return this.profile();}
  unlinkFirebase():LocalProfile{this.db.run('UPDATE profiles SET firebase_uid=NULL,last_sync_at=NULL');this.flush();return this.profile();}
  listConversations():ConversationSummary[]{return this.rows(`SELECT c.id,c.title,c.created_at AS createdAt,c.updated_at AS updatedAt,COUNT(m.id) AS messageCount FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id GROUP BY c.id ORDER BY c.updated_at DESC`).map(row=>({...row,messageCount:Number(row.messageCount)}) as ConversationSummary);}
  loadConversation(id:string):Message[]{return this.rows('SELECT role,content_json FROM messages WHERE conversation_id=? ORDER BY sequence',[id]).map(row=>({role:row.role as Message['role'],content:JSON.parse(String(row.content_json))}));}
  saveConversation(id:string,history:Message[]):void{const now=new Date().toISOString();const first=history.find(m=>m.role==='user');const raw=first?(typeof first.content==='string'?first.content:JSON.stringify(first.content)):'';const title=raw.replace(/^\[[^\]]+\]\s*/,'').slice(0,60)||'New Chat';this.db.run('BEGIN');try{this.db.run(`INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at`,[id,title,now,now]);this.db.run('DELETE FROM messages WHERE conversation_id=?',[id]);history.forEach((m,i)=>this.db.run('INSERT INTO messages(id,conversation_id,sequence,role,content_json,created_at) VALUES(?,?,?,?,?,?)',[randomUUID(),id,i,m.role,JSON.stringify(m.content),now]));this.db.run('COMMIT');this.flush();}catch(error){this.db.run('ROLLBACK');throw error;}}
  deleteConversation(id:string):void{this.db.run('DELETE FROM messages WHERE conversation_id=?',[id]);this.db.run('DELETE FROM conversations WHERE id=?',[id]);this.flush();}
  renameConversation(id:string,title:string):void{this.db.run('UPDATE conversations SET title=?,updated_at=? WHERE id=?',[title.slice(0,500),new Date().toISOString(),id]);this.flush();}
  syncConversations():SyncConversation[]{return this.listConversations().map(conversation=>({...conversation,messages:this.rows('SELECT id,role,content_json AS contentJson,created_at AS createdAt,sequence FROM messages WHERE conversation_id=? ORDER BY sequence',[conversation.id]).map(row=>({id:String(row.id),role:String(row.role),content:JSON.parse(String(row.contentJson)),createdAt:String(row.createdAt),sequence:Number(row.sequence)}))}));}
  /** Propuestas de Amatista pendientes de revisión. Devuelve cuántas se insertaron (deduplica por contenido pendiente). */
  addMemoryCandidates(candidates:{content:string;category:string}[],conversationId?:string):number{
    const now=new Date().toISOString();let inserted=0;
    for(const candidate of candidates){
      const content=candidate.content.trim().slice(0,500);if(!content)continue;
      if(this.rows('SELECT id FROM memory_candidates WHERE content=? AND reviewed_at IS NULL',[content]).length)continue;
      this.db.run('INSERT INTO memory_candidates(id,content,category,source_conversation_id,created_at) VALUES(?,?,?,?,?)',[randomUUID(),content,candidate.category.slice(0,60)||'general',conversationId||null,now]);inserted++;
    }
    if(inserted)this.flush();return inserted;
  }
  listMemoryCandidates():MemoryCandidateRow[]{return this.rows('SELECT id,content,category,source_conversation_id AS sourceConversationId,created_at AS createdAt FROM memory_candidates WHERE reviewed_at IS NULL ORDER BY created_at DESC') as unknown as MemoryCandidateRow[];}
  reviewMemoryCandidate(id:string,decision:'approved'|'rejected'):MemoryCandidateRow|undefined{
    const row=this.rows('SELECT id,content,category,source_conversation_id AS sourceConversationId,created_at AS createdAt FROM memory_candidates WHERE id=? AND reviewed_at IS NULL',[id])[0] as unknown as MemoryCandidateRow|undefined;
    if(!row)return;
    this.db.run('UPDATE memory_candidates SET reviewed_at=?,decision=? WHERE id=?',[new Date().toISOString(),decision,id]);this.flush();return row;
  }
  setting<T>(key:string):T|undefined{const row=this.rows('SELECT value_json FROM settings WHERE key=?',[key])[0];if(!row)return;return JSON.parse(String(row.value_json)) as T;}
  setSetting(key:string,value:unknown):void{this.db.run('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',[key,JSON.stringify(value),new Date().toISOString()]);this.flush();}
  filePath():string{return this.file;}
  relocate(file:string):void{const target=join(file);if(this.file===target)return;mkdirSync(dirname(target),{recursive:true});this.file=target;this.flush();}
  /** Imports legacy JSON once, retaining source files untouched as a fallback. */
  importLegacy(dataDirectory:string):{imported:number;skipped:boolean;errors:string[]}{
    if(this.rows("SELECT value_json FROM settings WHERE key='legacy_import_v1'").length)return{imported:0,skipped:true,errors:[]};
    let imported=0;const errors:string[]=[];const conversations=join(dataDirectory,'conversations');
    if(existsSync(conversations)) for(const file of readdirSync(conversations).filter(name=>name.endsWith('.json')&&name!=='index.json'))try{
      const payload=JSON.parse(readFileSync(join(conversations,file),'utf8')) as {id?:string;history?:Message[];messages?:Message[]};
      const id=payload.id||file.replace(/\.json$/,''); const history=payload.history||payload.messages||[];
      if(id&&history.length&&!this.rows('SELECT id FROM conversations WHERE id=?',[id]).length){this.saveConversation(id,history);imported++;}
    }catch(error){errors.push(`${file}: ${error instanceof Error?error.message:String(error)}`);}
    this.db.run("INSERT INTO settings(key,value_json,updated_at) VALUES('legacy_import_v1',?,?)",[JSON.stringify({imported,errors}),new Date().toISOString()]);this.flush();return{imported,skipped:false,errors};
  }
  close():void{this.flush();this.db.close();}
}
export const defaultDatabasePath=(userData:string)=>join(userData,'escarlata.db');
