import { describe, it, expect } from "vitest";
import { getDefaultShell, ALLOWED_SHELLS } from "../../src/pty-server.js";

describe("pty-server", () => {
  describe("getDefaultShell", () => {
    it("returns a non-empty string", () => {
      const shell = getDefaultShell();
      expect(shell).toBeTruthy();
      expect(typeof shell).toBe("string");
    });

    it("returns a shell that is in ALLOWED_SHELLS", () => {
      expect(ALLOWED_SHELLS.has(getDefaultShell())).toBe(true);
    });
  });

  describe("ALLOWED_SHELLS", () => {
    it("is a non-empty Set", () => {
      expect(ALLOWED_SHELLS).toBeInstanceOf(Set);
      expect(ALLOWED_SHELLS.size).toBeGreaterThan(0);
    });

    it("contains common Unix shells", () => {
      expect(ALLOWED_SHELLS.has("/bin/bash")).toBe(true);
      expect(ALLOWED_SHELLS.has("/bin/zsh")).toBe(true);
      expect(ALLOWED_SHELLS.has("/bin/sh")).toBe(true);
    });

    it("does not contain arbitrary paths", () => {
      expect(ALLOWED_SHELLS.has("/tmp/evil")).toBe(false);
      expect(ALLOWED_SHELLS.has("")).toBe(false);
    });
  });

  describe("setupPtyServer", () => {
    it("is exported as a function", async () => {
      const mod = await import("../../src/pty-server.js");
      expect(typeof mod.setupPtyServer).toBe("function");
    });
  });
});
