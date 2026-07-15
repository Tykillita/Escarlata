import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DPAPI-backed secret vault. The encrypted bytes are unreadable outside the
 * current Windows account and never leave the main process.
 */
export class SecretVault {
  private readonly file:string;
  constructor(userData:string) { this.file=join(userData,'credentials.dpapi'); }
  private read():Record<string,string> {
    if (!existsSync(this.file)) return {};
    try { return JSON.parse(safeStorage.decryptString(readFileSync(this.file))); } catch { return {}; }
  }
  private write(values:Record<string,string>):void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('La protección de credenciales de Windows no está disponible.');
    writeFileSync(this.file,safeStorage.encryptString(JSON.stringify(values)));
  }
  get(provider:string):string|undefined { return this.read()[provider]; }
  set(provider:string,secret:string):void { const values=this.read(); values[provider]=secret; this.write(values); }
  remove(provider:string):void { const values=this.read(); delete values[provider]; this.write(values); }
}
