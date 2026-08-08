import { validateRoster } from "../lib/model.js";
import { getActiveRoster } from "../lib/storage.js";

const el = {
  rosterName: document.getElementById("roster-name"),
  rosterStatus: document.getElementById("roster-status"),
  openOptions: document.getElementById("open-options"),
  importBtn: document.getElementById("import-btn"),
  siteStatus: document.getElementById("site-status"),
};

const TEAM_BUILDER_PATTERNS = [
  "https://teambuilder.easports.com/",
  "https://www.ea.com/games/madden-nfl/team-builder/",
];

async function init() {
  const roster = await getActiveRoster();
  if (!roster) {
    el.rosterName.textContent = "No roster yet";
    el.rosterStatus.textContent = "Create one in the roster editor.";
    el.rosterStatus.className = "status none";
    el.importBtn.disabled = true;
  } else {
    el.rosterName.textContent = roster.name;
    const problems = validateRoster(roster);
    if (problems.length === 0) {
      el.rosterStatus.textContent = `${roster.players.length} players, ready to import.`;
      el.rosterStatus.className = "status ok";
    } else {
      el.rosterStatus.textContent = problems[0];
      el.rosterStatus.className = "status problem";
    }
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onTeamBuilder = !!tab?.url && TEAM_BUILDER_PATTERNS.some(p => tab.url.startsWith(p));
  if (!onTeamBuilder) {
    el.siteStatus.textContent = "Open Team Builder to push a roster.";
    el.importBtn.disabled = true;
  } else {
    el.siteStatus.textContent = "Team Builder detected on this tab.";
  }

  el.importBtn.addEventListener("click", async () => {
    if (!tab?.id) return;
    el.importBtn.disabled = true;
    el.importBtn.textContent = "Sending…";
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "IMPORT_ROSTER",
        roster,
      });
      el.importBtn.textContent = response?.ok ? "Sent" : "Not ready yet";
    } catch (err) {
      el.importBtn.textContent = "Not ready yet";
    }
  });
}

el.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
