import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "http";
import { homedir, platform } from "os";
import { realpathSync } from "fs";
import { resolve } from "path";
import * as pty from "node-pty";

/** Resolve path and follow symlinks; returns null if path doesn't exist */
function safeRealpath(p: string): string | null {
  try { return realpathSync(resolve(p)); } catch { return null; }
}

/** Check if a resolved real path is under the user's home directory */
function isUnderHome(realPath: string): boolean {
  const home = homedir();
  return realPath === home || realPath.startsWith(home + "/");
}

export function getDefaultShell(): string {
  if (platform() === "win32") return "powershell.exe";
  return process.env.SHELL || "/bin/bash";
}

export const ALLOWED_SHELLS = new Set([
  getDefaultShell(),
  "/bin/bash", "/bin/zsh", "/bin/sh",
  "powershell.exe", "cmd.exe", "wsl.exe",
]);

/**
 * Create and wire a PTY WebSocket server onto an existing HTTP server.
 * Returns the WebSocketServer so the caller can reference it if needed.
 */
export function setupPtyServer(
  server: HttpServer,
  verifyWsClient: (
    info: { origin: string; secure: boolean; req: import("http").IncomingMessage },
    done: (result: boolean, code?: number, message?: string) => void,
  ) => void,
): WebSocketServer {
  const wssPty = new WebSocketServer({ noServer: true, verifyClient: verifyWsClient });

  // Register the /pty upgrade path
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url || "/", `http://${req.headers.host}`).pathname;
    if (pathname === "/pty") {
      wssPty.handleUpgrade(req, socket, head, (ws) => wssPty.emit("connection", ws, req));
    }
    // Non-/pty upgrades are handled by the caller's own upgrade listener
  });

  wssPty.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const requestedShell = url.searchParams.get("shell") || getDefaultShell();
    const shell = ALLOWED_SHELLS.has(requestedShell) ? requestedShell : getDefaultShell();
    const requestedCwd = url.searchParams.get("cwd") || homedir();
    const home = homedir();
    const realCwd = safeRealpath(requestedCwd);
    const cwd = (realCwd && isUnderHome(realCwd)) ? realCwd : home;
    const cols = parseInt(url.searchParams.get("cols") || "120", 10);
    const rows = parseInt(url.searchParams.get("rows") || "30", 10);

    console.log(`[PTY] Spawning: ${shell} (${cols}x${rows}) in ${cwd}`);

    let term: pty.IPty;
    try {
      term = pty.spawn(shell, [], { name: "xterm-256color", cols, rows, cwd, env: process.env as Record<string, string> });
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", message: `Failed to spawn shell: ${err.message}` }));
      ws.close();
      return;
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    term.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", exitCode }));
        ws.close();
      }
    });

    ws.on("message", (msg) => {
      const str = msg.toString();
      if (str.startsWith("{")) {
        try {
          const cmd = JSON.parse(str);
          if (cmd.type === "resize" && cmd.cols && cmd.rows) {
            term.resize(cmd.cols, cmd.rows);
          }
        } catch { /* not JSON, treat as input */ term.write(str); }
      } else {
        term.write(str);
      }
    });

    ws.on("close", () => {
      console.log("[PTY] Client disconnected");
      term.kill();
    });
  });

  return wssPty;
}
