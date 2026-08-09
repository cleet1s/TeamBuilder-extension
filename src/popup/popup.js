import { validateRoster } from "../lib/model.js";
import { getActiveRoster, getSelectedFonts, setSelectedFonts } from "../lib/storage.js";
import { fetchNumberFonts, fetchNameplateFonts } from "../lib/fontCatalog.js";

const el = {
  rosterName: document.getElementById("roster-name"),
  rosterStatus: document.getElementById("roster-status"),
  openOptions: document.getElementById("open-options"),
  importBtn: document.getElementById("import-btn"),
  siteStatus: document.getElementById("site-status"),
  teamStatus: document.getElementById("team-status"),
  pushResult: document.getElementById("push-result"),
  nameplateFontSelect: document.getElementById("nameplate-font-select"),
  numberFontSelect: document.getElementById("number-font-select"),
  pushFontsBtn: document.getElementById("push-fonts-btn"),
};

const LAST_PUSH_RESULT_KEY = "lastPushResult";

// One shared result area for both the roster push and the fonts push --
// they hit the same underlying save, and a single save can carry both if
// both were armed, so there's nothing to disambiguate by showing separate
// panels.
function renderPushResult(result) {
  if (!result) {
    el.pushResult.textContent = "";
    el.pushResult.className = "push-result";
    return;
  }
  if (result.armed) {
    el.pushResult.textContent = result.autoClicked === false
      ? "Armed — click SAVE in Team Builder to finish."
      : "Armed, clicking SAVE…";
    el.pushResult.className = "push-result pending";
    return;
  }
  if (!result.ok) {
    el.pushResult.textContent = `Save failed (status ${result.status ?? "?"}).`;
    el.pushResult.className = "push-result problem";
    return;
  }
  const report = result.report;
  if (!report || (!report.roster && !report.fonts)) {
    el.pushResult.textContent = "Saved, but couldn't confirm what was pushed.";
    el.pushResult.className = "push-result problem";
    return;
  }

  const parts = [];
  let hasProblem = false;
  if (report.roster) {
    const r = report.roster;
    parts.push(`Roster: ${r.matched}/${r.totalRosterPlayers} players matched`);
    if (r.unmatchedRosterPlayers.length > 0) {
      hasProblem = true;
      parts.push(`${r.unmatchedRosterPlayers.length} unmatched (no open slot): ${r.unmatchedRosterPlayers.join(", ")}`);
    }
  }
  if (report.fonts) {
    const fontBits = [];
    if (report.fonts.nameFontId) fontBits.push(`nameplate → ${report.fonts.nameFontId}`);
    if (report.fonts.numberFontId) fontBits.push(`numbers → ${report.fonts.numberFontId}`);
    parts.push(`Fonts: ${fontBits.join(", ")}`);
  }
  el.pushResult.textContent = parts.join(". ");
  el.pushResult.className = `push-result ${hasProblem ? "problem" : "ok"}`;
}

function populateFontSelect(selectEl, fonts, selectedId) {
  selectEl.innerHTML = "";
  for (const font of fonts) {
    const opt = document.createElement("option");
    opt.value = font.id;
    opt.textContent = font.displayName || font.id;
    selectEl.appendChild(opt);
  }
  if (selectedId && fonts.some((f) => f.id === selectedId)) {
    selectEl.value = selectedId;
  }
}

async function initFonts() {
  const selected = await getSelectedFonts();
  try {
    const [nameplateFonts, numberFonts] = await Promise.all([
      fetchNameplateFonts(),
      fetchNumberFonts(),
    ]);
    populateFontSelect(el.nameplateFontSelect, nameplateFonts, selected.nameFontId);
    populateFontSelect(el.numberFontSelect, numberFonts, selected.numberFontId);
  } catch (err) {
    el.nameplateFontSelect.innerHTML = '<option value="">Couldn\'t load fonts</option>';
    el.numberFontSelect.innerHTML = '<option value="">Couldn\'t load fonts</option>';
    el.pushFontsBtn.disabled = true;
  }
}

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

  await initFonts();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onTeamBuilder = !!tab?.url && TEAM_BUILDER_PATTERNS.some(p => tab.url.startsWith(p));
  let teamContext = null;

  if (!onTeamBuilder) {
    el.siteStatus.textContent = "Open Team Builder to push a roster.";
    el.importBtn.disabled = true;
    el.pushFontsBtn.disabled = true;
  } else {
    try {
      teamContext = await chrome.tabs.sendMessage(tab.id, { type: "GET_TEAM_CONTEXT" });
    } catch (err) {
      // content script not ready yet (e.g. page still loading)
    }
    if (teamContext?.brandId) {
      el.siteStatus.textContent = "Team Builder detected on this tab.";
      el.teamStatus.textContent = `Pushing to: ${teamContext.teamName ?? "(unnamed team)"} (${teamContext.brandId})`;
    } else {
      el.siteStatus.textContent = "Open a specific team (Brand, Roster, ...) to push into.";
      el.importBtn.disabled = true;
      el.pushFontsBtn.disabled = true;
    }
  }

  const { [LAST_PUSH_RESULT_KEY]: lastResult } = await chrome.storage.local.get(LAST_PUSH_RESULT_KEY);
  renderPushResult(lastResult);

  el.importBtn.addEventListener("click", async () => {
    if (!tab?.id) return;
    el.importBtn.disabled = true;
    el.importBtn.textContent = "Sending…";
    renderPushResult(null);
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "IMPORT_ROSTER",
        roster,
      });
      el.importBtn.textContent = response?.ok ? "Sent" : "Not ready yet";
    } catch (err) {
      el.importBtn.textContent = "Not ready yet";
    }
    el.importBtn.disabled = false;
  });

  el.pushFontsBtn.addEventListener("click", async () => {
    if (!tab?.id) return;
    const fonts = {
      nameFontId: el.nameplateFontSelect.value || null,
      numberFontId: el.numberFontSelect.value || null,
    };
    await setSelectedFonts(fonts);
    el.pushFontsBtn.disabled = true;
    el.pushFontsBtn.textContent = "Sending…";
    renderPushResult(null);
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "IMPORT_FONTS",
        fonts,
      });
      el.pushFontsBtn.textContent = response?.ok ? "Sent" : "Not ready yet";
    } catch (err) {
      el.pushFontsBtn.textContent = "Not ready yet";
    }
    el.pushFontsBtn.disabled = false;
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[LAST_PUSH_RESULT_KEY]) return;
  renderPushResult(changes[LAST_PUSH_RESULT_KEY].newValue);
});

el.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
