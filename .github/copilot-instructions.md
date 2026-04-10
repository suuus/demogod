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
├── copilot-bridge.ts    # @github/copilot-sdk wrapper, event forwarding
└── public/
    ├── index.html       # Page structure, overlays, control bar
    ├── app.js           # All frontend logic — class-based vanilla JS, ~2500 lines
    └── styles.css       # Theming, terminal chrome, CSS custom properties

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

### Plugin Discovery

Plugins from `~/.copilot/installed-plugins/` are scanned at server startup:
- **Skills**: `SKILL.md` frontmatter in `skills/` dirs → passed as `skillDirectories` to SDK
- **Agents**: `.agent.md` files in `agents/` dirs → passed as `customAgents` to SDK
- Both are cached (lazy singleton) for the server lifetime

### Demo Scripts

JSON files in `demos/` with a `steps` array. Each step is either:
- `"type": "command"` — typed prompt + canned response
- `"type": "question"` — typed prompt + dialog with auto-fill + response

## Security — Do Not Break These

| Rule | Details |
|------|---------|
| File paths under `homedir()` | `/api/browse`, `/api/browse-files`, `/api/file` all enforce this |
| Demo name sanitization | `safeDemoPath()` strips non-`[a-zA-Z0-9_-]` chars, verifies resolved path |
| Text-file-only reading | `/api/file` allowlists extensions via regex |
| `approveAll` is local-only | This is for demo/dev use — never expose to untrusted networks |

## User Interaction — MANDATORY

**Always use the `ask_user` tool** when you need any input, clarification, or decision from the user. Never ask questions in plain text output — every question MUST go through `ask_user` so it renders as a structured dialog in the UI.

1. **One question at a time.** Each `ask_user` call must contain exactly ONE focused question.
2. **Never ask in prose.** Use `ask_user` instead of embedding questions in your text response.
3. **Use structured fields.** Prefer `enum`/`boolean` over free-text when options are known.
4. **Provide defaults.** Always set a sensible `default` value.
5. **Sub-agents follow the same rules.** Instruct them to use `ask_user`, one question at a time.

## Multi-Session Architecture

The frontend (`app.js`, ~2500 lines) uses a class-based architecture for multi-session support:

- **`TerminalSession`** — encapsulates one Copilot session: its own WebSocket, terminal state, and DOM output area. `_displayName()` returns "projectname · Session N" for tab and floating window titles.
- **`SessionManager`** — creates/destroys/switches sessions. Manages the tab bar and keyboard shortcut routing.
- **`FloatingWindowManager`** — detaches sessions into draggable, resizable floating windows with grid snap zones.

Each session gets its own `CopilotBridge` on the server side, so sessions are fully isolated.

### Layout Modes
- **Tab mode** (default) — sessions as tabs, one visible at a time.
- **Floating window mode** — pop sessions out into independent draggable windows with edge snapping.

## Tauri Desktop App

DemoGod can run as a native desktop app via Tauri v2. Source is in `src-tauri/`.

- **Sidecar pattern**: Rust shell spawns the Node.js server as a child process. The Tauri webview loads the UI from `localhost:3456`.
- **Dev**: `npm run desktop` — Tauri's `beforeDevCommand` runs `npm run dev` for hot reload.
- **Build**: `npm run build:desktop` — produces `.dmg` / `.msi` / `.deb` / `.AppImage`.
- **CI**: `.github/workflows/desktop-build.yml` builds on macOS, Windows, and Linux.

When modifying Tauri config, edit `src-tauri/tauri.conf.json`. Rust code is in `src-tauri/src/`.

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
| Type-check | `npx tsc --noEmit` |
| Run dev server | `npm run dev` (hot reload on :3456) |
| Run desktop dev | `npm run desktop` (Tauri + Node hot reload) |
| Build desktop app | `npm run build:desktop` (platform installers) |
