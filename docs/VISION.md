# Escarlata — Agent Spec

> Visión/spec original del producto (antes `AGENT.md`). Describe la meta de diseño, no el
> stack actual: la implementación real es Node/TypeScript + Electron (ver `CLAUDE.md`).

## Identity
- **Name**: Escarlata
- **Description**: Warm, casual voice-first AI assistant for personal + team use, built to scale
- **Personality**: Warm, plain-spoken, brief
- **Primary user**: You (designed for multi-user/team scaling later)

## Stack
- **Backend**: Node.js + TypeScript (read note below)
- **Frontend**: React + TypeScript + Vite in Tauri (Discord-like cross-platform desktop app)
- **Model providers** (pluggable, user-selectable in UI):
  - Ollama (local)
  - NVIDIA Build
  - Extensible for others (Anthropic, OpenAI, etc.)
- **Voice**:
  - STT: Deepgram (streaming)
  - TTS: ElevenLabs (streaming, voice configurable)
  - Modes: Push-to-talk (default) + Always-listening (configurable)
- **Runtime**: Laptop-first; backend separable for always-on host later

> **Backend decision**: Node.js + TypeScript (fast to iterate in, one language across agent/tool/provider code, solid WebSocket/HTTP libs via `ws`). Runs as a local WebSocket server (`src/server/ws-server.ts`, port 3001 by default). Frontend talks to it via localhost. Clean separation — backend can be relocated without frontend changes. (An earlier version of this spec called for a Go backend; that was never built — `cmd/`, `internal/`, `pkg/` are leftover empty scaffolding from that plan.)
>
> **Quick start**: Double-click `DevServerOn.bat` (repo root) to start all services (Ollama, Whisper, backend, frontend, Tailscale funnel). `DevServerOff.bat` stops everything.

## First Three Capabilities (Tier 2 tools)
1. **Task/note capture & retrieval** — "remember this", "what did I note about X?"
2. **Calendar/schedule awareness** — "what's today/this week?" (read-only first; write later behind ask-first)
3. **Web search / knowledge lookup** — answer questions from web or local docs

## Safety Rules (Tier 6 confirmation gate)
Per-action rule engine with three modes: **allow | deny | ask-first**
Default **ask-first** for:
- Send messages (email, chat, SMS, etc.)
- Spend money (API calls with cost, purchases, etc.)
- Delete files/data
- Post online (social, forums, etc.)
- Modify settings/calendar (write operations)

## Proactive Behavior (Tier 5 heartbeat)
- **Quiet by default** — earns interruptions, doesn't assume them
- **Startup briefing**: Greet on launch, summarize today + this week, surface incomplete/half-done items
- **Scheduled checks**: Config-driven intervals, persisted schedule, catch-up on return (no lost notices)
- **Quiet hours**: Non-urgent waits; only critical interrupts
- **Dismissible notices**: Everything surfaced can be acknowledged/cleared
- **Kill switch**: One toggle to pause all proactive behavior

## Interface
- **Primary**: Text chat (Claude Desktop / ChatGPT style)
- **Voice**: Push-to-talk (hold key) + Always-listening (toggle), both configurable
- **Text path stays alive forever** — never removed, used for debugging/fallback

## Architecture Principles
1. **One shared agent core** — typed, spoken, and proactive turns all flow through same brain
2. **Provider seams** — model, STT, TTS each behind thin interfaces (swap without touching core)
3. **Tool registry** — add capabilities by registering self-contained tools, never editing core loop
4. **Memory** — durable facts (plain, human-readable) loaded into system prompt; agent manages own memory via tools
5. **Streaming everywhere** — model streams → TTS streams → voice starts before thought finishes
6. **Config over code** — thresholds, intervals, voices, model names, rules in config file
7. **Audit log** — plain log of tools run, heartbeat actions, confirmations asked, costs