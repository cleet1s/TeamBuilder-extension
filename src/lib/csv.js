import { emptyPlayer } from "./model.js";

const CORE_COLUMNS = [
  "firstName", "lastName", "jerseyNumber", "position",
  "heightInches", "weightLbs", "age", "college", "overall"
];

export function rosterToCsv(roster) {
  const attributeKeys = collectAttributeKeys(roster.players);
  const header = [...CORE_COLUMNS, ...attributeKeys.map(k => `attr:${k}`)];
  const lines = [header.join(",")];
  for (const p of roster.players) {
    const core = CORE_COLUMNS.map(col => csvEscape(p[col]));
    const attrs = attributeKeys.map(k => csvEscape(p.attributes[k] ?? ""));
    lines.push([...core, ...attrs].join(","));
  }
  return lines.join("\n");
}

export function csvToPlayers(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  return body
    .filter(row => row.some(cell => cell.trim() !== ""))
    .map(row => {
      const player = emptyPlayer();
      header.forEach((col, i) => {
        const value = row[i] ?? "";
        if (col.startsWith("attr:")) {
          const key = col.slice("attr:".length);
          if (value !== "") player.attributes[key] = Number(value);
        } else if (["jerseyNumber", "heightInches", "weightLbs", "age", "overall"].includes(col)) {
          player[col] = value === "" ? null : Number(value);
        } else if (col in player) {
          player[col] = value;
        }
      });
      return player;
    });
}

function collectAttributeKeys(players) {
  const keys = new Set();
  for (const p of players) {
    Object.keys(p.attributes ?? {}).forEach(k => keys.add(k));
  }
  return [...keys].sort();
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Minimal RFC4180 CSV parser: handles quoted fields, escaped quotes, commas
// and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.length > 1 || r[0] !== "");
}
