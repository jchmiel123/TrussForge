// ForgeKit Dial - a rotary value control drawn on a canvas.
//
// Descended from CircuitForge's value knob (its decade-per-turn log dial),
// generalised for bounded values: one 270-degree sweep spans the target's
// [min, max] and turns snap to `step`, so a phase dial with step 1/24
// clicks through the standard fractions and a mass dial with step 0.1
// never lands on 1.37.
//
// Pointer Events only (mouse / touch / pen). A tap (no rotation beyond a
// small deadzone) fires onTap instead of nudging the value - CircuitForge
// uses that to flip switches. Keyboard: focus the canvas, arrows step,
// PageUp / PageDown step x10, Home / End go to min / max.
//
// Colors come from the theme tokens on the document (--accent, --track,
// --text, --dim, --panel2) so the dial follows applyTheme().
//
//   const dial = new Dial(canvasEl, { onChange: v => ..., onTap: () => ... });
//   dial.setTarget({ value: 0.25, min: 0, max: 1, step: 1 / 24, label: 'phase', fmt: fmtPhase });

import { cssVar } from './theme.js';

export const SWEEP = 1.5 * Math.PI;       // 270 degrees of travel
export const START = 0.75 * Math.PI;      // 7:30 on a clock face
const DEADZONE = 0.02;                    // radians before a tap becomes a turn

// ---- pure math (tested headless) -----------------------------------------
export function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

export function snapStep(v, min, step) {
  if (!(step > 0)) return v;
  const k = Math.round((v - min) / step);
  // avoid 0.30000000000000004: round to the step's decimals
  const dec = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  return +(min + k * step).toFixed(Math.min(12, dec + 2));
}

export function valueToFrac(v, min, max) {
  if (!(max > min)) return 0;
  return clamp((v - min) / (max - min), 0, 1);
}

export function fracToValue(f, min, max, step) {
  const v = min + clamp(f, 0, 1) * (max - min);
  return clamp(snapStep(v, min, step), min, max);
}

// ---- the widget -----------------------------------------------------------
export class Dial {
  constructor(canvas, { onChange, onTap, onStart, size = 110 } = {}) {
    this.canvas = canvas;
    this.size = size;
    this.onChange = onChange || (() => {});
    this.onTap = onTap || (() => {});
    this.onStart = onStart || (() => {});   // once per gesture / key - hosts push undo here
    this.target = null;             // {value, min, max, step, label, unit, fmt, title}
    this._turn = null;
    canvas.style.touchAction = 'none';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'slider');
    this._onDown = e => this._down(e);
    this._onMove = e => this._move(e);
    this._onUp = e => this._up(e);
    this._onKey = e => this._key(e);
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onUp);
    canvas.addEventListener('keydown', this._onKey);
  }

  destroy() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('pointercancel', this._onUp);
    c.removeEventListener('keydown', this._onKey);
  }

  setTarget(t) {
    this.target = t ? { min: 0, max: 1, step: 0, unit: '', label: '', ...t } : null;
    if (t) {
      this.canvas.setAttribute('aria-label', t.label || 'value');
      this.canvas.setAttribute('aria-valuemin', String(this.target.min));
      this.canvas.setAttribute('aria-valuemax', String(this.target.max));
    }
    this.draw();
  }

  setValue(v, fire = false) {
    const t = this.target;
    if (!t) return;
    const nv = clamp(snapStep(v, t.min, t.step), t.min, t.max);
    if (nv === t.value && !fire) { this.draw(); return; }
    t.value = nv;
    this.canvas.setAttribute('aria-valuenow', String(nv));
    this.draw();
    if (fire) this.onChange(nv, t);
  }

  nudge(dir, mult = 1) {
    const t = this.target;
    if (!t) return;
    const step = t.step > 0 ? t.step : (t.max - t.min) / 100;
    this.setValue(t.value + dir * step * mult, true);
  }

  format(v) {
    const t = this.target;
    if (!t) return '';
    if (t.fmt) return t.fmt(v);
    const dec = t.step > 0 ? Math.max(0, Math.ceil(-Math.log10(t.step))) : 2;
    return v.toFixed(Math.min(4, dec)) + (t.unit ? ' ' + t.unit : '');
  }

  draw() {
    const cv = this.canvas, S = this.size;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (cv.width !== Math.round(S * dpr)) { cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr); }
    cv.style.width = S + 'px'; cv.style.height = S + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const t = this.target;
    const accent = cssVar('accent', '#2f81f7'), track = cssVar('track', '#2a3b50');
    const text = cssVar('text', '#d3dce6'), dim = cssVar('dim', '#7c8ba1');
    const cx = S / 2, cy = S / 2 + 3, R = S * 0.36;
    g.textAlign = 'center';
    if (!t) {
      g.fillStyle = dim; g.font = '11px Consolas, monospace';
      g.fillText('nothing to turn', cx, cy);
      return;
    }
    if (t.title) {
      g.fillStyle = dim; g.font = '10px Consolas, monospace';
      g.fillText(t.title, cx, 11);
    }
    // track
    g.lineCap = 'round';
    g.strokeStyle = track; g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, R, START, START + SWEEP); g.stroke();
    // progress
    const f = valueToFrac(t.value, t.min, t.max);
    if (f > 0) {
      g.strokeStyle = accent;
      g.beginPath(); g.arc(cx, cy, R, START, START + SWEEP * f); g.stroke();
    }
    // knob marker
    const a = START + SWEEP * f;
    g.fillStyle = accent;
    g.beginPath(); g.arc(cx + R * Math.cos(a), cy + R * Math.sin(a), 5, 0, 2 * Math.PI); g.fill();
    // value + label
    g.fillStyle = text; g.font = 'bold 13px Consolas, monospace';
    g.fillText(this.format(t.value), cx, cy + 1);
    g.fillStyle = dim; g.font = '10px Consolas, monospace';
    g.fillText(t.label, cx, cy + 15);
  }

  // ---- input ------------------------------------------------------------
  _angle(e) {
    const r = this.canvas.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }
  _down(e) {
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    this._turn = { angle: this._angle(e), pend: 0, tap: true, frac: this.target ? valueToFrac(this.target.value, this.target.min, this.target.max) : 0 };
    this.canvas.focus({ preventScroll: true });
    if (this.target) this.onStart(this.target);
  }
  _move(e) {
    const tn = this._turn, t = this.target;
    if (!tn || !t) return;
    const a = this._angle(e);
    let d = a - tn.angle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    tn.angle = a;
    tn.pend += d;
    // deadzone: a jittery tap never nudges; a slow deliberate turn still
    // registers in full because rotation accumulates
    if (tn.tap && Math.abs(tn.pend) < DEADZONE) return;
    tn.tap = false;
    tn.frac = clamp(tn.frac + tn.pend / SWEEP, 0, 1);
    tn.pend = 0;
    const nv = fracToValue(tn.frac, t.min, t.max, t.step);
    if (nv !== t.value) this.setValue(nv, true);
  }
  _up(e) {
    const tn = this._turn;
    this._turn = null;
    if (tn && tn.tap && e.type === 'pointerup') this.onTap(this.target);
  }
  _key(e) {
    const t = this.target;
    if (!t) return;
    const big = 10;
    if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) this.onStart(t);
    switch (e.key) {
      case 'ArrowUp': case 'ArrowRight': this.nudge(1); break;
      case 'ArrowDown': case 'ArrowLeft': this.nudge(-1); break;
      case 'PageUp': this.nudge(1, big); break;
      case 'PageDown': this.nudge(-1, big); break;
      case 'Home': this.setValue(t.min, true); break;
      case 'End': this.setValue(t.max, true); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
