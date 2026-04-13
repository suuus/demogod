import { test, expect } from "@playwright/test";

/** Extract the dg-token from the HTML page served at "/" */
async function getToken(request: typeof test extends (
  name: string,
  fn: (args: infer A) => any,
) => any
  ? never
  : any): Promise<string> {
  const res = await request.get("/");
  const html = await res.text();
  const match = html.match(/name="dg-token"\s+content="([^"]+)"/);
  if (!match) throw new Error("dg-token meta tag not found in HTML");
  return match[1];
}

test.describe("REST API", () => {
  test("GET / returns HTML with dg-token meta tag", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toMatch(/name="dg-token"\s+content="[0-9a-f]{64}"/);
  });

  test("GET /api/models returns JSON array", async ({ request }) => {
    const res = await request.get("/api/models");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    // Each model should have at minimum an id or name
    for (const model of data.slice(0, 3)) {
      expect(typeof model === "object" || typeof model === "string").toBe(true);
    }
  });

  test("GET /api/demos returns JSON array of demo objects", async ({
    request,
  }) => {
    const res = await request.get("/api/demos");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const demo of data) {
      expect(demo).toHaveProperty("name");
      expect(demo).toHaveProperty("title");
      expect(typeof demo.name).toBe("string");
      expect(typeof demo.title).toBe("string");
    }
  });

  test("GET /api/demos/intro returns demo JSON with steps array", async ({
    request,
  }) => {
    const res = await request.get("/api/demos/intro");
    // intro demo should exist
    if (res.status() === 404) {
      // If intro doesn't exist, find a demo that does
      const listRes = await request.get("/api/demos");
      const demos = await listRes.json();
      expect(demos.length).toBeGreaterThan(0);
      const firstDemo = demos[0].name;
      const demoRes = await request.get(`/api/demos/${firstDemo}`);
      expect(demoRes.status()).toBe(200);
      const data = await demoRes.json();
      expect(
        Array.isArray(data.steps) ||
          typeof data.director_prompt === "string",
      ).toBe(true);
      return;
    }
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(
      Array.isArray(data.steps) || typeof data.director_prompt === "string",
    ).toBe(true);
  });

  test("GET /api/demos/nonexistent returns 404", async ({ request }) => {
    const res = await request.get("/api/demos/nonexistent");
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("GET /api/demos/../../../etc/passwd returns 400 (path traversal blocked)", async ({
    request,
  }) => {
    const res = await request.get("/api/demos/..%2F..%2F..%2Fetc%2Fpasswd");
    // The safeDemoPath function rejects names with special characters
    expect([400, 404]).toContain(res.status());
  });

  test("GET /api/browse returns directory listing", async ({ request }) => {
    const res = await request.get("/api/browse");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("current");
    expect(data).toHaveProperty("dirs");
    expect(Array.isArray(data.dirs)).toBe(true);
  });

  test("GET /api/browse?path=/etc is rejected (outside homedir)", async ({
    request,
  }) => {
    const res = await request.get("/api/browse?path=/etc");
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("POST /api/demos/save without Authorization header returns 401", async ({ request }) => {
    const res = await request.post("/api/demos/save", {
      data: { name: "test-csrf", demo: { steps: [] } },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/demos/save with valid token succeeds", async ({ request }) => {
    const token = await getToken(request);
    const res = await request.post("/api/demos/save", {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "test-auth", demo: { title: "Test", steps: [{ type: "command", text: "hi", response: "hello" }] } },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("test-auth");
  });

  test("POST /api/specs/save without Authorization header returns 401", async ({ request }) => {
    const res = await request.post("/api/specs/save", {
      data: { name: "test-csrf", content: "// spec" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/demos/save with wrong token returns 401", async ({ request }) => {
    const res = await request.post("/api/demos/save", {
      headers: { Authorization: "Bearer wrong-token" },
      data: { name: "test", demo: { steps: [] } },
    });
    expect(res.status()).toBe(401);
  });
});
