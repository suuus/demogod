# Changelog

All notable changes to DemoGod are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] — 2026-04-12

### Added
- **Demo Plan Mode** — describe a demo in plain English, Copilot generates a runnable script
  - 🎬 Demo Studio panel with target picker (DemoGod/Project) and output format (DemoGod script/Playwright spec)
  - "Create New Demo" option in the demo picker for chat-based generation
  - Save button after generation with run commands (`npm run record` / `npm run test:generated`)
  - Prompt templates with DemoGod UI selectors and Playwright boilerplate
- **Ambient Music** — Settings → Experimental toggle, 90s seamless loop at 8% volume
- **Copilot Bridge unit tests** — 35 tests covering event translation, session ops, resolve lifecycle
- **Path utils module** (`src/path-utils.ts`) — shared `safeRealpath`/`isUnderHome` security functions
- **PTY terminal modules** — decoupled into `src/pty-server.ts` (backend) and `src/public/terminal.js` (frontend)
- **Demo Studio module** (`src/public/demo-studio.js`) — ES module for the generation panel
- **Issue templates** — bug report, feature request, question (YAML forms with area dropdowns)
- **CODEOWNERS** — `@suuus` as default code owner
- **Workflow status badges** in README
- **GitHub Discussions** welcome post

### Fixed
- Missing `await` on `handlePrompt()` — prevented unhandled promise rejections
- `addSession()` → `createSession()` — fixed nonexistent method in demo `new_session` action
- Resize listener leak in `terminal.js` — accumulated on every open/close cycle
- WCAG contrast ratio — `--body-dim`/`--overlay0` bumped from `#6c7086` (3.7:1) to `#918994` (~4.5:1)
- CodeQL false positive on `/api/file` path injection — annotated and dismissed
- `SUPPORTED_EXT` regex now actually filters files in `/api/browse-files`

### Improved
- **Dialog accessibility** — all 6 overlays now have `role="dialog"`, `aria-modal`, focus trapping, Escape-to-close
- **ARCHITECTURE.md** — updated file map, removed stale plugin scanner/shell picker sections, fixed test counts
- **copilot-instructions.md** — added TypeScript/ESM, error handling, security, frontend, CSS, and testing conventions
- **Removed dead code** — shell picker branch, `bgIndex`, stale comments, unused `wssPty` binding

## [0.1.0] — 2026-04-10

### Added
- Initial release: browser-based demo tool for GitHub Copilot CLI
- Live mode (real Copilot sessions) and scripted mode (JSON demo playback)
- Multi-session support with tab and floating window layouts
- macOS-style terminal UI with themes (Chroma Green, Aurora Borealis, etc.)
- Capabilities panel (MCP servers, tools, skills)
- Settings panel with appearance and experimental toggles
- Screen recording via browser MediaRecorder and Playwright
- Tauri desktop app scaffold (macOS dev)
- Sub-agent tab detection and background agent tracking
- WebSocket auth with session tokens and origin checking
- Path security (homedir restriction, extension allowlist)
