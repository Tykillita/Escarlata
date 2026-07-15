import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopCommand, DesktopEvent } from '@escarlata/protocol';
contextBridge.exposeInMainWorld('escarlataDesktop', {
  command: (command: DesktopCommand): Promise<unknown> => ipcRenderer.invoke('escarlata:command', command),
  onEvent: (listener: (event: DesktopEvent) => void) => { const callback=(_:Electron.IpcRendererEvent,event:DesktopEvent)=>listener(event); ipcRenderer.on('escarlata:event',callback); return()=>ipcRenderer.removeListener('escarlata:event',callback); },
  platform: process.platform,
});
