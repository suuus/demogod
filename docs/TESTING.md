# Testing

DemoGod has **47 tests**: 34 unit tests (Vitest) and 13 E2E tests (Playwright).

## Running Tests

```bash
npm test              # All tests (unit + E2E)
npm run test:unit     # Unit tests only (Vitest)
npm run test:e2e      # E2E tests only (Playwright)
npm run test:headed   # E2E tests in a visible browser
npm run test:showcase # Showcase test in a visible browser
```

## Test Structure

### Unit Tests (Vitest)

| File | What it covers |
|------|---------------|
| `tests/unit/security.test.ts` | `safeDemoPath()` sanitization, `isValidOrigin()` for WebSocket origins, `isPathUnderHome()` directory restriction, session token generation (64-char hex, uniqueness) |
| `tests/unit/demos.test.ts` | Validates demo script JSON structure — required `steps` array or `director_prompt`, step type validation (`command`, `question`, `live`, `action`), required fields per step type |
| `tests/unit/mcp-discovery.test.ts` | `queryMcpServerTools()` JSON-RPC protocol, timeout handling, hardcoded `github-mcp-server` tool list (18 tools), no duplicates, non-empty descriptions |

### E2E Tests (Playwright)

| File | What it covers |
|------|---------------|
| `tests/e2e/api.spec.ts` | REST API endpoints: `GET /` (HTML + dg-token), `GET /api/models`, `GET /api/demos`, `GET /api/demos/:name`, 404 handling, path traversal blocking, `GET /api/browse`, 403 for paths outside homedir |
| `tests/e2e/websocket.spec.ts` | WebSocket auth (valid/invalid token), `create_session` → `session_ready` lifecycle, `list_capabilities` → capabilities response, token extraction from HTML meta tag |
| `tests/showcase.spec.ts` | Full UI walkthrough: model picker (filter + select), agent picker, Copilot mode cycling (Interactive → Plan → Autopilot), capabilities panel, skill picker, prompt submission, multi-session (Ctrl+T / Ctrl+W), floating layout toggle |
| `seed.spec.ts` | Base smoke test — opens DemoGod, waits for splash fade-out and "Ready" status |

## Playwright Configuration

Defined in `playwright.config.ts`:

- **Test directory**: project root (matches `seed.spec.ts`, `tests/showcase*.spec.ts`, `tests/e2e/*.spec.ts`)
- **Timeout**: 180 seconds per test
- **Viewport**: 1280×720
- **Video**: always recorded
- **Trace**: captured on first retry
- **Output**: `~/.demogod/test-results`
- **Web server**: auto-starts `npx tsx src/server.ts` on port 3456 (reuses existing server if running)
- **Reporter**: HTML (never auto-opens)

## Test Specs

`specs/demogod-showcase.md` contains the natural-language test plan that the showcase test implements. It defines 7 scenarios with element IDs and expected outcomes.

## AI-Assisted Test Creation

Three Playwright agent definitions live in `.github/agents/`:

| Agent | Purpose |
|-------|---------|
| `playwright-test-planner` | Explores the UI and generates a natural-language test plan |
| `playwright-test-generator` | Generates Playwright test files from a test plan, executing steps in a real browser |
| `playwright-test-healer` | Debugs and fixes failing Playwright tests, analyzing selectors and timing |

These agents are available via GitHub Copilot's custom agent system.
