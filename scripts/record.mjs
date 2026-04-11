#!/usr/bin/env node
/**
 * Record a DemoGod session as an MP4 video using Playwright.
 *
 * Usage:
 *   npm run record                  # Interactive — opens browser, you control it
 *   npm run record -- --demo intro  # Automated — plays a demo script, saves video
 *   npm run record -- --headless    # Headless mode (automated demos only)
 *
 * The server must be running (`npm run dev` or `npm start`) before recording.
 * Video is saved to ~/Desktop/copilot-demo-{timestamp}.mp4
 */

import { chromium } from "playwright";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { rename } from "fs/promises";

const args = process.argv.slice(2);
const headless = args.includes("--headless");
const demoIdx = args.indexOf("--demo");
const demoName = demoIdx >= 0 ? args[demoIdx + 1] : null;
const port = process.env.PORT || "3456";

// Get the token from the running server
const serverUrl = `http://localhost:${port}`;
let token = "";
try {
  const res = await fetch(serverUrl);
  const html = await res.text();
  const match = html.match(/name="dg-token"\s+content="([^"]+)"/);
  token = match?.[1] || "";
} catch {
  console.error("❌ Cannot reach DemoGod server at", serverUrl);
  console.error("   Start it first with: npm run dev");
  process.exit(1);
}

if (!token) {
  console.error("❌ Could not extract session token from server");
  process.exit(1);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const videoDir = join(homedir(), "Desktop");
const videoName = `copilot-demo-${ts}.webm`;
const tmpDir = join(homedir(), ".demogod", "recordings");

console.log("🎬 Starting Playwright recorder...");
console.log(`   Server: ${serverUrl}`);
console.log(`   Mode: ${demoName ? `demo "${demoName}"` : "interactive"}`);
console.log(`   Output: ${join(videoDir, videoName)}`);

const browser = await chromium.launch({
  headless,
  args: ["--no-sandbox"],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: {
    dir: tmpDir,
    size: { width: 1280, height: 720 },
  },
});

const page = await context.newPage();
await page.goto(`${serverUrl}/?token=${token}`);

// Wait for splash screen to fade
await page.waitForSelector("#splash.fade-out", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);

if (demoName) {
  // Automated mode: trigger the demo via the mode button
  console.log(`▶ Playing demo: ${demoName}`);

  // Click mode button to open demo picker, then select the demo
  await page.click("#btn-mode");
  await page.waitForTimeout(500);

  // Find and click the demo in the picker
  const demoItem = page.locator(`[data-cap-id="${demoName}"]`);
  if (await demoItem.count() > 0) {
    await demoItem.click();
  } else {
    console.log(`   Demo "${demoName}" not found in picker, trying direct WS...`);
    // Fall back to sending WS message via page evaluate
    await page.evaluate((name) => {
      const session = document.querySelector(".session-container")?.__session;
      if (session) session.send("start_demo", { demo: name });
    }, demoName);
  }

  // Wait for demo to complete
  await page.waitForSelector(".status-text", { timeout: 5000 }).catch(() => {});
  console.log("   Waiting for demo to finish...");

  // Poll for "Ready" status indicating demo is done
  await page.waitForFunction(
    () => document.querySelector(".status-text")?.textContent === "Ready",
    { timeout: 120000 }
  ).catch(() => {
    console.log("   Demo didn't finish within 2 minutes, saving anyway...");
  });

  await page.waitForTimeout(2000); // Brief pause after completion
} else {
  // Interactive mode: wait for user to close the browser
  console.log("🎥 Recording... Close the browser window when done.");
  await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
}

// Close and save
await context.close();
await browser.close();

// Move the video to Desktop with a nice name
// Playwright saves as .webm — convert to .mp4 using Playwright's bundled ffmpeg
const { readdirSync, statSync } = await import("fs");

const files = readdirSync(tmpDir).filter((f) => f.endsWith(".webm"));
if (files.length > 0) {
  const latest = files
    .map((f) => ({ name: f, time: statSync(join(tmpDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0];

  const src = join(tmpDir, latest.name);
  const dest = join(videoDir, videoName);
  await rename(src, dest);
  console.log(`\n✅ Video saved: ${dest}`);
  if (existsSync("/usr/local/bin/ffmpeg") || existsSync("/opt/homebrew/bin/ffmpeg")) {
    console.log(`   Convert to MP4: ffmpeg -i "${dest}" -c:v libx264 "${dest.replace(".webm", ".mp4")}"`);
  }
} else {
  console.log("\n⚠️  No video file found — recording may have been too short.");
}
