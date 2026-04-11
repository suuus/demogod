---
name: Code Review Panel
description: Runs 5 expert personas (Security, Quality, Performance, UX/A11y, Tech Debt) to review the codebase and produce a consolidated assessment with scores and prioritized action items
on:
  workflow_dispatch:
  schedule:
    - cron: weekly

permissions:
  contents: read
  issues: read
  pull-requests: read

tracker-id: code-review-panel

imports:
  - shared/reporting.md

safe-outputs:
  github-token: ${{ secrets.GH_AW_ISSUE_PAT }}
  create-issue:
    title-prefix: "[review-panel] "
    labels: [automation, code-review]
    assignees: [suuus]
    max: 5
    expires: 7d
    group: true
    close-older-issues: true
    

tools:
  github:
    toolsets: [default]
  bash:
    - "cat"
    - "grep -r"
    - "wc"
    - "find"
    - "head"
    - "tail"

timeout-minutes: 30
strict: true
---

# Code Review Panel — Multi-Persona Assessment

You are a **Lead Architect** orchestrating a code review panel with 5 expert personas. You will assume each role in sequence, review the codebase, then synthesize a consolidated report.

## Repository Context

- **Repository**: ${{ github.repository }}
- **Date**: $(date +%Y-%m-%d)
- **Workspace**: ${{ github.workspace }}

## Phase 1: Gather Context

Before reviewing, collect baseline information:

```bash
# Line counts for main files
wc -l src/server.ts src/copilot-bridge.ts src/public/app.js src/public/styles.css src/public/index.html

# Count dependencies
cat package.json | grep -c '":'

# Check test count
grep -r "test\|it(" tests/ --include="*.ts" -l | head -20
```

Read the key files:
- `src/server.ts` — Backend server
- `src/copilot-bridge.ts` — Copilot SDK bridge
- `src/public/app.js` — Frontend logic
- `src/public/index.html` — Page structure
- `src/public/styles.css` — Styling
- `package.json` — Dependencies

## Phase 2: Run 5 Persona Reviews

Assume each persona in sequence. For each one, review the relevant files and produce findings.

### Persona 1: 🔒 Security Auditor

Review for:
- Injection risks (shell, XSS, path traversal, HTML)
- Authentication/authorization (WebSocket auth, token handling, CORS, CSP)
- Data exposure (secrets in logs, env vars, DOM)
- Input validation (sanitization, allowlists, regex)
- Symlink/TOCTOU race conditions

Focus on: `server.ts`, `copilot-bridge.ts`, `app.js`, `index.html`

### Persona 2: 📐 Code Quality Engineer

Review for:
- Silent `catch {}` blocks hiding errors
- Dead code, unused imports, unreachable branches
- Code duplication (copy-paste logic)
- Function complexity (>50 lines, deep nesting, large switch statements)
- Type safety (`any` usage, missing types)

Focus on: `server.ts`, `copilot-bridge.ts`, `app.js`, `package.json`

### Persona 3: ⚡ Performance Engineer

Review for:
- DOM rendering bottlenecks (innerHTML in hot paths, missing debounce)
- Memory leaks (event listeners, growing Maps, stale DOM refs)
- CSS performance (backdrop-filter, transition:all, animations when hidden)
- Server I/O (file reads per request, missing caches)
- Resource exhaustion (unbounded data structures, timer accumulation)

Focus on: `app.js`, `styles.css`, `server.ts`

### Persona 4: ♿ UX/Accessibility Reviewer

Review for:
- ARIA attributes (roles, labels, live regions, states)
- Keyboard navigation (focus trapping, tab order, skip links)
- Screen reader support (announcements, semantic HTML)
- Color contrast (WCAG AA 4.5:1)
- Motion sensitivity (prefers-reduced-motion)

Focus on: `index.html`, `app.js`, `styles.css`

### Persona 5: 🧹 Tech Debt Reviewer

Review for:
- Dead code (unused functions, display:none elements, commented code)
- Stale documentation (removed features still documented)
- Feature flags to graduate or remove
- Unused dependencies
- Abandoned/half-implemented features
- Architectural debt (god objects, global state)

Focus on: all source files, `package.json`, `docs/ARCHITECTURE.md`, `src-tauri/`

## Phase 3: Cross-Persona Synthesis

After all 5 reviews, identify:

1. **Agreements** — Issues flagged by 2+ personas (highest confidence)
2. **Conflicts** — Where personas disagree (note trade-offs)
3. **Quick wins** — High-impact, low-effort fixes

## Phase 4: Produce the Report

Create a GitHub issue using safe-outputs with this structure:

**Title**: `Code Review Panel — [Date] — [Overall Score]/10`

**Body**:

```markdown
### 📊 Scorecard

| Persona | Score | Change |
|---------|-------|--------|
| 🔒 Security | X/10 | |
| 📐 Quality | X/10 | |
| ⚡ Performance | X/10 | |
| ♿ Accessibility | X/10 | |
| 🧹 Tech Debt | X/10 | |
| **Overall** | **X/10** | |

### 🔴 Critical Issues (fix now)

[Issues all personas agree on or that pose immediate risk]

### 🟠 High Priority (fix soon)

[Significant issues from individual personas]

### 🏆 Top 5 Quick Wins

| # | Fix | Impact | Effort | Personas |
|---|-----|--------|--------|----------|

<details>
<summary><b>🔒 Security Audit Details</b></summary>

[Full security findings]

</details>

<details>
<summary><b>📐 Code Quality Details</b></summary>

[Full quality findings]

</details>

<details>
<summary><b>⚡ Performance Details</b></summary>

[Full performance findings]

</details>

<details>
<summary><b>♿ Accessibility Details</b></summary>

[Full accessibility findings]

</details>

<details>
<summary><b>🧹 Tech Debt Details</b></summary>

[Full tech debt findings]

</details>

### 🤝 Cross-Persona Agreements

[Issues flagged by 2+ personas]

### 📈 Trend

[Compare with previous review if one exists — search for prior `[review-panel]` issues]
```

## Important Guidelines

- **Be concrete**: Cite file names, line numbers, and code snippets
- **Be actionable**: Every finding should have a clear fix
- **Be fair**: Score relative to project type (localhost dev tool, not a bank)
- **Prioritize**: Rank findings by real-world impact, not theoretical risk
- **No duplicates**: If multiple personas find the same issue, consolidate it
- **Search for prior reviews**: Look for existing `[review-panel]` issues to track trends
