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
  // teamData.frostbiteData.characterVisuals is a SEPARATE per-player record
  // (same ids as playerData) driving the 3D model and jersey nameplate --
  // name/jersey#/height/weight are duplicated here, NOT derived from
  // playerData. If we don't patch this too, a pushed player's ratings/name
  // update in the roster list but their 3D model and jersey still show the
  // old name.
  const characterVisuals = bundle?.teamData?.frostbiteData?.characterVisuals;

  const bundleEntries = Object.entries(playerData);
  const usedBundleIds = new Set();
  const pairs = [];
  const remainingRoster = [];

  // Pass 1: match by jersey number -- but ONLY if the candidate's existing
  // position also agrees with the roster player's intended position. Jersey
  // numbers are not guaranteed unique across the whole bundle (confirmed: a
  // real preset had the same number on both an HB and a CB slot), and
  // Object.entries() walks numeric-string keys in ascending id order, not
  // position order -- an unqualified jersey match can silently land a player
  // in a same-numbered but wrong-position slot, corrupting it (observed
  // live: Team Builder's OVR formula produced 0 for a HB-flavored player
  // pushed into an originally-CB slot). If jersey+position don't agree,
  // treat it as no match and fall through to position-based Pass 2.
  for (const rp of roster.players) {
    if (rp.jerseyNumber == null) {
      remainingRoster.push(rp);
      continue;
    }
    const jersey = String(rp.jerseyNumber);
    const posId = positionIdForCode(rp.position);
    const candidate = bundleEntries.find(
      ([id, bp]) =>
        !usedBundleIds.has(id) &&
        bp.PLYR_JERSEYNUM === jersey &&
        (posId == null || String(bp.PLYR_POSITION) === String(posId))
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

  for (const [[id, bundlePlayer], rosterPlayer] of pairs) {
    applyPlayerFields(bundlePlayer, rosterPlayer);
    applyCharacterVisualFields(characterVisuals?.[id], rosterPlayer);
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

// Unlike playerData's PLYR_* fields (all strings, PLYR_WEIGHT offset-encoded),
// characterVisuals stores these as plain numbers and weightPounds is literal
// pounds -- confirmed against a live save. jerseyName isn't independently
// editable in the UI; it tracks lastName.
function applyCharacterVisualFields(visual, rosterPlayer) {
  if (!visual) return;
  if (rosterPlayer.firstName) visual.firstName = rosterPlayer.firstName;
  if (rosterPlayer.lastName) {
    visual.lastName = rosterPlayer.lastName;
    visual.jerseyName = rosterPlayer.lastName;
  }
  if (rosterPlayer.jerseyNumber != null) visual.jerseyNumber = rosterPlayer.jerseyNumber;
  if (rosterPlayer.heightInches != null) visual.heightInches = rosterPlayer.heightInches;
  if (rosterPlayer.weightLbs != null) visual.weightPounds = rosterPlayer.weightLbs;
}

// NAME_FONT_ID/NUMBER_FONT_ID are plain strings in teamData.teamInfos, same
// flat shape as TEAM_NAME/TEAM_PRIMARY_LOGO/etc -- see docs/teambuilder-
// api-recon.md's Brand-tab section. Team Builder's own Font Picker UI only
// exposes 4 of the number-font catalog's 21 real entries as clickable
// buttons; this can set any catalog id (fetched via src/lib/fontCatalog.js),
// live-tested against a real save (2026-08-09): an off-UI font persists and
// renders correctly.
export function applyFontsToBundle(bundle, fonts) {
  const teamInfos = bundle?.teamData?.teamInfos;
  if (!teamInfos) {
    throw new Error(
      "Bundle is missing teamData.teamInfos -- unexpected shape, see docs/teambuilder-api-recon.md"
    );
  }
  const applied = {};
  if (fonts?.nameFontId) {
    teamInfos.NAME_FONT_ID = fonts.nameFontId;
    applied.nameFontId = fonts.nameFontId;
  }
  if (fonts?.numberFontId) {
    teamInfos.NUMBER_FONT_ID = fonts.numberFontId;
    applied.numberFontId = fonts.numberFontId;
  }
  return applied;
}
