// Team Builder's real player schema, reverse-engineered by capturing live
// network traffic. See docs/teambuilder-api-recon.md for how this was
// obtained and the full bundle payload shape.
//
// IMPORTANT: src/content/inject.js (a MAIN-world content script, which can't
// use ES module imports) keeps its own copy of RATINGS/POSITIONS for the
// actual push. Keep the two in sync if either changes.

// [PLYR_* field, abbreviation, display name], all ratings are 0-99.
export const RATINGS = [
  ["PLYR_ACCELERATION", "ACC", "Acceleration"],
  ["PLYR_AGILITY", "AGI", "Agility"],
  ["PLYR_AWARENESS", "AWR", "Awareness"],
  ["PLYR_BCVISION", "BCV", "Ball Carrier Vision"],
  ["PLYR_BLOCKSHEDDING", "BSH", "Block Shedding"],
  ["PLYR_BREAKSACK", "BSK", "Break Sack"],
  ["PLYR_BREAKTACKLE", "BTK", "Break Tackle"],
  ["PLYR_CARRYING", "CAR", "Carrying"],
  ["PLYR_CATCHING", "CTH", "Catching"],
  ["PLYR_CATCHINTRAFFIC", "CIT", "Catch in Traffic"],
  ["PLYR_CHANGEOFDIRECTION", "COD", "Change of Direction"],
  ["PLYR_DEEPROUTERUN", "DRR", "Deep Route Run"],
  ["PLYR_FINESSEMOVES", "FMV", "Finesse Moves"],
  ["PLYR_HITPOWER", "POW", "Hit Power"],
  ["PLYR_IMPACTBLOCKING", "IBL", "Impact Blocking"],
  ["PLYR_INJURY", "INJ", "Injury"],
  ["PLYR_JUKEMOVE", "JKM", "Juke Move"],
  ["PLYR_JUMPING", "JMP", "Jumping"],
  ["PLYR_KICKACCURACY", "KAC", "Kick Accuracy"],
  ["PLYR_KICKPOWER", "KPW", "Kick Power"],
  ["PLYR_KICKRETURN", "RET", "Return"],
  ["PLYR_LEADBLOCK", "LBK", "Lead Block"],
  ["PLYR_LONGSNAPRATING", "LSP", "Long Snap"],
  ["PLYR_MANCOVERAGE", "MCV", "Man Coverage"],
  ["PLYR_MEDROUTERUN", "MRR", "Medium Route Run"],
  ["PLYR_PASSBLOCK", "PBK", "Pass Block"],
  ["PLYR_PASSBLOCKFINESSE", "PBF", "Pass Block Finesse"],
  ["PLYR_PASSBLOCKPOWER", "PBP", "Pass Block Power"],
  ["PLYR_PLAYACTION", "PAC", "Play Action"],
  ["PLYR_PLAYRECOGNITION", "PRC", "Play Recognition"],
  ["PLYR_POWERMOVES", "PMV", "Power Moves"],
  ["PLYR_PRESS", "PRS", "Press"],
  ["PLYR_PURSUIT", "PUR", "Pursuit"],
  ["PLYR_RELEASE", "RLS", "Release"],
  ["PLYR_RUNBLOCK", "RBK", "Run Block"],
  ["PLYR_RUNBLOCKFINESSE", "RBF", "Run Block Finesse"],
  ["PLYR_RUNBLOCKPOWER", "RBP", "Run Block Power"],
  ["PLYR_SHORTROUTERUN", "SRR", "Short Route Run"],
  ["PLYR_SPECTACULARCATCH", "SPC", "Spectacular Catch"],
  ["PLYR_SPEED", "SPD", "Speed"],
  ["PLYR_SPINMOVE", "SPM", "Spin Move"],
  ["PLYR_STAMINA", "STA", "Stamina"],
  ["PLYR_STIFFARM", "SFA", "Stiff Arm"],
  ["PLYR_STRENGTH", "STR", "Strength"],
  ["PLYR_TACKLE", "TAK", "Tackle"],
  ["PLYR_THROWACCURACYDEEP", "DAC", "Deep Throw Accuracy"],
  ["PLYR_THROWACCURACYMID", "MAC", "Medium Throw Accuracy"],
  ["PLYR_THROWACCURACYSHORT", "SAC", "Short Throw Accuracy"],
  ["PLYR_THROWONTHERUN", "RUN", "Throw On The Run"],
  ["PLYR_THROWPOWER", "THP", "Throw Power"],
  ["PLYR_THROWUNDERPRESSURE", "TUP", "Throw Under Pressure"],
  ["PLYR_TOUGHNESS", "TGH", "Toughness"],
  ["PLYR_TRUCKING", "TRK", "Trucking"],
  ["PLYR_ZONECOVERAGE", "ZCV", "Zone Coverage"],
];

// [id, code, display name], in the same order Team Builder's own position
// filter buttons use.
export const POSITIONS = [
  [0, "QB", "Quarterback"],
  [1, "HB", "Halfback"],
  [2, "FB", "Fullback"],
  [3, "WR", "Wide Receiver"],
  [4, "TE", "Tight End"],
  [5, "LT", "Left Tackle"],
  [6, "LG", "Left Guard"],
  [7, "C", "Center"],
  [8, "RG", "Right Guard"],
  [9, "RT", "Right Tackle"],
  [10, "LEDG", "Left Edge"],
  [11, "REDG", "Right Edge"],
  [12, "DT", "Defensive Tackle"],
  [13, "SAM", "Sam Linebacker"],
  [14, "MIKE", "Mike Linebacker"],
  [15, "WILL", "Will Linebacker"],
  [16, "CB", "Cornerback"],
  [17, "FS", "Free Safety"],
  [18, "SS", "Strong Safety"],
  [19, "K", "Kicker"],
  [20, "P", "Punter"],
  [21, "LS", "Long Snapper"],
];

// Older position codes this project used before the real schema was known,
// mapped onto their real Team Builder equivalents.
export const POSITION_ALIASES = {
  LE: "LEDG",
  RE: "REDG",
  LOLB: "SAM",
  MLB: "MIKE",
  ROLB: "WILL",
};

export function normalizePosition(code) {
  const upper = String(code || "").toUpperCase();
  return POSITION_ALIASES[upper] || upper;
}

export function positionIdForCode(code) {
  const normalized = normalizePosition(code);
  const entry = POSITIONS.find(([, c]) => c === normalized);
  return entry ? entry[0] : null;
}

export function codeForPositionId(id) {
  const entry = POSITIONS.find(([i]) => String(i) === String(id));
  return entry ? entry[1] : null;
}

function normalizeKey(key) {
  return String(key || "")
    .toUpperCase()
    .replace(/^PLYR_/, "")
    .replace(/[^A-Z0-9]/g, "");
}

const RATING_LOOKUP = (() => {
  const map = new Map();
  for (const [field, abbr, name] of RATINGS) {
    map.set(normalizeKey(field), field);
    map.set(normalizeKey(abbr), field);
    map.set(normalizeKey(name), field);
  }
  return map;
})();

// Resolves a free-form attribute key (e.g. "speed", "SPD", "Ball Carrier
// Vision", "PLYR_SPEED") to its canonical PLYR_* field name, or null.
export function resolveRatingField(key) {
  return RATING_LOOKUP.get(normalizeKey(key)) || null;
}

export function clampRating(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(99, Math.round(n)));
}
