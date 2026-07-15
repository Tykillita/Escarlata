# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

Escarlata is a warm, casual voice-first AI assistant (personal/team use). Despite `AGENT.md` describing
the backend as Go, the actual implementation is **Node/TypeScript** — `cmd/`, `internal/`, `pkg/` are
empty leftover Go scaffolding and can be ignored. The real backend lives in `src/`, and there's a
separate React frontend in `ui/`. Treat `AGENT.md` as the original product spec/vision (tiers, safety
rules, personality) rather than a literal description of the current stack.

## Commands

Backend (run from repo root):
```
npm run dev          # CLI REPL (tsx src/cli/repl.ts)
npm run voice         # CLI voice REPL
npm run desktop:dev   # Electron desktop app (main + preload + React renderer)
npm run desktop:build # Windows NSIS installer and portable executable
npm run build         # tsc compile to dist/
npm start             # run compiled dist/cli/repl.js
npm run whisper        # local whisper.cpp STT server (tools/whisper/, port 8080) for browser mic input

One-click launcher (double-click from Explorer or run from terminal):
```
DevServerOn.bat        # kills old processes, starts Ollama + Whisper + backend + frontend + Tailscale funnel
DevServerOff.bat       # kills all services (node, whisper, ollama)
```
```

Voice in the web UI: the browser records webm/opus (hold V or the mic button in the AUDIO I/O panel),
sends it as a `{type:'audio'}` WS message; the server converts it to WAV 16k via ffmpeg
(`convertToWav16k` in `src/voice/audio.ts`), transcribes with the local whisper.cpp server
(`WhisperLocalSTTProvider`, env `WHISPER_BASE_URL`/`WHISPER_LANGUAGE`), replies `{type:'transcript'}`
and then runs a normal agent turn. Replies are spoken with browser `speechSynthesis` (toggle in the
panel). Requires: ffmpeg on PATH and `npm run whisper` running (binaries + `ggml-small.bin` live in
`tools/whisper/`, not committed-size-friendly). Ollama generation is tunable via `OLLAMA_TEMPERATURE`,
`OLLAMA_TOP_P`, `OLLAMA_NUM_CTX`, `OLLAMA_NUM_PREDICT`, `OLLAMA_KEEP_ALIVE` (see `.env`).

Frontend (`ui/`, separate npm project — run `npm run ui:install` once, or `cd ui && npm install`):
```
npm run ui             # renderer-only Vite development server (port 5173)
cd ui && npm run build  # tsc -b && vite build
cd ui && npm run lint   # oxlint
```

Tests (no test framework — plain tsx scripts under `src/tests/`, one per capability tier):
```
npm run test:tier1        # basic agent turns / history (tier1-2-basic.ts)
npm run test:tier2        # tool-calling
npm run test:tier2-errors # tool error handling
npm run test:tier4        # memory
npm run test:tier5        # heartbeat
npm run test:tier6        # safety/confirmation gate
npm run test:all          # runs all of the above in sequence
```
To run a single test file directly: `tsx src/tests/tier2-tools.ts`. There's no assertion framework;
these scripts print expected-vs-actual to stdout for manual/agent inspection.

Set `MODEL_PROVIDER=mock` (or leave unset) to run without hitting a real model — the mock provider
echoes back deterministic streaming text, which is what the test scripts rely on by default.

## Architecture

**Agent core** (`src/agent/core.ts`) is the single loop used by CLI, voice and Electron IPC.
through. `Agent.processTurn()` is an async generator that streams text deltas, and internally:
1. Sends full history + system prompt to the current `Provider`.
2. Streams `text` events out immediately.
3. On `tool_use`, checks `ToolDefinition.requiresConfirmation` — if set, calls the injected
   `ConfirmationGate` (an ask-first prompt) before running the tool handler. Every tool run/deny/error
   is written to the audit log (`src/config/audit.ts`).
4. Caps a single turn at `MAX_TOOL_CALLS = 6` and also short-circuits after 2 consecutive tool calls
   with no accompanying assistant text, to avoid silent tool-only loops.
5. Recurses (via the `while` loop) until the provider returns `stopReason !== 'tool_use'`.

**Provider seam** (`src/provider/`): `Provider` is a minimal interface (`complete(messages, tools) ->
AsyncIterable<ProviderEvent>`) implemented by `anthropic.ts` and `ollama.ts`, with an OpenAI stub and a
`mock` provider in `provider.ts` used for tests/offline dev. Provider selection is entirely
env-driven: `MODEL_PROVIDER` (`anthropic` | `openai` | `ollama` | anything else -> mock). Adding a new
provider means implementing `Provider` and wiring a case into `createProvider()` — nothing else in the
agent core changes.

**Tool registry** (`src/tools/`): tools are self-contained `{ definition, handler }` objects registered
into a `ToolRegistry` at startup via `registerAllTools()` (`src/tools/index.ts`). Adding a capability =
add a new tool file + register it there; never branch on tool name inside `agent/core.ts`. Existing
tool groups: notes (`notes.ts`), calendar (`calendar.ts`, read-only stubs), web/file search
(`search.ts`), reminders (`reminders.ts`), long-term memory (`../memory/tools.ts`), and read-only Firestore access
to external Firebase projects (`firebase.ts` — service account JSONs dropped in `data/firebase/`,
one per project, keyed by their `project_id`; dir overridable via `FIREBASE_SA_DIR`).

**Memory** (`src/memory/store.ts`): flat JSON fact list at `data/memories.json` (path overridable via
`MEMORY_FILE`). `MemoryStore` is a lazy-loaded singleton (`getMemoryStore()`); `formatForPrompt()` is
appended to the system prompt in `Agent.init()` so memories are always in context, not fetched
on-demand by the model.

**Config** (`src/config/`): two separate things — `config/index.ts` `loadConfig()` reads *env vars*
(assistant name/personality/model, required `ANTHROPIC_API_KEY`) for system-prompt construction;
`config/manager.ts` `ConfigManager` is a singleton persisting *runtime-editable* settings (safety
rules, heartbeat quiet hours/interval) to `data/config.json`, merged over `DEFAULTS` on load. Safety
rules (`allow` / `deny` / `ask_first`) are keyed by action name and looked up via `getRule()`.

**Heartbeat** (`src/heartbeat/`): proactive background loop, off the same `ToolRegistry` the agent
uses. `Heartbeat.tick()` runs on an interval, skips quiet hours (`HEARTBEAT_QUIET_START/END` or
`ConfigManager`), asks a `Scheduler` (`scheduler.ts`, persisted schedule state) which checks are due,
and prevents overlapping runs of the same check via `activeRuns`. Checks (`checks.ts`) surface results
as dismissible `NoticeBoard` entries (`notices.ts`, persisted to `data/notices.json`), broadcast to all
connected WS clients every 30s. `pause()`/`resume()` is the proactive-behavior kill switch.

**Desktop transport** (`apps/desktop/`) owns the Electron main process, preload bridge and local SQLite database. The renderer communicates through validated IPC, not a local network listener. Each conversation has one active agent turn and confirmations expire after two minutes or are denied when its window closes.

**Frontend** (`ui/`): Vite + React 19 + Tailwind 4, talks to the Electron main process through `useDesktopBridge`. State is sent as validated IPC events.

## Working across the two npm projects

The workspace shares `@escarlata/protocol` for commands and events. Any IPC addition belongs in that package before main/preload/renderer code.
