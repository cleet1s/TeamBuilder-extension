# X-Men team audit — handoff

Session notes from auditing the live X-Men team (brand id `BsUVfAswPj`) after
building it, to see what a real production round-trip would surface beyond
what offline tests caught. Written mid-repair — see "Still open" below
before assuming everything here is resolved.

## What this audit found

**Confirmed and fixed (code + regression test, committed and pushed,
commit `8eafaa3`):** jersey-number matching in `applyRosterToBundle()` was
not position-aware. A real preset has the same jersey number (`#31`) on two
different-position slots (id `447`, a CB, and id `461`, an HB). Since
`Object.entries()` walks numeric-string player ids in ascending order, Pass
1's unqualified jersey match picked the lower-id CB slot instead of the
intended higher-id HB slot when pushing an HB player with jersey `#31`
("Megan Pixie" / Pixie). Team Builder's own OVR formula then computed `0`
for the resulting position/stat mismatch — a real, observable corruption on
the live team, not just a theoretical risk.

Fix: Pass 1 now only accepts a jersey match if the candidate's existing
`PLYR_POSITION` also agrees with the roster player's intended position;
otherwise it falls through to position-based Pass 2. Verified via a new
regression test (`regression_collision.mjs` pattern, reproduced inline in
this session, not yet added as a permanent test file in the repo — see
"Next steps") and via a dry run against the real 53-player X-Men roster,
where Pixie correctly landed in slot `461` with OVR 86 instead of slot `447`
with OVR 0.

**Confirmed live:** slot `447` (the CB originally named "Tray Mickens",
corrupted by the first buggy push) was successfully restored to its
original values — verified via the UI: `#31 CB Tray Mickens, 6'2", 198 lbs,
OVR: 67` (close to the original 68; the 1-point difference is from height
195→198 lbs weight-restoration rounding, cosmetic).

**Also confirmed while auditing (not bugs, just findings):**
- Team Builder's Angular-based (Zone.js in `window`), not React as assumed
  earlier in the project.
- `characterVisuals` sync (the earlier fix) holds for all 70 bundle slots,
  not just the one spot-checked originally — zero mismatches found across
  the full roster.
- Team Builder recalculates `PLYR_OVERALLRATING` server-side from the full
  stat profile rather than trusting whatever we push for `overall` — most
  pushed players ended up with a *lower* actual OVR than intended (mean
  diff roughly -15 to -20 across spot-checked players), because our roster
  only sets a handful of "signature" stats per character and leaves the
  rest at whatever the underlying preset slot already had. This is
  expected given the "patch in place, don't touch what we don't have data
  for" design, not a bug — but worth knowing if a future roster wants
  tighter control over displayed OVR: you'd need to set more of the 54
  rating fields per player, not just a few signature ones.
- Team Builder's save flow silently no-ops if it doesn't detect a real
  client-side change since the last save (documented before, re-confirmed
  here: reverting a field to its exact last-saved value skips the upload
  entirely, so a "restore to fix a mistake" push needs a genuinely
  different value to trigger first).

## Still open — do this next

**Megan Pixie's actual live position is unconfirmed and may still be
wrong.** After deploying the fix live (via an inline harness, not the
packaged extension) and re-pushing, the live team's HB slot `461` still
shows the original untouched name ("Cam Thompson"), and a DOM search for
"Pixie" on the fully-loaded Roster page (all-positions filter) found no
matches. This could mean:
- The re-push genuinely failed to place her (most likely: something about
  the inline one-off harness used for the live repair differed subtly from
  the tested/committed code — it was hand-copied into the browser via
  `javascript_tool` rather than loaded from the actual fixed source files),
  or
- She landed somewhere else via Pass 2 fallback that wasn't checked, or
- The roster sidebar list is virtualized and a plain DOM text search missed
  her even though she's actually there (not fully ruled out).

The push's own reported result (`{"matched":53,"unmatchedRosterPlayers":0}`,
`status:200`) claimed success, which doesn't match what the UI shows — that
mismatch itself is worth understanding, not just Pixie's specific fate.

**Next steps for whoever picks this up:**
1. Do a clean, full bundle capture (same technique as the original audit:
   patch `XMLHttpRequest` to snapshot the outgoing `nonce-primary.json` PUT,
   force a genuinely-dirty save, inspect the result) and directly check
   `teamData.roster.playerData` for a player named "Pixie" by scanning all
   70 entries — don't rely on the UI's rendered list, which may be
   filtered/virtualized in ways that hide her.
2. If she's genuinely missing or misplaced, the cleanest fix is loading the
   **actual packaged extension** (`chrome://extensions` → Load unpacked)
   rather than another hand-copied inline harness, so there's no risk of a
   copy-paste drift between what's tested/committed and what's live. This
   requires a human to click through the native file picker (browser
   automation can't do this — see `docs/teambuilder-api-recon.md`'s
   related note on `file_upload`).
3. Once confirmed correct, consider adding the collision regression test
   as a permanent file in the repo (it currently only exists as a session
   scratch file) so it runs alongside the existing offline tests instead of
   living only in this session's history.
4. If time allows, investigate the `matched:53` vs. actual-UI-state
   mismatch itself — that's a bigger methodological question (can the
   push's own self-reported success be trusted at all, or does it need to
   be paired with a post-push verification read every time?) worth an
   answer before relying on this tooling unattended in the future.
