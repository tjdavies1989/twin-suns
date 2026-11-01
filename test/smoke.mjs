// CLI smoke test. Usage: node test/smoke.mjs   Exit code != 0 on any failure or console error.
import { launch } from './harness.mjs';
import THEME from '../game/theme.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const summary = { steps: {} };
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.error('FAIL: ' + msg); } return !!cond; };
async function waitFor(fn, ms, step = 100) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(step); } return null; }
async function clearLevelups(h) { for (let i = 0; i < 40; i++) { const s = await h.state(); if (s.phase !== 'levelup') return; await h.game('(g)=>g.debug.chooseUpgrade(0)'); await wait(60); } }
const WIN = THEME.winTime, START_W = THEME.player.startWeapon;

async function desktop() {
  const h = await launch({});
  try {
    summary.titleShot = await h.shot('smoke-01-title');
    let s = await h.state();
    check(s.phase === 'title', `initial phase should be title, got ${s.phase}`);
    await h.game('(g)=>g.start()');
    await wait(300);
    await h.game('(g)=>g.debug.setMove(1,0.3)');
    const t0 = (await h.state()).time; const x0 = (await h.state()).player.x;
    await wait(4000);
    await h.game('(g)=>g.debug.setMove(0,0)');
    s = await h.state();
    check(s.phase === 'playing', `phase should be playing, got ${s.phase}`);
    check(s.time > t0 + 1, `time should advance (${t0} -> ${s.time})`);
    check(Math.abs(s.player.x - x0) > 1, `player should move (x ${x0} -> ${s.player.x})`);
    // enemies spawn at 0.9/s, so allow some time
    const en = await waitFor(async () => (await h.state()).enemies > 0, 6000);
    check(en, 'enemies > 0 after several seconds');

    await h.game('(g)=>g.debug.addXP(200)');
    let lv = await waitFor(async () => (await h.state()).phase === 'levelup', 3000);
    s = await h.state();
    check(lv, `phase should be levelup after addXP, got ${s.phase}`);
    check(Array.isArray(s.choices) && s.choices.length === 3, `3 choices expected, got ${JSON.stringify(s.choices)}`);
    summary.choices = s.choices;
    summary.levelupShot = await h.shot('smoke-02-levelup');
    // there may be several queued level-ups; pick until playing
    for (let i = 0; i < 20; i++) { s = await h.state(); if (s.phase !== 'levelup') break; await h.game('(g)=>g.debug.chooseUpgrade(0)'); await wait(100); }
    s = await h.state();
    check(s.phase === 'playing', `phase should be playing after chooseUpgrade, got ${s.phase}`);

    await h.game('(g)=>{g.debug.god(true); g.debug.giveAllWeapons(); g.debug.spawn("raider",60); g.debug.spawn("rodian",45); g.debug.spawn("officer",45);}');
    await wait(300);
    s = await h.state();
    summary.spawned = s.enemies;
    check(s.enemies >= 100, `expected >=100 enemies right after spawning 150, got ${s.enemies}`);
    await h.game('(g)=>g.debug.setMove(0.7,0.7)');
    for (let i = 0; i < 10; i++) { await wait(500); await clearLevelups(h); }
    await h.game('(g)=>g.debug.setMove(0,0)');
    s = await h.state();
    summary.perf = { fps: s.fps, drawCalls: s.drawCalls, enemies: s.enemies };
        check(s.drawCalls < 400, `drawCalls ${s.drawCalls} should be < 400`);
    summary.swarmShot = await h.shot('smoke-03-swarm');

    await clearLevelups(h);
    await h.game('(g)=>{g.debug.killAll(); g.debug.setTime(299);}');
    const boss = await waitFor(async () => (await h.game('(g)=>g.debug.enemies().some(e=>e[2]==="warlord")')), 8000);
    check(boss, 'warlord should appear after setTime(299)');
    if (boss) summary.bossShot = await h.shot('smoke-04-boss');

    await clearLevelups(h);
    await h.game('(g)=>{g.debug.god(false); g.debug.damagePlayer(99999);}');
    const go = await waitFor(async () => (await h.state()).phase === 'gameover', 3000);
    check(go, `phase should be gameover, got ${(await h.state()).phase}`);
    check(await waitFor(async () => h.page.evaluate(() => { const e = document.getElementById('end'); return !!e && e.classList.contains('on'); }), 3000), 'end screen overlay should show after gameover');
    summary.gameoverShot = await h.shot('smoke-05-gameover');

    await h.game('(g)=>g.restart()');
    await wait(500);
    s = await h.state();
    summary.afterRestart = { phase: s.phase, time: s.time, level: s.level, enemies: s.enemies, weapons: s.weapons };
    check(s.phase === 'playing', `after restart phase should be playing, got ${s.phase}`);
    check(s.time < 2, `time ~0 after restart, got ${s.time}`);
    check(s.level === 1, `level 1 after restart, got ${s.level}`);
    check(s.enemies <= 5, `enemies ~0 after restart, got ${s.enemies}`);
    check(Object.keys(s.weapons).length === 1 && START_W in s.weapons, `only start weapon after restart, got ${JSON.stringify(s.weapons)}`);

    await h.game(`(g)=>{g.debug.god(true); g.debug.setTime(${WIN - 1});}`);
    const vic = await waitFor(async () => (await h.state()).phase === 'victory', 6000);
    check(vic, `phase should be victory, got ${(await h.state()).phase}`);
    check(await waitFor(async () => h.page.evaluate(() => { const e = document.getElementById('end'); return !!e && e.classList.contains('on'); }), 3000), 'end screen overlay should show after victory');
    await wait(400);
    summary.victoryShot = await h.shot('smoke-06-victory');
    summary.desktopErrors = h.errors.slice(); summary.desktopWarnings = h.warnings.slice(0, 10);
  } catch (e) { failures.push('desktop exception: ' + (e.stack || e)); }
  finally { summary.desktopErrors = h.errors.slice(); await h.close(); }
}

async function phone() {
  const h = await launch({ viewport: { width: 390, height: 844 }, mobile: true });
  try {
    await h.game('(g)=>g.start()');
    await wait(500);
    const s0 = await h.state();
    check(s0.phase === 'playing', `phone: phase should be playing, got ${s0.phase}`);
    const cdp = await h.page.context().newCDPSession(h.page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const x0 = 120, y = 520;
    await touch('touchStart', x0, y);
    for (let i = 1; i <= 15; i++) { await touch('touchMove', x0 + i * 6, y - i * 2); await wait(60); }
    await wait(1200);
    summary.phoneShotDragging = await h.shot('smoke-07-phone-drag');
    const s1 = await h.state();
    await touch('touchEnd');
    await wait(300);
    const moved = Math.hypot(s1.player.x - s0.player.x, s1.player.z - s0.player.z);
    summary.phone = { moved: +moved.toFixed(2), fps: s1.fps, drawCalls: s1.drawCalls };
    check(moved > 1, `phone: touch drag should move player (moved ${moved.toFixed(2)} m)`);
    await h.shot('smoke-08-phone-after');
  } catch (e) { failures.push('phone exception: ' + (e.stack || e)); }
  finally { summary.phoneErrors = h.errors.slice(); await h.close(); }
}

await desktop();
await phone();
const errs = [...(summary.desktopErrors || []), ...(summary.phoneErrors || [])];
if (errs.length) failures.push(`${errs.length} console/page/request errors`);
summary.failures = failures;
summary.ok = failures.length === 0;
console.log(JSON.stringify(summary, null, 1));
process.exit(summary.ok ? 0 : 1);
