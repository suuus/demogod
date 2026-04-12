import { test, expect } from "@playwright/test";

// ─── Shared helpers for demo specs ──────────────────────────────────────────

/** Open DemoGod with auth token, wait for splash + session ready. */
async function openDemoGod(page) {
  const res = await page.request.get("/");
  const html = await res.text();
  const token = html.match(/name="dg-token"\s+content="([^"]+)"/)?.[1] || "";
  await page.goto("/?token=" + token);
  await page.waitForSelector("#splash.fade-out", { timeout: 15000 });
  await page.waitForTimeout(2000);
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 30000 });
}

/** Wait for the active session to show "Ready" status. */
async function waitForReady(page) {
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 60000 });
  await page.waitForTimeout(1000);
}

/** Type a prompt into the active session's input and press Enter. */
async function typePrompt(page, text) {
  const input = page.locator(".session-active .session-input");
  await input.waitFor({ state: "visible", timeout: 30000 });
  await input.click();
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
}

/** Wait for Copilot to finish responding (status returns to "Ready"). */
async function waitForResponse(page, timeoutMs = 180000) {
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: timeoutMs });
  await page.waitForTimeout(2000);
}

// ─── Video recording config ─────────────────────────────────────────────────

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 1920, height: 1080 } },
});

// ─── Seed test (verifies DemoGod loads) ─────────────────────────────────────

test("demo-seed", async ({ page }) => {
  await openDemoGod(page);
});
