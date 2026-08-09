// Runs in the PAGE's own JS context (manifest "world": "MAIN"), before any
// of Team Builder's own scripts, same trick the teamcrafters-classic-roster-
// importer extension uses on EA's CFB Team Builder: patch fetch/XHR early so
// we can see (and rewrite) the calls the app makes.
//
// The real save flow (see docs/teambuilder-api-recon.md) is: Team Builder
// serializes the whole team+roster into one JSON document and PUTs it,
// unauthenticated-header-wise (auth rides the ambient browser session), to a
// presigned S3 URL whose filename ends in "nonce-primary.json". There is no
// per-player endpoint. So "push a roster" means: arm a pending roster, click
// Team Builder's own SAVE button (or wait for the user to), and rewrite that
// one outgoing PUT's body in flight before it leaves the browser -- the
// page's own already-authenticated save flow does everything else.
//
// RATINGS/POSITIONS/etc. below mirror src/lib/eaSchema.js and
// src/lib/rosterToBundle.js. MAIN-world content scripts can't use ES module
// imports, so this is a duplicate, not a re-export -- keep them in sync.

(function () {
  const INTERESTING = /roster|preset|template|player|team[_-]?builder|squad/i;
  const BUNDLE_URL_PATTERN = /nonce-primary\.json/i;
  const PENDING_TTL_MS = 5 * 60 * 1000;

  // --- schema (mirrors src/lib/eaSchema.js) ---
  const RATINGS = [
    ["PLYR_ACCELERATION", "ACC", "Acceleration"], ["PLYR_AGILITY", "AGI", "Agility"],
    ["PLYR_AWARENESS", "AWR", "Awareness"], ["PLYR_BCVISION", "BCV", "Ball Carrier Vision"],
    ["PLYR_BLOCKSHEDDING", "BSH", "Block Shedding"], ["PLYR_BREAKSACK", "BSK", "Break Sack"],
    ["PLYR_BREAKTACKLE", "BTK", "Break Tackle"], ["PLYR_CARRYING", "CAR", "Carrying"],
    ["PLYR_CATCHING", "CTH", "Catching"], ["PLYR_CATCHINTRAFFIC", "CIT", "Catch in Traffic"],
    ["PLYR_CHANGEOFDIRECTION", "COD", "Change of Direction"], ["PLYR_DEEPROUTERUN", "DRR", "Deep Route Run"],
    ["PLYR_FINESSEMOVES", "FMV", "Finesse Moves"], ["PLYR_HITPOWER", "POW", "Hit Power"],
    ["PLYR_IMPACTBLOCKING", "IBL", "Impact Blocking"], ["PLYR_INJURY", "INJ", "Injury"],
    ["PLYR_JUKEMOVE", "JKM", "Juke Move"], ["PLYR_JUMPING", "JMP", "Jumping"],
    ["PLYR_KICKACCURACY", "KAC", "Kick Accuracy"], ["PLYR_KICKPOWER", "KPW", "Kick Power"],
    ["PLYR_KICKRETURN", "RET", "Return"], ["PLYR_LEADBLOCK", "LBK", "Lead Block"],
    ["PLYR_LONGSNAPRATING", "LSP", "Long Snap"], ["PLYR_MANCOVERAGE", "MCV", "Man Coverage"],
    ["PLYR_MEDROUTERUN", "MRR", "Medium Route Run"], ["PLYR_PASSBLOCK", "PBK", "Pass Block"],
    ["PLYR_PASSBLOCKFINESSE", "PBF", "Pass Block Finesse"], ["PLYR_PASSBLOCKPOWER", "PBP", "Pass Block Power"],
    ["PLYR_PLAYACTION", "PAC", "Play Action"], ["PLYR_PLAYRECOGNITION", "PRC", "Play Recognition"],
    ["PLYR_POWERMOVES", "PMV", "Power Moves"], ["PLYR_PRESS", "PRS", "Press"],
    ["PLYR_PURSUIT", "PUR", "Pursuit"], ["PLYR_RELEASE", "RLS", "Release"],
    ["PLYR_RUNBLOCK", "RBK", "Run Block"], ["PLYR_RUNBLOCKFINESSE", "RBF", "Run Block Finesse"],
    ["PLYR_RUNBLOCKPOWER", "RBP", "Run Block Power"], ["PLYR_SHORTROUTERUN", "SRR", "Short Route Run"],
    ["PLYR_SPECTACULARCATCH", "SPC", "Spectacular Catch"], ["PLYR_SPEED", "SPD", "Speed"],
    ["PLYR_SPINMOVE", "SPM", "Spin Move"], ["PLYR_STAMINA", "STA", "Stamina"],
    ["PLYR_STIFFARM", "SFA", "Stiff Arm"], ["PLYR_STRENGTH", "STR", "Strength"],
    ["PLYR_TACKLE", "TAK", "Tackle"], ["PLYR_THROWACCURACYDEEP", "DAC", "Deep Throw Accuracy"],
    ["PLYR_THROWACCURACYMID", "MAC", "Medium Throw Accuracy"], ["PLYR_THROWACCURACYSHORT", "SAC", "Short Throw Accuracy"],
    ["PLYR_THROWONTHERUN", "RUN", "Throw On The Run"], ["PLYR_THROWPOWER", "THP", "Throw Power"],
    ["PLYR_THROWUNDERPRESSURE", "TUP", "Throw Under Pressure"], ["PLYR_TOUGHNESS", "TGH", "Toughness"],
    ["PLYR_TRUCKING", "TRK", "Trucking"], ["PLYR_ZONECOVERAGE", "ZCV", "Zone Coverage"],
  ];
  const POSITIONS = [
    [0, "QB"], [1, "HB"], [2, "FB"], [3, "WR"], [4, "TE"], [5, "LT"], [6, "LG"], [7, "C"], [8, "RG"], [9, "RT"],
    [10, "LEDG"], [11, "REDG"], [12, "DT"], [13, "SAM"], [14, "MIKE"], [15, "WILL"],
    [16, "CB"], [17, "FS"], [18, "SS"], [19, "K"], [20, "P"], [21, "LS"],
  ];
  const POSITION_ALIASES = { LE: "LEDG", RE: "REDG", LOLB: "SAM", MLB: "MIKE", ROLB: "WILL" };

  function positionIdForCode(code) {
    const upper = String(code || "").toUpperCase();
    const normalized = POSITION_ALIASES[upper] || upper;
    const entry = POSITIONS.find(([, c]) => c === normalized);
    return entry ? entry[0] : null;
  }

  function normalizeKey(key) {
    return String(key || "").toUpperCase().replace(/^PLYR_/, "").replace(/[^A-Z0-9]/g, "");
  }
  const RATING_LOOKUP = new Map();
  for (const [field, abbr, name] of RATINGS) {
    RATING_LOOKUP.set(normalizeKey(field), field);
    RATING_LOOKUP.set(normalizeKey(abbr), field);
    RATING_LOOKUP.set(normalizeKey(name), field);
  }
  function resolveRatingField(key) {
    return RATING_LOOKUP.get(normalizeKey(key)) || null;
  }
  function clampRating(value) {
    const n = Number(value);
    if (Number.isNaN(n)) return null;
    return Math.max(0, Math.min(99, Math.round(n)));
  }

  // --- roster -> bundle merge (mirrors src/lib/rosterToBundle.js) ---
  function applyRosterToBundle(bundle, roster) {
    const playerData = bundle && bundle.teamData && bundle.teamData.roster && bundle.teamData.roster.playerData;
    if (!playerData) throw new Error("Bundle is missing teamData.roster.playerData");

    const bundleEntries = Object.entries(playerData);
    const usedBundleIds = new Set();
    const pairs = [];
    const remainingRoster = [];

    for (const rp of roster.players) {
      if (rp.jerseyNumber == null) { remainingRoster.push(rp); continue; }
      const jersey = String(rp.jerseyNumber);
      const candidate = bundleEntries.find(([id, bp]) => !usedBundleIds.has(id) && bp.PLYR_JERSEYNUM === jersey);
      if (candidate) { usedBundleIds.add(candidate[0]); pairs.push([candidate, rp]); }
      else remainingRoster.push(rp);
    }

    const unmatchedRoster = [];
    for (const rp of remainingRoster) {
      const posId = positionIdForCode(rp.position);
      const candidate = posId != null && bundleEntries.find(
        ([id, bp]) => !usedBundleIds.has(id) && String(bp.PLYR_POSITION) === String(posId)
      );
      if (candidate) { usedBundleIds.add(candidate[0]); pairs.push([candidate, rp]); }
      else unmatchedRoster.push(rp);
    }

    for (const [[, bundlePlayer], rosterPlayer] of pairs) applyPlayerFields(bundlePlayer, rosterPlayer);

    return {
      matched: pairs.length,
      unmatchedRosterPlayers: unmatchedRoster.map(p => `${p.firstName} ${p.lastName} (${p.position})`.trim()),
      unmatchedBundleSlots: bundleEntries.length - usedBundleIds.size,
      totalBundleSlots: bundleEntries.length,
      totalRosterPlayers: roster.players.length,
    };
  }

  function applyPlayerFields(bundlePlayer, rosterPlayer) {
    if (rosterPlayer.firstName) bundlePlayer.PLYR_FIRSTNAME = rosterPlayer.firstName;
    if (rosterPlayer.lastName) bundlePlayer.PLYR_LASTNAME = rosterPlayer.lastName;
    if (rosterPlayer.jerseyNumber != null) bundlePlayer.PLYR_JERSEYNUM = String(rosterPlayer.jerseyNumber);
    const posId = positionIdForCode(rosterPlayer.position);
    if (posId != null) bundlePlayer.PLYR_POSITION = String(posId);
    if (rosterPlayer.heightInches != null) bundlePlayer.PLYR_HEIGHT = String(rosterPlayer.heightInches);
    if (rosterPlayer.weightLbs != null) bundlePlayer.PLYR_WEIGHT = String(rosterPlayer.weightLbs);
    if (rosterPlayer.age != null) bundlePlayer.PLYR_AGE = String(rosterPlayer.age);
    if (rosterPlayer.overall != null) {
      const clamped = clampRating(rosterPlayer.overall);
      if (clamped != null) bundlePlayer.PLYR_OVERALLRATING = String(clamped);
    }
    for (const [key, value] of Object.entries(rosterPlayer.attributes || {})) {
      const field = resolveRatingField(key);
      if (!field) continue;
      const clamped = clampRating(value);
      if (clamped != null) bundlePlayer[field] = String(clamped);
    }
  }

  // --- recon logging (unchanged) ---
  function relayToContentScript(entry) {
    window.postMessage({ source: "mtt-inject", type: "NETWORK_LOG", entry }, "*");
  }
  function summarize(url, method, status, bodyPreview) {
    return { time: new Date().toISOString(), method, url, status, bodyPreview: bodyPreview?.slice(0, 500) ?? null };
  }

  // --- fetch patch: logging + bundle rewrite ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = args[0];
    const url = typeof request === "string" ? request : request?.url ?? "";
    const method = ((typeof request === "object" && request?.method) || args[1]?.method || "GET").toUpperCase();

    let armed = null;
    if (method === "PUT" && BUNDLE_URL_PATTERN.test(url) && pending) {
      armed = pending;
      pending = null; // one-shot: don't touch any later, unrelated bundle upload
      const init = args[1] || (args[1] = {});
      const rewritten = await tryRewriteBody(init.body, armed);
      if (rewritten != null) init.body = rewritten;
    }

    const response = await originalFetch.apply(this, args);
    if (armed) reportPushResult(armed, { ok: response.ok, status: response.status });
    if (INTERESTING.test(url)) {
      response.clone().text()
        .then((body) => relayToContentScript(summarize(url, method, response.status, body)))
        .catch(() => relayToContentScript(summarize(url, method, response.status, null)));
    }
    return response;
  };

  // --- XHR patch: logging + bundle rewrite ---
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__mtt = { method: String(method).toUpperCase(), url };
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__mtt;
    const xhr = this;

    if (info && INTERESTING.test(info.url)) {
      xhr.addEventListener("loadend", () => {
        relayToContentScript(summarize(info.url, info.method, xhr.status, xhr.responseText));
      });
    }

    if (info && info.method === "PUT" && BUNDLE_URL_PATTERN.test(info.url) && pending) {
      const armed = pending;
      pending = null; // one-shot: don't touch any later, unrelated bundle upload
      xhr.addEventListener("loadend", () => {
        reportPushResult(armed, { ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
      });
      tryRewriteBody(body, armed).then((rewritten) => {
        originalSend.call(xhr, rewritten != null ? rewritten : body);
      });
      return;
    }

    return originalSend.call(this, body);
  };

  async function tryRewriteBody(body, armed) {
    if (!armed) return null;
    let text = null;
    let encodeAs = "string";
    try {
      if (typeof body === "string") {
        text = body;
      } else if (body instanceof Blob) {
        text = await body.text();
        encodeAs = "blob:" + (body.type || "application/json");
      } else if (body instanceof ArrayBuffer) {
        text = new TextDecoder().decode(body);
        encodeAs = "arraybuffer";
      } else if (ArrayBuffer.isView(body)) {
        text = new TextDecoder().decode(body.buffer);
        encodeAs = "arraybuffer";
      } else {
        return null; // unrecognized body shape, don't touch it
      }

      const parsed = JSON.parse(text);
      const report = applyRosterToBundle(parsed, armed.roster);
      console.info("[Madden Roster Toolkit] Rewrote outgoing roster bundle:", report);
      armed.report = report;
      const rewrittenText = JSON.stringify(parsed);

      if (encodeAs === "string") return rewrittenText;
      if (encodeAs === "arraybuffer") return new TextEncoder().encode(rewrittenText).buffer;
      return new Blob([rewrittenText], { type: encodeAs.slice("blob:".length) });
    } catch (err) {
      console.warn("[Madden Roster Toolkit] Couldn't rewrite bundle, sending it unmodified:", err);
      return null;
    }
  }

  function reportPushResult(armed, { ok, status }) {
    window.postMessage(
      { source: "mtt-inject", type: "PUSH_RESULT", ok, status, report: armed.report, teamContext: armed.teamContext },
      "*"
    );
  }

  // --- roster push: arm the interceptor, then try to trigger the real SAVE ---
  let pending = null; // { roster, teamContext, report? }

  function findSaveButton() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
    return candidates.find((el) => {
      const text = (el.textContent || "").trim().toLowerCase();
      return text === "save" && !el.disabled && el.offsetParent !== null;
    });
  }

  function pushRoster(roster, teamContext) {
    pending = { roster, teamContext };
    window.__mttPendingRoster = roster;
    window.__mttTeamContext = teamContext;

    setTimeout(() => {
      if (pending && pending.roster === roster) pending = null; // TTL backstop
    }, PENDING_TTL_MS);

    const saveBtn = findSaveButton();
    if (saveBtn) {
      console.info("[Madden Roster Toolkit] Armed and clicking Team Builder's SAVE button.");
      saveBtn.click();
    } else {
      console.info(
        "[Madden Roster Toolkit] Armed, but couldn't find the SAVE button automatically -- click SAVE in Team Builder to finish."
      );
      window.postMessage(
        { source: "mtt-inject", type: "PUSH_ARMED", autoClicked: false, teamContext },
        "*"
      );
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "mtt-content" || event.data?.type !== "PUSH_ROSTER") return;
    pushRoster(event.data.roster, event.data.teamContext);
  });

  console.info("[Madden Roster Toolkit] Network recon + roster push active on", location.href);
})();
