import { describe, it, expect, vi, beforeEach } from "vitest";

// We can't import CopilotBridge directly because it depends on @github/copilot-sdk
// which requires auth. Instead, we test the exported class by mocking the SDK.
vi.mock("@github/copilot-sdk", () => {
  class MockCopilotClient {
    _state = "disconnected";
    getState() { return this._state; }
    async start() { this._state = "connected"; }
    async stop() { this._state = "disconnected"; }
    async listModels() {
      return [
        { id: "gpt-4o", name: "GPT-4o" },
        { id: "claude-sonnet", name: "Claude Sonnet" },
      ];
    }
    async createSession(opts: any) {
      return {
        _opts: opts,
        send: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        setModel: vi.fn().mockResolvedValue(undefined),
        rpc: {
          agent: {
            list: vi.fn().mockResolvedValue({ agents: [{ name: "explore", description: "Explorer" }] }),
            select: vi.fn().mockResolvedValue({ name: "explore" }),
            deselect: vi.fn().mockResolvedValue(undefined),
          },
          skills: {
            list: vi.fn().mockResolvedValue({ skills: [{ name: "web-search", enabled: true }] }),
            enable: vi.fn().mockResolvedValue(undefined),
            disable: vi.fn().mockResolvedValue(undefined),
          },
          mcp: {
            list: vi.fn().mockResolvedValue({ servers: [{ name: "github-mcp-server", status: "connected" }] }),
            enable: vi.fn().mockResolvedValue(undefined),
            disable: vi.fn().mockResolvedValue(undefined),
          },
          tools: {
            list: vi.fn().mockResolvedValue({ tools: [{ name: "bash", description: "Run bash" }] }),
          },
          mode: {
            get: vi.fn().mockResolvedValue({ mode: "interactive" }),
            set: vi.fn().mockResolvedValue({ mode: "agent" }),
          },
        },
      };
    }
    rpc = {
      tools: {
        list: vi.fn().mockResolvedValue({ tools: [{ name: "bash" }] }),
      },
    };
  }
  return {
    CopilotClient: MockCopilotClient,
    CopilotSession: class {},
  };
});

import { CopilotBridge } from "../../src/copilot-bridge.js";

describe("CopilotBridge", () => {
  let bridge: CopilotBridge;

  beforeEach(() => {
    bridge = new CopilotBridge();
  });

  describe("constructor", () => {
    it("creates a bridge with autoApprove enabled", () => {
      expect(bridge.autoApprove).toBe(true);
    });

    it("initializes empty discoveredMcpTools", () => {
      expect(bridge.discoveredMcpTools).toEqual({});
    });
  });

  describe("ensureStarted", () => {
    it("starts the client if not connected", async () => {
      await bridge.ensureStarted();
      // No error thrown means success
    });
  });

  describe("listModels", () => {
    it("returns available models", async () => {
      const models = await bridge.listModels();
      expect(models).toHaveLength(2);
      expect(models[0]).toHaveProperty("id", "gpt-4o");
    });
  });

  describe("createSession", () => {
    it("creates a session without throwing", async () => {
      await expect(bridge.createSession()).resolves.toBeUndefined();
    });

    it("creates a session with model and working directory", async () => {
      await expect(bridge.createSession("gpt-4o", "/tmp")).resolves.toBeUndefined();
    });
  });

  describe("session operations (after createSession)", () => {
    beforeEach(async () => {
      await bridge.createSession();
    });

    it("sendPrompt sends to the session", async () => {
      await expect(bridge.sendPrompt("hello")).resolves.toBeUndefined();
    });

    it("sendPrompt throws if no session", async () => {
      await bridge.stop();
      await expect(bridge.sendPrompt("hello")).rejects.toThrow("Session not created");
    });

    it("setModel delegates to session", async () => {
      await expect(bridge.setModel("claude-sonnet")).resolves.toBeUndefined();
    });

    it("listAgents returns agents array", async () => {
      const agents = await bridge.listAgents();
      expect(agents).toEqual([{ name: "explore", description: "Explorer" }]);
    });

    it("listSkills returns skills array", async () => {
      const skills = await bridge.listSkills();
      expect(skills).toEqual([{ name: "web-search", enabled: true }]);
    });

    it("listMcpServers returns servers and tracks names", async () => {
      const servers = await bridge.listMcpServers();
      expect(servers).toEqual([{ name: "github-mcp-server", status: "connected" }]);
    });

    it("getMode returns current mode", async () => {
      const mode = await bridge.getMode();
      expect(mode).toBe("interactive");
    });

    it("setMode changes mode", async () => {
      const mode = await bridge.setMode("agent");
      expect(mode).toBe("agent");
    });

    it("abort doesn't throw", async () => {
      await expect(bridge.abort()).resolves.toBeUndefined();
    });
  });

  describe("resolveUserInput", () => {
    it("resolves a pending input request", () => {
      const resolver = vi.fn();
      // Access private map for testing
      (bridge as any).pendingInputs.set("uir-1", resolver);

      bridge.resolveUserInput("uir-1", { response: "yes" });
      expect(resolver).toHaveBeenCalledWith({ response: "yes" });
      expect((bridge as any).pendingInputs.has("uir-1")).toBe(false);
    });

    it("does nothing for unknown requestId", () => {
      // Should not throw
      bridge.resolveUserInput("unknown-id", { response: "yes" });
    });
  });

  describe("resolvePermission", () => {
    it("resolves a pending permission", () => {
      const resolver = vi.fn();
      (bridge as any).pendingPermissions.set("perm-1", resolver);

      bridge.resolvePermission("perm-1", true);
      expect(resolver).toHaveBeenCalledWith(true);
      expect((bridge as any).pendingPermissions.has("perm-1")).toBe(false);
    });

    it("handles denial", () => {
      const resolver = vi.fn();
      (bridge as any).pendingPermissions.set("perm-2", resolver);

      bridge.resolvePermission("perm-2", false);
      expect(resolver).toHaveBeenCalledWith(false);
    });
  });

  describe("event translation (_handleSessionEvent)", () => {
    it("emits delta for assistant.message_delta", () => {
      const handler = vi.fn();
      bridge.on("delta", handler);

      (bridge as any)._handleSessionEvent({
        type: "assistant.message_delta",
        data: { deltaContent: "hello ", parentToolCallId: undefined },
      });

      expect(handler).toHaveBeenCalledWith("hello ", undefined);
    });

    it("emits message for assistant.message", () => {
      const handler = vi.fn();
      bridge.on("message", handler);

      (bridge as any)._handleSessionEvent({
        type: "assistant.message",
        data: { content: "Hello world" },
      });

      expect(handler).toHaveBeenCalledWith("Hello world");
    });

    it("emits intent for assistant.intent", () => {
      const handler = vi.fn();
      bridge.on("intent", handler);

      (bridge as any)._handleSessionEvent({
        type: "assistant.intent",
        data: { intent: "Exploring codebase" },
      });

      expect(handler).toHaveBeenCalledWith("Exploring codebase");
    });

    it("emits idle for session.idle", () => {
      const handler = vi.fn();
      bridge.on("idle", handler);

      (bridge as any)._handleSessionEvent({ type: "session.idle", data: null });

      expect(handler).toHaveBeenCalled();
    });

    it("emits error for session.error", () => {
      const handler = vi.fn();
      bridge.on("error", handler);

      (bridge as any)._handleSessionEvent({
        type: "session.error",
        data: { message: "Something went wrong" },
      });

      expect(handler).toHaveBeenCalledWith("Something went wrong");
    });

    it("emits file_changed for workspace file events", () => {
      const handler = vi.fn();
      bridge.on("file_changed", handler);

      (bridge as any)._handleSessionEvent({
        type: "session.workspace_file_changed",
        data: { path: "/foo/bar.ts", operation: "create" },
      });

      expect(handler).toHaveBeenCalledWith({ path: "/foo/bar.ts", operation: "create" });
    });

    it("emits task_complete for session.task_complete", () => {
      const handler = vi.fn();
      bridge.on("task_complete", handler);

      (bridge as any)._handleSessionEvent({
        type: "session.task_complete",
        data: { summary: "All done" },
      });

      expect(handler).toHaveBeenCalledWith({ summary: "All done" });
    });

    it("emits capabilities_loaded for skills", () => {
      const handler = vi.fn();
      bridge.on("capabilities_loaded", handler);

      (bridge as any)._handleSessionEvent({
        type: "session.skills_loaded",
        data: { skills: [{ name: "web-search" }] },
      });

      expect(handler).toHaveBeenCalledWith({
        kind: "skills",
        items: [{ name: "web-search" }],
      });
    });

    it("emits mcp_status for server status changes", () => {
      const handler = vi.fn();
      bridge.on("mcp_status", handler);

      (bridge as any)._handleSessionEvent({
        type: "session.mcp_server_status_changed",
        data: { serverName: "github-mcp-server", status: "connected" },
      });

      expect(handler).toHaveBeenCalledWith({
        serverName: "github-mcp-server",
        status: "connected",
      });
    });

    it("emits tool_partial for partial results", () => {
      const handler = vi.fn();
      bridge.on("tool_partial", handler);

      (bridge as any)._handleSessionEvent({
        type: "tool.execution_partial_result",
        data: { toolCallId: "tc-1", partialOutput: "partial..." },
      });

      expect(handler).toHaveBeenCalledWith({
        toolCallId: "tc-1",
        partialOutput: "partial...",
      });
    });

    it("ignores unknown event types without error", () => {
      expect(() => {
        (bridge as any)._handleSessionEvent({
          type: "unknown.event.type",
          data: {},
        });
      }).not.toThrow();
    });
  });

  describe("stop", () => {
    it("clears backgroundAgentMap on stop", async () => {
      (bridge as any).backgroundAgentMap.set("agent-1", "test-agent");
      await bridge.stop();
      expect((bridge as any).backgroundAgentMap.size).toBe(0);
    });

    it("handles stop when no session exists", async () => {
      await expect(bridge.stop()).resolves.toBeUndefined();
    });
  });

  describe("listMcpServers with no session", () => {
    it("listMcpServers returns empty array", async () => {
      expect(await bridge.listMcpServers()).toEqual([]);
    });
  });

  describe("tool exclusion", () => {
    it("excludedTools starts empty", () => {
      expect(bridge.excludedTools.size).toBe(0);
    });

    it("can add and remove excluded tools", () => {
      bridge.excludedTools.add("bash");
      expect(bridge.excludedTools.has("bash")).toBe(true);
      bridge.excludedTools.delete("bash");
      expect(bridge.excludedTools.has("bash")).toBe(false);
    });

    it("excludedTools are passed to createSession config", async () => {
      bridge.excludedTools.add("github-mcp-server-list_issues");
      bridge.excludedTools.add("bash");
      await bridge.createSession();
      // The mock stores the config — verify excludedTools was passed
      const session = (bridge as any).session;
      const opts = session._opts;
      expect(opts.excludedTools).toEqual(expect.arrayContaining(["github-mcp-server-list_issues", "bash"]));
      expect(opts.excludedTools).toHaveLength(2);
    });

    it("onPreToolUse hook denies excluded tools", async () => {
      await bridge.createSession();
      bridge.excludedTools.add("github-mcp-server-list_issues");

      // Access the hooks from the session config
      const session = (bridge as any).session;
      const hooks = session._opts.hooks;
      const result = hooks.onPreToolUse({ toolName: "github-mcp-server-list_issues", toolArgs: {} });
      expect(result).toEqual({
        permissionDecision: "deny",
        permissionDecisionReason: "Tool excluded by user",
      });
    });

    it("onPreToolUse hook allows non-excluded tools", async () => {
      await bridge.createSession();
      bridge.excludedTools.add("bash");

      const session = (bridge as any).session;
      const hooks = session._opts.hooks;

      const handler = vi.fn();
      bridge.on("tool_start", handler);

      const result = hooks.onPreToolUse({ toolName: "grep", toolArgs: {} });
      expect(result).toBeUndefined();
      expect(handler).toHaveBeenCalledWith({ toolName: "grep", toolArgs: {} });
    });

    it("excluding then re-enabling a tool works", async () => {
      await bridge.createSession();
      bridge.excludedTools.add("bash");
      const session = (bridge as any).session;
      const hooks = session._opts.hooks;

      // Denied
      let result = hooks.onPreToolUse({ toolName: "bash", toolArgs: {} });
      expect(result?.permissionDecision).toBe("deny");

      // Re-enable
      bridge.excludedTools.delete("bash");
      result = hooks.onPreToolUse({ toolName: "bash", toolArgs: {} });
      expect(result).toBeUndefined(); // allowed
    });

    it("excluding multiple tools blocks all of them", async () => {
      await bridge.createSession();
      bridge.excludedTools.add("bash");
      bridge.excludedTools.add("grep");
      bridge.excludedTools.add("github-mcp-server-list_issues");
      const hooks = (bridge as any).session._opts.hooks;

      expect(hooks.onPreToolUse({ toolName: "bash", toolArgs: {} })?.permissionDecision).toBe("deny");
      expect(hooks.onPreToolUse({ toolName: "grep", toolArgs: {} })?.permissionDecision).toBe("deny");
      expect(hooks.onPreToolUse({ toolName: "github-mcp-server-list_issues", toolArgs: {} })?.permissionDecision).toBe("deny");
      // Other tools still allowed
      expect(hooks.onPreToolUse({ toolName: "view", toolArgs: {} })).toBeUndefined();
    });

    it("excluded tool does not emit tool_start", async () => {
      await bridge.createSession();
      bridge.excludedTools.add("bash");
      const handler = vi.fn();
      bridge.on("tool_start", handler);

      const hooks = (bridge as any).session._opts.hooks;
      hooks.onPreToolUse({ toolName: "bash", toolArgs: {} });
      expect(handler).not.toHaveBeenCalled();
    });

    it("empty excludedTools allows everything", async () => {
      await bridge.createSession();
      expect(bridge.excludedTools.size).toBe(0);
      const hooks = (bridge as any).session._opts.hooks;

      expect(hooks.onPreToolUse({ toolName: "bash", toolArgs: {} })).toBeUndefined();
      expect(hooks.onPreToolUse({ toolName: "github-mcp-server-list_issues", toolArgs: {} })).toBeUndefined();
      expect(hooks.onPreToolUse({ toolName: "task", toolArgs: "{}" })).toBeUndefined();
    });

    it("excludedTools persists across multiple tool calls", async () => {
      await bridge.createSession();
      bridge.excludedTools.add("bash");
      const hooks = (bridge as any).session._opts.hooks;

      // Denied repeatedly — the set isn't consumed
      for (let i = 0; i < 5; i++) {
        expect(hooks.onPreToolUse({ toolName: "bash", toolArgs: {} })?.permissionDecision).toBe("deny");
      }
      expect(bridge.excludedTools.has("bash")).toBe(true);
    });

    it("excludedTools with no session created doesn't affect createSession", async () => {
      bridge.excludedTools.add("bash");
      await bridge.createSession();
      const opts = (bridge as any).session._opts;
      expect(opts.excludedTools).toEqual(["bash"]);
    });
  });

  describe("resolveUserInput edge cases", () => {
    it("calling resolveUserInput twice with same ID only resolves once", () => {
      const resolver = vi.fn();
      (bridge as any).pendingInputs.set("uir-1", resolver);

      bridge.resolveUserInput("uir-1", { response: "yes" });
      bridge.resolveUserInput("uir-1", { response: "no" });
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver).toHaveBeenCalledWith({ response: "yes" });
    });

    it("resolvePermission with unknown ID is a no-op", () => {
      expect(() => bridge.resolvePermission("nonexistent", true)).not.toThrow();
    });
  });

  describe("event edge cases", () => {
    it("handles session.error with missing data gracefully", () => {
      expect(() => {
        (bridge as any)._handleSessionEvent({ type: "session.error", data: null });
      }).not.toThrow();
    });

    it("handles assistant.message_delta with missing data gracefully", () => {
      expect(() => {
        (bridge as any)._handleSessionEvent({ type: "assistant.message_delta", data: null });
      }).not.toThrow();
    });

    it("delta with parentToolCallId is forwarded", () => {
      const handler = vi.fn();
      bridge.on("delta", handler);

      (bridge as any)._handleSessionEvent({
        type: "assistant.message_delta",
        data: { deltaContent: "sub-agent output", parentToolCallId: "tc-42" },
      });

      expect(handler).toHaveBeenCalledWith("sub-agent output", "tc-42");
    });
  });
});
