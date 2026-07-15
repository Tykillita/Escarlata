/**
 * Seed de notices de prueba — llena las 4 esquinas de la UI.
 * Correr: tsx src/tests/seed-notices.ts
 */
import { getNoticeBoard } from '../heartbeat/notices.js';

async function main() {
  const board = getNoticeBoard();

  await board.add(
    'Latest deploy',
    'Deploy de prueba: build ui@0.0.0 compilado y servido en vite:5173. Sin errores de lint.',
    'info',
    'seed_deploy'
  );

  await board.add(
    'Plan today',
    'Terminar E.S.C.A.R.L.A.T.A · Practicar Power BI · hacer ejercicio · Hacer tareas BD',
    'notice',
    'seed_plan'
  );

  await board.add(
    'Metrics pull',
    'Tokens hoy: 67M · Costo: $26 · Burn rate: 267 tok/min · Sesión 39%',
    'info',
    'seed_metrics'
  );

  const active = await board.getActive();
  console.log(`Notices activos: ${active.length}`);
  for (const n of active) console.log(` - [${n.source}] ${n.title}`);
}

main().catch(err => { console.error(err); process.exit(1); });
