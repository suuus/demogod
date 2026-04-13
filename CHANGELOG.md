# Changelog

All notable changes to DemoGod are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.2] — 2026-04-13

### Fixed
- **Windows: all file operations broken** — `isUnderHome()` used hardcoded `/` separator, failing on Windows `\` paths. All browse/read/save operations were rejected as "outside homedir" (#22)
- **Focus outline on dropdowns/inputs** — scoped `:focus-visible` to buttons and controls only; suppressed on form inputs for WebKit/Tauri (#21)

## [0.2.1] — 2026-04-13

### Added
- **Tool exclusion** — click tool chips in Capabilities panel to exclude/re-enable tools instantly via `onPreToolUse` deny (no session restart)
- **Auto-open File Tabs** setting — Settings → Features toggle (on by default); auto-opened tabs no longer steal focus
- **REST CSRF protection** — POST endpoints require `Authorization: Bearer <token>` header
- **Auto-approve in Autopilot** — entering Autopilot mode auto-enables permission approval, reverts on mode change

### Fixed
- A11y: 52 ARIA attributes — `aria-label` on all buttons, `role="tab/tablist/tabpanel/option/listbox/textbox/status"`, focus-visible styles, keyboard tab navigation with arrow keys, focus restoration on dialog close
- `set_auto_approve` queued if sent before session creation (no longer silently lost)
- `capContent.onclick` handler moved to persistent `addEventListener` (no more overwrite on re-render)
- Silent `catch {}` blocks now log via `console.debug` (7 locations)
- `_oneShotHandler` auto-clears after 30s timeout (prevents leak)
- Deprecated `document.execCommand` replaced with Range API
- Deprecated `navigator.platform` replaced with `navigator.userAgentData` fallback
- SQL todo parser: quote-aware tuple extraction handles `)` in values and multi-line SQL
- `task_complete` summary tab now respects Sub-agent Tabs feature flag (#20)
- `_pendingSqlQuery` cleared on project switch (prevents stale SQL parsing)
- MCP tool names use full server prefix (`github-mcp-server-list_issues`) for consistent exclusion matching
- MCP tool map built from live `listTools()` response instead of runtime discovery
- `mcp_tools_discovered` merges into existing list instead of replacing

### Tests
- 19 SQL parser unit tests (splitSqlValues, unquoteSql, extractTuples, parseTodoInsert edge cases)
- 13 tool exclusion + edge case tests (deny/allow/toggle, null data handling, double-resolve)
- 5 CSRF E2E tests (401 without token, 200 with token, wrong token rejected)
- Total: 145 tests (126 unit + 19 E2E)

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
