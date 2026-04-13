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

  // Use the active session's project as the wizard's working directory
  const activeSession = window.__demogodActiveSession;
  const project = activeSession?.selectedProject;

  // Create a dedicated session for the wizard, pointed at the same project
  wizardSession = manager.createSession({ project });

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
  wizardSession.onReady(async () => {
    const projectName = project ? project.split("/").pop() : "this project";

    // Fetch the wizard agent prompt from the server
    let wizardPrompt = "";
    try {
      const res = await fetch("/api/wizard-prompt");
      if (res.ok) {
        const data = await res.json();
        wizardPrompt = data.prompt;
      }
    } catch (e) { console.debug("[Onboarding] Failed to fetch wizard prompt:", e); }

    wizardSession.addCommandEntry("Begin context setup for " + projectName);
    wizardSession.setProcessing(true);
    wizardSession.setStatus("Setting up...");

    // Send the wizard instructions + opening prompt as a single message
    const prompt = wizardPrompt
      ? wizardPrompt + "\n\n---\n\nBegin context setup for this project. The working directory is already set to " + (project || "the default directory") + ". Start with Phase 1: detect what tools and stack this project uses. Read .mcp.json first to see what MCP servers are already configured."
      : "You are a Context Setup Wizard. Scan this project, find what tools it uses, discover MCP servers for them, and help configure everything. Start by reading .mcp.json and scanning the project structure.";

    wizardSession.send("send_prompt", { prompt });
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
