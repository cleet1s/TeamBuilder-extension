// Runs in the PAGE's own JS context (manifest "world": "MAIN"), before any
// of Team Builder's own scripts, same trick the teamcrafters-classic-roster-
// importer extension uses on EA's CFB Team Builder: patch fetch/XHR early so
// we can see (and eventually rewrite) the calls the app makes.
//
// STATUS: recon-only for now. We don't yet know Madden Team Builder's actual
// endpoints/response shape for roster/preset data, so pushRoster() below is a
// stub. Once you capture real traffic (see README "Reverse-engineering Team
// Builder"), fill in the matching + rewrite logic where marked TODO.

(function () {
  const INTERESTING = /roster|preset|template|player|team[_-]?builder|squad/i;
  const MAX_LOG_ENTRIES = 50;

  function relayToContentScript(entry) {
    window.postMessage({ source: "mtt-inject", type: "NETWORK_LOG", entry }, "*");
  }

  function summarize(url, method, status, bodyPreview) {
    return {
      time: new Date().toISOString(),
      method,
      url,
      status,
      bodyPreview: bodyPreview?.slice(0, 500) ?? null,
    };
  }

  // --- fetch patch ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = args[0];
    const url = typeof request === "string" ? request : request?.url ?? "";
    const method = (typeof request === "object" && request?.method) || args[1]?.method || "GET";
    const response = await originalFetch.apply(this, args);

    if (INTERESTING.test(url)) {
      response
        .clone()
        .text()
        .then((body) => {
          console.debug("[Madden Roster Toolkit] fetch:", method, url, response.status);
          relayToContentScript(summarize(url, method, response.status, body));
        })
        .catch(() => {
          relayToContentScript(summarize(url, method, response.status, null));
        });
    }
    return response;
  };

  // --- XHR patch ---
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__mtt = { method, url };
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__mtt && INTERESTING.test(this.__mtt.url)) {
      this.addEventListener("loadend", () => {
        console.debug("[Madden Roster Toolkit] xhr:", this.__mtt.method, this.__mtt.url, this.status);
        relayToContentScript(summarize(this.__mtt.url, this.__mtt.method, this.status, this.responseText));
      });
    }
    return originalSend.apply(this, args);
  };

  // --- roster push (stub) ---
  // TODO: per docs/teambuilder-api-recon.md, the real save is a single PUT of
  // the whole team+roster bundle to a presigned S3 URL. Replace this with
  // logic that intercepts that outgoing PUT (fetch/XHR patches above already
  // give us the hook point) and splices `roster`, mapped to the PLYR_* schema,
  // into `teamData.roster.playerData` before it's sent -- the page's own
  // already-authenticated save flow does the rest. `teamContext` (below) is
  // whatever team the user currently has open, detected from the tab's URL
  // and the on-page team name -- always operate on that team, never a
  // hardcoded one.
  function pushRoster(roster, teamContext) {
    window.__mttPendingRoster = roster;
    window.__mttTeamContext = teamContext;
    const teamLabel = teamContext?.brandId
      ? `"${teamContext.teamName ?? "unnamed team"}" (${teamContext.brandId})`
      : "an undetected team (open Brand/Roster/... in Team Builder first)";
    console.info(
      `[Madden Roster Toolkit] Received roster to push for ${teamLabel}, but the Team Builder integration isn't wired up yet.\n` +
        "The roster is available at window.__mttPendingRoster (and the detected team at window.__mttTeamContext) for manual inspection.\n" +
        "See docs/teambuilder-api-recon.md and README.md for how to help finish this.",
      roster
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "mtt-content" || event.data?.type !== "PUSH_ROSTER") return;
    pushRoster(event.data.roster, event.data.teamContext);
  });

  console.info("[Madden Roster Toolkit] Network recon active on", location.href);
})();
