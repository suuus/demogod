 # 👋 Välkommen to DemoGod
 
<p align="center">
  <img src="docs/logo.svg" alt="DemoGod logo" width="700" />
</p>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Handcrafted in Uppsala](https://img.shields.io/badge/Handcrafted_in-Uppsala_%F0%9F%87%B8%F0%9F%87%AA-FFD700.svg)](https://en.wikipedia.org/wiki/Uppsala)
[![Code Review Panel](https://github.com/suuus/demogod/actions/workflows/code-review-panel.lock.yml/badge.svg)](https://github.com/suuus/demogod/actions/workflows/code-review-panel.lock.yml)
[![Daily Doc Updater](https://github.com/suuus/demogod/actions/workflows/daily-doc-updater.lock.yml/badge.svg)](https://github.com/suuus/demogod/actions/workflows/daily-doc-updater.lock.yml)

## The Legend of Demo God

In Swedish, “god” means good — as in well‑made, thoughtful, and reliable.
DemoGod embraces that tradition: no fluff, no noise, just demos that do exactly what they promise.

Like Nordic design, but for developer workflows.

The name traces back to a story often repeated in engineering teams across Sweden. In the late 1990s, a developer named Kerstin worked on internal tools for a logistics company outside Uppsala. Her tools never came with impressive slide decks or carefully staged demos. When someone asked how a feature worked, Kerstin would simply run it. If it failed during a demo, that wasn’t embarrassing — it was useful. The demo was just the system, doing what it did.

Kerstin had a simple rule: if a demo needed explanation, the software wasn’t done. Her colleagues started calling her builds goda — good in the Swedish sense of the word. Not clever. Not flashy. Just solid enough that you could trust them in front of anyone.
That mindset became part of the culture: simplicity over show, correctness over cleverness, and tools that earn trust by working exactly as advertised. No hidden toggles. No “imagine this part works.” What you saw was what you shipped.

DemoGod follows the same philosophy today. It captures real behavior, real output, and real workflows — without staging or polish for polish’s sake. If a demo runs, it’s because the software actually works.
Not divine. Just god.

[video.webm](https://github.com/user-attachments/assets/f8280628-19df-4cba-baf4-2e0f58a2933c)


## Overview

DemoGod is a web-based tool that creates interactive demo videos for GitHub Copilot CLI. It provides a terminal interface that can execute scripted demos or connect to a real Copilot session for live demonstrations.

**Use Cases:**
- Create polished demo videos for presentations
- Test Copilot interactions in a controlled environment
- Record reproducible demo sequences
- Showcase GitHub Copilot CLI capabilities

## Getting Started

### Prerequisites

- **Node.js** v20 or higher ([Download](https://nodejs.org/))
- **npm** package manager
- **GitHub Copilot CLI** access (for live sessions)

### Installation

```bash
git clone https://github.com/suuus/demogod.git
cd demogod
npm install
```

### Running

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

Open `http://localhost:3456` in your browser. Customize the port with `PORT=8080 npm start`.

### Desktop App (macOS)

Run DemoGod as a native macOS window using [Tauri v2](https://v2.tauri.app/). Requires the [Rust toolchain](https://rustup.rs/).

```bash
npm run desktop
```

> Production builds for all platforms are coming soon.

## Tip from the locals

In Uppsala, students have a tradition called *the Flogsta scream*:
every evening at 22:00, windows open and everyone screams their stress into the night.

We recommend the same before your demo.
Clear the noise. Exhale. Then just run it.


## Features

- **Scripted & Live Demos** — Execute pre-recorded demo scripts or send real prompts to Copilot
- **Demo Picker** — Choose demos via the mode button, with UI automation (layout switches, model changes, file opens)
- **Real-time Streaming** — See Copilot responses as they are generated
- **Tool Execution Visualization** — Watch tool calls and their results in real-time
- **Multi-Session** — Run multiple Copilot sessions in tabs or floating windows with grid snapping
- **Sub-Agent Activity Tabs** *(experimental)* — Track sub-agent tasks in dedicated tabs
- **Project Browser** — Browse and select working directories for Copilot sessions
- **File Change Tracking** — Monitor file modifications during demo execution
- **Screen Recording** — Built-in recording button — records the browser tab and downloads as `.mp4` (Chrome/Edge/Safari) or `.webm` (Firefox)
- **Capabilities Panel** — View and toggle MCP servers, tools, and skills from the 🔌 button
- **Per-project Discovery** — Automatically discovers agents, skills, and MCP servers from project-local configs
- **Copy & Paste** — Select and copy response text, paste into prompts
- **Permission Approval Toggle** — Settings → Features → *Auto-approve Permissions*. When enabled (default), all tool permission requests are auto-approved; when disabled, an inline **Allow / Deny** prompt appears in the terminal for file writes, shell commands, and MCP calls. A yellow **auto-approve** status indicator in the status bar shows the current state.
- **Ambient Music** — Settings → Experimental → *Ambient Music*. Plays a seamless looping background track at low volume during demos (starts on first user interaction to satisfy browser autoplay policy). Persisted to `localStorage`.
- **Accessibility** — Comprehensive ARIA role attributes (toolbar, tablist, tab, tabpanel, listbox, option, textbox, status) and `:focus-visible` styles throughout the UI for screen reader support and Playwright `getByRole` compatibility.
- **Clickable Version Badge** — Click the version number in the bottom-right corner to open `CHANGELOG.md` in a tab.
- **Settings Panel** — Configure appearance (including Aurora Borealis background theme), permission behavior, feature flags, and experimental options from ⚙️ Settings

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| <kbd>Ctrl</kbd>+<kbd>T</kbd> (Mac) / <kbd>Alt</kbd>+<kbd>T</kbd> | New session |
| <kbd>Ctrl</kbd>+<kbd>W</kbd> (Mac) / <kbd>Alt</kbd>+<kbd>W</kbd> | Close current session |
| <kbd>Ctrl</kbd>+<kbd>N</kbd> (Mac) / <kbd>Alt</kbd>+<kbd>N</kbd> | Next session |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> (Mac) / <kbd>Alt</kbd>+<kbd>P</kbd> | Previous session |

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

A tiny demo project is included at `demo/sample-app/` — point DemoGod's project picker at it for a great demo experience.

## Project Structure

```
demogod/
├── src/
│   ├── server.ts           # Express + WS server, REST API, plugin scanners, demo engine
│   ├── copilot-bridge.ts   # Copilot SDK wrapper, event forwarding, sub-agent detection
│   └── public/             # Static frontend (HTML/CSS/vanilla JS — no build step)
├── src-tauri/              # Tauri desktop app (Rust + config)
├── demo/sample-app/        # Tiny Node.js project for demo showcase
├── demos/                  # Demo script JSON files
├── docs/ARCHITECTURE.md    # Detailed architecture reference
└── package.json
```

For API endpoints, WebSocket protocol, security model, and component deep-dives, see **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## Development

The project uses `tsx` for TypeScript execution with hot reload. The frontend is intentionally vanilla JS with no build step.

### Adding New Demos
1. Create a JSON file in the `demos/` directory
2. Define the step sequence (commands and responses)
3. Load it via the demo picker or `/api/demos/:name`

## Troubleshooting

**Integrated terminal not working (macOS):**
- The `node-pty` native addon requires an executable `spawn-helper` binary
- Run `npm run postinstall` to fix permissions (this runs automatically on `npm install`)
- If you switched Node versions, run `npm rebuild node-pty`

**Port already in use:**
```bash
PORT=8080 npm start
```

**WebSocket connection fails:**
- Ensure the server is running on `localhost:3456`
- Check browser console for detailed error messages

**Copilot SDK errors:**
- Check your GitHub authentication: `gh auth status`
- Verify the `@github/copilot-sdk` package is installed

**Debug mode:**
```bash
DEBUG=* npm start
```

## Testing

DemoGod has 47 tests (34 unit via Vitest, 13 E2E via Playwright). See **[`docs/TESTING.md`](docs/TESTING.md)** for the full guide.

```bash
npm test              # All tests (unit + E2E)
npm run test:unit     # Unit tests only
npm run test:e2e      # E2E tests only
```

## Recording

Record demos via the browser's ⏺ button or Playwright-based automation. See **[`docs/RECORDING.md`](docs/RECORDING.md)** for details.

```bash
npm run record            # Interactive browser recording
npm run record:demo intro # Automated headless recording
```

## Roadmap

- [x] Live demo mode (real Copilot prompts)
- [x] Multiple session management
- [x] Sub-agent activity tabs
- [x] Demo UI automation (layout, model, tile)
- [x] Screen recording (MP4 + WebM)
- [x] Copy & paste in session windows
- [x] Custom themes (Aurora Borealis)
- [x] Capabilities panel
- [x] Per-project discovery
- [x] Ambient music for demos
- [x] ARIA accessibility (screen reader + Playwright getByRole support)
- [ ] Export demos as standalone video files
- [ ] Saved layout presets
- [ ] Desktop app production builds (Windows, Linux)

## Automated Workflows

DemoGod uses several [GitHub Agentic Workflows](https://github.com/github/gh-aw) (`gh-aw`) to keep the project healthy:

| Workflow | Schedule | What it does |
|----------|----------|--------------|
| **issue-triage-agent** | Every hour | Automatically labels new unlabeled issues (`bug`, `feature`, `enhancement`, `documentation`, `question`, `help-wanted`, `good-first-issue`) and posts a triage comment |
| **code-simplifier** | Daily | Reviews recently modified code and opens PRs with clarity/maintainability improvements — preserving all functionality |
| **daily-doc-updater** | Daily (6 am UTC) | Scans merged PRs and commits from the last 24 hours and updates documentation files to reflect new features and changes |
| **code-review-panel** | Weekly | Runs 5 expert reviewer personas (Security, Code Quality, Performance, UX/A11y, Tech Debt) sequentially, then synthesizes a consolidated scorecard and opens a GitHub issue with cross-persona agreements, quick wins, and trend tracking |

Workflow source files live in `.github/workflows/` (`.md` for the agent prompt, `.lock.yml` for the compiled workflow).

## License

MIT

## Contributing

Contributions are welcome! See **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for setup instructions, code style, security checklist, and PR guidelines.
