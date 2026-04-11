import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const DEMOS_DIR = resolve(__dirname, "../../demos");

describe("demo scripts", () => {
  const demoFiles = readdirSync(DEMOS_DIR).filter(f => f.endsWith(".json"));

  it("has at least one demo script", () => {
    expect(demoFiles.length).toBeGreaterThan(0);
  });

  for (const file of demoFiles) {
    describe(file, () => {
      const content = JSON.parse(readFileSync(join(DEMOS_DIR, file), "utf-8"));

      it("is valid JSON with expected structure", () => {
        expect(content).toBeDefined();
        // Must have either steps array or director_prompt
        const hasSteps = Array.isArray(content.steps);
        const hasDirectorPrompt = typeof content.director_prompt === "string";
        expect(hasSteps || hasDirectorPrompt).toBe(true);
      });

      if (Array.isArray(content.steps)) {
        it("has valid step types", () => {
          const validTypes = ["command", "question", "live", "action"];
          for (const step of content.steps) {
            if (step.type) {
              expect(validTypes).toContain(step.type);
            }
          }
        });

        it("command steps have text and response", () => {
          for (const step of content.steps) {
            if (step.type === "command") {
              expect(step.text).toBeDefined();
              expect(step.response).toBeDefined();
            }
          }
        });

        it("live steps have text", () => {
          for (const step of content.steps) {
            if (step.type === "live") {
              expect(step.text).toBeDefined();
            }
          }
        });

        it("action steps have action field", () => {
          for (const step of content.steps) {
            if (step.type === "action") {
              expect(step.action).toBeDefined();
            }
          }
        });
      }
    });
  }
});
