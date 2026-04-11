import { describe, it, expect, vi } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter, Readable, Writable } from "stream";

// ── Re-implement queryMcpServerTools for isolated testing ────────────────────
// Mirrors the logic in server.ts without importing the whole server.

interface McpToolInfo {
  name: string;
  description: string;
}

function queryMcpServerTools(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<McpToolInfo[]> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let buffer = "";
    let phase: "init" | "tools" | "done" = "init";
    const tools: McpToolInfo[] = [];
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(tools);
    }, 8000);

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (phase === "init" && msg.result) {
            phase = "tools";
            proc.stdin!.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/list",
                params: {},
              }) + "\n",
            );
          } else if (phase === "tools" && msg.result?.tools) {
            for (const t of msg.result.tools) {
              tools.push({ name: t.name, description: t.description || "" });
            }
            phase = "done";
            clearTimeout(timeout);
            proc.kill();
            resolve(tools);
          }
        } catch {}
      }
    });
    proc.on("error", () => {
      clearTimeout(timeout);
      resolve(tools);
    });
    proc.on("exit", () => {
      clearTimeout(timeout);
      resolve(tools);
    });

    proc.stdin!.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "demogod", version: "0.0.8" },
        },
      }) + "\n",
    );
  });
}

// ── Hardcoded github-mcp-server tool list (mirrors server.ts) ────────────────
function getGithubMcpServerTools(): McpToolInfo[] {
  return [
    { name: "get_file_contents", description: "Get file/directory contents from a GitHub repo" },
    { name: "list_commits", description: "List commits in a repository" },
    { name: "get_commit", description: "Get details for a specific commit" },
    { name: "list_branches", description: "List branches in a repository" },
    { name: "search_code", description: "Search code across GitHub repositories" },
    { name: "search_repositories", description: "Search for GitHub repositories" },
    { name: "search_users", description: "Search for GitHub users" },
    { name: "list_issues", description: "List issues in a repository" },
    { name: "issue_read", description: "Get issue details, comments, sub-issues, or labels" },
    { name: "search_issues", description: "Search for issues across repositories" },
    { name: "list_pull_requests", description: "List pull requests in a repository" },
    { name: "pull_request_read", description: "Get PR details, diff, status, files, or reviews" },
    { name: "search_pull_requests", description: "Search for pull requests" },
    { name: "actions_list", description: "List workflows, runs, jobs, or artifacts" },
    { name: "actions_get", description: "Get workflow, run, job, or artifact details" },
    { name: "get_job_logs", description: "Get logs for workflow jobs" },
    { name: "list_copilot_spaces", description: "List accessible Copilot Spaces" },
    { name: "get_copilot_space", description: "Get content from a Copilot Space" },
  ];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("queryMcpServerTools", () => {
  it("returns empty array when process times out (no response)", async () => {
    // Use 'cat' which reads stdin forever and produces no stdout
    const tools = await queryMcpServerTools("cat", []);
    expect(tools).toEqual([]);
  }, 15000);

  it("returns empty array when command does not exist", async () => {
    const tools = await queryMcpServerTools(
      "__nonexistent_binary_12345__",
      [],
    );
    expect(tools).toEqual([]);
  });

  it("returns empty array when process exits immediately with no output", async () => {
    const tools = await queryMcpServerTools("true", []);
    expect(tools).toEqual([]);
  });

  it("returns empty array when process outputs non-JSON", async () => {
    const tools = await queryMcpServerTools("echo", ["not json at all"]);
    expect(tools).toEqual([]);
  });

  it("parses tools from a well-formed JSON-RPC exchange", async () => {
    // Simulate a minimal MCP server using a shell script via node -e
    const script = `
      process.stdin.setEncoding("utf-8");
      let buf = "";
      process.stdin.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }) + "\\n");
          } else if (msg.method === "tools/list") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0", id: msg.id,
              result: { tools: [
                { name: "test_tool", description: "A test tool" },
                { name: "another_tool", description: "Another tool" }
              ]}
            }) + "\\n");
          }
        }
      });
    `;
    const tools = await queryMcpServerTools("node", ["-e", script]);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({ name: "test_tool", description: "A test tool" });
    expect(tools[1]).toEqual({
      name: "another_tool",
      description: "Another tool",
    });
  }, 15000);

  it("returns tools collected before timeout when tools/list never responds", async () => {
    // Server responds to initialize but ignores tools/list
    const script = `
      process.stdin.setEncoding("utf-8");
      let buf = "";
      process.stdin.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }) + "\\n");
          }
          // tools/list is deliberately ignored — should trigger timeout
        }
      });
    `;
    const tools = await queryMcpServerTools("node", ["-e", script]);
    // Timeout returns whatever was collected (empty in this case)
    expect(tools).toEqual([]);
  }, 15000);
});

describe("github-mcp-server hardcoded tools", () => {
  const tools = getGithubMcpServerTools();
  const toolNames = tools.map((t) => t.name);

  it("contains expected core tools", () => {
    const expected = [
      "get_file_contents",
      "search_code",
      "list_issues",
      "list_pull_requests",
      "search_repositories",
      "list_commits",
      "get_commit",
      "list_branches",
      "search_users",
      "issue_read",
      "search_issues",
      "pull_request_read",
      "search_pull_requests",
      "actions_list",
      "actions_get",
      "get_job_logs",
      "list_copilot_spaces",
      "get_copilot_space",
    ];
    for (const name of expected) {
      expect(toolNames).toContain(name);
    }
  });

  it("has 18 tools total", () => {
    expect(tools).toHaveLength(18);
  });

  it("every tool has a non-empty name and description", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate tool names", () => {
    const unique = new Set(toolNames);
    expect(unique.size).toBe(tools.length);
  });
});
