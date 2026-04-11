// spec: specs/demogod-showcase.md
// seed: seed.spec.ts
import { test, expect } from "@playwright/test";

// Helper: open DemoGod with token
async function openDemoGod(page) {
  const res = await page.request.get("/");
  const html = await res.text();
  const token = html.match(/name="dg-token"\s+content="([^"]+)"/)?.[1] || "";
  await page.goto(`/?token=${token}`);
  await page.waitForSelector("#splash.fade-out", { timeout: 15000 });
  await page.waitForTimeout(2000);
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 30000 });
}

test("DemoGod UI Showcase", async ({ page }) => {
  await openDemoGod(page);

  // === 1.1 Filter Claude models ===
  await page.click("#btn-model");
  await expect(page.locator("#cappicker-search")).toBeVisible();
  await expect(page.locator(".cappicker-item").first()).toBeVisible({ timeout: 10000 });
  await page.fill("#cappicker-search", "claude");
  await page.waitForTimeout(2000);
  await page.click("#cappicker-cancel");
  await expect(page.locator("#cappicker-overlay")).toHaveClass(/hidden/);

  // === 1.2 Select GPT-4.1 ===
  await page.click("#btn-model");
  await expect(page.locator("#cappicker-search")).toBeVisible();
  await expect(page.locator(".cappicker-item").first()).toBeVisible({ timeout: 10000 });
  await page.fill("#cappicker-search", "gpt");
  await page.waitForTimeout(2000);
  const items = page.locator(".cappicker-item");
  const count = await items.count();
  await items.nth(count - 1).click();
  await expect(page.locator("#cappicker-overlay")).toHaveClass(/hidden/);
  await expect(page.locator("#model-label")).not.toHaveText("Model");

  // === 2. Browse agent picker ===
  await page.click("#btn-agent");
  await expect(page.locator("#cappicker-search")).toBeVisible();
  await expect(page.locator(".cappicker-item").first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);
  await page.click("#cappicker-cancel");
  await expect(page.locator("#cappicker-overlay")).toHaveClass(/hidden/);

  // === 3. Cycle Copilot modes ===
  await page.click("#btn-copilot-mode");
  await expect(page.locator("#copilot-mode-label")).toHaveText("Plan");
  await page.waitForTimeout(2000);

  await page.click("#btn-copilot-mode");
  await expect(page.locator("#copilot-mode-label")).toHaveText("Autopilot");
  await page.waitForTimeout(2000);

  await page.click("#btn-copilot-mode");
  await expect(page.locator("#copilot-mode-label")).toHaveText("Interactive");

  // === 4. Open capabilities panel ===
  await page.click("#btn-capabilities");
  await expect(page.locator("#capabilities-overlay")).not.toHaveClass(/hidden/);
  await page.waitForTimeout(3000);
  await page.click("#capabilities-close");
  await expect(page.locator("#capabilities-overlay")).toHaveClass(/hidden/);

  // === 5. Browse skills ===
  await page.click("#btn-skill");
  await expect(page.locator("#cappicker-search")).toBeVisible();
  await page.waitForTimeout(2000);
  await page.click("#cappicker-cancel");
  await expect(page.locator("#cappicker-overlay")).toHaveClass(/hidden/);

  // === 6. Send a prompt ===
  await page.locator(".input-line").click();
  await page.keyboard.type("What can you help me with today?", { delay: 40 });
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 60000 });

  // === 7. Multi-session with floating layout ===
  await page.keyboard.press("Control+t");
  await page.waitForTimeout(1000);
  await page.keyboard.press("Control+t");
  await page.waitForTimeout(2000);
  await expect(page.locator(".session-tab")).toHaveCount(3);

  await page.click("#btn-layout");
  await page.waitForTimeout(3000);

  await page.click("#btn-layout");
  await page.waitForTimeout(1000);

  await page.keyboard.press("Control+w");
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+w");
  await page.waitForTimeout(500);
  await expect(page.locator(".session-tab")).toHaveCount(1);
});
