import { defineConfig } from "@playwright/test";
import { join } from "path";
import { homedir } from "os";

export default defineConfig({
  testDir: ".",
  testMatch: ["seed.spec.ts", "tests/showcase*.spec.ts", "tests/e2e/*.spec.ts"],
  timeout: 180000,
  use: {
    baseURL: "http://localhost:3456",
    viewport: { width: 1920, height: 1080 },
    video: { mode: "on", size: { width: 1920, height: 1080 } },
    trace: "on-first-retry",
  },
  outputDir: join(homedir(), ".demogod", "test-results"),
  webServer: {
    command: "npx tsx src/server.ts",
    port: 3456,
    reuseExistingServer: true,
    timeout: 30000,
  },
  reporter: [["html", { open: "never" }]],
});
