# Twin Suns — a Star Wars-flavoured 3D survivors-like

## The ask (Tom, 2026-11-01, from phone)
"Code a Star Wars game but it's a vampire survivors clone in 3d where you murder tusken raiders, rodians and republic officers. Don't overthink it. If copyright stuff prevents you, do it as close as you can and make the assets as easy as possible to swap out later." Ultracode on: Haiku for simple, Sonnet for coding, Opus for verification.

## Decisions
- **Copyright line.** No Star Wars models, sounds, music, logos or fonts — I can't ship those. Everything is original: low-poly figures built in code, synthesised sound. The *names* Tom asked for (Tusken Raider, Rodian, Republic Officer, Force Push…) are used, but only in `game/theme.js`, so a rename is one file. Fine for a private fan project; don't publish the artifact publicly as-is.
- **Genre, not clone.** Survivors-like mechanics (auto-attack, swarms, XP crystals, pick 1 of 3 on level-up, 10-minute run). Weapons and content are our own: blaster, orbiting laser sword, thermal charge, Force Push, Force Lightning; 7 passives.
- **Phone first.** Tom plays on his phone, so it's published as a claude.ai Artifact with a touch joystick.
- **Stack.** three.js r160 as plain ES modules from jsDelivr via an import map. No build step. Multi-file artifact.
- **Swap surface = `game/theme.js`.** Names, colours, stats, waves, weapon tuning, UI text, and a model/sound slot for everything. A model slot takes either a built-in builder or `{ url: 'assets/x.glb', … , fallback }`. A sound slot takes null (synth) or a file path.

## Files
- `CONTRACT.md` — module contract the parallel coders built against (also documents the `window.__game` debug hooks).
- `game/theme.js` — the reskin file.
- `game/models.js` — placeholder models + GLB loading. `game/audio.js` — synth SFX + file overrides. `game/main.js` (+ others) — engine. `index.html` — page/HUD.
- `test/` — Playwright harness (`harness.mjs`), kiting bot (`bot.mjs`), smoke test (`smoke.mjs`). `cd test && npm install` once; `node test/smoke.mjs` from the idea dir.
- `ASSETS.md` — how to reskin, written for Tom.

## Status (2026-11-01, end of first session)
**Playable. Published as a private artifact: https://claude.ai/artifact/MCtoxxasGKkHvwKT3ZZ24U** (page = `index.html`, plus every `game/*.js` as supporting files).

How it was built: one workflow, 13 agents. Four Sonnet builders worked in parallel (models, audio, engine, test harness). A Sonnet agent integrated the pieces. Three Opus verifiers each took one lens: playtest and balance, code review, asset swapping. A Sonnet fixer and an Opus re-verifier then ran two rounds, and Haiku wrote `ASSETS.md`. 25 findings: 0 blockers, 6 major, 13 minor, 6 polish. All majors and minors were fixed and re-verified. Two polish items were skipped on purpose: the HUD covers the top ~150 px on a phone, and damage numbers are DOM writes. I ran `node test/smoke.mjs` myself after the workflow and it passed with zero console errors.

What was fixed that matters:
- Balance: runs used to die around minute 4–5, and the first level-up came at about 60 s. The XP curve, early spawn rate, blaster, pickup radius and ranged enemies were retuned. A bot that never collects crystals now lasts to about minute 8 at level 18. A bot that collects them reaches level 2 at about 7 s.
- Player bolts are now yellow, so they don't look like officer bolts (red) or Rodian bolts (green).
- Enemies only shoot while on screen, so there are no off-screen snipers on a portrait phone.
- Swapping the heal pickup for a .glb used to crash the game. Fixed.
- Camera shake and the red hurt tint no longer stay frozen during pause and level-up.

Verified in headless Chromium (software WebGL):
- desktop and phone layouts, a real touch drag, every phase, restart with no leaks across 5 cycles
- 200 enemies with all weapons at about 260 draw calls max
- swapping in a .glb with a Walk clip, the bad-URL fallback, sound file overrides, and renames
**Not verified:**
- real-phone frame rate
- audio by ear
- the Google Fonts title face (blocked in the container, so screenshots show fallback fonts)
- that the page actually loads inside the claude.ai artifact frame (the CDN is blocked from the container, so I couldn't open it)

## Next steps
1. Tom: open the artifact link on the phone. If it's a blank or error panel, the likely cause is module loading inside the artifact frame. The fallback is to bundle all `game/*.js` into one inline `<script type="module">` in `index.html`, keeping the import map.
2. If it's sluggish on the phone: lower `maxEnemies` in theme.js (220), the pixel-ratio cap in main.js (1.75), or the raider's triangle count (~1.4k; sphere segments in models.js).
3. Real models: see `ASSETS.md`. One mesh, one material, under ~2k triangles per enemy. CC0 low-poly packs (Kenney, Quaternius) are the realistic source. There are no legal Star Wars models to drop in.
4. Not done, if wanted: a hot-reload snapshot (an open game currently restarts when the artifact is republished), music, more enemy types, a boss attack pattern.

## Workflow record
Script: `~/.claude/projects/.../workflows/scripts/twin-suns-build-wf_36e889b5-21b.js` (cloud container; gone once the session ends). Shape: Build ×4 parallel → Integrate → Verify ×3 lenses → (Fix → Re-verify) ×2 → Docs.

## How to run locally (Mac)
`cd ideas/2026-11-01-star-wars-survivors && python3 -m http.server 8000`, open http://localhost:8000. (Needs internet for the three.js CDN.) Tests: `cd test && npm install && cd .. && node test/smoke.mjs` (needs Playwright: `npx playwright install chromium` if not present).
