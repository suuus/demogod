# Aurora Borealis Demo

## Application Overview

End-to-end demo of DemoGod showcasing the Aurora Borealis theme, multi-session workflows with the insyourance project, model switching to GPT-4.1, and floating window layout. The demo covers settings configuration, project selection, Copilot interaction, tab management, model switching, and layout customization.

## Test Scenarios

### 1. Aurora Borealis Theme Demo

**Seed:** `tests/demo-seed.spec.ts`

#### 1.1. Set Aurora Borealis theme and run multi-session insyourance demo

**File:** `tests/generated/borealis-demo.spec.ts`

**Steps:**
  1. Click the '⚙️ Settings' button in the control bar
    - expect: The Settings dialog should open showing Appearance, Features, and Experimental sections
  2. In the Appearance section, select 'Aurora Borealis' from the Background dropdown
    - expect: The dropdown should show 'Aurora Borealis' as the selected option
    - expect: The page background should change to the animated Aurora Borealis theme
  3. Press Escape to close the Settings dialog
    - expect: The Settings dialog should close
    - expect: The Aurora Borealis animated background should remain active behind the session window
  4. Click the '📁 No project' button in the control bar
    - expect: The 'Choose Project' dialog should open showing a file browser rooted at the home directory
  5. Click on the 'insyourance' row (marked with 📦 and git badge) in the project list
    - expect: The file browser should navigate into the insyourance directory or highlight it
  6. Click the 'Select This Folder' button to confirm the project selection
    - expect: The dialog should close
    - expect: The control bar project button should update to show '📁 insyourance'
    - expect: A new Copilot session should be created with insyourance as the working directory
  7. Click on the chat input area (the prompt line with ❯) and type 'Review the docs in this project and give me a summary of what this application does' then press Enter
    - expect: The message should appear in the chat as a user prompt
    - expect: The status bar should change from 'Ready' to indicate the session is busy
    - expect: Copilot should begin streaming a response about the insyourance project documentation
  8. Wait for Copilot to finish responding (status returns to 'Ready')
    - expect: A complete response should be visible in the chat area
    - expect: The status bar should show 'Ready' again
  9. Click the '+' button in the session tab bar to add a new tab
    - expect: A new session tab (e.g. 'Session 2') should appear in the tab bar
    - expect: The new tab should become the active tab
    - expect: The chat area should show a fresh session with capability loading messages
  10. Click the '📁' project button in the control bar (it may show 'insyourance' or 'No project')
    - expect: The 'Choose Project' dialog should open
  11. Click on the 'insyourance' row in the project list and click 'Select This Folder'
    - expect: The dialog should close
    - expect: The project button should show '📁 insyourance'
    - expect: The new session should be configured with insyourance as the working directory
  12. Click the '🧪 Model' button in the control bar
    - expect: The model picker dialog should open showing a filterable list of available models
  13. Click on 'GPT-4.1' in the model list
    - expect: The model picker should close
    - expect: The status bar should update to show 'gpt-4.1' as the active model instead of '(default)'
  14. Click on the chat input and type 'Do a security review of this codebase. Look for vulnerabilities, injection risks, and authentication issues.' then press Enter
    - expect: The message should appear as a user prompt in Session 2
    - expect: Copilot should begin streaming a security review response using GPT-4.1
  15. Click the '📑 Tabs' button in the control bar (or the layout toggle area)
    - expect: The control bar should reveal layout sub-buttons: '🪟 Float' and '⊞ Tile'
    - expect: The layout may switch to floating mode with draggable window chrome (title bar with −, □, × buttons)
  16. If not already in floating layout, click the '🪟 Float' button
    - expect: The session containers should switch to floating window mode
    - expect: Each session should have a draggable title bar with minimize (−), maximize (□), and close (×) buttons
    - expect: The windows should be freely positionable on the canvas
  17. Wait 10 seconds to let the Aurora Borealis background animation and floating layout be visible
    - expect: The Aurora Borealis animation should be playing smoothly behind the floating session windows
    - expect: Both session tabs should be accessible
    - expect: Copilot responses should continue streaming if still in progress
