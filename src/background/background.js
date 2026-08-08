// Minimal service worker. No persistent state lives here -- rosters and the
// network recon log both live in chrome.storage.local so popup, options, and
// content scripts can all read/write them directly.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.info("[Madden Roster Toolkit] Installed. Open the extension popup to build a roster.");
  }
});
