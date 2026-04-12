/**
 * Demo Studio module — AI-powered demo generation panel.
 * Allows users to describe a demo and generate a DemoGod script or Playwright spec.
 * Creates a dedicated session so generation doesn't pollute the user's chat.
 */

const $ = (sel) => document.querySelector(sel);

const overlay = $("#studio-overlay");
const description = $("#studio-description");
const preview = $("#studio-preview");
const status = $("#studio-status");
const btnGenerate = $("#studio-generate");
const btnCancel = $("#studio-cancel");
const btnClose = $("#studio-close");
const btnStudio = $("#btn-studio");

let generating = false;

function getTarget() {
  return document.querySelector('input[name="studio-target"]:checked')?.value || "self";
}

function getFormat() {
  return document.querySelector('input[name="studio-format"]:checked')?.value || "demogod";
}

export function openStudio() {
  overlay.classList.remove("hidden");
  description.value = "";
  preview.classList.add("hidden");
  preview.textContent = "";
  status.classList.add("hidden");
  btnGenerate.disabled = false;
  btnGenerate.textContent = "Generate Demo";
  generating = false;
  description.focus();
}

export function closeStudio() {
  overlay.classList.add("hidden");
  generating = false;
}

function showStatus(text) {
  status.textContent = text;
  status.classList.remove("hidden");
}

btnGenerate.addEventListener("click", () => {
  const desc = description.value.trim();
  if (!desc || generating) return;

  generating = true;
  btnGenerate.disabled = true;
  btnGenerate.textContent = "Generating...";
  preview.classList.add("hidden");
  showStatus("Creating a new session for demo generation...");

  // Create a new session via the SessionManager, then send the generation request
  const manager = window.__demogodManager;
  if (!manager) {
    showStatus("No session manager available.");
    btnGenerate.disabled = false;
    btnGenerate.textContent = "Generate Demo";
    generating = false;
    return;
  }

  // Create a dedicated session for generation
  const session = manager.createSession();
  if (!session) {
    showStatus("Failed to create session.");
    btnGenerate.disabled = false;
    btnGenerate.textContent = "Generate Demo";
    generating = false;
    return;
  }

  // Set it to demo_plan mode visually
  session.copilotMode = "demo_plan";
  session.dom.container.dataset.copilotMode = "demo_plan";
  if (session.floatingEl) session.floatingEl.dataset.copilotMode = "demo_plan";
  const smodeEl = session.dom.statusBar.querySelector(".status-mode");
  if (smodeEl) smodeEl.textContent = "\ud83c\udfac Demo Plan";
  manager._syncControlBar(session);

  // Close the studio panel — the user will see output in the new session tab
  closeStudio();

  // Wait for the session to connect, then send the generation request
  const checkReady = setInterval(() => {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      clearInterval(checkReady);
      session.addCommandEntry(desc);
      session.setProcessing(true);
      session.setStatus("Generating demo plan...");
      session.send("generate_demo_plan", {
        description: desc,
        target: getTarget(),
        outputFormat: getFormat(),
      });
    }
  }, 200);

  // Timeout after 10s if WS never connects
  setTimeout(() => {
    clearInterval(checkReady);
    if (generating) {
      generating = false;
    }
  }, 10000);
});

btnCancel.addEventListener("click", closeStudio);
btnClose.addEventListener("click", closeStudio);
btnStudio.addEventListener("click", openStudio);

// Listen for Escape
overlay.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeStudio();
  }
});
