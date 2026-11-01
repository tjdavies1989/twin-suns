// ============================================================================
//  THEME — the one file to edit to reskin the game.
//
//  Everything that is "content" lives here: names, colours, stats, waves,
//  weapon tuning, UI text, and which model / sound file each thing uses.
//  The engine (main.js) contains no names or colours of its own.
//
//  SWAPPING A MODEL  (full guide: ASSETS.md)
//    Every entry in `models` is either
//      { builder: 'raider', colors: {...}, scale: 1 }     built-in placeholder
//    or
//      { url: 'assets/tusken.glb', anim: 'Walk', fallback: 'raider' }
//                                                         your own glTF/GLB file
//    Put the .glb in assets/, change the entry, reload (serve over HTTP; file://
//    will not work). Leave out `scale` to auto-size people to 1.8 m and stand
//    them on the ground; set `scale` only to override that. Other options:
//    rotationY, yOffset, height, humanoid, idleAnim, bob, fallbackScale.
//    If the file fails to load the game falls back to the built-in builder named
//    in `fallback` and logs a warning. Keep `colors` (and add `fallbackScale`,
//    e.g. 2.3 for the warlord) on a swapped entry so the fallback still looks right.
//    Models face +Z with feet at y = 0.
//    PERFORMANCE: enemies should be ONE mesh with ONE material and under about
//    1-2k triangles. Each extra mesh costs one draw call per enemy on screen.
//    XP crystals (crystal, crystalBig) are instanced and use the FIRST mesh only.
//    The heal pickup (bacta) is a normal model and renders whole.
//
//  SWAPPING A SOUND
//    Every entry in `sounds` is null (built-in synth) or a path such as
//    'assets/blaster.mp3' (mp3 / ogg / wav, short clips). Missing files fall
//    back to the synth.
//
//  Fonts and the remaining UI chrome colours live in index.html (:root).
// ============================================================================

const THEME = {
  title: 'TWIN SUNS',
  tagline: 'Hold the dune line until both suns set.',
  credit: 'Fan-made. Placeholder art and sound. Reskin in game/theme.js.',

  strings: {
    start: 'Start',
    controlsTouch: 'Drag anywhere to move. You attack automatically.',
    controlsKeys: 'WASD or arrow keys to move. You attack automatically. P to pause.',
    levelUp: 'Level up',
    levelUpHint: 'Choose one',
    newItem: 'New',
    paused: 'Paused',
    resume: 'Resume',
    restart: 'Restart',
    gameOver: 'You fell in the sand',
    victory: 'The suns have set. You held.',
    bossIncoming: 'A warlord approaches',
    eliteIncoming: 'Elite',
    statTime: 'Survived',
    statKills: 'Kills',
    statLevel: 'Level',
    levelShort: 'LV',      // HUD level label
    healOption: 'Bacta Patch',
    healOptionDesc: 'Restore 30 health.',
  },

  // How long a run lasts, in seconds. Surviving this long wins.
  winTime: 600,

  world: {
    groundColor: '#d9b77e',   // base sand
    groundColor2: '#c49a5c',  // darker dune streaks
    skyColor: '#f2c48a',      // background / horizon
    fogColor: '#efc28c',
    fogNear: 30,
    fogFar: 70,
    sun1: { color: '#fff1d6', intensity: 2.2, direction: [-0.6, 1.0, 0.35] },
    sun2: { color: '#ffb36b', intensity: 1.0, direction: [0.7, 0.8, -0.2] },
    ambient: { color: '#ffd9b0', intensity: 0.9 },
    // Scenery scattered procedurally around the player. density = props per 100 m^2.
    props: [
      { model: 'rock', density: 0.18, scaleMin: 0.6, scaleMax: 2.2 },
      { model: 'vaporator', density: 0.03, scaleMin: 0.9, scaleMax: 1.2 },
      { model: 'bones', density: 0.04, scaleMin: 0.8, scaleMax: 1.4 },
    ],
  },

  player: {
    name: 'The Wanderer',
    model: 'hero',
    maxHp: 100,
    speed: 6.0,            // metres per second
    pickupRadius: 3.5,     // metres; XP crystals inside this fly to you
    radius: 0.5,           // collision radius
    invulnAfterHit: 0.0,   // contact damage is continuous; leave at 0
    startWeapon: 'blaster',
    maxWeapons: 5,
    maxPassives: 5,
  },

  // Enemies. hp/damage/xp are base values; `scaling` raises hp over time.
  //   speed:  metres per second
  //   damage: contact damage per second while touching the player
  //   attack: optional ranged attack (enemy bolts the player must dodge). Enemies only fire while on screen,
  //           so on a narrow phone view they can be in range yet hold fire until they step into the frame.
  //   keepDistance: ranged enemies stop approaching at this distance
  enemies: {
    raider: {
      name: 'Tusken Raider', model: 'raider',
      hp: 10, speed: 3.3, damage: 10, radius: 0.55, xp: 1,
    },
    rodian: {
      name: 'Rodian', model: 'rodian',
      hp: 8, speed: 4.6, damage: 7, radius: 0.5, xp: 2,
      attack: { range: 9, cooldown: 3.2, damage: 5, speed: 13, color: '#7dff6a' },
    },
    officer: {
      name: 'Republic Officer', model: 'officer',
      hp: 30, speed: 2.4, damage: 8, radius: 0.55, xp: 4, keepDistance: 6.5,
      attack: { range: 10, cooldown: 3.0, damage: 6, speed: 15, color: '#ff4d3d' },
    },
    warlord: {
      name: 'Raider Warlord', model: 'warlord', boss: true,
      hp: 900, speed: 2.9, damage: 30, radius: 1.3, xp: 60,
    },
  },

  scaling: {
    hpPerMinute: 0.22,      // enemy hp multiplier grows by this much each minute
    damagePerMinute: 0.06,
  },

  // Spawn schedule. From `at` seconds, spawn `rate` enemies per second, with
  // types picked by weight. The last row whose `at` has passed is active.
  waves: [
    { at: 0,   rate: 1.3, types: { raider: 1 } },
    { at: 45,  rate: 1.6, types: { raider: 3, rodian: 1 } },
    { at: 120, rate: 2.4, types: { raider: 3, rodian: 2, officer: 1 } },
    { at: 210, rate: 3.2, types: { raider: 2, rodian: 2, officer: 2 } },
    { at: 330, rate: 4.2, types: { raider: 2, rodian: 3, officer: 3 } },
    { at: 450, rate: 5.4, types: { raider: 3, rodian: 3, officer: 4 } },
    { at: 540, rate: 7.0, types: { raider: 4, rodian: 4, officer: 4 } },
  ],
  maxEnemies: 220,          // hard cap on live enemies (performance)

  bosses: [
    { at: 300, type: 'warlord' },
    { at: 560, type: 'warlord', hpMult: 2 },
  ],

  // Every `every` seconds one elite spawns: a bigger, tougher normal enemy
  // that drops a big crystal.
  elites: { every: 60, hpMult: 8, scaleMult: 1.45, xpMult: 10, tint: '#ffd24a' },

  // XP needed to go from `level` to level + 1.
  xpToNext: (level) => Math.floor(2 + level * 3 + Math.pow(level, 1.6)),

  pickups: {
    xp: { model: 'crystal', bigModel: 'crystalBig', bigThreshold: 10, mergeAbove: 300 },
    heal: { model: 'bacta', amount: 30, dropChance: 0.02, color: '#5dd6c0', glyph: '+' },
  },

  // Weapons. Each level is the full stat block at that level (level 1 = first
  // entry). description is shown on the level-up card for that level.
  // icon: optional image path; otherwise a coloured glyph is drawn.
  weapons: {
    blaster: {
      name: 'Blaster Pistol', glyph: 'B', color: '#ffd84a',
      kind: 'bolt',
      levels: [
        { desc: 'Fires at the nearest enemy.',      damage: 12, cooldown: 0.65, count: 1, pierce: 0, speed: 26, range: 18 },
        { desc: 'One more bolt.',                   damage: 12, cooldown: 0.65, count: 2, pierce: 0, speed: 26, range: 18 },
        { desc: 'More damage.',                     damage: 15, cooldown: 0.7,  count: 2, pierce: 0, speed: 28, range: 18 },
        { desc: 'Bolts pierce one enemy.',          damage: 15, cooldown: 0.65, count: 3, pierce: 1, speed: 28, range: 20 },
        { desc: 'Faster fire.',                     damage: 18, cooldown: 0.5,  count: 3, pierce: 1, speed: 30, range: 20 },
        { desc: 'Bolts pierce two. Max level.',     damage: 22, cooldown: 0.45, count: 4, pierce: 2, speed: 32, range: 22 },
      ],
    },
    saber: {
      name: 'Laser Sword', glyph: 'S', color: '#4fc3ff',
      kind: 'orbit',
      levels: [
        { desc: 'A blade circles you.',             damage: 14, count: 1, radius: 2.3, spin: 3.2, length: 1.6, hitCooldown: 0.45 },
        { desc: 'A second blade.',                  damage: 14, count: 2, radius: 2.3, spin: 3.2, length: 1.6, hitCooldown: 0.45 },
        { desc: 'Wider and faster.',                damage: 18, count: 2, radius: 2.8, spin: 3.8, length: 1.8, hitCooldown: 0.4 },
        { desc: 'A third blade.',                   damage: 18, count: 3, radius: 2.8, spin: 3.8, length: 1.8, hitCooldown: 0.4 },
        { desc: 'More damage.',                     damage: 26, count: 3, radius: 3.1, spin: 4.2, length: 2.0, hitCooldown: 0.35 },
        { desc: 'Four blades. Max level.',          damage: 30, count: 4, radius: 3.4, spin: 4.6, length: 2.2, hitCooldown: 0.3 },
      ],
    },
    detonator: {
      name: 'Thermal Charge', glyph: 'T', color: '#ffb02e',
      kind: 'lob',
      levels: [
        { desc: 'Lobs a charge that explodes.',     damage: 30, cooldown: 2.6, count: 1, blastRadius: 3.0, range: 12, fuse: 0.8 },
        { desc: 'Bigger blast.',                    damage: 30, cooldown: 2.4, count: 1, blastRadius: 3.8, range: 12, fuse: 0.8 },
        { desc: 'Two charges.',                     damage: 36, cooldown: 2.4, count: 2, blastRadius: 3.8, range: 13, fuse: 0.8 },
        { desc: 'More damage.',                     damage: 50, cooldown: 2.2, count: 2, blastRadius: 4.2, range: 13, fuse: 0.75 },
        { desc: 'Three charges.',                   damage: 55, cooldown: 2.0, count: 3, blastRadius: 4.4, range: 14, fuse: 0.7 },
        { desc: 'Huge blasts. Max level.',          damage: 70, cooldown: 1.8, count: 3, blastRadius: 5.2, range: 15, fuse: 0.7 },
      ],
    },
    push: {
      name: 'Force Push', glyph: 'F', color: '#c9b8ff',
      kind: 'nova',
      levels: [
        { desc: 'A shockwave throws enemies back.', damage: 8,  cooldown: 4.0, radius: 5.0, knockback: 9 },
        { desc: 'Wider wave.',                      damage: 10, cooldown: 3.8, radius: 6.0, knockback: 10 },
        { desc: 'More often.',                      damage: 12, cooldown: 3.2, radius: 6.0, knockback: 10 },
        { desc: 'More damage.',                     damage: 20, cooldown: 3.0, radius: 6.8, knockback: 12 },
        { desc: 'Wider still.',                     damage: 24, cooldown: 2.7, radius: 7.8, knockback: 13 },
        { desc: 'Flattens crowds. Max level.',      damage: 32, cooldown: 2.4, radius: 8.8, knockback: 15 },
      ],
    },
    lightning: {
      name: 'Force Lightning', glyph: 'L', color: '#9fd8ff',
      kind: 'chain',
      levels: [
        { desc: 'Lightning jumps between enemies.', damage: 16, cooldown: 2.2, chains: 3, chainRange: 4.5, range: 10 },
        { desc: 'Jumps to more enemies.',           damage: 16, cooldown: 2.1, chains: 5, chainRange: 4.5, range: 10 },
        { desc: 'More damage.',                     damage: 24, cooldown: 2.0, chains: 5, chainRange: 5.0, range: 11 },
        { desc: 'Two bolts at once.',               damage: 24, cooldown: 1.9, chains: 6, chainRange: 5.0, range: 11, forks: 2 },
        { desc: 'Faster.',                          damage: 30, cooldown: 1.5, chains: 7, chainRange: 5.5, range: 12, forks: 2 },
        { desc: 'Storm. Max level.',                damage: 38, cooldown: 1.2, chains: 9, chainRange: 6.0, range: 13, forks: 3 },
      ],
    },
  },

  // Passive upgrades. `per` is added once per level owned.
  passives: {
    vitality: { name: 'Bacta Infusion',  glyph: '+', color: '#ff7aa8', max: 5, desc: '+20 max health.',            per: { maxHp: 20 } },
    reflexes: { name: 'Quick Reflexes',  glyph: '>', color: '#7dffb0', max: 5, desc: '+8% move speed.',            per: { speedMult: 0.08 } },
    focus:    { name: 'Kyber Focus',     glyph: '*', color: '#ffe066', max: 5, desc: '+10% damage.',               per: { damageMult: 0.10 } },
    calm:     { name: 'Meditation',      glyph: '~', color: '#8ab4ff', max: 5, desc: '-7% weapon cooldowns.',      per: { cooldownMult: -0.07 } },
    reach:    { name: 'Force Reach',     glyph: 'o', color: '#d9a6ff', max: 5, desc: '+30% pickup range.',         per: { pickupMult: 0.30 } },
    trance:   { name: 'Healing Trance',  glyph: '^', color: '#7ff0ff', max: 5, desc: 'Regenerate 0.4 health/sec.', per: { regen: 0.4 } },
    plating:  { name: 'Beskar Plating',  glyph: '#', color: '#c7ccd6', max: 5, desc: 'Take 8% less damage.',       per: { armor: 0.08 } },
  },

  // Models. See the header for how to swap one for a .glb file.
  // Builders available in models.js: hero, raider, rodian, officer, warlord,
  // rock, vaporator, bones, crystal, crystalBig, bacta.
  models: {
    hero:      { builder: 'hero',      scale: 1.0, colors: { robe: '#5b4636', tunic: '#e8dcc4', skin: '#e0b48f', hair: '#c9a15b', hilt: '#9aa0a6' } },
    raider:    { builder: 'raider',    scale: 1.0, colors: { robe: '#bfa27a', wraps: '#8f7a5c', mask: '#6b5a45', goggles: '#2b2622', metal: '#8a8f94', stick: '#5a4632' } },
    rodian:    { builder: 'rodian',    scale: 1.1, colors: { skin: '#5fae4a', eyes: '#0d0f12', vest: '#7a4b2a', pants: '#3a3f4a', blaster: '#2d2d2d' } },
    officer:   { builder: 'officer',   scale: 1.0, colors: { uniform: '#7c8590', cap: '#6c747e', belt: '#1c1c1c', skin: '#e2b896', boots: '#141414', insignia: '#d33b2f' } },
    warlord:   { builder: 'raider',    scale: 2.3, colors: { robe: '#7a2e22', wraps: '#4a2a1e', mask: '#3d2a1c', goggles: '#120e0c', metal: '#c9a35b', stick: '#2e2117' } },
    rock:      { builder: 'rock',      scale: 1.0, colors: { base: '#a8794b', dark: '#7f5a37' } },
    vaporator: { builder: 'vaporator', scale: 1.0, colors: { body: '#cfd2d4', dark: '#6d7378', band: '#9aa0a6' } },
    bones:     { builder: 'bones',     scale: 1.0, colors: { bone: '#efe6d2' } },
    crystal:   { builder: 'crystal',   scale: 1.0, colors: { core: '#5ff2ff' } },
    crystalBig:{ builder: 'crystal',   scale: 1.8, colors: { core: '#ff6af0' } },
    bacta:     { builder: 'bacta',     scale: 1.0, colors: { glass: '#5dd6c0', cap: '#e8e8e8' } },
  },

  // Sounds. null = built-in synthesised sound. A string = path to a file.
  sounds: {
    blaster: null, saber: null, explosion: null, push: null, lightning: null,
    enemyShot: null, hit: null, death: null, pickup: null, levelup: null,
    hurt: null, bossAlert: null, victory: null, gameover: null, uiClick: null,
    music: null,     // looping background track; null = no music
    musicVolume: 0.35,
    sfxVolume: 0.6,
  },
};

export default THEME;
