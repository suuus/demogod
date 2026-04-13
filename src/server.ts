import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readFile, readdir, stat, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { spawn } from "child_process";
import { CopilotBridge } from "./copilot-bridge.js";
import { setupPtyServer } from "./pty-server.js";
import { safeRealpath, isUnderHome } from "./path-utils.js";
import { SELF_DEMO_PROMPT, SELF_PLAYWRIGHT_PROMPT, PROJECT_DEMO_PROMPT } from "./demo-plan-prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEMOS_DIR = resolve(__dirname, "..", "demos");


// ---------- MCP tool discovery via protocol ----------
// Spawns an MCP server process, sends initialize + tools/list, collects tools.
interface McpToolInfo { name: string; description: string; }

async function queryMcpServerTools(command: string, args: string[], env?: Record<string, string>): Promise<McpToolInfo[]> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let buffer = "";
    let phase: "init" | "tools" | "done" = "init";
    const tools: McpToolInfo[] = [];
    const timeout = setTimeout(() => { proc.kill(); resolve(tools); }, 8000);

    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      // Parse JSON-RPC messages (newline-delimited)
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (phase === "init" && msg.result) {
            // Initialize response received — send tools/list
            phase = "tools";
            proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
          } else if (phase === "tools" && msg.result?.tools) {
            for (const t of msg.result.tools) {
              tools.push({ name: t.name, description: t.description || "" });
            }
            phase = "done";
            clearTimeout(timeout);
            proc.kill();
            resolve(tools);
          }
        } catch (e: any) { console.debug("[MCP] JSON parse error in stdout:", e.message); }
      }
    });
    proc.on("error", () => { clearTimeout(timeout); resolve(tools); });
    proc.on("exit", () => { clearTimeout(timeout); resolve(tools); });

    // Send initialize
    proc.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "demogod", version: "0.0.8" } },
    }) + "\n");
  });
}

// Query tools from project-level MCP server configs (e.g. from .mcp.json)
async function queryProjectMcpServerTools(
  configs: Record<string, any> | undefined,
  connectedServers?: string[],
): Promise<Record<string, McpToolInfo[]>> {
  const result: Record<string, McpToolInfo[]> = {};
  if (!configs) return result;
  const queries = Object.entries(configs).map(async ([name, cfg]) => {
    const s = cfg as any;
    if (!s.command) return;
    // Only query servers that are connected (if we know)
    if (connectedServers && !connectedServers.includes(name)) return;
    try {
      const tools = await queryMcpServerTools(s.command, s.args || [], s.env);
      if (tools.length > 0) result[name] = tools;
      console.log(`[MCP] ${name}: ${tools.length} tools (${tools.map(t => t.name).join(", ")})`);
    } catch (err) {
      console.warn(`[MCP] Failed to query tools for ${name}:`, err);
    }
  });
  await Promise.all(queries);
  return result;
}

// Scan all plugin MCP configs and query their tools
async function discoverAllMcpTools(): Promise<Record<string, McpToolInfo[]>> {
  const result: Record<string, McpToolInfo[]> = {};
  const pluginsRoot = join(homedir(), ".copilot", "installed-plugins");
  try { await stat(pluginsRoot); } catch { return result; }

  // Find all .mcp.json files
  async function findMcpConfigs(dir: string, depth = 0): Promise<void> {
    if (depth > 3) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === ".mcp.json" || e.name === "mcp.json") {
        try {
          const raw = await readFile(join(dir, e.name), "utf-8");
          const cfg = JSON.parse(raw);
          for (const [name, srv] of Object.entries(cfg.mcpServers || {})) {
            const s = srv as any;
            if (s.command) {
              try {
                const tools = await queryMcpServerTools(s.command, s.args || [], s.env);
                if (tools.length > 0) result[name] = tools;
              } catch (err) {
                console.warn(`[MCP] Failed to query tools for ${name}:`, err);
              }
            }
          }
        } catch (e: any) { console.debug("[MCP] Skipping malformed config in", dir, e.message); }
      }
      if (e.isDirectory() && !e.name.startsWith(".")) {
        await findMcpConfigs(join(dir, e.name), depth + 1);
      }
    }
  }
  await findMcpConfigs(pluginsRoot);
  return result;
}

// Cache discovered MCP tools
let cachedMcpToolMap: Record<string, McpToolInfo[]> | null = null;
async function getMcpToolMap(): Promise<Record<string, McpToolInfo[]>> {
  if (!cachedMcpToolMap) {
    cachedMcpToolMap = await discoverAllMcpTools();
    // Built-in github-mcp-server is embedded in the CLI — can't query via protocol.
    // Add its well-known tools from the MCP server definition.
    if (!cachedMcpToolMap["github-mcp-server"]) {
      cachedMcpToolMap["github-mcp-server"] = [
        { name: "github-mcp-server-get_file_contents", description: "Get file/directory contents from a GitHub repo" },
        { name: "github-mcp-server-list_commits", description: "List commits in a repository" },
        { name: "github-mcp-server-get_commit", description: "Get details for a specific commit" },
        { name: "github-mcp-server-list_branches", description: "List branches in a repository" },
        { name: "github-mcp-server-search_code", description: "Search code across GitHub repositories" },
        { name: "github-mcp-server-search_repositories", description: "Search for GitHub repositories" },
        { name: "github-mcp-server-search_users", description: "Search for GitHub users" },
        { name: "github-mcp-server-list_issues", description: "List issues in a repository" },
        { name: "github-mcp-server-issue_read", description: "Get issue details, comments, sub-issues, or labels" },
        { name: "github-mcp-server-search_issues", description: "Search for issues across repositories" },
        { name: "github-mcp-server-list_pull_requests", description: "List pull requests in a repository" },
        { name: "github-mcp-server-pull_request_read", description: "Get PR details, diff, status, files, or reviews" },
        { name: "github-mcp-server-search_pull_requests", description: "Search for pull requests" },
        { name: "github-mcp-server-actions_list", description: "List workflows, runs, jobs, or artifacts" },
        { name: "github-mcp-server-actions_get", description: "Get workflow, run, job, or artifact details" },
        { name: "github-mcp-server-get_job_logs", description: "Get logs for workflow jobs" },
        { name: "github-mcp-server-list_copilot_spaces", description: "List accessible Copilot Spaces" },
        { name: "github-mcp-server-get_copilot_space", description: "Get content from a Copilot Space" },
      ];
    }
    for (const [name, tools] of Object.entries(cachedMcpToolMap)) {
      console.log(`[MCP] ${name}: ${tools.length} tools (${tools.map(t => t.name).join(", ")})`);
    }
  }
  return cachedMcpToolMap;
}

const PORT = parseInt(process.env.PORT || "3456", 10);

// ─── Security: session token for WebSocket auth ─────────────────────────────
// A random token generated at startup. Only clients that receive the token
// (via the injected <meta> tag in index.html) can open WebSocket connections.
// This prevents other local processes or malicious web pages from hijacking
// the Copilot bridge.
const SESSION_TOKEN = randomBytes(32).toString("hex");

// Read version from package.json
const PKG_PATH = join(__dirname, "..", "package.json");
let APP_VERSION = "0.0.0";
try {
  const pkg = JSON.parse(await readFile(PKG_PATH, "utf-8"));
  APP_VERSION = pkg.version || APP_VERSION;
} catch (e: any) { console.warn("[Init] Failed to read package.json:", e.message); }

// Check for updates once at startup (non-blocking, cached for session lifetime)
let latestVersion: string | null = null;
(async () => {
  try {
    const res = await fetch("https://api.github.com/repos/suuus/demogod/releases/latest", {
      headers: { "Accept": "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const remote = (data.tag_name || "").replace(/^v/, "");
      if (remote && remote !== APP_VERSION) {
        latestVersion = remote;
        console.log(`[Update] New version available: v${remote} (current: v${APP_VERSION})`);
      }
    }
  } catch { /* offline or rate-limited — silently skip */ }
})();

const app = express();

// CORS: allow Tauri desktop app (serves from tauri:// origin) to call our API
app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  if (origin && (origin.startsWith("tauri://") || origin.startsWith("https://tauri.") || /^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (_req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Serve index.html with session token and version injected as <meta> tags.
// All other static files are served normally.
const PUBLIC_DIR = join(__dirname, "..", "src", "public");

app.get("/", async (_req, res) => {
  try {
    let html = await readFile(join(PUBLIC_DIR, "index.html"), "utf-8");
    html = html.replace(
      "</head>",
      `  <meta name="dg-token" content="${SESSION_TOKEN}">\n  <meta name="dg-version" content="${APP_VERSION}">\n  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self';">\n</head>`
    );
    res.type("html").send(html);
  } catch {
    res.status(500).send("Failed to load index.html");
  }
});

app.use(express.static(PUBLIC_DIR));

// Serve xterm.js vendor files from node_modules
const NODE_MODULES = join(__dirname, "..", "node_modules");
app.get("/vendor/xterm.css", (_req, res) => res.sendFile(join(NODE_MODULES, "@xterm/xterm/css/xterm.css")));
app.get("/vendor/xterm.js", (_req, res) => res.sendFile(join(NODE_MODULES, "@xterm/xterm/lib/xterm.js")));
app.get("/vendor/xterm-addon-fit.js", (_req, res) => res.sendFile(join(NODE_MODULES, "@xterm/addon-fit/lib/addon-fit.js")));

const server = createServer(app);

// ─── WebSocket servers (manual upgrade for path routing) ─────────────────────
function verifyWsClient(info: { origin: string; secure: boolean; req: import("http").IncomingMessage }, done: (result: boolean, code?: number, message?: string) => void) {
  const origin = info.origin || info.req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      const allowed = ["localhost", "127.0.0.1", "[::1]", "tauri.localhost"].includes(url.hostname);
      if (!allowed) {
        console.warn(`[Security] Rejected WS from origin: ${origin}`);
        done(false, 403, "Forbidden origin");
        return;
      }
    } catch {
      done(false, 403, "Invalid origin");
      return;
    }
  }
  const url = new URL(info.req.url || "/", `http://${info.req.headers.host}`);
  const token = url.searchParams.get("token");
  if (token !== SESSION_TOKEN) {
    console.warn("[Security] Rejected WS connection: invalid token");
    done(false, 401, "Unauthorized");
    return;
  }
  done(true);
}

const wss = new WebSocketServer({ noServer: true, verifyClient: verifyWsClient });
setupPtyServer(server, verifyWsClient);

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url || "/", `http://${req.headers.host}`).pathname;
  if (pathname === "/pty") {
    // Handled by setupPtyServer's own upgrade listener
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

// Shared bridge instance for listing models before a session exists
let sharedBridgeForModels: CopilotBridge | null = null;
async function getModelsBridge(): Promise<CopilotBridge> {
  if (!sharedBridgeForModels) {
    sharedBridgeForModels = new CopilotBridge();
  }
  return sharedBridgeForModels;
}

function safeDemoPath(name: string): string | null {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeName || safeName !== name) return null;
  const resolved = resolve(DEMOS_DIR, `${safeName}.json`);
  if (!resolved.startsWith(DEMOS_DIR)) return null;
  return resolved;
}

app.use(express.json());

// List directories for project picker
app.get("/api/browse", async (req, res) => {
  const requestedPath = (req.query.path as string) || homedir();
  const resolvedPath = safeRealpath(requestedPath);
  if (!resolvedPath || !isUnderHome(resolvedPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  try {
    const entries = await readdir(resolvedPath, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && e.name !== "node_modules")
      .map((e) => ({
        name: e.name,
        path: join(resolvedPath, e.name),
        isGitRepo: existsSync(join(resolvedPath, e.name, ".git")),
      }))
      .sort((a, b) => {
        // Git repos first, then alphabetical
        if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({
      current: resolvedPath,
      parent: resolvedPath !== "/" ? dirname(resolvedPath) : null,
      dirs,
    });
  } catch {
    res.status(404).json({ error: "Directory not found" });
  }
});

// Browse directories AND files for the file browser
app.get("/api/browse-files", async (req, res) => {
  const requestedPath = (req.query.path as string) || homedir();
  const resolvedPath = safeRealpath(requestedPath);
  if (!resolvedPath || !isUnderHome(resolvedPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const SUPPORTED_EXT = /\.(md|txt|json|yaml|yml|toml|csv|log|xml|html|css|js|ts|py|sh|rs|go|rb|java)$/i;
  try {
    const entries = await readdir(resolvedPath, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && e.name !== "node_modules")
      .map((e) => ({ name: e.name, path: join(resolvedPath, e.name), isDir: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = entries
      .filter((e) => e.isFile() && SUPPORTED_EXT.test(e.name))
      .map((e) => ({ name: e.name, path: join(resolvedPath, e.name), isDir: false }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      current: resolvedPath,
      parent: resolvedPath !== "/" ? dirname(resolvedPath) : null,
      items: [...dirs, ...files],
    });
  } catch {
    res.status(404).json({ error: "Directory not found" });
  }
});

// Read a file (for opening created markdown files in tabs)
app.get("/api/file", async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: "Missing path parameter" });
    return;
  }
  const resolved = safeRealpath(filePath);
  if (!resolved || !isUnderHome(resolved)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  // Only allow text-like files
  if (!/\.(md|txt|json|yaml|yml|toml|csv|log|xml|html|css|js|ts|py|sh|rs|go|rb|java)$/i.test(resolved)) {
    res.status(400).json({ error: "Unsupported file type" });
    return;
  }
  try {
    // Security: `resolved` is validated by safeRealpath (symlink-safe) + isUnderHome (homedir jail) + extension allowlist above.
    const content = await readFile(resolved, "utf-8"); // lgtm[js/path-injection]
    res.json({ path: resolved, content, filename: resolved.split("/").pop() });
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

// Serve demo scripts
app.get("/api/demos", async (_req, res) => {
  try {
    const files = await readdir(DEMOS_DIR);
    const demos = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(await readFile(join(DEMOS_DIR, f), "utf-8"));
        demos.push({ name: f.replace(/\.json$/, ""), title: data.title || f, description: data.description || "" });
      } catch { /* skip malformed */ }
    }
    res.json(demos);
  } catch {
    res.json([]);
  }
});

app.get("/api/demos/:name", async (req, res) => {
  const demoPath = safeDemoPath(req.params.name);
  if (!demoPath) {
    res.status(400).json({ error: "Invalid demo name" });
    return;
  }
  try {
    const data = await readFile(demoPath, "utf-8");
    res.json(JSON.parse(data));
  } catch {
    res.status(404).json({ error: "Demo not found" });
  }
});

// Auth middleware for mutating REST endpoints — requires session token
function requireToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${SESSION_TOKEN}`) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// Save a generated demo script
app.post("/api/demos/save", requireToken, async (req, res) => {
  const { name, demo } = req.body;
  if (!name || !demo) {
    res.status(400).json({ error: "Missing name or demo" });
    return;
  }
  const demoPath = safeDemoPath(name);
  if (!demoPath) {
    res.status(400).json({ error: "Invalid demo name (use a-z, 0-9, -, _ only)" });
    return;
  }
  if (!demo.steps || !Array.isArray(demo.steps)) {
    res.status(400).json({ error: "Demo must have a steps array" });
    return;
  }
  const validTypes = new Set(["command", "live", "question", "action"]);
  for (const step of demo.steps) {
    if (!validTypes.has(step.type)) {
      res.status(400).json({ error: `Invalid step type: ${step.type}` });
      return;
    }
  }
  try {
    await writeFile(demoPath, JSON.stringify(demo, null, 2), "utf-8");
    res.json({ name, path: demoPath, steps: demo.steps.length });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to save demo: ${err.message}` });
  }
});

// Save a generated Playwright spec
const GENERATED_SPECS_DIR = resolve(__dirname, "..", "tests", "generated");
app.post("/api/specs/save", requireToken, async (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) {
    res.status(400).json({ error: "Missing name or content" });
    return;
  }
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeName || safeName !== name) {
    res.status(400).json({ error: "Invalid spec name (use a-z, 0-9, -, _ only)" });
    return;
  }
  try {
    await mkdir(GENERATED_SPECS_DIR, { recursive: true });
    const specPath = resolve(GENERATED_SPECS_DIR, `${safeName}.spec.ts`);
    await writeFile(specPath, content, "utf-8");
    res.json({ name: safeName, path: specPath });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to save spec: ${err.message}` });
  }
});

// Serve changelog
app.get("/api/changelog", async (_req, res) => {
  try {
    const content = await readFile(resolve(__dirname, "..", "CHANGELOG.md"), "utf-8");
    res.json({ content });
  } catch {
    res.status(404).json({ error: "Changelog not found" });
  }
});

// Serve the context wizard agent prompt
app.get("/api/wizard-prompt", async (_req, res) => {
  try {
    const content = await readFile(resolve(__dirname, "..", ".github", "agents", "context-wizard.agent.md"), "utf-8");
    // Strip YAML frontmatter
    const body = content.replace(/^---[\s\S]*?---\s*/, "");
    res.json({ prompt: body });
  } catch {
    res.status(404).json({ error: "Wizard prompt not found" });
  }
});



app.get("/api/models", async (_req, res) => {
  try {
    const bridge = await getModelsBridge();
    const models = await bridge.listModels();
    res.json(models);
  } catch (err: any) {
    console.error("Failed to list models:", err.message);
    res.status(500).json({ error: "Failed to list models" });
  }
});

// Cancellable sleep
function cancellableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

wss.on("connection", (ws) => {
  console.log("Client connected");
  let bridge: CopilotBridge | null = null;
  let demoAbort: AbortController | null = null;
  let pendingAutoApprove: boolean | null = null;
  let userAutoApprove = true; // the user's global setting (from Settings toggle)
  
  let currentWorkingDir: string | undefined;
  let projectMcpServers: Record<string, any> | undefined;

  async function createSession(workingDirectory?: string, model?: string) {
    if (bridge) {
      try { await bridge.stop(); } catch (e: any) { console.debug("[Bridge] Stop error:", e.message); }
    }

    console.log(`[Session] Creating bridge with workingDirectory: ${workingDirectory || "(none)"}`);
    bridge = new CopilotBridge(workingDirectory);
    currentWorkingDir = workingDirectory;

    // Read project-level MCP config — check both .mcp.json and .github/mcp.json
    projectMcpServers = undefined;
    if (workingDirectory) {
      for (const configPath of [".mcp.json", ".github/mcp.json"]) {
        try {
          const mcpPath = resolve(workingDirectory, configPath);
          const mcpData = JSON.parse(await readFile(mcpPath, "utf-8"));
          if (mcpData.mcpServers && Object.keys(mcpData.mcpServers).length > 0) {
            // Normalize: ensure type and tools are set (SDK requires these)
            for (const [name, cfg] of Object.entries(mcpData.mcpServers) as [string, any][]) {
              if (!cfg.type) cfg.type = "local";
              if (!cfg.tools) cfg.tools = ["*"];
            }
            projectMcpServers = { ...(projectMcpServers || {}), ...mcpData.mcpServers };
            console.log(`[MCP] Found ${configPath}: ${Object.keys(mcpData.mcpServers).join(", ")}`);
          }
        } catch { /* not found — try next */ }
      }
    }

    // Apply queued auto-approve setting
    if (pendingAutoApprove !== null) {
      bridge.autoApprove = pendingAutoApprove;
      console.log(`[Security] Auto-approve (queued): ${bridge.autoApprove}`);
      pendingAutoApprove = null;
    }

    bridge.on("delta", (text: string, parentToolCallId?: string) => {
      safeSend(ws, { type: "delta", text, ...(parentToolCallId ? { parentToolCallId } : {}) });
    });

    bridge.on("message", (content: string) => {
      safeSend(ws, { type: "message", content });
    });

    bridge.on("idle", () => {
      safeSend(ws, { type: "idle" });
    });

    bridge.on("error", (text: string) => {
      safeSend(ws, { type: "error", text });
    });

    bridge.on("user_input", (request: any) => {
      safeSend(ws, {
        type: "user_input",
        requestId: request.requestId,
        message: request.message,
        choices: request.choices,
        schema: request.schema,
      });
    });

    bridge.on("tool_start", (data: any) => {
      safeSend(ws, { type: "tool_start", toolName: data.toolName, toolArgs: data.toolArgs, parentToolCallId: data.parentToolCallId });
    });

    bridge.on("tool_complete", (data: any) => {
      safeSend(ws, { type: "tool_complete", toolName: data.toolName, toolResult: data.toolResult, toolCallId: data.toolCallId, parentToolCallId: data.parentToolCallId });
    });

    bridge.on("tool_partial", (data: any) => {
      safeSend(ws, { type: "tool_partial", toolCallId: data.toolCallId, partialOutput: data.partialOutput });
    });

    bridge.on("tool_progress", (data: any) => {
      safeSend(ws, { type: "tool_progress", toolCallId: data.toolCallId, progressMessage: data.progressMessage });
    });

    bridge.on("intent", (text: string) => {
      safeSend(ws, { type: "intent", text });
    });

    bridge.on("subagent_start", (data: any) => {
      safeSend(ws, { type: "subagent_start", ...data });
    });

    bridge.on("subagent_complete", (data: any) => {
      safeSend(ws, { type: "subagent_complete", ...data });
    });

    bridge.on("subagent_output", (data: any) => {
      safeSend(ws, { type: "subagent_output", ...data });
    });

    bridge.on("task_complete", (data: any) => {
      safeSend(ws, { type: "task_complete", summary: data.summary });
    });

    bridge.on("file_changed", (data: any) => {
      safeSend(ws, { type: "file_changed", path: data.path, operation: data.operation });
    });

    bridge.on("capabilities_loaded", (data: any) => {
      safeSend(ws, { type: "capabilities_loaded", kind: data.kind, items: data.items, warnings: data.warnings, errors: data.errors });
    });

    bridge.on("mcp_status", (data: any) => {
      console.log(`[MCP] Status event: ${data.serverName} → ${data.status}`);
      safeSend(ws, { type: "mcp_status", serverName: data.serverName, status: data.status });
    });

    bridge.on("mcp_tools_discovered", (data: any) => {
      safeSend(ws, { type: "mcp_tools_discovered", serverName: data.serverName, tools: data.tools });
    });

    bridge.on("tools_updated", async () => {
      if (!bridge) return;
      try {
        const tools = await bridge.listTools();
        const servers = await bridge.listMcpServers().catch(() => []);
        const connectedNames = servers.filter((s: any) => s.status === "connected").map((s: any) => s.name);

        // Query project MCP servers directly for their tools
        const projectTools = await queryProjectMcpServerTools(projectMcpServers, connectedNames);
        const pluginTools = await getMcpToolMap();
        const mcpToolMap: Record<string, McpToolInfo[]> = { ...pluginTools, ...projectTools };

        console.log(`[MCP] Tools updated: ${tools.length} built-in, MCP: ${Object.entries(mcpToolMap).map(([k, v]) => `${k}:${v.length}`).join(", ") || "none"}`);
        safeSend(ws, { type: "capabilities_update", tools, mcpTools: mcpToolMap });
      } catch (e: any) { console.debug("[MCP] Tools update error:", e.message); }
    });

    bridge.on("permission_request", (data: any) => {
      safeSend(ws, { type: "permission_request", requestId: data.requestId, permissionKind: data.permissionKind, details: data.details });
    });

    try {
      await bridge.createSession(model, currentWorkingDir, undefined, undefined, projectMcpServers);
      console.log("Copilot session created");

      // Enable all skills so agents/sub-agents can invoke them
      await bridge.enableAllSkills();

      // Proactively fetch MCP servers discovered for this project
      const mcpServers = await bridge.listMcpServers().catch(() => []);
      if (mcpServers.length > 0) {
        safeSend(ws, { type: "capabilities_loaded", kind: "mcp_servers", items: mcpServers });
      }
      console.log(`[MCP] Initial: ${mcpServers.length} servers (${mcpServers.map((s: any) => s.name).join(", ")})`);

      // Re-fetch after a delay — project MCP servers may still be connecting
      setTimeout(async () => {
        if (!bridge) return;
        try {
          const updated = await bridge.listMcpServers();
          const connectedNames = updated.filter((s: any) => s.status === "connected").map((s: any) => s.name);
          console.log(`[MCP] Delayed: ${updated.length} servers (${updated.map((s: any) => `${s.name}:${s.status}`).join(", ")})`);
          safeSend(ws, { type: "capabilities_loaded", kind: "mcp_servers", items: updated });

          // Query project MCP servers directly for their tools
          const projectTools = await queryProjectMcpServerTools(projectMcpServers, connectedNames);
          // Also get installed-plugin tools
          const pluginTools = await getMcpToolMap();
          const mcpToolMap: Record<string, McpToolInfo[]> = { ...pluginTools, ...projectTools };

          // Get built-in tools too
          const tools = await bridge.listTools();
          console.log(`[MCP] Delayed tools: ${tools.length} built-in, MCP: ${Object.entries(mcpToolMap).map(([k, v]) => `${k}:${v.length}`).join(", ") || "none"}`);
          safeSend(ws, { type: "capabilities_update", tools, mcpTools: mcpToolMap });
        } catch (e: any) { console.debug("[MCP] Delayed fetch error:", e.message); }
      }, 5000);

      // Detect git branch if working directory is a git repo
      let branch: string | undefined;
      if (currentWorkingDir) {
        try {
          branch = await new Promise<string>((resolve, reject) => {
            const proc = spawn("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: currentWorkingDir, stdio: ["ignore", "pipe", "ignore"] });
            let out = "";
            proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.on("close", (code) => code === 0 ? resolve(out.trim()) : reject());
            proc.on("error", reject);
          });
        } catch (e: any) { console.debug("[Git] Branch detection failed:", e.message); }
      }

      safeSend(ws, { type: "session_ready", workingDirectory: currentWorkingDir, model: model || "(default)", branch, version: APP_VERSION, ...(latestVersion ? { latestVersion } : {}) });
    } catch (err: any) {
      console.error("Failed to create session:", err.message);
      safeSend(ws, { type: "error", text: `Session creation failed: ${err.message}` });
    }
  }

  async function handlePrompt(prompt: string) {
    if (!bridge) {
      safeSend(ws, { type: "error", text: "No active session" });
      return;
    }
    try {
      let finalPrompt = prompt;

      // Transform /skill-name prefix into a skill invocation instruction
      const skillMatch = prompt.match(/^\/([\w-]+)\s*(.*)/s);
      if (skillMatch) {
        const [, skillName, userPrompt] = skillMatch;
        const sdkSkills = await bridge.listSkills();
        const allNames = new Set(sdkSkills.map((s: any) => s.name));
        if (allNames.has(skillName)) {
          finalPrompt = userPrompt.trim()
            ? `Use the "${skillName}" skill to: ${userPrompt.trim()}`
            : `Invoke the "${skillName}" skill`;
        }
      }

      await bridge.sendPrompt(finalPrompt);
    } catch (err: any) {
      safeSend(ws, { type: "error", text: err.message });
    }
  }

  function cancelDemo() {
    if (demoAbort) {
      demoAbort.abort();
      demoAbort = null;
    }
  }

  async function runDemo(demoName: string) {
    cancelDemo();
    const abort = new AbortController();
    demoAbort = abort;
    const { signal } = abort;

    const demoPath = safeDemoPath(demoName);
    if (!demoPath) {
      safeSend(ws, { type: "error", text: "Invalid demo name" });
      return;
    }

    try {
      const raw = await readFile(demoPath, "utf-8");
      const demo = JSON.parse(raw);

      // Helper: wait for the bridge to go idle (turn complete)
      function waitForIdle(timeoutMs = 120_000): Promise<void> {
        return new Promise((resolve, reject) => {
          if (!bridge) return reject(new Error("No bridge"));
          const onAbort = () => { cleanup(); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); };
          const timer = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
          const onIdle = () => { cleanup(); resolve(); };
          function cleanup() {
            bridge?.removeListener("idle", onIdle);
            signal.removeEventListener("abort", onAbort);
            clearTimeout(timer);
          }
          bridge.once("idle", onIdle);
          signal.addEventListener("abort", onAbort);
        });
      }

      for (const step of demo.steps) {
        await cancellableSleep(800, signal);

        if (step.type === "live") {
          // Auto-type the prompt into the UI, then send it live to Copilot
          safeSend(ws, {
            type: "demo_step_command",
            text: step.text,
            typingSpeed: step.typingSpeed || 45,
          });
          await cancellableSleep(step.text.length * (step.typingSpeed || 45) + 600, signal);

          // Actually send the prompt to Copilot
          await handlePrompt(step.text);

          // Wait for Copilot to finish responding
          await waitForIdle(step.timeout || 120_000);

          // Pause between steps
          await cancellableSleep(step.pauseAfter || 2000, signal);

        } else if (step.type === "command") {
          safeSend(ws, {
            type: "demo_step_command",
            text: step.text,
            typingSpeed: step.typingSpeed || 45,
          });

          await cancellableSleep(step.text.length * (step.typingSpeed || 45) + 1200, signal);

          safeSend(ws, {
            type: "demo_step_response",
            text: step.response,
          });

          const words = step.response.split(/\s+/).length;
          await cancellableSleep(words * 35 + 1000, signal);
        } else if (step.type === "question") {
          safeSend(ws, {
            type: "demo_step_command",
            text: step.text,
            typingSpeed: step.typingSpeed || 45,
          });

          await cancellableSleep(step.text.length * (step.typingSpeed || 45) + 1200, signal);

          // Show dialog with pre-filled answer for auto-submit
          safeSend(ws, {
            type: "demo_step_question",
            message: step.question.message,
            schema: step.question.schema,
            autoAnswer: step.answer,
            autoSubmitDelay: 2500,
          });

          // Wait for dialog to be shown, auto-filled, and auto-dismissed
          await cancellableSleep(3500, signal);

          safeSend(ws, {
            type: "demo_step_response",
            text: step.response,
          });

          const words = step.response.split(/\s+/).length;
          await cancellableSleep(words * 35 + 1000, signal);
        } else if (step.type === "action") {
          // Send a UI action to the frontend (layout switch, model pick, open file, etc.)
          safeSend(ws, { type: "demo_action", action: step.action, value: step.value });
          await cancellableSleep(step.pauseAfter || 1500, signal);
        }
      }

      safeSend(ws, { type: "demo_complete" });
    } catch (err: any) {
      if (err.name === "AbortError") return; // cancelled
      safeSend(ws, { type: "error", text: `Demo error: ${err.message}` });
    } finally {
      if (demoAbort === abort) demoAbort = null;
    }
  }

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case "create_session":
          cancelDemo();
          await createSession(msg.workingDirectory, msg.model);
          break;

        case "send_prompt":
          await handlePrompt(msg.prompt);
          break;

        case "user_input_response":
          if (bridge) {
            bridge.resolveUserInput(msg.requestId, msg.values);
          }
          break;

        case "permission_response":
          if (bridge) {
            bridge.resolvePermission(msg.requestId, msg.approved);
          }
          break;

        case "set_auto_approve":
          userAutoApprove = !!msg.enabled;
          if (bridge) {
            bridge.autoApprove = !!msg.enabled;
            console.log(`[Security] Auto-approve: ${bridge.autoApprove}`);
          } else {
            pendingAutoApprove = !!msg.enabled;
          }
          break;

        case "start_demo":
          runDemo(msg.demo || "intro");
          break;

        case "cancel_demo":
          cancelDemo();
          break;

        case "abort":
          if (bridge) await bridge.abort();
          break;

        case "set_model":
          if (bridge && msg.model) {
            try {
              await bridge.setModel(msg.model);
              safeSend(ws, { type: "model_changed", model: msg.model });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Model change failed: ${err.message}` });
            }
          }
          break;

        case "list_agents":
          if (bridge) {
            try {
              const agents = await bridge.listAgents();
              console.log(`[Agents] ${agents.length} agents`);
              safeSend(ws, { type: "agents_list", agents });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Failed to list agents: ${err.message}` });
            }
          }
          break;

        case "select_agent":
          if (bridge && msg.name) {
            try {
              
              const result = await bridge.selectAgent(msg.name);
              safeSend(ws, { type: "agent_selected", agent: result.agent });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Agent selection failed: ${err.message}` });
            }
          }
          break;

        case "deselect_agent":
          if (bridge) {
            
            try {
              await bridge.deselectAgent();
              safeSend(ws, { type: "agent_deselected" });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Agent deselection failed: ${err.message}` });
            }
          }
          break;

        case "list_skills":
          if (bridge) {
            try {
              const skills = await bridge.listSkills();
              console.log(`[Skills] ${skills.length} skills`);
              safeSend(ws, { type: "skills_list", skills });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Failed to list skills: ${err.message}` });
            }
          }
          break;

        case "get_mode":
          if (bridge) {
            try {
              const mode = await bridge.getMode();
              safeSend(ws, { type: "mode_current", mode });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Failed to get mode: ${err.message}` });
            }
          }
          break;

        case "set_mode":
          if (bridge) {
            try {
              const mode = await bridge.setMode(msg.mode);
              // Autopilot mode auto-enables permission approval; leaving autopilot restores user setting
              if (mode === "autopilot") {
                bridge.autoApprove = true;
                console.log("[Security] Auto-approve forced ON (autopilot mode)");
              } else {
                bridge.autoApprove = userAutoApprove;
                console.log(`[Security] Auto-approve restored to user setting: ${userAutoApprove}`);
              }
              safeSend(ws, { type: "mode_changed", mode, autoApprove: bridge.autoApprove });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Failed to set mode: ${err.message}` });
            }
          }
          break;

        case "list_capabilities":
          if (bridge) {
            try {
              const [mcpServers, skills] = await Promise.all([
                bridge.listMcpServers().catch(e => { console.warn("[Capabilities] MCP list failed:", e.message); return []; }),
                bridge.listSkills().catch(e => { console.warn("[Capabilities] Skills list failed:", e.message); return []; }),
              ]);
              let tools: any[] = [];
              try { tools = await bridge.listTools(); } catch (e: any) { console.warn("[Capabilities] Tools list failed:", e.message); }

              // Query MCP servers directly for their tools
              const connectedNames = mcpServers.filter((s: any) => s.status === "connected").map((s: any) => s.name);
              const projectTools = await queryProjectMcpServerTools(projectMcpServers, connectedNames);
              const pluginTools = await getMcpToolMap();
              const mcpToolMap: Record<string, McpToolInfo[]> = { ...pluginTools, ...projectTools };
              console.log(`[Capabilities] ${mcpServers.length} MCP servers, ${skills.length} skills, ${tools.length} built-in tools, ${Object.values(mcpToolMap).reduce((s, t) => s + t.length, 0)} MCP tools`);

              safeSend(ws, { type: "capabilities_list", mcpServers, skills, tools, mcpTools: mcpToolMap });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Failed to list capabilities: ${err.message}` });
            }
          }
          break;

        case "toggle_mcp":
          if (bridge && msg.name) {
            try {
              if (msg.enabled) {
                await bridge.enableMcpServer(msg.name);
              } else {
                await bridge.disableMcpServer(msg.name);
              }
              // Re-fetch state after toggle
              const [mcpServers, tools] = await Promise.all([
                bridge.listMcpServers(),
                bridge.listTools(),
              ]);
              const connectedNames = mcpServers.filter((s: any) => s.status === "connected").map((s: any) => s.name);
              const projectTools = await queryProjectMcpServerTools(projectMcpServers, connectedNames);
              const pluginTools = await getMcpToolMap();
              const mcpToolMap: Record<string, McpToolInfo[]> = { ...pluginTools, ...projectTools };
              safeSend(ws, { type: "capabilities_update", mcpServers, tools, mcpTools: mcpToolMap });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Failed to toggle MCP server: ${err.message}` });
            }
          }
          break;

        case "toggle_skill":
          if (bridge && msg.name) {
            try {
              if (msg.enabled) {
                await bridge.enableSkill(msg.name);
              } else {
                await bridge.disableSkill(msg.name);
              }
              const skills = await bridge.listSkills();
              safeSend(ws, { type: "capabilities_update", skills });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Failed to toggle skill: ${err.message}` });
            }
          }
          break;

        case "toggle_tool":
          if (bridge && msg.name) {
            if (msg.excluded) {
              bridge.excludedTools.add(msg.name);
            } else {
              bridge.excludedTools.delete(msg.name);
            }
            safeSend(ws, { type: "tool_exclusion_updated", name: msg.name, excluded: msg.excluded });
          }
          break;

        case "generate_demo_plan": {
          if (!bridge) {
            safeSend(ws, { type: "error", text: "No active session" });
            break;
          }
          const target = msg.target || "self"; // "self" or "project"
          const format = msg.outputFormat || "demogod"; // "demogod" or "playwright"
          const description = msg.description || "";
          let systemPrompt: string;
          if (target === "self" && format === "playwright") {
            systemPrompt = SELF_PLAYWRIGHT_PROMPT;
          } else if (target === "self") {
            systemPrompt = SELF_DEMO_PROMPT;
          } else {
            systemPrompt = PROJECT_DEMO_PROMPT;
          }
          const prompt = `${systemPrompt}\n\n## User's Demo Description\n\n${description}`;
          try {
            await bridge.sendPrompt(prompt);
          } catch (err: any) {
            safeSend(ws, { type: "error", text: `Failed to generate demo plan: ${err.message}` });
          }
          break;
        }

        case "save_demo_plan": {
          const { name: planName, format: planFormat, content: planContent } = msg;
          if (!planName || !planContent) {
            safeSend(ws, { type: "error", text: "Missing name or content" });
            break;
          }
          try {
            if (planFormat === "playwright") {
              await mkdir(resolve(__dirname, "..", "tests", "generated"), { recursive: true });
              const safeName = planName.replace(/[^a-zA-Z0-9_-]/g, "");
              const specPath = resolve(__dirname, "..", "tests", "generated", `${safeName}.spec.ts`);
              await writeFile(specPath, planContent, "utf-8");
              safeSend(ws, { type: "demo_plan_saved", format: "playwright", name: safeName, path: specPath,
                runCommand: `npx playwright test tests/generated/${safeName}.spec.ts --headed` });
            } else {
              const parsed = typeof planContent === "string" ? JSON.parse(planContent) : planContent;
              const demoPath = safeDemoPath(planName);
              if (!demoPath) {
                safeSend(ws, { type: "error", text: "Invalid demo name" });
                break;
              }
              await writeFile(demoPath, JSON.stringify(parsed, null, 2), "utf-8");
              safeSend(ws, { type: "demo_plan_saved", format: "demogod", name: planName, path: demoPath });
            }
          } catch (err: any) {
            safeSend(ws, { type: "error", text: `Failed to save demo plan: ${err.message}` });
          }
          break;
        }
      }
    } catch (err: any) {
      console.error("Message handling error:", err.message);
    }
  });

  ws.on("close", async () => {
    console.log("Client disconnected");
    cancelDemo();
    if (bridge) {
      try { await bridge.stop(); } catch (e: any) { console.debug("[Bridge] Stop error on disconnect:", e.message); }
      bridge = null;
    }
  });
});

function safeSend(ws: WebSocket, data: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}


// ─── Terminal startup animation ──────────────────────────────────────────────
const GOLD = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function startupAnimation() {
  const lines = [
    `${DIM}  ┌──────────────────────────────────────────┐${RESET}`,
    `${DIM}  │${RESET}  ${DIM}●${RESET} ${DIM}●${RESET} ${DIM}●${RESET}                                    ${DIM}│${RESET}`,
    `${DIM}  │${RESET}                                          ${DIM}│${RESET}`,
    `${DIM}  │${RESET}   ${GREEN}❯${RESET} ${BOLD}${GREEN}Demo${RESET}${BOLD}${GOLD}God${RESET}  ${GOLD}✦${RESET}                        ${DIM}│${RESET}`,
    `${DIM}  │${RESET}                                          ${DIM}│${RESET}`,
    `${DIM}  │${RESET}   ${DIM}demo video generator for copilot cli${RESET}   ${DIM}│${RESET}`,
    `${DIM}  └──────────────────────────────────────────┘${RESET}`,
  ];

  // Draw border first
  process.stdout.write("\n");
  for (const line of lines) {
    process.stdout.write(line + "\n");
    await sleep(60);
  }
  process.stdout.write("\n");

  // Info lines with typing effect
  const info = [
    `  ${CYAN}🎬${RESET}  v${APP_VERSION}`,
    `  ${GREEN}🌐${RESET}  http://localhost:${PORT}`,
    `  ${GREEN}🔒${RESET}  Bound to 127.0.0.1`,
    `  ${DIM}🔑  ${SESSION_TOKEN.slice(0, 8)}…${RESET}`,
  ];

  for (const line of info) {
    process.stdout.write(line + "\n");
    await sleep(80);
  }
  process.stdout.write("\n");
}

server.listen(PORT, "127.0.0.1", () => {
  startupAnimation();
});
