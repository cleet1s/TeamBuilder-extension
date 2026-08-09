# Follow-up prompt: decode Team Builder's uniform/stadium material data

Paste the block below into a new session (a fresh one — it doesn't assume
any prior conversation) once you have **Madden NFL actually installed
locally**. This is a separate research track from the rest of this repo:
everything else here was built by driving the Team Builder *website*;
this needs the real game files.

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
> invented. I have Madden NFL installed at `<FILL IN GAME PATH>`. I'd like
> to use **Frosty Tool Suite**
> (https://cadeevs-frostytoolsuite.mintlify.app/introduction), a Frostbite
> modding platform that explicitly supports Madden, to reverse-engineer
> what these fields mean:
>
> - Install/set up Frosty Tool Suite against my Madden install.
> - Use `FrostyCmd`'s `shaderdump`/`shaderblockdump` commands to dump
>   material mappings, parameter layouts, and constant buffer structures,
>   and/or `extract` to pull a specific uniform-related EBX asset.
> - Use `TypeLibrary` (see the Frosty docs' API reference) to inspect the
>   real EBX class definitions for helmet/jersey/pants/socks material types
>   and figure out what each `shellMaterial` slot index, `tint` mode value,
>   and `maskCid` channel actually controls (which one is "Base Color" vs.
>   trim vs. facemask, etc).
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
