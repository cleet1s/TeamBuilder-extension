# Team Builder network API recon

Captured 2026-08-08 by driving a real, logged-in Chrome session through Madden
NFL 27 Team Builder (`www.ea.com/games/madden-nfl/team-builder/...`, brand id
`rUfkIObgju`) and instrumenting `fetch`/`XMLHttpRequest` in the page itself to
record every request Team Builder's own UI makes. `teambuilder.easports.com`
(the domain named in the original task) 404s/edge-errors — the real app lives
under `www.ea.com/games/madden-nfl/team-builder/...`.

Two edits were made to a single player (Speed, then Awareness) via the
**Roster → Skill Ratings** panel and saved with the **SAVE** button (not
**SUBMIT**, which is a separate finalize/checkout action we did not trigger).

## TL;DR

- **Saving is one big write, not per-player calls.** The entire team —
  roster, uniforms, stadium, logos — is serialized into a single JSON
  document and `PUT` to a presigned S3 URL in one shot (547,877 bytes for a
  full 70-player roster in our test). There is no `POST /roster/player/:id`
  style endpoint.
- It is **not a conventional first-party REST API**. Team Builder persists
  team data as a "content bundle" file through EA's generic WAL
  (`wal2.tools.gos.bio-iad.ea.com/wal/contentshare/*`) / MCR asset-upload
  pipeline — the same generic file-sharing service used for user-generated
  content across EA titles, not something Madden-specific.
- **No `Authorization`/bearer token header is ever set by client JS.** See
  "Auth" below.
- Two team-card preview images (~350KB + ~21KB PNGs) are generated
  client-side and uploaded through the same pipeline on every save, and pass
  through an automatic profanity/image-moderation check (polled via plain
  `GET`s) before the save completes.

## Recommended approach for `pushRoster()`

Don't try to replicate the auth handshake / presigned-URL lifecycle
independently — it's non-trivial and partially unconfirmed (see "Unknowns").
Instead, do what the reference CFB importer does: **intercept and rewrite
the outgoing bundle PUT** from the MAIN-world `inject.js` hook that's already
scaffolded:

1. Patch `fetch`/`XMLHttpRequest.prototype.send` (already done for recon).
2. Watch for an XHR/fetch `PUT` whose URL matches `/nonce-primary\.json/` (or
   more robustly: a `PUT` to `*.s3.*.amazonaws.com` carrying a binary body
   well over the thumbnail size, e.g. >100KB).
3. Decode the outgoing body as JSON, replace
   `body.teamData.roster.playerData` with the extension's roster — mapped
   from its loose `attributes` model into the `PLYR_*` schema below (values
   clamped to 0–99, encoded as **strings**, positions mapped via the table
   below) — re-encode, and substitute it into the request before it's sent.
4. Let the rest of Team Builder's real save flow run untouched (auth,
   presigned URL, thumbnail generation, moderation, finalize). You're
   piggybacking on a real user click of **SAVE**, so all of that already
   works and you never have to authenticate as the user yourself.

This sidesteps needing to know the wal2 auth mechanism at all.

## Save flow (sequence, captured via SAVE button)

| # | Call | Notes |
|---|------|-------|
| 1 | `POST /wal/authentication/login` (wal2) | Only fires once per browser session (cached afterward); ~3.1KB body, not decoded (redacted — likely relays the site's own session into a wal2 ticket). |
| 2 | `POST /wal/contentshare/webCreateFilePart/{fileId}` | `{"parentAssetId":"rUfkIObgju","name":"TEAM_LOGO","subAssets":[{"subAssetId":"","mimeType":"application/octet-stream"}]}` — registers part 1 of an image. |
| 3 | `PUT` presigned URL on `mcr-prod-temporary-direct-upload-uswest2.s3.us-west-2.amazonaws.com` | Raw PNG bytes, ~350KB ("full" team-card render). |
| 4 | `POST /wal/contentshare/webCompleteFilePartUpload/{fileId}` | `{"assetId":"rUfkIObgju_<random>","filePartType":0,"assetCategory":"ASSET_CATEGORY_BUNDLE","hashes":["<hash>"]}` |
| 5 | `GET` `mcr-prod-profanity-reviews-2.s3.us-west-2.amazonaws.com/...` | Polled (1-3x observed) — waits for the image moderation check to clear. |
| 6-9 | Repeat 2-5 for a second image | `name:"nonce-thumbnail"`, ~21KB PNG (small render). |
| 10 | `POST /wal/contentshare/webUpdateFileMetaData/{fileId}` | Declares the JSON bundle file that's about to be uploaded (see below) plus team metadata tags (name, city, colors, published flag, thumbnail URL from step 6-9...). |
| 11 | `POST /wal/contentshare/webGetFiles/{fileId}` | A file-search/listing call (`filterOwnerIds`, `filterAssetId`, etc) — **not** where the presigned URL for the bundle comes from as far as we could tell; exact origin of that URL is unconfirmed (see Unknowns). |
| 12 | **`PUT` presigned URL on `mcr-prod-335.s3.us-west-2.amazonaws.com`** | **The actual roster+team bundle.** Full JSON document, 547,877 bytes in our test. File name pattern: `{timestamp}-0-0-nonce-primary.json`. |
| 13 | `POST /wal/contentshare/webCompleteFileUpload/{fileId}` | `{"assetId":"rUfkIObgju","assetCategory":"ASSET_CATEGORY_BUNDLE","hashes":["nonce-primary"]}` — finalizes/publishes the new version. |
| 14 | `POST https://pin-river.data.ea.com/pinEvents` | Analytics telemetry only, ignorable. |

`{fileId}` is an opaque per-session token embedded in the URL path
(`0000000e...`) — treat as ephemeral/session-scoped, not something to
hardcode.

The step-10 `webUpdateFileMetaData` body declares the upcoming bundle file:
```json
{
  "type": 0,
  "file": {
    "id": "rUfkIObgju",
    "bundledFiles": { "BundledFiles": [
      { "nonce": "nonce-primary", "mimeType": "application/json", "extension": ".json", "fileSizeInBytes": 0 }
    ]},
    "tags": {
      "Type": {"string_value": "TEAM_BUILDER"},
      "Description": {"string_value": "<stadium> <city>"},
      "Published": {"bool_value": false},
      "Visible": {"bool_value": true},
      "Platform": {"number_value": "pc"},
      "Name": {"string_value": "<team display name>"},
      "Nickname": {"string_value": "<team nickname>"},
      "Abbreviation": {"string_value": "<3-letter abbr>"},
      "nonce-thumbnail": {"string_value": "<cdn URL of the small PNG from step 6-9>"},
      "PrimaryColor": {"string_value": "{\"r\":0,\"g\":0.35,\"b\":0.67}"}
    }
  }
}
```

## Auth — no bearer token; static headers only

Every `/wal/*` call carries three headers, none of which are per-user
secrets:

| Header | Observed value shape | What it looks like |
|---|---|---|
| `x-application-key` | 10 chars, starts `MADDEN` | Static client/app identifier |
| `x-blaze-id` | 14 chars, starts `madden`, not JWT-shaped, not numeric | Static service/namespace identifier (EA's "Blaze" backend platform) |
| `x-blaze-void-resp` | literal `XML` | Tells the server to return an empty ack instead of a real body — this is why every `/wal/*` response we captured was ~12 bytes |

**No `Authorization` header and no explicit token header was set by client JS
on any request we observed.** The strong implication is that authentication
rides on an ambient browser session cookie sent automatically cross-origin
to `wal2.tools.gos.bio-iad.ea.com` (i.e. standard EA SSO session, not
something the page's JS reads or attaches itself). We did not extract the
literal cookie name — reading cookie values from page JS is blocked by our
own tooling's safety guard, and more importantly it's exactly the kind of
credential this recon intentionally avoided touching. If you need it, open
DevTools → Application → Cookies on `teambuilder`/`ea.com`, or Network tab →
any request → Headers → the `cookie` request header.

**Practical takeaway:** this is one more reason to prefer the
"rewrite-in-flight" approach above — you never need to know how auth works
because the user's own already-authenticated browser session does it.

## Bundle payload schema (`nonce-primary.json`)

Uploaded as a raw binary `PUT` (not a JSON POST body) to a presigned S3 URL.
Top level:

```jsonc
{
  "version": 3,
  "teamData": {
    "teamInfos": { /* TEAM_* fields: name, colors, city/stadium, logos, ratings... */ },
    "roster": {
      "templateId": 37,          // preset this roster derives from, see Presets below
      "playerData": {
        "<playerId>": { /* 132 PLYR_* fields, see below */ },
        "...": {}
      }
    },
    "frostbiteData": { "textures": {}, "teamVisuals": {}, "characterVisuals": {}, "characterUniformItems": {}, "uniformParts": {}, "field": {}, "stadiumRecipe": {}, "stadiumAudio": {}, "stadiumVisuals": {}, "characterAbilities": {} },
    "logos": { "0": {}, "1": {} }
  },
  "metadata": { "author": "...", "fileVersion": "...", "teamDisplayName": "...", "teamNickname": "...", "teamPrestige": "...", "teamRatingDefensive": "...", "teamRatingOffensive": "...", "teamRatingOverall": "...", "stadiumCapacity": "...", "topPlayers": [] },
  "dataMappings": { "t3db": {}, "gc": {} }
}
```

`playerData` keys are numeric-string player IDs carried over from whatever
preset the roster started from (e.g. `"339"`). We did not test whether the
server validates that these IDs come from a known preset/template vs.
accepts arbitrary invented integers — see Unknowns.

## Player object schema (each `playerData` entry)

132 fields total, all `PLYR_*` prefixed, **every value encoded as a string**
(e.g. `"PLYR_SPEED": "88"`, not `88`). All rating fields are on a **0–99**
scale (confirmed empirically across a 70-player roster: observed min 5, max
99; `PLYR_POTENTIAL` fixed at 99 across the template).

### Ratings (54 fields — from the public, unauthenticated config endpoint below)

| Field | Abbr | Display name |
|---|---|---|
| `PLYR_ACCELERATION` | ACC | Acceleration |
| `PLYR_AGILITY` | AGI | Agility |
| `PLYR_AWARENESS` | AWR | Awareness |
| `PLYR_BCVISION` | BCV | Ball Carrier Vision |
| `PLYR_BLOCKSHEDDING` | BSH | Block Shedding |
| `PLYR_BREAKSACK` | BSK | Break Sack |
| `PLYR_BREAKTACKLE` | BTK | Break Tackle |
| `PLYR_CARRYING` | CAR | Carrying |
| `PLYR_CATCHING` | CTH | Catching |
| `PLYR_CATCHINTRAFFIC` | CIT | Catch in Traffic |
| `PLYR_CHANGEOFDIRECTION` | COD | Change of Direction |
| `PLYR_DEEPROUTERUN` | DRR | Deep Route Run |
| `PLYR_FINESSEMOVES` | FMV | Finesse Moves |
| `PLYR_HITPOWER` | POW | Hit Power |
| `PLYR_IMPACTBLOCKING` | IBL | Impact Blocking |
| `PLYR_INJURY` | INJ | Injury |
| `PLYR_JUKEMOVE` | JKM | Juke Move |
| `PLYR_JUMPING` | JMP | Jumping |
| `PLYR_KICKACCURACY` | KAC | Kick Accuracy |
| `PLYR_KICKPOWER` | KPW | Kick Power |
| `PLYR_KICKRETURN` | RET | Return |
| `PLYR_LEADBLOCK` | LBK | Lead Block |
| `PLYR_LONGSNAPRATING` | LSP | Long Snap |
| `PLYR_MANCOVERAGE` | MCV | Man Coverage |
| `PLYR_MEDROUTERUN` | MRR | Medium Route Run |
| `PLYR_PASSBLOCK` | PBK | Pass Block |
| `PLYR_PASSBLOCKFINESSE` | PBF | Pass Block Finesse |
| `PLYR_PASSBLOCKPOWER` | PBP | Pass Block Power |
| `PLYR_PLAYACTION` | PAC | Play Action |
| `PLYR_PLAYRECOGNITION` | PRC | Play Recognition |
| `PLYR_POWERMOVES` | PMV | Power Moves |
| `PLYR_PRESS` | PRS | Press |
| `PLYR_PURSUIT` | PUR | Pursuit |
| `PLYR_RELEASE` | RLS | Release |
| `PLYR_RUNBLOCK` | RBK | Run Block |
| `PLYR_RUNBLOCKFINESSE` | RBF | Run Block Finesse |
| `PLYR_RUNBLOCKPOWER` | RBP | Run Block Power |
| `PLYR_SHORTROUTERUN` | SRR | Short Route Run |
| `PLYR_SPECTACULARCATCH` | SPC | Spectacular Catch |
| `PLYR_SPEED` | SPD | Speed |
| `PLYR_SPINMOVE` | SPM | Spin Move |
| `PLYR_STAMINA` | STA | Stamina |
| `PLYR_STIFFARM` | SFA | Stiff Arm |
| `PLYR_STRENGTH` | STR | Strength |
| `PLYR_TACKLE` | TAK | Tackle |
| `PLYR_THROWACCURACYDEEP` | DAC | Deep Throw Accuracy |
| `PLYR_THROWACCURACYMID` | MAC | Medium Throw Accuracy |
| `PLYR_THROWACCURACYSHORT` | SAC | Short Throw Accuracy |
| `PLYR_THROWONTHERUN` | RUN | Throw On The Run |
| `PLYR_THROWPOWER` | THP | Throw Power |
| `PLYR_THROWUNDERPRESSURE` | TUP | Throw Under Pressure |
| `PLYR_TOUGHNESS` | TGH | Toughness |
| `PLYR_TRUCKING` | TRK | Trucking |
| `PLYR_ZONECOVERAGE` | ZCV | Zone Coverage |

Note: the UI also shows a plain `PLYR_THROWACCURACY` on the older Bio-level
summary in some views, but the Skill Ratings panel and saved payload use the
three split short/mid/deep fields above — use those.

### Bio / contract / cosmetic fields (the other ~78 fields)

```
PLYR_ID, PLYR_FIRSTNAME, PLYR_LASTNAME, PLYR_JERSEYNUM, PLYR_OVERALLRATING,
PLYR_POSITION, PLYR_HEIGHT, PLYR_WEIGHT, PLYR_AGE, PLYR_YEARSPRO,
PLYR_HOME_TOWN, PLYR_HOME_STATE, PLYR_COLLEGE, PLYR_PORTRAIT,
PLYR_HANDEDNESS, PLYR_ASSETNAME, PLYR_RUNNINGSTYLE, PLYR_VISMOVETYPE,
PLYR_QBSTYLE, PLYR_STANCE, PLYR_CHARACTERBODYTYPE, PLYR_CELEBRATION,
PLYR_ICON, PLYR_ISCAPTAIN, PLYR_CAPTAINSPATCH, PLYR_TRAITDEVELOPMENT,
PLYR_POTENTIAL, PLYR_EGO, PLYR_MORALE, PLYR_FATIGUE, PLYR_PERFORMLEVEL,
PLYR_SLEEVETEMPERATURE, PLYR_CAREERPHASE, PLYR_PLAYERTYPE, PLYR_STYLE,
PLYR_ROLE2, PLYR_FLAGPROBOWL, PLYR_IS_GUEST_STAR, PLYR_IS_IMPACT_PLAYER,
PLYR_BIRTHDATE, PLYR_ORIGID, PLYR_MIN_OVR, PLYR_COMMENT,
PLYR_PORTRAIT_SWAPPABLE_LIBRARY_PATH, PLYR_PORTRAIT_FORCE_SILHOUETTE,
PLYR_RESERVED1, PLYR_RESERVEDUINT10,
# Draft:
PLYR_DRAFTROUND, PLYR_DRAFTPICK, PLYR_DRAFTTEAM,
# Contract / salary (0-6 = up to a 7-year contract):
PLYR_CONTRACTLEN, PLYR_CONTRACTYEARSLEFT, PLYR_VALIDCONTRACTLEN,
PLYR_TOTALSALARY, PLYR_VALIDTOTALSALARY, PLYR_CAPSALARY,
PLYR_SALARY0..PLYR_SALARY6, PLYR_SIGNBONUS, PLYR_VALIDSIGNBONUS,
PLYR_SIGNBONUS0..PLYR_SIGNBONUS6,
# History:
PLYR_LASTHOLDOUTYEAR, PLYR_CONSECYEARSWITHTEAM, PLYR_PREVTEAMID
```

Full example (real shape, from the public Pistol preset — a kicker):

```json
{
  "PLYR_ID": "339", "PLYR_FIRSTNAME": "Jason", "PLYR_LASTNAME": "Williard",
  "PLYR_JERSEYNUM": "9", "PLYR_OVERALLRATING": "76", "PLYR_POSITION": "19",
  "PLYR_SPEED": "70", "PLYR_ACCELERATION": "73", "PLYR_STRENGTH": "54",
  "PLYR_AGILITY": "59", "PLYR_AWARENESS": "62", "PLYR_KICKPOWER": "97",
  "PLYR_KICKACCURACY": "79", "PLYR_LONGSNAPRATING": "10",
  "PLYR_HEIGHT": "73", "PLYR_WEIGHT": "40", "PLYR_AGE": "25",
  "PLYR_POTENTIAL": "99", "PLYR_ASSETNAME": "WilliardJason_339"
}
```
(full 132-field example available by fetching the preset URL below.)

## Player visual/appearance data (`characterVisuals`) — a second, separate record per player

`teamData.frostbiteData.characterVisuals` is keyed by the **same player ids**
as `playerData`, but it's a distinct record driving the 3D character model
and jersey nameplate — **not derived from `playerData`**. This is the data
behind the Roster tab's "Appearance" panel (Skin Tone swatches, Head
portrait grid) below the Bio fields.

```json
{
  "assetName": "...",
  "genericHeadName": "gen_1_B_G_01",
  "genericHead": 3455,
  "bodyType": 1,
  "skinTone": 1,
  "firstName": "Stephen",
  "lastName": "Cooke",
  "jerseyNumber": 9,
  "jerseyName": "Cooke",
  "heightInches": 73,
  "weightPounds": 205,
  "containerId": "...",
  "loadouts": [ /* equipment/gear slots -- deep Frostbite structure, not explored */ ]
}
```

Confirmed by editing a player's Head portrait and Skin Tone via the UI and
diffing a live save:

- **`firstName`/`lastName`/`jerseyNumber`/`heightInches`/`weightPounds`
  duplicate fields also present in `playerData`, but with different
  encoding** — all plain JSON types here (string/number), vs. `playerData`
  where everything is a string and `PLYR_WEIGHT` is offset-encoded.
  **`weightPounds` is literal pounds** (no 160 offset). `jerseyName` isn't
  independently editable in the UI — it just tracks `lastName`.
- **`genericHead` is the same id as `PLYR_PORTRAIT`** (both `3455` in our
  test) — the Head portrait picker sets both in lockstep. `genericHeadName`
  is the human-readable asset name (`gen_1_B_G_01`), matching the naming
  pattern in `portrait_id_mapping.json` (see below).
- **`skinTone` is a simple 1–7 index** matching the public
  `skin_tone_filter.json` config (`{id, displayName, color:{r,g,b}}` per
  entry) — no offset, no separate encoding.
- **`bodyType` and `loadouts`** (equipment slots — undershirt, arm sleeves,
  etc.) weren't edited in our test; `loadouts` in particular looks like
  another deep Frostbite structure similar to `uniformParts`, not
  reverse-engineered.

**This was a real gap in `pushRoster()`, now fixed:** because
`characterVisuals` isn't derived from `playerData`, patching only
`playerData` (what the original implementation did) left a pushed player's
3D model and jersey nameplate showing their *old* name/number/height/weight
even though the roster list and ratings updated correctly. `rosterToBundle.js`
and `inject.js` now also patch the matched player's `characterVisuals` entry
(name, jersey name, jersey number, height, weight) alongside `playerData` --
using the matched bundle id from the same jersey/position matching pass, and
only touching the fields above (appearance fields like `skinTone`/`bodyType`/
`genericHead`/`loadouts` are left untouched, same "don't touch what you don't
have a mapping for" policy as everywhere else).

## Position codes (`PLYR_POSITION`)

Confirmed by cross-referencing stat profiles in the live roster data (e.g.
id 19 has `KICKPOWER 97` → Kicker) against Team Builder's own
position-filter buttons in the Roster sidebar, which are in the exact same
order as the numeric IDs:

| id | code | position |
|---|---|---|
| 0 | QB | Quarterback |
| 1 | HB | Halfback |
| 2 | FB | Fullback |
| 3 | WR | Wide Receiver |
| 4 | TE | Tight End |
| 5 | LT | Left Tackle |
| 6 | LG | Left Guard |
| 7 | C | Center |
| 8 | RG | Right Guard |
| 9 | RT | Right Tackle |
| 10 | LEDG | Left Edge (DE) |
| 11 | REDG | Right Edge (DE) |
| 12 | DT | Defensive Tackle |
| 13 | SAM | Sam/Strongside LB |
| 14 | MIKE | Mike/Middle LB |
| 15 | WILL | Will/Weakside LB |
| 16 | CB | Cornerback |
| 17 | FS | Free Safety |
| 18 | SS | Strong Safety |
| 19 | K | Kicker |
| 20 | P | Punter |
| 21 | LS | Long Snapper |

`player_rating_categories.json` (see below) lists position category
mappings up to id 34 — ids 22+ don't appear on the Roster tab's position
filter and are presumably non-53-man-roster entities (coaches?); untested.

## Presets ("Presets" dropdown, Roster tab)

`GET https://q.mcr.ea.com/r/346/file/tu1-dIYu6WDcXK_template_rosters.json`
— **public, no auth required** — returns 6 named presets, each pointing at a
full roster JSON (same `{playerId: {PLYR_*}}` shape as `playerData` above,
70 players) plus a `character_visuals` JSON, both on `cdn.mcr.ea.com`:

| id | name |
|---|---|
| 35 | Balanced |
| 36 | Run and Shoot |
| 37 | Pistol |
| 38 | Run Balanced |
| 39 | Pass Heavy |
| 40 | Run Heavy |

These are directly fetchable without logging in and make a good reference
dataset / sanity-check target for a schema mapper.

## Other public config endpoints

Same CDN pattern, all public/unauthenticated `GET`:
`https://q.mcr.ea.com/r/346/file/tu1-dIYu6WDcXK_<name>.json`

- `player_rating_categories.json` — the ratings catalog used above, plus
  `categories` (groups fields into panels like `qb_key_skills`) and
  `positionCategories` (position id → which category panels apply).
- `template_rosters.json` — preset list, used above.
- `portrait_id_mapping.json` — maps `PLYR_PORTRAIT` ids to portrait assets.
- `skin_tone_filter.json`, `complexion_group_mapping.json` — appearance
  options for custom player generation.

## The other tabs: Brand, Uniforms, Stadium & Field

Same save mechanism as Roster (whole-bundle PUT to `nonce-primary.json`,
see above) — these tabs just touch different parts of `teamData`. Difficulty
to support pushing to varies a lot by tab:

**Brand — easy, already covered.** Team name/abbreviation/city/colors/logos
edited on this tab live in `teamData.teamInfos`, which we already fully
captured above (`TEAM_NAME`, `TEAM_SHORTNAME`, `TEAM_BACKGROUNDCOLORR/G/B`
×3, `TEAM_PRIMARY_LOGO`/etc, `CITY_NAME`, `CITY_STATE`, ...). Logo images go
through the same content-share upload pipeline as the team-card thumbnails
in the save flow above (`TEAM_LOGO` asset name). Extending `pushRoster()`'s
approach (patch `teamData.teamInfos` fields in place before the bundle PUT)
would work the same way it does for players.

Also in `teamData.teamInfos`, same flat style: `NAME_FONT_ID` (nameplate
font), `NUMBER_FONT_ID` (jersey number font), `BRAND_ID` (always `"NIKE"`
for every team we've seen — no UI to change it, and it's a plain string
field like the others). Example: `"NAME_FONT_ID":"font_standard_blocky_jersey_2022","NUMBER_FONT_ID":"nike_number_font_michigan_state","BRAND_ID":"NIKE"`.

The Brand tab's font pickers fetch a shared catalog
(`https://q.mcr.ea.com/r/346/file/tu1-dIYu6WDcXK_number_font_list.json`,
similarly `..._nameplate_font_list.json`) shaped `{"NIKE": [{id, displayName,
thumbnail, file}, ...]}`. **The UI only wires up 4 of the catalog's 21 number
fonts as clickable buttons** (All League, Bureau, Stroked Bureau, Michigan
State) — the other 17 (Stroked Vapor Strike, Wide Full Block, Boulder
variants, etc.) are complete, valid, already-public assets the client
already fetches, just not exposed as picker options. Each catalog entry's
`file` URL is a small standalone JSON — same `overlays`/`textures.color.
textureId`/`tint`/`blend`/`transform` shape as everything else in this
doc — pointing at a real, current game asset, e.g. `Nike_Jersey_2025_
StrokedVapor_Strike_NUM_Array`.

**Correction (2026-08-09, same day, later session): `NAME_FONT_ID`/
`NUMBER_FONT_ID` alone do NOT drive rendering.** An earlier pass in this
doc claimed patching just the flat field was "confirmed working" — that
was a false positive. What actually happened: the jersey being viewed
already had a similar-looking "stroked" font baked in from an earlier,
unrelated edit, and the coincidental visual resemblance was mistaken for
confirmation. Direct inspection of a live bundle showed the flat fields
and the *actual* per-part data disagreeing outright (e.g. `NUMBER_FONT_ID`
said `stroked_vapor_strike` while the Home jersey's own baked-in font was
`stroked_bureau_2`, and Away's was a third value, `stroked_wide_all_league`
— three different fonts across two jerseys and one "team-wide" field).

**What actually drives rendering:** every uniform part that displays text
carries its own fully-resolved material overlay, independent of
`teamInfos`:
- `teamData.frostbiteData.uniformParts.jerseys["<brandId>-<slot>-jersey"].numberComp` — jersey numbers
- `...jerseys[...].fontComp` — jersey nameplate (back-of-jersey name)
- `teamData.frostbiteData.uniformParts.helmets["<brandId>-<slot>-helmet"].number` — helmet numbers (front/back, gated by `helmetMaterialSettings.hasFrontNumber`/`hasBackNumber`)
- pants/socks have neither field for a standard uniform style (checked directly, not assumed)

Each of these three follows the identical shape: `{arrayTexture, maskCid,
materials, overlays: [...]}`, where `overlays[0]` is the font-defining
layer (`overlays[0].info.label` names the font; `overlays[0].textures.
color.textureId` is its actual texture path) and `overlays[1]` was
observed **identical and blank** (empty `info.label`) across every part
and every font checked — safe to leave untouched. A catalog entry's `file`
recipe JSON has the exact same overlay element shape, just keyed
`{"0": {...}}` instead of array-indexed, so a catalog font drops straight
into `overlays[0]` once unwrapped.

Each of the 3 uniform slots (home/away/black) has its own independent
copy of this data — pushing a font has to patch `overlays[0]` in every
jersey (and helmet, for numbers) individually, not just once. `teamInfos.
NAME_FONT_ID`/`NUMBER_FONT_ID` still get set alongside (matches Team
Builder's own UI-state bookkeeping) but are cosmetic as far as the 3D
renderer is concerned.

**Implemented and live-tested (2026-08-09):** `src/lib/fontCatalog.js`
fetches both catalogs live plus a specific font's recipe (`fetchFontRecipe()`).
`applyFontsToBundle()` in `src/lib/rosterToBundle.js` (and its MAIN-world
duplicate in `src/content/inject.js`) sets the flat `teamInfos` fields
*and* walks every jersey/helmet patching `overlays[0]` from the fetched
recipe. The popup's "Fonts" section fetches the selected font's recipe at
push time and sends it along with the id.

Verified live, at the data level this time (not visual guesswork):
pushed `nike_number_font_michigan_state`, reloaded, and confirmed via
direct bundle inspection that `numberComp.overlays[0].info.label` matched
on **all three** jerseys (home/away/black) and `number.overlays[0].info.
label` matched on all three helmets — 3 jerseys + 3 helmets patched in one
save, per `applyFontsToBundle()`'s own returned counts. Screenshotted
Away's actual 3D jersey render afterward to confirm visually too. This is
the correction for an earlier claim in this same doc (further up this
section) that patching only the flat field was "confirmed working" — it
wasn't; that was a coincidental visual match on a jersey that already had
a similar-looking font baked in.

**Note on `BRAND_ID` / other brands (not yet tested):** both font catalogs
are shaped as a dict keyed by brand (`{"NIKE": [...]}`), implying the schema
supports other brand keys even though only `NIKE` is populated in the
catalog this default template loads. Madden Team Builder's own webpack
bundle loads CFB-specific asset paths (e.g. `assets/fonts/cfb/...`) even
when loading a Madden team, confirming Madden and College Football 27 Team
Builder share the same frontend/catalog infrastructure — and CFB rosters
include many Under Armour/Adidas/Jordan Brand programs, so it's plausible
non-Nike `BRAND_ID` values exist in the underlying data model even if
Team Builder's UI never offers them for Madden teams. Untested: what other
`BRAND_ID` strings are valid, and whether setting one unlocks a parallel
font/logo catalog. Best next step is checking CFB27 Team Builder's own
equivalent catalog endpoints for other brand keys before guessing values
blind (see `docs/uniforms-stadium-followup-prompt.md`).

**Uniforms and Stadium & Field — hard, not reverse-engineered.** These live
in `teamData.frostbiteData`, which is a much deeper structure than the flat
`PLYR_*` roster schema:

```
frostbiteData: {
  textures: {},                  // empty in our capture
  teamVisuals: {...},            // 2.3KB
  characterVisuals: {...},       // 175KB -- per-player 3D appearance (70 players)
  characterUniformItems: {...},  // 1.3KB -- slot registry, see below
  uniformParts: {...},           // 122KB -- the actual uniform data, see below
  field: { assetId, layerCompTexture },
  stadiumRecipe: { assetName, sceneElements },
  stadiumAudio: null,
  stadiumVisuals: { assetName, stadiumVenue: {...} },
  characterAbilities: {...},     // 1.5KB
}
```

`characterUniformItems` is a small registry mapping slot names
(`U_<brandId>_HELMET_HOME`, `_JERSEY_AWAY`, `_PANTS_HOME`, etc.) to a
`partItem` id (e.g. `"<brandId>-home-helmet"`). The actual customization
lives in `uniformParts`, bucketed by type:

```
uniformParts: {
  helmets: { "<brandId>-home-helmet": {...}, "<brandId>-away-helmet": {...} },
  jerseys: { ... },
  pants:   { ... },
  socks:   { ... },
}
```

Each part (e.g. a helmet) is a full Frostbite material graph, not a color
field:

```
{
  "name": "EA_HELMET_2024_BLACK",       // helmet model/style, not the color we set
  "number": { arrayTexture, maskCid, materials: [...] },
  "helmetMaterialSettings": { hasBackNumber, numberSelection, offsetScaleSpacing, numberRsm },
  "facemaskMaterialSettings": {...},
  "layerCompTexture": {...},
  "shellMaterial": { "0": {...}, "1": {...}, ..., "31": {...}, ... },  // per-slot material array
  "accMaterial": {...},
  "facemaskMaterial": {...}
}
```

We changed the Base Color swatch to red via the UI and saved, but didn't
trace exactly which of the ~30+ numbered `shellMaterial` slots (each with
its own `textures`/`rsm`/`tint`/`transform`) that edit landed in, or whether
"Base Color" is one slot's tint, several slots at once, or resolved via
`maskCid` channel indices instead. `stadiumVisuals.stadiumVenue` has the
same pattern (`edgeWalls`, presumably seating/tarp/etc, each with its own
`colorTex`/`logoTex`/`tint`).

**Bottom line:** pushing brand info is a small, mechanical extension of the
existing `pushRoster()` approach. Pushing uniform or stadium customization
(colors, patterns, logos placement) would need a dedicated recon pass to
map which `shellMaterial`/`tint` entries correspond to which on-screen
control, comparable in effort to the entire roster recon+build in this
document — treat it as a separate follow-up, not a quick addition.

**A promising shortcut for that follow-up:** [Frosty Tool
Suite](https://cadeevs-frostytoolsuite.mintlify.app/introduction), a
modding platform for Frostbite-engine games that explicitly supports
Madden. `shellMaterial`, `RSM`, `tint`, and `maskCid` are real Frostbite
engine terms, not Team Builder inventions — Frosty's `TypeLibrary` can load
a game's actual EBX class definitions at runtime, and `FrostyCmd`'s
`shaderdump`/`shaderblockdump`/`extract` commands can dump material
mappings, parameter layouts, and constant buffer structures straight from
the installed game's files. That could resolve the "which slot is Base
Color" question directly instead of by trial-and-error through the UI.
**Requires an actual local Madden NFL installation** (`FrostyCmd.exe
<GamePath> ...`) — it reads the installed game's files, not anything
Team Builder's web app exposes, so this is a genuinely separate research
track from everything else in this document. See
`docs/uniforms-stadium-followup-prompt.md` for a ready-to-use prompt for
that session.

## Unknowns / follow-up if needed

- Exact contents of `/wal/authentication/login` (request or response) —
  didn't refire after the first save in our session (cached), and we
  deliberately didn't dig into it further since it's the one call most
  likely to carry something sensitive.
- The literal cookie name carrying the EA SSO session — not extracted (see
  Auth section).
- Whether the server validates `playerData` keys / `templateId` against
  known presets, or accepts arbitrary invented player IDs and an
  omitted/custom `templateId` for a from-scratch roster. Given the
  recommended "rewrite in flight" approach reuses a real preset-derived
  bundle as its base and only swaps `playerData`, this mostly doesn't
  matter — but worth a quick manual test before assuming totally invented
  IDs work.
- Whether `PLYR_POSITION` accepts values 22+ — irrelevant for a normal
  53-man active roster.
- Exact shape of `teamInfos`/`frostbiteData`/`logos` beyond what's quoted
  above — not needed for a roster-only push (leave those objects untouched
  when rewriting the bundle in flight).
