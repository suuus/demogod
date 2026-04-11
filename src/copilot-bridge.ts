import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type {
  SessionEvent,
  ElicitationContext,
  ElicitationResult,
  ModelInfo,
  PermissionRequest,
} from "@github/copilot-sdk";
import { EventEmitter } from "events";

export interface UserInputBridgeRequest {
  requestId: string;
  message: string;
  choices?: string[];
  schema?: Record<string, unknown>;
}

/**
 * Bridges the Copilot SDK to WebSocket consumers.
 * Manages a single Copilot session and emits events for the frontend.
 * Ensures ALL agents, skills, and tools from the CLI are accessible.
 */
// Injected into the system prompt so the agent (and sub-agents) always
// use ask_user for questions — one at a time — instead of inline text.
const DEMO_SYSTEM_INSTRUCTIONS = [
  "IMPORTANT — User interaction rules for this session:",
  "1. When you need ANY input, clarification, or decision from the user, you MUST use the ask_user tool. NEVER ask questions in plain text output.",
  "2. Ask exactly ONE question per ask_user call. Do NOT bundle multiple questions. Ask one, wait for the answer, then ask the next if needed.",
  "3. When delegating to sub-agents, explicitly instruct them to follow the same rules: use ask_user, one question at a time, never ask in prose.",
  "4. Prefer enum / boolean fields over free-text when the options are known. Always set a default value.",
].join("\n");

export class CopilotBridge extends EventEmitter {
  private client: CopilotClient;
  private session: CopilotSession | null = null;
  private pendingInputs = new Map<string, (response: any) => void>();
  private pendingPermissions = new Map<string, (approved: boolean) => void>();
  private inputCounter = 0;
  private permissionCounter = 0;
  autoApprove = true;
  // Track active task tool calls so we can match start→complete with args
  private activeTaskAgents: { agentName: string; agentDisplayName: string }[] = [];
  // Map background agent IDs to their agentName for routing read_agent results
  private backgroundAgentMap = new Map<string, string>();
  // Track discovered MCP tools by server name
  private mcpServerNames: string[] = [];
  discoveredMcpTools: Record<string, string[]> = {};

  constructor() {
    super();
    this.client = new CopilotClient();
  }

  /** Ensure the underlying CLI client is connected (auto-starts if needed). */
  async ensureStarted(): Promise<void> {
    if (this.client.getState() !== "connected") {
      await this.client.start();
    }
  }

  /** List all models available to the Copilot CLI. */
  async listModels(): Promise<ModelInfo[]> {
    await this.ensureStarted();
    return this.client.listModels();
  }

  async createSession(model?: string, workingDirectory?: string, customAgents?: Array<{name: string; displayName?: string; description?: string; prompt: string}>, skillDirectories?: string[]): Promise<void> {
    this.session = await this.client.createSession({
      ...(model ? { model } : {}),
      streaming: true,
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(customAgents?.length ? { customAgents } : {}),
      ...(skillDirectories?.length ? { skillDirectories } : {}),
      // No availableTools/excludedTools — all tools accessible
      // No disabledSkills — all skills accessible
      enableConfigDiscovery: true,
      infiniteSessions: { enabled: true },
      systemMessage: { mode: "append", content: DEMO_SYSTEM_INSTRUCTIONS },
      onPermissionRequest: async (request: PermissionRequest) => {
        if (this.autoApprove) return { kind: "approved" as const };
        // Ask the frontend for approval
        const requestId = `perm-${++this.permissionCounter}`;
        this.emit("permission_request", {
          requestId,
          permissionKind: request.kind,
          details: request,
        });
        return new Promise((resolve) => {
          this.pendingPermissions.set(requestId, (approved: boolean) => {
            resolve(approved
              ? { kind: "approved" as const }
              : { kind: "denied-interactively-by-user" as const }
            );
          });
        });
      },
      onUserInputRequest: async (request) => {
        console.log("[Bridge] onUserInputRequest:", JSON.stringify(request).substring(0, 200));
        const requestId = `uir-${++this.inputCounter}`;
        const bridgeReq: UserInputBridgeRequest = {
          requestId,
          message: request.question,
          choices: request.choices,
        };
        this.emit("user_input", bridgeReq);

        return new Promise((resolve) => {
          this.pendingInputs.set(requestId, (values: Record<string, string>) => {
            resolve({
              answer: values.response || values.answer || Object.values(values)[0] || "",
              wasFreeform: !request.choices?.length,
            });
          });
        });
      },
      onElicitationRequest: async (context: ElicitationContext): Promise<ElicitationResult> => {
        console.log("[Bridge] onElicitationRequest:", JSON.stringify(context).substring(0, 200));
        const requestId = `elicit-${++this.inputCounter}`;
        const bridgeReq: UserInputBridgeRequest = {
          requestId,
          message: context.message,
          schema: context.requestedSchema as Record<string, unknown> | undefined,
        };
        this.emit("user_input", bridgeReq);

        return new Promise((resolve) => {
          this.pendingInputs.set(requestId, (values: Record<string, string>) => {
            if (!values || Object.keys(values).length === 0) {
              resolve({ action: "cancel" });
            } else {
              resolve({ action: "accept", content: values });
            }
          });
        });
      },
      hooks: {
        onPreToolUse: (input) => {
          this.emit("tool_start", {
            toolName: input.toolName,
            toolArgs: input.toolArgs,
          });
          // Track MCP tools by matching name prefix against known server names
          for (const srv of this.mcpServerNames) {
            if (input.toolName.startsWith(srv + "-") || input.toolName.startsWith(srv + "_")) {
              if (!this.discoveredMcpTools[srv]) this.discoveredMcpTools[srv] = [];
              if (!this.discoveredMcpTools[srv].includes(input.toolName)) {
                this.discoveredMcpTools[srv].push(input.toolName);
                this.emit("mcp_tools_discovered", { serverName: srv, tools: this.discoveredMcpTools[srv] });
              }
              break;
            }
          }
          // Detect sub-agent launch via the "task" tool
          if (input.toolName === "task") {
            const args = typeof input.toolArgs === "string"
              ? (() => { try { return JSON.parse(input.toolArgs); } catch { return {}; } })()
              : (input.toolArgs || {});
            const agentName = args.name || args.agent_type || "sub-agent";
            // Tab title = humanized agent name; description goes as subtitle
            const humanName = (args.name || "").replace(/[-_]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
            const agentDisplayName = humanName || args.agent_type || "Sub-agent";
            const agentDescription = args.description || "";
            this.activeTaskAgents.push({ agentName, agentDisplayName });
            this.emit("subagent_start", { agentName, agentDisplayName, agentType: args.agent_type, agentDescription });
          }
        },
        onPostToolUse: (input) => {
          this.emit("tool_complete", {
            toolName: input.toolName,
            toolResult: input.toolResult,
          });
          // Detect sub-agent completion — pop from stack and include result
          if (input.toolName === "task") {
            const entry = this.activeTaskAgents.pop();
            const resultStr = typeof input.toolResult === "string"
              ? input.toolResult
              : (input.toolResult ? JSON.stringify(input.toolResult) : "");
            // Track background agent ID for routing read_agent results later
            try {
              const parsed = typeof input.toolResult === "string" ? JSON.parse(input.toolResult) : input.toolResult;
              if (parsed?.toolTelemetry?.properties?.execution_mode === "background") {
                const agentId = parsed.toolTelemetry?.restrictedProperties?.agent_id;
                if (agentId && entry) {
                  this.backgroundAgentMap.set(agentId, entry.agentName);
                }
              }
            } catch {}
            this.emit("subagent_complete", {
              agentName: entry?.agentName || "sub-agent",
              result: resultStr,
            });
          }
          // Detect read_agent — route output to the matching background agent tab
          if (input.toolName === "read_agent") {
            const args = typeof input.toolArgs === "string"
              ? (() => { try { return JSON.parse(input.toolArgs); } catch { return {}; } })()
              : (input.toolArgs || {});
            const agentId = args.agent_id;
            const agentName = agentId ? this.backgroundAgentMap.get(agentId) : undefined;
            if (agentName) {
              const resultStr = typeof input.toolResult === "string"
                ? input.toolResult
                : (input.toolResult ? JSON.stringify(input.toolResult) : "");
              this.emit("subagent_output", { agentName, agentId, result: resultStr });
            }
          }
        },
      },
      onEvent: (event: SessionEvent) => this._handleSessionEvent(event),
    });
  }

  private _handleSessionEvent(event: SessionEvent): void {
    // Log all events for debugging
    console.log(`[Event] ${event.type}`, event.data ? JSON.stringify(event.data).substring(0, 120) : "");
    switch (event.type) {
      case "assistant.message_delta":
        if (event.data && "deltaContent" in event.data) {
          const d = event.data as any;
          this.emit("delta", d.deltaContent, d.parentToolCallId);
        }
        break;
      case "assistant.message":
        if (event.data && "content" in event.data) {
          this.emit("message", (event.data as any).content);
        }
        break;
      case "assistant.intent":
        if (event.data && "intent" in event.data) {
          this.emit("intent", (event.data as any).intent);
        }
        break;
      case "session.idle":
        this.emit("idle");
        break;
      case "session.error":
        if (event.data && "message" in event.data) {
          this.emit("error", (event.data as any).message);
        }
        break;
      // tool.execution_start/complete handled by hooks for top-level,
      // but sub-agent tool events come through events with parentToolCallId
      case "tool.execution_start":
        if (event.data && "parentToolCallId" in event.data) {
          const d = event.data as any;
          this.emit("tool_start", {
            toolName: d.toolName,
            toolArgs: d.arguments,
            parentToolCallId: d.parentToolCallId,
          });
        }
        break;
      case "tool.execution_complete":
        if (event.data && "parentToolCallId" in event.data) {
          const d = event.data as any;
          this.emit("tool_complete", {
            toolName: d.toolName,
            toolCallId: d.toolCallId,
            parentToolCallId: d.parentToolCallId,
          });
        }
        break;
      case "tool.execution_partial_result":
        if (event.data) {
          const d = event.data as any;
          this.emit("tool_partial", {
            toolCallId: d.toolCallId,
            partialOutput: d.partialOutput,
          });
        }
        break;
      case "tool.execution_progress":
        if (event.data) {
          const d = event.data as any;
          this.emit("tool_progress", {
            toolCallId: d.toolCallId,
            progressMessage: d.progressMessage,
          });
        }
        break;
      case "session.workspace_file_changed":
        if (event.data) {
          const d = event.data as any;
          this.emit("file_changed", {
            path: d.path,
            operation: d.operation,
          });
        }
        break;
      case "subagent.started":
        this.emit("subagent_start", {
          agentName: (event.data as any).agentName,
          agentDisplayName: (event.data as any).agentDisplayName,
        });
        break;
      case "subagent.completed":
        this.emit("subagent_complete", {
          agentName: (event.data as any).agentName,
          agentDisplayName: (event.data as any).agentDisplayName,
        });
        break;
      case "session.task_complete":
        this.emit("task_complete", {
          summary: (event.data as any).summary,
        });
        break;
      case "session.skills_loaded":
        this.emit("capabilities_loaded", {
          kind: "skills",
          items: (event.data as any).skills,
        });
        break;
      case "session.custom_agents_updated":
        this.emit("capabilities_loaded", {
          kind: "agents",
          items: (event.data as any).agents,
          warnings: (event.data as any).warnings,
          errors: (event.data as any).errors,
        });
        break;
      case "session.mcp_servers_loaded":
        this.emit("capabilities_loaded", {
          kind: "mcp_servers",
          items: (event.data as any).servers,
        });
        break;
      case "session.extensions_loaded":
        this.emit("capabilities_loaded", {
          kind: "extensions",
          items: (event.data as any).extensions,
        });
        break;
      case "session.mcp_server_status_changed": {
        const sd = event.data as any;
        this.emit("mcp_status", {
          serverName: sd.serverName,
          status: sd.status,
        });
        break;
      }
    }
  }

  async setModel(model: string): Promise<void> {
    if (!this.session) throw new Error("Session not created");
    await this.session.setModel(model);
  }

  async listAgents(): Promise<any[]> {
    if (!this.session) return [];
    const result = await this.session.rpc.agent.list();
    return result.agents;
  }

  async selectAgent(name: string): Promise<any> {
    if (!this.session) throw new Error("Session not created");
    return this.session.rpc.agent.select({ name });
  }

  async deselectAgent(): Promise<void> {
    if (!this.session) throw new Error("Session not created");
    await this.session.rpc.agent.deselect();
  }

  async listSkills(): Promise<any[]> {
    if (!this.session) return [];
    const result = await this.session.rpc.skills.list();
    return result.skills;
  }

  async enableSkill(name: string): Promise<void> {
    if (!this.session) throw new Error("Session not created");
    await this.session.rpc.skills.enable({ name });
  }

  async disableSkill(name: string): Promise<void> {
    if (!this.session) throw new Error("Session not created");
    await this.session.rpc.skills.disable({ name });
  }

  async enableAllSkills(): Promise<void> {
    if (!this.session) return;
    const result = await this.session.rpc.skills.list();
    console.log(`[Skills] SDK reports ${result.skills.length} skills: ${result.skills.map((s: any) => `${s.name}(${s.enabled ? 'on' : 'OFF'})`).join(', ')}`);
    // Force-enable every skill, even those already enabled
    for (const skill of result.skills) {
      try {
        await this.session.rpc.skills.enable({ name: skill.name });
      } catch (err) {
        console.warn(`[Skills] Failed to enable ${skill.name}:`, err);
      }
    }
    console.log(`[Skills] Enabled all ${result.skills.length} SDK skills`);
  }

  async listMcpServers(): Promise<any[]> {
    if (!this.session) return [];
    const result = await this.session.rpc.mcp.list();
    this.mcpServerNames = result.servers.map((s: any) => s.name);
    return result.servers;
  }

  async enableMcpServer(name: string): Promise<void> {
    if (!this.session) throw new Error("Session not created");
    await this.session.rpc.mcp.enable({ serverName: name });
  }

  async disableMcpServer(name: string): Promise<void> {
    if (!this.session) throw new Error("Session not created");
    await this.session.rpc.mcp.disable({ serverName: name });
  }

  async listTools(model?: string): Promise<any[]> {
    await this.ensureStarted();
    const result = await this.client.rpc.tools.list({ model });
    return result.tools;
  }

  async getMode(): Promise<string> {
    if (!this.session) return "interactive";
    const result = await this.session.rpc.mode.get();
    return result.mode;
  }

  async setMode(mode: string): Promise<string> {
    if (!this.session) throw new Error("Session not created");
    const result = await this.session.rpc.mode.set({ mode: mode as any });
    return result.mode;
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.session) throw new Error("Session not created");
    // Use send() instead of sendAndWait() — sub-agent tasks can run
    // for a very long time. Events (deltas, idle) are handled by the
    // event listener registered in createSession().
    await this.session.send({ prompt });
  }

  resolveUserInput(
    requestId: string,
    values: Record<string, string>
  ): void {
    const resolver = this.pendingInputs.get(requestId);
    if (resolver) {
      this.pendingInputs.delete(requestId);
      resolver(values);
    }
  }

  resolvePermission(requestId: string, approved: boolean): void {
    const resolver = this.pendingPermissions.get(requestId);
    if (resolver) {
      this.pendingPermissions.delete(requestId);
      resolver(approved);
    }
  }

  async abort(): Promise<void> {
    if (this.session) {
      await this.session.abort();
    }
  }

  async stop(): Promise<void> {
    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }
    this.backgroundAgentMap.clear();
    await this.client.stop();
  }
}
