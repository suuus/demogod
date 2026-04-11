import { test, expect } from "@playwright/test";

test.describe("DemoGod", () => {
  test("seed", async ({ page }) => {
    // Navigate to DemoGod — the token is embedded in the page
    const res = await page.request.get("/");
    const html = await res.text();
    const match = html.match(/name="dg-token"\s+content="([^"]+)"/);
    const token = match?.[1] || "";

    await page.goto(`/?token=${token}`);

    // Wait for splash screen to finish
    await page.waitForSelector("#splash.fade-out", { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Wait for session to be ready
    await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 30000 });
  });
});
