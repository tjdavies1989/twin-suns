// Kiting bot: circles away from the enemy mass and auto-picks upgrades.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runBot(h, { seconds = 120, timeScale = 4, pick = 'smart', maxWallMs = 10 * 60 * 1000 } = {}) {
  await h.game(`(g) => g.debug.timeScale(${timeScale})`);
  const hpTrace = [], levelTimes = [];
  let lastTrace = -15, lastLevel = 1, lastMove = [0, 0];
  const t0 = Date.now();
  let st = await h.state();
  const startTime = st.time;

  while (Date.now() - t0 < maxWallMs) {
    const r = await h.page.evaluate(({ pick }) => {
      const g = window.__game, s = g.state();
      if (s.phase === 'levelup') {
        const ch = s.choices || [];
        const rank = (c) => {
          if (c.kind === 'weapon' && !(c.id in s.weapons)) return 0;
          if (c.kind === 'weapon') return 1;
          if (c.kind === 'passive') return 2;
          return 3;
        };
        let idx = 0;
        if (pick === 'smart') { let best = 99; ch.forEach((c, i) => { const k = rank(c); if (k < best) { best = k; idx = i; } }); }
        else if (pick === 'random') idx = Math.floor(Math.random() * Math.max(1, ch.length));
        g.debug.chooseUpgrade(idx);
        return { s, picked: ch[idx] };
      }
      if (s.phase !== 'playing') return { s };
      const px = s.player.x, pz = s.player.z;
      let cx = 0, cz = 0, wsum = 0, nearest = 1e9, n = 0;
      for (const [x, z] of g.debug.enemies()) {
        const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
        if (d2 > 18 * 18) continue;
        const d = Math.sqrt(d2);
        if (d < nearest) nearest = d;
        const w = 1 / (d2 + 1);
        cx += dx * w; cz += dz * w; wsum += w; n++;
      }
      let mx = 0, mz = 0;
      if (n > 0 && wsum > 0) {
        cx /= wsum; cz /= wsum;
        const len = Math.hypot(cx, cz) || 1;
        const ax = -cx / len, az = -cz / len;       // away
        const tx = -az, tz = ax;                    // tangent
        const close = Math.min(1, Math.max(0, (9 - nearest) / 9)); // closer => flee harder
        mx = ax * (0.4 + 0.8 * close) + tx * 0.9;
        mz = az * (0.4 + 0.8 * close) + tz * 0.9;
        const m = Math.hypot(mx, mz) || 1; mx /= m; mz /= m;
      }
      g.debug.setMove(mx, mz);
      return { s };
    }, { pick });
    st = r.s;
    if (st.phase === 'gameover' || st.phase === 'victory') break;
    if (st.time - startTime >= seconds) break;
    if (st.level !== lastLevel) { levelTimes.push({ level: st.level, time: +st.time.toFixed(1) }); lastLevel = st.level; }
    if (st.time - lastTrace >= 15) { hpTrace.push({ t: Math.floor(st.time), hp: Math.round(st.hp), maxHp: st.maxHp, enemies: st.enemies }); lastTrace = st.time; }
    await wait(100);
  }
  await h.game(`(g) => { g.debug.setMove(0, 0); g.debug.timeScale(1); }`);
  st = await h.state();
  return {
    survived: st.phase !== 'gameover', phase: st.phase, timeReached: +st.time.toFixed(1), level: st.level, kills: st.kills,
    hpTrace, levelTimes, finalWeapons: st.weapons, finalPassives: st.passives, wallSeconds: +((Date.now() - t0) / 1000).toFixed(1),
  };
}
