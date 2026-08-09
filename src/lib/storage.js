// Thin wrapper around chrome.storage.local so the roster list survives
// popup/options page reloads and is shared with the content script.

const ROSTERS_KEY = "rosters";
const ACTIVE_ROSTER_KEY = "activeRosterId";

export async function getRosters() {
  const { [ROSTERS_KEY]: rosters = [] } = await chrome.storage.local.get(ROSTERS_KEY);
  return rosters;
}

export async function saveRoster(roster) {
  const rosters = await getRosters();
  const idx = rosters.findIndex(r => r.id === roster.id);
  roster.updatedAt = Date.now();
  if (idx === -1) {
    rosters.push(roster);
  } else {
    rosters[idx] = roster;
  }
  await chrome.storage.local.set({ [ROSTERS_KEY]: rosters });
  return roster;
}

export async function deleteRoster(rosterId) {
  const rosters = await getRosters();
  const next = rosters.filter(r => r.id !== rosterId);
  await chrome.storage.local.set({ [ROSTERS_KEY]: next });
  const activeId = await getActiveRosterId();
  if (activeId === rosterId) {
    await setActiveRosterId(next[0]?.id ?? null);
  }
}

export async function getActiveRosterId() {
  const { [ACTIVE_ROSTER_KEY]: id = null } = await chrome.storage.local.get(ACTIVE_ROSTER_KEY);
  return id;
}

export async function setActiveRosterId(id) {
  await chrome.storage.local.set({ [ACTIVE_ROSTER_KEY]: id });
}

export async function getActiveRoster() {
  const [rosters, activeId] = await Promise.all([getRosters(), getActiveRosterId()]);
  return rosters.find(r => r.id === activeId) ?? null;
}

const SELECTED_FONTS_KEY = "selectedFonts";

// { nameFontId?, numberFontId? } -- remembers the popup's font picker
// selection across opens. Not tied to a specific roster/team.
export async function getSelectedFonts() {
  const { [SELECTED_FONTS_KEY]: fonts = {} } = await chrome.storage.local.get(SELECTED_FONTS_KEY);
  return fonts;
}

export async function setSelectedFonts(fonts) {
  await chrome.storage.local.set({ [SELECTED_FONTS_KEY]: fonts });
}
