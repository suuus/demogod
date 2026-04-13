# DemoGod Architecture

> Internal reference for developers and AI assistants. Read this before making changes.

## System Overview

DemoGod is a web-based tool for creating interactive demo videos of GitHub Copilot CLI. It runs an Express/WebSocket server that bridges a browser-based terminal UI to real Copilot CLI sessions (via the `@github/copilot-sdk`) or plays back scripted demos with realistic timing.

```
┌─────────────────────────────────────────────────────────────────┐
│  Tauri Shell (src-tauri/) — optional desktop wrapper            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Rust process: spawns Node sidecar, manages window lifecycle│  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                              │ loads webview                    │
├──────────────────────────────┼──────────────────────────────────┤
│  Browser / Webview (src/public/)                                │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐         │
│  │ Terminal UI  │  │ Dialog System│  │ File/Tab Viewer│         │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘         │
│         │                │                   │                  │
│  ┌──────▼────────────────▼───────────────────▼──────────────┐   │
│  │  SessionManager / FloatingWindowManager                  │   │
│  │  • Manages multiple TerminalSession instances            │   │
│  │  • Tab mode or floating window mode with grid snapping   │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │ WebSocket (JSON) — one per session    │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│  Server (src/server.ts) │                                       │
│                         ▼                                       │
│  ┌──────────────────────────────────────────────────┐           │
│  │  WebSocket Handler                               │           │
│  │  • Routes messages to bridge or demo engine      │           │
│  │  • Manages per-connection session state           │           │
│  └────────┬──────────────────────────┬──────────────┘           │
│           │                          │                          │
│  ┌────────▼────────┐     ┌──────────▼──────────────┐           │
│  │ CopilotBridge   │     │ Demo Engine              │           │
│  │ (copilot-bridge │     │ (scripted playback       │           │
│  │  .ts)           │     │  with timing)            │           │
│  └────────┬────────┘     └─────────────────────────┘           │
│           │                                                     │
│  ┌────────▼────────┐     ┌─────────────────────────┐           │
│  │ MCP Discovery   │     │ PTY Server              │           │
│  │ (server.ts)     │     │ (pty-server.ts)         │           │
│  │ discovers tools │     │ shell spawn + WS bridge │           │
│  │ from MCP servers│     └─────────────────────────┘           │
│  └─────────────────┘                                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────┐           │
│  │  REST API (Express)                              │           │
│  │  /api/browse  /api/file  /api/demos/:name        │           │
│  │  /api/browse-files  /api/models  /api/changelog  │           │
│  └──────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
             ┌────────────────────────┐
             │  GitHub Copilot CLI    │
             │  (@github/copilot-sdk) │
             └────────────────────────┘
```

## File Map

```
src/
├── server.ts            # Express server, WS handler, REST API,
│                        #   MCP tool discovery, demo engine (live + scripted)
├── copilot-bridge.ts    # CopilotClient/Session wrapper,
│                        #   event forwarding, sub-agent detection, user input handling
├── pty-server.ts        # PTY WebSocket server (shell spawn, resize, cleanup)
├── path-utils.ts        # Shared path security (safeRealpath, isUnderHome)
└── public/
    ├── index.html       # Page structure, overlays, dialogs, settings panel, bottom-right controls
    ├── app.js           # All frontend logic (class-based, vanilla JS)
    ├── terminal.js      # Integrated terminal module (xterm.js + PTY WebSocket)
    └── styles.css       # Theming, terminal look, dialogs, settings, agent tabs

src-tauri/
├── src/                 # Rust entry point, sidecar spawning logic
├── Cargo.toml           # Rust crate config
└── tauri.conf.json      # Tauri window config, sidecar definition, build settings

demo/
└── sample-app/          # Tiny Node.js task tracker project for demo showcases

demos/
├── intro.json           # Scripted demo (command + question steps)
└── showcase.json        # Live demo with UI automation (layout, tile, sub-agents)

docs/
└── ARCHITECTURE.md      # This file

.github/
├── copilot-instructions.md  # Context for GitHub Copilot
└── workflows/
    └── desktop-build.yml    # CI workflow for cross-platform Tauri builds
```

## Key Components

### 1. CopilotBridge (`src/copilot-bridge.ts`)

The bridge wraps the `@github/copilot-sdk` and translates SDK events into simple EventEmitter events consumed by the WebSocket handler.

**Lifecycle:**
1. `new CopilotBridge()` — creates a `CopilotClient`
2. `createSession(model?, workDir?, customAgents?, skillDirs?)` — starts a Copilot session with:
   - All tools enabled (no filtering)
   - All skills enabled (via `enableAllSkills()` after creation)
   - Infinite sessions mode
   - Auto-approve all permission requests
   - Custom system instructions for `ask_user` behavior
3. `sendPrompt(text)` — sends a user message (non-blocking via `session.send()`)
4. `resolveUserInput(requestId, values)` — resolves pending user input/elicitation requests
5. `abort()` / `stop()` — cancel current operation / tear down session

**Events emitted:**

| Event | Data | Triggered by |
|-------|------|-------------|
| `delta` | `(text, parentToolCallId?)` | Streaming text chunks |
| `message` | `(content)` | Complete assistant message |
| `idle` | — | Session ready for next input |
| `error` | `(text)` | Session error |
| `user_input` | `UserInputBridgeRequest` | SDK needs user input or elicitation |
| `tool_start` | `{toolName, toolArgs, parentToolCallId?}` | Tool execution begins |
| `tool_complete` | `{toolName, toolResult?, toolCallId?, parentToolCallId?}` | Tool execution ends |
| `tool_partial` | `{toolCallId, partialOutput}` | Partial tool result |
| `tool_progress` | `{toolCallId, progressMessage}` | Tool progress update |
| `intent` | `(text)` | Agent reports current intent |
| `file_changed` | `{path, operation}` | Workspace file modified |
| `subagent_start` | `{agentName, agentDisplayName, type, description}` | `task` tool detected in `onPreToolUse` |
| `subagent_complete` | `{agentName, agentDisplayName, toolResult}` | `task` tool completed in `onPostToolUse` |
| `subagent_output` | `{agentId, agentName, output}` | `read_agent` tool completed — background agent results |
| `task_complete` | `{summary}` | Task finished |
| `capabilities_loaded` | `{kind, items, ...}` | Skills/agents/MCP/extensions loaded |
| `mcp_status` | `{serverName, status}` | MCP server status change |
| `permission_request` | `{requestId, permissionKind, details}` | Tool permission awaiting user approval (when auto-approve is off) |

**Critical design decisions:**
- Uses `session.send()` not `session.sendAndWait()` — sub-agent tasks can run indefinitely
- `onPermissionRequest` is configurable at runtime via `bridge.autoApprove` (toggled by `set_auto_approve` WS message). When `true` (default), all permission requests are auto-approved; when `false`, a `permission_request` event is emitted and the frontend shows an inline Allow/Deny prompt — see [Permission Requests](#permission-requests) below.
- `systemMessage: { mode: "append" }` — adds `ask_user` instructions without replacing the default system prompt
- `infiniteSessions: { enabled: true }` — session persists across long interactions

### 2. Server (`src/server.ts`)

The server is a single-file Express + WebSocket application with these sections:

#### Plugin / MCP Tool Discovery

The SDK handles plugin and config discovery automatically via `enableConfigDiscovery: true` in the session config. This auto-discovers agents, skills, and MCP servers from `~/.copilot/installed-plugins/` and project-local configs (`.mcp.json`, `.github/agents/`, chatmodes). The server does **not** manually pass `customAgents` or `skillDirectories` to session creation.

Additionally, the server includes a manual MCP tool discovery system (`queryMcpServerTools()`, `discoverAllMcpTools()`) that spawns MCP server processes via stdio to query their tool lists. This is used only for the capabilities panel to show MCP server tools alongside SDK-discovered tools.

#### REST API

| Endpoint | Purpose | Security |
|----------|---------|----------|
| `GET /api/browse?path=` | Directory listing for project picker | Restricted to `homedir()` |
| `GET /api/browse-files?path=` | Directory + file listing for file browser | Restricted to `homedir()` |
| `GET /api/file?path=` | Read text file content | Restricted to `homedir()`, allowlisted extensions |
| `GET /api/demos` | List available demo scripts | None (local only) |
| `GET /api/demos/:name` | Load demo script JSON | Sanitized name (`[a-zA-Z0-9_-]`), path under `DEMOS_DIR` |
| `GET /api/models` | List available Copilot models | None (local only) |
| `GET /api/changelog` | Serve `CHANGELOG.md` content | None (local only) |

#### WebSocket Handler

WebSocket connections go through a `verifyClient` gate before the upgrade handshake completes. `verifyClient` validates two things:
1. The `?token=` query parameter matches the session token generated at startup.
2. The `Origin` header is a localhost address (rejects external origins to prevent CSRF).

Per-connection state:
- `bridge` — `CopilotBridge` instance (one per WS connection)
- `demoAbort` — `AbortController` for cancelling scripted demos
- `currentWorkingDir` — project directory for the session

**Message routing (Client → Server):**

| Message type | Handler |
|-------------|---------|
| `create_session` | Tears down old bridge, creates new session with working dir + model |
| `send_prompt` | Forwards to bridge (with `/skill-name` prefix detection) |
| `user_input_response` | Resolves pending input via `bridge.resolveUserInput()` |
| `start_demo` / `cancel_demo` | Starts/stops scripted demo playback |
| `abort` | Cancels current Copilot operation |
| `set_model` | Changes model mid-session |
| `list_agents` / `select_agent` / `deselect_agent` | Agent management (SDK + plugin merge) |
| `list_skills` | Returns merged SDK + plugin skills |
| `list_capabilities` | List MCP servers, skills, and tools for capabilities panel |
| `toggle_mcp` | Enable/disable an MCP server |
| `toggle_skill` | Enable/disable a skill |
| `get_mode` / `set_mode` | Copilot mode (interactive/plan/autopilot) |

**Server → Client messages** include: `session_ready` (includes `branch` field for git branch), `capabilities_loaded`, `capabilities_list`, `capabilities_update`, `mcp_status`, `mcp_tools_discovered`, `agents_list`, `skills_list`, `delta`, `message`, `idle`, `error`, `user_input`, `tool_start`, `tool_complete`, `subagent_start`, `subagent_complete`, `subagent_output`, `demo_step_*`, `demo_action`, `demo_complete`.

#### Demo Engine

Plays back JSON demo scripts with realistic timing:
- `command` steps: types out text, waits, shows response
- `question` steps: types text, shows dialog with auto-fill, waits, shows response
- Cancellable via `AbortController`
- Timing formula: typing speed × character count + word-count-based reading delays

### 3. Frontend (`src/public/`)

**Zero-dependency vanilla JS** — intentionally no framework, no bundler, no build step.

#### `app.js` — Application Logic

Class-based architecture. Major sections:

| Section | Description |
|---------|-------------|
| **State** | Mode, processing flag, selected project/model/agent |
| **WebSocket** | Connect, auto-reconnect on disconnect |
| **Message handler** | Maps WS message types to UI updates |
| **Terminal rendering** | `appendDelta()`, `finishResponse()`, `appendSystemMessage()` — builds response blocks with markdown |
| **Dialog system** | Popup overlays for user input/elicitation, JSON Schema → form field generation |
| **Tool indicators** | Collapsible panels showing tool calls and results |
| **Project picker** | Directory browser overlay |
| **File browser** | Open files in tabs |
| **Capability pickers** | Model, agent, skill, and mode selection dialogs |
| **Screen recording** | MediaRecorder API for capturing demos as video |
| **Background customization** | Chroma key green, custom colors, or Aurora Borealis animated theme for video compositing |
| **TerminalSession** | Encapsulates a single Copilot session — its own WS connection, terminal state, and DOM output area. `_displayName()` returns "projectname · Session N" for tab/window titles; `_updateTitles()` refreshes all title surfaces when the project changes |
| **SessionManager** | Creates, destroys, and switches between `TerminalSession` instances (tab bar or keyboard shortcuts) |
| **FloatingWindowManager** | Detaches sessions into draggable, resizable floating windows with grid snap zones |
| **Tab system** | Chat tab + dynamically opened file/report tabs |
| **Markdown rendering** | Inline code, fenced code blocks, bold, links, lists — lightweight custom renderer |
| **Inline question detection** | When the agent asks in prose despite instructions, auto-detects and renders an inline form |

#### `index.html` — Structure

- **Control bar** (top): project picker, mode toggle, popup toggle, file browser, new session, model/agent/skill pickers, 🔌 capabilities, record button, background color
- **Terminal window**: macOS-style chrome with title bar, tab bar, output area, input line, status bar (shows git branch; shows yellow `auto-approve` text when auto-approve is enabled)
- **Bottom-right controls**: version badge (`<a>` tag — click to view `CHANGELOG.md` in a tab via `GET /api/changelog`) and settings icon
- **Overlay dialogs**: project picker, file browser, user input dialog, capability picker

#### `styles.css` — Theming

- CSS custom properties for colors and fonts
- JetBrains Mono for terminal text, Inter for UI chrome
- macOS-style window chrome (traffic lights, title bar)
- Dark terminal theme with syntax highlighting classes
- Terminal fills viewport, dialogs are centered modals

## Multi-Session Frontend Architecture

The frontend uses a class-based architecture to support multiple concurrent Copilot sessions.

### TerminalSession

Each `TerminalSession` instance encapsulates:
- Its own WebSocket connection to the server
- Independent terminal state (output buffer, processing flag, current model/agent)
- A dedicated DOM output area that is shown/hidden when switching sessions

When a session is created, the server creates a fresh `CopilotBridge` on the corresponding WebSocket connection — so each session has a fully isolated Copilot context.

### SessionManager

`SessionManager` is the top-level controller for all sessions:
- Creates new sessions (allocating a `TerminalSession` + tab in the tab bar)
- Destroys sessions (tears down the WS connection and removes the tab/DOM)
- Switches the active session (hides the old output area, shows the new one)
- Responds to keyboard shortcuts (macOS: `Ctrl+T/W/N/P`, other: `Alt+T/W/N/P`)

### FloatingWindowManager

`FloatingWindowManager` handles the floating window layout mode:
- Detaches a `TerminalSession` from the tab bar into a draggable, resizable window
- Implements snap zones — when a window is dragged near a screen edge or another window, it snaps to a grid position for clean side-by-side layouts
- Re-docks windows back into the tab bar

## Layout Modes

### Tab Mode (default)

Sessions appear as tabs in the terminal tab bar, showing the project name and session number (e.g. "demogod · Session 1") via `_displayName()`. Only one session is visible at a time — the active session shows a blinking native caret, inactive sessions hide it. Keyboard shortcuts cycle through tabs.

### Floating Window Mode

Sessions can be "popped out" into independent floating windows within the app viewport. Each floating window:
- Is draggable and resizable
- Snaps to a grid (half-screen, quarter-screen, etc.) when dragged near edges
- Has its own title bar with close/minimize/dock controls

Users can mix modes — some sessions in tabs, others floating.

## Tauri Desktop Integration

DemoGod optionally runs as a native desktop app using [Tauri v2](https://v2.tauri.app/). The Tauri layer is in `src-tauri/`.

### Prerequisites

The desktop app is a **native window wrapper**, not a standalone installer. The host machine must have:
- **Node.js** v20+ and **npm** — the Rust sidecar spawns `node --import tsx src/server.ts`
- **npm dependencies installed** — `npm install` before first launch
- **GitHub CLI** authenticated — `gh auth login` for Copilot session access

### Sidecar Pattern

Tauri uses a **sidecar** approach to run the Node.js server:
- **Production builds**: The Rust process spawns the bundled Node server as a child process (sidecar). The Tauri webview loads the UI from `localhost`.
- **Development**: `npm run desktop` uses Tauri's `beforeDevCommand` to start `npm run dev` automatically, so the Node server runs with hot reload while Tauri provides the native window.

### Window Lifecycle

1. Tauri Rust `main()` starts → spawns Node sidecar → waits for the server to be ready
2. Creates the main webview window pointing at `http://localhost:3456`
3. When the window is closed, Tauri tears down the sidecar process

### PTY Terminal (`src/pty-server.ts` + `src/public/terminal.js`)

The integrated terminal is an optional feature (enabled via Settings → Experimental or always visible in Tauri). The PTY server spawns a shell process and bridges it to the browser via a dedicated `/pty` WebSocket endpoint.

- **Backend** (`pty-server.ts`): `setupPtyServer(server, verifyWsClient)` creates a `WebSocketServer`, validates the shell against `ALLOWED_SHELLS`, restricts `cwd` to `homedir()` via shared `path-utils.ts`, and handles resize/data/cleanup.
- **Frontend** (`terminal.js`): ES module that manages xterm.js lifecycle, WebSocket connection, and keyboard shortcut (Ctrl+`).

### Path Security (`src/path-utils.ts`)

Shared module exporting `safeRealpath(path)` and `isUnderHome(realPath)`. Used by both `server.ts` (file APIs) and `pty-server.ts` (cwd validation) to ensure all filesystem access stays under `homedir()`.

### Build & CI

> **Status:** Desktop production builds are currently disabled. Use `npm run desktop` for local macOS development.

`npm run build:desktop` compiles the Rust shell and bundles the Node server into platform-specific installers (`.dmg`, `.msi`/`.exe`, `.deb`/`.AppImage`). The `.github/workflows/desktop-build.yml` workflow (currently disabled) runs this across macOS, Windows, and Linux runners.

## Data Flow Examples

### Live Copilot Interaction

```
User types prompt
  → app.js sends {type:"send_prompt", prompt}
    → server.ts handlePrompt()
      → bridge.sendPrompt()
        → SDK session.send({prompt})
          → SDK streams "assistant.message_delta" events
            → bridge emits "delta"
              → server.ts safeSend({type:"delta", text})
                → app.js appendDelta() renders incrementally
          → SDK emits "session.idle"
            → bridge emits "idle"
              → server.ts safeSend({type:"idle"})
                → app.js finishResponse(), setProcessing(false)
```

### User Input (ask_user / Elicitation)

```
SDK calls onUserInputRequest or onElicitationRequest
  → bridge creates a request ID, stores Promise resolver, emits "user_input"
    → server.ts safeSend({type:"user_input", requestId, ...})
      → app.js showDialog() renders form from choices/schema
        → User fills form, clicks Submit
          → app.js sends {type:"user_input_response", requestId, values}
            → server.ts bridge.resolveUserInput(requestId, values)
              → bridge resolves the stored Promise
                → SDK callback returns, agent continues
```

### Permission Requests

When **Auto-approve Permissions** is disabled (`bridge.autoApprove = false`), the Copilot SDK's `onPermissionRequest` hook routes through the frontend instead of immediately approving:

```
SDK calls onPermissionRequest (file write, shell command, MCP call, …)
  → bridge stores Promise resolver in pendingPermissions map, emits "permission_request"
    → server.ts safeSend({type:"permission_request", requestId, permissionKind, details})
      → app.js renders inline Allow / Deny prompt in the terminal output
        → User clicks Allow or Deny
          → app.js sends {type:"permission_response", requestId, approved: true|false}
            → server.ts bridge.resolvePermission(requestId, approved)
              → bridge resolves the stored Promise
                → SDK callback returns { kind: "approved" } or { kind: "denied-interactively-by-user" }
```

The toggle state is persisted in `localStorage` (`dg-auto-approve`). When auto-approve is **on**, a yellow ⚡ **auto-approve** badge is shown in the session status bar. The frontend syncs the current toggle state to the server on session creation and on every toggle change via `{type:"set_auto_approve", enabled: bool}`.

### Scripted Demo Playback

```
User clicks ⌨️ Mode button
  → app.js fetches GET /api/demos → list of available demos
  → Opens demo picker (cappicker with mode="demo")
  → User selects a demo (e.g. "showcase")
    → app.js sends {type:"start_demo", demo:"showcase"}
      → server.ts runDemo("showcase")
        → Reads demos/showcase.json
        → For each step:
          "command" → safeSend(demo_step_command) → sleep → safeSend(demo_step_response)
          "question" → safeSend(demo_step_command) → safeSend(demo_step_question) → sleep → safeSend(demo_step_response)
          "live"    → safeSend(demo_step_command) → handlePrompt(text) → waitForIdle() → sleep
          "action"  → safeSend({type:"demo_action", action, value}) → sleep
        → safeSend({type:"demo_complete"})
```

### Demo Actions (UI Automation)

The `"action"` step type sends a `demo_action` WS message that the frontend handles in `_handleDemoAction()`:

| Action | Value | Effect |
|--------|-------|--------|
| `layout` | `"tabs"` or `"floating"` | Switch layout mode |
| `tile` | — | Tile all floating windows |
| `model` | model ID string | Switch the active model |
| `open_file` | file path | Open a file in a tab |
| `new_session` | — | Create a new session |

### Sub-Agent Tab Architecture (v0.0.7)

Sub-agents are detected via the `task` tool in `onPreToolUse`/`onPostToolUse` hooks (the SDK does **not** emit `subagent.started`/`subagent.completed` events):

```
Copilot calls task tool
  → onPreToolUse: detects tool_name === "task"
    → Push to activeTaskAgents stack
    → Emit subagent_start {agentName, type, description}
      → server.ts forwards via WS
        → app.js _openSubAgentTab(): creates tab with type icon + name
  → onPostToolUse: detects task tool complete
    → Pop from activeTaskAgents stack
    → Parse toolResult for backgroundAgentMap registration
    → Emit subagent_complete {agentName, toolResult}
      → app.js _completeSubAgentTab(): shows parsed result in tab

Background agent output:
  → Copilot calls read_agent tool
    → onPostToolUse: matches agent_id in backgroundAgentMap
    → Emit subagent_output {agentId, agentName, output}
      → app.js _appendSubAgentOutput(): routes to matching tab
```

**Key limitations**: SDK doesn't stream sub-agent internals (deltas/tool events) to the parent session. With parallel agents, there's no reliable way to route events to specific agent tabs — only start and complete events are tracked.

## Plugin / Config Discovery

Session creation uses `enableConfigDiscovery: true` in the SDK session config. This auto-discovers agents, skills, and MCP servers from `~/.copilot/installed-plugins/` and project-local configs (`.mcp.json`, `.github/agents/`, chatmodes). The server does **not** manually pass `customAgents` or `skillDirectories` to session creation.

The `/skill-name` slash command handler in `server.ts` still lists skills at runtime via `bridge.listSkills()` to verify the skill name before transforming the prompt.

## Capabilities Panel

The 🔌 button in the control bar opens the Capabilities Panel, which displays:
- **MCP Servers**: status dots (green/red) and enable/disable toggles
- **Built-in Tools**: tools provided by the Copilot CLI
- **MCP Server Tools**: discovered via MCP protocol (`initialize` + `tools/list` over stdio) and runtime tracking; `github-mcp-server` tools are hardcoded since it's embedded in the CLI
- **Skills**: with enable/disable toggles

The panel includes a filter input and collapsible sections with count badges. MCP server state changes and tool discoveries are pushed to the frontend via `capabilities_update`, `mcp_status`, and `mcp_tools_discovered` WebSocket messages.

## Git Branch Detection

On session creation, the server runs `git rev-parse --abbrev-ref HEAD` in the working directory. The branch name is included in the `session_ready` WebSocket message and displayed in the terminal status bar.

## Mode-Colored Borders

Session containers use mode-colored subtle separator lines via the `--titlebar-border` CSS variable, overridden per session through the `data-copilot-mode` attribute on `.session-container`:
- **Green** border = autopilot mode
- **Purple** border = plan mode

## Security Model

| Surface | Protection |
|---------|-----------|
| File browsing (`/api/browse`, `/api/browse-files`) | Path must be under `homedir()` |
| File reading (`/api/file`) | Path under `homedir()` + allowlisted extensions only |
| Demo loading (`/api/demos/:name`) | Name sanitized to `[a-zA-Z0-9_-]`, resolved path must start with `DEMOS_DIR` |
| WebSocket token auth | Session token (`randomBytes(32)`) generated at startup, injected into `index.html` via `<meta name="dg-token">`, verified in `verifyClient` on every WS upgrade |
| Origin checking | `verifyClient` rejects WS connections from non-localhost origins (prevents CSRF) |
| Localhost binding | `server.listen(PORT, "127.0.0.1")` — server is never accessible from the network |
| WebSocket | One bridge per connection, input validated per message type |
| Copilot permissions | Configurable: auto-approve (default, for demo use) or interactive Allow/Deny prompt per request — toggled via Settings → Features |

> **Important**: DemoGod is designed for **local development use**. The default auto-approve permission policy and unrestricted tool access are intentional for demo purposes — use Settings → Features → *Auto-approve Permissions* to require explicit approval for each request. Do not expose to untrusted networks without additional access controls.

## Extension Points

### Adding new SDK events
1. Handle the event in `_handleSessionEvent()` in `copilot-bridge.ts`
2. Emit a named event from the bridge
3. Listen for it in the WS handler in `server.ts`, forward via `safeSend()`
4. Handle the message type in `app.js`'s `handleMessage()` switch

### Adding new UI controls
1. Add the button HTML in `index.html` (in the `#controls` div)
2. Style it in `styles.css`
3. Wire up the click handler and WS message in `app.js`
4. Add the server-side handler in `server.ts`'s message switch

### Adding new REST endpoints
1. Add the route in `server.ts` after the existing routes (before the WS handler)
2. Follow security patterns (validate paths against `homedir()`, sanitize input)
3. Document in the REST API table above and in `docs/ARCHITECTURE.md`

### Adding new demo step types
1. Add the step handling logic in `runDemo()` in `server.ts`
2. Add corresponding `demo_step_*` or `demo_action` handling in `app.js`
3. Document the step schema in the demo script section of `docs/ARCHITECTURE.md`

### Adding new demo actions
1. Add the action case in `_handleDemoAction()` in `app.js`
2. Use it in demo JSON: `{"type": "action", "action": "your_action", "value": "..."}`

### Adding a new setting
1. Add HTML toggle/dropdown in `#settings-window` in `index.html`
2. Add a `dg-*` localStorage key
3. Wire up event listener + init in the settings panel section of `app.js`

## ARIA Accessibility

DemoGod has comprehensive ARIA role attributes throughout its UI, enabling screen reader support and making it compatible with Playwright's `getByRole` locators for automated testing.

### Role Map

| Element | ARIA attributes | Notes |
|---------|----------------|-------|
| `#controls` | `role="toolbar"` + `aria-label` | Top control bar |
| All control bar buttons | `aria-label` (deterministic names) | 16 buttons with getByRole-compatible names |
| `.session-tab-bar` | `role="tablist"` | Session tab strip |
| Dynamic session tabs | `role="tab"` + `aria-selected` | `aria-selected` managed by `switchTo()` |
| Tab close buttons | `<button>` + `aria-label` | Changed from `<span>` for keyboard access |
| `#tab-bar` | `role="tablist"` | Inner file/report tab bar |
| Chat tab + dynamic tabs | `role="tab"` + `aria-selected` | Managed by `switchTab()` |
| Tab panels | `role="tabpanel"` + `aria-label` | Chat, file view, report panels |
| `.session-input` (contenteditable) | `role="textbox"` + `aria-label="Chat input"` | Chat prompt input |
| `.status-text` | `role="status"` | Announces status changes to screen readers |
| Picker lists | `role="listbox"` | `#picker-list`, `#filebrowser-list`, `#cappicker-list` |
| Picker items | `role="option"` | Dynamic items in all pickers |
| Dialog close dots | `role="button"` + `tabindex=0` + `aria-label` | All 7 traffic-light close controls |

### Focus Visibility

- Global `:focus-visible` rule: 2px solid accent outline for all focusable elements
- Custom focus style for `.session-input`: bottom border glow using `--accent`

## Playwright MCP Server

DemoGod ships a `.mcp.json` in the project root that configures `@playwright/mcp` as a dev-time MCP server for Copilot. This gives Copilot live browser tools (navigate, screenshot, click, type, snapshot/accessibility tree) when working on demo specs.

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp", "--headless=false"],
      "type": "local",
      "tools": ["*"]
    }
  }
}
```

The `--headless=false` flag opens a visible browser window so Copilot can inspect the live DemoGod UI rather than guessing selectors from documentation. This transforms Playwright spec generation from "guess and iterate" to "inspect, click, verify."

## Testing

DemoGod has 48 unit tests (via Vitest) and 14 E2E tests (via Playwright) covering security, path validation, PTY exports, MCP discovery, API endpoints, WebSocket lifecycle, and full UI walkthroughs. See **[`docs/TESTING.md`](TESTING.md)** for details.

## Recording

Demos can be recorded via the browser's built-in ⏺ button (MP4 on Chrome/Edge/Safari, WebM on Firefox) or via Playwright-based automated recording (`npm run record`). See **[`docs/RECORDING.md`](RECORDING.md)** for details.

## Dependencies

| Package | Purpose | Why this one |
|---------|---------|-------------|
| `@github/copilot-sdk` | Core Copilot integration | Official SDK — the only way to programmatically talk to Copilot CLI |
| `express` | HTTP server | Lightweight, well-known, serves static files + JSON API |
| `ws` | WebSocket server | De facto Node.js WebSocket library, minimal overhead |
| `node-pty` | Terminal emulator | Native PTY for integrated terminal (experimental) |
| `@xterm/xterm` | Terminal UI | Standard terminal component for the integrated terminal (experimental) |
| `tsx` | TypeScript runner (dev) | Zero-config TS execution with watch mode for development |
| `typescript` | Type checking (dev) | Strict mode type checking, not used at runtime |

The frontend has **zero npm dependencies** — all rendering, markdown parsing, and UI logic is hand-rolled vanilla JS. This is a deliberate choice to keep the demo experience fast and dependency-free.
