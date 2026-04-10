# DemoGod 🎬

<p align="center">
  <img src="docs/logo.svg" alt="DemoGod logo" width="700" />
</p>

> Demo video generator for GitHub Copilot CLI

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

DemoGod is a web-based tool that creates interactive demo videos for GitHub Copilot CLI. It provides a simulated terminal interface that can execute scripted demos or connect to a real Copilot session for live demonstrations.

**Use Cases:**
- Create polished demo videos for presentations
- Test Copilot interactions in a controlled environment
- Record reproducible demo sequences
- Showcase GitHub Copilot CLI capabilities

## Features

- **Interactive Terminal UI**: Web-based terminal interface for demonstrations
- **Scripted & Live Demos**: Execute pre-recorded demo scripts or run live demos that send real prompts to Copilot
- **Demo Picker**: Choose from available demo scripts via the mode button — includes UI automation (layout switches, model changes, file opens)
- **Live Copilot Integration**: Connect to real Copilot CLI sessions via WebSocket bridge
- **Project Browser**: Browse and select working directories for Copilot sessions
- **Real-time Streaming**: See Copilot responses as they are generated
- **Tool Execution Visualization**: Watch tool calls and their results in real-time
- **Sub-Agent Activity Tabs** *(experimental)*: Track sub-agent tasks in dedicated tabs — see agent type, name, and results
- **File Change Tracking**: Monitor file modifications during demo execution
- **Multi-Session Support**: Run multiple Copilot sessions in tabs or floating windows with grid snapping
- **Settings Panel**: Configure appearance, feature flags, and experimental options from ⚙️ Settings
- **Screen Recording**: Built-in recording button (bottom-right) — records the browser tab and downloads as `.webm`
- **Copy & Paste**: Select and copy response text (⌘C/Ctrl+C), paste into prompts (⌘V/Ctrl+V)

> **Note:** A native desktop app (Tauri) is available for macOS development. Production builds for all platforms are coming soon.

### Desktop App (macOS)

Run DemoGod as a native macOS window using [Tauri v2](https://v2.tauri.app/). Requires the [Rust toolchain](https://rustup.rs/) installed.

```bash
npm run desktop
```

This launches the Tauri dev window with hot reload. The same web UI, but in a native window instead of a browser tab.

## Multi-Session

DemoGod supports running multiple Copilot sessions simultaneously. Each session has its own WebSocket connection, Copilot bridge, and terminal UI.

- **Tab mode**: Sessions appear as tabs in the terminal tab bar. Switch between them or use keyboard shortcuts.
- **Floating window mode**: Detach sessions into draggable, resizable windows with grid snapping for side-by-side layouts.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| <kbd>Ctrl</kbd>+<kbd>T</kbd> (Mac) / <kbd>Alt</kbd>+<kbd>T</kbd> | New session |
| <kbd>Ctrl</kbd>+<kbd>W</kbd> (Mac) / <kbd>Alt</kbd>+<kbd>W</kbd> | Close current session |
| <kbd>Ctrl</kbd>+<kbd>N</kbd> (Mac) / <kbd>Alt</kbd>+<kbd>N</kbd> | Next session |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> (Mac) / <kbd>Alt</kbd>+<kbd>P</kbd> | Previous session |

## Architecture

The project is a TypeScript/Node.js application with a zero-dependency vanilla JS frontend.

- **Express Server**: Serves the web UI and handles API requests
- **WebSocket Server**: Real-time bidirectional communication between UI and Copilot
- **Copilot Bridge**: Integration layer wrapping the `@github/copilot-sdk`
- **Demo Engine**: Executes scripted demo sequences with realistic timing
- **Plugin System**: Discovers skills and agents from `~/.copilot/installed-plugins/`

For a deep dive into components, data flows, and extension points, see **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## Getting Started

### Prerequisites

- **Node.js** v20 or higher ([Download](https://nodejs.org/))
- **npm** or **yarn** package manager
- **GitHub Copilot CLI** access (for live sessions)

### Installation

```bash
# Clone the repository (if not already cloned)
# git clone https://github.com/suuus/demogod.git
# cd demogod

# Install Node.js dependencies
npm install
```

### Running the Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The server will start at `http://localhost:3456` by default. You can customize the port with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## Project Structure

```
demogod/
├── src/
│   ├── server.ts           # Express + WS server, REST API, plugin scanners, demo engine
│   ├── copilot-bridge.ts   # Copilot SDK wrapper, event forwarding, sub-agent detection
│   └── public/             # Static frontend (HTML/CSS/vanilla JS — no build step)
├── src-tauri/              # Tauri desktop app (Rust + config)
│   ├── src/                # Rust entry point and sidecar management
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri window, sidecar, and build config
├── demo/
│   └── sample-app/         # Tiny Node.js project for demo showcase
├── demos/                  # Demo script JSON files (intro.json, showcase.json)
├── docs/
│   └── ARCHITECTURE.md     # Detailed architecture reference
├── .github/
│   ├── copilot-instructions.md  # Context for GitHub Copilot
│   └── workflows/
│       └── desktop-build.yml    # CI workflow for Tauri desktop builds
├── package.json            # Node.js dependencies
```

## Demo Scripts

Demo scripts are JSON files in `demos/`. The mode button (⌨️) opens a picker to choose which demo to run.

### Step Types

| Type | Description |
|------|-------------|
| `command` | Typed prompt + canned response (scripted) |
| `question` | Typed prompt + dialog with auto-fill + canned response |
| `live` | Typed prompt sent as a **real** Copilot prompt — waits for idle before next step |
| `action` | UI automation — switch layout, change model, tile windows, open files |

### Example — Live Demo

```json
{
  "title": "Feature Showcase",
  "steps": [
    { "type": "live", "text": "What is this project?", "typingSpeed": 40, "pauseAfter": 3000 },
    { "type": "action", "action": "layout", "value": "floating", "pauseAfter": 2000 },
    { "type": "action", "action": "tile", "pauseAfter": 1500 },
    { "type": "action", "action": "model", "value": "claude-sonnet-4", "pauseAfter": 1000 },
    { "type": "live", "text": "Run the tests", "typingSpeed": 40, "pauseAfter": 3000 },
    { "type": "action", "action": "layout", "value": "tabs", "pauseAfter": 1500 }
  ]
}
```

### Available Actions

| Action | Value | Effect |
|--------|-------|--------|
| `layout` | `"tabs"` or `"floating"` | Switch layout mode |
| `tile` | — | Tile all floating windows |
| `model` | model ID string | Switch the active model |
| `open_file` | file path | Open a file in a tab |
| `new_session` | — | Create a new session |

### Example — Scripted Demo

```json
{
  "steps": [
    {
      "type": "command",
      "text": "what can you help me with?",
      "typingSpeed": 45,
      "response": "I can help you with software engineering tasks..."
    }
  ]
}
```

### Sample Project

A tiny demo project is included at `demo/sample-app/` — a Node.js task tracker with tests, TODOs, and FIXMEs. Point DemoGod's project picker at it for a great demo experience.

## API Endpoints

### `GET /api/browse`
Browse directories for project selection
- Query param: `path` (optional, defaults to home directory)
- Returns: Directory listing with Git repository detection

### `GET /api/file`
Read file contents
- Query param: `path` (required)
- Returns: File content and metadata

### `GET /api/demos`
List available demo scripts
- Returns: Array of `{name, title, description}`

### `GET /api/demos/:name`
Load a demo script
- Path param: `name` (demo script name without .json extension)
- Returns: Demo script JSON

### `GET /api/shell` (v0.0.4+)
Read current shell configuration (desktop app only)
- Returns: Current shell selection (`wsl`, `powershell`, `cmd`, `native`)
- Config stored in `~/.demogod/config.json`

### `PUT /api/shell` (v0.0.4+)
Update shell configuration (desktop app only)
- Request body: `{shell: "wsl" | "powershell" | "cmd" | "native"}`
- Saves to `~/.demogod/config.json`
- Returns: Updated configuration

## WebSocket Protocol

The WebSocket connection supports the following message types:

**Client → Server:**
- `create_session`: Initialize a new Copilot session
- `send_prompt`: Send a prompt to Copilot
- `user_input_response`: Respond to Copilot's questions
- `start_demo`: Start a scripted demo
- `cancel_demo`: Stop the current demo
- `abort`: Abort the current Copilot operation

**Server → Client:**
- `session_ready`: Session initialized successfully
- `delta`: Streaming text chunk from Copilot
- `message`: Complete message from Copilot
- `idle`: Copilot is ready for next input
- `tool_start`: Tool execution started
- `tool_complete`: Tool execution finished
- `tool_partial`: Partial tool output
- `tool_progress`: Tool progress update
- `intent`: Current task intent
- `file_changed`: File was modified
- `subagent_start`: Sub-agent task started (agent name, type, description)
- `subagent_complete`: Sub-agent task finished (with result)
- `subagent_output`: Background agent output streamed via `read_agent`
- `demo_step_command`: Demo command to display
- `demo_step_response`: Demo response to display
- `demo_step_question`: Show question dialog
- `demo_action`: UI automation action (layout, model, tile, open_file)
- `demo_complete`: Demo finished
- `error`: Error occurred

## Security

DemoGod runs three layers of WebSocket security (added in v0.0.3):

1. **Session token auth** — A random 256-bit token is generated at server startup and injected into `index.html` via a `<meta name="dg-token">` tag. The frontend passes `?token=TOKEN` on every WebSocket connection. The WS `verifyClient` callback rejects connections without a valid token.
2. **Origin checking** — `verifyClient` rejects WebSocket upgrade requests from non-localhost origins, preventing CSRF attacks from malicious websites.
3. **Localhost binding** — The server binds to `127.0.0.1` only (`server.listen(PORT, "127.0.0.1")`), ensuring it is never accessible from the network.

Additional protections:

- File browsing is restricted to the user's home directory
- Demo names are sanitized to prevent path traversal
- Only text-based files can be read via the file API
- WebSocket messages validate input before acting

## Development

### TypeScript Compilation
The project uses `tsx` for TypeScript execution with hot reload during development.

### Adding New Demos
1. Create a JSON file in the `demos/` directory
2. Define the step sequence (commands and responses)
3. Load it via `/api/demos/:name`

## Dependencies

### Production
- `@github/copilot-sdk`: GitHub Copilot integration
- `express`: Web server framework
- `ws`: WebSocket server

### Development
- `typescript`: TypeScript compiler
- `tsx`: TypeScript execution
- `@types/express`: Express type definitions
- `@types/ws`: WebSocket type definitions

## Troubleshooting

### Common Issues

**Integrated terminal not working (macOS):**
- The `node-pty` native addon requires an executable `spawn-helper` binary
- Run `npm run postinstall` to fix permissions (this runs automatically on `npm install`)
- If you switched Node versions, run `npm rebuild node-pty`

**Port already in use:**
```bash
# Change the port
PORT=8080 npm start
```

**WebSocket connection fails:**
- Ensure the server is running on `localhost:3456`
- Check browser console for detailed error messages
- Verify firewall settings allow WebSocket connections

**Copilot SDK errors:**
- Ensure you have GitHub Copilot CLI access
- Check your GitHub authentication: `gh auth status`
- Verify the `@github/copilot-sdk` package is installed

**Demo script not found:**
- Ensure the demo JSON file exists in the `demos/` directory
- Check the file name matches the API request (without .json extension)
- Verify the JSON syntax is valid

### Debug Mode

Enable verbose logging:
```bash
DEBUG=* npm start
```

## Roadmap

- [ ] Add more demo script templates
- [x] Support for recording terminal sessions
- [ ] Export demos as video files
- [ ] Enhanced UI with syntax highlighting
- [x] Multiple session management
- [x] Settings panel with feature flags
- [x] Sub-agent activity tabs
- [x] Live demo mode (real Copilot prompts)
- [x] Demo UI automation (layout, model, tile)
- [x] Copy & paste in session windows
- [ ] Custom themes and styling options
- [ ] Saved layout presets

## License

MIT

## Contributing

Contributions are welcome! See **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for setup instructions, code style, security checklist, and PR guidelines.

## Support

For questions or issues:
- Open an [issue](../../issues)
- Check existing [discussions](../../discussions)
- Review the [GitHub Copilot documentation](https://docs.github.com/en/copilot)
