// Shared data model for rosters. `attributes` stays a free-form map (rather
// than locking the editor UI to exactly Team Builder's 54 PLYR_* ratings) so
// this editor isn't hostage to EA renaming/adding fields -- but the keys are
// resolved against the real schema (src/lib/eaSchema.js) at push time, and
// position codes below already match Team Builder's real ones. See
// docs/teambuilder-api-recon.md for where this schema came from.

import { POSITIONS as EA_POSITIONS, POSITION_ALIASES, normalizePosition } from "./eaSchema.js";

export const POSITIONS = EA_POSITIONS.map(([, code]) => code);
export { POSITION_ALIASES, normalizePosition };

export const ROSTER_SIZE = 53;

export const POSITION_MINIMUMS = {
  QB: 2, HB: 3, WR: 5, TE: 2, OL: 8, DL: 6, LB: 4, CB: 3, S: 2, K: 1, P: 1, LS: 1
};

export function emptyPlayer(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    firstName: "",
    lastName: "",
    jerseyNumber: null,
    position: "QB",
    heightInches: 72,
    weightLbs: 200,
    age: 22,
    college: "",
    overall: 60,
    // Free-form rating map, e.g. { speed: 80, strength: 65, awareness: 60, ... }.
    // Keys are matched against src/lib/eaSchema.js's RATINGS (by field name,
    // abbreviation, or display name, case/spacing-insensitive) when pushed.
    attributes: {},
    ...overrides
  };
}

export function emptyRoster(name = "New Roster") {
  return {
    id: crypto.randomUUID(),
    name,
    teamName: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    players: []
  };
}

export function validateRoster(roster) {
  const problems = [];
  if (roster.players.length !== ROSTER_SIZE) {
    problems.push(`Roster has ${roster.players.length} players, expected ${ROSTER_SIZE}.`);
  }
  const counts = {};
  for (const p of roster.players) {
    const pos = normalizePosition(p.position);
    counts[pos] = (counts[pos] || 0) + 1;
  }
  const groups = {
    QB: ["QB"], HB: ["HB"], WR: ["WR"], TE: ["TE"],
    OL: ["LT", "LG", "C", "RG", "RT"],
    DL: ["LEDG", "REDG", "DT"],
    LB: ["SAM", "MIKE", "WILL"],
    CB: ["CB"],
    S: ["FS", "SS"],
    K: ["K"], P: ["P"], LS: ["LS"]
  };
  for (const [group, positions] of Object.entries(groups)) {
    const min = POSITION_MINIMUMS[group];
    if (min == null) continue;
    const have = positions.reduce((sum, pos) => sum + (counts[pos] || 0), 0);
    if (have < min) {
      problems.push(`Need at least ${min} ${group} (have ${have}).`);
    }
  }
  return problems;
}
