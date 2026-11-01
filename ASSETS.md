# How to reskin Twin Suns

Almost everything you can change is in one file: `game/theme.js`.
Models and sounds are files in `assets/`.

No Star Wars files are in this project. Everything is placeholder art and synth sound. To swap in real art, use files you have the right to use. Free low-poly 3D models with a CC0 licence come from sites such as Kenney or Quaternius. Check the licence on each download.

---

## 1. Run it

The game needs a web server. Opening `index.html` straight from a folder will not work.

- On a Mac: open Terminal, go to this folder, run `python3 -m http.server 8000`. Then open http://localhost:8000.
- On the phone (claude.ai Artifact): a new file must be published with the page. You cannot copy a file into `assets/` from a phone. Ask Claude to publish the file with the page and to update `theme.js`.

---

## 2. Where things live in `game/theme.js`

The file has sections. Each one is a named block.

| Section | What you change there |
|---|---|
| `title`, `tagline`, `credit` | Game name and the lines on the title screen |
| `strings` | Every piece of text: buttons, "Level up", "You fell in the sand", boss banner |
| `winTime` | How long a run lasts, in seconds (600 = 10 minutes) |
| `world` | Sand and sky colours, fog, suns, and scenery (rocks, vaporators, bones) |
| `player` | Name, health, speed, pickup range, max weapons, max passives, which model is the hero |
| `enemies` | Enemy names, health, speed, contact damage, collision size, XP, ranged attacks |
| `scaling` | How much enemies get tougher and hit harder each minute |
| `waves` | When enemies spawn, how many per second, and which types |
| `maxEnemies` | The most enemies alive at once |
| `bosses` | When a boss arrives and how tough it is |
| `elites` | How often a gold elite enemy arrives |
| `xpToNext` | How much XP each level needs |
| `pickups` | XP crystal models, heal pickup chance, heal amount |
| `weapons` | Weapon names, colours, and six levels of stats each |
| `passives` | The seven upgrades: names, colours, and what each one does |
| `models` | Which 3D model each thing uses (see section 3) |
| `sounds` | Which sound each action uses (see section 4) |

Strings and names are plain text inside quotes. Change the words between the quotes. Keep the quotes and commas.

---

## 3. Swapping a character model (.glb)

A `.glb` file is a 3D model in one file. The usual free format is glTF, saved as `.glb`.

### Steps

1. Put the file in the `assets/` folder. Example: `assets/tusken.glb`.
2. Open `game/theme.js`. Find the entry in `models` for the thing you want to swap.
3. Replace that entry with a line like this:
   ```js
   raider: { url: 'assets/tusken.glb', anim: 'Walk', fallback: 'raider' },
   ```
4. Save. Reload the page.

An enemy uses the model with the same key. For example `enemies.raider.model` is `'raider'`, so it uses `models.raider`. The key on the left must not change. Only the entry changes.

### What each setting does

These settings only apply to a `url` entry, unless marked.

- `url` - the path to the file. It must start with `assets/` and match the file name exactly. Capital letters count.
- `anim` - the name of the walking animation inside the file. It must match exactly. If it does not match, the game uses the first animation in the file and writes a warning.
- `idleAnim` - name of the standing-still animation. Optional. If left out, the game looks for an animation with "idle" in its name.
- `fallback` - the built-in figure to use if the file cannot load. Use `raider`, `rodian`, `officer`, `hero`, `warlord` (boss), or any other built-in name.
- `fallbackScale` - size multiplier for the built-in figure when the file fails. Default is 1. The warlord uses 2.3. Only used if the file fails.
- `colors` - colours for the built-in figure. Only used if the file fails. The file itself keeps its own colours.
- `scale` - size multiplier. If you **leave it out**, the game sizes people automatically (see "Size and feet" below). If you **set it**, automatic sizing turns off, and the file keeps its own size times this number. A model made in centimetres will be 100 times too big unless you set `scale: 0.01`.
- `height` - for people only. The target height in metres for automatic sizing. Default is 1.8.
- `rotationY` - turns the model around its up axis, in radians. Use it if the model faces the wrong way. See "Facing" below.
- `yOffset` - moves the model up (positive) or down (negative), in metres.
- `humanoid` - `true` or `false`. Forces automatic sizing on or off. Usually leave it out.
- `bob` - `true` adds a gentle up-and-down bob to a model that has no walking animation.

### Facing

Models must face **+Z** (toward the front of the screen when the game starts). The game turns the model to face the direction it moves. Check your file in a 3D viewer first.

| The model currently faces | Add this to the entry |
|---|---|
| +Z (correct) | nothing |
| -Z | `rotationY: Math.PI` |
| +X | `rotationY: -Math.PI / 2` |
| -X | `rotationY: Math.PI / 2` |

### Size and feet

- Feet sit on the ground at height 0. The game does this for you when `scale` is left out.
- For **people** with no `scale`: the game scales the model so it is 1.8 metres tall (or `height` if you set it). Then it centres the model and puts the feet on the ground.
- For **other things** (rocks, bones) with no `scale`: the game keeps the file's size. It still centres the model and puts it on the ground.
- If you **set `scale`**: the game does not move the feet. Use `yOffset` to fix a model that sinks into the sand or floats above it.

### Hit size is separate from model size

The size you bump into things is set in `enemies`, under `radius`. Changing the model does not change the hit size. If a big model feels wrong to play against, change `radius` too.

### How to tell if the file failed

It fails in one of three ways.

1. **Load failure.** The file is missing, misnamed, or takes more than 20 seconds to load. The game shows the built-in figure instead. It also writes a warning to the browser console, like this:
   `[models] "raider": could not load "assets/tusken.glb" (...); using built-in "raider" instead.`
2. **Animation not found.** The game still shows your model. It writes a warning like `animation "Walk" not found`.
3. **Too many meshes.** The game still shows your model. It writes a warning that the file has more than two meshes. Your model will work but run slower on a phone. Merge it into one mesh with one material.

On a phone there is no console. If the enemy looks like the old built-in figure, the file did not load. The first thing to check is the file name and the folder.

### Performance rules

- Enemies should be **one mesh, one material, under about 1,000 to 2,000 triangles**. Each extra mesh costs an extra draw call for every enemy on screen. A phone can handle about 350 draw calls.
- Keep animation clips short and simple. Each enemy on screen plays its own animation.
- Pickups are different. See "Pickups" below.

### Pickups

- `crystal` and `crystalBig` (XP gems) are drawn in bulk. **Only the first mesh in the file is used.** A warning is written if there is more than one. Merge them into one mesh.
- `bacta` (heal pickup) is one model per pickup, so it is drawn normally. Keep it to a few meshes.
- The heal colour (the number and the level-up card) comes from `pickups.heal.color`. Keep that set when you swap the bacta model.

---

## 4. Swapping a sound

Sounds are in the `sounds` section. Each name is one action in the game.

| Name | When it plays |
|---|---|
| `blaster` | Blaster fires |
| `saber` | Laser sword hits |
| `explosion` | Thermal charge goes off |
| `push` | Force Push |
| `lightning` | Force Lightning |
| `enemyShot` | An enemy fires at you |
| `hit` | You hit an enemy |
| `death` | An enemy dies |
| `pickup` | You collect an XP gem or heal pickup |
| `levelup` | You level up |
| `hurt` | You take damage |
| `bossAlert` | A boss arrives |
| `victory` | You survive the full run |
| `gameover` | You die |
| `uiClick` | A button is pressed |
| `music` | Background track. It loops. |

To use your own file, replace `null` with a path in quotes:

```js
blaster: 'assets/blaster.mp3',
```

- Formats that work in browsers: **mp3, ogg and wav**.
- Keep effect clips short, under one second.
- Put the file in `assets/` and use the path `'assets/<file>'`.
- If the file is missing or will not decode, the game writes a `[audio] could not load` warning and uses the built-in synth sound instead.
- `musicVolume` (0 to 1) and `sfxVolume` (0 to 1) set the loudness of music and effects.

---

## 5. Renaming enemies, weapons and passives

- **Enemies:** change `name` under `enemies`. Example: `name: 'Tusken Raider'`. The name shows in the boss and elite banners.
- **Weapons:** change `name` under `weapons`. It shows on the level-up card. `glyph` is the one-letter symbol shown when there is no icon.
- **Passives:** change `name`, `desc` and `glyph` under `passives`.
- **Do not rename the keys.** The keys are the words on the left, like `raider:` or `blaster:`. Only the `name` text is safe to change. The one exception: `player.startWeapon` uses a weapon key. If you rename the key `blaster`, change `startWeapon` to match.
- **Do not rename the sound names.** Sound names such as `blaster` and `levelup` are used in the code.
- **Weapon `kind`** sets how the weapon behaves: `bolt`, `orbit`, `lob`, `nova`, `chain`. Changing it changes the behaviour, not just the look.

### Icons (optional)

Weapons and passives can show an image instead of a letter:

```js
blaster: { name: 'Blaster Pistol', icon: 'assets/blaster.png', ... }
```

Without `icon`, the game draws the `glyph` letter in the weapon's `color`.

---

## 6. Changing colours

- **Model colours:** the `colors` line under each entry in `models`. Keys differ per model. Examples:
  - `raider`: `robe`, `wraps`, `mask`, `goggles`, `metal`, `stick`
  - `rodian`: `skin`, `eyes`, `vest`, `pants`, `blaster`
  - `officer`: `uniform`, `cap`, `belt`, `skin`, `boots`, `insignia`
  - `hero`: `robe`, `tunic`, `skin`, `hair`, `hilt`
  - `rock`: `base`, `dark`. `vaporator`: `body`, `dark`, `band`. `bones`: `bone`. `crystal` and `crystalBig`: `core`. `bacta`: `glass`, `cap`.
  - A key that does not exist is ignored.
- **Weapon and passive colours:** `color` on each entry.
- **Elite enemy tint:** `elites.tint`.
- **Ground and sky:** `world.groundColor`, `groundColor2`, `skyColor`, `fogColor`.
- **Panel and text colours on screen:** the `:root` block at the top of `index.html`.

---

## 7. Tuning difficulty

- **Length of a run:** `winTime`, in seconds. Default 600.
- **Spawn schedule:** `waves`. Each row starts at `at` seconds. `rate` is how many enemies appear per second. `types` sets the mix. The numbers are weights. Example: `raider: 3, rodian: 1` means about three in four are raiders.
  - The last row whose `at` has passed is the active one.
- **Enemy cap:** `maxEnemies`. The most enemies alive at once. Lower it if the phone slows down.
- **Enemy toughness over time:** `scaling.hpPerMinute` (default 0.22). At minute 5, enemies have 1 + 5 × 0.22 = 2.1 times their base health. `scaling.damagePerMinute` does the same for hit damage.
- **Boss:** `bosses`. `at` is the second it arrives. `type` is the enemy key. `hpMult` multiplies its health. Default bosses come at 300 s and 560 s.
- **Elites:** `elites.every` is the gap between elites in seconds. Set it to `0` to turn elites off. `hpMult`, `scaleMult` and `xpMult` make them tougher, bigger and worth more XP.
- **Per enemy:** `hp`, `speed`, `damage` (per second while touching you), `xp`, and `radius`.
- **Per weapon level:** each weapon has six `levels`. Level 1 is the first entry. Change `damage`, `cooldown` and the other numbers on any line.
- **Player:** `maxHp`, `speed` (metres per second), `pickupRadius`.
- **Level costs:** `xpToNext`. The function gives the XP needed for each level.

---

## 8. One complete before and after example

**Before.** The built-in Tusken raider:

```js
raider:    { builder: 'raider',    scale: 1.0, colors: { robe: '#bfa27a', wraps: '#8f7a5c', mask: '#6b5a45', goggles: '#2b2622', metal: '#8a8f94', stick: '#5a4632' } },
```

**After.** The same enemy, using `assets/tusken.glb`:

```js
raider:    { url: 'assets/tusken.glb', anim: 'Walk', fallback: 'raider', colors: { robe: '#bfa27a', wraps: '#8f7a5c', mask: '#6b5a45', goggles: '#2b2622', metal: '#8a8f94', stick: '#5a4632' } },
```

What changed:

- `builder` became `url`. The file is loaded from `assets/tusken.glb`.
- `scale: 1.0` was removed. The model is sized to 1.8 metres and stood on the ground.
- `anim: 'Walk'` picks the walking clip. The name must match the file.
- `fallback: 'raider'` says which built-in figure to show if the file fails.
- `colors` stays. It only matters if the file fails.

If `tusken.glb` faces the wrong way, add `rotationY: Math.PI` (see section 3).

If the warlord (the boss) uses a file, add `height: 4.1`. Without it, a file-based warlord is 1.8 metres tall. The built-in warlord is 2.3 times the raider size, about 4.1 metres.

---

## 9. Quick checks when something looks wrong

- Model looks like the old figure: the file did not load. Check the name and the folder. Check the console if you have one.
- Model is huge or tiny: you set `scale`, or the file was made in centimetres. Remove `scale` for people, or set `scale` to the right number.
- Model sinks into the sand or floats: use `yOffset` (only matters when `scale` is set).
- Model walks backwards: use `rotationY` (see section 3).
- No sound: check the path, the format (mp3, ogg or wav), and that the page is served over http.
- Game feels too slow on a phone: check `maxEnemies`, and the mesh count of your models.
