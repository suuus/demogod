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
│  ┌────────▼────────┐                                            │
│  │ Plugin Scanners │  Discovers agents/skills from              │
│  │ (server.ts)     │  ~/.copilot/installed-plugins/             │
│  └─────────────────┘                                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────┐           │
│  │  REST API (Express)                              │           │
│  │  /api/browse  /api/file  /api/demos/:name        │           │
│  │  /api/browse-files  /api/models                  │           │
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
├── server.ts            # ~860 lines — Express server, WS handler, REST API,
│                        #   plugin scanners (skills + agents), demo engine
├── copilot-bridge.ts    # ~350 lines — CopilotClient/Session wrapper,
│                        #   event forwarding, user input handling
└── public/
    ├── index.html       # Page structure, overlays, dialogs
    ├── app.js           # ~2450 lines — all frontend logic (class-based, vanilla JS)
    └── styles.css       # ~1250 lines — theming, terminal look, dialogs

src-tauri/
├── src/                 # Rust entry point, sidecar spawning logic
├── Cargo.toml           # Rust crate config
└── tauri.conf.json      # Tauri window config, sidecar definition, build settings

demos/
└── intro.json           # Example scripted demo (command + question steps)

docs/
└── ARCHITECTURE.md      # This file

.github/workflows/
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
| `subagent_start/complete` | `{agentName, agentDisplayName}` | Sub-agent lifecycle |
| `task_complete` | `{summary}` | Task finished |
| `capabilities_loaded` | `{kind, items, ...}` | Skills/agents/MCP/extensions loaded |
| `mcp_status` | `{serverName, status}` | MCP server status change |

**Critical design decisions:**
- Uses `session.send()` not `session.sendAndWait()` — sub-agent tasks can run indefinitely
- `onPermissionRequest: approveAll` — demo mode auto-approves everything
- `systemMessage: { mode: "append" }` — adds `ask_user` instructions without replacing the default system prompt
- `infiniteSessions: { enabled: true }` — session persists across long interactions

### 2. Server (`src/server.ts`)

The server is a single-file Express + WebSocket application with these sections:

#### Plugin Scanners (lines ~15–315)

Discovers skills and agents from `~/.copilot/installed-plugins/`:
- **Skill scanner** — walks plugin directories, parses `SKILL.md` frontmatter, collects skill directory paths for `SessionConfig.skillDirectories`
- **Agent scanner** — finds `.agent.md` files, extracts frontmatter + prompt body
- Both are cached for the server lifetime

#### REST API (lines ~316–460)

| Endpoint | Purpose | Security |
|----------|---------|----------|
| `GET /api/browse?path=` | Directory listing for project picker | Restricted to `homedir()` |
| `GET /api/browse-files?path=` | Directory + file listing for file browser | Restricted to `homedir()` |
| `GET /api/file?path=` | Read text file content | Restricted to `homedir()`, allowlisted extensions |
| `GET /api/demos/:name` | Load demo script JSON | Sanitized name (`[a-zA-Z0-9_-]`), path under `DEMOS_DIR` |
| `GET /api/models` | List available Copilot models | None (local only) |

#### WebSocket Handler (lines ~472–846)

Per-connection state:
- `bridge` — `CopilotBridge` instance (one per WS connection)
- `demoAbort` — `AbortController` for cancelling scripted demos
- `selectedPluginAgent` — currently selected plugin agent
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
| `get_mode` / `set_mode` | Copilot mode (interactive/plan/autopilot) |

#### Demo Engine (lines ~620–693)

Plays back JSON demo scripts with realistic timing:
- `command` steps: types out text, waits, shows response
- `question` steps: types text, shows dialog with auto-fill, waits, shows response
- Cancellable via `AbortController`
- Timing formula: typing speed × character count + word-count-based reading delays

### 3. Frontend (`src/public/`)

**Zero-dependency vanilla JS** — intentionally no framework, no bundler, no build step.

#### `app.js` — Application Logic

Class-based architecture (~2450 lines). Major sections:

| Section | Description |
|---------|-------------|
| **State** (~lines 1–20) | Mode, processing flag, selected project/model/agent |
| **WebSocket** (~lines 79–92) | Connect, auto-reconnect on disconnect |
| **Message handler** (~lines 101–260) | Maps WS message types to UI updates |
| **Terminal rendering** | `appendDelta()`, `finishResponse()`, `appendSystemMessage()` — builds response blocks with markdown |
| **Dialog system** | Popup overlays for user input/elicitation, JSON Schema → form field generation |
| **Tool indicators** | Collapsible panels showing tool calls and results |
| **Project picker** | Directory browser overlay |
| **File browser** | Open files in tabs |
| **Capability pickers** | Model, agent, skill, and mode selection dialogs |
| **Screen recording** | MediaRecorder API for capturing demos as video |
| **Background customization** | Chroma key green or custom colors for video compositing |
| **TerminalSession** | Encapsulates a single Copilot session — its own WS connection, terminal state, and DOM output area |
| **SessionManager** | Creates, destroys, and switches between `TerminalSession` instances (tab bar or keyboard shortcuts) |
| **FloatingWindowManager** | Detaches sessions into draggable, resizable floating windows with grid snap zones |
| **Tab system** | Chat tab + dynamically opened file/report tabs |
| **Markdown rendering** | Inline code, fenced code blocks, bold, links, lists — lightweight custom renderer |
| **Inline question detection** | When the agent asks in prose despite instructions, auto-detects and renders an inline form |

#### `index.html` — Structure

- **Control bar** (top): project picker, mode toggle, popup toggle, file browser, new session, model/agent/skill pickers, record button, background color
- **Terminal window**: macOS-style chrome with title bar, tab bar, output area, input line, status bar
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
- Responds to keyboard shortcuts (`Ctrl+Shift+T`, `Ctrl+W`, `Ctrl+Tab`, `Ctrl+Shift+Tab`)

### FloatingWindowManager

`FloatingWindowManager` handles the floating window layout mode:
- Detaches a `TerminalSession` from the tab bar into a draggable, resizable window
- Implements snap zones — when a window is dragged near a screen edge or another window, it snaps to a grid position for clean side-by-side layouts
- Re-docks windows back into the tab bar

## Layout Modes

### Tab Mode (default)

Sessions appear as tabs in the terminal tab bar. Only one session is visible at a time. Keyboard shortcuts cycle through tabs.

### Floating Window Mode

Sessions can be "popped out" into independent floating windows within the app viewport. Each floating window:
- Is draggable and resizable
- Snaps to a grid (half-screen, quarter-screen, etc.) when dragged near edges
- Has its own title bar with close/minimize/dock controls

Users can mix modes — some sessions in tabs, others floating.

## Tauri Desktop Integration

DemoGod optionally runs as a native desktop app using [Tauri v2](https://v2.tauri.app/). The Tauri layer is in `src-tauri/`.

### Sidecar Pattern

Tauri uses a **sidecar** approach to run the Node.js server:
- **Production builds**: The Rust process spawns the bundled Node server as a child process (sidecar). The Tauri webview loads the UI from `localhost`.
- **Development**: `npm run desktop` uses Tauri's `beforeDevCommand` to start `npm run dev` automatically, so the Node server runs with hot reload while Tauri provides the native window.

### Window Lifecycle

1. Tauri Rust `main()` starts → spawns Node sidecar → waits for the server to be ready
2. Creates the main webview window pointing at `http://localhost:3456`
3. When the window is closed, Tauri tears down the sidecar process

### Build & CI

`npm run build:desktop` compiles the Rust shell and bundles the Node server into platform-specific installers (`.dmg`, `.msi`/`.exe`, `.deb`/`.AppImage`). The `.github/workflows/desktop-build.yml` workflow runs this across macOS, Windows, and Linux runners.

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

### Scripted Demo Playback

```
User selects "Scripted" mode, picks a demo
  → app.js sends {type:"start_demo", demo:"intro"}
    → server.ts runDemo("intro")
      → Reads demos/intro.json
      → For each step:
        → safeSend({type:"demo_step_command", text, typingSpeed})
        → cancellableSleep(typing duration)
        → safeSend({type:"demo_step_response", text})
        → cancellableSleep(reading duration)
      → safeSend({type:"demo_complete"})
```

## Plugin System

DemoGod discovers and integrates plugins from `~/.copilot/installed-plugins/`:

### Plugin Skills
- Scanned from `skills/` or `.github/skills/` directories within each plugin
- Each skill has a `SKILL.md` with YAML frontmatter (`name`, `description`, `user-invocable`)
- Skill directory paths are passed to `SessionConfig.skillDirectories` so the SDK loads them
- Also merged into the skill list API response for the UI picker
- Users can invoke skills via `/skill-name <prompt>` prefix in the terminal input

### Plugin Agents
- Scanned from `agents/` or `.github/agents/` directories
- Each agent is a `.agent.md` file with frontmatter (`name`, `description`) + prompt body
- Registered as `customAgents` in `SessionConfig`
- Merged with SDK-discovered agents in the `list_agents` response
- If SDK agent selection fails, falls back to plugin agent matching

### Plugin Discovery
Both scanners walk up to 3 levels deep, check `plugin.json` for configuration, and cache results for the server lifetime. Results are only computed once (lazy singleton pattern).

## Security Model

| Surface | Protection |
|---------|-----------|
| File browsing (`/api/browse`, `/api/browse-files`) | Path must be under `homedir()` |
| File reading (`/api/file`) | Path under `homedir()` + allowlisted extensions only |
| Demo loading (`/api/demos/:name`) | Name sanitized to `[a-zA-Z0-9_-]`, resolved path must start with `DEMOS_DIR` |
| WebSocket | One bridge per connection, input validated per message type |
| Copilot permissions | `approveAll` — auto-approves for demo purposes |

> **Important**: DemoGod is designed for **local development use**. The `approveAll` permission policy and unrestricted tool access are intentional for demo purposes. Do not expose to untrusted networks without additional access controls.

## Extension Points

### Adding new SDK events
1. Handle the event in the `session.on()` listener in `copilot-bridge.ts`
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
3. Document in `README.md` under **API Endpoints**

### Adding new demo step types
1. Add the step handling logic in `runDemo()` in `server.ts`
2. Add corresponding `demo_step_*` message handling in `app.js`
3. Document the step schema in the demo script section of `README.md`

## Dependencies

| Package | Purpose | Why this one |
|---------|---------|-------------|
| `@github/copilot-sdk` | Core Copilot integration | Official SDK — the only way to programmatically talk to Copilot CLI |
| `express` | HTTP server | Lightweight, well-known, serves static files + JSON API |
| `ws` | WebSocket server | De facto Node.js WebSocket library, minimal overhead |
| `tsx` | TypeScript runner (dev) | Zero-config TS execution with watch mode for development |
| `typescript` | Type checking (dev) | Strict mode type checking, not used at runtime |

The frontend has **zero npm dependencies** — all rendering, markdown parsing, and UI logic is hand-rolled vanilla JS. This is a deliberate choice to keep the demo experience fast and dependency-free.
