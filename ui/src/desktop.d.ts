import type { DesktopCommand, DesktopEvent } from '@escarlata/protocol';
declare global { interface Window { escarlataDesktop?: { command(command: DesktopCommand): Promise<unknown>; onEvent(listener:(event:DesktopEvent)=>void):()=>void; platform:string; }; } }
export {};
