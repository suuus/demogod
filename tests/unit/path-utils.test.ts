import { describe, it, expect } from "vitest";
import { safeRealpath, isUnderHome } from "../../src/path-utils.js";
import { homedir } from "os";

describe("path-utils", () => {
  describe("safeRealpath", () => {
    it("resolves an existing directory", () => {
      const result = safeRealpath(homedir());
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("returns null for a nonexistent path", () => {
      expect(safeRealpath("/nonexistent/path/abc123")).toBeNull();
    });

    it("resolves relative paths", () => {
      const result = safeRealpath(".");
      expect(result).toBeTruthy();
      expect(result).not.toBe(".");
    });
  });

  describe("isUnderHome", () => {
    const home = homedir();

    it("returns true for the home directory itself", () => {
      expect(isUnderHome(home)).toBe(true);
    });

    it("returns true for a subdirectory of home", () => {
      expect(isUnderHome(home + "/Documents")).toBe(true);
    });

    it("returns true for a subdirectory using platform separator", () => {
      const { sep } = require("path");
      expect(isUnderHome(home + sep + "Documents")).toBe(true);
    });

    it("returns false for /etc", () => {
      expect(isUnderHome("/etc")).toBe(false);
    });

    it("returns false for /tmp", () => {
      expect(isUnderHome("/tmp")).toBe(false);
    });

    it("returns false for a path that starts with home but is a sibling", () => {
      // e.g., /Users/suzanne-evil when home is /Users/suzanne
      expect(isUnderHome(home + "-evil")).toBe(false);
    });

    it("returns false for Windows-style paths outside home", () => {
      expect(isUnderHome("C:\\Windows\\System32")).toBe(false);
    });
  });
});
