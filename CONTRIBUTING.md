# Contributing to DemoGod

Thanks for your interest in contributing! This guide will help you get set up and shipping changes.

## Quick Start

```bash
git clone <repository-url>
cd demogod
npm install
npm run dev          # starts server with hot reload on :3456
```

Open `http://localhost:3456` in your browser.

## Project Layout

| Path | What lives here |
|------|----------------|
| `src/server.ts` | Express + WebSocket server, REST API routes, demo runner, plugin scanners |
| `src/copilot-bridge.ts` | Wrapper around `@github/copilot-sdk` — session lifecycle, event forwarding |
| `src/public/` | Static frontend — `index.html`, `app.js` (~2450 lines, class-based vanilla JS), `styles.css` |
| `src-tauri/` | Tauri desktop shell — Rust entry point, sidecar config, `tauri.conf.json` |
| `demos/` | JSON demo scripts loaded by the demo engine |
| `docs/` | Architecture and design docs |
| `.github/copilot-instructions.md` | Context file for GitHub Copilot |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a deep dive into how the pieces fit together.

## Development Workflow

### Running locally (browser)

```bash
npm run dev   # tsx watch — auto-restarts on .ts changes
npm start     # one-shot production run
```

The frontend files (`src/public/`) are served as static assets. Edit them and refresh the browser — no build step needed.

### Running the desktop app

DemoGod also ships as a native desktop app via [Tauri v2](https://v2.tauri.app/).

**Prerequisites:**
- **Rust** toolchain (install via [rustup](https://rustup.rs/))
- Platform-specific Tauri v2 dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

```bash
# Development (Tauri window + Node hot reload)
npm run desktop

# Production build (platform-specific installer)
npm run build:desktop
```

> **Note:** `npm run desktop` uses Tauri's `beforeDevCommand` to start the Node server automatically — you don't need to run `npm run dev` separately.

The desktop app includes a **shell picker** (v0.0.4+) for selecting which shell to spawn the server with (WSL, PowerShell, CMD, or native). See **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** for details on the implementation.

### TypeScript

- Source lives in `src/`, compiled output goes to `dist/` (not checked in).
- We use `tsx` for execution so there's no separate compile step during development.
- Run `npx tsc --noEmit` to type-check without emitting files.

### Code Style

- **TypeScript**: strict mode, ES2022 target, ESM imports.
- **Frontend JS**: vanilla ES2020+ inside an IIFE. No framework, no bundler.
- **CSS**: plain CSS with CSS custom properties for theming.
- Keep functions small and single-purpose. The server file is large — add new route groups as clearly commented sections.

## Making Changes

### Adding a new REST API endpoint

1. Add the route in `src/server.ts` inside the Express setup section (between the existing routes and the WebSocket handler).
2. Follow the security pattern: validate paths against `homedir()`, sanitize user input.
3. Document the endpoint in `README.md` under **API Endpoints**.

### Adding a new WebSocket message type

1. **Server → Client**: emit from `CopilotBridge` or directly via `safeSend(ws, {...})` in the connection handler. Add the type to the `ws.on("message")` switch in `server.ts`.
2. **Client → Server**: handle in the `handleMessage()` switch in `app.js`.
3. Document both directions in `README.md` under **WebSocket Protocol**.

### Adding a new demo script

1. Create a `.json` file in `demos/`.
2. Follow the schema in `demos/intro.json` — steps are `command` or `question` objects.
3. The demo is accessible via `GET /api/demos/<name>` (without `.json`).

### Modifying the Copilot Bridge

`src/copilot-bridge.ts` is the integration layer with the Copilot SDK. Key rules:

- **Don't filter tools or skills** — the bridge intentionally exposes everything the CLI offers.
- **Event names map 1:1 to WebSocket message types** — if you add a new SDK event, add a corresponding WS message.
- Use `session.send()` (non-blocking) rather than `session.sendAndWait()` for prompts — sub-agents can run for a long time.

### Frontend changes

The frontend is intentionally zero-dependency vanilla JS. Please keep it that way — it makes the demo experience fast and predictable.

- `index.html` — structure and overlays
- `styles.css` — all styling, uses CSS custom properties
- `app.js` — all logic inside a single IIFE

### Modifying the Tauri desktop app

The Tauri shell lives in `src-tauri/`. It uses a **sidecar pattern** — the Rust process spawns the Node.js server as a child process and loads the UI in a webview.

- **Rust source**: `src-tauri/src/` — entry point and sidecar management
- **Config**: `src-tauri/tauri.conf.json` — window settings, sidecar definition, build options
- **CI**: `.github/workflows/desktop-build.yml` — cross-platform build workflow

Tauri v2 is required. If you change `tauri.conf.json`, test with `npm run desktop` before submitting.

## Security Checklist

Before submitting a PR, verify:

- [ ] File access is restricted to `homedir()` — no path traversal
- [ ] Demo names are sanitized (`[a-zA-Z0-9_-]` only)
- [ ] No secrets or credentials in code or config
- [ ] WebSocket messages validate input before acting
- [ ] Session token auth is intact — do not disable or bypass `verifyClient` token verification in `server.ts`. The session token is generated at startup and injected into `index.html`; the frontend passes it on every WS connection.
- [ ] Localhost-only binding (`127.0.0.1`) is preserved — do not change to `0.0.0.0`

## Submitting a Pull Request

1. Fork the repo and create a feature branch.
2. Make your changes with clear, descriptive commits.
3. Run `npx tsc --noEmit` to ensure type-checking passes.
4. Test both **live mode** (real Copilot session) and **scripted mode** (demo playback).
5. Update docs if you changed APIs, WebSocket messages, or the project structure.
6. Open a PR with a clear description of what and why.

## Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Browser and Node.js version
- Console output / error messages

## Questions?

Open a [discussion](../../discussions) — we're happy to help!
