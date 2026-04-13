# DemoGod — Borealis Theme, Multi-Tab Review Demo

## Application Overview

End-to-end demo flow: change the background theme to Aurora Borealis, open the insyourance project, ask Copilot to review documentation, then add a second tab with the same project using GPT-4.1 for a security review, and finally switch to float layout mode.

## Test Scenarios

### 1. Borealis Theme & Multi-Tab Review Demo

**Seed:** `seed.spec.ts`

#### 1.1. Select Aurora Borealis theme from Settings

**File:** `tests/generated/borealis-theme-select.spec.ts`

**Steps:**
  1. Click the '⚙️ Settings' button in the control bar
    - expect: The Settings dialog should open with sections: Appearance, Features, and Experimental
  2. In the Appearance section, open the Background dropdown (currently 'Chroma Green') and select 'Aurora Borealis'
    - expect: The dropdown should show 'Aurora Borealis' as selected
    - expect: The page background should change to an animated aurora borealis effect
  3. Press Escape or click outside the dialog to close the Settings panel
    - expect: The Settings dialog should close
    - expect: The Aurora Borealis animated background should remain visible behind the main window

#### 1.2. Open the insyourance project

**File:** `tests/generated/open-insyourance-project.spec.ts`

**Steps:**
  1. Click the '📁 No project' button in the control bar
    - expect: The 'Choose Project' dialog should open showing the home directory listing
    - expect: The directory listing should show folders with 📦 (git repo) and 📂 (regular folder) icons
  2. Click on the 'insyourance' row (marked with 📦 git badge)
    - expect: The file browser should navigate into the insyourance directory
  3. Click the 'Select This Folder' button
    - expect: The project chooser dialog should close
    - expect: The control bar project button should update from '📁 No project' to show '📁 insyourance'
    - expect: A new session should be created with the insyourance project context

#### 1.3. Ask Copilot to review documentation

**File:** `tests/generated/ask-documentation-review.spec.ts`

**Steps:**
  1. Wait for the session to become ready (status bar shows 'Ready')
    - expect: The status bar should display 'Ready'
    - expect: The chat input area should be available with the ❯ prompt
  2. Click the chat input area and type 'Review the documentation for this project' then press Enter
    - expect: The prompt should appear in the chat area
    - expect: The status bar should change from 'Ready' to show an active/streaming state
    - expect: Copilot should begin generating a response reviewing the project documentation
  3. Wait for Copilot to finish responding (status returns to 'Ready')
    - expect: A complete response should be visible in the chat area
    - expect: The status bar should return to 'Ready'

#### 1.4. Add a new tab and open insyourance with GPT-4.1

**File:** `tests/generated/add-tab-gpt41-security.spec.ts`

**Steps:**
  1. Click the '+' button in the tab bar to create a new session tab
    - expect: A new tab should appear in the tab bar (e.g., 'Session 2')
    - expect: The new tab should become the active tab
    - expect: The chat area should show a fresh session with loading/ready state
  2. Click the '📁' project button in the control bar to open the project chooser
    - expect: The 'Choose Project' dialog should open showing the home directory listing
  3. Click on the 'insyourance' row (📦 git badge) and then click 'Select This Folder'
    - expect: The project chooser dialog should close
    - expect: The project button should update to show '📁 insyourance'
    - expect: The session should reinitialize with the insyourance project context
  4. Click the '🧪 Model' button in the control bar
    - expect: The 'Select Model' dialog should open with a filter text input and a list of available models
  5. Locate and click 'GPT-4.1' (model ID: gpt-4.1) in the model list
    - expect: The model dialog should close
    - expect: The status bar should show 'gpt-4.1' as the current model instead of '(default)'
  6. Click the chat input area and type 'Perform a security review of this project' then press Enter
    - expect: The prompt should appear in the chat area
    - expect: Copilot should begin generating a security review response using the GPT-4.1 model
    - expect: The status bar should show an active/streaming state
  7. Wait for Copilot to finish responding (status returns to 'Ready')
    - expect: A complete security review response should be visible in the chat area
    - expect: The status bar should return to 'Ready'

#### 1.5. Switch from Tabs to Float layout mode

**File:** `tests/generated/switch-to-float-layout.spec.ts`

**Steps:**
  1. Click the '📑 Tabs' button in the control bar
    - expect: The layout should change from tabbed mode to a different mode
    - expect: The control bar should now show '🪟 Float' and '⊞ Tile' as layout options instead of '📑 Tabs'
    - expect: Session windows should appear as floating/draggable panels with their own title bars containing minimize (−), maximize (□), and close (×) buttons
  2. Verify the float layout shows the session windows correctly
    - expect: Each session should be displayed in its own floating window panel
    - expect: The session title bar should display the session name
    - expect: The chat content from both sessions should still be visible and intact
  3. Wait 10 seconds to showcase the float layout with Aurora Borealis background
    - expect: The Aurora Borealis animated background should be visible around/behind the floating session windows
    - expect: The floating windows should remain stable and properly rendered
    - expect: All session content should remain intact and readable

#### 1.6. Settings dialog closes properly and theme persists

**File:** `tests/generated/settings-theme-persistence.spec.ts`

**Steps:**
  1. Click the '⚙️ Settings' button in the control bar
    - expect: The Settings dialog should open
    - expect: The Background dropdown should show 'Aurora Borealis' as the selected value (persisted from earlier)
  2. Press Escape to close the Settings dialog
    - expect: The Settings dialog should close
    - expect: The Aurora Borealis theme should still be active

#### 1.7. Tab management — switching between session tabs

**File:** `tests/generated/tab-switching.spec.ts`

**Steps:**
  1. Click on the 'Session 1' tab in the tab bar
    - expect: Session 1 should become the active tab
    - expect: The chat area should display the documentation review conversation from Session 1
  2. Click on the 'Session 2' tab in the tab bar
    - expect: Session 2 should become the active tab
    - expect: The chat area should display the security review conversation from Session 2
    - expect: The model indicator should show 'gpt-4.1'

#### 1.8. Project selector dialog can be cancelled

**File:** `tests/generated/project-selector-cancel.spec.ts`

**Steps:**
  1. Click the '📁' project button in the control bar
    - expect: The 'Choose Project' dialog should open
  2. Click the 'Cancel' button in the project chooser dialog
    - expect: The dialog should close
    - expect: The project selection should remain unchanged
  3. Click the '📁' project button again to reopen the dialog
    - expect: The 'Choose Project' dialog should open again
  4. Press Escape to close the dialog
    - expect: The dialog should close
    - expect: The project selection should remain unchanged

#### 1.9. Model selector dialog can be filtered and cancelled

**File:** `tests/generated/model-selector-filter-cancel.spec.ts`

**Steps:**
  1. Click the '🧪 Model' button in the control bar
    - expect: The 'Select Model' dialog should open with a filter input and a full list of available models
  2. Type 'gpt' into the filter text input
    - expect: The model list should filter to show only models matching 'gpt' (e.g., GPT-5.4, GPT-5.3-Codex, GPT-4.1, etc.)
    - expect: Non-GPT models (Claude, Goldeneye) should be hidden
  3. Clear the filter input and type 'claude'
    - expect: The model list should filter to show only Claude models
  4. Click the 'Cancel' button
    - expect: The model selector dialog should close
    - expect: The current model should remain unchanged
