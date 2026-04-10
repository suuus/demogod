import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "url";
import { dirname, join, resolve, normalize } from "path";
import { readFile, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { CopilotBridge } from "./copilot-bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEMOS_DIR = resolve(__dirname, "..", "demos");

// ---------- Plugin skill scanner ----------
// Plugin skills are NOT returned by the SDK's skills.list() RPC.
// They live in ~/.copilot/installed-plugins/ and we parse SKILL.md frontmatter.
interface PluginSkill {
  name: string;
  description: string;
  source: string; // "plugin"
  pluginName: string;
  enabled: boolean;
  userInvocable: boolean;
}

async function scanPluginSkills(): Promise<PluginSkill[]> {
  const pluginsRoot = join(homedir(), ".copilot", "installed-plugins");
  const skills: PluginSkill[] = [];
  try {
    await stat(pluginsRoot);
  } catch {
    return skills;
  }

  // Walk marketplace dirs → plugin dirs → look for plugin.json or .mcp.json
  async function walkDir(dir: string, depth = 0): Promise<void> {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Try to find a plugin name from plugin.json (multiple locations)
    let pluginName: string | undefined;
    let skillsDirFromConfig: string | undefined;
    for (const jsonPath of [
      join(dir, "plugin.json"),
      join(dir, ".claude-plugin", "plugin.json"),
    ]) {
      try {
        const raw = await readFile(jsonPath, "utf-8");
        const pluginDef = JSON.parse(raw);
        pluginName = pluginDef.name || pluginName;
        if (pluginDef.skills) {
          skillsDirFromConfig = join(dir, pluginDef.skills);
        }
      } catch {
        // Not found — continue
      }
    }

    // Scan skills from configured dir, or fallback to common locations
    const skillsDirs: string[] = [];
    if (skillsDirFromConfig) skillsDirs.push(resolve(skillsDirFromConfig));
    // Also check common skill directory patterns
    for (const candidate of ["skills", ".github/skills"]) {
      const candidatePath = resolve(dir, candidate);
      if (!skillsDirs.includes(candidatePath)) {
        try {
          const s = await stat(candidatePath);
          if (s.isDirectory()) skillsDirs.push(candidatePath);
        } catch {
          // Not found
        }
      }
    }

    if (skillsDirs.length > 0) {
      // Fallback: use directory name as plugin name
      const effectiveName = pluginName || dir.split("/").pop() || "unknown";
      for (const sd of skillsDirs) {
        await scanSkillsDirectory(sd, effectiveName, skills);
      }
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await walkDir(join(dir, entry.name), depth + 1);
      }
    }
  }

  async function scanSkillsDirectory(
    skillsDir: string,
    pluginName: string,
    out: PluginSkill[]
  ): Promise<void> {
    let dirs;
    try {
      dirs = await readdir(skillsDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const skillMd = join(skillsDir, d.name, "SKILL.md");
      try {
        const content = await readFile(skillMd, "utf-8");
        const fm = parseFrontmatter(content);
        out.push({
          name: fm.name || d.name,
          description: fm.description || "",
          source: "plugin",
          pluginName,
          enabled: true,
          userInvocable: fm["user-invocable"] !== false,
        });
      } catch {
        // SKILL.md missing or unreadable — use directory name
        out.push({
          name: d.name,
          description: "",
          source: "plugin",
          pluginName,
          enabled: true,
          userInvocable: true,
        });
      }
    }
  }

  function parseFrontmatter(content: string): Record<string, any> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: Record<string, any> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let value: any = line.slice(idx + 1).trim();
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value === "true") value = true;
      else if (value === "false") value = false;
      result[key] = value;
    }
    return result;
  }

  await walkDir(pluginsRoot);
  return skills;
}

// Cache plugin skills (they don't change during server lifetime)
let cachedPluginSkills: PluginSkill[] | null = null;
async function getPluginSkills(): Promise<PluginSkill[]> {
  if (!cachedPluginSkills) {
    cachedPluginSkills = await scanPluginSkills();
    console.log(`[Plugins] Discovered ${cachedPluginSkills.length} plugin skills:`,
      cachedPluginSkills.map(s => s.name).join(", "));
  }
  return cachedPluginSkills;
}

// Collect skill directory paths for passing to SessionConfig.skillDirectories
async function getPluginSkillDirectories(): Promise<string[]> {
  const pluginsRoot = join(homedir(), ".copilot", "installed-plugins");
  const dirs: string[] = [];
  try { await stat(pluginsRoot); } catch { return dirs; }

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 3) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

    let skillsDirFromConfig: string | undefined;
    for (const jsonPath of [join(dir, "plugin.json"), join(dir, ".claude-plugin", "plugin.json")]) {
      try {
        const raw = await readFile(jsonPath, "utf-8");
        const pluginDef = JSON.parse(raw);
        if (pluginDef.skills) skillsDirFromConfig = join(dir, pluginDef.skills);
      } catch {}
    }
    const candidates: string[] = [];
    if (skillsDirFromConfig) candidates.push(resolve(skillsDirFromConfig));
    for (const c of ["skills", ".github/skills"]) {
      const p = resolve(dir, c);
      if (!candidates.includes(p)) {
        try { if ((await stat(p)).isDirectory()) candidates.push(p); } catch {}
      }
    }
    dirs.push(...candidates);
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await walk(join(dir, entry.name), depth + 1);
      }
    }
  }
  await walk(pluginsRoot);
  return [...new Set(dirs)];
}

// ---------- Plugin agent scanner ----------
interface PluginAgent {
  name: string;
  displayName: string;
  description: string;
  source: string;
  pluginName: string;
  prompt: string;
}

async function scanPluginAgents(): Promise<PluginAgent[]> {
  const pluginsRoot = join(homedir(), ".copilot", "installed-plugins");
  const agents: PluginAgent[] = [];
  try { await stat(pluginsRoot); } catch { return agents; }

  async function walkDir(dir: string, depth = 0): Promise<void> {
    if (depth > 3) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

    // Find plugin name
    let pluginName: string | undefined;
    let agentsDirFromConfig: string | undefined;
    for (const jsonPath of [join(dir, "plugin.json"), join(dir, ".claude-plugin", "plugin.json")]) {
      try {
        const raw = await readFile(jsonPath, "utf-8");
        const def = JSON.parse(raw);
        pluginName = def.name || pluginName;
        if (def.agents) agentsDirFromConfig = resolve(dir, def.agents);
      } catch {}
    }

    // Scan agent directories
    const agentsDirs: string[] = [];
    if (agentsDirFromConfig) agentsDirs.push(agentsDirFromConfig);
    for (const candidate of ["agents", ".github/agents"]) {
      const p = resolve(dir, candidate);
      if (!agentsDirs.includes(p)) {
        try { const s = await stat(p); if (s.isDirectory()) agentsDirs.push(p); } catch {}
      }
    }

    if (agentsDirs.length > 0) {
      const effectiveName = pluginName || dir.split("/").pop() || "unknown";
      for (const ad of agentsDirs) {
        try {
          const files = await readdir(ad);
          for (const f of files) {
            if (!f.endsWith(".agent.md")) continue;
            try {
              const content = await readFile(join(ad, f), "utf-8");
              const fm = parseFrontmatter(content);
              // Extract prompt: everything after the frontmatter closing ---
              const promptMatch = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)/);
              const prompt = promptMatch ? promptMatch[1].trim() : content;
              const slug = f.replace(".agent.md", "");
              agents.push({
                name: `${effectiveName}:${slug}`,
                displayName: fm.name || slug,
                description: fm.description || "",
                source: "plugin",
                pluginName: effectiveName,
                prompt,
              });
            } catch {}
          }
        } catch {}
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await walkDir(join(dir, entry.name), depth + 1);
      }
    }
  }

  function parseFrontmatter(content: string): Record<string, any> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: Record<string, any> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let value: any = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
        value = value.slice(1, -1);
      result[key] = value;
    }
    return result;
  }

  await walkDir(pluginsRoot);
  return agents;
}

let cachedPluginAgents: PluginAgent[] | null = null;
async function getPluginAgents(): Promise<PluginAgent[]> {
  if (!cachedPluginAgents) {
    cachedPluginAgents = await scanPluginAgents();
    console.log(`[Plugins] Discovered ${cachedPluginAgents.length} plugin agents:`,
      cachedPluginAgents.map(a => a.name).join(", "));
  }
  return cachedPluginAgents;
}

const PORT = parseInt(process.env.PORT || "3456", 10);

// ─── Security: session token for WebSocket auth ─────────────────────────────
// A random token generated at startup. Only clients that receive the token
// (via the injected <meta> tag in index.html) can open WebSocket connections.
// This prevents other local processes or malicious web pages from hijacking
// the Copilot bridge.
const SESSION_TOKEN = randomBytes(32).toString("hex");

const app = express();

// Serve index.html with the session token injected as a <meta> tag.
// All other static files are served normally.
const PUBLIC_DIR = join(__dirname, "..", "src", "public");

app.get("/", async (_req, res) => {
  try {
    let html = await readFile(join(PUBLIC_DIR, "index.html"), "utf-8");
    html = html.replace(
      "</head>",
      `  <meta name="dg-token" content="${SESSION_TOKEN}">\n</head>`
    );
    res.type("html").send(html);
  } catch {
    res.status(500).send("Failed to load index.html");
  }
});

app.use(express.static(PUBLIC_DIR));

const server = createServer(app);

// ─── WebSocket server with origin + token verification ──────────────────────
const wss = new WebSocketServer({
  server,
  verifyClient: (info, done) => {
    // 1. Origin check: only allow localhost origins (or no origin for Tauri/native)
    const origin = info.origin || info.req.headers.origin;
    if (origin) {
      try {
        const url = new URL(origin);
        const allowed = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
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

    // 2. Token check: must provide valid token as query param
    const url = new URL(info.req.url || "/", `http://${info.req.headers.host}`);
    const token = url.searchParams.get("token");
    if (token !== SESSION_TOKEN) {
      console.warn("[Security] Rejected WS connection: invalid token");
      done(false, 401, "Unauthorized");
      return;
    }

    done(true);
  },
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
  const resolved = resolve(DEMOS_DIR, `${safeName}.json`);
  if (!resolved.startsWith(DEMOS_DIR)) return null;
  return resolved;
}

app.use(express.json());

// List directories for project picker
app.get("/api/browse", async (req, res) => {
  const requestedPath = (req.query.path as string) || homedir();
  const resolvedPath = resolve(requestedPath);

  // Security: must be under home directory
  const home = homedir();
  if (!resolvedPath.startsWith(home) && resolvedPath !== "/") {
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
  const resolvedPath = resolve(requestedPath);
  const home = homedir();
  if (!resolvedPath.startsWith(home) && resolvedPath !== "/") {
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
      .filter((e) => e.isFile())
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
  const resolved = resolve(filePath);
  // Security: must be under home directory
  const home = homedir();
  if (!resolved.startsWith(home)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  // Only allow text-like files
  if (!/\.(md|txt|json|yaml|yml|toml|csv|log|xml|html|css|js|ts|py|sh|rs|go|rb|java)$/i.test(resolved)) {
    res.status(400).json({ error: "Unsupported file type" });
    return;
  }
  try {
    const content = await readFile(resolved, "utf-8");
    res.json({ path: resolved, content, filename: resolved.split("/").pop() });
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

// Serve demo scripts
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

// List available models
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
  let selectedPluginAgent: PluginAgent | null = null;
  let currentWorkingDir: string | undefined;

  async function createSession(workingDirectory?: string, model?: string) {
    if (bridge) {
      try { await bridge.stop(); } catch {}
    }

    bridge = new CopilotBridge();
    currentWorkingDir = workingDirectory;

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
      safeSend(ws, { type: "mcp_status", serverName: data.serverName, status: data.status });
    });

    try {
      // Load plugin agents and skill directories so the SDK knows about them
      const pluginAgents = await getPluginAgents();
      const customAgents = pluginAgents.map(a => ({
        name: a.name,
        displayName: a.displayName,
        description: a.description,
        prompt: a.prompt,
      }));
      const skillDirs = await getPluginSkillDirectories();
      console.log(`[Skills] Registering ${skillDirs.length} plugin skill directories`);

      await bridge.createSession(model, currentWorkingDir, customAgents, skillDirs);
      console.log("Copilot session created with", customAgents.length, "custom agents");

      // Enable all skills so agents/sub-agents can invoke them
      await bridge.enableAllSkills();

      safeSend(ws, { type: "session_ready", workingDirectory: currentWorkingDir, model: model || "(default)" });
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
        const pluginSkills = await getPluginSkills();
        const sdkSkills = await bridge.listSkills();
        const allNames = new Set([
          ...sdkSkills.map((s: any) => s.name),
          ...pluginSkills.map(s => s.name),
        ]);
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

      for (const step of demo.steps) {
        await cancellableSleep(800, signal);

        if (step.type === "command") {
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
          handlePrompt(msg.prompt);
          break;

        case "user_input_response":
          if (bridge) {
            bridge.resolveUserInput(msg.requestId, msg.values);
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
              const sdkAgents = await bridge.listAgents();
              const pluginAgents = await getPluginAgents();
              const sdkNames = new Set(sdkAgents.map((a: any) => a.name));
              const merged = [
                ...sdkAgents,
                ...pluginAgents.filter(pa => !sdkNames.has(pa.name)),
              ];
              console.log(`[Agents] ${sdkAgents.length} SDK + ${pluginAgents.length} plugin → ${merged.length} total`);
              safeSend(ws, { type: "agents_list", agents: merged });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Failed to list agents: ${err.message}` });
            }
          }
          break;

        case "select_agent":
          if (bridge && msg.name) {
            try {
              // Try SDK agent selection first
              selectedPluginAgent = null;
              const result = await bridge.selectAgent(msg.name);
              safeSend(ws, { type: "agent_selected", agent: result.agent });
            } catch (err: any) {
              // If SDK doesn't know the agent, check if it's a plugin agent
              const pluginAgents = await getPluginAgents();
              const pa = pluginAgents.find(a => a.name === msg.name);
              if (pa) {
                selectedPluginAgent = pa;
                safeSend(ws, {
                  type: "agent_selected",
                  agent: { name: pa.name, displayName: pa.displayName, description: pa.description, source: "plugin" },
                });
              } else {
                safeSend(ws, { type: "error", text: `Agent selection failed: ${err.message}` });
              }
            }
          }
          break;

        case "deselect_agent":
          if (bridge) {
            selectedPluginAgent = null;
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
              const sdkSkills = await bridge.listSkills();
              const pluginSkills = await getPluginSkills();
              // Merge: SDK skills + plugin skills (deduplicate by name)
              const sdkNames = new Set(sdkSkills.map((s: any) => s.name));
              const merged = [
                ...sdkSkills,
                ...pluginSkills.filter(ps => !sdkNames.has(ps.name)),
              ];
              console.log(`[Skills] ${sdkSkills.length} SDK + ${pluginSkills.length} plugin → ${merged.length} total`);
              safeSend(ws, { type: "skills_list", skills: merged });
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
              safeSend(ws, { type: "mode_changed", mode });
            } catch (err: any) {
              safeSend(ws, { type: "error", text: `Failed to set mode: ${err.message}` });
            }
          }
          break;
      }
    } catch (err: any) {
      console.error("Message handling error:", err.message);
    }
  });

  ws.on("close", async () => {
    console.log("Client disconnected");
    cancelDemo();
    if (bridge) {
      try { await bridge.stop(); } catch {}
      bridge = null;
    }
  });
});

function safeSend(ws: WebSocket, data: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  🎬 DemoGod — Copilot CLI Demo Video Generator`);
  console.log(`  ────────────────────────────────────────────`);
  console.log(`  Open http://localhost:${PORT} in your browser`);
  console.log(`  🔒 Bound to 127.0.0.1 — not accessible from network`);
  console.log(`  🔑 Session token: ${SESSION_TOKEN}\n`);
});
