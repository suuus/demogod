/**
 * Integrated terminal module (xterm.js + node-pty via WebSocket).
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
let resizeHandler = null;

// Show button in Tauri always, in web only if feature-flagged
if (window.__TAURI_INTERNALS__ || localStorage.getItem("dg-terminal") === "1") {
  btnTerminal.style.display = "";
}

export function openPty() {
  if (ptyOpen) return;
  ptyOpen = true;
  ptyPanel.style.display = "flex";

  if (!ptyTerm && typeof Terminal !== "undefined") {
    ptyTerm = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      fontSize: 13,
      theme: { background: "#0d1117", foreground: "#cdd6f4", cursor: "#89b4fa" },
      cursorBlink: true,
    });
    ptyFit = new FitAddon.FitAddon();
    ptyTerm.loadAddon(ptyFit);
    ptyTerm.open(ptyContainer);
    ptyFit.fit();
  }

  // Connect WS to /pty
  const wsHost = window.__TAURI_INTERNALS__ ? "localhost:3456" : location.host;
  const token = document.querySelector('meta[name="dg-token"]')?.getAttribute("content") || "";
  const cols = ptyTerm ? ptyTerm.cols : 120;
  const rows = ptyTerm ? ptyTerm.rows : 24;
  const wsUrl = `ws://${wsHost}/pty?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;

  ptyWs = new WebSocket(wsUrl);
  ptyWs.onopen = () => {
    ptyTerm.focus();
  };
  ptyWs.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      // Check for JSON control messages
      if (ev.data.startsWith("{")) {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "exit") {
            ptyTerm.writeln(`\r\n[Process exited with code ${msg.exitCode}]`);
            return;
          }
          if (msg.type === "error") {
            ptyTerm.writeln(`\r\n[Error: ${msg.message}]`);
            return;
          }
        } catch { /* not JSON, write as terminal data */ }
      }
      ptyTerm.write(ev.data);
    }
  };
  ptyWs.onclose = () => {
    ptyTerm?.writeln("\r\n[Disconnected]");
  };

  ptyTerm.onData((data) => {
    if (ptyWs?.readyState === WebSocket.OPEN) ptyWs.send(data);
  });

  // Resize handling
  ptyTerm.onResize(({ cols, rows }) => {
    if (ptyWs?.readyState === WebSocket.OPEN) {
      ptyWs.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  // Fit on window resize
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
  resizeHandler = () => { if (ptyOpen && ptyFit) ptyFit.fit(); };
  window.addEventListener("resize", resizeHandler);
  setTimeout(() => ptyFit?.fit(), 50);
}

export function closePty() {
  ptyOpen = false;
  ptyPanel.style.display = "none";
  if (resizeHandler) { window.removeEventListener("resize", resizeHandler); resizeHandler = null; }
  if (ptyWs) { ptyWs.close(); ptyWs = null; }
  if (ptyTerm) { ptyTerm.dispose(); ptyTerm = null; ptyFit = null; }
}

export function isPtyOpen() {
  return ptyOpen;
}

// Wire toggle button + close button
btnTerminal.addEventListener("click", () => { ptyOpen ? closePty() : openPty(); });
btnPtyClose.addEventListener("click", closePty);

// Ctrl+` to toggle terminal (like VS Code)
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "`") {
    e.preventDefault();
    ptyOpen ? closePty() : openPty();
  }
});
