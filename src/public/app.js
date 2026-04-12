// ─── Demo Video Generator – Frontend Logic (Multi-Session) ───────────────────
(() => {
  "use strict";

  // ═══════════════════════════════════════════════════════════
  // ─── UTILITIES ─────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  // API base URL: in Tauri production the frontend is served from tauri://
  // so API calls must target the actual Express server on localhost:3456
  const API_BASE = window.__TAURI_INTERNALS__ ? "http://localhost:3456" : "";

  // Feature flags
  const FEAT_AGENT_TABS = localStorage.getItem("dg-agent-tabs") === "1";
  const FEAT_TODO_PANEL = localStorage.getItem("dg-todo-panel") !== "0"; // on by default

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function hashPath(p) {
    let h = 0;
    for (let i = 0; i < p.length; i++) h = ((h << 5) - h + p.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  // ─── Dialog focus trap + Escape-to-close ─────────────────
  function setupDialogOverlay(overlayId, closeCallback) {
    const overlay = document.getElementById(overlayId);
    if (!overlay) return;
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeCallback();
        return;
      }
      if (e.key === "Tab") {
        const focusable = overlay.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    });
  }

  function renderMarkdown(text) {
    // Convert <system_notification> tags into styled notification lines
    text = text.replace(/<system_notification>([\s\S]*?)<\/system_notification>/g, (_, body) => {
      return `\n🔔 ${body.trim()}\n`;
    });
    // Strip other internal XML tags (reminders, hints, etc.)
    text = text.replace(/<\/?(reminder|todo_status|sql_tables|current_datetime|plan_mode)[^>]*>/g, "");
    // Clean up leftover blank lines from stripped tags
    text = text.replace(/\n{3,}/g, "\n\n");

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

  // ═══════════════════════════════════════════════════════════
  // ─── TERMINAL SESSION ──────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  class TerminalSession {
    constructor(id, manager, opts = {}) {
      this.id = id;
      this.manager = manager;
      this.ws = null;
      this._reconnectTimer = null;
      this.mode = "live";
      this.isProcessing = false;
      this.currentResponseEl = null;
      this.currentResponseText = "";
      this._streamRafPending = false;
      this.questionCheckPending = false;
      this.selectedProject = opts.project || null;
      this.selectedModel = opts.model || "";
      this.selectedAgent = null;
      this.copilotMode = "interactive";
      this.isSessionReady = false;
      this._onReadyCallbacks = [];
      this._pendingDemoPlan = null; // tracks {format} when generating a demo plan
      this.cachedAgents = [];
      this.cachedSkills = [];
      this.cachedMcpServers = [];
      this.cachedTools = [];
      this.excludedTools = new Set();
      this.discoveredMcpTools = {};
      this._agentsAnnounced = false;
      this.toolCallElements = new Map();
      this.pendingFiles = new Map();
      this.openedFiles = new Set();
      this.activeSubAgents = [];
      this.subAgentToolMap = new Map();
      this.floatingEl = null;
      this.sessionNum = parseInt(id.replace("session-", ""), 10);
      this.promptHistory = [];
      this.historyIndex = -1;
      this.historySavedInput = "";
      this.todos = new Map();
      this.todoPanelVisible = false;
      this._pendingSqlQuery = null;

      this.dom = this._createDOM();
    }

    _displayName() {
      const proj = this.selectedProject ? this.selectedProject.split("/").pop() : "";
      return proj ? proj + " · Session " + this.sessionNum : "Session " + this.sessionNum;
    }

    _updateTitles() {
      const name = this._displayName();
      const tab = document.querySelector('[data-session-tab="' + this.id + '"]');
      if (tab) {
        const label = tab.querySelector(".session-tab-name");
        if (label) label.textContent = name;
      }
      if (this.floatingEl) {
        const ft = this.floatingEl.querySelector(".floating-title");
        if (ft) ft.textContent = name;
      }
    }

    _createDOM() {
      const container = document.createElement("div");
      container.className = "session-container";
      container.dataset.sessionId = this.id;

      const body = document.createElement("div");
      body.className = "window-body session-body";

      const output = document.createElement("div");
      output.className = "terminal-output";
      output.setAttribute("aria-live", "polite");
      output.setAttribute("aria-relevant", "additions");

      const inputLine = document.createElement("div");
      inputLine.className = "input-line";
      inputLine.innerHTML = '<span class="prompt-symbol">\u276f</span><span class="session-input" contenteditable="true" spellcheck="false"></span>';

      const statusBar = document.createElement("div");
      statusBar.className = "window-statusbar";
      statusBar.innerHTML = '<span class="status-text">Ready</span><span class="status-cwd status-dim"></span><span class="status-branch status-dim"></span><span class="status-approve status-dim"></span><span class="status-agent status-dim"></span><span class="status-mode status-dim"></span><span class="status-model status-dim"></span>';

      body.appendChild(output);
      body.appendChild(inputLine);

      // Todo side panel
      const todoPanel = document.createElement("div");
      todoPanel.className = "todo-panel";
      todoPanel.innerHTML =
        '<div class="todo-panel-header">' +
          '<span class="todo-panel-title">\u2611 Tasks</span>' +
          '<button class="todo-panel-close" title="Hide">\u00d7</button>' +
        '</div>' +
        '<div class="todo-panel-list"></div>';
      todoPanel.querySelector(".todo-panel-close").addEventListener("click", () => this._toggleTodoPanel(false));

      const mainArea = document.createElement("div");
      mainArea.className = "session-main";
      mainArea.appendChild(body);
      mainArea.appendChild(todoPanel);

      container.appendChild(mainArea);
      container.appendChild(statusBar);

      const inputEl = inputLine.querySelector(".session-input");
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp" && !e.shiftKey) {
          if (this.promptHistory.length === 0) return;
          e.preventDefault();
          if (this.historyIndex === -1) {
            this.historySavedInput = inputEl.textContent;
            this.historyIndex = this.promptHistory.length - 1;
          } else if (this.historyIndex > 0) {
            this.historyIndex--;
          }
          inputEl.textContent = this.promptHistory[this.historyIndex];
          this._placeCaretAtEnd(inputEl);
          return;
        }
        if (e.key === "ArrowDown" && !e.shiftKey) {
          if (this.historyIndex === -1) return;
          e.preventDefault();
          if (this.historyIndex < this.promptHistory.length - 1) {
            this.historyIndex++;
            inputEl.textContent = this.promptHistory[this.historyIndex];
          } else {
            this.historyIndex = -1;
            inputEl.textContent = this.historySavedInput;
          }
          this._placeCaretAtEnd(inputEl);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const text = inputEl.textContent.trim();
          if (!text || this.isProcessing) return;
          this.promptHistory.push(text);
          this.historyIndex = -1;
          this.historySavedInput = "";
          this.addCommandEntry(text);
          inputEl.textContent = "";
          this.setProcessing(true);
          this.setStatus("Thinking...");
          if (this.copilotMode === "demo_plan") {
            this._pendingDemoPlan = { format: "demogod" };
            this.send("generate_demo_plan", {
              description: text,
              target: "self",
              outputFormat: "demogod",
            });
          } else {
            this.send("send_prompt", { prompt: text });
          }
        }
      });

      body.addEventListener("click", (e) => {
        if (this.mode === "live" && !this.isProcessing) {
          if (e.target.closest(".inline-question-form")) return;
          const sel = window.getSelection();
          if (sel && sel.toString().length > 0) return;
          inputEl.focus();
        }
      });

      inputEl.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text/plain");
        document.execCommand("insertText", false, text);
      });

      inputEl.addEventListener("focus", () => {
        inputEl.classList.add("touched");
      });

      return { container, body, output, inputLine, inputEl, statusBar, todoPanel };
    }

    _placeCaretAtEnd(el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // ── Todo panel logic ──────────────────────────────

    _parseTodoFromSql(query, result) {
      if (!query) return;
      const q = query.toUpperCase();
      const isTodoQuery = /\bTODOS\b/.test(q);
      if (!isTodoQuery) return;

      // Parse INSERT INTO todos
      if (/INSERT\s+INTO\s+TODOS/i.test(query)) {
        this._parseTodoInsert(query);
      }
      // Parse UPDATE todos SET status
      if (/UPDATE\s+TODOS\s+SET/i.test(query)) {
        this._parseTodoUpdate(query);
      }
      // Also parse result rows (from SELECTs or INSERT returning)
      if (result) {
        this._parseTodoResult(result);
      }
      this._renderTodos();
    }

    _parseTodoInsert(query) {
      // Match: INSERT INTO todos (cols) VALUES (row1), (row2), ...
      const colMatch = query.match(/INSERT\s+INTO\s+todos\s*\(([^)]+)\)\s*VALUES\s*/i);
      if (!colMatch) return;
      const cols = colMatch[1].split(",").map(c => c.trim().toLowerCase());
      const valuesStr = query.slice(colMatch.index + colMatch[0].length);
      // Extract each (...) tuple
      const tupleRe = /\(([^)]+)\)/g;
      let m;
      while ((m = tupleRe.exec(valuesStr)) !== null) {
        const vals = this._splitSqlValues(m[1]);
        const row = {};
        cols.forEach((col, i) => { row[col] = this._unquoteSql(vals[i] || ""); });
        if (row.id) {
          this.todos.set(row.id, {
            id: row.id,
            title: row.title || row.id,
            description: row.description || "",
            status: row.status || "pending",
          });
        }
      }
    }

    _parseTodoUpdate(query) {
      // UPDATE todos SET status = 'done' WHERE id = 'x'
      const statusMatch = query.match(/SET\s+status\s*=\s*'([^']+)'/i);
      const idMatch = query.match(/WHERE\s+id\s*=\s*'([^']+)'/i);
      if (statusMatch && idMatch) {
        const todo = this.todos.get(idMatch[1]);
        if (todo) todo.status = statusMatch[1];
      }
      // UPDATE todos SET status = 'x', description = '...' WHERE id = '...'
      if (!idMatch && statusMatch) {
        // Batch: UPDATE todos SET status = 'x' WHERE id IN (...)
        const inMatch = query.match(/WHERE\s+id\s+IN\s*\(([^)]+)\)/i);
        if (inMatch) {
          const ids = this._splitSqlValues(inMatch[1]).map(v => this._unquoteSql(v));
          ids.forEach(id => {
            const todo = this.todos.get(id);
            if (todo) todo.status = statusMatch[1];
          });
        }
      }
    }

    _parseTodoResult(result) {
      let text = typeof result === "string" ? result : JSON.stringify(result);
      // Try to find JSON array of rows
      try {
        const parsed = typeof result === "string" ? JSON.parse(result) : result;
        const rows = Array.isArray(parsed) ? parsed : (parsed?.rows || parsed?.results || []);
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (row?.id && (row.title || row.status)) {
              this.todos.set(row.id, {
                id: row.id,
                title: row.title || row.id,
                description: row.description || "",
                status: row.status || "pending",
              });
            }
          }
        }
      } catch {}
    }

    _splitSqlValues(str) {
      // Split SQL values respecting quoted strings
      const vals = [];
      let current = "";
      let inQuote = false;
      let quoteChar = "";
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (inQuote) {
          if (ch === quoteChar && str[i + 1] === quoteChar) {
            current += ch;
            i++;
          } else if (ch === quoteChar) {
            inQuote = false;
          }
          current += ch;
        } else if (ch === "'" || ch === '"') {
          inQuote = true;
          quoteChar = ch;
          current += ch;
        } else if (ch === ",") {
          vals.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
      vals.push(current.trim());
      return vals;
    }

    _unquoteSql(val) {
      if (!val) return "";
      const trimmed = val.trim();
      if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
          (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
        return trimmed.slice(1, -1).replace(/''/g, "'");
      }
      return trimmed;
    }

    _toggleTodoPanel(show) {
      this.todoPanelVisible = typeof show === "boolean" ? show : !this.todoPanelVisible;
      this.dom.todoPanel.classList.toggle("visible", this.todoPanelVisible);
    }

    _renderTodos() {
      const list = this.dom.todoPanel.querySelector(".todo-panel-list");
      if (!list) return;
      if (this.todos.size === 0) return;

      // Auto-show panel on first todo
      if (!this.todoPanelVisible) this._toggleTodoPanel(true);

      const statusIcons = {
        pending: "\u23f3",
        in_progress: "\ud83d\udd04",
        done: "\u2705",
        blocked: "\ud83d\udeab",
      };
      const statusOrder = { in_progress: 0, pending: 1, blocked: 2, done: 3 };
      const sorted = [...this.todos.values()].sort((a, b) =>
        (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1)
      );

      list.innerHTML = sorted.map(t => {
        const icon = statusIcons[t.status] || "\u23f3";
        const cls = "todo-item todo-" + (t.status || "pending");
        const desc = t.description ? '<div class="todo-desc">' + escapeHtml(t.description) + '</div>' : "";
        return '<div class="' + cls + '">' +
          '<span class="todo-icon">' + icon + '</span>' +
          '<div class="todo-content">' +
            '<div class="todo-title">' + escapeHtml(t.title) + '</div>' +
            desc +
          '</div>' +
        '</div>';
      }).join("");
    }

    _createFloatingChrome() {
      const chrome = document.createElement("div");
      chrome.className = "floating-titlebar";
      chrome.innerHTML = `
        <span class="floating-title">${escapeHtml(this._displayName())}</span>
        <div class="floating-controls">
          <button class="floating-btn floating-minimize" title="Minimize">\u2212</button>
          <button class="floating-btn floating-maximize" title="Maximize">\u25A1</button>
          <button class="floating-btn floating-close" title="Close">\u00d7</button>
        </div>
      `;

      chrome.querySelector(".floating-minimize").addEventListener("click", () => {
        this.manager.floatingManager.minimize(this.id);
      });
      chrome.querySelector(".floating-maximize").addEventListener("click", () => {
        this.manager.floatingManager.maximize(this.id);
      });
      chrome.querySelector(".floating-close").addEventListener("click", () => {
        this.manager.destroySession(this.id);
      });

      return chrome;
    }

    connect() {
      const wsHost = window.__TAURI_INTERNALS__ ? "localhost:3456" : location.host;
      const protocol = window.__TAURI_INTERNALS__ ? "ws:" : (location.protocol === "https:" ? "wss:" : "ws:");
      const token = document.querySelector('meta[name="dg-token"]')?.getAttribute("content") || "";
      this.ws = new WebSocket(`${protocol}//${wsHost}?token=${encodeURIComponent(token)}`);
      this.ws.onopen = () => {
        this.setStatus("Connected", "\u25cf");
        this.send("create_session", {
          workingDirectory: this.selectedProject,
          model: this.selectedModel || undefined,
        });
      };
      this.ws.onmessage = (evt) => this.handleMessage(JSON.parse(evt.data));
      this.ws.onclose = () => {
        this.setStatus("Disconnected");
        this._reconnectTimer = setTimeout(() => this.connect(), 2000);
      };
      this.ws.onerror = () => this.ws.close();
    }

    disconnect() {
      if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
      if (this.ws) {
        this.ws.onclose = null;
        this.ws.close();
        this.ws = null;
      }
    }

    send(type, payload = {}) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type, ...payload }));
      }
    }

    _isActive() {
      return this.manager.activeSessionId === this.id;
    }

    _syncControlBarIfActive() {
      if (this._isActive()) {
        this.manager._syncControlBar(this);
      }
    }

    handleMessage(msg) {
      console.log(`[WS:${this.id}]`, msg.type, msg);
      if (this._oneShotHandler) {
        this._oneShotHandler(msg);
        if (msg.type === "demo_plan_saved") this._oneShotHandler = null;
      }
      switch (msg.type) {
        case "session_ready": {
          this.isSessionReady = true;
          for (const cb of this._onReadyCallbacks) cb();
          this._onReadyCallbacks = [];
          this.setStatus("Ready");
          this.setProcessing(false);
          const dir = msg.workingDirectory;
          const smEl = this.dom.statusBar.querySelector(".status-model");
          const scEl = this.dom.statusBar.querySelector(".status-cwd");
          if (msg.model && smEl) {
            smEl.textContent = msg.model;
            // Don't store "(default)" as selectedModel — it's a display label, not a valid model ID
            if (msg.model !== "(default)") {
              this.selectedModel = msg.model;
            }
          }
          if (dir && scEl) {
            const short = dir.split("/").pop() || dir;
            scEl.textContent = "\ud83d\udcc2 " + short;
            scEl.title = dir;
          }
          const brEl = this.dom.statusBar.querySelector(".status-branch");
          if (msg.branch && brEl) {
            brEl.textContent = "\u2387 " + msg.branch;
            brEl.title = "Git branch: " + msg.branch;
          } else if (brEl) {
            brEl.textContent = "";
          }
          this._updateTitles();
          this.send("list_agents");
          this.send("list_skills");
          this.send("get_mode");
          this.send("set_auto_approve", { enabled: localStorage.getItem("dg-auto-approve") !== "0" });
          const approveEl = this.dom.statusBar.querySelector(".status-approve");
          if (approveEl && localStorage.getItem("dg-auto-approve") !== "0") {
            approveEl.textContent = "auto-approve";
            approveEl.style.color = "var(--yellow)";
          }
          this._syncControlBarIfActive();

          // "What's new" notification after update
          if (msg.version) {
            const lastSeen = localStorage.getItem("dg-last-version");
            if (lastSeen && lastSeen !== msg.version) {
              this.appendSystemMessage(
                `Updated to v${msg.version} — [What's new](https://github.com/suuus/demogod/blob/main/CHANGELOG.md)`,
                "info"
              );
            }
            localStorage.setItem("dg-last-version", msg.version);
          }

          // Update available notification
          if (msg.latestVersion) {
            this.appendSystemMessage(
              `v${msg.latestVersion} is available (you have v${msg.version}). Run \`git pull && npm install\` to update.`,
              "info"
            );
          }
          break;
        }

        case "delta":
          this.questionCheckPending = true;
          this.appendDelta(msg.text);
          break;

        case "message":
          this.finishResponse(msg.content);
          break;

        case "idle":
          this.finishResponse();
          this.setStatus("Ready");
          this.setProcessing(false);
          if (this.questionCheckPending) {
            this.questionCheckPending = false;
            this.detectAndShowQuestion();
          }
          if (this._pendingDemoPlan) {
            this._showSaveDemoPlanButton(this._pendingDemoPlan.format);
            this._pendingDemoPlan = null;
          }
          break;

        case "error":
          this.appendSystemMessage("Error: " + msg.text, "error");
          this.setStatus("Error");
          this.setProcessing(false);
          break;

        case "user_input":
          this.questionCheckPending = false;
          this.setProcessing(false);
          this._showDialog(msg);
          break;

        case "permission_request": {
          const kindLabels = { shell: "🖥 Run command", write: "📝 Write file", read: "📂 Read file", mcp: "🔌 MCP call", url: "🌐 Open URL", "custom-tool": "🔧 Custom tool" };
          const label = kindLabels[msg.permissionKind] || msg.permissionKind;
          const detail = msg.details?.command || msg.details?.path || msg.details?.url || msg.details?.toolName || "";
          this.appendSystemMessage("⚠ Permission requested: " + label + (detail ? " — " + detail : ""), "warning");
          // Show inline confirmation
          const el = document.createElement("div");
          el.className = "permission-prompt";
          el.innerHTML = '<span class="permission-label">' + escapeHtml(label) + (detail ? ': <code>' + escapeHtml(detail) + '</code>' : '') + '</span>' +
            '<button class="permission-btn permission-allow" data-req="' + escapeHtml(String(msg.requestId)) + '">Allow</button>' +
            '<button class="permission-btn permission-deny" data-req="' + escapeHtml(String(msg.requestId)) + '">Deny</button>';
          el.querySelector(".permission-allow").addEventListener("click", () => {
            this.send("permission_response", { requestId: msg.requestId, approved: true });
            el.remove();
          });
          el.querySelector(".permission-deny").addEventListener("click", () => {
            this.send("permission_response", { requestId: msg.requestId, approved: false });
            el.remove();
          });
          this.dom.output.appendChild(el);
          this.dom.output.scrollTop = this.dom.output.scrollHeight;
          break;
        }

        case "tool_start": {
          // Don't show generic tool chip for task tool when agent tabs handle it
          if (FEAT_AGENT_TABS && msg.toolName === "task") break;
          this.showToolIndicator(msg.toolName, true, msg.parentToolCallId);
          let toolArgs = msg.toolArgs;
          if (typeof toolArgs === "string") {
            try { toolArgs = JSON.parse(toolArgs); } catch {}
          }
          if (["create", "edit", "view", "show_file"].includes(msg.toolName) && toolArgs?.path) {
            this.trackPendingFile(msg.toolName, toolArgs.path);
          }
          if (FEAT_TODO_PANEL && msg.toolName === "sql" && toolArgs?.query) {
            this._pendingSqlQuery = toolArgs.query;
          }
          break;
        }

        case "tool_complete":
          // Don't show generic tool chip for task tool when agent tabs handle it
          if (FEAT_AGENT_TABS && msg.toolName === "task") break;
          this.showToolIndicator(msg.toolName, false, msg.parentToolCallId);
          this.checkPendingFile(msg.toolName);
          if (FEAT_TODO_PANEL && msg.toolName === "sql") {
            this._parseTodoFromSql(this._pendingSqlQuery, msg.toolResult);
            this._pendingSqlQuery = null;
          }
          break;

        case "tool_partial":
          this.updateToolPartial(msg.toolCallId, msg.partialOutput);
          break;

        case "tool_progress":
          this.updateToolProgress(msg.toolCallId, msg.progressMessage);
          break;

        case "file_changed":
          if (msg.path && /\.md$/i.test(msg.path)) {
            openFileInTab(msg.path);
          }
          break;

        case "subagent_start":
          this.appendSystemMessage("Sub-agent started: " + (msg.agentDisplayName || msg.agentName), "info");
          if (FEAT_AGENT_TABS) this._openSubAgentTab(msg.agentName, msg.agentDisplayName || msg.agentName, msg.agentType, msg.agentDescription);
          break;

        case "subagent_complete":
          this.appendSystemMessage("Sub-agent completed: " + (msg.agentDisplayName || msg.agentName), "info");
          if (FEAT_AGENT_TABS) this._completeSubAgentTab(msg.agentName, msg.result);
          break;

        case "subagent_output":
          if (FEAT_AGENT_TABS) this._appendSubAgentOutput(msg.agentName, msg.result);
          break;

        case "task_complete":
          if (msg.summary) {
            addReportTab("Summary", msg.summary);
          }
          break;

        case "intent":
          this.setStatus(msg.text);
          break;

        case "capabilities_loaded":
          this.handleCapabilitiesLoaded(msg);
          if (msg.kind === "mcp_servers" && msg.items) this.cachedMcpServers = msg.items;
          if (msg.kind === "skills" && msg.items) this.cachedSkills = msg.items;
          if (window._capabilitiesOpen) window._renderCapabilities();
          break;

        case "mcp_status":
          console.log("[MCP] " + msg.serverName + ": " + msg.status);
          if (msg.serverName && this.cachedMcpServers.length > 0) {
            const srv = this.cachedMcpServers.find(s => s.name === msg.serverName);
            if (srv) srv.status = msg.status;
            if (window._capabilitiesOpen) window._renderCapabilities();
          }
          break;

        case "mcp_tools_discovered":
          if (msg.serverName && msg.tools) {
            this.discoveredMcpTools[msg.serverName] = msg.tools;
            if (window._capabilitiesOpen) window._renderCapabilities();
          }
          break;

        case "agents_list":
          this.cachedAgents = msg.agents || [];
          if (!this._agentsAnnounced && this.cachedAgents.length > 0) {
            this._agentsAnnounced = true;
            this.appendSystemMessage("\u2713 " + this.cachedAgents.length + " agents loaded", "info");
          }
          break;

        case "skills_list":
          this.cachedSkills = msg.skills || [];
          break;

        case "capabilities_list":
        case "capabilities_update":
          if (msg.mcpServers) this.cachedMcpServers = msg.mcpServers;
          if (msg.skills) this.cachedSkills = msg.skills;
          if (msg.tools) this.cachedTools = msg.tools;
          if (msg.mcpTools) Object.assign(this.discoveredMcpTools, msg.mcpTools);
          if (window._capabilitiesOpen) window._renderCapabilities();
          break;

        case "model_changed": {
          this.selectedModel = msg.model;
          const smEl2 = this.dom.statusBar.querySelector(".status-model");
          if (smEl2) smEl2.textContent = msg.model;
          this.appendSystemMessage("Model changed to " + msg.model, "info");
          this._syncControlBarIfActive();
          break;
        }

        case "agent_selected": {
          this.selectedAgent = msg.agent;
          const saEl = this.dom.statusBar.querySelector(".status-agent");
          if (saEl) saEl.textContent = "\ud83e\udd16 " + (msg.agent?.displayName || msg.agent?.name);
          this.appendSystemMessage("Agent switched to " + (msg.agent?.displayName || msg.agent?.name), "info");
          this._syncControlBarIfActive();
          break;
        }

        case "agent_deselected": {
          this.selectedAgent = null;
          const saEl2 = this.dom.statusBar.querySelector(".status-agent");
          if (saEl2) saEl2.textContent = "";
          this.appendSystemMessage("Agent reset to default", "info");
          this._syncControlBarIfActive();
          break;
        }

        case "mode_current":
        case "mode_changed": {
          this.copilotMode = msg.mode;
          const modeLabelsMap = { interactive: "Interactive", plan: "Plan", autopilot: "Autopilot", demo_plan: "Demo Plan" };
          const modeIconsMap = { interactive: "\ud83c\udfaf", plan: "\ud83d\udccb", autopilot: "\ud83d\ude80", demo_plan: "\ud83c\udfac" };
          const smodeEl = this.dom.statusBar.querySelector(".status-mode");
          if (smodeEl) {
            smodeEl.textContent = (modeIconsMap[msg.mode] || "") + " " + (modeLabelsMap[msg.mode] || msg.mode);
          }
          // Update border color based on mode
          this.dom.container.dataset.copilotMode = msg.mode;
          if (this.floatingEl) this.floatingEl.dataset.copilotMode = msg.mode;
          if (msg.type === "mode_changed") {
            this.appendSystemMessage("Mode switched to " + (modeLabelsMap[msg.mode] || msg.mode), "info");
          }
          this._syncControlBarIfActive();
          break;
        }

        case "demo_step_command":
          this.playScriptedCommand(msg.text, msg.typingSpeed || 45);
          break;

        case "demo_step_question":
          this._showDialog(msg, true);
          break;

        case "demo_step_response":
          this.simulateStreamingResponse(msg.text);
          break;

        case "demo_complete":
          this.appendSystemMessage("Demo complete \u2713");
          this.setProcessing(false);
          break;

        case "demo_action":
          this._handleDemoAction(msg);
          break;

        case "demo_plan_saved":
          if (msg.format === "playwright") {
            this.appendSystemMessage(`Playwright spec saved! Run with:\n\`${msg.runCommand}\``, "info");
          } else {
            this.appendSystemMessage(`Demo "${msg.name}" saved! Select it from the demo picker to play.`, "info");
          }
          break;
      }
    }

    addCommandEntry(text) {
      const entry = document.createElement("div");
      entry.className = "entry";

      const cmdLine = document.createElement("div");
      cmdLine.className = "entry-command";
      cmdLine.innerHTML = '<span class="prompt-symbol">\u276f</span><span class="command-text"></span>';
      cmdLine.querySelector(".command-text").textContent = text;

      const responseDiv = document.createElement("div");
      responseDiv.className = "entry-response";

      entry.appendChild(cmdLine);
      entry.appendChild(responseDiv);
      this.dom.output.appendChild(entry);

      this.currentResponseEl = responseDiv;
      this.currentResponseText = "";
      this.scrollToBottom();

      return entry;
    }

    appendDelta(text) {
      if (!this.currentResponseEl) {
        const entry = document.createElement("div");
        entry.className = "entry";
        const responseDiv = document.createElement("div");
        responseDiv.className = "entry-response";
        entry.appendChild(responseDiv);
        this.dom.output.appendChild(entry);
        this.currentResponseEl = responseDiv;
        this.currentResponseText = "";
        // Suppress aria-live during streaming to avoid excessive announcements
        this.dom.output.setAttribute("aria-live", "off");
      }
      this.currentResponseText += text;
      if (!this._streamRafPending) {
        this._streamRafPending = true;
        requestAnimationFrame(() => {
          this._streamRafPending = false;
          if (this.currentResponseEl) {
            this.currentResponseEl.innerHTML = renderMarkdown(this.currentResponseText) +
              '<span class="streaming-cursor"></span>';
            this.scrollToBottom();
          }
        });
      }
    }

    finishResponse(finalContent) {
      if (this.currentResponseEl) {
        if (finalContent && typeof finalContent === "string") {
          this.currentResponseText = finalContent;
          this.currentResponseEl.innerHTML = renderMarkdown(finalContent);
        }
        const cur = this.currentResponseEl.querySelector(".streaming-cursor");
        if (cur) cur.remove();
        this.currentResponseEl = null;
        // Re-enable aria-live after streaming completes
        this.dom.output.setAttribute("aria-live", "polite");
      }
    }

    appendSystemMessage(text, type = "info") {
      const el = document.createElement("div");
      el.className = "entry";
      el.innerHTML = '<div class="entry-response" style="color: var(--' + (type === "error" ? "red" : "overlay0") + '); font-style: italic; font-size: 12.5px;">' + escapeHtml(text) + '</div>';
      this.dom.output.appendChild(el);
      this.scrollToBottom();
    }

    showToolIndicator(toolName, running, parentToolCallId) {
      const isSubAgent = !!parentToolCallId;
      const prefix = isSubAgent ? "\u2937 " : "";
      const key = (parentToolCallId || "root") + ":" + toolName;
      const existing = this.dom.output.querySelector('[data-tool-key="' + CSS.escape(key) + '"]');
      if (existing && !running) {
        existing.classList.add("tool-done");
        existing.innerHTML = '<span class="tool-check">\u2713</span> ' + prefix + escapeHtml(toolName);
        setTimeout(() => existing.remove(), 3000);
        return;
      }
      if (running && !existing) {
        const el = document.createElement("div");
        el.className = isSubAgent ? "tool-indicator tool-subagent" : "tool-indicator";
        el.setAttribute("data-tool-key", key);
        el.setAttribute("data-tool", toolName);
        el.innerHTML = '<span class="spinner"></span> ' + prefix + 'Running ' + escapeHtml(toolName);
        this.dom.output.appendChild(el);
        this.scrollToBottom();
      }
    }

    updateToolPartial(toolCallId, partialOutput) {
      if (!toolCallId || !partialOutput) return;
      let el = this.toolCallElements.get(toolCallId);
      if (!el) {
        el = document.createElement("div");
        el.className = "tool-partial-output";
        this.dom.output.appendChild(el);
        this.toolCallElements.set(toolCallId, el);
      }
      el.textContent = partialOutput.substring(0, 300);
      this.scrollToBottom();
    }

    updateToolProgress(toolCallId, progressMessage) {
      if (!toolCallId || !progressMessage) return;
      let el = this.toolCallElements.get(toolCallId);
      if (!el) {
        el = document.createElement("div");
        el.className = "tool-partial-output";
        this.dom.output.appendChild(el);
        this.toolCallElements.set(toolCallId, el);
      }
      el.textContent = progressMessage;
      this.scrollToBottom();
    }

    scrollToBottom() {
      this.dom.body.scrollTop = this.dom.body.scrollHeight;
    }

    /** Call fn immediately if session is ready, or queue it for when session_ready fires. */
    onReady(fn) {
      if (this.isSessionReady) fn();
      else this._onReadyCallbacks.push(fn);
    }

    /** Show a save button after demo plan generation completes. */
    _showSaveDemoPlanButton(format) {
      // Extract the generated content from the last response
      const responseEls = this.dom.output.querySelectorAll(".response-text");
      const lastResponse = responseEls[responseEls.length - 1];
      if (!lastResponse) return;

      const responseText = lastResponse.textContent || "";

      const bar = document.createElement("div");
      bar.style.cssText = "display:flex; gap:8px; padding:8px 0; align-items:center;";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "demo-name";
      nameInput.value = "generated-demo";
      nameInput.style.cssText = "background:var(--mantle); color:var(--body-text); border:1px solid var(--surface1); border-radius:4px; padding:4px 8px; font-size:12px; width:140px;";

      const saveBtn = document.createElement("button");
      saveBtn.textContent = format === "playwright" ? "💾 Save Playwright Spec" : "💾 Save & Play Demo";
      saveBtn.style.cssText = "background:var(--accent); color:#1e1e2e; border:none; border-radius:4px; padding:6px 12px; font-size:12px; cursor:pointer; font-weight:600;";

      const statusSpan = document.createElement("span");
      statusSpan.style.cssText = "font-size:12px; color:var(--body-dim);";

      saveBtn.addEventListener("click", () => {
        const name = nameInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
        if (!name) { statusSpan.textContent = "Enter a valid name (a-z, 0-9, -, _)"; return; }
        saveBtn.disabled = true;
        statusSpan.textContent = "Saving...";
        this.send("save_demo_plan", { name, format, content: responseText });

        const origHandler = this.handleMessage.bind(this);
        const onSaved = (msg) => {
          if (msg.type === "demo_plan_saved") {
            if (format === "playwright") {
              statusSpan.textContent = `✓ Saved! Run: npm run test:generated`;
            } else {
              statusSpan.textContent = `✓ Saved! Run: npm run record -- --demo ${msg.name}`;
            }
            saveBtn.textContent = "✓ Saved";
          }
        };
        this._oneShotHandler = onSaved;
      });

      bar.appendChild(nameInput);
      bar.appendChild(saveBtn);
      bar.appendChild(statusSpan);
      this.dom.output.appendChild(bar);
      this.scrollToBottom();
    }

    // ─── Sub-agent tab helpers ──────────────────────────
    _openSubAgentTab(agentName, displayName, agentType, description) {
      // Deduplicate — don't open a second tab for the same agent
      if (this.activeSubAgents.find(a => a.agentName === agentName)) return;

      const typeIcon = { explore: "\ud83d\udd0d", task: "\u2699\ufe0f", "general-purpose": "\ud83e\udde0", "code-review": "\ud83d\udcdd" }[agentType] || "\ud83e\udd16";
      const typeBadge = agentType ? ' <span class="agent-type-badge">' + escapeHtml(agentType) + '</span>' : "";
      const subtitle = description ? '<div class="agent-tab-desc">' + escapeHtml(description) + '</div>' : "";

      const tabId = "agent-" + (++tabCounter);
      const tab = document.createElement("div");
      tab.className = "tab";
      tab.dataset.tab = tabId;
      tab.innerHTML =
        '<span class="tab-icon">' + typeIcon + '</span>' +
        '<span class="tab-label">' + escapeHtml(displayName) + '</span>' +
        '<span class="tab-close" title="Close tab">\u2715</span>';
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

      const panel = document.createElement("div");
      panel.className = "tab-panel";
      panel.id = "panel-" + tabId;

      const agentPanel = document.createElement("div");
      agentPanel.className = "agent-tab-panel";

      const header = document.createElement("div");
      header.className = "agent-tab-header";
      header.innerHTML =
        '<span class="spinner"></span>' +
        '<span class="agent-tab-name">' + escapeHtml(displayName) + typeBadge + '</span>' +
        '<span class="agent-tab-status running">running</span>' +
        subtitle;

      const content = document.createElement("div");
      content.className = "agent-tab-content";

      agentPanel.appendChild(header);
      agentPanel.appendChild(content);
      panel.appendChild(agentPanel);
      tabPanels.appendChild(panel);

      const entry = { agentName, displayName, tabId, headerEl: header, contentEl: content, panelEl: agentPanel };
      this.activeSubAgents.push(entry);

      switchTab(tabId);
    }

    _completeSubAgentTab(agentName, result) {
      const agent = this.activeSubAgents.find(a => a.agentName === agentName);
      if (!agent) return;

      const statusEl = agent.headerEl.querySelector(".agent-tab-status");
      const spinnerEl = agent.headerEl.querySelector(".spinner");

      // Parse structured result — extract meaningful content
      let displayText = "";
      let isBackground = false;
      let agentId = "";
      if (result) {
        displayText = result;
        try {
          const parsed = typeof result === "string" ? JSON.parse(result) : result;
          if (parsed.sessionLog) {
            displayText = parsed.sessionLog;
          } else if (parsed.textResultForLlm) {
            displayText = parsed.textResultForLlm;
          }
          if (parsed.resultType === "success" && parsed.toolTelemetry?.properties?.execution_mode === "background") {
            isBackground = true;
            agentId = parsed.toolTelemetry?.restrictedProperties?.agent_id || "";
            agent._agentId = agentId;
            if (statusEl) { statusEl.className = "agent-tab-status running"; statusEl.textContent = "\u23f3 background"; }
          }
        } catch {}
      }

      if (!isBackground) {
        // Sync agent done — remove from active list
        const idx = this.activeSubAgents.indexOf(agent);
        if (idx !== -1) this.activeSubAgents.splice(idx, 1);
        if (statusEl) { statusEl.className = "agent-tab-status done"; statusEl.textContent = "\u2713 completed"; }
        if (spinnerEl) spinnerEl.remove();
        if (displayText) {
          const resultEl = document.createElement("div");
          resultEl.className = "agent-tab-result";
          const pre = document.createElement("pre");
          pre.textContent = displayText;
          resultEl.appendChild(pre);
          agent.contentEl.appendChild(resultEl);
          this._autoScrollAgent(agent);
        }
      }
      // Background agents stay in activeSubAgents so _appendSubAgentOutput can find them

      // Add badge if not active tab
      const tab = tabBar.querySelector('[data-tab="' + agent.tabId + '"]');
      if (tab && !tab.classList.contains("active")) {
        const badge = document.createElement("span");
        badge.className = "tab-badge";
        tab.appendChild(badge);
      }
    }

    _appendSubAgentOutput(agentName, result) {
      // Find by agentName or by _agentId
      const agent = this.activeSubAgents.find(
        a => a.agentName === agentName || a._agentId === agentName
      );
      if (!agent) return;

      let displayText = result || "";
      let isDone = false;
      try {
        const parsed = typeof result === "string" ? JSON.parse(result) : result;
        // read_agent returns turn history or final result
        if (parsed.status === "completed" || parsed.status === "failed") {
          isDone = true;
        }
        // Extract the actual content — could be in turns, result, or response
        if (parsed.response) {
          displayText = parsed.response;
        } else if (parsed.turns && Array.isArray(parsed.turns)) {
          displayText = parsed.turns.map(t => t.response || t.content || "").filter(Boolean).join("\n\n");
        } else if (parsed.result) {
          displayText = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result, null, 2);
        } else if (parsed.textResultForLlm) {
          displayText = parsed.textResultForLlm;
        }
      } catch {}

      // Append or replace content
      if (displayText) {
        agent.contentEl.innerHTML = "";
        const resultEl = document.createElement("div");
        resultEl.className = "agent-tab-result";
        const pre = document.createElement("pre");
        pre.textContent = displayText;
        resultEl.appendChild(pre);
        agent.contentEl.appendChild(resultEl);
        this._autoScrollAgent(agent);
      }

      if (isDone) {
        const statusEl = agent.headerEl.querySelector(".agent-tab-status");
        if (statusEl) { statusEl.className = "agent-tab-status done"; statusEl.textContent = "\u2713 completed"; }
        const spinnerEl = agent.headerEl.querySelector(".spinner");
        if (spinnerEl) spinnerEl.remove();
        // Remove from active list
        const idx = this.activeSubAgents.indexOf(agent);
        if (idx !== -1) this.activeSubAgents.splice(idx, 1);
      }
    }

    _autoScrollAgent(agent) {
      const panel = agent.panelEl;
      const isNearBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 60;
      if (isNearBottom) {
        panel.scrollTop = panel.scrollHeight;
      }
    }


    setProcessing(processing) {
      this.isProcessing = processing;
      this.dom.inputLine.classList.toggle("disabled", processing);
      if (!processing && this.mode === "live" && this._isActive()) {
        this.dom.inputEl.focus();
      }
      this.manager._updateSessionTabDot(this.id, processing);
    }

    setStatus(text, icon = "") {
      const el = this.dom.statusBar.querySelector(".status-text");
      if (el) el.textContent = icon ? icon + " " + text : text;
    }

    handleCapabilitiesLoaded(msg) {
      const items = msg.items || [];
      const kind = msg.kind;
      const count = items.length;
      if (kind === "skills") {
        const enabled = items.filter((s) => s.enabled);
        console.log("[Capabilities] " + enabled.length + "/" + count + " skills loaded", items);
        this.appendSystemMessage("\u2713 " + enabled.length + " skills loaded", "info");
      } else if (kind === "agents") {
        console.log("[Capabilities] " + count + " agents loaded", items);
        if (msg.errors?.length) {
          for (const err of msg.errors) this.appendSystemMessage("Agent error: " + err, "error");
        }
        this.appendSystemMessage("\u2713 " + count + " agents loaded", "info");
      } else if (kind === "mcp_servers") {
        const connected = items.filter((s) => s.status === "connected");
        const failed = items.filter((s) => s.status === "failed");
        console.log("[Capabilities] " + connected.length + "/" + count + " MCP servers connected", items);
        this.appendSystemMessage("\u2713 " + connected.length + "/" + count + " MCP servers connected", "info");
        for (const f of failed) {
          this.appendSystemMessage('MCP server "' + f.name + '" failed: ' + (f.error || "unknown"), "error");
        }
      } else if (kind === "extensions") {
        const running = items.filter((e) => e.status === "running");
        console.log("[Capabilities] " + running.length + "/" + count + " extensions running", items);
        if (count > 0) this.appendSystemMessage("\u2713 " + running.length + "/" + count + " extensions loaded", "info");
      }
    }

    detectAndShowQuestion() {
      if (!this.currentResponseText || this.currentResponseText.length < 10) return;

      const text = this.currentResponseText.trim();
      const lastLines = text.split("\n").slice(-5).join("\n");

      const questionPatterns = [
        /\?\s*$/,
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
      if (text.length > 2000) return;

      const questionText = lastLines.trim();

      if (!popupDialogs) {
        this._renderInlineQuestion(questionText, null, null, "__auto_question__");
        return;
      }

      pendingDialogRequestId = "__auto_question__";
      pendingDialogSession = this;
      dialogMessage.textContent = questionText;
      dialogFields.innerHTML = "";

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

    _showDialog(msg, scripted = false) {
      const requestId = msg.requestId || null;
      const questionText = msg.message || "The assistant has a question:";
      const schema = msg.schema;
      const choices = msg.choices;

      if (!popupDialogs && !scripted) {
        this._renderInlineQuestion(questionText, schema, choices, requestId);
        return;
      }

      pendingDialogRequestId = requestId;
      pendingDialogSession = this;
      dialogMessage.textContent = questionText;
      dialogFields.innerHTML = "";

      buildFormFields(dialogFields, schema, choices);

      dialogOverlay.classList.remove("hidden");

      requestAnimationFrame(() => {
        const firstInput = dialogFields.querySelector("input, select");
        if (firstInput) firstInput.focus();
      });

      if (scripted && msg.autoAnswer) {
        const delay = msg.autoSubmitDelay || 2000;
        setTimeout(() => {
          for (const [key, value] of Object.entries(msg.autoAnswer)) {
            const field = dialogFields.querySelector('[name="' + key + '"]');
            if (field) field.value = value;
          }
        }, delay * 0.4);
        setTimeout(() => {
          submitDialog();
        }, delay);
      }
    }

    _renderInlineQuestion(message, schema, choices, requestId) {
      const entry = document.createElement("div");
      entry.className = "entry";

      const qDiv = document.createElement("div");
      qDiv.className = "entry-response";
      qDiv.style.color = "var(--accent)";
      qDiv.style.fontStyle = "italic";
      qDiv.textContent = "\ud83d\udcac " + message;
      entry.appendChild(qDiv);

      const formContainer = document.createElement("div");
      formContainer.className = "inline-question-form";
      buildFormFields(formContainer, schema, choices);

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
      this.dom.output.appendChild(entry);
      this.scrollToBottom();

      const self = this;

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
        if (requestId === "__auto_question__") {
          const answer = values.response || Object.values(values)[0] || "";
          if (answer) {
            self.addCommandEntry(answer);
            self.setProcessing(true);
            self.setStatus("Thinking...");
            self.send("send_prompt", { prompt: answer });
          }
        } else {
          self.setProcessing(true);
          self.send("user_input_response", { requestId, values });
        }
      });

      cancelBtn.addEventListener("click", () => {
        disableForm();
        if (requestId === "__auto_question__") return;
        self.setProcessing(true);
        self.send("user_input_response", { requestId, values: {} });
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

    _handleDemoAction(msg) {
      const action = msg.action;
      const value = msg.value;
      switch (action) {
        case "layout":
          this.manager.setLayoutMode(value || "floating");
          break;
        case "tile":
          this.manager.floatingManager.tileAll();
          break;
        case "model":
          if (value) {
            this.selectedModel = value;
            const smEl = this.dom.statusBar.querySelector(".status-model");
            if (smEl) smEl.textContent = value;
            this.send("set_model", { model: value });
            this.manager._syncControlBar(this);
          }
          break;
        case "open_file":
          if (value) this.send("open_file", { path: value });
          break;
        case "new_session":
          this.manager.createSession();
          break;
      }
    }

    async playScriptedCommand(text, speed = 45) {
      const entry = this.addCommandEntry("");
      const cmdText = entry.querySelector(".command-text");
      this.setProcessing(true);
      this.setStatus("Typing...");

      for (let i = 0; i < text.length; i++) {
        cmdText.textContent += text[i];
        this.scrollToBottom();
        await sleep(speed + Math.random() * 30);
      }
      await sleep(400);
    }

    async simulateStreamingResponse(text) {
      this.setStatus("Thinking...");
      await sleep(600);

      const words = text.split(/(?<=\s)/);
      for (const word of words) {
        this.appendDelta(word);
        await sleep(15 + Math.random() * 25);
      }
      this.finishResponse();
      this.setStatus("Ready");
    }

    trackPendingFile(toolName, filePath) {
      if (/\.(md|markdown)$/i.test(filePath)) {
        this.pendingFiles.set(toolName, { path: filePath });
      }
    }

    checkPendingFile(toolName) {
      const pending = this.pendingFiles.get(toolName);
      if (!pending) return;
      this.pendingFiles.delete(toolName);
      openFileInTab(pending.path);
    }

    selectProject(path) {
      this.selectedProject = path;
      this.dom.output.innerHTML = "";
      this.toolCallElements.clear();
      this.currentResponseEl = null;
      this.currentResponseText = "";
      this.setProcessing(false);
      this.setStatus("Switching project...");
      // Reset cached capabilities for fresh fetch
      this.cachedAgents = [];
      this.cachedSkills = [];
      this.cachedMcpServers = [];
      this.cachedTools = [];
      this.discoveredMcpTools = {};
      this._agentsAnnounced = false;
      this.send("create_session", { workingDirectory: this.selectedProject, model: this.selectedModel || undefined });
      this._updateTitles();
      this._syncControlBarIfActive();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ─── FLOATING WINDOW MANAGER ───────────────────────────────
  // ═══════════════════════════════════════════════════════════

  class FloatingWindowManager {
    constructor(container) {
      this.container = container;
      this.windows = new Map();
      this.highestZ = 100;
      this.snapThreshold = 30;
      this.previewEl = null;
    }

    register(sessionId, el) {
      const rect = el.getBoundingClientRect();
      this.windows.set(sessionId, {
        el,
        x: rect.left || 50,
        y: rect.top || 100,
        w: rect.width || 600,
        h: rect.height || 400,
        z: ++this.highestZ,
        minimized: false,
        maximized: false,
        prevRect: null,
      });
      this._applyPosition(sessionId);
    }

    unregister(sessionId) {
      this.windows.delete(sessionId);
    }

    bringToFront(sessionId) {
      const win = this.windows.get(sessionId);
      if (!win) return;
      this.highestZ++;
      win.z = this.highestZ;
      win.el.style.zIndex = win.z;
    }

    _makeDraggable(sessionId, titleBar) {
      let startX, startY, startLeft, startTop;
      let isDragging = false;

      titleBar.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".floating-btn")) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const win = this.windows.get(sessionId);
        startLeft = win.x;
        startTop = win.y;
        this.bringToFront(sessionId);
        titleBar.setPointerCapture(e.pointerId);
      });

      titleBar.addEventListener("pointermove", (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const win = this.windows.get(sessionId);
        win.x = startLeft + dx;
        win.y = startTop + dy;
        this._applyPosition(sessionId);
        this._showSnapPreview(e.clientX, e.clientY);
      });

      titleBar.addEventListener("pointerup", (e) => {
        if (!isDragging) return;
        isDragging = false;
        this._trySnap(sessionId, e.clientX, e.clientY);
        this._hideSnapPreview();
      });
    }

    _makeResizable(sessionId, el) {
      const handles = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
      for (const dir of handles) {
        const handle = document.createElement("div");
        handle.className = "resize-handle resize-" + dir;
        el.appendChild(handle);
        this._attachResizeListener(sessionId, handle, dir);
      }
    }

    _attachResizeListener(sessionId, handle, dir) {
      let startX, startY, startW, startH, startLeft, startTop;
      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        const win = this.windows.get(sessionId);
        startX = e.clientX; startY = e.clientY;
        startW = win.w; startH = win.h;
        startLeft = win.x; startTop = win.y;
        handle.setPointerCapture(e.pointerId);

        const onMove = (e2) => {
          const dx = e2.clientX - startX;
          const dy = e2.clientY - startY;
          if (dir.includes("e")) win.w = Math.max(400, startW + dx);
          if (dir.includes("w")) { win.w = Math.max(400, startW - dx); win.x = startLeft + (startW - win.w); }
          if (dir.includes("s")) win.h = Math.max(300, startH + dy);
          if (dir.includes("n")) { win.h = Math.max(300, startH - dy); win.y = startTop + (startH - win.h); }
          this._applyPosition(sessionId);
        };
        const onUp = () => {
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
      });
    }

    _getSnapZone(clientX, clientY) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const T = this.snapThreshold;
      const controlBarH = 50;

      if (clientY < controlBarH + T) return "full";
      if (clientX < T && clientY < H / 2) return "top-left";
      if (clientX < T && clientY >= H / 2) return "bottom-left";
      if (clientX < T) return "left";
      if (clientX > W - T && clientY < H / 2) return "top-right";
      if (clientX > W - T && clientY >= H / 2) return "bottom-right";
      if (clientX > W - T) return "right";
      return null;
    }

    _getSnapRect(zone) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const pad = 8;
      const top = 50 + pad;
      const h = H - top - pad;
      switch (zone) {
        case "left": return { x: pad, y: top, w: W / 2 - pad * 1.5, h: h };
        case "right": return { x: W / 2 + pad / 2, y: top, w: W / 2 - pad * 1.5, h: h };
        case "top-left": return { x: pad, y: top, w: W / 2 - pad * 1.5, h: h / 2 - pad / 2 };
        case "top-right": return { x: W / 2 + pad / 2, y: top, w: W / 2 - pad * 1.5, h: h / 2 - pad / 2 };
        case "bottom-left": return { x: pad, y: top + h / 2 + pad / 2, w: W / 2 - pad * 1.5, h: h / 2 - pad / 2 };
        case "bottom-right": return { x: W / 2 + pad / 2, y: top + h / 2 + pad / 2, w: W / 2 - pad * 1.5, h: h / 2 - pad / 2 };
        case "full": return { x: pad, y: top, w: W - pad * 2, h: h };
        default: return null;
      }
    }

    _showSnapPreview(clientX, clientY) {
      const zone = this._getSnapZone(clientX, clientY);
      if (!zone) { this._hideSnapPreview(); return; }
      const rect = this._getSnapRect(zone);
      if (!this.previewEl) {
        this.previewEl = document.createElement("div");
        this.previewEl.className = "snap-preview";
        this.container.appendChild(this.previewEl);
      }
      Object.assign(this.previewEl.style, {
        display: "block",
        left: rect.x + "px", top: rect.y + "px",
        width: rect.w + "px", height: rect.h + "px",
      });
    }

    _hideSnapPreview() {
      if (this.previewEl) this.previewEl.style.display = "none";
    }

    _trySnap(sessionId, clientX, clientY) {
      const zone = this._getSnapZone(clientX, clientY);
      if (!zone) return;
      const rect = this._getSnapRect(zone);
      const win = this.windows.get(sessionId);
      Object.assign(win, rect);
      this._applyPosition(sessionId, true);
    }

    _applyPosition(sessionId, animate = false) {
      const win = this.windows.get(sessionId);
      if (!win) return;
      win.el.style.transition = animate ? "all 0.2s ease" : "none";
      win.el.style.left = win.x + "px";
      win.el.style.top = win.y + "px";
      win.el.style.width = win.w + "px";
      win.el.style.height = win.h + "px";
      win.el.style.zIndex = win.z;
      if (animate) setTimeout(() => { win.el.style.transition = "none"; }, 250);
    }

    minimize(sessionId) {
      const win = this.windows.get(sessionId);
      if (!win) return;
      win.minimized = true;
      win.el.style.display = "none";
      this._updateDock();
    }

    maximize(sessionId) {
      const win = this.windows.get(sessionId);
      if (!win) return;
      if (win.maximized) {
        if (win.prevRect) {
          Object.assign(win, win.prevRect);
          win.prevRect = null;
        }
        win.maximized = false;
      } else {
        win.prevRect = { x: win.x, y: win.y, w: win.w, h: win.h };
        const rect = this._getSnapRect("full");
        Object.assign(win, rect);
        win.maximized = true;
      }
      this._applyPosition(sessionId, true);
    }

    _updateDock() {
      let dock = this.container.querySelector(".floating-dock");
      const minimized = [...this.windows.entries()].filter(([, w]) => w.minimized);

      if (minimized.length === 0) {
        if (dock) dock.remove();
        return;
      }
      if (!dock) {
        dock = document.createElement("div");
        dock.className = "floating-dock";
        this.container.appendChild(dock);
      }
      dock.innerHTML = "";
      for (const [id, win] of minimized) {
        const item = document.createElement("div");
        item.className = "dock-item";
        item.textContent = id.replace("session-", "Session ");
        item.addEventListener("click", () => {
          win.minimized = false;
          win.el.style.display = "";
          this.bringToFront(id);
          this._applyPosition(id);
          this._updateDock();
        });
        dock.appendChild(item);
      }
    }

    tileAll() {
      const ids = [...this.windows.keys()].filter(id => !this.windows.get(id).minimized);
      const n = ids.length;
      if (n === 0) return;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const pad = 8;
      const top = 50 + pad;
      const availH = H - top - pad;
      const availW = W - pad * 2;

      let cols, rows;
      if (n === 1) { cols = 1; rows = 1; }
      else if (n === 2) { cols = 2; rows = 1; }
      else if (n <= 4) { cols = 2; rows = 2; }
      else if (n <= 6) { cols = 3; rows = 2; }
      else { cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols); }

      const cellW = (availW - (cols - 1) * pad) / cols;
      const cellH = (availH - (rows - 1) * pad) / rows;

      let i = 0;
      for (const id of ids) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const win = this.windows.get(id);
        win.x = pad + col * (cellW + pad);
        win.y = top + row * (cellH + pad);
        win.w = cellW;
        win.h = cellH;
        win.minimized = false;
        win.el.style.display = "";
        this._applyPosition(id, true);
        i++;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ─── SESSION MANAGER ───────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  class SessionManager {
    constructor() {
      this.sessions = new Map();
      this.activeSessionId = null;
      this.layoutMode = localStorage.getItem("dg-layout") || "tabs";
      this.nextSessionNum = 1;
      this.floatingManager = new FloatingWindowManager(
        document.getElementById("floating-container")
      );
    }

    createSession(opts = {}) {
      const id = "session-" + this.nextSessionNum++;
      const session = new TerminalSession(id, this, opts);
      this.sessions.set(id, session);
      this._addSessionToLayout(session);
      session.connect();
      this.switchTo(id);
      return session;
    }

    destroySession(id) {
      const session = this.sessions.get(id);
      if (!session) return;

      session.disconnect();

      if (session.floatingEl) {
        session.floatingEl.remove();
        this.floatingManager.unregister(id);
      }
      session.dom.container.remove();
      this.sessions.delete(id);

      const tab = document.querySelector('[data-session-tab="' + id + '"]');
      if (tab) tab.remove();

      if (this.activeSessionId === id) {
        const remaining = [...this.sessions.keys()];
        if (remaining.length > 0) {
          this.switchTo(remaining[remaining.length - 1]);
        } else {
          this.activeSessionId = null;
        }
      }
    }

    switchTo(id) {
      const session = this.sessions.get(id);
      if (!session) return;

      this.activeSessionId = id;

      for (const [sid, s] of this.sessions) {
        s.dom.container.classList.toggle("session-active", sid === id);
      }

      if (this.layoutMode === "tabs") {
        for (const [sid, s] of this.sessions) {
          s.dom.container.style.display = sid === id ? "" : "none";
        }
      }

      document.querySelectorAll(".session-tab").forEach(t => t.classList.remove("active"));
      const tab = document.querySelector('[data-session-tab="' + id + '"]');
      if (tab) tab.classList.add("active");

      session.dom.inputEl.focus();
      this._syncControlBar(session);
      window.__demogodActiveSession = session;

      // Re-fetch capabilities if panel is open (different session = different data)
      if (window._capabilitiesOpen) session.send("list_capabilities");

      if (this.layoutMode === "floating") {
        this.floatingManager.bringToFront(id);
        for (const [sid, s] of this.sessions) {
          if (s.floatingEl) s.floatingEl.classList.toggle("active", sid === id);
        }
      }
    }

    getActive() {
      return this.sessions.get(this.activeSessionId);
    }

    _addSessionToLayout(session) {
      const tabBar = document.getElementById("session-tab-bar");
      const addBtn = document.getElementById("btn-add-session");

      const tab = document.createElement("div");
      tab.className = "session-tab";
      tab.dataset.sessionTab = session.id;
      tab.innerHTML =
        '<span class="session-tab-dot" style="background: #28c840"></span>' +
        '<span class="session-tab-name">' + escapeHtml(session._displayName()) + '</span>' +
        '<span class="session-tab-close" title="Close">\u00d7</span>';

      tab.addEventListener("click", (e) => {
        if (e.target.classList.contains("session-tab-close")) {
          e.stopPropagation();
          if (this.sessions.size > 1) {
            this.destroySession(session.id);
          }
          return;
        }
        this.switchTo(session.id);
      });
      tabBar.insertBefore(tab, addBtn);

      if (this.layoutMode === "tabs") {
        const chatPanel = document.getElementById("panel-chat");
        chatPanel.appendChild(session.dom.container);
      } else {
        this._addToFloating(session);
      }
    }

    _addToFloating(session) {
      if (!session.floatingEl) {
        session.floatingEl = document.createElement("div");
        session.floatingEl.className = "floating-window";
        const chrome = session._createFloatingChrome();
        session.floatingEl.appendChild(chrome);
        session.floatingEl.appendChild(session.dom.container);
        session.dom.container.style.display = "";

        this.floatingManager._makeDraggable(session.id, chrome);
        this.floatingManager._makeResizable(session.id, session.floatingEl);
      }
      const floatingContainer = document.getElementById("floating-container");
      floatingContainer.appendChild(session.floatingEl);
      this.floatingManager.register(session.id, session.floatingEl);

      session.floatingEl.addEventListener("pointerdown", () => {
        this.switchTo(session.id);
      });
    }

    _updateSessionTabDot(sessionId, isProcessing) {
      const tab = document.querySelector('[data-session-tab="' + sessionId + '"]');
      if (!tab) return;
      const dot = tab.querySelector(".session-tab-dot");
      if (dot) {
        dot.style.background = isProcessing ? "#febc2e" : "#28c840";
      }
    }

    _syncControlBar(session) {
      const ml = document.getElementById("model-label");
      const al = document.getElementById("agent-label");
      const cml = document.getElementById("copilot-mode-label");
      const pl = document.getElementById("project-label");
      const mdl = document.getElementById("mode-label");
      const mdi = document.getElementById("mode-icon");
      const bp = document.getElementById("btn-project");
      const bm = document.getElementById("btn-model");
      const ba = document.getElementById("btn-agent");
      const bcm = document.getElementById("btn-copilot-mode");

      if (ml) ml.textContent = session.selectedModel || "Model";
      if (bm) bm.classList.toggle("active", !!session.selectedModel);
      if (al) al.textContent = session.selectedAgent?.displayName || session.selectedAgent?.name || "Agent";
      if (ba) ba.classList.toggle("active", !!session.selectedAgent);

      const modeLabelsMap = { interactive: "Interactive", plan: "Plan", autopilot: "Autopilot", demo_plan: "Demo Plan" };
      const modeIconsMap = { interactive: "\ud83c\udfaf", plan: "\ud83d\udccb", autopilot: "\ud83d\ude80", demo_plan: "\ud83c\udfac" };
      if (cml) cml.textContent = modeLabelsMap[session.copilotMode] || session.copilotMode;
      if (bcm) {
        const iconSpan = bcm.querySelector("span");
        if (iconSpan) iconSpan.textContent = modeIconsMap[session.copilotMode] || "\ud83c\udfaf";
      }

      if (pl) {
        if (session.selectedProject) {
          pl.textContent = session.selectedProject.split("/").pop() || session.selectedProject;
          if (bp) bp.classList.add("active");
        } else {
          pl.textContent = "No project";
          if (bp) bp.classList.remove("active");
        }
      }

      if (mdl) mdl.textContent = session.mode === "scripted" ? "Script" : "Live";
      if (mdi) mdi.textContent = session.mode === "scripted" ? "\u25b6\ufe0f" : "\u2328\ufe0f";
    }

    setLayoutMode(mode) {
      this.layoutMode = mode;
      localStorage.setItem("dg-layout", mode);

      const terminalWindow = document.getElementById("terminal-window");
      const floatingContainer = document.getElementById("floating-container");
      const chatPanel = document.getElementById("panel-chat");
      const btnTile = document.getElementById("btn-tile");
      const layoutLabel = document.getElementById("layout-label");
      const layoutIcon = document.getElementById("layout-icon");

      if (mode === "tabs") {
        for (const [id, session] of this.sessions) {
          if (session.floatingEl) {
            // Detach session container from floating chrome
            if (session.dom.container.parentNode === session.floatingEl) {
              session.floatingEl.removeChild(session.dom.container);
            }
            session.floatingEl.remove();
            this.floatingManager.unregister(id);
            session.floatingEl = null;
          }
          session.dom.container.style.cssText = "";
          chatPanel.appendChild(session.dom.container);
        }
        terminalWindow.style.display = "";
        floatingContainer.style.display = "none";
        if (btnTile) btnTile.classList.add("hidden");
        if (layoutLabel) layoutLabel.textContent = "Tabs";
        if (layoutIcon) layoutIcon.textContent = "\ud83d\udcd1";
        this.switchTo(this.activeSessionId);
      } else {
        terminalWindow.style.display = "none";
        floatingContainer.style.display = "";
        for (const [id, session] of this.sessions) {
          this._addToFloating(session);
          session.dom.container.style.display = "";
        }
        if (btnTile) btnTile.classList.remove("hidden");
        if (layoutLabel) layoutLabel.textContent = "Float";
        if (layoutIcon) layoutIcon.textContent = "\ud83e\ude9f";
        this.floatingManager.tileAll();
        this.switchTo(this.activeSessionId);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL STATE ──────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  let cachedModels = [];
  let popupDialogs = localStorage.getItem("dg-dialog-mode") === "popup";
  let pendingDialogRequestId = null;
  let pendingDialogSession = null;
  let cappickerMode = null;
  let tabCounter = 0;

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL DOM REFS ───────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  const $ = (sel) => document.querySelector(sel);

  const dialogOverlay = $("#dialog-overlay");
  const dialogMessage = $("#dialog-message");
  const dialogFields = $("#dialog-fields");
  const dialogSubmit = $("#dialog-submit");
  const dialogCancel = $("#dialog-cancel");
  const dialogClose = $("#dialog-close");

  const btnMode = $("#btn-mode");
  const btnNewSession = $("#btn-new-session");

  const pickerOverlay = $("#picker-overlay");
  const pickerBreadcrumb = $("#picker-breadcrumb");
  const pickerList = $("#picker-list");
  const pickerSelect = $("#picker-select");
  const pickerCancel = $("#picker-cancel");
  const pickerClose = $("#picker-close");

  const btnBrowseFile = $("#btn-browse-file");
  const fbOverlay = $("#filebrowser-overlay");
  const fbBreadcrumb = $("#filebrowser-breadcrumb");
  const fbList = $("#filebrowser-list");
  const fbCancel = $("#filebrowser-cancel");
  const fbClose = $("#filebrowser-close");

  const cappickerOverlay = $("#cappicker-overlay");
  const cappickerTitle = $("#cappicker-title");
  const cappickerIcon = $("#cappicker-icon");
  const cappickerSearch = $("#cappicker-search");
  const cappickerList = $("#cappicker-list");
  const cappickerCancel = $("#cappicker-cancel");
  const cappickerClose = $("#cappicker-close");
  const cappickerDeselect = $("#cappicker-deselect");

  const tabBar = $("#tab-bar");
  const tabPanels = $("#session-panels");

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: Tab Management (File/Report tabs) ─────────────
  // ═══════════════════════════════════════════════════════════

  function switchTab(tabId) {
    tabBar.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tabPanels.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

    const tab = tabBar.querySelector('[data-tab="' + tabId + '"]');
    const panel = document.getElementById("panel-" + tabId);
    if (tab) tab.classList.add("active");
    if (panel) panel.classList.add("active");

    if (tab) {
      const badge = tab.querySelector(".tab-badge");
      if (badge) badge.remove();
    }
  }

  function addReportTab(title, markdownContent) {
    const tabId = "report-" + (++tabCounter);

    const tab = document.createElement("div");
    tab.className = "tab";
    tab.dataset.tab = tabId;
    tab.innerHTML =
      '<span class="tab-icon">\ud83d\udcc4</span>' +
      '<span class="tab-label">' + escapeHtml(title) + '</span>' +
      '<span class="tab-close" title="Close tab">\u2715</span>';
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

    const panel = document.createElement("div");
    panel.className = "tab-panel";
    panel.id = "panel-" + tabId;
    const reportDiv = document.createElement("div");
    reportDiv.className = "report-panel";
    reportDiv.innerHTML = renderReportMarkdown(markdownContent);
    panel.appendChild(reportDiv);
    tabPanels.appendChild(panel);

    const badge = document.createElement("span");
    badge.className = "tab-badge";
    tab.appendChild(badge);

    switchTab(tabId);
  }

  function closeTab(tabId) {
    const tab = tabBar.querySelector('[data-tab="' + tabId + '"]');
    const panel = document.getElementById("panel-" + tabId);
    const wasActive = tab?.classList.contains("active");
    if (tab) tab.remove();
    if (panel) panel.remove();
    if (wasActive) switchTab("chat");
  }

  tabBar.querySelector('[data-tab="chat"]').addEventListener("click", () => switchTab("chat"));

  // Global opened-files tracker (dedup across sessions)
  const globalOpenedFiles = new Set();

  async function openFileInTab(filePath) {
    const normalPath = filePath.replace(/^\/+/, "/");
    if (globalOpenedFiles.has(normalPath)) {
      try {
        const res = await fetch(API_BASE + "/api/file?path=" + encodeURIComponent(filePath));
        if (!res.ok) return;
        const data = await res.json();
        const tabId = "file-" + hashPath(normalPath);
        const panel = document.getElementById("panel-" + tabId);
        if (panel) {
          const reportDiv = panel.querySelector(".report-panel");
          if (reportDiv) reportDiv.innerHTML = renderReportMarkdown(data.content);
        }
      } catch {}
      return;
    }
    globalOpenedFiles.add(normalPath);

    try {
      const res = await fetch(API_BASE + "/api/file?path=" + encodeURIComponent(filePath));
      if (!res.ok) return;
      const data = await res.json();
      const filename = data.filename || filePath.split("/").pop();
      const tabId = "file-" + hashPath(normalPath);
      addFileTab(tabId, filename, data.content, normalPath);
    } catch (err) {
      console.error("Failed to open file:", err);
      globalOpenedFiles.delete(normalPath);
    }
  }

  function addFileTab(tabId, filename, content, filePath) {
    const tab = document.createElement("div");
    tab.className = "tab";
    tab.dataset.tab = tabId;
    tab.innerHTML =
      '<span class="tab-icon">\ud83d\udcc4</span>' +
      '<span class="tab-label" title="' + escapeHtml(filePath) + '">' + escapeHtml(filename) + '</span>' +
      '<span class="tab-close" title="Close tab">\u2715</span>';
    tab.addEventListener("click", (e) => {
      if (!e.target.classList.contains("tab-close")) switchTab(tabId);
    });
    tab.querySelector(".tab-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tabId);
      globalOpenedFiles.delete(filePath);
    });
    tabBar.appendChild(tab);

    const panel = document.createElement("div");
    panel.className = "tab-panel";
    panel.id = "panel-" + tabId;
    const reportDiv = document.createElement("div");
    reportDiv.className = "report-panel";
    reportDiv.innerHTML = renderReportMarkdown(content);
    panel.appendChild(reportDiv);
    tabPanels.appendChild(panel);

    const badge = document.createElement("span");
    badge.className = "tab-badge";
    tab.appendChild(badge);

    switchTab(tabId);
  }

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: Dialog ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  function submitDialog() {
    const values = {};

    dialogFields.querySelectorAll("input[type='text'], input[type='number'], select").forEach((el) => {
      values[el.name] = el.value;
    });

    dialogFields.querySelectorAll("input[type='radio']:checked").forEach((el) => {
      values[el.name] = el.value;
    });

    const checkboxGroups = {};
    dialogFields.querySelectorAll("input[type='checkbox']").forEach((el) => {
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

    const session = pendingDialogSession || manager.getActive();

    if (pendingDialogRequestId === "__auto_question__") {
      const answer = values.response || Object.values(values)[0] || "";
      if (answer && session) {
        session.addCommandEntry(answer);
        session.setProcessing(true);
        session.setStatus("Thinking...");
        session.send("send_prompt", { prompt: answer });
      }
    } else if (pendingDialogRequestId && session) {
      session.send("user_input_response", {
        requestId: pendingDialogRequestId,
        values,
      });
      session.setProcessing(true);
    }

    dialogOverlay.classList.add("hidden");
    pendingDialogRequestId = null;
    pendingDialogSession = null;
  }

  function cancelDialog() {
    const session = pendingDialogSession || manager.getActive();
    if (pendingDialogRequestId && session) {
      session.send("user_input_response", {
        requestId: pendingDialogRequestId,
        values: {},
      });
      session.setProcessing(true);
    }
    dialogOverlay.classList.add("hidden");
    pendingDialogRequestId = null;
    pendingDialogSession = null;
  }

  dialogSubmit.addEventListener("click", submitDialog);
  dialogCancel.addEventListener("click", cancelDialog);
  dialogClose.addEventListener("click", cancelDialog);

  dialogFields.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitDialog();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: Project Picker ────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  let pickerCurrentPath = null;

  async function browseTo(path) {
    try {
      const url = path ? "/api/browse?path=" + encodeURIComponent(path) : "/api/browse";
      const res = await fetch(url);
      const data = await res.json();
      pickerCurrentPath = data.current;
      renderPicker(data);
    } catch (err) {
      console.error("Browse error:", err);
    }
  }

  function renderPicker(data) {
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

    pickerList.innerHTML = "";

    if (data.parent) {
      const up = document.createElement("div");
      up.className = "picker-item";
      up.innerHTML = '<span class="picker-item-icon">\u2b06\ufe0f</span><span class="picker-item-name" style="color:var(--body-dim)">..</span>';
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
      icon.textContent = dir.isGitRepo ? "\ud83d\udce6" : "\ud83d\udcc2";

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
      arrow.textContent = "\u203a";
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
    const session = manager.getActive();
    pickerOverlay.classList.remove("hidden");
    browseTo(session?.selectedProject || null);
  }

  function closePicker() {
    pickerOverlay.classList.add("hidden");
  }

  function selectProject(path) {
    const session = manager.getActive();
    if (!session) return;
    closePicker();
    session.selectProject(path);
  }

  $("#btn-project").addEventListener("click", openPicker);
  pickerCancel.addEventListener("click", closePicker);
  pickerClose.addEventListener("click", closePicker);
  pickerSelect.addEventListener("click", () => {
    if (pickerCurrentPath) selectProject(pickerCurrentPath);
  });

  pickerOverlay.addEventListener("click", (e) => {
    if (e.target === pickerOverlay) closePicker();
  });

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: File Browser ──────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  let fbCurrentPath = null;

  async function fbBrowseTo(path) {
    try {
      const url = path
        ? "/api/browse-files?path=" + encodeURIComponent(path)
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

    fbList.innerHTML = "";

    if (data.parent) {
      const up = document.createElement("div");
      up.className = "picker-item";
      up.innerHTML = '<span class="picker-item-icon">\u2b06\ufe0f</span><span class="picker-item-name" style="color:var(--body-dim)">..</span>';
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
      icon.textContent = item.isDir ? "\ud83d\udcc2" : "\ud83d\udcc4";

      const name = document.createElement("span");
      name.className = "picker-item-name";
      name.textContent = item.name;

      row.appendChild(icon);
      row.appendChild(name);

      if (item.isDir) {
        const arrow = document.createElement("span");
        arrow.className = "picker-item-arrow";
        arrow.textContent = "\u203a";
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
    const session = manager.getActive();
    fbOverlay.classList.remove("hidden");
    fbBrowseTo(session?.selectedProject || null);
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

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: Mode toggle ───────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  btnMode.addEventListener("click", async () => {
    const session = manager.getActive();
    if (!session) return;
    if (session.mode === "live") {
      // Fetch available demos and let user pick
      try {
        const res = await fetch(`${API_BASE}/api/demos`);
        const demos = await res.json();
        if (!demos.length) {
          session.mode = "scripted";
          session.setProcessing(true);
          session.send("start_demo", { demo: "intro" });
          manager._syncControlBar(session);
          return;
        }
        openCapPicker("demo", demos.map(d => ({
          name: d.name,
          description: d.description || d.title,
        })));
      } catch {
        session.mode = "scripted";
        session.setProcessing(true);
        session.send("start_demo", { demo: "intro" });
        manager._syncControlBar(session);
      }
    } else {
      session.mode = "live";
      session.send("cancel_demo");
      dialogOverlay.classList.add("hidden");
      session.setProcessing(false);
      session.dom.inputEl.focus();
    }
    manager._syncControlBar(session);
  });

  btnNewSession.addEventListener("click", () => {
    const session = manager.getActive();
    if (!session) return;
    session.dom.output.innerHTML = "";
    session.currentResponseEl = null;
    session.currentResponseText = "";
    session.setProcessing(false);
    session.setStatus("Reconnecting...");
    session.send("create_session", { workingDirectory: session.selectedProject, model: session.selectedModel || undefined });
  });

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: Model / Agent / Skill / Mode Pickers ─────────
  // ═══════════════════════════════════════════════════════════

  async function loadModels() {
    try {
      const res = await fetch(API_BASE + "/api/models");
      if (!res.ok) throw new Error("Failed to fetch models");
      cachedModels = await res.json();
    } catch (err) {
      console.warn("Could not load models:", err);
      cachedModels = [];
    }
  }

  function openCapPicker(mode, externalItems) {
    const session = manager.getActive();
    if (!session) return;

    cappickerMode = mode;
    cappickerSearch.value = "";
    cappickerDeselect.classList.add("hidden");

    if (mode === "demo") {
      cappickerIcon.textContent = "🎬";
      cappickerTitle.textContent = "Run Demo";
      const createItem = { id: "__create_demo__", name: "✨ Create New Demo", desc: "Describe a demo and let Copilot generate it", meta: "", selected: false };
      const demoItems = (externalItems || []).map((d) => ({
        id: d.name,
        name: d.name,
        desc: d.description || "",
        meta: "",
        selected: false,
      }));
      renderCapList([createItem, ...demoItems]);
    } else if (mode === "model") {
      cappickerIcon.textContent = "\ud83e\uddea";
      cappickerTitle.textContent = "Select Model";
      if (session.selectedModel) cappickerDeselect.classList.remove("hidden");
      renderCapList(cachedModels.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        desc: [m.billing, m.capabilities?.supports?.vision ? "vision" : ""].filter(Boolean).join(" \u00b7 ") || m.id,
        meta: m.id,
        selected: m.id === session.selectedModel,
      })));
    } else if (mode === "agent") {
      cappickerIcon.textContent = "\ud83e\udd16";
      cappickerTitle.textContent = "Select Agent";
      if (session.selectedAgent) cappickerDeselect.classList.remove("hidden");
      renderCapList(session.cachedAgents.map((a) => ({
        id: a.name,
        name: a.displayName || a.name,
        desc: a.description || "",
        meta: a.source || a.name,
        selected: session.selectedAgent?.name === a.name,
      })));
    } else if (mode === "skill") {
      cappickerIcon.textContent = "\u26a1";
      cappickerTitle.textContent = "Invoke Skill";
      const enabled = session.cachedSkills.filter((s) => s.enabled);
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
        '<div class="cappicker-item-name">' + escapeHtml(item.name) + '</div>' +
        (item.desc ? '<div class="cappicker-item-desc">' + escapeHtml(item.desc) + '</div>' : "") +
        (item.meta && item.meta !== item.name ? '<div class="cappicker-item-meta">' + escapeHtml(item.meta) + '</div>' : "");
      el.addEventListener("click", () => onCapItemSelected(item.id));
      cappickerList.appendChild(el);
    }
  }

  function onCapItemSelected(id) {
    const session = manager.getActive();
    if (!session) return;
    const mode = cappickerMode;
    closeCapPicker();
    if (mode === "demo") {
      if (id === "__create_demo__") {
        session.copilotMode = "demo_plan";
        session.dom.container.dataset.copilotMode = "demo_plan";
        if (session.floatingEl) session.floatingEl.dataset.copilotMode = "demo_plan";
        const smodeEl = session.dom.statusBar.querySelector(".status-mode");
        if (smodeEl) smodeEl.textContent = "🎬 Demo Plan";
        session.appendSystemMessage("Demo Plan mode — describe the demo you want to create. I'll generate a runnable script.", "info");
        session.dom.inputEl.focus();
        manager._syncControlBar(session);
        return;
      }
      session.mode = "scripted";
      session.setProcessing(true);
      session.send("start_demo", { demo: id });
      manager._syncControlBar(session);
    } else if (mode === "model") {
      session.selectedModel = id;
      const smEl = session.dom.statusBar.querySelector(".status-model");
      if (smEl) smEl.textContent = id;
      session.send("set_model", { model: id });
      manager._syncControlBar(session);
    } else if (mode === "agent") {
      session.send("select_agent", { name: id });
    } else if (mode === "skill") {
      session.dom.inputEl.textContent = "/" + id + " ";
      session.dom.inputEl.focus();
      const range = document.createRange();
      range.selectNodeContents(session.dom.inputEl);
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
    const session = manager.getActive();
    if (!session) return;
    const mode = cappickerMode;
    closeCapPicker();
    if (mode === "model") {
      session.selectedModel = "";
      const smEl = session.dom.statusBar.querySelector(".status-model");
      if (smEl) smEl.textContent = "(default)";
      manager._syncControlBar(session);
    } else if (mode === "agent") {
      session.send("deselect_agent");
    }
  });

  $("#btn-model").addEventListener("click", () => openCapPicker("model"));
  $("#btn-agent").addEventListener("click", () => {
    const session = manager.getActive();
    if (session) session.send("list_agents");
    setTimeout(() => openCapPicker("agent"), 300);
  });
  $("#btn-skill").addEventListener("click", () => {
    const session = manager.getActive();
    if (session) session.send("list_skills");
    setTimeout(() => openCapPicker("skill"), 300);
  });
  $("#btn-copilot-mode").addEventListener("click", () => {
    const session = manager.getActive();
    if (!session) return;
    // If in client-side demo_plan mode, exit back to interactive
    if (session.copilotMode === "demo_plan") {
      session.copilotMode = "interactive";
      session.dom.container.dataset.copilotMode = "interactive";
      if (session.floatingEl) session.floatingEl.dataset.copilotMode = "interactive";
      session.appendSystemMessage("Exited Demo Plan mode", "info");
      manager._syncControlBar(session);
      return;
    }
    const modes = ["interactive", "plan", "autopilot"];
    const next = modes[(modes.indexOf(session.copilotMode) + 1) % modes.length];
    session.send("set_mode", { mode: next });
  });

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: Layout & Session Buttons ──────────────────────
  // ═══════════════════════════════════════════════════════════

  const btnLayout = $("#btn-layout");
  const btnTile = $("#btn-tile");
  const btnAddSession = $("#btn-add-session");

  if (btnLayout) {
    btnLayout.addEventListener("click", () => {
      const next = manager.layoutMode === "tabs" ? "floating" : "tabs";
      manager.setLayoutMode(next);
    });
  }

  if (btnTile) {
    btnTile.addEventListener("click", () => {
      manager.floatingManager.tileAll();
    });
  }

  if (btnAddSession) {
    btnAddSession.addEventListener("click", () => {
      manager.createSession();
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: Screen Recording ──────────────────────────────
  // ═══════════════════════════════════════════════════════════

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

      const mimeType = MediaRecorder.isTypeSupported("video/mp4")
        ? "video/mp4"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
      const fileExt = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
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
        a.download = "copilot-demo-" + ts + "." + fileExt;
        a.click();
        URL.revokeObjectURL(url);
        exitRecordingMode();
      };

      stream.getVideoTracks()[0].onended = () => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
      };

      document.body.classList.add("recording");
      recordIcon.textContent = "\u23f9";
      recordLabel.textContent = "Stop";

      mediaRecorder.start(100);
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
    recordIcon.textContent = "\u23fa";
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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mediaRecorder && mediaRecorder.state === "recording") {
      e.preventDefault();
      stopRecording();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: Background Color ─────────────────────────────
  // ═══════════════════════════════════════════════════════════

  const backdrop = $("#backdrop");
  const bgOptions = [
    { name: "Chroma", cls: "bg-chroma" },
    { name: "Copilot Dark", cls: "bg-copilot-dark" },
    { name: "Copilot Light", cls: "bg-copilot-light" },
    { name: "Aurora Borealis", cls: "bg-aurora" },
    { name: "Off-white", cls: "bg-offwhite" },
    { name: "Dark Blue", cls: "bg-darkblue" },
    { name: "White", cls: "bg-white" },
  ];

  // Restore saved background
  const savedBg = localStorage.getItem("dg-bg");
  if (savedBg) {
    const idx = bgOptions.findIndex(o => o.cls === savedBg);
    if (idx >= 0) { backdrop.className = bgOptions[idx].cls; }
  }

  // ═══════════════════════════════════════════════════════════
  // ─── SETTINGS PANEL ───────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  const settingsOverlay = $("#settings-overlay");
  const settingBg = $("#setting-bg");
  const settingVersion = $("#setting-version");
  const settingDialogMode = $("#setting-dialog-mode");
  const settingTerminal = $("#setting-terminal");
  const settingAgentTabs = $("#setting-agent-tabs");
  const settingTodoPanel = $("#setting-todo-panel");
  const settingAutoApprove = $("#setting-auto-approve");
  const settingAmbient = $("#setting-ambient");

  // Ambient music — loops at 8% volume, starts on first user interaction
  let ambientAudio = null;
  function startAmbient() {
    if (ambientAudio) return;
    ambientAudio = new Audio("ambient.mp3");
    ambientAudio.loop = true;
    ambientAudio.volume = 0.08;
    ambientAudio.play().catch(() => {});
  }
  function stopAmbient() {
    if (ambientAudio) { ambientAudio.pause(); ambientAudio = null; }
  }

  // Init settings from localStorage
  settingBg.value = localStorage.getItem("dg-bg") || "bg-chroma";
  settingVersion.checked = localStorage.getItem("dg-show-version") === "1";
  settingDialogMode.value = localStorage.getItem("dg-dialog-mode") || "inline";
  settingTerminal.checked = localStorage.getItem("dg-terminal") === "1";
  settingAgentTabs.checked = localStorage.getItem("dg-agent-tabs") === "1";
  settingTodoPanel.checked = localStorage.getItem("dg-todo-panel") !== "0";
  settingAutoApprove.checked = localStorage.getItem("dg-auto-approve") !== "0";
  settingAmbient.checked = localStorage.getItem("dg-ambient") === "1";

  // Auto-start ambient on first interaction if enabled
  if (settingAmbient.checked) {
    const startOnInteraction = () => {
      startAmbient();
      document.removeEventListener("click", startOnInteraction);
      document.removeEventListener("keydown", startOnInteraction);
    };
    document.addEventListener("click", startOnInteraction, { once: true });
    document.addEventListener("keydown", startOnInteraction, { once: true });
  }

  const swedishTag = $("#swedish-tag");

  function updateSwedishTag(cls) {
    swedishTag.style.display = cls === "bg-aurora" ? "flex" : "none";
    swedishTag.classList.remove("fading");
  }

  // Fade the tag on first click anywhere
  document.addEventListener("click", () => {
    if (swedishTag.style.display === "flex" && !swedishTag.classList.contains("fading")) {
      swedishTag.classList.add("fading");
    }
  }, { once: true });

  settingBg.addEventListener("change", () => {
    const cls = settingBg.value;
    localStorage.setItem("dg-bg", cls);
    backdrop.className = cls;
    updateSwedishTag(cls);
  });

  // Init swedish tag on load
  updateSwedishTag(localStorage.getItem("dg-bg") || "bg-chroma");

  settingVersion.addEventListener("change", () => {
    localStorage.setItem("dg-show-version", settingVersion.checked ? "1" : "0");
    if (versionBadge) versionBadge.classList.toggle("hidden", !settingVersion.checked);
  });

  settingDialogMode.addEventListener("change", () => {
    const mode = settingDialogMode.value;
    localStorage.setItem("dg-dialog-mode", mode);
    popupDialogs = mode === "popup";
  });

  settingTerminal.addEventListener("change", () => {
    localStorage.setItem("dg-terminal", settingTerminal.checked ? "1" : "0");
    const btnTerm = $("#btn-terminal");
    btnTerm.style.display = (settingTerminal.checked || window.__TAURI_INTERNALS__) ? "" : "none";
  });

  settingAgentTabs.addEventListener("change", () => {
    localStorage.setItem("dg-agent-tabs", settingAgentTabs.checked ? "1" : "0");
  });

  settingTodoPanel.addEventListener("change", () => {
    localStorage.setItem("dg-todo-panel", settingTodoPanel.checked ? "1" : "0");
  });

  settingAmbient.addEventListener("change", () => {
    localStorage.setItem("dg-ambient", settingAmbient.checked ? "1" : "0");
    if (settingAmbient.checked) startAmbient();
    else stopAmbient();
  });

  settingAutoApprove.addEventListener("change", () => {
    const enabled = settingAutoApprove.checked;
    localStorage.setItem("dg-auto-approve", enabled ? "1" : "0");
    for (const [, session] of manager.sessions) {
      session.send("set_auto_approve", { enabled });
      const el = session.dom.statusBar.querySelector(".status-approve");
      if (el) {
        el.textContent = enabled ? "auto-approve" : "";
        el.style.color = enabled ? "var(--yellow)" : "";
      }
    }
  });

  function openSettings() { settingsOverlay.classList.remove("hidden"); }
  function closeSettings() { settingsOverlay.classList.add("hidden"); }

  $("#btn-settings").addEventListener("click", openSettings);
  $("#settings-close").addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) closeSettings(); });

  // ═══════════════════════════════════════════════════════════
  // ─── CAPABILITIES PANEL ────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  const capOverlay = $("#capabilities-overlay");
  const capContent = $("#capabilities-content");
  const capFilter = $("#capabilities-filter");
  window._capabilitiesOpen = false;

  function openCapabilities() {
    capOverlay.classList.remove("hidden");
    window._capabilitiesOpen = true;
    capFilter.value = "";
    capContent.innerHTML = '<div class="capabilities-loading">Loading\u2026</div>';
    const session = manager.getActive();
    if (session) session.send("list_capabilities");
    capFilter.focus();
  }

  function closeCapabilities() {
    capOverlay.classList.add("hidden");
    window._capabilitiesOpen = false;
  }

  window._renderCapabilities = function() {
    const session = manager.getActive();
    if (!session) return;

    const filter = (capFilter.value || "").toLowerCase();
    const servers = session.cachedMcpServers || [];
    const skills = session.cachedSkills || [];
    const tools = session.cachedTools || [];

    // Group tools by MCP server (namespacedName prefix before "/")
    const toolsByServer = {};
    const builtinTools = [];
    for (const t of tools) {
      if (t.namespacedName && t.namespacedName.includes("/")) {
        const serverName = t.namespacedName.split("/")[0];
        if (!toolsByServer[serverName]) toolsByServer[serverName] = [];
        toolsByServer[serverName].push(t);
      } else {
        builtinTools.push(t);
      }
    }

    let html = "";

    // Tools section (built-in + MCP server tools)
    const filteredBuiltins = builtinTools.filter(t =>
      !filter || t.name.toLowerCase().includes(filter)
    );
    const totalToolCount = tools.length;
    const excludedCount = session.excludedTools.size;

    html += '<div class="cap-section" id="cap-tools">';
    html += '<div class="cap-section-header" data-section="cap-tools">';
    html += '<span class="cap-section-arrow">\u25bc</span>';
    html += '<span class="cap-section-title">Tools</span>';
    html += '<span class="cap-section-badge">' + (totalToolCount - excludedCount) + '/' + totalToolCount + '</span>';
    html += '</div>';
    html += '<div class="cap-section-items">';

    if (filteredBuiltins.length > 0) {
      html += '<div class="cap-mcp-card" data-server="__builtin__">';
      html += '<div class="cap-mcp-header">';
      html += '<span class="cap-mcp-name">';
      html += '<span class="cap-mcp-status connected"></span>';
      html += 'Built-in';
      html += '</span>';
      html += '</div>';
      html += '<div class="cap-tools">';
      for (const t of filteredBuiltins) {
        const isExcluded = session.excludedTools.has(t.name);
        html += '<span class="cap-tool-chip' + (isExcluded ? ' excluded' : '') + '"' +
          ' data-tool="' + escapeHtml(t.name) + '"' +
          ' title="' + escapeHtml(t.description || t.name) + '"' +
          '>' + escapeHtml(t.name) + '</span>';
      }
      html += '</div>';
      html += '</div>';
    }

    html += '</div></div>';

    // MCP Servers section
    const filteredServers = servers.filter(s =>
      !filter || s.name.toLowerCase().includes(filter) ||
      (toolsByServer[s.name] || []).some(t => t.name.toLowerCase().includes(filter))
    );
    const enabledServerCount = servers.filter(s => s.status !== "disabled").length;

    html += '<div class="cap-section" id="cap-mcp">';
    html += '<div class="cap-section-header" data-section="cap-mcp">';
    html += '<span class="cap-section-arrow">\u25bc</span>';
    html += '<span class="cap-section-title">MCP Servers</span>';
    html += '<span class="cap-section-badge">' + enabledServerCount + '/' + servers.length + '</span>';
    html += '</div>';
    html += '<div class="cap-section-items">';

    if (filteredServers.length === 0) {
      html += '<div class="cap-no-tools">No MCP servers configured</div>';
    }

    for (const s of filteredServers) {
      const isEnabled = s.status !== "disabled";
      const serverTools = toolsByServer[s.name] || [];
      html += '<div class="cap-mcp-card' + (isEnabled ? '' : ' disabled') + '" data-server="' + escapeHtml(s.name) + '">';
      html += '<div class="cap-mcp-header">';
      html += '<span class="cap-mcp-name">';
      html += '<span class="cap-mcp-status ' + escapeHtml(s.status) + '"></span>';
      html += escapeHtml(s.name);
      if (s.source) html += ' <span class="cap-mcp-source">' + escapeHtml(s.source) + '</span>';
      html += '</span>';
      html += '<label class="cap-toggle"><input type="checkbox"' + (isEnabled ? ' checked' : '') + ' data-toggle-mcp="' + escapeHtml(s.name) + '"><span class="cap-toggle-slider"></span></label>';
      html += '</div>';
      if (serverTools.length > 0) {
        html += '<div class="cap-tools">';
        for (const t of serverTools) {
          const toolName = t.name;
          const isExcluded = session.excludedTools.has(toolName);
          const matchesFilter = filter && toolName.toLowerCase().includes(filter);
          html += '<span class="cap-tool-chip' + (isExcluded ? ' excluded' : '') + '"' +
            ' data-tool="' + escapeHtml(toolName) + '"' +
            ' title="' + escapeHtml(t.description || toolName) + '"' +
            (matchesFilter ? ' style="border-color:var(--accent)"' : '') +
            '>' + escapeHtml(toolName) + '</span>';
        }
        html += '</div>';
      } else {
        // Check if we've discovered tools for this server
        const observed = session.discoveredMcpTools[s.name] || [];
        if (observed.length > 0) {
          html += '<div class="cap-tools">';
          for (const item of observed) {
            const toolName = typeof item === 'string' ? item : item.name;
            const desc = typeof item === 'string' ? toolName : (item.description || toolName);
            const shortName = toolName.replace(s.name + '-', '').replace(s.name + '_', '');
            const isExcluded = session.excludedTools.has(toolName);
            html += '<span class="cap-tool-chip' + (isExcluded ? ' excluded' : '') + '"' +
              ' data-tool="' + escapeHtml(toolName) + '"' +
              ' title="' + escapeHtml(desc) + '"' +
              '>' + escapeHtml(shortName) + '</span>';
          }
          html += '</div>';
        } else if (isEnabled && s.status === 'connected') {
          html += '<div class="cap-no-tools">Tools available \u2014 use session to discover</div>';
        } else {
          html += '<div class="cap-no-tools">No tools</div>';
        }
      }
      html += '</div>';
    }

    html += '</div></div>';

    // Skills section
    const filteredSkills = skills.filter(s =>
      !filter || s.name.toLowerCase().includes(filter) ||
      (s.description || "").toLowerCase().includes(filter)
    );
    const enabledSkillCount = skills.filter(s => s.enabled).length;

    html += '<div class="cap-section" id="cap-skills">';
    html += '<div class="cap-section-header" data-section="cap-skills">';
    html += '<span class="cap-section-arrow">\u25bc</span>';
    html += '<span class="cap-section-title">Skills</span>';
    html += '<span class="cap-section-badge">' + enabledSkillCount + '/' + skills.length + '</span>';
    html += '</div>';
    html += '<div class="cap-section-items">';

    for (const s of filteredSkills) {
      html += '<div class="cap-skill-row' + (s.enabled ? '' : ' disabled') + '">';
      html += '<div class="cap-skill-info">';
      html += '<span class="cap-skill-name">' + escapeHtml(s.name) + '</span>';
      if (s.description) html += '<span class="cap-skill-desc" title="' + escapeHtml(s.description) + '">' + escapeHtml(s.description) + '</span>';
      html += '</div>';
      html += '<label class="cap-toggle"><input type="checkbox"' + (s.enabled ? ' checked' : '') + ' data-toggle-skill="' + escapeHtml(s.name) + '"><span class="cap-toggle-slider"></span></label>';
      html += '</div>';
    }

    html += '</div></div>';

    capContent.innerHTML = html;

    // Wire toggle handlers via delegation
    capContent.onclick = function(e) {
      const toggle = e.target.closest('[data-toggle-mcp]');
      if (toggle) {
        const name = toggle.dataset.toggleMcp;
        const enabled = toggle.checked;
        session.send("toggle_mcp", { name, enabled });
        return;
      }
      const skillToggle = e.target.closest('[data-toggle-skill]');
      if (skillToggle) {
        const name = skillToggle.dataset.toggleSkill;
        const enabled = skillToggle.checked;
        session.send("toggle_skill", { name, enabled });
        return;
      }
      const toolChip = e.target.closest('[data-tool]');
      if (toolChip) {
        const toolName = toolChip.dataset.tool;
        if (session.excludedTools.has(toolName)) {
          session.excludedTools.delete(toolName);
          toolChip.classList.remove("excluded");
        } else {
          session.excludedTools.add(toolName);
          toolChip.classList.add("excluded");
        }
        return;
      }
      const sectionHeader = e.target.closest('.cap-section-header');
      if (sectionHeader) {
        const sectionId = sectionHeader.dataset.section;
        const section = document.getElementById(sectionId);
        if (section) section.classList.toggle("collapsed");
      }
    };
  };

  capFilter.addEventListener("input", () => {
    if (window._capabilitiesOpen) window._renderCapabilities();
  });

  $("#btn-capabilities").addEventListener("click", openCapabilities);
  $("#capabilities-close").addEventListener("click", closeCapabilities);
  capOverlay.addEventListener("click", (e) => { if (e.target === capOverlay) closeCapabilities(); });

  // ═══════════════════════════════════════════════════════════
  // ─── BOOT ──────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  const manager = new SessionManager();
  window.__demogodManager = manager;
  manager.createSession();
  loadModels();

  // Dismiss splash after animation plays
  const splash = document.getElementById("splash");
  if (splash) {
    splash.style.cursor = "pointer";
    splash.addEventListener("click", () => {
      splash.classList.add("fade-out");
      setTimeout(() => splash.remove(), 600);
    });
    setTimeout(() => {
      splash.classList.add("fade-out");
      setTimeout(() => splash.remove(), 600);
    }, 3800);
  }

  // Show version badge (clickable → show changelog in a tab)
  const dgVersion = document.querySelector('meta[name="dg-version"]')?.getAttribute("content");
  const versionBadge = document.getElementById("version-badge");
  if (versionBadge && dgVersion) {
    versionBadge.textContent = "v" + dgVersion;
    versionBadge.removeAttribute("href");
    versionBadge.removeAttribute("target");
    versionBadge.style.cursor = "pointer";
    versionBadge.title = "View changelog";
    versionBadge.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const res = await fetch(API_BASE + "/api/changelog");
        if (!res.ok) return;
        const data = await res.json();
        addReportTab("Changelog", data.content);
      } catch {}
    });
    if (localStorage.getItem("dg-show-version") === "1") versionBadge.classList.remove("hidden");
  }

  // ═══════════════════════════════════════════════════════════
  // ─── INTEGRATED TERMINAL (xterm.js + node-pty) ────────────
  // ═══════════════════════════════════════════════════════════
  // Decoupled into terminal.js ES module — loaded via <script type="module">

  // ═══════════════════════════════════════════════════════════
  // ─── DIALOG ACCESSIBILITY (focus trap + Escape-to-close) ──
  // ═══════════════════════════════════════════════════════════

  setupDialogOverlay("settings-overlay", closeSettings);
  setupDialogOverlay("capabilities-overlay", closeCapabilities);
  setupDialogOverlay("picker-overlay", closePicker);
  setupDialogOverlay("filebrowser-overlay", closeFileBrowser);
  setupDialogOverlay("dialog-overlay", cancelDialog);
  setupDialogOverlay("cappicker-overlay", closeCapPicker);

  // ═══════════════════════════════════════════════════════════
  // ─── GLOBAL: Keyboard Shortcuts ───────────────────────────
  // ═══════════════════════════════════════════════════════════
  //
  //  macOS: Ctrl+T / Ctrl+W / Ctrl+N / Ctrl+P
  //  Other: Alt+T  / Alt+W  / Alt+N  / Alt+P
  //

  document.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.startsWith("Mac");
    const mod = isMac ? (e.ctrlKey && !e.metaKey) : e.altKey;
    if (!mod) return;

    // New session
    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      manager.createSession();
      return;
    }

    // Close active session (keep at least one)
    if (e.key === "w" || e.key === "W") {
      e.preventDefault();
      const active = manager.getActive();
      if (active && manager.sessions.size > 1) {
        manager.destroySession(active.id);
      }
      return;
    }

    // Cycle sessions
    if (e.key === "n" || e.key === "N" || e.key === "p" || e.key === "P") {
      e.preventDefault();
      const ids = [...manager.sessions.keys()];
      if (ids.length < 2) return;
      const cur = ids.indexOf(manager.activeSessionId);
      const next = (e.key === "p" || e.key === "P")
        ? (cur - 1 + ids.length) % ids.length
        : (cur + 1) % ids.length;
      manager.switchTo(ids[next]);
      return;
    }
  });
})();
