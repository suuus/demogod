/**
 * Prompt templates for Demo Plan Mode.
 * Used to instruct Copilot to generate demo scripts or Playwright specs.
 */

const DEMOGOD_UI_REFERENCE = `## DemoGod UI Reference

DemoGod is a browser-based tool for demoing GitHub Copilot CLI at http://localhost:3456.

### Control Bar Buttons (top, left to right)
| Button | ID | Purpose |
|--------|----|---------|
| 📁 Project | #btn-project | Open project picker |
| ⌨️ Mode | #btn-mode | Open demo picker |
| 📄 Open | #btn-browse-file | Open file browser |
| 🧪 Model | #btn-model | Select AI model |
| 🤖 Agent | #btn-agent | Select agent |
| ⚡ Skill | #btn-skill | Invoke skill |
| 🎯 Copilot Mode | #btn-copilot-mode | Cycle Interactive/Plan/Autopilot |
| 📑 Layout | #btn-layout | Toggle Tabs/Floating |
| ⊞ Tile | #btn-tile | Tile floating windows |
| 🎬 Studio | #btn-studio | Demo Studio panel |
| ⚙️ Settings | #btn-settings | Settings panel |
| 🔌 Capabilities | #btn-capabilities | MCP/tools/skills panel |

### Key Selectors
- Session input: \`.session-input\` (contenteditable span)
- Status text: \`.status-text\`
- Session tab bar: \`.session-tab-bar\`
- Add session: \`#btn-add-session\`
- Settings close: \`#settings-close\`
- Background theme dropdown: \`#setting-bg\` (values: bg-chroma, bg-copilot, bg-copilot-light, bg-aurora, bg-offwhite, bg-darkblue, bg-white)
- Picker filter: \`#cappicker-search\`
- Picker items: \`.cappicker-item\`
- Picker cancel: \`#cappicker-cancel\`
- Splash screen: \`#splash\` (fades out on load)
`;

export const DEMO_JSON_SCHEMA = `
## DemoGod Demo Script Schema

A demo script is a JSON file with this structure:

\`\`\`json
{
  "title": "Demo Title",
  "description": "What this demo shows",
  "steps": [
    // Step types below
  ]
}
\`\`\`

### Step Types

**"command"** — Scripted Q&A (no real Copilot call):
\`\`\`json
{"type": "command", "text": "User prompt", "response": "Pre-written response (markdown OK)", "typingSpeed": 45}
\`\`\`

**"live"** — Real Copilot prompt (waits for actual response):
\`\`\`json
{"type": "live", "text": "User prompt sent to Copilot", "typingSpeed": 40, "pauseAfter": 3000}
\`\`\`

**"question"** — Dialog with form fields + pre-filled answer:
\`\`\`json
{
  "type": "question",
  "text": "User prompt that triggers the question",
  "question": {
    "message": "Which option?",
    "schema": {"properties": {"choice": {"type": "string", "enum": ["A", "B", "C"]}}, "required": ["choice"]}
  },
  "answer": {"choice": "B"},
  "response": "Response shown after the dialog",
  "typingSpeed": 40
}
\`\`\`

**"action"** — UI automation (no prompt):
\`\`\`json
{"type": "action", "action": "layout|tile|model|open_file|new_session", "value": "parameter", "pauseAfter": 2000}
\`\`\`
- \`layout\`: value = "floating" or "tabs"
- \`tile\`: no value needed
- \`model\`: value = model ID string
- \`open_file\`: value = file path
- \`new_session\`: no value needed
`;

export const SELF_DEMO_PROMPT = `You are generating a DemoGod demo script that showcases DemoGod itself.

${DEMO_JSON_SCHEMA}

${DEMOGOD_UI_REFERENCE}

## Instructions

Based on the user's description, generate a complete demo JSON script. Use:
- "command" steps for scripted Q&A where you control the response
- "live" steps when the demo should show real Copilot responses
- "action" steps for UI automation (layout changes, model switching, tiling)
- "question" steps to showcase the dialog/form system

Keep typing speeds between 35-50ms. Add pauseAfter (1500-3000ms) between steps for readability.

IMPORTANT: Output the JSON as a code block in your response. Do NOT use file creation tools to write the file — the user will save it via the UI. Respond with ONLY the JSON code block, no explanation before or after.
`;

export const SELF_PLAYWRIGHT_PROMPT = `You are generating a Playwright test spec that creates a browser-driven demo recording of DemoGod itself.

${DEMOGOD_UI_REFERENCE}

## Playwright Spec Template

\`\`\`typescript
import { test, expect } from "@playwright/test";

// Helper: open DemoGod with auth token
async function openDemoGod(page) {
  const res = await page.request.get("/");
  const html = await res.text();
  const token = html.match(/name="dg-token"\\s+content="([^"]+)"/)?.[1] || "";
  await page.goto("/?token=" + token);
  await page.waitForSelector("#splash.fade-out", { timeout: 15000 });
  await page.waitForTimeout(2000);
  await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 30000 });
}

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 1920, height: 1080 } },
});

test("Demo: [TITLE]", async ({ page }) => {
  await openDemoGod(page);
  // ... steps here
});
\`\`\`

## Instructions

Based on the user's description, generate a Playwright spec that drives DemoGod's UI. Use the real selectors from the reference above. Key patterns:

- **Open settings:** \`await page.click("#btn-settings");\`
- **Select a theme:** \`await page.selectOption("#setting-bg", "bg-aurora");\` then close with \`await page.click("#settings-close");\`
- **Open project picker:** \`await page.click("#btn-project");\` → wait for \`.picker-item\` to appear → click the folder → click \`#picker-select\` to confirm
- **Type a prompt:** Use \`keyboard.type()\` not \`fill()\` for contenteditable inputs. Target the **active** session:
  \`\`\`
  const input = page.locator(".session-active .session-input");
  await input.waitFor({ state: "visible", timeout: 30000 });
  await input.click();
  await page.keyboard.type("prompt text", { delay: 30 });
  await page.keyboard.press("Enter");
  \`\`\`
- **Wait for response:** \`await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 180000 });\`
- **After project select or new session:** Always wait for Ready — the session reinitializes:
  \`await expect(page.locator(".status-text")).toHaveText("Ready", { timeout: 60000 });\`
- **Switch model:** \`await page.click("#btn-model");\` → wait for \`.cappicker-item\` → optionally filter with \`await page.fill("#cappicker-search", "gpt");\` → click the desired \`.cappicker-item\` (clicking an item auto-selects and closes the picker)
- **Select agent:** \`await page.click("#btn-agent");\` → wait for \`.cappicker-item\` → click one (auto-selects and closes)
- **Switch layout:** \`await page.click("#btn-layout");\`
- **Add session:** \`await page.click("#btn-add-session");\`
- **Pause for visibility:** \`await page.waitForTimeout(2000);\`

**Picker behavior:** When the user says "select X" and the picker shows items, click the matching \`.cappicker-item\` directly — this selects and closes the picker in one click. If filtering leaves only one item, click it directly. Always wait for \`await page.locator(".cappicker-item").first().waitFor()\` before clicking.

Add \`waitForTimeout(1500-3000)\` between steps so the recording looks natural.

IMPORTANT: Output the spec as a code block in your response. Do NOT use file creation tools to write the file — the user will save it via the UI. Respond with ONLY the TypeScript code block, no explanation before or after.
`;

export const PROJECT_DEMO_PROMPT = `You are generating a Playwright test spec that creates a browser-driven demo recording of a web application.

## Instructions

1. First, explore the target project in the current working directory:
   - Read package.json, config files, and route definitions
   - Identify the app's base URL, key pages, and interactive elements
   - Find real CSS selectors, button text, form fields

2. Then generate a Playwright spec based on the user's description.

## Playwright Spec Template

\`\`\`typescript
import { test, expect } from "@playwright/test";

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 1920, height: 1080 } },
});

test("Demo: [TITLE]", async ({ page }) => {
  // Navigate to the app
  await page.goto("[BASE_URL]");

  // Step 1: [description]
  await page.click("[selector]");
  await page.waitForTimeout(1500); // pause for visibility

  // Step 2: [description]
  await page.fill("[selector]", "text");
  await page.waitForTimeout(1000);

  // ... more steps
});
\`\`\`

## Guidelines

- Use real selectors from the project (inspect the HTML/JSX/Vue templates)
- Add \`waitForTimeout(1000-2000)\` between actions so the recording looks natural
- Use \`waitForSelector\` before interacting with dynamic content
- Add descriptive comments for each step
- Keep the demo focused — 10-20 actions max

IMPORTANT: Output the spec as a code block in your response. Do NOT use file creation tools to write the file — the user will save it via the UI. Respond with ONLY the TypeScript code block, no explanation before or after.
`;
