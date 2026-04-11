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
