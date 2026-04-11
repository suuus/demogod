import { defineConfig } from "@playwright/test";
import { join } from "path";
import { homedir } from "os";

export default defineConfig({
  testDir: ".",
  testMatch: ["seed.spec.ts", "tests/showcase*.spec.ts"],
  timeout: 180000,
  use: {
    baseURL: "http://localhost:3456",
    viewport: { width: 1280, height: 720 },
    video: "on",
    trace: "on-first-retry",
  },
  outputDir: join(homedir(), "Desktop", "demogod-recordings"),
  webServer: {
    command: "npx tsx src/server.ts",
    port: 3456,
    reuseExistingServer: true,
    timeout: 30000,
  },
  reporter: [["html", { open: "never" }]],
});
