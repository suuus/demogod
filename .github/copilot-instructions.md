# Copilot Instructions for DemoGod

> Read `docs/ARCHITECTURE.md` for a detailed system overview, data flow diagrams, and component reference.

## What This Project Is

DemoGod is a web-based tool for creating interactive demo videos of GitHub Copilot CLI. It provides:
- A **live mode** that connects to real Copilot sessions via the `@github/copilot-sdk`
- A **scripted mode** that plays back JSON demo scripts with realistic typing/timing
- A browser-based terminal UI with macOS-style window chrome, overlays, and file tabs

## Project Structure

```
src/
├── server.ts            # Express + WS server, REST API, plugin scanners, demo engine
├── copilot-bridge.ts    # @github/copilot-sdk wrapper, event forwarding, sub-agent detection
└── public/
    ├── index.html       # Page structure, overlays, control bar, settings panel
    ├── app.js           # All frontend logic — class-based vanilla JS, ~3500 lines
    └── styles.css       # Theming, terminal chrome, CSS custom properties

demo/sample-app/         # Tiny Node.js project for demo showcases
demos/                   # JSON demo scripts (loaded via /api/demos/:name)
src-tauri/               # Tauri desktop app (Rust shell + config)
docs/ARCHITECTURE.md     # Deep architecture reference
.github/workflows/desktop-build.yml  # CI for Tauri builds
```

## Tech Stack & Conventions

- **Backend**: TypeScript (strict, ES2022, ESM), Express 5, ws, `@github/copilot-sdk`
- **Frontend**: Vanilla JS (ES2020+, single IIFE in `app.js`), no framework, no bundler, no build step
- **CSS**: Plain CSS with custom properties — no preprocessor
- **Runtime**: `tsx` for TypeScript execution (no separate compile step in dev)
- **Type-check**: `npx tsc --noEmit`

### Rules

1. **Do NOT add frontend frameworks or bundlers.** The frontend is intentionally vanilla JS — keep it that way.
2. **Do NOT filter tools or skills in the bridge.** `CopilotBridge` exposes everything the CLI offers.
3. **Use `session.send()`, never `session.sendAndWait()`** — sub-agent tasks can run indefinitely.
4. **All file access must be restricted to `homedir()`.** Check every new endpoint.
5. **Sanitize demo names** — `[a-zA-Z0-9_-]` only, resolved path must be under `DEMOS_DIR`.
6. **Do NOT remove or weaken `verifyClient`** — it's the primary WS auth layer (token + origin checks).

## Key Patterns

### WebSocket Message Protocol

Every feature uses the WebSocket for real-time communication. The pattern is:
1. Frontend sends `{type: "action_name", ...params}` via `send()` in `app.js`
2. Server handles it in `ws.on("message")` switch in `server.ts`
3. Server responds via `safeSend(ws, {type: "response_type", ...data})`
4. Frontend handles it in `handleMessage()` switch in `app.js`

When adding a new message type, update **all four** locations.

### Bridge Event Forwarding

`CopilotBridge` events map 1:1 to WebSocket message types:
- SDK event → bridge `EventEmitter` event → `safeSend()` → frontend `handleMessage()`
- When handling a new SDK event, add it to `session.on()` in `copilot-bridge.ts`, then wire it through `server.ts` to `app.js`.

### Plugin / Config Discovery

The SDK handles plugin and config discovery automatically via `enableConfigDiscovery: true` in the session config. This auto-discovers agents, skills, and MCP servers from `~/.copilot/installed-plugins/` and project-local configs (`.mcp.json`, `.github/agents/`, chatmodes). The server does **not** manually pass `customAgents` or `skillDirectories` to session creation.

> **Note:** `getPluginSkills()`, `getPluginAgents()`, and `getPluginSkillDirectories()` functions still exist in `server.ts` but are only used for the `/skill-name` slash command handler — they are **not** used for session creation.

### Demo Scripts

JSON files in `demos/` with a `steps` array. Each step has a `type`:
- `"command"` — typed prompt + canned response (scripted playback)
- `"question"` — typed prompt + dialog with auto-fill + canned response
- `"live"` — typed prompt sent as a **real** Copilot prompt, waits for idle before next step
- `"action"` — UI automation: `layout`, `tile`, `model`, `open_file`, `new_session`

### Settings Panel

The ⚙️ Settings button opens a panel with three sections:
- **Appearance**: Background color, dialog mode (inline/popup), show version badge
- **Features**: (reserved for future toggles)
- **Experimental**: Integrated terminal, sub-agent activity tabs

Settings are persisted to `localStorage` with a `dg-` prefix.

### Capabilities Panel

The 🔌 button in the control bar opens the Capabilities Panel, which shows:
- **MCP Servers**: status dots (green/red) and enable/disable toggles
- **Built-in Tools**: tools provided by the Copilot CLI itself
- **MCP Server Tools**: discovered via MCP protocol and runtime tracking
- **Skills**: with enable/disable toggles

The panel includes a filter input and collapsible sections with count badges.

### Status Bar

The status bar displays the current git branch (detected via `git rev-parse --abbrev-ref HEAD` on session creation, sent in the `session_ready` message).

### Mode-Colored Borders

Session containers use mode-colored subtle separator lines via the `--titlebar-border` CSS variable, overridden per session through the `data-copilot-mode` attribute on `.session-container`:
- **Green** border = autopilot mode
- **Purple** border = plan mode

### Sub-Agent Tab Detection (v0.0.7)

Sub-agents are detected via the `task` tool in `onPreToolUse`/`onPostToolUse` hooks:
- `activeTaskAgents` stack tracks start→complete matching
- `backgroundAgentMap` (Map<agentId, agentName>) tracks background agents
- `subagent_output` event: emitted when `read_agent` completes, routed to matching tab
- SDK does **not** stream sub-agent internals — tabs show result on completion, not live output

### System Notification Rendering

The markdown renderer strips internal XML tags (`<reminder>`, `<todo_status>`, etc.) and converts `<system_notification>` tags into styled 🔔 alert lines.

## Security — Do Not Break These

| Rule | Details |
|------|---------|
| File paths under `homedir()` | `/api/browse`, `/api/browse-files`, `/api/file` all enforce this |
| Demo name sanitization | `safeDemoPath()` strips non-`[a-zA-Z0-9_-]` chars, verifies resolved path |
| Text-file-only reading | `/api/file` allowlists extensions via regex |
| Session token auth | `verifyClient` in `server.ts` validates the `?token=` query param against the startup-generated session token |
| Origin checking | `verifyClient` rejects WS connections from non-localhost origins |
| Localhost-only binding | `server.listen(PORT, "127.0.0.1")` — never bind to `0.0.0.0` or a public interface |
| `approveAll` is local-only | This is for demo/dev use — never expose to untrusted networks |

## User Interaction — MANDATORY

**Always use the `ask_user` tool** when you need any input, clarification, or decision from the user. Never ask questions in plain text output — every question MUST go through `ask_user` so it renders as a structured dialog in the UI.

1. **One question at a time.** Each `ask_user` call must contain exactly ONE focused question.
2. **Never ask in prose.** Use `ask_user` instead of embedding questions in your text response.
3. **Use structured fields.** Prefer `enum`/`boolean` over free-text when options are known.
4. **Provide defaults.** Always set a sensible `default` value.
5. **Sub-agents follow the same rules.** Instruct them to use `ask_user`, one question at a time.

## Multi-Session Architecture

The frontend (`app.js`, ~3500 lines) uses a class-based architecture for multi-session support:

- **`TerminalSession`** — encapsulates one Copilot session: its own WebSocket, terminal state, DOM output area, and sub-agent tab tracking. `_displayName()` returns "projectname · Session N" for tab and floating window titles.
- **`SessionManager`** — creates/destroys/switches sessions. Manages the tab bar, keyboard shortcut routing, and settings panel.
- **`FloatingWindowManager`** — detaches sessions into draggable, resizable floating windows with grid snap zones.

Each session gets its own `CopilotBridge` on the server side, so sessions are fully isolated.

### Layout Modes
- **Tab mode** (default) — sessions as tabs, one visible at a time.
- **Floating window mode** — pop sessions out into independent draggable windows with edge snapping.

### UI Layout
- **Control bar** (top center): Mode, Open, Model, Agent, Skill, Copilot Mode, Layout, Tile, 🔌 Capabilities, Settings
- **Bottom-right corner**: Version badge (toggle in settings), ↻ restart, ⏺ record
- **Settings panel**: Appearance / Features / Experimental sections

## Tauri Desktop App

DemoGod can run as a native desktop app via Tauri v2. Source is in `src-tauri/`.

- **Sidecar pattern**: Rust shell spawns the Node.js server as a child process. The Tauri webview loads the UI from `localhost:3456`.
- **Dev**: `npm run desktop` — Tauri's `beforeDevCommand` runs `npm run dev` for hot reload.
- **Build**: `npm run build:desktop` — produces `.dmg` / `.msi` / `.deb` / `.AppImage`.
- **CI**: `.github/workflows/desktop-build.yml` builds on macOS, Windows, and Linux.

When modifying Tauri config, edit `src-tauri/tauri.conf.json`. Rust code is in `src-tauri/src/`.

### Shell Picker (v0.0.4+)

The desktop app includes a shell picker (🐚 button) in the control bar **visible only in Tauri** (detected via `window.__TAURI_INTERNALS__`). Users can select between **WSL**, **PowerShell**, **CMD**, or **native** shell for spawning the server. The selection is:
- Persisted to `~/.demogod/config.json`
- Applied at server startup via `lib.rs` command dispatch with fallback logic
- Read/written via new REST endpoints:
  - `GET /api/shell` — read current shell config
  - `PUT /api/shell` — update shell config

In browser mode, the shell picker is hidden.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+T` | New session |
| `Ctrl+W` | Close current session |
| `Ctrl+Tab` | Next session |
| `Ctrl+Shift+Tab` | Previous session |

> On macOS, use `Cmd` instead of `Ctrl`.

These are handled in `SessionManager` inside `app.js`.

## Common Tasks Quick Reference

| Task | What to do |
|------|-----------|
| Add REST endpoint | Add route in `server.ts`, enforce `homedir()` security, document in README |
| Add WS message type | Update `server.ts` switch + `app.js` `handleMessage()` switch + README protocol table |
| Add UI button | HTML in `index.html` `#controls`, CSS in `styles.css`, JS handler in `app.js` |
| Add SDK event | Handle in `copilot-bridge.ts` `session.on()`, emit, wire through `server.ts` → `app.js` |
| Add demo step type | Handle in `runDemo()` in `server.ts`, add `demo_step_*` handling in `app.js` |
| Add setting | HTML toggle in `#settings-window`, localStorage `dg-*` key, wire in settings panel init in `app.js` |
| Add demo action | Handle in `_handleDemoAction()` in `app.js`, use in demo JSON `{"type":"action","action":"name"}` |
| Type-check | `npx tsc --noEmit` |
| Run dev server | `npm run dev` (hot reload on :3456) |
| Run desktop dev | `npm run desktop` (Tauri + Node hot reload) |
| Build desktop app | `npm run build:desktop` (platform installers) |
