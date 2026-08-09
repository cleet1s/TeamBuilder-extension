// Isolated-world content script. Bridges the extension (popup/options,
// chrome.storage) and inject.js, which runs in the page's own JS context.

const NETWORK_LOG_KEY = "networkLog";
const MAX_LOG_ENTRIES = 50;

// Team Builder URLs look like
// https://www.ea.com/games/madden-nfl/team-builder/team-create/{page}/{brandId}
// e.g. .../team-create/roster/rUfkIObgju -- the last path segment is the
// brand/team id of whatever team the user currently has open.
const BRAND_ID_PATTERN = /\/team-create\/[a-z-]+\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i;

function getTeamContext() {
  const match = location.pathname.match(BRAND_ID_PATTERN);
  const brandId = match ? match[1] : null;
  const nameEl = document.querySelector(".team-media-title > div:first-child");
  const teamName = nameEl?.textContent.trim() || null;
  return { brandId, teamName, url: location.href };
}

window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "mtt-inject" || event.data?.type !== "NETWORK_LOG") return;

  const { [NETWORK_LOG_KEY]: log = [] } = await chrome.storage.local.get(NETWORK_LOG_KEY);
  log.unshift(event.data.entry);
  await chrome.storage.local.set({ [NETWORK_LOG_KEY]: log.slice(0, MAX_LOG_ENTRIES) });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_TEAM_CONTEXT") {
    sendResponse(getTeamContext());
    return;
  }
  if (message.type !== "IMPORT_ROSTER") return;
  window.postMessage(
    { source: "mtt-content", type: "PUSH_ROSTER", roster: message.roster, teamContext: getTeamContext() },
    "*"
  );
  sendResponse({ ok: true });
});

injectFloatingButton();

function injectFloatingButton() {
  const btn = document.createElement("button");
  btn.textContent = "Madden Roster Toolkit";
  btn.id = "mtt-floating-btn";
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: 999999,
    padding: "10px 16px",
    borderRadius: "999px",
    border: "none",
    background: "#4361ee",
    color: "#fff",
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: "13px",
    cursor: "pointer",
    boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
  });
  btn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  document.documentElement.appendChild(btn);
}
