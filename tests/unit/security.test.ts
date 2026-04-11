import { describe, it, expect } from "vitest";
import { resolve } from "path";

// ── Security: Demo name sanitization ────────────────────────
function safeDemoPath(name: string, demosDir: string): string | null {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeName || safeName !== name) return null;
  const resolved = resolve(demosDir, `${safeName}.json`);
  if (!resolved.startsWith(demosDir)) return null;
  return resolved;
}

describe("safeDemoPath", () => {
  const DEMOS_DIR = "/project/demos";

  it("accepts valid demo names", () => {
    expect(safeDemoPath("intro", DEMOS_DIR)).toBe("/project/demos/intro.json");
    expect(safeDemoPath("my-demo", DEMOS_DIR)).toBe("/project/demos/my-demo.json");
    expect(safeDemoPath("demo_v2", DEMOS_DIR)).toBe("/project/demos/demo_v2.json");
  });

  it("rejects path traversal attempts", () => {
    expect(safeDemoPath("../../../etc/passwd", DEMOS_DIR)).toBeNull();
    expect(safeDemoPath("../../secret", DEMOS_DIR)).toBeNull();
    expect(safeDemoPath("foo/../bar", DEMOS_DIR)).toBeNull();
  });

  it("rejects names with special characters", () => {
    expect(safeDemoPath("demo;rm -rf /", DEMOS_DIR)).toBeNull();
    expect(safeDemoPath("demo name", DEMOS_DIR)).toBeNull();
    expect(safeDemoPath("demo.json", DEMOS_DIR)).toBeNull();
    expect(safeDemoPath("demo/nested", DEMOS_DIR)).toBeNull();
  });

  it("rejects empty names", () => {
    expect(safeDemoPath("", DEMOS_DIR)).toBeNull();
  });
});

// ── Security: Origin validation ─────────────────────────────
function isValidOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

describe("origin validation", () => {
  it("accepts localhost origins", () => {
    expect(isValidOrigin("http://localhost:3456")).toBe(true);
    expect(isValidOrigin("http://127.0.0.1:3456")).toBe(true);
    expect(isValidOrigin("http://localhost")).toBe(true);
  });

  it("accepts missing origin (non-browser clients)", () => {
    expect(isValidOrigin(undefined)).toBe(true);
  });

  it("rejects non-localhost origins", () => {
    expect(isValidOrigin("http://evil.com")).toBe(false);
    expect(isValidOrigin("http://evil.localhost.attacker.com")).toBe(false);
    expect(isValidOrigin("http://192.168.1.1:3456")).toBe(false);
  });

  it("rejects malformed origins", () => {
    expect(isValidOrigin("not-a-url")).toBe(false);
  });
});

// ── Security: File path restriction ─────────────────────────
function isPathUnderHome(requestedPath: string, home: string): boolean {
  const resolved = resolve(requestedPath);
  return resolved.startsWith(home);
}

describe("file path restriction", () => {
  const HOME = "/Users/testuser";

  it("accepts paths under home", () => {
    expect(isPathUnderHome("/Users/testuser/projects", HOME)).toBe(true);
    expect(isPathUnderHome("/Users/testuser/.copilot", HOME)).toBe(true);
  });

  it("rejects paths outside home", () => {
    expect(isPathUnderHome("/etc/passwd", HOME)).toBe(false);
    expect(isPathUnderHome("/tmp/evil", HOME)).toBe(false);
    expect(isPathUnderHome("/Users/otheruser/secrets", HOME)).toBe(false);
  });

  it("rejects traversal attempts", () => {
    expect(isPathUnderHome("/Users/testuser/../../etc/passwd", HOME)).toBe(false);
  });
});

// ── Token generation ────────────────────────────────────────
describe("session token", () => {
  it("generates a 64-char hex token", () => {
    const { randomBytes } = require("crypto");
    const token = randomBytes(32).toString("hex");
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("generates unique tokens", () => {
    const { randomBytes } = require("crypto");
    const t1 = randomBytes(32).toString("hex");
    const t2 = randomBytes(32).toString("hex");
    expect(t1).not.toBe(t2);
  });
});
