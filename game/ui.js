// ============================================================================
//  ui.js — DOM side of the game: HUD, overlays, level-up cards, banners,
//  pooled floating damage numbers, boss bar, player mini-bar.
//  All text comes from THEME.strings; all colours from THEME (pushed into CSS vars).
// ============================================================================
import * as THREE from 'three';

const DN_POOL = 40;
const DN_LIFE = 0.72;
const _v = new THREE.Vector3();

export function createUI(THEME, cb) {
  const $ = (id) => document.getElementById(id);
  const S = THEME.strings;
  const W = THEME.world;

  // ---- push theme colours into CSS custom properties
  const root = document.documentElement.style;
  root.setProperty('--sky', W.skyColor);
  root.setProperty('--sand', W.groundColor);
  root.setProperty('--sun1', W.sun1.color);
  root.setProperty('--sun2', W.sun2.color);
  root.setProperty('--accent', W.sun2.color);
  if (THEME.elites && THEME.elites.tint) root.setProperty('--elite', THEME.elites.tint);
  const xpColor = THEME.models.crystal && THEME.models.crystal.colors && THEME.models.crystal.colors.core;
  if (xpColor) root.setProperty('--xp', xpColor);

  // ---- static text
  $('titletext').textContent = THEME.title;
  document.title = THEME.title;
  $('tagline').textContent = THEME.tagline;
  $('credit').textContent = THEME.credit;
  $('startBtn').textContent = S.start;
  $('resumeBtn').textContent = S.resume;
  $('pauseRestartBtn').textContent = S.restart;
  $('restartBtn').textContent = S.restart;
  $('pausetitle').textContent = S.paused;
  $('lutitle').textContent = S.levelUp;
  $('lusub').textContent = S.levelUpHint;
  $('stTimeL').textContent = S.statTime;
  $('stKillsL').textContent = S.statKills;
  $('stLevelL').textContent = S.statLevel;
  $('killlabel').textContent = S.statKills;
  const coarse = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  $('controls').textContent = coarse ? S.controlsTouch : S.controlsKeys;

  const el = {
    hud: $('hud'), lvl: $('lvl'), xpfill: $('xpfill'), hpfill: $('hpfill'), hptext: $('hptext'),
    time: $('time'), kills: $('kills'), chips: $('chips'), banner: $('banner'), bannertext: $('bannertext'),
    bossarrow: $('bossarrow'), bossbar: $('bossbar'), bossname: $('bossname'), bossfill: $('bossfill'),
    title: $('title'), levelup: $('levelup'), cards: $('cards'), pause: $('pause'), end: $('end'),
    endtitle: $('endtitle'), stTime: $('stTime'), stKills: $('stKills'), stLevel: $('stLevel'),
    hurt: $('hurt'), pbar: $('pbar'), pbarfill: $('pbarfill'), fx: $('fx'), muteBtn: $('muteBtn'),
    loading: $('loading'),
  };

  // ---- buttons
  const click = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  click('startBtn', () => cb.onStart());
  click('resumeBtn', () => cb.onPause());
  click('pauseRestartBtn', () => cb.onRestart());
  click('restartBtn', () => cb.onRestart());
  click('pauseBtn', () => cb.onPause());
  click('muteBtn', () => cb.onMute());

  // ---- HUD diffing caches
  let cLvl = -1, cXp = -1, cHp = -1, cMax = -1, cTime = -1, cKills = -1, cLoadout = '', cHurt = -1, cBoss = -1, bossShown = false, arrowOn = false;

  const fmtTime = (t) => {
    const s = Math.floor(t);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  // ---- floating damage numbers (pooled DOM)
  const dns = [];
  for (let i = 0; i < DN_POOL; i++) {
    const d = document.createElement('div');
    d.className = 'dn';
    el.fx.appendChild(d);
    dns.push({ el: d, active: false, t: 0, x: 0, y: 0, z: 0, s: 1, sx: 0 });
  }
  let dnNext = 0;

  // ---- level-up cards
  let cardEls = [];
  let armedAt = 0;

  function glyphHTML(def) {
    if (def.icon) return '<img alt="" src="' + def.icon + '">';
    return escapeHTML(def.glyph || '?');
  }

  const api = {
    hideLoading() { el.loading.style.display = 'none'; },

    showHUD(on) { el.hud.classList.toggle('on', !!on); el.pbar.style.display = on ? 'block' : 'none'; if (!on) { cLoadout = ''; } },

    setOverlay(name, on) {
      const m = { title: el.title, levelup: el.levelup, pause: el.pause, end: el.end }[name];
      if (m) m.classList.toggle('on', !!on);
    },
    focusPrimary(name) {
      const sel = { title: '#startBtn', pause: '#resumeBtn', end: '#restartBtn' }[name];
      const b = sel && document.querySelector(sel);
      if (b && b.focus) { try { b.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
    },

    /** Bring every cached HUD value up to date. Cheap when nothing changed. */
    update(s) {
      if (s.level !== cLvl) { cLvl = s.level; el.lvl.textContent = (S.levelShort || 'LV') + ' ' + s.level; }
      const xpf = s.xpNext > 0 ? Math.min(1, s.xp / s.xpNext) : 0;
      if (Math.abs(xpf - cXp) > 0.002) { cXp = xpf; el.xpfill.style.transform = 'scaleX(' + xpf.toFixed(3) + ')'; }
      const hp = Math.max(0, Math.ceil(s.hp));
      if (hp !== cHp || s.maxHp !== cMax) {
        cHp = hp; cMax = s.maxHp;
        el.hptext.textContent = hp + ' / ' + Math.round(s.maxHp);
        el.hpfill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, s.hp / s.maxHp)).toFixed(3) + ')';
      }
      const t = Math.floor(s.time);
      if (t !== cTime) { cTime = t; el.time.textContent = fmtTime(s.time); }
      if (s.kills !== cKills) { cKills = s.kills; el.kills.textContent = s.kills; }
      if (s.loadoutSig !== cLoadout) { cLoadout = s.loadoutSig; renderChips(s.loadout); }
    },

    setHurt(v) {
      if (Math.abs(v - cHurt) > 0.01 || (v === 0 && cHurt !== 0)) { cHurt = v; el.hurt.style.opacity = v.toFixed(2); }
    },

    setMuted(m) { el.muteBtn.classList.toggle('muted', !!m); el.muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false'); },

    /** Floating mini HP bar under the hero. sx/sy are CSS px; frac 0..1. */
    playerBar(sx, sy, frac, show) {
      if (!show) { el.pbar.style.display = 'none'; return; }
      el.pbar.style.display = 'block';
      el.pbar.style.transform = 'translate3d(' + (sx - 23).toFixed(1) + 'px,' + sy.toFixed(1) + 'px,0)';
      el.pbarfill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, frac)).toFixed(3) + ')';
    },

    banner(text, kind) {
      el.bannertext.textContent = text;
      el.banner.className = kind === 'boss' ? 'boss' : '';
      void el.banner.offsetWidth; // restart the CSS animation
      el.banner.classList.add('show');
    },

    setBoss(name, frac) {
      if (name == null) { if (bossShown) { el.bossbar.classList.remove('on'); bossShown = false; } return; }
      if (!bossShown) { bossShown = true; cBoss = -1; el.bossbar.classList.add('on'); el.bossname.textContent = name; }
      if (Math.abs(frac - cBoss) > 0.004) { cBoss = frac; el.bossfill.style.transform = 'scaleX(' + Math.max(0, frac).toFixed(3) + ')'; }
    },

    /** Edge arrow pointing at an off-screen boss. x/y in CSS px, angle in radians (0 = pointing up). */
    bossArrow(show, x, y, angle) {
      const a = el.bossarrow;
      if (!show) { if (arrowOn) { a.style.display = 'none'; arrowOn = false; } return; }
      if (!arrowOn) { a.style.display = 'block'; arrowOn = true; }
      a.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + angle.toFixed(3) + 'rad)';
    },

    // ---- level up
    showLevelUp(cards) {
      el.cards.textContent = '';
      cardEls = cards.map((c, i) => {
        const b = document.createElement('button');
        b.className = 'card lock';
        b.style.setProperty('--c', c.color);
        b.innerHTML =
          '<span class="glyph">' + glyphHTML(c) + '</span>' +
          '<span class="body"><span class="name">' + escapeHTML(c.label) + '</span>' +
          '<span class="lv">' + escapeHTML(c.tag) + '</span>' +
          '<span class="desc">' + escapeHTML(c.desc) + '</span></span>' +
          (c.isNew ? '<span class="new">' + escapeHTML(S.newItem) + '</span>' : '') +
          '<span class="key">' + (i + 1) + '</span>';
        b.addEventListener('click', (e) => { e.stopPropagation(); if (performance.now() >= armedAt) cb.onChoose(i); });
        el.cards.appendChild(b);
        return b;
      });
      // Brief input guard so a thumb that was still steering does not pick a card by accident.
      armedAt = performance.now() + 380;
      setTimeout(() => { for (const b of cardEls) b.classList.remove('lock'); }, 380);
      api.setOverlay('levelup', true);
    },
    hideLevelUp() { api.setOverlay('levelup', false); cardEls = []; },
    cardsArmed() { return performance.now() >= armedAt; },

    showEnd(kind, stats) {
      el.end.className = 'overlay on ' + kind;
      el.endtitle.textContent = kind === 'victory' ? S.victory : S.gameOver;
      el.stTime.textContent = fmtTime(stats.time);
      el.stKills.textContent = stats.kills;
      el.stLevel.textContent = stats.level;
      api.focusPrimary('end');
    },
    hideEnd() { el.end.className = 'overlay'; },

    // ---- damage numbers
    spawnDamage(x, y, z, amount, color, big) {
      const d = dns[dnNext]; dnNext = (dnNext + 1) % DN_POOL;
      d.active = true; d.t = 0; d.x = x; d.y = y; d.z = z;
      d.sx = (Math.random() - 0.5) * 22;
      d.s = big ? 1.35 : 1;
      d.el.textContent = Math.max(1, Math.round(amount));
      d.el.style.color = color || '#fff';
      d.el.style.display = 'block';
      d.el.style.opacity = '1';
    },
    /** Advance + position all live numbers. dt may be 0 (paused) — they still follow the camera. */
    updateDamage(dt, camera, w, h) {
      for (let i = 0; i < DN_POOL; i++) {
        const d = dns[i];
        if (!d.active) continue;
        d.t += dt;
        if (d.t >= DN_LIFE) { d.active = false; d.el.style.display = 'none'; continue; }
        _v.set(d.x, d.y, d.z).project(camera);
        const u = d.t / DN_LIFE;
        const rise = 46 * (1 - (1 - u) * (1 - u));
        const px = (_v.x * 0.5 + 0.5) * w + d.sx * u;
        const py = (-_v.y * 0.5 + 0.5) * h - rise;
        const sc = d.s * (u < 0.12 ? 0.7 + (u / 0.12) * 0.5 : 1.2 - 0.25 * u);
        d.el.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0) translate(-50%,-50%) scale(' + sc.toFixed(2) + ')';
        d.el.style.opacity = u > 0.6 ? (1 - (u - 0.6) / 0.4).toFixed(2) : '1';
      }
    },
    clearDamage() { for (const d of dns) { d.active = false; d.el.style.display = 'none'; } },
  };

  function renderChips(loadout) {
    el.chips.textContent = '';
    for (const c of loadout) {
      const d = document.createElement('div');
      d.className = 'chip panel' + (c.kind === 'passive' ? ' passive' : '');
      d.style.setProperty('--c', c.color);
      d.title = c.name;
      let pips = '';
      for (let i = 0; i < c.max; i++) pips += '<i' + (i < c.level ? ' class="on"' : '') + '></i>';
      d.innerHTML = (c.icon ? '<img alt="" src="' + c.icon + '">' : '<span class="g">' + escapeHTML(c.glyph || '?') + '</span>') + '<span class="p">' + pips + '</span>';
      el.chips.appendChild(d);
    }
  }

  return api;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
