// Merges an extension roster into a captured Team Builder save bundle
// ("teamData.roster.playerData" from a *-nonce-primary.json PUT -- see
// docs/teambuilder-api-recon.md). We patch matched players in place rather
// than replacing playerData wholesale: Team Builder generates a lot of
// fields we don't have equivalents for (contracts, draft history, portrait,
// asset name, ...), and whether the server accepts invented player ids or a
// changed roster size is untested, so leaving everything we don't have data
// for untouched is the safe default.
//
// NOTE: src/content/inject.js (a MAIN-world content script, which can't use
// ES module imports) keeps its own copy of this logic for the actual push.
// Keep the two in sync if either changes.

import { positionIdForCode, resolveRatingField, clampRating } from "./eaSchema.js";

// PLYR_WEIGHT is not literal pounds -- it's an offset from the UI slider's
// 160 lb floor (e.g. a raw "40" displays as 200 lbs; confirmed against a live
// save). PLYR_HEIGHT, by contrast, is literal inches with no offset.
const WEIGHT_LBS_OFFSET = 160;

export function applyRosterToBundle(bundle, roster) {
  const playerData = bundle?.teamData?.roster?.playerData;
  if (!playerData) {
    throw new Error(
      "Bundle is missing teamData.roster.playerData -- unexpected shape, see docs/teambuilder-api-recon.md"
    );
  }

  const bundleEntries = Object.entries(playerData);
  const usedBundleIds = new Set();
  const pairs = [];
  const remainingRoster = [];

  // Pass 1: match by jersey number, the most reliable signal we have.
  for (const rp of roster.players) {
    if (rp.jerseyNumber == null) {
      remainingRoster.push(rp);
      continue;
    }
    const jersey = String(rp.jerseyNumber);
    const candidate = bundleEntries.find(
      ([id, bp]) => !usedBundleIds.has(id) && bp.PLYR_JERSEYNUM === jersey
    );
    if (candidate) {
      usedBundleIds.add(candidate[0]);
      pairs.push([candidate, rp]);
    } else {
      remainingRoster.push(rp);
    }
  }

  // Pass 2: match whatever's left by position (first open slot of that
  // position). Anything still unmatched after this is reported, not forced.
  const unmatchedRoster = [];
  for (const rp of remainingRoster) {
    const posId = positionIdForCode(rp.position);
    const candidate =
      posId != null &&
      bundleEntries.find(
        ([id, bp]) => !usedBundleIds.has(id) && String(bp.PLYR_POSITION) === String(posId)
      );
    if (candidate) {
      usedBundleIds.add(candidate[0]);
      pairs.push([candidate, rp]);
    } else {
      unmatchedRoster.push(rp);
    }
  }

  for (const [[, bundlePlayer], rosterPlayer] of pairs) {
    applyPlayerFields(bundlePlayer, rosterPlayer);
  }

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
  if (rosterPlayer.weightLbs != null) {
    bundlePlayer.PLYR_WEIGHT = String(Math.max(0, Math.min(240, Math.round(rosterPlayer.weightLbs - WEIGHT_LBS_OFFSET))));
  }
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
