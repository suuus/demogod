// ─── Demo Video Generator – Frontend Logic ────────────────────────────────
(() => {
  "use strict";

  // ─── State ──────────────────────────────────────────
  let ws = null;
  let mode = "live"; // "live" | "scripted"
  let popupDialogs = true; // true = popup window, false = inline
  let isProcessing = false;
  let currentResponseEl = null;
  let currentResponseText = "";
  let pendingDialogRequestId = null;
  let selectedProject = null; // path string or null
  let selectedModel = ""; // empty = use CLI default from config
  let selectedAgent = null; // { name, displayName } or null
  let copilotMode = "interactive"; // "interactive" | "plan" | "autopilot"
  let cachedModels = []; // from /api/models
  let cachedAgents = []; // from session.rpc.agent.list()
  let cachedSkills = []; // from session.rpc.skills.list()
  let tabCounter = 0; // for unique tab IDs
  let questionCheckPending = false; // flag to check for question on idle

  // ─── DOM refs ───────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const terminalBody = $("#terminal-body");
  const terminalOutput = $("#terminal-output");
  const inputText = $("#input-text");
  const inputLine = $("#terminal-input-line");
  const cursor = $("#cursor");
  const statusText = $("#status-text");
  const btnMode = $("#btn-mode");
  const modeLabel = $("#mode-label");
  const modeIcon = $("#mode-icon");
  const btnNewSession = $("#btn-new-session");
  const dialogOverlay = $("#dialog-overlay");
  const dialogMessage = $("#dialog-message");
  const dialogFields = $("#dialog-fields");
  const dialogSubmit = $("#dialog-submit");
  const dialogCancel = $("#dialog-cancel");
  const dialogClose = $("#dialog-close");
  const btnPopup = $("#btn-popup");
  const popupLabel = $("#popup-label");
  const btnProject = $("#btn-project");
  const projectLabel = $("#project-label");
  const pickerOverlay = $("#picker-overlay");
  const pickerBreadcrumb = $("#picker-breadcrumb");
  const pickerList = $("#picker-list");
  const pickerSelect = $("#picker-select");
  const pickerCancel = $("#picker-cancel");
  const pickerClose = $("#picker-close");
  const tabBar = $("#tab-bar");
  const tabPanels = $(".tab-panels");
  const statusModel = $("#status-model");
  const statusAgent = $("#status-agent");
  const statusMode = $("#status-mode");
  const statusCwd = $("#status-cwd");

  // Picker buttons
  const btnModel = $("#btn-model");
  const modelLabel = $("#model-label");
  const btnAgent = $("#btn-agent");
  const agentLabel = $("#agent-label");
  const btnSkill = $("#btn-skill");
  const skillLabel = $("#skill-label");
  const btnCopilotMode = $("#btn-copilot-mode");
  const copilotModeLabel = $("#copilot-mode-label");

  // Capability picker overlay
  const cappickerOverlay = $("#cappicker-overlay");
  const cappickerTitle = $("#cappicker-title");
  const cappickerIcon = $("#cappicker-icon");
  const cappickerSearch = $("#cappicker-search");
  const cappickerList = $("#cappicker-list");
  const cappickerCancel = $("#cappicker-cancel");
  const cappickerClose = $("#cappicker-close");
  const cappickerDeselect = $("#cappicker-deselect");

  // ─── WebSocket ──────────────────────────────────────
  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}`);
    ws.onopen = () => {
      setStatus("Connected", "●");
      ws.send(JSON.stringify({ type: "create_session", workingDirectory: selectedProject, model: selectedModel || undefined }));
    };
    ws.onmessage = (evt) => handleMessage(JSON.parse(evt.data));
    ws.onclose = () => {
      setStatus("Disconnected");
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
  }

  function send(type, payload = {}) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  // ─── Message handler ───────────────────────────────
  function handleMessage(msg) {
    console.log("[WS]", msg.type, msg);
    switch (msg.type) {
      case "session_ready": {
        setStatus("Ready");
        setProcessing(false);
        const dir = msg.workingDirectory;
        if (msg.model && statusModel) {
          statusModel.textContent = msg.model;
        }
        if (dir && statusCwd) {
          statusCwd.textContent = `📂 ${dir}`;
        }
        // Fetch agents, skills, and current mode for the pickers
        send("list_agents");
        send("list_skills");
        send("get_mode");
        const windowTitle = $(".window-title");
        if (dir && windowTitle) {
          const short = dir.split("/").pop() || dir;
          windowTitle.innerHTML = `<span class="window-title-icon">❯</span> Copilot CLI — ${escapeHtml(short)}`;
        }
        break;
      }

      case "delta":
        questionCheckPending = true;
        appendDelta(msg.text);
        break;

      case "message":
        finishResponse(msg.content);
        break;

      case "idle":
        finishResponse();
        setStatus("Ready");
        setProcessing(false);
        // Check if the last response was a question
        if (questionCheckPending) {
          questionCheckPending = false;
          detectAndShowQuestion();
        }
        break;

      case "error":
        appendSystemMessage(`Error: ${msg.text}`, "error");
        setStatus("Error");
        setProcessing(false);
        break;

      case "user_input":
        questionCheckPending = false; // real dialog arrived, skip auto-detect
        setProcessing(false); // unlock input so inline forms are interactive
        showDialog(msg);
        break;

      case "tool_start":
        showToolIndicator(msg.toolName, true, msg.parentToolCallId);
        // Parse arguments — hooks send as toolArgs object
        let toolArgs = msg.toolArgs;
        if (typeof toolArgs === "string") {
          try { toolArgs = JSON.parse(toolArgs); } catch {}
        }
        // Track file creates/edits/views for markdown files
        if (["create", "edit", "view", "show_file"].includes(msg.toolName) && toolArgs?.path) {
          trackPendingFile(msg.toolName, toolArgs.path);
        }
        break;

      case "tool_complete":
        showToolIndicator(msg.toolName, false, msg.parentToolCallId);
        // Check if a tracked markdown file was created/edited
        checkPendingFile(msg.toolName);
        break;

      case "tool_partial":
        updateToolPartial(msg.toolCallId, msg.partialOutput);
        break;

      case "tool_progress":
        updateToolProgress(msg.toolCallId, msg.progressMessage);
        break;

      case "file_changed":
        // Workspace file changed — check if it's markdown
        if (msg.path && /\.md$/i.test(msg.path)) {
          openFileInTab(msg.path);
        }
        break;

      case "subagent_start":
        appendSystemMessage(`Sub-agent started: ${msg.agentDisplayName || msg.agentName}`, "info");
        break;

      case "subagent_complete":
        appendSystemMessage(`Sub-agent completed: ${msg.agentDisplayName || msg.agentName}`, "info");
        break;

      case "task_complete":
        if (msg.summary) {
          addReportTab("Summary", msg.summary);
        }
        break;

      case "intent":
        setStatus(msg.text);
        break;

      case "capabilities_loaded":
        handleCapabilitiesLoaded(msg);
        break;

      case "mcp_status":
        console.log(`[MCP] ${msg.serverName}: ${msg.status}`);
        break;

      case "agents_list":
        cachedAgents = msg.agents || [];
        break;

      case "skills_list":
        cachedSkills = msg.skills || [];
        break;

      case "model_changed":
        selectedModel = msg.model;
        modelLabel.textContent = msg.model;
        btnModel.classList.add("active");
        if (statusModel) statusModel.textContent = msg.model;
        appendSystemMessage(`Model changed to ${msg.model}`, "info");
        break;

      case "agent_selected":
        selectedAgent = msg.agent;
        agentLabel.textContent = msg.agent?.displayName || msg.agent?.name || "Agent";
        btnAgent.classList.add("active");
        statusAgent.textContent = `🤖 ${msg.agent?.displayName || msg.agent?.name}`;
        appendSystemMessage(`Agent switched to ${msg.agent?.displayName || msg.agent?.name}`, "info");
        break;

      case "agent_deselected":
        selectedAgent = null;
        agentLabel.textContent = "Agent";
        btnAgent.classList.remove("active");
        statusAgent.textContent = "";
        appendSystemMessage("Agent reset to default", "info");
        break;

      case "mode_current":
      case "mode_changed": {
        copilotMode = msg.mode;
        const modeLabels = { interactive: "Interactive", plan: "Plan", autopilot: "Autopilot" };
        const modeIcons = { interactive: "🎯", plan: "📋", autopilot: "🚀" };
        copilotModeLabel.textContent = modeLabels[msg.mode] || msg.mode;
        btnCopilotMode.querySelector("span").textContent = modeIcons[msg.mode] || "🎯";
        statusMode.textContent = `${modeIcons[msg.mode] || ""} ${modeLabels[msg.mode] || msg.mode}`;
        if (msg.type === "mode_changed") {
          appendSystemMessage(`Mode switched to ${modeLabels[msg.mode] || msg.mode}`, "info");
        }
        break;
      }

      case "demo_step_command":
        playScriptedCommand(msg.text, msg.typingSpeed || 45);
        break;

      case "demo_step_question":
        showDialog(msg, true);
        break;

      case "demo_step_response":
        simulateStreamingResponse(msg.text);
        break;

      case "demo_complete":
        appendSystemMessage("Demo complete ✓");
        setProcessing(false);
        break;
    }
  }

  // ─── Terminal rendering ─────────────────────────────
  function addCommandEntry(text) {
    const entry = document.createElement("div");
    entry.className = "entry";

    const cmdLine = document.createElement("div");
    cmdLine.className = "entry-command";
    cmdLine.innerHTML = `<span class="prompt-symbol">❯</span><span class="command-text"></span>`;
    cmdLine.querySelector(".command-text").textContent = text;

    const responseDiv = document.createElement("div");
    responseDiv.className = "entry-response";

    entry.appendChild(cmdLine);
    entry.appendChild(responseDiv);
    terminalOutput.appendChild(entry);

    currentResponseEl = responseDiv;
    currentResponseText = "";
    scrollToBottom();

    return entry;
  }

  function appendDelta(text) {
    if (!currentResponseEl) {
      const entry = document.createElement("div");
      entry.className = "entry";
      const responseDiv = document.createElement("div");
      responseDiv.className = "entry-response";
      entry.appendChild(responseDiv);
      terminalOutput.appendChild(entry);
      currentResponseEl = responseDiv;
      currentResponseText = "";
    }
    currentResponseText += text;
    currentResponseEl.innerHTML = renderMarkdown(currentResponseText) +
      '<span class="streaming-cursor"></span>';
    scrollToBottom();
  }

  function finishResponse(finalContent) {
    if (currentResponseEl) {
      // Use final content as source of truth if available
      if (finalContent && typeof finalContent === "string") {
        currentResponseText = finalContent;
        currentResponseEl.innerHTML = renderMarkdown(finalContent);
      }
      // Remove streaming cursor
      const cur = currentResponseEl.querySelector(".streaming-cursor");
      if (cur) cur.remove();
      currentResponseEl = null;
    }
  }

  function appendSystemMessage(text, type = "info") {
    const el = document.createElement("div");
    el.className = "entry";
    el.innerHTML = `<div class="entry-response" style="color: var(--${type === "error" ? "red" : "overlay0"}); font-style: italic; font-size: 12.5px;">${escapeHtml(text)}</div>`;
    terminalOutput.appendChild(el);
    scrollToBottom();
  }

  function showToolIndicator(toolName, running, parentToolCallId) {
    const isSubAgent = !!parentToolCallId;
    const prefix = isSubAgent ? "⤷ " : "";
    // Use a unique key per tool instance
    const key = `${parentToolCallId || "root"}:${toolName}`;
    const existing = terminalOutput.querySelector(`[data-tool-key="${CSS.escape(key)}"]`);
    if (existing && !running) {
      // Transition to completed state
      existing.classList.add("tool-done");
      existing.innerHTML = `<span class="tool-check">✓</span> ${prefix}${escapeHtml(toolName)}`;
      setTimeout(() => existing.remove(), 3000);
      return;
    }
    if (running && !existing) {
      const el = document.createElement("div");
      el.className = isSubAgent ? "tool-indicator tool-subagent" : "tool-indicator";
      el.setAttribute("data-tool-key", key);
      el.setAttribute("data-tool", toolName);
      el.innerHTML = `<span class="spinner"></span> ${prefix}Running ${escapeHtml(toolName)}`;
      terminalOutput.appendChild(el);
      scrollToBottom();
    }
  }

  // Track toolCallId → DOM element for partial output
  const toolCallElements = new Map();

  function updateToolPartial(toolCallId, partialOutput) {
    if (!toolCallId || !partialOutput) return;
    // Find or create a partial output element
    let el = toolCallElements.get(toolCallId);
    if (!el) {
      el = document.createElement("div");
      el.className = "tool-partial-output";
      terminalOutput.appendChild(el);
      toolCallElements.set(toolCallId, el);
    }
    el.textContent = partialOutput.substring(0, 300);
    scrollToBottom();
  }

  function updateToolProgress(toolCallId, progressMessage) {
    if (!toolCallId || !progressMessage) return;
    let el = toolCallElements.get(toolCallId);
    if (!el) {
      el = document.createElement("div");
      el.className = "tool-partial-output";
      terminalOutput.appendChild(el);
      toolCallElements.set(toolCallId, el);
    }
    el.textContent = progressMessage;
    scrollToBottom();
  }

  function scrollToBottom() {
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  // ─── Tab Management ───────────────────────────────
  function switchTab(tabId) {
    tabBar.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tabPanels.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

    const tab = tabBar.querySelector(`[data-tab="${tabId}"]`);
    const panel = document.getElementById(`panel-${tabId}`);
    if (tab) tab.classList.add("active");
    if (panel) panel.classList.add("active");

    // Remove badge from tab
    if (tab) {
      const badge = tab.querySelector(".tab-badge");
      if (badge) badge.remove();
    }
  }

  function addReportTab(title, markdownContent) {
    const tabId = `report-${++tabCounter}`;

    // Create tab
    const tab = document.createElement("div");
    tab.className = "tab";
    tab.dataset.tab = tabId;
    tab.innerHTML = `
      <span class="tab-icon">📄</span>
      <span class="tab-label">${escapeHtml(title)}</span>
      <span class="tab-close" title="Close tab">✕</span>
    `;
    tab.addEventListener("click", (e) => {
      if (!e.target.classList.contains("tab-close")) {
        switchTab(tabId);
      }
    });
    tab.querySelector(".tab-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tabId);
    });
    tabBar.appendChild(tab);

    // Create panel
    const panel = document.createElement("div");
    panel.className = "tab-panel";
    panel.id = `panel-${tabId}`;
    const reportDiv = document.createElement("div");
    reportDiv.className = "report-panel";
    reportDiv.innerHTML = renderReportMarkdown(markdownContent);
    panel.appendChild(reportDiv);
    tabPanels.appendChild(panel);

    // Add notification badge to tab (subtle green dot)
    const badge = document.createElement("span");
    badge.className = "tab-badge";
    tab.appendChild(badge);

    // Auto-switch to the new tab
    switchTab(tabId);
  }

  function closeTab(tabId) {
    const tab = tabBar.querySelector(`[data-tab="${tabId}"]`);
    const panel = document.getElementById(`panel-${tabId}`);
    const wasActive = tab?.classList.contains("active");
    if (tab) tab.remove();
    if (panel) panel.remove();
    if (wasActive) switchTab("chat");
  }

  // Wire up the default Chat tab click
  tabBar.querySelector('[data-tab="chat"]').addEventListener("click", () => switchTab("chat"));

  // ─── File Tracking (for created/edited markdown) ──
  const pendingFiles = new Map(); // toolName → { path }
  const openedFiles = new Set(); // paths already opened as tabs

  function trackPendingFile(toolName, filePath) {
    if (/\.(md|markdown)$/i.test(filePath)) {
      pendingFiles.set(toolName, { path: filePath });
    }
  }

  function checkPendingFile(toolName) {
    const pending = pendingFiles.get(toolName);
    if (!pending) return;
    pendingFiles.delete(toolName);

    openFileInTab(pending.path);
  }

  async function openFileInTab(filePath) {
    // Avoid opening the same file multiple times
    const normalPath = filePath.replace(/^\/+/, "/");
    if (openedFiles.has(normalPath)) {
      // File already open — refresh its content
      const existingTabId = [...openedFiles].indexOf(normalPath);
      // Just re-fetch and update
      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) return;
        const data = await res.json();
        const tabId = `file-${hashPath(normalPath)}`;
        const panel = document.getElementById(`panel-${tabId}`);
        if (panel) {
          const reportDiv = panel.querySelector(".report-panel");
          if (reportDiv) reportDiv.innerHTML = renderReportMarkdown(data.content);
        }
      } catch {}
      return;
    }
    openedFiles.add(normalPath);

    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) return;
      const data = await res.json();
      const filename = data.filename || filePath.split("/").pop();
      const tabId = `file-${hashPath(normalPath)}`;
      addFileTab(tabId, filename, data.content, normalPath);
    } catch (err) {
      console.error("Failed to open file:", err);
      openedFiles.delete(normalPath);
    }
  }

  function hashPath(p) {
    // Simple hash for unique tab IDs
    let h = 0;
    for (let i = 0; i < p.length; i++) h = ((h << 5) - h + p.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  function addFileTab(tabId, filename, content, filePath) {
    // Create tab
    const tab = document.createElement("div");
    tab.className = "tab";
    tab.dataset.tab = tabId;
    tab.innerHTML = `
      <span class="tab-icon">📄</span>
      <span class="tab-label" title="${escapeHtml(filePath)}">${escapeHtml(filename)}</span>
      <span class="tab-close" title="Close tab">✕</span>
    `;
    tab.addEventListener("click", (e) => {
      if (!e.target.classList.contains("tab-close")) switchTab(tabId);
    });
    tab.querySelector(".tab-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tabId);
      openedFiles.delete(filePath);
    });
    tabBar.appendChild(tab);

    // Create panel
    const panel = document.createElement("div");
    panel.className = "tab-panel";
    panel.id = `panel-${tabId}`;
    const reportDiv = document.createElement("div");
    reportDiv.className = "report-panel";
    reportDiv.innerHTML = renderReportMarkdown(content);
    panel.appendChild(reportDiv);
    tabPanels.appendChild(panel);

    // Notification badge
    const badge = document.createElement("span");
    badge.className = "tab-badge";
    tab.appendChild(badge);

    // Auto-switch to the new tab
    switchTab(tabId);
  }

  // ─── Question Detection ──────────────────────────
  function detectAndShowQuestion() {
    if (!currentResponseText || currentResponseText.length < 10) return;

    const text = currentResponseText.trim();
    // Look for question patterns at the end of the response
    const lastLines = text.split("\n").slice(-5).join("\n");

    const questionPatterns = [
      /\?\s*$/,                        // ends with ?
      /would you like/i,
      /do you want/i,
      /please (choose|select|pick|confirm)/i,
      /which (one|option|approach)/i,
      /shall I/i,
      /should I/i,
      /let me know/i,
      /what would you prefer/i,
    ];

    const looksLikeQuestion = questionPatterns.some(p => p.test(lastLines));
    if (!looksLikeQuestion) return;

    // Don't trigger for very long responses (likely reports not questions)
    if (text.length > 2000) return;

    // Show a dialog for the detected question
    const questionText = lastLines.trim();

    if (!popupDialogs) {
      // Inline mode — render in terminal
      renderInlineQuestion(questionText, null, null, "__auto_question__");
      return;
    }

    // Popup mode
    pendingDialogRequestId = "__auto_question__";
    dialogMessage.textContent = questionText;
    dialogFields.innerHTML = "";

    // Simple text input for the answer
    const div = document.createElement("div");
    div.className = "dialog-field";
    const input = document.createElement("input");
    input.type = "text";
    input.name = "response";
    input.placeholder = "Type your answer...";
    div.appendChild(input);
    dialogFields.appendChild(div);

    dialogOverlay.classList.remove("hidden");
    requestAnimationFrame(() => input.focus());
  }

  // ─── Rich Markdown for Reports ───────────────────
  function renderReportMarkdown(text) {
    if (!text) return "";
    let html = escapeHtml(text);

    // Code blocks (```...```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Headings
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // Bold, italic
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // Tables
    html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (_, header, sep, body) => {
      const ths = header.split("|").filter(Boolean).map(h => `<th>${h.trim()}</th>`).join("");
      const rows = body.trim().split("\n").map(row => {
        const tds = row.split("|").filter(Boolean).map(d => `<td>${d.trim()}</td>`).join("");
        return `<tr>${tds}</tr>`;
      }).join("");
      return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
    });

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/((?:<li>.+<\/li>\n?)+)/g, "<ul>$1</ul>");

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // Paragraphs — convert double newlines
    html = html.replace(/\n\n/g, "</p><p>");
    html = html.replace(/\n/g, "<br>");
    html = `<p>${html}</p>`;

    // Clean up empty paragraphs and fix nesting
    html = html.replace(/<p>\s*<(h[1-3]|ul|ol|table|blockquote|pre)/g, "<$1");
    html = html.replace(/<\/(h[1-3]|ul|ol|table|blockquote|pre)>\s*<\/p>/g, "</$1>");
    html = html.replace(/<p>\s*<\/p>/g, "");
    html = html.replace(/<br>\s*(<\/?(ul|li|h[1-3]|table|thead|tbody|tr|th|td|pre|blockquote))/g, "$1");

    return html;
  }

  // ─── Input handling ─────────────────────────────────
  function setProcessing(processing) {
    isProcessing = processing;
    inputLine.classList.toggle("disabled", processing);
    if (!processing && mode === "live") {
      inputText.focus();
    }
  }

  inputText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = inputText.textContent.trim();
      if (!text || isProcessing) return;

      addCommandEntry(text);
      inputText.textContent = "";
      setProcessing(true);
      setStatus("Thinking...");
      send("send_prompt", { prompt: text });
    }
  });

  // Keep input focused in live mode (but not when an inline question form is active)
  terminalBody.addEventListener("click", (e) => {
    if (mode === "live" && !isProcessing) {
      if (e.target.closest(".inline-question-form")) return;
      inputText.focus();
    }
  });

  // ─── Dialog / User Input ────────────────────────────
  function showDialog(msg, scripted = false) {
    pendingDialogRequestId = msg.requestId || null;
    const questionText = msg.message || "The assistant has a question:";
    const schema = msg.schema;
    const choices = msg.choices;

    // If popup mode is off and not scripted, render inline
    if (!popupDialogs && !scripted) {
      renderInlineQuestion(questionText, schema, choices, msg.requestId);
      return;
    }

    // Popup mode — build the dialog
    dialogMessage.textContent = questionText;
    dialogFields.innerHTML = "";

    buildFormFields(dialogFields, schema, choices);

    dialogOverlay.classList.remove("hidden");

    requestAnimationFrame(() => {
      const firstInput = dialogFields.querySelector("input, select");
      if (firstInput) firstInput.focus();
    });

    // In scripted mode, auto-fill and auto-submit
    if (scripted && msg.autoAnswer) {
      const delay = msg.autoSubmitDelay || 2000;
      setTimeout(() => {
        for (const [key, value] of Object.entries(msg.autoAnswer)) {
          const field = dialogFields.querySelector(`[name="${key}"]`);
          if (field) field.value = value;
        }
      }, delay * 0.4);
      setTimeout(() => {
        submitDialog();
      }, delay);
    }
  }

  function buildFormFields(container, schema, choices) {
    if (schema?.properties) {
      const required = new Set(schema.required || []);

      for (const [key, field] of Object.entries(schema.properties)) {
        const div = document.createElement("div");
        div.className = "dialog-field";

        const label = document.createElement("label");
        label.textContent = (field.title || key) + (required.has(key) ? " *" : "");
        if (field.description) {
          label.title = field.description;
        }
        div.appendChild(label);

        if (field.type === "boolean") {
          // Toggle switch
          const row = document.createElement("div");
          row.className = "dialog-toggle-row";

          const text = document.createElement("span");
          text.className = "dialog-toggle-text";
          text.textContent = field.description || (field.title || key);
          row.appendChild(text);

          const toggle = document.createElement("label");
          toggle.className = "dialog-toggle";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.name = key;
          input.checked = field.default === true;
          const track = document.createElement("span");
          track.className = "dialog-toggle-track";
          toggle.appendChild(input);
          toggle.appendChild(track);
          row.appendChild(toggle);
          div.appendChild(row);

        } else if (field.enum && field.enum.length <= 5) {
          // Radio buttons for small enum sets
          const group = document.createElement("div");
          group.className = "dialog-check-group";
          const enumNames = field.enumNames || field.enum;

          for (let i = 0; i < field.enum.length; i++) {
            const item = document.createElement("label");
            item.className = "dialog-check-item";

            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = key;
            radio.value = field.enum[i];
            if (field.default === field.enum[i] || (i === 0 && !field.default)) {
              radio.checked = true;
              item.classList.add("selected");
            }
            radio.addEventListener("change", () => {
              group.querySelectorAll(".dialog-check-item").forEach(el => el.classList.remove("selected"));
              item.classList.add("selected");
            });

            const lbl = document.createElement("span");
            lbl.className = "dialog-check-label";
            lbl.textContent = enumNames[i];

            item.appendChild(radio);
            item.appendChild(lbl);
            group.appendChild(item);
          }
          div.appendChild(group);

        } else if (field.enum) {
          // Dropdown for larger enum sets
          const select = document.createElement("select");
          select.name = key;
          for (const opt of field.enum) {
            const option = document.createElement("option");
            option.value = opt;
            option.textContent = opt;
            if (field.default === opt) option.selected = true;
            select.appendChild(option);
          }
          div.appendChild(select);

        } else if (field.oneOf) {
          // Radio buttons for oneOf
          const group = document.createElement("div");
          group.className = "dialog-check-group";

          for (let i = 0; i < field.oneOf.length; i++) {
            const opt = field.oneOf[i];
            const item = document.createElement("label");
            item.className = "dialog-check-item";

            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = key;
            radio.value = opt.const;
            if (field.default === opt.const || (i === 0 && !field.default)) {
              radio.checked = true;
              item.classList.add("selected");
            }
            radio.addEventListener("change", () => {
              group.querySelectorAll(".dialog-check-item").forEach(el => el.classList.remove("selected"));
              item.classList.add("selected");
            });

            const lbl = document.createElement("span");
            lbl.className = "dialog-check-label";
            lbl.textContent = opt.title;

            item.appendChild(radio);
            item.appendChild(lbl);
            group.appendChild(item);
          }
          div.appendChild(group);

        } else if (field.type === "array" && field.items) {
          // Checkboxes for multi-select arrays
          const group = document.createElement("div");
          group.className = "dialog-check-group";
          const options = field.items.enum || (field.items.anyOf || []).map(a => a.const);
          const optionNames = (field.items.anyOf || []).map(a => a.title) || options;
          const defaults = new Set(field.default || []);

          for (let i = 0; i < options.length; i++) {
            const item = document.createElement("label");
            item.className = "dialog-check-item" + (defaults.has(options[i]) ? " selected" : "");

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.name = key;
            cb.value = options[i];
            cb.checked = defaults.has(options[i]);
            cb.addEventListener("change", () => {
              item.classList.toggle("selected", cb.checked);
            });

            const lbl = document.createElement("span");
            lbl.className = "dialog-check-label";
            lbl.textContent = optionNames[i] || options[i];

            item.appendChild(cb);
            item.appendChild(lbl);
            group.appendChild(item);
          }
          div.appendChild(group);

        } else if (field.type === "integer" || field.type === "number") {
          const input = document.createElement("input");
          input.type = "number";
          input.name = key;
          input.placeholder = field.description || "";
          if (field.default != null) input.value = field.default;
          if (field.minimum != null) input.min = field.minimum;
          if (field.maximum != null) input.max = field.maximum;
          if (field.type === "integer") input.step = "1";
          div.appendChild(input);

        } else {
          // Text input (default)
          const input = document.createElement("input");
          input.type = "text";
          input.name = key;
          input.placeholder = field.description || "";
          if (field.default) input.value = field.default;
          div.appendChild(input);
        }

        container.appendChild(div);
      }
    } else if (choices && choices.length > 0) {
      // Simple choice list — radio buttons
      const div = document.createElement("div");
      div.className = "dialog-field";
      const label = document.createElement("label");
      label.textContent = "Choose an option";
      div.appendChild(label);

      const group = document.createElement("div");
      group.className = "dialog-check-group";
      for (let i = 0; i < choices.length; i++) {
        const item = document.createElement("label");
        item.className = "dialog-check-item" + (i === 0 ? " selected" : "");

        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "response";
        radio.value = choices[i];
        if (i === 0) radio.checked = true;
        radio.addEventListener("change", () => {
          group.querySelectorAll(".dialog-check-item").forEach(el => el.classList.remove("selected"));
          item.classList.add("selected");
        });

        const lbl = document.createElement("span");
        lbl.className = "dialog-check-label";
        lbl.textContent = choices[i];

        item.appendChild(radio);
        item.appendChild(lbl);
        group.appendChild(item);
      }
      div.appendChild(group);
      container.appendChild(div);
    } else {
      // Simple text input
      const div = document.createElement("div");
      div.className = "dialog-field";
      const input = document.createElement("input");
      input.type = "text";
      input.name = "response";
      input.placeholder = "Type your answer...";
      div.appendChild(input);
      container.appendChild(div);
    }
  }

  // ─── Inline question rendering ──────────────────────
  function renderInlineQuestion(message, schema, choices, requestId) {
    const entry = document.createElement("div");
    entry.className = "entry";

    const qDiv = document.createElement("div");
    qDiv.className = "entry-response";
    qDiv.style.color = "var(--accent)";
    qDiv.style.fontStyle = "italic";
    qDiv.textContent = "💬 " + message;
    entry.appendChild(qDiv);

    // Build the form fields directly in the terminal
    const formContainer = document.createElement("div");
    formContainer.className = "inline-question-form";
    buildFormFields(formContainer, schema, choices);

    // Action buttons
    const actions = document.createElement("div");
    actions.className = "inline-question-actions";
    const submitBtn = document.createElement("button");
    submitBtn.className = "inline-question-submit";
    submitBtn.textContent = "Submit";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "inline-question-cancel";
    cancelBtn.textContent = "Skip";
    actions.appendChild(submitBtn);
    actions.appendChild(cancelBtn);
    formContainer.appendChild(actions);

    entry.appendChild(formContainer);
    terminalOutput.appendChild(entry);
    scrollToBottom();

    function collectValues() {
      const values = {};
      formContainer.querySelectorAll("input[type='text'], input[type='number'], select").forEach((el) => {
        values[el.name] = el.value;
      });
      formContainer.querySelectorAll("input[type='radio']:checked").forEach((el) => {
        values[el.name] = el.value;
      });
      const checkboxGroups = {};
      formContainer.querySelectorAll("input[type='checkbox']").forEach((el) => {
        if (el.closest(".dialog-toggle")) {
          values[el.name] = el.checked ? "true" : "false";
        } else {
          if (!checkboxGroups[el.name]) checkboxGroups[el.name] = [];
          if (el.checked) checkboxGroups[el.name].push(el.value);
        }
      });
      for (const [name, arr] of Object.entries(checkboxGroups)) {
        values[name] = arr;
      }
      return values;
    }

    function disableForm() {
      formContainer.querySelectorAll("input, select, button").forEach(el => el.disabled = true);
      formContainer.style.opacity = "0.5";
    }

    submitBtn.addEventListener("click", () => {
      const values = collectValues();
      disableForm();
      setProcessing(true);
      send("user_input_response", { requestId, values });
    });

    cancelBtn.addEventListener("click", () => {
      disableForm();
      setProcessing(true);
      send("user_input_response", { requestId, values: {} });
    });

    formContainer.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitBtn.click();
      }
    });

    requestAnimationFrame(() => {
      const firstInput = formContainer.querySelector("input, select");
      if (firstInput) firstInput.focus();
    });
  }

  function submitDialog() {
    const values = {};

    // Collect text, number, select values
    dialogFields.querySelectorAll("input[type='text'], input[type='number'], select").forEach((el) => {
      values[el.name] = el.value;
    });

    // Collect radio button selections
    dialogFields.querySelectorAll("input[type='radio']:checked").forEach((el) => {
      values[el.name] = el.value;
    });

    // Collect checkbox groups (arrays)
    const checkboxGroups = {};
    dialogFields.querySelectorAll("input[type='checkbox']").forEach((el) => {
      // Toggle switches have no explicit group — handle as boolean
      if (el.closest(".dialog-toggle")) {
        values[el.name] = el.checked ? "true" : "false";
      } else {
        if (!checkboxGroups[el.name]) checkboxGroups[el.name] = [];
        if (el.checked) checkboxGroups[el.name].push(el.value);
      }
    });
    for (const [name, arr] of Object.entries(checkboxGroups)) {
      values[name] = arr;
    }

    if (pendingDialogRequestId === "__auto_question__") {
      // Auto-detected question — send answer as a new prompt
      const answer = values.response || Object.values(values)[0] || "";
      if (answer) {
        addCommandEntry(answer);
        setProcessing(true);
        setStatus("Thinking...");
        send("send_prompt", { prompt: answer });
      }
    } else if (pendingDialogRequestId) {
      send("user_input_response", {
        requestId: pendingDialogRequestId,
        values,
      });
      setProcessing(true);
    } else if (mode === "scripted") {
      // Scripted mode — just close and continue
    }

    dialogOverlay.classList.add("hidden");
    pendingDialogRequestId = null;
  }

  function cancelDialog() {
    if (pendingDialogRequestId) {
      send("user_input_response", {
        requestId: pendingDialogRequestId,
        values: {},
      });
      setProcessing(true);
    }
    dialogOverlay.classList.add("hidden");
    pendingDialogRequestId = null;
  }

  dialogSubmit.addEventListener("click", submitDialog);
  dialogCancel.addEventListener("click", cancelDialog);
  dialogClose.addEventListener("click", cancelDialog);

  // Enter to submit dialog
  dialogFields.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitDialog();
    }
  });

  // ─── Scripted playback ──────────────────────────────
  async function playScriptedCommand(text, speed = 45) {
    const entry = addCommandEntry("");
    const cmdText = entry.querySelector(".command-text");
    setProcessing(true);
    setStatus("Typing...");

    // Type out command character by character
    for (let i = 0; i < text.length; i++) {
      cmdText.textContent += text[i];
      scrollToBottom();
      await sleep(speed + Math.random() * 30);
    }
    await sleep(400);
  }

  async function simulateStreamingResponse(text) {
    setStatus("Thinking...");
    await sleep(600);

    // Stream response with variable speed
    const words = text.split(/(?<=\s)/);
    for (const word of words) {
      appendDelta(word);
      await sleep(15 + Math.random() * 25);
    }
    finishResponse();
    setStatus("Ready");
  }

  // ─── Popup toggle ─────────────────────────────────
  if (btnPopup) {
    btnPopup.addEventListener("click", () => {
      popupDialogs = !popupDialogs;
      btnPopup.classList.toggle("active", popupDialogs);
      if (popupLabel) popupLabel.textContent = popupDialogs ? "Popup" : "Inline";
    });
  }

  // ─── Project Picker ─────────────────────────────────
  let pickerCurrentPath = null;

  async function browseTo(path) {
    try {
      const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : "/api/browse";
      const res = await fetch(url);
      const data = await res.json();
      pickerCurrentPath = data.current;
      renderPicker(data);
    } catch (err) {
      console.error("Browse error:", err);
    }
  }

  function renderPicker(data) {
    // Breadcrumb
    pickerBreadcrumb.innerHTML = "";
    const segments = data.current.split("/").filter(Boolean);
    segments.forEach((seg, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "picker-breadcrumb-sep";
        sep.textContent = "/";
        pickerBreadcrumb.appendChild(sep);
      }
      const isLast = i === segments.length - 1;
      const span = document.createElement("span");
      span.className = isLast ? "picker-breadcrumb-current" : "picker-breadcrumb-segment";
      span.textContent = seg;
      if (!isLast) {
        const targetPath = "/" + segments.slice(0, i + 1).join("/");
        span.addEventListener("click", () => browseTo(targetPath));
      }
      pickerBreadcrumb.appendChild(span);
    });

    // List
    pickerList.innerHTML = "";

    if (data.parent) {
      const up = document.createElement("div");
      up.className = "picker-item";
      up.innerHTML = `<span class="picker-item-icon">⬆️</span><span class="picker-item-name" style="color:var(--body-dim)">..</span>`;
      up.addEventListener("click", () => browseTo(data.parent));
      pickerList.appendChild(up);
    }

    if (data.dirs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "picker-empty";
      empty.textContent = "No subdirectories";
      pickerList.appendChild(empty);
    }

    for (const dir of data.dirs) {
      const item = document.createElement("div");
      item.className = "picker-item";

      const icon = document.createElement("span");
      icon.className = "picker-item-icon";
      icon.textContent = dir.isGitRepo ? "📦" : "📂";

      const name = document.createElement("span");
      name.className = "picker-item-name";
      name.textContent = dir.name;

      item.appendChild(icon);
      item.appendChild(name);

      if (dir.isGitRepo) {
        const badge = document.createElement("span");
        badge.className = "picker-item-badge";
        badge.textContent = "git";
        item.appendChild(badge);
      }

      const arrow = document.createElement("span");
      arrow.className = "picker-item-arrow";
      arrow.textContent = "›";
      item.appendChild(arrow);

      item.addEventListener("dblclick", () => {
        selectProject(dir.path);
      });
      item.addEventListener("click", () => {
        pickerList.querySelectorAll(".picker-item").forEach(el => el.classList.remove("selected"));
        item.classList.add("selected");
        pickerCurrentPath = dir.path;
      });

      pickerList.appendChild(item);
    }
  }

  function openPicker() {
    pickerOverlay.classList.remove("hidden");
    browseTo(selectedProject || null);
  }

  function closePicker() {
    pickerOverlay.classList.add("hidden");
  }

  function selectProject(path) {
    selectedProject = path;
    const short = path.split("/").pop() || path;
    projectLabel.textContent = short;
    btnProject.classList.add("active");
    closePicker();

    // Recreate session with new working directory
    terminalOutput.innerHTML = "";
    currentResponseEl = null;
    currentResponseText = "";
    setProcessing(false);
    setStatus("Switching project...");
    send("create_session", { workingDirectory: selectedProject, model: selectedModel || undefined });
  }

  btnProject.addEventListener("click", openPicker);
  pickerCancel.addEventListener("click", closePicker);
  pickerClose.addEventListener("click", closePicker);
  pickerSelect.addEventListener("click", () => {
    if (pickerCurrentPath) selectProject(pickerCurrentPath);
  });

  pickerOverlay.addEventListener("click", (e) => {
    if (e.target === pickerOverlay) closePicker();
  });

  // ─── File Browser ──────────────────────────────────
  const btnBrowseFile = $("#btn-browse-file");
  const fbOverlay = $("#filebrowser-overlay");
  const fbBreadcrumb = $("#filebrowser-breadcrumb");
  const fbList = $("#filebrowser-list");
  const fbCancel = $("#filebrowser-cancel");
  const fbClose = $("#filebrowser-close");
  let fbCurrentPath = null;

  async function fbBrowseTo(path) {
    try {
      const url = path
        ? `/api/browse-files?path=${encodeURIComponent(path)}`
        : "/api/browse-files";
      const res = await fetch(url);
      const data = await res.json();
      fbCurrentPath = data.current;
      renderFileBrowser(data);
    } catch (err) {
      console.error("File browse error:", err);
    }
  }

  function renderFileBrowser(data) {
    // Breadcrumb
    fbBreadcrumb.innerHTML = "";
    const segments = data.current.split("/").filter(Boolean);
    segments.forEach((seg, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "picker-breadcrumb-sep";
        sep.textContent = "/";
        fbBreadcrumb.appendChild(sep);
      }
      const isLast = i === segments.length - 1;
      const span = document.createElement("span");
      span.className = isLast ? "picker-breadcrumb-current" : "picker-breadcrumb-segment";
      span.textContent = seg;
      if (!isLast) {
        const targetPath = "/" + segments.slice(0, i + 1).join("/");
        span.addEventListener("click", () => fbBrowseTo(targetPath));
      }
      fbBreadcrumb.appendChild(span);
    });

    // List
    fbList.innerHTML = "";

    if (data.parent) {
      const up = document.createElement("div");
      up.className = "picker-item";
      up.innerHTML = `<span class="picker-item-icon">⬆️</span><span class="picker-item-name" style="color:var(--body-dim)">..</span>`;
      up.addEventListener("click", () => fbBrowseTo(data.parent));
      fbList.appendChild(up);
    }

    if (data.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "picker-empty";
      empty.textContent = "No files or folders";
      fbList.appendChild(empty);
    }

    for (const item of data.items) {
      const row = document.createElement("div");
      row.className = "picker-item";

      const icon = document.createElement("span");
      icon.className = "picker-item-icon";
      icon.textContent = item.isDir ? "📂" : "📄";

      const name = document.createElement("span");
      name.className = "picker-item-name";
      name.textContent = item.name;

      row.appendChild(icon);
      row.appendChild(name);

      if (item.isDir) {
        const arrow = document.createElement("span");
        arrow.className = "picker-item-arrow";
        arrow.textContent = "›";
        row.appendChild(arrow);
        row.addEventListener("click", () => fbBrowseTo(item.path));
      } else {
        row.addEventListener("click", () => {
          closeFileBrowser();
          openFileInTab(item.path);
        });
      }

      fbList.appendChild(row);
    }
  }

  function openFileBrowser() {
    fbOverlay.classList.remove("hidden");
    fbBrowseTo(selectedProject || null);
  }

  function closeFileBrowser() {
    fbOverlay.classList.add("hidden");
  }

  btnBrowseFile.addEventListener("click", openFileBrowser);
  fbCancel.addEventListener("click", closeFileBrowser);
  fbClose.addEventListener("click", closeFileBrowser);
  fbOverlay.addEventListener("click", (e) => {
    if (e.target === fbOverlay) closeFileBrowser();
  });

  // ─── Mode toggle ────────────────────────────────────
  btnMode.addEventListener("click", () => {
    if (mode === "live") {
      mode = "scripted";
      modeLabel.textContent = "Script";
      modeIcon.textContent = "▶️";
      setProcessing(true);
      send("start_demo", { demo: "intro" });
    } else {
      mode = "live";
      modeLabel.textContent = "Live";
      modeIcon.textContent = "⌨️";
      send("cancel_demo");
      dialogOverlay.classList.add("hidden");
      setProcessing(false);
      inputText.focus();
    }
  });

  btnNewSession.addEventListener("click", () => {
    terminalOutput.innerHTML = "";
    currentResponseEl = null;
    currentResponseText = "";
    setProcessing(false);
    setStatus("Reconnecting...");
    send("create_session", { workingDirectory: selectedProject, model: selectedModel || undefined });
  });

  // ─── Status ─────────────────────────────────────────
  function setStatus(text, icon = "") {
    statusText.textContent = icon ? `${icon} ${text}` : text;
  }

  // ─── Markdown rendering (lightweight) ───────────────
  function renderMarkdown(text) {
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // Unordered lists
    html = html.replace(/^[•\-] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // Line breaks (but not inside pre/ul blocks)
    html = html.replace(/\n/g, "<br>");
    // Clean up brs inside pre
    html = html.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, code) => {
      return `<pre><code>${code.replace(/<br>/g, "\n")}</code></pre>`;
    });
    // Clean up brs inside lists
    html = html.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, inner) => {
      return `<ul>${inner.replace(/<br>/g, "")}</ul>`;
    });

    return html;
  }

  // ─── Utilities ──────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ─── Capabilities reporting ────────────────────────
  function handleCapabilitiesLoaded(msg) {
    const items = msg.items || [];
    const kind = msg.kind;
    const count = items.length;
    if (kind === "skills") {
      const enabled = items.filter((s) => s.enabled);
      console.log(`[Capabilities] ${enabled.length}/${count} skills loaded`, items);
      appendSystemMessage(`✓ ${enabled.length} skills loaded`, "info");
    } else if (kind === "agents") {
      console.log(`[Capabilities] ${count} agents loaded`, items);
      if (msg.errors?.length) {
        for (const err of msg.errors) appendSystemMessage(`Agent error: ${err}`, "error");
      }
      appendSystemMessage(`✓ ${count} agents loaded`, "info");
    } else if (kind === "mcp_servers") {
      const connected = items.filter((s) => s.status === "connected");
      const failed = items.filter((s) => s.status === "failed");
      console.log(`[Capabilities] ${connected.length}/${count} MCP servers connected`, items);
      appendSystemMessage(`✓ ${connected.length}/${count} MCP servers connected`, "info");
      for (const f of failed) {
        appendSystemMessage(`MCP server "${f.name}" failed: ${f.error || "unknown"}`, "error");
      }
    } else if (kind === "extensions") {
      const running = items.filter((e) => e.status === "running");
      console.log(`[Capabilities] ${running.length}/${count} extensions running`, items);
      if (count > 0) appendSystemMessage(`✓ ${running.length}/${count} extensions loaded`, "info");
    }
  }

  // ─── Model selector ─────────────────────────────────
  async function loadModels() {
    try {
      const res = await fetch("/api/models");
      if (!res.ok) throw new Error("Failed to fetch models");
      cachedModels = await res.json();
    } catch (err) {
      console.warn("Could not load models:", err);
      cachedModels = [];
    }
  }

  // ─── Capability Picker (shared overlay) ────────────
  let cappickerMode = null; // "model" | "agent" | "skill"

  function openCapPicker(mode) {
    cappickerMode = mode;
    cappickerSearch.value = "";
    cappickerDeselect.classList.add("hidden");

    if (mode === "model") {
      cappickerIcon.textContent = "🧪";
      cappickerTitle.textContent = "Select Model";
      if (selectedModel) cappickerDeselect.classList.remove("hidden");
      renderCapList(cachedModels.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        desc: [m.billing, m.capabilities?.supports?.vision ? "vision" : ""].filter(Boolean).join(" · ") || m.id,
        meta: m.id,
        selected: m.id === selectedModel,
      })));
    } else if (mode === "agent") {
      cappickerIcon.textContent = "🤖";
      cappickerTitle.textContent = "Select Agent";
      if (selectedAgent) cappickerDeselect.classList.remove("hidden");
      renderCapList(cachedAgents.map((a) => ({
        id: a.name,
        name: a.displayName || a.name,
        desc: a.description || "",
        meta: a.name,
        selected: selectedAgent?.name === a.name,
      })));
    } else if (mode === "skill") {
      cappickerIcon.textContent = "⚡";
      cappickerTitle.textContent = "Invoke Skill";
      const enabled = cachedSkills.filter((s) => s.enabled);
      renderCapList(enabled.map((s) => ({
        id: s.name,
        name: s.name,
        desc: s.description || "",
        meta: s.source || "",
        selected: false,
      })));
    }

    cappickerOverlay.classList.remove("hidden");
    cappickerSearch.focus();
  }

  function closeCapPicker() {
    cappickerOverlay.classList.add("hidden");
    cappickerMode = null;
  }

  function renderCapList(items) {
    cappickerList.innerHTML = "";
    if (items.length === 0) {
      cappickerList.innerHTML = '<div style="padding:20px;color:var(--body-dim);text-align:center">No items available</div>';
      return;
    }
    for (const item of items) {
      const el = document.createElement("div");
      el.className = "cappicker-item" + (item.selected ? " selected" : "");
      el.dataset.id = item.id;
      el.innerHTML =
        `<div class="cappicker-item-name">${escapeHtml(item.name)}</div>` +
        (item.desc ? `<div class="cappicker-item-desc">${escapeHtml(item.desc)}</div>` : "") +
        (item.meta && item.meta !== item.name ? `<div class="cappicker-item-meta">${escapeHtml(item.meta)}</div>` : "");
      el.addEventListener("click", () => onCapItemSelected(item.id));
      cappickerList.appendChild(el);
    }
  }

  function onCapItemSelected(id) {
    const mode = cappickerMode;
    closeCapPicker();
    if (mode === "model") {
      selectedModel = id;
      modelLabel.textContent = id;
      btnModel.classList.add("active");
      if (statusModel) statusModel.textContent = id;
      send("set_model", { model: id });
    } else if (mode === "agent") {
      send("select_agent", { name: id });
    } else if (mode === "skill") {
      // Prefix the input with the skill invocation — user adds their prompt and presses Enter
      inputText.textContent = `/${id} `;
      inputText.focus();
      // Place cursor at end
      const range = document.createRange();
      range.selectNodeContents(inputText);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  cappickerSearch.addEventListener("input", () => {
    const q = cappickerSearch.value.toLowerCase();
    for (const el of cappickerList.querySelectorAll(".cappicker-item")) {
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(q) ? "" : "none";
    }
  });

  cappickerCancel.addEventListener("click", closeCapPicker);
  cappickerClose.addEventListener("click", closeCapPicker);
  cappickerOverlay.addEventListener("click", (e) => {
    if (e.target === cappickerOverlay) closeCapPicker();
  });

  cappickerDeselect.addEventListener("click", () => {
    const mode = cappickerMode;
    closeCapPicker();
    if (mode === "model") {
      selectedModel = "";
      modelLabel.textContent = "Model";
      btnModel.classList.remove("active");
      if (statusModel) statusModel.textContent = "(default)";
    } else if (mode === "agent") {
      send("deselect_agent");
    }
  });

  btnModel.addEventListener("click", () => openCapPicker("model"));
  btnAgent.addEventListener("click", () => {
    // Refresh the list each time
    send("list_agents");
    setTimeout(() => openCapPicker("agent"), 300);
  });
  btnSkill.addEventListener("click", () => {
    send("list_skills");
    setTimeout(() => openCapPicker("skill"), 300);
  });

  // Mode button — cycles through interactive → plan → autopilot
  btnCopilotMode.addEventListener("click", () => {
    const modes = ["interactive", "plan", "autopilot"];
    const next = modes[(modes.indexOf(copilotMode) + 1) % modes.length];
    send("set_mode", { mode: next });
  });

  // ─── Screen Recording ──────────────────────────────────
  const btnRecord = $("#btn-record");
  const recordIcon = $("#record-icon");
  const recordLabel = $("#record-label");
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingStream = null;

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
        preferCurrentTab: true,
      });
      recordingStream = stream;
      recordedChunks = [];

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.download = `copilot-demo-${ts}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        exitRecordingMode();
      };

      // If user stops sharing via browser UI
      stream.getVideoTracks()[0].onended = () => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
      };

      // Enter recording mode
      document.body.classList.add("recording");
      recordIcon.textContent = "⏹";
      recordLabel.textContent = "Stop";

      mediaRecorder.start(100); // collect data every 100ms
    } catch (err) {
      console.log("Recording cancelled or failed:", err.message);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    if (recordingStream) {
      recordingStream.getTracks().forEach((t) => t.stop());
      recordingStream = null;
    }
  }

  function exitRecordingMode() {
    document.body.classList.remove("recording");
    recordIcon.textContent = "⏺";
    recordLabel.textContent = "Record";
    mediaRecorder = null;
    recordingStream = null;
    recordedChunks = [];
  }

  btnRecord.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      startRecording();
    }
  });

  // Escape key stops recording
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mediaRecorder && mediaRecorder.state === "recording") {
      e.preventDefault();
      stopRecording();
    }
  });

  // ─── Background Color Picker ──────────────────────────
  const btnBg = $("#btn-bg");
  const bgLabel = $("#bg-label");
  const backdrop = $("#backdrop");
  const bgOptions = [
    { name: "Chroma", cls: "bg-chroma" },
    { name: "Off-white", cls: "bg-offwhite" },
    { name: "Dark Blue", cls: "bg-darkblue" },
    { name: "White", cls: "bg-white" },
  ];
  let bgIndex = 0;

  btnBg.addEventListener("click", () => {
    bgIndex = (bgIndex + 1) % bgOptions.length;
    const opt = bgOptions[bgIndex];
    backdrop.className = opt.cls;
    bgLabel.textContent = opt.name;
  });

  // ─── Boot ───────────────────────────────────────────
  loadModels();
  connect();
  inputText.focus();
})();
