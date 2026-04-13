/**
 * Integrated terminal module (xterm.js + node-pty via WebSocket).
 * Supports two modes:
 *   - "classic": bottom panel (original behavior)
 *   - "tab": opens as a session tab alongside file/report tabs
 * Exposes openPty / closePty and wires up the toggle button + keyboard shortcut.
 */

const $ = (sel) => document.querySelector(sel);

const ptyPanel = $("#pty-panel");
const ptyContainer = $("#pty-container");
const btnTerminal = $("#btn-terminal");
const btnPtyClose = $("#pty-close");

let ptyTerm = null;
let ptyWs = null;
let ptyFit = null;
let ptyOpen = false;
let ptyMode = null; // "classic" or "tab"
let resizeHandler = null;
let resizeObserver = null;

/** Backward-compat: "1" → "classic", "0" → "disabled" */
export function getTerminalMode() {
  const raw = localStorage.getItem("dg-terminal") || "disabled";
  if (raw === "1") return "classic";
  if (raw === "0") return "disabled";
  return raw;
}

// Show button in Tauri always, in web only if enabled
if (window.__TAURI_INTERNALS__ || getTerminalMode() !== "disabled") {
  btnTerminal.style.display = "";
}

const TERM_OPTIONS = {
  fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
  fontSize: 13,
  theme: { background: "#0d1117", foreground: "#cdd6f4", cursor: "#89b4fa" },
  cursorBlink: true,
};

function connectPtyWs(term) {
  const wsHost = window.__TAURI_INTERNALS__ ? "localhost:3456" : location.host;
  const token = document.querySelector('meta[name="dg-token"]')?.getAttribute("content") || "";
  const cols = term ? term.cols : 120;
  const rows = term ? term.rows : 24;
  const wsUrl = `ws://${wsHost}/pty?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;

  ptyWs = new WebSocket(wsUrl);
  ptyWs.onopen = () => { term.focus(); };
  ptyWs.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      if (ev.data.startsWith("{")) {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "exit") { term.writeln(`\r\n[Process exited with code ${msg.exitCode}]`); return; }
          if (msg.type === "error") { term.writeln(`\r\n[Error: ${msg.message}]`); return; }
        } catch { /* not JSON */ }
      }
      term.write(ev.data);
    }
  };
  ptyWs.onclose = () => { term?.writeln("\r\n[Disconnected]"); };

  term.onData((data) => {
    if (ptyWs?.readyState === WebSocket.OPEN) ptyWs.send(data);
  });
  term.onResize(({ cols, rows }) => {
    if (ptyWs?.readyState === WebSocket.OPEN) {
      ptyWs.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });
}

function teardown() {
  ptyOpen = false;
  ptyMode = null;
  if (resizeHandler) { window.removeEventListener("resize", resizeHandler); resizeHandler = null; }
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  if (ptyWs) { ptyWs.close(); ptyWs = null; }
  if (ptyTerm) { ptyTerm.dispose(); ptyTerm = null; ptyFit = null; }
}

// ─── Classic mode (bottom panel) ─────────────────────────────

export function openPty() {
  if (ptyOpen) return;
  teardown();
  ptyOpen = true;
  ptyMode = "classic";
  ptyPanel.style.display = "flex";

  if (typeof Terminal !== "undefined") {
    ptyTerm = new Terminal(TERM_OPTIONS);
    ptyFit = new FitAddon.FitAddon();
    ptyTerm.loadAddon(ptyFit);
    ptyTerm.open(ptyContainer);
    ptyFit.fit();
  }

  connectPtyWs(ptyTerm);

  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
  resizeHandler = () => { if (ptyOpen && ptyFit) ptyFit.fit(); };
  window.addEventListener("resize", resizeHandler);
  setTimeout(() => ptyFit?.fit(), 50);
}

export function closePty() {
  const wasTab = ptyMode === "tab";
  teardown();
  ptyPanel.style.display = "none";

  if (wasTab) {
    // Remove session tab and container
    const tab = document.querySelector('[data-session-tab="pty-terminal"]');
    if (tab) tab.remove();
    if (terminalSessionContainer) {
      terminalSessionContainer.remove();
      terminalSessionContainer = null;
    }
    // Unregister and switch to another session
    const mgr = window.__demogodSessionManager;
    if (mgr) {
      mgr._unregisterExternalSession("pty-terminal");
    }
  }
}

export function isPtyOpen() {
  return ptyOpen;
}

export function getPtyMode() {
  return ptyMode;
}

// ─── Tab mode (session-level) ─────────────────────────────────

let terminalSessionContainer = null;

export function openPtyTab() {
  if (ptyOpen && ptyMode === "tab") {
    // Already open — just switch to it
    window.__demogodSessionManager?.switchTo?.("pty-terminal");
    return;
  }
  // Tear down any existing terminal (classic or tab)
  teardown();
  ptyPanel.style.display = "none";

  const mgr = window.__demogodSessionManager;
  if (!mgr) return;

  // Don't create duplicate
  if (document.querySelector('[data-session-tab="pty-terminal"]')) {
    mgr.switchTo("pty-terminal");
    return;
  }

  // Create session tab in the session tab bar
  const tabBar = document.getElementById("session-tab-bar");
  const addBtn = document.getElementById("btn-add-session");

  const tab = document.createElement("div");
  tab.className = "session-tab";
  tab.dataset.sessionTab = "pty-terminal";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.setAttribute("tabindex", "-1");
  tab.innerHTML =
    '<span class="session-tab-dot" style="background: #89b4fa" aria-label="Terminal"></span>' +
    '<span class="session-tab-name">Terminal</span>' +
    '<button class="session-tab-close" aria-label="Close terminal" title="Close">×</button>';

  tab.addEventListener("click", (e) => {
    if (e.target.classList.contains("session-tab-close")) {
      e.stopPropagation();
      closePty();
      return;
    }
    mgr.switchTo("pty-terminal");
  });
  tabBar.insertBefore(tab, addBtn);

  // Create session container (matches structure of Copilot sessions)
  const container = document.createElement("div");
  container.className = "session-container session-active";
  container.id = "pty-terminal-container";
  container.style.cssText = "height: 100%; display: flex; flex-direction: column;";

  // Terminal titlebar
  const titlebar = document.createElement("div");
  titlebar.className = "pty-titlebar";
  titlebar.style.cssText = "padding: 4px 12px; font-size: 12px; color: var(--body-dim); display: flex; align-items: center; gap: 8px;";
  titlebar.innerHTML = '<span>⬛ Integrated Terminal</span>';
  container.appendChild(titlebar);

  // xterm container
  const xtermEl = document.createElement("div");
  xtermEl.style.cssText = "flex: 1; overflow: hidden;";
  container.appendChild(xtermEl);

  // Add to the chat panel (same parent as session containers)
  const chatPanel = document.getElementById("panel-chat");
  chatPanel.appendChild(container);
  terminalSessionContainer = container;

  ptyOpen = true;
  ptyMode = "tab";

  if (typeof Terminal !== "undefined") {
    ptyTerm = new Terminal(TERM_OPTIONS);
    ptyFit = new FitAddon.FitAddon();
    ptyTerm.loadAddon(ptyFit);
    ptyTerm.open(xtermEl);
  }

  connectPtyWs(ptyTerm);

  // ResizeObserver to fit when visible
  resizeObserver = new ResizeObserver(() => {
    if (ptyFit && container.style.display !== "none") {
      ptyFit.fit();
    }
  });
  resizeObserver.observe(xtermEl);

  // Register with session manager for switching
  mgr._registerExternalSession("pty-terminal", {
    dom: { container, inputEl: xtermEl },
    isTerminal: true,
  });

  mgr.switchTo("pty-terminal");
  setTimeout(() => { ptyFit?.fit(); ptyTerm?.focus(); }, 50);
}

/** Called by app.js when a session is activated — refit terminal if it's ours */
export function onSessionActivated(sessionId) {
  if (sessionId === "pty-terminal" && ptyFit && ptyOpen && ptyMode === "tab") {
    setTimeout(() => { ptyFit.fit(); ptyTerm?.focus(); }, 20);
  }
}

// ─── Toggle logic (mode-aware) ───────────────────────────────

function toggle() {
  const mode = getTerminalMode();
  if (mode === "disabled") return;

  if (mode === "tab") {
    if (ptyOpen && ptyMode === "tab") {
      // If terminal session is active, switch away; otherwise switch to it
      const mgr = window.__demogodSessionManager;
      if (mgr?.activeSessionId === "pty-terminal") {
        // Switch to the most recent non-terminal session
        const sessions = [...(mgr.sessions?.keys() || [])];
        const other = sessions.filter(s => s !== "pty-terminal").pop();
        if (other) mgr.switchTo(other);
      } else {
        mgr?.switchTo("pty-terminal");
      }
    } else {
      openPtyTab();
    }
  } else {
    // classic mode
    ptyOpen ? closePty() : openPty();
  }
}

// Wire toggle button + close button
btnTerminal.addEventListener("click", toggle);
btnPtyClose.addEventListener("click", closePty);

// Ctrl+` to toggle terminal (like VS Code)
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "`") {
    e.preventDefault();
    toggle();
  }
});

// Expose module to app.js for cross-module communication
window.__terminalModule = { closePty, onSessionActivated, getTerminalMode };

