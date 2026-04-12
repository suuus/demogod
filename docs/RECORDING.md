# Recording

DemoGod supports recording demos via the browser's built-in screen capture API and via Playwright-based automated recording.

## Browser Recording

Click the **⏺** button in the bottom-right corner to start recording the browser tab.

- **Chrome / Edge / Safari**: saves as `.mp4` (MediaRecorder with `video/mp4` MIME type)
- **Firefox**: saves as `.webm`
- Output is downloaded to your default download location (typically `~/Desktop/` or `~/Downloads/`)

## Playwright Recording

The `scripts/record.mjs` script uses Playwright to record DemoGod in a Chromium browser.

```bash
# Interactive — opens a browser window, records until you close it
npm run record

# Automated — plays a named demo headlessly and records it
npm run record:demo intro
```

### How It Works

1. Connects to the running DemoGod server at `localhost:3456`
2. Extracts the `dg-token` from the HTML meta tag
3. Launches Chromium (1280×720 viewport) with video recording enabled
4. In interactive mode: waits for you to close the browser
5. In automated mode (`--demo`): clicks the demo button, selects the demo, waits for completion
6. Saves the recording to `~/.demogod/recordings/` as `.webm`
7. Copies the final video to `~/Desktop/copilot-demo-{timestamp}.webm`
8. Prints an `ffmpeg` command for converting to MP4

> **Tip**: Pass `--headless` for automated headless recording (no visible browser window).

## Showcase Test Video

The showcase test also produces video recordings:

```bash
npm run test:showcase
```

Videos are saved to `~/.demogod/test-results` (configured in `playwright.config.ts`).

## AI-Assisted Demo Creation (Playwright Agents)

The fastest way to create a polished demo recording. Three agents chain together to plan, generate, and fix a Playwright spec — then you record it.

### Prerequisites

- DemoGod running: `npm run dev`
- Copilot CLI with agent access

### Step 1: Plan

Ask the planner agent to explore DemoGod's live UI and create a test plan:

```
@playwright-test-planner Create a test plan for a DemoGod demo.
The app is at http://localhost:3456.
Use tests/demo-seed.spec.ts as the seed file.
The demo should: Open settings, pick the Aurora Borealis theme, close settings.
Open the project picker, select "my-project". Ask Copilot to review the docs.
Add a second session tab, switch to GPT-4.1, ask for a security review.
Switch to floating layout and wait 10 seconds.
Save the plan to specs/my-demo.md.
```

The planner **opens a real browser**, takes screenshots, reads the DOM, and produces a plan with verified selectors.

### Step 2: Generate

Ask the generator to turn the plan into a runnable spec:

```
@playwright-test-generator Generate the test from specs/my-demo.md.
Save to tests/generated/my-demo.spec.ts.
```

The generator **executes each step live** in a browser to verify selectors and timing work.

### Step 3: Heal (if needed)

If the spec fails, the healer debugs it:

```
@playwright-test-healer Fix tests/generated/my-demo.spec.ts
```

The healer runs the spec, pauses on failure, inspects the DOM, and fixes selectors or timing.

### Step 4: Record

```bash
npm run test:generated
```

This runs all specs in `tests/generated/` headed with video recording. Videos are saved to `~/.demogod/test-results/`.

### Seed File

`tests/demo-seed.spec.ts` provides shared helpers that the planner and generator use:

| Helper | Purpose |
|--------|---------|
| `openDemoGod(page)` | Auth + navigate + wait for splash + "Ready" |
| `waitForReady(page)` | Wait for status to show "Ready" (after project select, new session) |
| `typePrompt(page, text)` | Click active session input, type with delay, press Enter |
| `waitForResponse(page)` | Wait for Copilot to finish (status returns to "Ready") |

### Alternative: Demo Studio

You can also use the **🎬 Demo Studio** panel in DemoGod's UI to describe a demo and have Copilot generate a spec directly. The Studio uses prompt templates but doesn't verify selectors live — use the agent workflow above for more reliable results.
