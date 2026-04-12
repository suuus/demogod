/**
 * Demo Studio module — AI-powered demo generation panel.
 * Allows users to describe a demo and generate a DemoGod script or Playwright spec.
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

function getActiveSession() {
  // Access the global session manager via window — app.js exposes active session's send()
  const sessions = document.querySelectorAll(".session-container");
  if (sessions.length === 0) return null;
  // Find the WS from the active session's data
  return window.__demogodActiveSession || null;
}

btnGenerate.addEventListener("click", () => {
  const desc = description.value.trim();
  if (!desc || generating) return;

  generating = true;
  btnGenerate.disabled = true;
  btnGenerate.textContent = "Generating...";
  preview.classList.add("hidden");
  showStatus("Copilot is reading your project and generating a demo plan...");

  // Send via the active session's WebSocket
  const session = getActiveSession();
  if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({
      type: "generate_demo_plan",
      description: desc,
      target: getTarget(),
      outputFormat: getFormat(),
    }));
  } else {
    showStatus("No active session — please create a session first.");
    btnGenerate.disabled = false;
    btnGenerate.textContent = "Generate Demo";
    generating = false;
  }
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
