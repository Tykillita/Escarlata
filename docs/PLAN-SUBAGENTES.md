# Plan: subagentes de Escarlata ("El Joyero")

Escarlata pasa a ser **jefa de personal**: recibe todo del usuario, decide si lo resuelve ella
o lo delega a un subagente especializado, supervisa el resultado y responde siempre ella
(una sola voz hacia el usuario).

## Plantel propuesto (nombre ↔ función)

| Gema | Cargo | Por qué el nombre | Tools asignadas |
|------|-------|-------------------|-----------------|
| **Escarlata** | Jefa de personal / orquestadora | El rojo escarlata manda | `delegate_task` + las de uso directo frecuente (el resto migra a los especialistas; ver "Escarlata adelgaza") |
| **Ópalo** | Investigador | El ópalo refleja mil colores: mira un tema desde todas las fuentes | `web_search`, `read_local_file`, `search_notes` |
| **Cuarzo** | Guardián del tiempo | Los relojes funcionan con cuarzo | `set_reminder`, `list_reminders`, `cancel_reminder`, `get_today`, `get_week`, `upcoming_events`, `add_event` |
| **Ámbar** | Archivista / memoria | El ámbar preserva el pasado intacto (insecto en ámbar) | `remember`, `recall`, `list_memories`, `forget` |
| **Perla** | Escriba / notas y redacción | La perla se forma capa a capa, como un buen documento | `save_note`, `get_note`, `list_notes`, `search_notes`, `edit_local_file` |
| **Rubí** | Ejecutora / pendientes | Rojo = acción; hermana menor de Escarlata | `get_directives`, `add_todo`, `done_todo` |
| **Ónix** | Guardia de seguridad | Piedra protectora clásica | Solo lectura del audit log y config de reglas |

Ónix es fase tardía (rol de auditoría/revisión de acciones sensibles); los cinco del medio son el plantel real.

## Arquitectura (encaja en el código actual sin romper nada)

La pieza clave ya existe: `Agent` es autocontenido (provider + systemPrompt + ToolRegistry).
Un subagente = otra instancia de `Agent` con prompt propio y un registry filtrado.

### 1. Perfiles (`src/agents/profiles.ts`)
```ts
interface AgentProfile {
  name: string;           // 'opalo'
  displayName: string;    // 'Ópalo'
  role: string;           // una línea para el prompt de Escarlata
  systemPrompt: string;   // identidad + especialidad + formato de salida (informe breve)
  tools: string[];        // subset por nombre del registry maestro
  maxToolCalls?: number;  // default 4, más bajo que la jefa
}
```
Perfiles en código primero; luego opcionalmente editables en `data/agents.json` vía `ConfigManager`.

### 2. Tool `delegate_task` (solo registrada en el registry de Escarlata)
```ts
parameters: [
  { name: 'agent', type: 'string', required: true, enum: ['opalo','cuarzo','ambar','perla','rubi'] },
  { name: 'task',  type: 'string', required: true },  // instrucción autocontenida
  { name: 'context', type: 'string' },                 // datos que el subagente necesita
]
```
- El `enum` ya lo valida `validateToolInput` (implementado en el turno anterior).
- Handler: crea/reusa el `Agent` del perfil, corre `processTurn(task + context)`, junta el
  stream y devuelve el texto final como `tool_result`. Escarlata lo resume con su voz.
- El subagente **no** tiene `delegate_task`: sin recursión, jerarquía de un solo nivel.

### 3. Reglas de mando
- Subagentes heredan el mismo `ConfirmationGate`: si Perla quiere escribir un archivo, la
  confirmación le llega al usuario igual que hoy (prefijada: "Perla quiere…").
- Presupuesto: `maxToolCalls` bajo por subagente + máximo 2 delegaciones por turno de
  Escarlata (el `MAX_TOOL_CALLS = 6` actual ya acota el total).
- Todo pasa por `audit()` con campo `agent` nuevo para saber quién hizo qué.
- Subagentes sin historia persistente entre turnos (stateless): reciben todo en `task`/`context`.
  Simple, barato, sin sincronización de memorias. Si hace falta continuidad, Escarlata la
  aporta desde su propia historia.

### 4. Superficie (UI/voz)
- Evento WS nuevo `{type:'subagent', agent, status:'start'|'done'}` para mostrar en el panel
  quién está trabajando (el `onToolEvent` actual ya casi lo cubre: `delegate_task` aparece
  como tool_start/tool_result; solo hay que renderizarlo lindo).
- En voz, Escarlata lo narra sola ("Le paso esto a Ópalo, dame un momento") — ya lo hace
  gratis porque el prompt le exige texto antes de cada tool.

### 5. Prompt de Escarlata (sección nueva "# Tu equipo")
Lista generada desde los perfiles (mismo patrón dinámico que la lista de tools):
- nombre, cargo y cuándo delegarle
- criterio: tareas de un paso las hace ella directa; delega cuando la tarea es pesada
  (investigación larga, redacción de documento) o claramente del dominio de un especialista
- nunca inventar miembros del equipo; si nadie aplica, lo hace ella

**Narración en persona, no en tool.** Al delegar, Escarlata lo cuenta como jefa que le pide
algo a su gente, con naturalidad y variando la frase — nunca menciona nombres técnicos de
tools ni la palabra "delegar":
- "Dale, le pido a Ópalo que lo investigue y te cuento."
- "Eso es de Cuarzo, ya se lo paso."
- "Le encargo la nota a Perla y que Ámbar lo guarde también."
Reglas en el prompt: (1) referirse a los subagentes siempre por su nombre de gema, como
compañeros de equipo; (2) tono casual, una sola frase antes de delegar; (3) al volver el
informe, atribuir si suma ("Ópalo encontró que...") pero sin burocracia; (4) nunca decir
"voy a usar web_search" ni "llamo a la herramienta X" — si la tarea la hace ella misma con
sus tools directas, narra la acción ("lo busco", "lo anoto"), no el mecanismo.

## Fases

1. **Fase 1 (núcleo, ~1 día):** perfiles + `delegate_task` + Ópalo y Perla. Son los que más
   rinden: investigación y redacción son las tareas largas que hoy le comen los 6 tool calls
   a Escarlata.
2. **Fase 2:** Cuarzo y Rubí (dominios chicos, valor: prompts especializados mejoran precisión
   del modelo local). Ámbar si la memoria crece.
3. **Fase 3:** Ónix (auditoría) y perfiles editables en `data/agents.json`.

## Un solo modelo para todo el equipo (decisión de diseño)

Todos los agentes corren sobre el **mismo modelo** (el que diga `MODEL_PROVIDER`/`MODEL_NAME`).
No es una limitación: con un solo modelo la ganancia de los subagentes no viene de "cerebros
distintos" sino de **ingeniería de contexto** — y ahí hay mucho para exprimir:

### 1. Contextos chicos y especializados (la ganancia principal)
Cada llamada al modelo paga por: system prompt + definiciones de tools + historia.
- **Subagente**: prompt de ~10 líneas + 3-7 tools de su dominio + historia vacía.
  Un modelo local elige mejor entre 5 tools que entre 21, y genera más rápido con menos
  contexto. Mismo modelo, más precisión, solo por recortar el menú.
- **Escarlata adelgaza**: cuando un dominio tiene subagente, sus tools salen del registry de
  ella (queda: `delegate_task` + las de uso directo frecuente). Su system prompt y el bloque
  de tools que se manda EN CADA TURNO se achican — cada turno de conversación es más barato
  y rápido, para siempre.

### 2. Aislamiento de contexto sucio
Los outputs pesados (dumps de `web_search`, archivos leídos) viven solo en la historia
descartable del subagente. A la historia de Escarlata entra únicamente el informe final.
Resultado: la conversación larga con el usuario no se degrada ni se encarece por las
búsquedas que se hicieron en el camino.

### 3. Un modelo cargado = cero swap de VRAM
Con Ollama, modelos distintos por agente significaría descargar/cargar pesos en cada
delegación (segundos muertos). Mismo modelo + `OLLAMA_KEEP_ALIVE` alto = el modelo queda
caliente y toda delegación arranca al instante. Con Anthropic, prompts de sistema estables
por perfil habilitan prompt caching (el prefijo de cada subagente se cachea entre llamadas).

### 4. Mismo modelo, distinta configuración por rol
El modelo es uno; los parámetros de generación no tienen por qué serlo. `AgentProfile` gana
un campo `options`:
- **Ópalo** (factual): `temperature 0.2-0.3`, `num_predict` generoso para informes.
- **Perla** (redacción): `temperature 0.7`.
- **Cuarzo/Rubí/Ámbar** (mecánicos): `temperature 0.1`, `num_predict` corto — son tools con
  poco texto alrededor.
- **Escarlata** (conversación): la config actual de `.env`.
Requiere que `OllamaProvider`/`AnthropicProvider` acepten overrides por instancia (hoy leen
env globales — cambio chico en `createProvider`).

### 5. Delegación en paralelo
Un solo servidor de modelo puede atender varias secuencias (`OLLAMA_NUM_PARALLEL`, o
llamadas concurrentes a la API de Anthropic). Si Escarlata emite dos `delegate_task` en el
mismo turno (el loop de `core.ts` ya acumula varios `tool_use`), el handler los corre con
`Promise.all`: Ópalo investiga mientras Perla redacta. Tiempo de pared ≈ el del más lento,
no la suma.

### 6. Informes con formato fijo
El prompt de cada subagente exige salida estructurada y acotada:
```
RESULTADO: <una línea>
DETALLE: <máx 5 bullets>
PENDIENTE: <qué faltó o falló, si aplica>
```
Menos tokens de vuelta, y Escarlata (mismo modelo) resume mejor un informe predecible que
una parrafada libre.

### 7. Reuso de instancias
Los subagentes se instancian una vez por conexión (junto al `Agent` principal en
`ws-server.ts`) y se les limpia la historia con `clearHistory()` después de cada encargo:
cero costo de re-init, cero fugas de contexto entre encargos.

## Riesgos y mitigaciones
- **Latencia** (asistente de voz): cada delegación = llamadas extra al modelo en serie.
  Mitigación: delegar solo tareas pesadas; Escarlata avisa por voz que está en eso; a futuro,
  correr la delegación en background y avisar por NoticeBoard al terminar.
- **Modelo local chico** (Ollama): puede elegir mal a quién delegar. Mitigación: `enum` en el
  parámetro + descripciones de una línea por agente + fallback "si dudás, hacelo vos".
- **Pérdida de contexto**: subagente stateless no sabe la conversación. Mitigación: parámetro
  `context` obligatorio en la práctica (el prompt de Escarlata le exige pasar los datos).
