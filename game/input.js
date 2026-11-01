// ============================================================================
//  input.js — keyboard + floating touch/mouse joystick + synthetic debug input.
//  Screen up = world -Z, screen right = +X (the camera looks down -Z).
// ============================================================================

const RING_R = 56;        // px: radius the knob can travel from the ring centre
const DEAD = 0.1;         // fraction of RING_R ignored
const FULL = 0.85;        // fraction at which the stick reads as full speed

export function createInput({ stage, joy, ring, knob, onPause, onChoose }) {
  const keys = new Set();
  let pid = -1, bx = 0, by = 0, jx = 0, jz = 0, jOn = false;
  let dbgX = 0, dbgZ = 0;

  // ---------------------------------------------------------------- keyboard
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (MOVE_KEYS.has(e.code)) { keys.add(e.code); e.preventDefault(); return; }
    if (e.repeat) return;
    if (e.code === 'KeyP' || e.code === 'Escape') { onPause && onPause(); e.preventDefault(); return; }
    if (e.code === 'Digit1' || e.code === 'Numpad1') onChoose && onChoose(0);
    else if (e.code === 'Digit2' || e.code === 'Numpad2') onChoose && onChoose(1);
    else if (e.code === 'Digit3' || e.code === 'Numpad3') onChoose && onChoose(2);
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); });
  window.addEventListener('blur', () => { keys.clear(); });

  // ---------------------------------------------------------------- joystick
  function place() {
    ring.style.transform = 'translate3d(' + (bx - 56) + 'px,' + (by - 56) + 'px,0)';
  }
  function placeKnob(dx, dy) {
    knob.style.transform = 'translate3d(' + (bx + dx - 27) + 'px,' + (by + dy - 27) + 'px,0)';
  }
  function endStick() {
    pid = -1; jx = 0; jz = 0; jOn = false;
    joy.classList.remove('on');
  }

  stage.addEventListener('pointerdown', (e) => {
    if (pid !== -1) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pid = e.pointerId;
    try { stage.setPointerCapture(pid); } catch (_) { /* not fatal */ }
    bx = e.clientX; by = e.clientY; jx = 0; jz = 0; jOn = true;
    place(); placeKnob(0, 0);
    joy.classList.add('on');
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    let dx = e.clientX - bx, dy = e.clientY - by;
    const d = Math.hypot(dx, dy);
    if (d > RING_R) {
      // The ring follows the finger, so you never run out of stick and can re-aim without lifting.
      const k = (d - RING_R) / d;
      bx += dx * k; by += dy * k;
      dx = e.clientX - bx; dy = e.clientY - by;
      place();
    }
    placeKnob(dx, dy);
    const m = Math.hypot(dx, dy) / RING_R;
    if (m < DEAD) { jx = 0; jz = 0; }
    else {
      const s = Math.min(1, (m - DEAD) / (FULL - DEAD));
      const inv = 1 / (Math.hypot(dx, dy) || 1);
      jx = dx * inv * s; jz = dy * inv * s;
    }
    e.preventDefault();
  });
  const up = (e) => { if (e.pointerId === pid) endStick(); };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('lostpointercapture', up);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  // Belt and braces for browsers that still scroll/zoom on touch.
  stage.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  stage.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  return {
    /** Fills out.x / out.z with a vector of length <= 1. Debug input overrides when non-zero. */
    getMove(out) {
      if (dbgX !== 0 || dbgZ !== 0) {
        const l = Math.hypot(dbgX, dbgZ);
        const k = l > 1 ? 1 / l : 1;
        out.x = dbgX * k; out.z = dbgZ * k;
        return out;
      }
      if (jOn && (jx !== 0 || jz !== 0)) { out.x = jx; out.z = jz; return out; }
      let x = 0, z = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
      if (x !== 0 && z !== 0) { x *= Math.SQRT1_2; z *= Math.SQRT1_2; }
      out.x = x; out.z = z;
      return out;
    },
    setDebugMove(x, z) { dbgX = +x || 0; dbgZ = +z || 0; },
    /** Drop any held keys / touch (called on phase changes so nothing sticks). */
    reset() { keys.clear(); endStick(); },
  };
}
