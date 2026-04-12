/**
 * Prompt templates for Demo Plan Mode.
 * Used to instruct Copilot to generate demo scripts or Playwright specs.
 */

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

## DemoGod UI Reference

DemoGod is a browser-based tool for demoing GitHub Copilot CLI. The UI has:
- **Control bar** at top: Project (📁), Mode (⌨️), Open File (📄), Model (🧪), Agent (🤖), Skill (⚡), Copilot Mode, Layout (📑/🪟), Settings (⚙️), Capabilities (🔌)
- **Terminal window** with session tabs, chat output area, and input field at bottom
- **Floating window mode** with grid snapping and tiling
- **Settings panel** with appearance themes (Chroma Green, Aurora Borealis, etc.)
- **Capabilities panel** showing MCP servers, tools, skills

## Instructions

Based on the user's description, generate a complete demo JSON script. Use:
- "command" steps for scripted Q&A where you control the response
- "live" steps when the demo should show real Copilot responses
- "action" steps for UI automation (layout changes, model switching, tiling)
- "question" steps to showcase the dialog/form system

Keep typing speeds between 35-50ms. Add pauseAfter (1500-3000ms) between steps for readability.
Output ONLY the JSON — no explanation before or after.
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
- Output ONLY the TypeScript spec — no explanation before or after.
`;
