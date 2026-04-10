# Layout Modes — Design Document

> Multi-session terminal management with two switchable layout modes.

## Vision

Transform DemoGod from a single-session terminal into a multi-session terminal manager with two layout modes: **Tabs** (focused, one-at-a-time) and **Floating Windows** with grid snapping (tmux-meets-modern-tiling). Users toggle between modes without losing sessions.

## Layout Mode A — Tabs

The simpler mode. Extends the existing tab bar.

```
┌──────────────────────────────────────────────────────┐
│ [Session 1] [Session 2] [Session 3]  [+]             │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Active session terminal fills the full area          │
│                                                      │
│                                                      │
│  ❯ _                                                 │
├──────────────────────────────────────────────────────┤
│ Ready  📂 ~/project  🤖 Agent  Interactive  Model    │
└──────────────────────────────────────────────────────┘
```

- Each tab = one `TerminalSession` with its own WS connection
- "+" button creates a new session
- Close button (×) on each tab tears down the session
- Right-click tab → rename, duplicate, move to floating
- One session visible at a time — inactive sessions stay connected in background

## Layout Mode B — Floating Windows + Grid Snap

Each session is a draggable, resizable window inside the viewport.

```
┌──────────────────────────────────────────────────────┐
│ [Tab mode] [Float mode ●]  [+ New]  [Tile All]       │
├──────────────────────────────────────────────────────┤
│ ┌─────────────────────┐ ┌──────────────────────────┐ │
│ │ Session 1       — □ ×│ │ Session 2           — □ ×│ │
│ │                     │ │                          │ │
│ │ ❯ build the api    │ │ ❯ write tests            │ │
│ │                     │ │                          │ │
│ │ Ready  📂 ~/api     │ │ Ready  📂 ~/api          │ │
│ └─────────────────────┘ └──────────────────────────┘ │
│                                                      │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Session 3                                   — □ ×│ │
│ │                                                  │ │
│ │ ❯ _                                             │ │
│ │ Ready  📂 ~/docs                                 │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Window Behavior
- **Drag**: grab title bar to move freely within the viewport
- **Resize**: handles on edges and corners
- **Minimize**: collapses to a small pill in a dock area at the bottom
- **Maximize**: fills the viewport (double-click title bar to toggle)
- **Z-order**: clicking a window brings it to front
- **Close**: tears down the session

### Grid Snap Zones

When dragging a window, it snaps to predefined zones when the cursor enters a snap region (within ~30px of viewport edges/corners):

```
┌──────────┬──────────┐
│          │          │
│  Left    │  Right   │   ← drag to left/right edge = 50% width
│  Half    │  Half    │
│          │          │
└──────────┴──────────┘

┌──────────┬──────────┐
│ Top-Left │Top-Right │
├──────────┼──────────┤   ← drag to corners = 25% (quarter)
│ Bot-Left │Bot-Right │
└──────────┴──────────┘

┌──────────────────────┐
│                      │
│     Full Screen      │   ← drag to top edge = maximize
│                      │
└──────────────────────┘
```

- Visual preview overlay appears while dragging to show where the window will snap
- CSS transitions for smooth snap animation
- Windows can still be freely positioned (snap only triggers near edges)

### Tile All

One-click button that auto-arranges all open sessions into an even grid:
- 1 session → full
- 2 sessions → side by side (50/50)
- 3 sessions → one left half + two stacked right quarters
- 4 sessions → 2×2 grid
- 5+ → best-fit grid

## Mode Toggle

A control bar button switches between Tab and Float modes:
- Sessions are preserved — only the layout container changes
- In Tab mode, all sessions exist but only one is visible
- In Float mode, all sessions become visible floating windows
- User preference is stored in `localStorage`

## Session Lifecycle

### Creation
1. User clicks "+" → new `TerminalSession` instance created
2. Session opens its own WebSocket connection to the server
3. Server creates a new `CopilotBridge` (already supports this)
4. Session gets its own terminal output, input line, status bar, state

### Configuration
Each session independently manages:
- Working directory (project picker per session)
- Model selection
- Agent selection
- Copilot mode (interactive/plan/autopilot)

### Destruction
1. User clicks "×" on tab or window
2. WebSocket connection closed → server tears down bridge
3. DOM elements removed, state cleaned up

### Session List / Switcher
- Keyboard shortcut (e.g., `Ctrl+Tab`) cycles through sessions
- Optional session list panel showing all active sessions with status

## Technical Approach

### TerminalSession Class

The core refactor — extract all per-session state from global scope into instances:

```
class TerminalSession {
  id: string
  ws: WebSocket
  state: { mode, isProcessing, selectedProject, selectedModel, ... }
  dom: { container, output, input, statusBar, ... }

  connect()
  disconnect()
  sendPrompt(text)
  handleMessage(msg)
  appendDelta(text)
  finishResponse()
  showDialog(msg)
  // ... all current per-session logic
}
```

### SessionManager

Orchestrates multiple sessions and layout:

```
class SessionManager {
  sessions: Map<string, TerminalSession>
  activeSessionId: string
  layoutMode: 'tabs' | 'floating'

  createSession(): TerminalSession
  destroySession(id)
  switchTo(id)
  setLayoutMode(mode)
  tileAll()
}
```

### Floating Window Manager

Handles drag, resize, snap, z-order for floating mode:

```
class FloatingWindowManager {
  windows: Map<string, WindowState>

  makeDraggable(el, sessionId)
  makeResizable(el, sessionId)
  bringToFront(sessionId)
  snapToZone(sessionId, zone)
  tileAll()
  minimize(sessionId)
  maximize(sessionId)
}
```

## Implementation Phases

1. **TerminalSession refactor** — extract class from global state (prerequisite for everything)
2. **SessionManager + Tab mode** — multi-tab with "+" and "×"
3. **Floating window mode** — drag, resize, z-order
4. **Grid snapping** — snap zones, preview overlay, animations
5. **Tile All + polish** — auto-arrange, keyboard shortcuts, localStorage persistence
6. **Mode toggle** — switch between tabs and floating, preserve sessions

## Open Questions

- Should sessions share the same control bar, or should each floating window have its own controls?
- Maximum number of concurrent sessions? (Practical limit: each session = 1 WS + 1 Copilot process)
- Should there be a "default" layout preset users can save?
