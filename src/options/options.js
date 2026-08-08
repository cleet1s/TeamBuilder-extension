import { emptyPlayer, emptyRoster, validateRoster, POSITIONS } from "../lib/model.js";
import { getRosters, saveRoster, deleteRoster, getActiveRosterId, setActiveRosterId } from "../lib/storage.js";
import { rosterToCsv, csvToPlayers } from "../lib/csv.js";

let rosters = [];
let currentId = null;

const el = {
  rosterList: document.getElementById("roster-list"),
  newRosterBtn: document.getElementById("new-roster-btn"),
  rosterName: document.getElementById("roster-name"),
  teamName: document.getElementById("team-name"),
  deleteRosterBtn: document.getElementById("delete-roster-btn"),
  exportCsvBtn: document.getElementById("export-csv-btn"),
  csvInput: document.getElementById("csv-input"),
  validation: document.getElementById("validation"),
  playerRows: document.getElementById("player-rows"),
  addPlayerBtn: document.getElementById("add-player-btn"),
  playerCount: document.getElementById("player-count"),
  attrDialog: document.getElementById("attr-dialog"),
  attrRows: document.getElementById("attr-rows"),
  attrAddRow: document.getElementById("attr-add-row"),
  attrClose: document.getElementById("attr-close"),
  networkLog: document.getElementById("network-log"),
  refreshLogBtn: document.getElementById("refresh-log-btn"),
  clearLogBtn: document.getElementById("clear-log-btn"),
};

let attrDialogPlayerId = null;

async function init() {
  rosters = await getRosters();
  currentId = await getActiveRosterId();

  if (rosters.length === 0) {
    const roster = emptyRoster("My First Roster");
    rosters.push(roster);
    await saveRoster(roster);
    currentId = roster.id;
    await setActiveRosterId(currentId);
  }
  if (!rosters.find(r => r.id === currentId)) {
    currentId = rosters[0].id;
    await setActiveRosterId(currentId);
  }

  renderSidebar();
  renderRoster();
}

function currentRoster() {
  return rosters.find(r => r.id === currentId);
}

function renderSidebar() {
  el.rosterList.innerHTML = "";
  for (const roster of rosters) {
    const li = document.createElement("li");
    li.textContent = roster.name || "Untitled Roster";
    li.className = roster.id === currentId ? "active" : "";
    li.addEventListener("click", async () => {
      currentId = roster.id;
      await setActiveRosterId(currentId);
      renderSidebar();
      renderRoster();
    });
    el.rosterList.appendChild(li);
  }
}

function renderRoster() {
  const roster = currentRoster();
  if (!roster) return;

  el.rosterName.value = roster.name;
  el.teamName.value = roster.teamName;

  renderValidation(roster);
  renderPlayerRows(roster);
  el.playerCount.textContent = `${roster.players.length} players`;
}

function renderValidation(roster) {
  const problems = validateRoster(roster);
  el.validation.innerHTML = "";
  if (problems.length === 0) {
    const ok = document.createElement("span");
    ok.className = "ok";
    ok.textContent = "Roster looks complete.";
    el.validation.appendChild(ok);
    return;
  }
  for (const p of problems) {
    const span = document.createElement("span");
    span.className = "problem";
    span.textContent = p;
    el.validation.appendChild(span);
  }
}

function renderPlayerRows(roster) {
  el.playerRows.innerHTML = "";
  roster.players.forEach((player, index) => {
    el.playerRows.appendChild(buildPlayerRow(player, index));
  });
}

function buildPlayerRow(player, index) {
  const tr = document.createElement("tr");

  const dragCell = document.createElement("td");
  dragCell.textContent = index + 1;
  tr.appendChild(dragCell);

  tr.appendChild(textCell(player, "firstName", "text"));
  tr.appendChild(textCell(player, "lastName", "text"));
  tr.appendChild(textCell(player, "jerseyNumber", "number"));
  tr.appendChild(positionCell(player));
  tr.appendChild(textCell(player, "heightInches", "number"));
  tr.appendChild(textCell(player, "weightLbs", "number"));
  tr.appendChild(textCell(player, "age", "number"));
  tr.appendChild(textCell(player, "college", "text"));
  tr.appendChild(textCell(player, "overall", "number"));

  const attrsCell = document.createElement("td");
  attrsCell.className = "attrs-cell";
  const attrCount = Object.keys(player.attributes || {}).length;
  const attrBtn = document.createElement("button");
  attrBtn.textContent = attrCount > 0 ? `Edit (${attrCount})` : "Add";
  attrBtn.addEventListener("click", () => openAttrDialog(player));
  attrsCell.appendChild(attrBtn);
  tr.appendChild(attrsCell);

  const removeCell = document.createElement("td");
  removeCell.className = "remove-cell";
  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => removePlayer(player.id));
  removeCell.appendChild(removeBtn);
  tr.appendChild(removeCell);

  return tr;
}

function textCell(player, field, type) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = type;
  input.value = player[field] ?? "";
  input.addEventListener("change", () => {
    player[field] = type === "number" ? numOrNull(input.value) : input.value;
    persistCurrentRoster({ skipRowRender: true });
  });
  td.appendChild(input);
  return td;
}

function positionCell(player) {
  const td = document.createElement("td");
  const select = document.createElement("select");
  for (const pos of POSITIONS) {
    const opt = document.createElement("option");
    opt.value = pos;
    opt.textContent = pos;
    if (pos === player.position) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => {
    player.position = select.value;
    persistCurrentRoster({ skipRowRender: true });
  });
  td.appendChild(select);
  return td;
}

function numOrNull(value) {
  if (value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

async function persistCurrentRoster({ skipRowRender = false } = {}) {
  const roster = currentRoster();
  await saveRoster(roster);
  renderValidation(roster);
  el.playerCount.textContent = `${roster.players.length} players`;
  if (!skipRowRender) renderPlayerRows(roster);
  renderSidebar();
}

function removePlayer(playerId) {
  const roster = currentRoster();
  roster.players = roster.players.filter(p => p.id !== playerId);
  persistCurrentRoster();
}

function openAttrDialog(player) {
  attrDialogPlayerId = player.id;
  el.attrRows.innerHTML = "";
  const entries = Object.entries(player.attributes || {});
  if (entries.length === 0) entries.push(["", ""]);
  for (const [key, val] of entries) {
    el.attrRows.appendChild(buildAttrRow(key, val));
  }
  el.attrDialog.showModal();
}

function buildAttrRow(key, val) {
  const row = document.createElement("div");
  row.className = "attr-row";
  const keyInput = document.createElement("input");
  keyInput.className = "attr-key";
  keyInput.placeholder = "e.g. speed";
  keyInput.value = key;
  const valInput = document.createElement("input");
  valInput.className = "attr-val";
  valInput.type = "number";
  valInput.placeholder = "0-99";
  valInput.value = val;
  const removeBtn = document.createElement("button");
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => row.remove());
  row.append(keyInput, valInput, removeBtn);
  return row;
}

el.attrAddRow.addEventListener("click", () => {
  el.attrRows.appendChild(buildAttrRow("", ""));
});

el.attrClose.addEventListener("click", (e) => {
  e.preventDefault();
  const roster = currentRoster();
  const player = roster.players.find(p => p.id === attrDialogPlayerId);
  const attrs = {};
  for (const row of el.attrRows.querySelectorAll(".attr-row")) {
    const key = row.querySelector(".attr-key").value.trim();
    const val = row.querySelector(".attr-val").value;
    if (key !== "" && val !== "") attrs[key] = Number(val);
  }
  player.attributes = attrs;
  el.attrDialog.close();
  persistCurrentRoster();
});

el.rosterName.addEventListener("change", () => {
  currentRoster().name = el.rosterName.value;
  persistCurrentRoster({ skipRowRender: true });
});
el.teamName.addEventListener("change", () => {
  currentRoster().teamName = el.teamName.value;
  persistCurrentRoster({ skipRowRender: true });
});

el.newRosterBtn.addEventListener("click", async () => {
  const roster = emptyRoster(`Roster ${rosters.length + 1}`);
  rosters.push(roster);
  await saveRoster(roster);
  currentId = roster.id;
  await setActiveRosterId(currentId);
  renderSidebar();
  renderRoster();
});

el.deleteRosterBtn.addEventListener("click", async () => {
  if (rosters.length === 1) {
    alert("Can't delete your only roster.");
    return;
  }
  if (!confirm(`Delete "${currentRoster().name}"? This can't be undone.`)) return;
  await deleteRoster(currentId);
  rosters = await getRosters();
  currentId = await getActiveRosterId();
  renderSidebar();
  renderRoster();
});

el.addPlayerBtn.addEventListener("click", () => {
  currentRoster().players.push(emptyPlayer());
  persistCurrentRoster();
});

el.exportCsvBtn.addEventListener("click", () => {
  const roster = currentRoster();
  const csv = rosterToCsv(roster);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${roster.name.replace(/[^a-z0-9-_]+/gi, "_") || "roster"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

el.csvInput.addEventListener("change", async () => {
  const file = el.csvInput.files[0];
  if (!file) return;
  const text = await file.text();
  const players = csvToPlayers(text);
  currentRoster().players = players;
  await persistCurrentRoster();
  el.csvInput.value = "";
});

async function renderNetworkLog() {
  const { networkLog = [] } = await chrome.storage.local.get("networkLog");
  el.networkLog.textContent = networkLog.length === 0
    ? "No requests logged yet. Open Team Builder in another tab and use it a bit."
    : networkLog.map(e => `${e.time}  ${e.method} ${e.status}  ${e.url}\n${e.bodyPreview ?? ""}`).join("\n\n");
}

el.refreshLogBtn.addEventListener("click", renderNetworkLog);
el.clearLogBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ networkLog: [] });
  renderNetworkLog();
});

init();
renderNetworkLog();
