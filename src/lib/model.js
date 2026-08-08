// Shared data model for rosters. Kept intentionally loose (attributes is a
// free-form map) because EA's exact Team Builder rating schema isn't known
// yet -- see src/content/inject.js for where that gets locked down once we
// have real network traffic from Team Builder to reverse-engineer.

export const POSITIONS = [
  "QB", "HB", "FB", "WR", "TE",
  "LT", "LG", "C", "RG", "RT",
  "LE", "RE", "DT", "LOLB", "MLB", "ROLB",
  "CB", "FS", "SS",
  "K", "P"
];

export const ROSTER_SIZE = 53;

export const POSITION_MINIMUMS = {
  QB: 2, HB: 3, WR: 5, TE: 2, OL: 8, DL: 6, LB: 4, CB: 3, S: 2, K: 1, P: 1
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
    // Free-form rating map, e.g. { speed: 80, strength: 65, awareness: 60, ... }
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
    counts[p.position] = (counts[p.position] || 0) + 1;
  }
  const groups = {
    QB: ["QB"], HB: ["HB"], WR: ["WR"], TE: ["TE"],
    OL: ["LT", "LG", "C", "RG", "RT"],
    DL: ["LE", "RE", "DT"],
    LB: ["LOLB", "MLB", "ROLB"],
    CB: ["CB"],
    S: ["FS", "SS"],
    K: ["K"], P: ["P"]
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
