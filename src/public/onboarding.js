/**
 * Context Setup Wizard module.
 * Opens a dedicated panel with a progress sidebar and an embedded Copilot session
 * running the @context-wizard agent.
 */

const $ = (sel) => document.querySelector(sel);

const overlay = $("#onboarding-overlay");
const sessionContainer = $("#onboarding-session");
const sidebar = $("#onboarding-sidebar");
const btnOnboarding = $("#btn-onboarding");
const btnClose = $("#onboarding-close");

let wizardSession = null;
let currentPhase = 0;

const PHASE_ICONS = { pending: "○", active: "←", complete: "✅", failed: "❌" };

function updateSidebar(phase, status) {
  sidebar.querySelectorAll(".onboarding-step").forEach((step) => {
    const p = parseInt(step.dataset.phase);
    const icon = step.querySelector(".onboarding-step-icon");
    step.classList.remove("active", "complete", "failed");
    if (p < phase) {
      step.classList.add("complete");
      icon.textContent = PHASE_ICONS.complete;
    } else if (p === phase) {
      step.classList.add(status === "complete" ? "complete" : "active");
      icon.textContent = status === "complete" ? PHASE_ICONS.complete : PHASE_ICONS.active;
    } else {
      icon.textContent = PHASE_ICONS.pending;
    }
  });
}

export function openWizard() {
  overlay.classList.remove("hidden");

  const manager = window.__demogodManager;
  if (!manager) return;

  // Create a dedicated session for the wizard
  wizardSession = manager.createSession();

  // Move the session's DOM into the wizard panel
  const container = wizardSession.dom.container;
  container.style.display = "";
  container.style.height = "100%";
  sessionContainer.appendChild(container);

  // Reset sidebar
  currentPhase = 0;
  updateSidebar(1, "active");

  // Watch for phase markers in the session output
  const origHandleMessage = wizardSession.handleMessage.bind(wizardSession);
  wizardSession.handleMessage = function (msg) {
    origHandleMessage(msg);
    // Check for phase markers in delta text
    if (msg.type === "delta" && msg.text) {
      const match = msg.text.match(/<!--phase:(\d+):(active|complete|failed)-->/);
      if (match) {
        const phase = parseInt(match[1]);
        const status = match[2];
        currentPhase = phase;
        updateSidebar(phase, status);
      }
    }
  };

  // Wait for session ready, then auto-start the wizard
  wizardSession.onReady(() => {
    wizardSession.send("select_agent", { name: "context-wizard" });
    // Small delay for agent selection, then send the opening prompt
    setTimeout(() => {
      wizardSession.addCommandEntry("Begin context setup for this project");
      wizardSession.setProcessing(true);
      wizardSession.setStatus("Setting up...");
      wizardSession.send("send_prompt", {
        prompt: "Begin context setup for this project. Start with Phase 1: detect what tools and stack this project uses.",
      });
    }, 1000);
  });
}

export function closeWizard() {
  overlay.classList.add("hidden");
  if (wizardSession) {
    const manager = window.__demogodManager;
    if (manager) manager.destroySession(wizardSession.id);
    wizardSession = null;
  }
  sessionContainer.innerHTML = "";
  currentPhase = 0;
  updateSidebar(1, "active");
}

btnOnboarding.addEventListener("click", openWizard);
btnClose.addEventListener("click", closeWizard);

overlay.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeWizard();
  }
});
