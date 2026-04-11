import { test, expect } from "@playwright/test";

/** Navigate to the app and extract the dg-token from the page meta tag */
async function loadPageAndGetToken(page: any): Promise<string> {
  // First fetch the HTML to get the token
  const res = await page.request.get("/");
  const html = await res.text();
  const match = html.match(/name="dg-token"\s+content="([^"]+)"/);
  if (!match) throw new Error("dg-token meta tag not found in HTML");
  const token = match[1];
  // Navigate to page so WebSocket runs from localhost origin
  await page.goto(`/?token=${token}`);
  return token;
}

test.describe("WebSocket protocol", () => {
  test("connection with valid token succeeds", async ({ page }) => {
    const token = await loadPageAndGetToken(page);

    const connected = await page.evaluate(async (tok: string) => {
      return new Promise<boolean>((resolve) => {
        const ws = new WebSocket(
          `ws://localhost:3456/?token=${tok}`,
        );
        ws.onopen = () => {
          ws.close();
          resolve(true);
        };
        ws.onerror = () => resolve(false);
        ws.onclose = (e: CloseEvent) => {
          if (!e.wasClean) resolve(false);
        };
        setTimeout(() => resolve(false), 10000);
      });
    }, token);

    expect(connected).toBe(true);
  });

  test("connection with invalid token is rejected", async ({ page }) => {
    await loadPageAndGetToken(page);

    const result = await page.evaluate(async () => {
      return new Promise<{ opened: boolean; closeCode?: number }>((resolve) => {
        const ws = new WebSocket(
          `ws://localhost:3456/?token=invalid_token_000000000000000000000000000000000000`,
        );
        ws.onopen = () => {
          ws.close();
          resolve({ opened: true });
        };
        ws.onclose = (e: CloseEvent) => {
          resolve({ opened: false, closeCode: e.code });
        };
        ws.onerror = () => {
          // onerror fires before onclose for rejected connections
        };
        setTimeout(() => resolve({ opened: false }), 10000);
      });
    });

    expect(result.opened).toBe(false);
  });

  test("send create_session, receive session_ready", async ({ page }) => {
    const token = await loadPageAndGetToken(page);

    const result = await page.evaluate(async (tok: string) => {
      return new Promise<{
        type?: string;
        workingDirectory?: string;
        model?: string;
        error?: string;
      }>((resolve) => {
        const ws = new WebSocket(
          `ws://localhost:3456/?token=${tok}`,
        );
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "create_session" }));
        };
        ws.onmessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "session_ready") {
              ws.close();
              resolve(msg);
            } else if (msg.type === "error") {
              ws.close();
              resolve({ type: "error", error: msg.text });
            }
          } catch {}
        };
        ws.onerror = () => resolve({ error: "connection error" });
        setTimeout(() => {
          ws.close();
          resolve({ error: "timeout" });
        }, 60000);
      });
    }, token);

    expect(result.type).toBe("session_ready");
    expect(result.model).toBeDefined();
    expect(typeof result.model).toBe("string");
  });

  test("send list_capabilities after session_ready, receive capabilities_list", async ({
    page,
  }) => {
    const token = await loadPageAndGetToken(page);

    const result = await page.evaluate(async (tok: string) => {
      return new Promise<{
        type?: string;
        mcpServers?: any[];
        skills?: any[];
        tools?: any[];
        error?: string;
      }>((resolve) => {
        const ws = new WebSocket(
          `ws://localhost:3456/?token=${tok}`,
        );
        let sessionReady = false;
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "create_session" }));
        };
        ws.onmessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "session_ready" && !sessionReady) {
              sessionReady = true;
              ws.send(JSON.stringify({ type: "list_capabilities" }));
            } else if (msg.type === "capabilities_list") {
              ws.close();
              resolve(msg);
            } else if (msg.type === "error") {
              ws.close();
              resolve({ type: "error", error: msg.text });
            }
          } catch {}
        };
        ws.onerror = () => resolve({ error: "connection error" });
        setTimeout(() => {
          ws.close();
          resolve({ error: "timeout" });
        }, 60000);
      });
    }, token);

    expect(result.type).toBe("capabilities_list");
    expect(Array.isArray(result.mcpServers)).toBe(true);
    expect(Array.isArray(result.skills)).toBe(true);
    expect(Array.isArray(result.tools)).toBe(true);
  });
});
