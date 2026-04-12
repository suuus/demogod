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
├── server.ts            # Express + WS server, REST API, MCP discovery, demo engine
├── copilot-bridge.ts    # @github/copilot-sdk wrapper, event forwarding, sub-agent detection
├── pty-server.ts        # PTY WebSocket server (shell spawn, resize, cleanup)
├── path-utils.ts        # Shared path security (safeRealpath, isUnderHome)
├── demo-plan-prompts.ts # Prompt templates for Demo Plan Mode
└── public/
    ├── index.html       # Page structure, overlays, control bar, settings panel
    ├── app.js           # Core frontend logic — class-based vanilla JS (IIFE)
    ├── terminal.js      # Integrated terminal module (xterm.js + PTY WebSocket)
    ├── demo-studio.js   # Demo Studio panel (AI-powered demo generation)
    └── styles.css       # Theming, terminal chrome, CSS custom properties

demo/sample-app/         # Tiny Node.js project for demo showcases
demos/                   # JSON demo scripts (loaded via /api/demos/:name)
src-tauri/               # Tauri desktop app (Rust shell + config)
docs/ARCHITECTURE.md     # Deep architecture reference
.github/workflows/       # CI workflows + agentic workflows
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
7. **Do NOT push to remote (`git push`) without explicit user permission.** Commit locally, then ask before pushing.

### TypeScript / ESM Conventions

1. **Use `.js` extensions in all local imports** — ESM requires them: `import { foo } from "./bar.js"`, not `"./bar"` or `"./bar.ts"`.
2. **Derive `__filename`/`__dirname` from `import.meta.url`** — ESM doesn't provide these globals.
3. **Use `import type` for type-only imports** — `import type { SessionEvent } from "@github/copilot-sdk"`.
4. **Use `fs/promises` for async file operations** — sync variants only in `path-utils.ts` where security validation must be atomic.
5. **`tsx` is the runtime** — no separate compile step. Type-check with `npx tsc --noEmit`.

### Error Handling Conventions

1. **Never silently swallow errors.** Every `catch` must log (`console.debug`/`warn`/`error`), forward to client via `safeSend`, or return a meaningful fallback.
2. **Use `safeSend()` for all WebSocket writes** — checks `readyState` before sending. Never call `ws.send()` directly.
3. **Use `AbortController` for cancellable operations** — check `signal.aborted` or catch `AbortError` by name.

### Security Coding Rules

1. **Path validation is two-step: `safeRealpath()` + `isUnderHome()`** — import from `path-utils.ts`. Never use `resolve()` alone.
2. **Name sanitization uses allowlist regex** — `safeDemoPath()` strips `[^a-zA-Z0-9_-]` then verifies equality.
3. **Extension allowlist for file reading** — `/api/file` and `/api/browse-files` restrict to known text extensions.
4. **Shell allowlist for PTY** — `ALLOWED_SHELLS` is a `Set`. Unknown shells fall back to default.
5. **Token per-process, injected via `<meta>` tag** — never hardcode in static HTML.
6. **CSP injected server-side** — never add it to `index.html` directly.

### Frontend Conventions (Vanilla JS)

1. **`app.js` is a single IIFE** — `(() => { "use strict"; ... })()`. No global variables.
2. **ES modules for satellite features** — new standalone features go in separate `<script type="module">` files (like `terminal.js`, `demo-studio.js`). Communicate via `window.__demogodManager` or `window.__demogodActiveSession`.
3. **`$()` is the local selector shorthand** — `const $ = (sel) => document.querySelector(sel)`. Defined in each module.
4. **`escapeHtml()` before any `innerHTML`** — uses the `textContent` → `innerHTML` pattern. Never interpolate user input into HTML strings.
5. **`textContent` for text-only, `classList` for classes, `dataset` for data attributes**.
6. **`requestAnimationFrame` for high-frequency DOM updates** — streaming deltas coalesce via rAF.
7. **`aria-live` management** — set `"off"` during streaming, restore `"polite"` when idle.
8. **Settings use `localStorage` with `dg-` prefix** — keys: `dg-bg`, `dg-dialog-mode`, `dg-terminal`, `dg-agent-tabs`, `dg-show-version`, `dg-layout`, `dg-auto-approve`, `dg-todo-panel`.
9. **Dialogs must have `role="dialog"`, `aria-modal="true"`, focus trapping, and Escape-to-close** — use `setupDialogOverlay()`.

### CSS Conventions

1. **All colors via CSS custom properties** — defined on `:root`. Use `var(--accent)`, never hardcode hex values.
2. **Catppuccin Mocha-inspired palette** — `--base`, `--mantle`, `--surface0`, `--overlay0`, etc.
3. **Mode borders via `data-copilot-mode` attribute** — not inline styles.
4. **`hidden` class for visibility toggling** — overlays use `classList.add/remove("hidden")`.
5. **No CSS preprocessors** — plain CSS with custom properties only.

### Testing Conventions

1. **Unit tests** — Vitest in `tests/unit/*.test.ts`. Import from `vitest`, mock with `vi.mock()`.
2. **E2E tests** — Playwright in `tests/e2e/*.spec.ts`. Extract `dg-token` from HTML for WS tests.
3. **Generated specs** — Demo Plan output goes to `tests/generated/*.spec.ts` (gitignored).
4. **Run:** `npm run test:unit` | `npm run test:e2e` | `npm test` (both) | `npm run test:generated` (headed)

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

The `/skill-name` slash command handler uses `bridge.listSkills()` at runtime to verify skill names before transforming the prompt.

### Demo Scripts

JSON files in `demos/` with a `steps` array. Each step has a `type`:
- `"command"` — typed prompt + canned response (scripted playback)
- `"question"` — typed prompt + dialog with auto-fill + canned response
- `"live"` — typed prompt sent as a **real** Copilot prompt, waits for idle before next step
- `"action"` — UI automation: `layout`, `tile`, `model`, `open_file`, `new_session`

### Settings Panel

The ⚙️ Settings button opens a panel with three sections:
- **Appearance**: Background color (including Aurora Borealis animated theme), dialog mode (inline/popup), show version badge
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
- **Gold** border = demo plan mode (client-side only, not a Copilot SDK mode)

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

### Playwright Test Agents

Three AI-assisted Playwright agents live in `.github/agents/` — `playwright-test-planner`, `playwright-test-generator`, and `playwright-test-healer`. They are available via GitHub Copilot's custom agent system for creating and maintaining E2E tests.

## Multi-Session Architecture

The frontend (`app.js`) uses a class-based architecture for multi-session support:

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

## Keyboard Shortcuts

| Shortcut (macOS: Ctrl, other: Alt) | Action |
|-------------------------------------|--------|
| `Ctrl/Alt + T` | New session |
| `Ctrl/Alt + W` | Close current session |
| `Ctrl/Alt + N` | Next session |
| `Ctrl/Alt + P` | Previous session |
| `Ctrl + \`` | Toggle integrated terminal |
| `Escape` | Close any open dialog/overlay |

## Common Tasks Quick Reference

| Task | What to do |
|------|-----------|
| Add REST endpoint | Add route in `server.ts`, enforce `homedir()` security via `path-utils.ts`, document in ARCHITECTURE.md |
| Add WS message type | Update `server.ts` switch + `copilot-bridge.ts` event + `app.js` `send()` + `handleMessage()` (all four locations) |
| Add UI button | HTML in `index.html` `#controls`, CSS in `styles.css`, JS handler in `app.js` |
| Add SDK event | Handle in `copilot-bridge.ts` `_handleSessionEvent()`, emit, wire through `server.ts` → `app.js` |
| Add demo step type | Handle in `runDemo()` in `server.ts`, add `demo_step_*` handling in `app.js` |
| Add setting | HTML toggle in `#settings-window`, localStorage `dg-*` key, wire in settings panel section of `app.js` |
| Add overlay/dialog | Add HTML with `role="dialog" aria-modal="true"`, call `setupDialogOverlay()` in `app.js` |
| Add ES module | Create `src/public/name.js`, add `<script type="module">` in `index.html`, use `window.__demogod*` for IIFE bridge |
| Type-check | `npx tsc --noEmit` |
| Run all tests | `npm test` (unit + E2E) |
| Run unit tests | `npm run test:unit` (Vitest) |
| Run E2E tests | `npm run test:e2e` (Playwright) |
| Run showcase | `npm run test:showcase` (headed) |
| Run generated demos | `npm run test:generated` (headed) |
| Record a demo | `npm run record` (interactive) or `npm run record -- --demo name` (automated) |
| Dev server | `npm run dev` (hot reload on :3456) |
| Desktop dev | `npm run desktop` (Tauri + Node hot reload) |
