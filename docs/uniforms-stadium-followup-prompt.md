# Follow-up prompt: decode Team Builder's uniform/stadium material data

## Update (2026-08-09): a working reference implementation already exists — read this first

A second recon session found **prior art that likely obsoletes the
FMT/local-install plan below for helmets/jerseys/pants/socks material
editing**: [jtrosclair/teamcrafters-classic-roster-importer](https://github.com/jtrosclair/teamcrafters-classic-roster-importer)
(GPL-3.0, actively maintained — v0.6.0 as of 2026-08-08, one day before this
was written), a Chrome extension built by TeamCrafters
(teamcrafters.net, a large CFB 27 stats/roster community site) that already
does uniform pushing for **College Football 27's Team Builder** — which
shares Madden's exact save format (`nonce-primary.json` bundle PUT,
same `teamInfos`/`frostbiteData` shape; confirmed by shared frontend code —
Madden's own Team Builder page loads CFB-specific asset paths like
`assets/fonts/cfb/...`).

**What their repo contains** — pull these files down and read them before
doing anything else:
- `uniform-catalog.json`, `uniform-recipes-{helmets,jerseys,pants,socks}.json`
  — decoded, save-ready material recipes for **1,167 real CFB 27 uniforms
  across 150 schools**, "pulled from the game's own files" per their
  README (a separate offline "catalog generator" not included in this repo
  did the actual extraction — their own CHANGELOG confirms it works with
  "Frosty's enum names," i.e. they used Frosty-family tooling on their end,
  so someone already paid that cost).
- `uniform-build.js` — converts catalog entries into the exact
  `teamVisuals.uniforms` shape EA's save payload uses. Confirms concrete,
  production-verified values we didn't have before:
  ```
  slotType: 93 = helmet, 98 = jersey, 97 = pants, 94 = socks, 95/96 = shoes
  ALTERNATE_LOADOUT_TYPE = 8   (marks a uniform as an extra/alternate, not Home/Away)
  LoadoutType_TeamDark = 6, LoadoutType_TeamLight = 3
  ```
  Part recipes are keyed by normalized asset basename: strip a leading
  `U_`, uppercase — e.g. `.../U_ALA_PANTS_2023_WHITE` → `ALA_PANTS_2023_WHITE`.
- **The flake-helmet answer, confirmed directly in `uniform-recipes-helmets.json`:**
  metal flake is an `overlays` entry labeled `"Flake Add"` that references a
  **shared, generic** texture —
  `ContentShared/characters/player/parts/uniforms/commonTextures/helmet/metalFlake_sparser_color`
  — layered on top of the base shell material via a `transform` (x/y/z/w)
  that controls placement/scale, not a different material type. This is
  the exact same `overlays`/`textures.color.textureId`/`tint`/`blend`/
  `transform` shape already documented below and in
  `docs/teambuilder-api-recon.md` for number fonts — so this whole family
  of "add an overlay layer with a shared texture" is one mechanism, not
  three separate ones to figure out.
- `equipment-web-bridge.js` — how they sync a web-based editor with the
  extension; relevant if we ever want an equivalent editor UI rather than
  hand-picking recipe JSON.
- Known gap, per their CHANGELOG: a couple of parts (e.g.
  `PUR_PANTS_2024_GOLD`, `NIKE_SOCKS_2023_WHITE`) have no decoded recipe
  and fall back to prebuilt-asset references — so their catalog isn't
  100% complete, but it's overwhelmingly comprehensive and, being CFB
  data, contains no NFL teams (no Saints/Panthers entries) — the value
  here is the *structural* answer (how the material graph works, real
  working `textureId` paths, the shared flake overlay), not literal Saints
  gold-flake data, which would still need sourcing separately (Madden's own
  files via FMT, most likely, now a much smaller/better-scoped task since
  we know the shape to look for).

**The direct-bundle-patch technique, proven live this same session (see
`docs/teambuilder-api-recon.md`'s Brand-tab section for full detail):**
Team Builder's Font Picker UI only exposes 4 of 21 real catalog number
fonts as clickable buttons — the other 17 are complete, valid, already-
public assets, just not wired to a UI button. We patched
`NUMBER_FONT_ID` directly (a flat string field in `teamData.teamInfos`) to
one of the 17 locked values during a real save, confirmed via fresh reload
that the server persisted it, and confirmed visually that it renders
correctly. No Frosty/FMT/local install needed for that — just a save-time
field rewrite, the same pattern `src/content/inject.js` already uses for
roster pushes (arm a pending change, click Team Builder's own Save button,
rewrite the outgoing PUT body in flight before it leaves the browser; the
body is an `ArrayBuffer`, not a string or Blob — decode with
`TextDecoder`/re-encode with `TextEncoder`).

**Recommended next step, before touching FMT/a local install at all:**
adapt `uniform-build.js`'s conversion logic (or just read their recipe
JSON directly) and try live-testing a recipe-built helmet material —
including the "Flake Add" overlay — against a Madden 27 team via that same
technique: patch it into an armed pending change, click Team Builder's own
Save, reload, and check whether Madden's renderer accepts
`ContentShared/characters/player/parts/uniforms/commonTextures/helmet/
metalFlake_sparser_color` (a `ContentShared` path name suggests it may not
be CFB-exclusive). If Madden's renderer accepts it, the FMT/local-install
plan below may not be needed for the flake-helmet goal at all — only for
sourcing the *specific* Saints/Panthers `textureId`s if the shared flake
overlay alone doesn't match their exact look closely enough.

Also worth doing early: join the TeamCrafters Discord (linked from
teamcrafters.net) and/or open a GitHub issue/discussion on their repo —
this is a fellow developer (goes by "Jerry" in their changelog) actively
building the same category of tool for the sibling platform; there's
likely a shortcut to the actual "catalog generator" extraction tool or at
least a conversation worth having before re-deriving what they've already
solved.

## Everything below this line predates the discovery above

Paste the block below into a new session (a fresh one — it doesn't assume
any prior conversation) once you have **Madden NFL actually installed
locally**. This is a separate research track from the rest of this repo:
everything else here was built by driving the Team Builder *website*;
this needs the real game files. **Given the update above, treat this as a
fallback for sourcing Madden-specific texture IDs (e.g. the actual Saints
gold-flake asset) after exhausting the TeamCrafters-recipe approach, not
as the first thing to try.**

## Status update (Aug 2026 recon session)

A follow-up session tried to make progress on a concrete motivating case —
pushing a real team's special helmet finish (e.g. the Saints' gold-flake
alternate, the Panthers' silver-flake alternate) onto a custom team — and
ruled out several shortcuts, plus found one genuinely useful lead. Read
this before repeating any of the same ground:

**Dead ends, confirmed live (no need to re-check these):**
- Team Builder's Uniforms → Helmet editor exposes only: a flat color
  picker (Custom hue/sat/brightness or "Presets" — but presets are
  fictional mascot palettes like "Bisons"/"Condors", not real teams), a
  "Helmet Reflectiveness" toggle (Matte / Shiny / Chrome only — no flake
  option), and a "Helmet Style" picker that turned out to be decal stripe
  patterns, unrelated to shell finish.
- "Copy From" only copies between your own team's uniform slots
  (Home/Away/alternate) — it cannot pull from another real NFL team.
- The "Create new team" flow has no real-team template picker — it always
  starts from a blank default ("EA Sports"/Orlando FL/EA logo). Confirmed
  by network capture: the client-side catalogs it fetches
  (`helmet_designs.json`, `helmet_decal_list.json`) contain only generic
  community-uploaded decal patterns (`teambuilder_helmet_2023_stripes_NN`),
  no real-team assets.
- **Conclusion: Team Builder's custom-team system never touches real NFL
  franchise assets in any form reachable from the website.** This also
  matches EA's own Team Builder wishlist forum threads, where players
  explicitly request "metal flake" and "pearlescent" helmet materials as a
  *missing* feature — confirmed-shipped finishes are only glassy / matte /
  satin / chrome. This isn't a hidden feature we failed to find; it
  doesn't exist in the web app at all. The data can only come from the
  game's own asset files.
- Frosty Tool Suite itself is a dead end for current Madden titles: the
  original project (`FrostyToolsuite/FrostyToolsuite`) stopped active
  development after FIFA 20 / Madden 19 and doesn't recognize newer
  installs (confirmed: it fails to load a Madden 27 install). Don't spend
  time troubleshooting it — use its maintained successor instead (below).

**The lead — Frostbite Modding Tool (FMT), not Frosty:**
[FMTDev/FMT.Releases](https://github.com/FMTDev/FMT.Releases) is the
actively maintained successor, with
[FMT.Madden26Plugin](https://github.com/FMTDev/FMT.Madden26Plugin)
explicitly supporting **Madden 26, Madden 27, and CFB 27**. Same job
Frosty would have done (EBX/asset extraction, texture import/export,
material editing) via its own asset browser + `content/...` path tree —
just for a game version that's actually supported.

**Concrete asset paths, sourced from the Operation Sports "Madden Modding
Guide for Beginners" thread** (a community reference used by PC uniform
modders since Madden 19, still active/updated as of 2025) — these are a
starting point for FMT's asset browser, not something already extracted:

```
content/characters/whitebox/materialTuning/Helmets/helmet_preset_metalFleckLarge   ← metal flake finish
content/characters/whitebox/materialTuning/Helmets/helmet_preset_basicMatte        ← matte
content/characters/player/parts/uniforms/Blitz/2018/MBZ_HELMET_2018_PREBLU_preset  ← chrome
content/characters/player/parts/uniforms/<TeamName>/...                            ← per-team overrides
```

Two things make this more than trivia:
1. **The flake material is generic engine infrastructure**, not something
   hardcoded uniquely into the Saints' or Panthers' own assets — it lives
   under `whitebox/materialTuning`, a shared/reusable preset. The goal
   isn't "extract the Saints' secret asset," it's "point any helmet's
   material slot at this shared preset" — a smaller problem than it first
   looked.
2. **It's very likely version-stable.** Yearly Madden content (rosters,
   real-team uniform colorways) changes every release; shared engine
   material-tuning presets typically don't. So this same path probably
   exists ~unchanged across Madden 19 through 27. Community screenshots
   (Operation Sports "Uniform Modding Showcase" thread, 2019 — a Jaguars
   "sparkly/glitter gold helmet") confirm this preset swap is a proven,
   working technique, not a hypothesis.
3. **Practical implication:** you don't need Madden 27 specifically to
   make progress on the material-graph question. If FMT (or even old
   Frosty) opens *any* Frostbite-era Madden install you have access to,
   extracting `helmet_preset_metalFleckLarge`'s parameter layout there
   should transfer directly to Madden 27's Team Builder `shellMaterial`
   schema. Only the specific per-team texture/tint references (not the
   material structure itself) would need re-confirming against 27.

Also relevant, from the same community docs, on MixMatch (the system that
assigns uniform parts — conceptually close to Team Builder's
`characterUniformItems`/`uniformParts`):
```
PartTypeIndex: 0 = helmet, 1 = jersey, 2 = pants, 3 = socks, 4 = shoes
OfficalTypeIndex: 0 = Home, 1 = Away, 2+ = alternates
```
**Supersede this with the TeamCrafters repo's numbers where they
overlap** (see the update at the top of this doc) — `uniform-build.js`
has production-verified values from a live CFB 27 save: `slotType`
93/98/97/94/95/96 for helmet/jersey/pants/socks/shoes×2, and
`ALTERNATE_LOADOUT_TYPE = 8` for marking a non-Home/Away uniform slot.
Community-thread numbers above are unconfirmed secondhand info; the
TeamCrafters values are from someone else's working, live-tested code.

None of the material-graph content above (the `helmet_preset_*` asset
paths specifically) has been extracted/verified yet by us — it's a
starting point for the next session with FMT and a local Madden install,
if the TeamCrafters-recipe approach (see the update at the top) doesn't
pan out first.

---

> I maintain a browser extension at github.com/cleet1s/TeamBuilder-extension
> that pushes a custom roster into EA's Madden NFL Team Builder web app. The
> roster push is done — see `docs/teambuilder-api-recon.md` for how Team
> Builder's save API works (it uploads one big JSON "bundle" per team to a
> presigned S3 URL) and `src/lib/rosterToBundle.js` for how player data gets
> patched into that bundle.
>
> I want to extend this to also push **uniform and stadium customization**
> (the Uniforms and Stadium & Field tabs in Team Builder), but that data
> lives in `teamData.frostbiteData` in the save bundle — a much deeper
> structure than the flat `PLYR_*` player schema. See the "The other tabs:
> Brand, Uniforms, Stadium & Field" section of `docs/teambuilder-api-recon.md`
> for the captured JSON shape: each uniform part (helmet/jersey/pants/socks)
> has a `shellMaterial` object with ~30+ numbered slots, each holding
> `textures`/`rsm`/`tint`/`transform` data, plus `maskCid` channel indices.
> I changed a helmet's "Base Color" swatch in the UI and saved, but couldn't
> tell which slot(s) that edit landed in.
>
> `shellMaterial`, `RSM` (roughness/specular/metallic), `tint`, and
> `maskCid` are standard Frostbite engine terms, not something Team Builder
> invented. I have Madden NFL 27 installed at `<FILL IN GAME PATH>`.
>
> Don't use Frosty Tool Suite — the original project stopped active
> development after FIFA 20 / Madden 19 and does not recognize a Madden 27
> install. Instead use **Frostbite Modding Tool (FMT)**
> (https://github.com/FMTDev/FMT.Releases) with its
> `FMT.Madden26Plugin` (https://github.com/FMTDev/FMT.Madden26Plugin),
> which explicitly supports Madden 26, Madden 27, and CFB 27, to
> reverse-engineer what these fields mean:
>
> - Install/set up FMT + the Madden26Plugin against my Madden 27 install.
> - Start from these known asset paths (sourced from the Operation Sports
>   "Madden Modding Guide for Beginners" community thread, not yet
>   verified against Madden 27) rather than exploring blind:
>   ```
>   content/characters/whitebox/materialTuning/Helmets/helmet_preset_metalFleckLarge
>   content/characters/whitebox/materialTuning/Helmets/helmet_preset_basicMatte
>   content/characters/player/parts/uniforms/Blitz/2018/MBZ_HELMET_2018_PREBLU_preset
>   content/characters/player/parts/uniforms/<TeamName>/...
>   ```
>   If Madden 27's asset tree doesn't match, these paths are known-good in
>   at least Madden 19-era files per that thread — try FMT against an
>   older supported Madden install first to confirm the structure, since
>   engine material-tuning presets are likely stable across yearly
>   releases even though per-team uniform content isn't.
> - Use FMT's asset browser/extraction (whatever it exposes in place of
>   Frosty's `TypeLibrary`/`shaderdump`) to inspect the real EBX class
>   definitions for helmet/jersey/pants/socks material types and figure
>   out what each `shellMaterial` slot index, `tint` mode value, and
>   `maskCid` channel actually controls (which one is "Base Color" vs.
>   trim vs. facemask, etc) — and specifically how `helmet_preset_metalFleckLarge`
>   differs structurally from `helmet_preset_basicMatte`, since that diff
>   is the actual target (flake finish), not just general slot mapping.
> - Cross-reference field names/values against the example JSON already
>   captured in `docs/teambuilder-api-recon.md` to build a mapping table:
>   UI control → which JSON field(s) it writes.
> - Document findings as a new section in `docs/teambuilder-api-recon.md`
>   (or a new `docs/uniforms-stadium-api-recon.md` if it gets long), same
>   style as the existing roster recon.
> - If the mapping is clear enough, extend `src/lib/rosterToBundle.js` and
>   its duplicate in `src/content/inject.js` with a `applyUniformToBundle()`
>   (or similar) that patches `teamData.frostbiteData.uniformParts` the same
>   way player data gets patched into `playerData` today — same
>   patch-in-place philosophy (don't touch fields you don't have a mapping
>   for), same live-test-before-trusting discipline the roster push used.
>
> Report back what you found and whether extending the push is tractable,
> before writing any push code — this might turn out to be a much bigger
> lift than the roster side was.

---
