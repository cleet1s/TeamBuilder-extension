# Madden Team Builder Roster Toolkit

A browser extension that gives you a real roster editor (spreadsheet-style
grid, 53-man roster, CSV import/export) and pushes the result into EA's
[Madden Team Builder](https://www.ea.com/games/madden-nfl/team-builder)
web app — same idea as
[teamcrafters-classic-roster-importer](https://github.com/jtrosclair/teamcrafters-classic-roster-importer),
but built for Madden and using a hand-built roster instead of an external
roster API.

Built as a standard Manifest V3 WebExtension so it runs unpacked in Chrome
during development. Safari packaging (see below) comes once the core
behavior is working.

## Status

- ✅ Roster editor (options page): add/edit/remove players, free-form
  attribute ratings, position-minimum validation, CSV import/export,
  multiple saved rosters.
- ✅ Popup: shows the active roster's status, detects whether the current
  tab is Team Builder, has a "Push Roster" button.
- ✅ Team detection: the popup reads the brand id out of the current tab's
  URL (`.../team-create/{page}/{brandId}`) and the team name off the page
  itself, so "Push Roster" always targets whichever team the user currently
  has open in Team Builder -- never a hardcoded one. If no team is open
  (e.g. sitting on a team list), the push button stays disabled.
- ✅ **Pushing a roster into Team Builder is implemented.** Per
  `docs/teambuilder-api-recon.md`, Team Builder saves by uploading the whole
  team+roster as one JSON bundle. `src/content/inject.js` arms the pending
  roster, clicks Team Builder's own SAVE button for you (or tells you to
  click it yourself if it can't find it), and rewrites that one outgoing
  bundle PUT in flight -- patching matched players in place rather than
  replacing the roster wholesale, since a lot of fields (contracts, draft
  history, portraits, ...) don't have an equivalent in this editor. Players
  are matched to bundle slots by jersey number first, then by position;
  anything left over is reported as unmatched rather than guessed at. See
  `src/lib/eaSchema.js` (rating/position schema) and
  `src/lib/rosterToBundle.js` (the merge itself) for the mapping logic --
  `inject.js` keeps its own copy of both since MAIN-world content scripts
  can't use ES module imports.
- ✅ **Fonts: every catalog font, not just the ones Team Builder's own UI
  offers.** Team Builder's Font Picker only wires up 4 of the number-font
  catalog's 21 real entries as clickable buttons -- the other 17 are
  complete, already-public assets, just not exposed as a choice (see
  `docs/teambuilder-api-recon.md`'s Brand-tab section). The popup's "Fonts"
  section fetches the full catalog live (`src/lib/fontCatalog.js`) for both
  Nameplates and Numbers and lets you push any entry via the same
  arm-then-click-Save flow as the roster push (`applyFontsToBundle()` in
  `rosterToBundle.js`/`inject.js`, patching the plain `NAME_FONT_ID`/
  `NUMBER_FONT_ID` string fields in `teamData.teamInfos`). Live-tested
  against a real save.

## Load it in Chrome

1. Go to `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select this repo's root folder (the one
   containing `manifest.json`).
4. Click the extension icon to open the popup, or right-click it →
   "Options" to open the roster editor.

Chrome hot-reloads most changes to popup/options after you edit and reopen
them; changes to `manifest.json`, `background.js`, or the content scripts
need a manual reload from `chrome://extensions`.

## Reverse-engineering Team Builder

`inject.js` runs in Team Builder's own page context (a "MAIN world" content
script, injected at `document_start`, same trick the CFB roster importer
uses) and patches `fetch`/`XMLHttpRequest` for two things: logging any
request whose URL looks roster/preset/team-related, and (once armed by a
"Push Roster" click) rewriting the one outgoing save request that actually
matters. `docs/teambuilder-api-recon.md` has the full writeup of how the
save flow was captured and what it looks like -- start there before changing
the push logic.

The network recon log is still there if you want to dig further: open the
extension's options page → "Team Builder network recon log" at the bottom,
or pop open Chrome DevTools → Network tab on the Team Builder tab itself
and "Save all as HAR with content".

## Project layout

```
manifest.json
src/
  popup/            toolbar popup
  options/          roster editor (main UI)
  content/
    content.js        isolated-world bridge (storage, messaging, team detection)
    inject.js          MAIN-world script: network recon + the actual roster push
  background/       service worker
  lib/
    model.js           roster/player schema, position minimums, validation
    eaSchema.js         Team Builder's real rating/position schema
    rosterToBundle.js   merges a roster/fonts into a captured save bundle
    fontCatalog.js       fetches Team Builder's full font catalogs (Nameplates/Numbers)
    storage.js          chrome.storage.local wrapper
    csv.js              CSV import/export
docs/
  teambuilder-api-recon.md   network recon this was all built from
```

Roster data model: bio fields (name, position, height/weight/age, college,
overall) are fixed columns, and position codes match Team Builder's real
ones (see `src/lib/eaSchema.js`). Player ratings stay a free-form
`attributes` map (`{ speed: 88, awareness: 75, ... }`) on purpose, even
though Team Builder's real 54-field rating schema is now known -- keys are
resolved against it by name/abbreviation/display-name at push time
(`resolveRatingField()` in `eaSchema.js`), so the editor isn't hostage to
typing exact `PLYR_*` field names, and unrecognized keys are just ignored
rather than erroring.

## Porting to Safari

Safari can't load an extension unpacked the way Chrome can — it has to be
wrapped in an Xcode project. Once the Chrome version works end-to-end:

1. Install Xcode (Mac required) and its command-line tools.
2. From this repo's root directory, run:
   ```
   xcrun safari-web-extension-converter . --project-location ../safari-app
   ```
   This generates a macOS (and optionally iOS) app wrapper around the
   extension source and opens it in Xcode.
3. In Xcode, build and run — this installs the extension into Safari, where
   you enable it under Safari → Settings → Extensions (you may need to
   enable "Allow Unsigned Extensions" in Safari's Developer menu for local
   builds, or sign with an Apple Developer account to distribute it).
4. Manifest V3 in Safari has some gaps versus Chrome (e.g. some `chrome.*`
   APIs are partial); Safari's WebExtension support has been improving each
   macOS release, so re-check `browser.*`/`chrome.*` API availability for
   whatever macOS/Safari version you're targeting before relying on
   anything beyond `storage`, `tabs`, `scripting`, and content scripts, all
   of which this project sticks to.

No code changes should be needed for the migration itself beyond whatever
the converter's own linting flags — the extension is written to the
`chrome.*` API surface, which Safari also implements as an alias for
`browser.*`.
