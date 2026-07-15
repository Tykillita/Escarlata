import { WebSocket } from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';

const wav = fs.readFileSync(path.join(os.tmpdir(), 'test-es.wav'));
const ws = new WebSocket('ws://127.0.0.1:3199');
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 120000);
let sent = false;

ws.on('open', () => ws.send(JSON.stringify({ type: 'new_chat' })));
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'conversations' && !sent) {
    sent = true;
    console.log('test conv:', msg.currentConvId);
    ws.send(JSON.stringify({ type: 'audio', data: wav.toString('base64'), mime: 'audio/wav' }));
    return;
  }
  if (['state', 'token', 'notices', 'memories', 'history_cleared', 'vitals', 'usage_stats'].includes(msg.type)) return;
  console.log(msg.type, JSON.stringify(msg).slice(0, 250));
  if (msg.type === 'response' || msg.type === 'error') { clearTimeout(timer); process.exit(0); }
});
