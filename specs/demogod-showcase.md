# DemoGod UI Showcase

## Application Overview
DemoGod is a web-based demo video tool for GitHub Copilot CLI. The UI has a control bar at the top with buttons for Model, Agent, Skill, Copilot Mode, Layout, Capabilities, and Settings. Below that is a terminal window with session tabs, a terminal output area, and an input line at the bottom. A status bar shows the current state.

## Test Scenarios

### 1. Browse Model Picker
**Seed:** `seed.spec.ts`

#### 1.1 Filter Claude Models
**Steps:**
1. Click the "Model" button in the control bar (button with id "btn-model")
2. Type "claude" in the filter input (input with id "cappicker-search")
3. Wait 2 seconds so filtered Claude models are visible
4. Click the "Cancel" button to close the picker

**Expected Results:**
- Model picker opens showing a filter input and model list
- After typing "claude", only Claude models are visible in the list
- Picker closes after clicking Cancel

#### 1.2 Select a GPT Model
**Steps:**
1. Click the "Model" button (id "btn-model")
2. Type "gpt" in the filter input (id "cappicker-search")
3. Wait 2 seconds so filtered GPT models are visible
4. Click the last model item in the filtered list (it should be "GPT-4.1")

**Expected Results:**
- Model picker opens and filters to GPT models
- After clicking GPT-4.1, the picker closes
- The Model button in the control bar now shows "GPT-4.1"

### 2. Browse Agent Picker
**Seed:** `seed.spec.ts`

**Steps:**
1. Click the "Agent" button (id "btn-agent")
2. Wait 2 seconds so the agent list is visible
3. Click the "Cancel" button to close the picker

**Expected Results:**
- Agent picker opens showing available agents (plugin and remote agents)
- Picker closes after clicking Cancel

### 3. Cycle Copilot Modes
**Seed:** `seed.spec.ts`

**Steps:**
1. Click the Copilot mode button (id "btn-copilot-mode") — it currently shows "Interactive"
2. Wait 2 seconds — the mode should now show "Plan"
3. Click the mode button again
4. Wait 2 seconds — the mode should now show "Autopilot"
5. Click the mode button once more
6. Wait 1 second — the mode should return to "Interactive"

**Expected Results:**
- Mode cycles: Interactive → Plan → Autopilot → Interactive
- The button label updates with each click

### 4. Open Capabilities Panel
**Seed:** `seed.spec.ts`

**Steps:**
1. Click the "Capabilities" button (id "btn-capabilities")
2. Wait 3 seconds so the panel content is visible
3. Click the close button (id "capabilities-close") to close the panel

**Expected Results:**
- Capabilities panel opens showing MCP Servers, Tools, and Skills sections
- Panel closes after clicking the close button

### 5. Browse Skills
**Seed:** `seed.spec.ts`

**Steps:**
1. Click the "Skill" button (id "btn-skill")
2. Wait 2 seconds so the skill list is visible
3. Click the "Cancel" button to close the picker

**Expected Results:**
- Skill picker opens showing available skills
- Picker closes after clicking Cancel

### 6. Send a Prompt
**Seed:** `seed.spec.ts`

**Steps:**
1. Click the input line area (element with class "input-line")
2. Type "What can you help me with today?"
3. Press Enter to send the message
4. Wait for the status text to show "Ready" (response complete)

**Expected Results:**
- Text appears in the input area as typed
- After pressing Enter, a response streams into the terminal
- Status returns to "Ready" when response is complete

### 7. Multi-Session with Floating Layout
**Seed:** `seed.spec.ts`

**Steps:**
1. Press Ctrl+T to open a new session tab
2. Wait 1 second
3. Press Ctrl+T to open another session tab
4. Wait 2 seconds — three session tabs should be visible
5. Click the "Layout" button (id "btn-layout") to switch to floating window mode
6. Wait 3 seconds so floating windows are visible
7. Click the "Layout" button again to switch back to tabs
8. Wait 1 second
9. Press Ctrl+W to close a session tab
10. Press Ctrl+W to close another session tab

**Expected Results:**
- New session tabs appear in the tab bar
- Switching to floating mode shows windows for each session
- Switching back to tabs mode returns to tabbed layout
- Closing tabs removes them from the tab bar
