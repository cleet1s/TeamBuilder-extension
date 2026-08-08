// Isolated-world content script. Bridges the extension (popup/options,
// chrome.storage) and inject.js, which runs in the page's own JS context.

const NETWORK_LOG_KEY = "networkLog";
const MAX_LOG_ENTRIES = 50;

window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "mtt-inject" || event.data?.type !== "NETWORK_LOG") return;

  const { [NETWORK_LOG_KEY]: log = [] } = await chrome.storage.local.get(NETWORK_LOG_KEY);
  log.unshift(event.data.entry);
  await chrome.storage.local.set({ [NETWORK_LOG_KEY]: log.slice(0, MAX_LOG_ENTRIES) });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "IMPORT_ROSTER") return;
  window.postMessage({ source: "mtt-content", type: "PUSH_ROSTER", roster: message.roster }, "*");
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
