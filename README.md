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
- 🚧 **Actually pushing a roster into Team Builder is not implemented yet.**
  Team Builder's real API/response shape is unknown — `src/content/inject.js`
  currently just logs matching network traffic and stores the roster you'd
  push at `window.__mttPendingRoster` for manual inspection. See
  "Reverse-engineering Team Builder" below; that's the next real chunk of
  work.

## Load it in Chrome

1. Go to `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select the `extension/` folder.
4. Click the extension icon to open the popup, or right-click it →
   "Options" to open the roster editor.

Chrome hot-reloads most changes to popup/options after you edit and reopen
them; changes to `manifest.json`, `background.js`, or the content scripts
need a manual reload from `chrome://extensions`.

## Reverse-engineering Team Builder

`inject.js` runs in Team Builder's own page context (a "MAIN world" content
script, injected at `document_start`, same trick the CFB roster importer
uses) and patches `fetch`/`XMLHttpRequest` to log any request whose URL
looks roster/preset/team-related. With the extension loaded:

1. Open Team Builder and go through creating/editing a roster normally.
2. Open the extension's options page → "Team Builder network recon log" at
   the bottom — it fills in with matching requests (URL, method, status,
   response body preview), sourced from `chrome.storage.local`.
3. For the full picture, also pop open Chrome DevTools → Network tab on the
   Team Builder tab itself, right-click → "Save all as HAR with content",
   and share that HAR. That's the fastest way to nail down the exact
   request/response schema (headers, auth, payload shape) needed to finish
   `pushRoster()` in `inject.js`.

Once we know the real shape, `pushRoster()` gets rewritten to either rewrite
the matching fetch/XHR response in place (what the reference project does
for CFB's preset system) or POST the converted roster directly to whatever
save endpoint Team Builder uses.

## Project layout

```
extension/
  manifest.json
  src/
    popup/            toolbar popup
    options/           roster editor (main UI)
    content/
      content.js        isolated-world bridge (storage, messaging)
      inject.js          MAIN-world script: network recon + roster push (stub)
    background/         service worker
    lib/
      model.js           roster/player schema, position minimums, validation
      storage.js          chrome.storage.local wrapper
      csv.js               CSV import/export
```

Roster data model is intentionally loose: bio fields (name, position,
height/weight/age, college, overall) are fixed columns, but player ratings
live in a free-form `attributes` map (`{ speed: 88, awareness: 75, ... }`)
since EA's exact Team Builder rating schema isn't confirmed yet. Once it is,
tighten `emptyPlayer()`/`validateRoster()` in `src/lib/model.js` accordingly.

## Porting to Safari

Safari can't load an extension unpacked the way Chrome can — it has to be
wrapped in an Xcode project. Once the Chrome version works end-to-end:

1. Install Xcode (Mac required) and its command-line tools.
2. From the `extension/` directory, run:
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
