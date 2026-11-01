# Module contract (for the coders)

A 3D survivors-like (auto-attacking hero, swarms, XP crystals, pick-1-of-3 level-ups) on a desert planet. Plain ES modules, no build step. three.js r160 from jsDelivr via an import map. Runs as a claude.ai Artifact (sandboxed iframe) — **phone first** (Tom plays on his phone), desktop too.

```
index.html          page shell: <title>, CSS, HUD/overlay DOM, import map, <script type="module" src="game/main.js">
game/theme.js       ALL content: names, colours, stats, waves, weapons, model + sound slots. Written. Read it.
game/models.js      placeholder models (procedural) + GLB loading
game/audio.js       synthesised SFX (WebAudio) + file overrides
game/main.js        engine (may split into more game/*.js files if the author wants)
assets/             where Tom drops .glb / .mp3 files later
```

Import map (in index.html, before any module script):
```html
<script type="importmap">{"imports":{
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
}}</script>
```
All game files import three as `import * as THREE from 'three'` and addons as `three/addons/...`. No other external hosts (Artifact CSP blocks them). No fetch of anything except our own relative files.

## Hard rules
- **No names, colours, or tuning numbers in engine code.** They come from `theme.js`. Engine-only constants (camera angle, pool sizes) are fine.
- **No copyrighted assets.** All art is procedural primitives; all sound is synthesised. No ripped models, logos, fonts or music.
- Models face **+Z**, feet at **y = 0**, 1 unit = 1 metre, humanoids ~1.8 m tall before `scale`.
- Must run at playable frame rate on a mid-range phone with ~200 enemies: shared geometries/materials, object pools, no per-frame allocation in hot loops, ≤ ~350 draw calls.

## game/models.js
```js
export async function loadModels(theme)   // call once before the game starts.
  // Preloads every theme.models entry that has a `url` (GLTFLoader from 'three/addons/loaders/GLTFLoader.js').
  // NEVER rejects: on failure console.warn and use the builder named in `fallback` (or the entry key).
  // Procedural entries are built and cached here too.

export function makeModel(key)            // key = a theme.models key, e.g. 'raider'. Returns a ModelInstance:
  // {
  //   object: THREE.Object3D,   // add to scene; engine sets object.position / rotation.y / visible
  //   height: number,           // world height after scale (for HP bars, bolt spawn height)
  //   radius: number,           // rough horizontal radius after scale
  //   setFlash(on: boolean),    // hit flash: swap to a shared white/emissive material while true
  //   setTint(hexOrNull),       // elite tint (may allocate a material once per instance; null clears)
  //   update(dt, moving: boolean, speed: number), // idle/walk animation: procedural bob/sway, or AnimationMixer for GLB clips (`anim` name, else first clip)
  //   setOpacity(a),            // 0..1 for death fade (switch materials to transparent clones lazily)
  //   dispose()                 // free per-instance resources only (shared geometry stays cached)
  // }
  // Unknown key: console.warn once and return a magenta box so the game never crashes.
```
Procedural builders: `hero, raider, rodian, officer, rock, vaporator, bones, crystal, bacta` (see `theme.models` for colours each uses; `warlord` and `crystalBig` reuse `raider` / `crystal` with other colours and scale). Each builder makes a low-poly, readable-from-above figure from boxes/cylinders/spheres/cones, **merged into one BufferGeometry with vertex colours** (`BufferGeometryUtils.mergeGeometries`) so each instance is one draw call. Geometry is cached per key and shared by all instances. Use `MeshLambertMaterial` or `MeshStandardMaterial({ vertexColors: true, flatShading: true })`.

Character silhouettes must read at a glance from a 55° top-down camera:
- **hero** — hooded brown robe over pale tunic, belt, a hilt on the hip. (The glowing blade is the engine's orbit weapon, not part of the model.)
- **raider** — head fully wrapped in bandages, round dark goggle lenses, a metal breathing grille, layered sandy robes, a long hooked staff (gaffi-style club) held upright.
- **rodian** — green skin, large glossy black bulbous eyes on the sides of the head, a short tubular snout, two small head spines, slim build, vest, a small pistol in one hand.
- **officer** — grey-olive tunic with a red/blue insignia plate on the chest, black belt, flat-topped peaked cap, black boots, a pistol.
- **rock** — irregular low-poly boulder (randomised vertices, but deterministic per instance seed is NOT required — cache 3 variants).
- **vaporator** — tall thin cylindrical moisture tower with rings and small vanes.
- **bones** — a large creature rib cage / skull half-buried.
- **crystal** — small glowing faceted gem (octahedron), emissive. **bacta** — a small glowing canister.
For `crystal` and `bacta`, the material may be emissive / MeshBasicMaterial so they glow.

## game/audio.js
```js
export function initAudio(theme)    // call from the first user gesture (Start button). Creates the AudioContext, preloads any file paths in theme.sounds (fetch + decodeAudioData; failure → synth).
export function play(name, opts?)   // names: blaster, saber, explosion, push, lightning, enemyShot, hit, death, pickup, levelup, hurt, bossAlert, victory, gameover, uiClick
                                    // opts: { volume?: 0..1, pitch?: multiplier }. Internally rate-limited per name (e.g. ≤ 1 per 40 ms; pickup ≤ 1 per 30 ms with rising pitch for streaks) so swarms don't clip.
export function setMuted(bool); export function isMuted()
export function startMusic(); export function stopMusic()   // only does anything if theme.sounds.music is a path
```
All synth sounds short (< 0.6 s), punchy, and quiet enough to layer: blaster = descending square/saw zap; saber = brief hum-swish; explosion = filtered noise burst with low thump; push = whoosh (noise through sweeping band-pass); lightning = crackle (noise, high-pass, jitter); hit = short tick; death = low grunt-ish blip; pickup = bright blip; levelup = rising 3-note arpeggio; hurt = low buzz; bossAlert = two-tone horn; victory/gameover = short jingles. Master gain node with theme.sounds.sfxVolume. Must not throw if called before initAudio or if AudioContext is unavailable.

## game/main.js (engine) — required behaviour
- Boot: `await loadModels(THEME)` then show the title overlay. Start button → `initAudio`, start run.
- Phases: `title → playing ⇄ levelup / paused → gameover | victory → (restart) playing`. Restart fully resets state and reuses pools (no leaks across runs).
- Camera: perspective, ~55° down, follows player smoothly. Visible ground radius roughly constant across aspect ratios (portrait phones must still see ~8 m to each side).
- World: sand ground that follows the player (infinite feel; recentre a large plane or tile it; subtle procedural canvas texture from theme colours), props scattered by deterministic chunk hashing around the player, despawned far away. Two directional "suns" + ambient + fog from theme.world. Blob shadows (instanced dark discs) under units instead of shadow maps.
- Input: keyboard WASD/arrows (normalised diagonals); pointer/touch floating joystick — press anywhere on the play area, drag to steer, visible ring + knob, release stops. `touch-action: none` on the canvas. P / Escape toggles pause. Level-up cards: tap/click or keys 1/2/3.
- Spawning per `theme.waves`, `maxEnemies`, `bosses`, `elites`, `scaling`. Spawn just outside the camera view. Enemies that fall > ~2.5× view radius behind get relocated ahead of the player. Enemy separation via spatial hash (no stacking). Ranged enemies (`attack`) shoot bolts the player can dodge, and only while on screen (engine check, `onScreen` in main.js); `keepDistance` enemies hold range.
- Weapons by `kind`: `bolt` (auto-aim nearest, pierce, range), `orbit` (glowing blades orbiting; additive glow; per-enemy hit cooldown), `lob` (arcing charge to a random enemy in range, explodes after `fuse`, AoE + knockback, flash + particles), `nova` (expanding ring, damage + knockback), `chain` (jagged lightning line hopping `chains` times within `chainRange`, `forks` simultaneous). Stats from the current level row; passives modify (damageMult, cooldownMult, speedMult, pickupMult, maxHp, regen, armor).
- Damage feedback: hit flash (setFlash for ~70 ms), small knockback, pooled floating damage numbers (DOM or sprites, ≤ 40 alive), death = topple + fade + particle puff, then pooled. Player hurt = red vignette flash + `hurt` sound.
- XP crystals drop on death (`crystalBig` when value ≥ bigThreshold), magnet within pickup radius, merge when more than `mergeAbove` exist. Heal drops (`bacta`). Level-up pauses the sim and offers 3 cards from: new weapon (if slots), owned weapon not max, passive not max/new passive (if slots); fallback to `strings.healOption`. Multiple level-ups queue.
- HUD (DOM over canvas, safe-area aware): XP bar across the top with level; timer (mm:ss) counting up toward winTime; kill count; HP bar; owned weapons + passives as small chips with level pips; pause and mute buttons ≥ 44 px tap targets. Boss/elite banner text from theme.strings. Game over / victory screen with time, kills, level and Restart.
- Visibility hidden → auto-pause. Resize → renderer + camera update. `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))`. Clamp dt to ≤ 1/20 s.

### Debug hooks (required — the test harness drives the game through these)
```js
window.__game = {
  state(),            // → { phase, time, level, xp, xpNext, hp, maxHp, kills, enemies, crystals, player: {x, z},
                      //     weapons: {id: level}, passives: {id: level}, choices: [{kind, id, label}] (when levelup), fps, drawCalls }
  start(),            // same as pressing Start (audio init may be skipped/fail silently in tests)
  restart(),
  debug: {
    addXP(n), setTime(seconds), spawn(type, n, {elite?}), god(on), killAll(), damagePlayer(n),
    chooseUpgrade(i),  // pick card i (0..2) when phase === 'levelup'
    giveWeapon(id, level), giveAllWeapons(),
    setMove(x, z),     // synthetic joystick input, -1..1; setMove(0,0) to stop. Overrides keyboard/touch while non-zero.
    enemies(),         // → [[x, z, typeKey], ...] live enemies (for test bots)
    timeScale(k),      // run k fixed sub-steps per frame (1..8) so tests can fast-forward a 10-minute run
  }
}
```

## index.html
No `<!doctype>/<html>/<head>/<body>` tags (the Artifact host wraps the file). Put `<title>Twin Suns</title>` and `<meta name="claude:viewport-fit-sides" content="cover">` first, then `<style>`, then the DOM, then the import map, then the module script. Full-screen canvas; `html, body { height: 100%; margin: 0; overflow: hidden; background: <theme sky> }`; keep the host's `:root` safe-area padding behaviour in mind — overlays and HUD offset by `env(safe-area-inset-*)`. Single committed dark-on-sand look (no light/dark theme switching needed, but set every colour explicitly). Google Fonts allowed (the only external stylesheet host): pick a characterful display face for titles + a clean condensed UI face, with system fallbacks. Not the Star Wars logo font. Respect `prefers-reduced-motion` for UI animation. Add a `<noscript>` and a visible error panel if the module fails to load (e.g. `window.addEventListener('error', …)` writes the message on screen) so a blank screen never happens silently.
