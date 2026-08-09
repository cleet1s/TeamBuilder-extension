// Fetches Team Builder's own font catalogs so we can expose every font it
// actually has, not just the ones its own Font Picker UI wires up as
// clickable buttons. See docs/teambuilder-api-recon.md's Brand-tab section:
// as of 2026-08-09 the number-font catalog has 21 real entries but only 4
// are reachable from the UI -- the other 17 are complete, already-public
// assets Team Builder's own client fetches, just not offered as a choice.
// Nothing here is invented; these are the same URLs Team Builder loads.

const NUMBER_FONT_LIST_URL = "https://q.mcr.ea.com/r/346/file/tu1-dIYu6WDcXK_number_font_list.json";
const NAMEPLATE_FONT_LIST_URL = "https://q.mcr.ea.com/r/346/file/tu1-dIYu6WDcXK_nameplate_font_list.json";

// Catalogs are shaped {"NIKE": [{id, displayName, thumbnail, file}, ...]} --
// keyed by BRAND_ID. Every team we've seen uses "NIKE" and it's the only
// populated key today, but we flatten across whatever keys exist so this
// doesn't silently miss fonts if EA adds another brand later.
async function fetchCatalog(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Font catalog fetch failed (${res.status}): ${url}`);
  }
  const data = await res.json();
  return Object.entries(data).flatMap(([brand, fonts]) =>
    (fonts || []).map((f) => ({ ...f, brand }))
  );
}

export function fetchNumberFonts() {
  return fetchCatalog(NUMBER_FONT_LIST_URL);
}

export function fetchNameplateFonts() {
  return fetchCatalog(NAMEPLATE_FONT_LIST_URL);
}
