import { test, expect } from "@playwright/test";

async function openDemoGod(page) {
  const res = await page.request.get("/");
  const html = await res.text();
  const token = html.match(/name="dg-token"\s+content="([^"]+)"/)?.[1] || "";
  await page.goto("/?token=" + token);
  await page.waitForSelector("#splash.fade-out", { timeout: 15000 });
  await page.waitForTimeout(2000);
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 30000 });
}

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 1920, height: 1080 } },
});

test("Demo: Borealis Theme, Doc Review & Security Audit", async ({ page }) => {
  await openDemoGod(page);

  // Open settings and select the Aurora Borealis theme
  await page.click("#btn-settings");
  await page.waitForTimeout(1500);
  await page.selectOption("#setting-bg", "bg-aurora");
  await page.waitForTimeout(2000);
  await page.click("#settings-close");
  await page.waitForTimeout(2000);

  // Open project picker and select "insyourance"
  await page.click("#btn-project");
  await page.waitForTimeout(1500);
  await page.locator(".picker-list .picker-item", { hasText: "insyourance" }).click();
  await page.waitForTimeout(2000);
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 30000 });
  await page.waitForTimeout(2000);

  // Ask Copilot to review the documentation
  await page.fill(".session-input", "Review the documentation in this project. Check for completeness, accuracy, and suggest improvements.");
  await page.waitForTimeout(1500);
  await page.press(".session-input", "Enter");
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 120000 });
  await page.waitForTimeout(3000);

  // Add a new session tab
  await page.click("#btn-add-session");
  await page.waitForTimeout(2000);
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 30000 });
  await page.waitForTimeout(1500);

  // Open project picker and select "insyourance" in the new tab
  await page.click("#btn-project");
  await page.waitForTimeout(1500);
  await page.locator(".picker-list .picker-item", { hasText: "insyourance" }).click();
  await page.waitForTimeout(2000);
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 30000 });
  await page.waitForTimeout(1500);

  // Switch model to GPT-4.1
  await page.click("#btn-model");
  await page.waitForTimeout(1500);
  await page.fill("#cappicker-search", "4.1");
  await page.waitForTimeout(1000);
  await page.locator(".cappicker-item", { hasText: "gpt-4.1" }).first().click();
  await page.waitForTimeout(2000);

  // Ask for a security review
  await page.fill(".session-input", "Perform a security review of this project. Look for vulnerabilities, insecure patterns, and recommend fixes.");
  await page.waitForTimeout(1500);
  await page.press(".session-input", "Enter");
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 120000 });
  await page.waitForTimeout(3000);

  // Switch from tabs to floating layout
  await page.click("#btn-layout");
  await page.waitForTimeout(10000);
});
