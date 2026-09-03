// ForgeKit slider - a <input type="range"> with a live value label and
// optional stepper buttons (press-and-hold repeats).
//
// 44 range inputs across 9 apps each had a hand-written "sync the label"
// line, and MolForge had the good stepper implementation; this is both.
//
//   import { wireSlider, addSteppers } from './forgekit/slider.js';
//   const s = wireSlider(document.getElementById('pitch'), {
//     label: '#pitchLbl',                 // element or selector; gets fmt(value)
//     fmt: v => v.toFixed(2) + ' m',
//     onInput: v => live(v),              // every move
//     onChange: v => commit(v),           // on release
//     steppers: true,                     // wrap in [<] range [>]
//   });
//   s.set(0.25);           // programmatic, label follows, no events
//   s.set(0.25, true);     // ...and fire input + change
//   s.get();
//
// The app owns the value; the slider owns the DOM. Steppers dispatch a
// real 'input' event so every listener (yours or the app's) sees them.

export function stepClamp(v, min, max, step) {
  let x = Number.isFinite(v) ? v : min;
  if (step > 0) x = min + Math.round((x - min) / step) * step;
  const dec = step > 0 ? Math.max(0, Math.ceil(-Math.log10(step)) + 1) : 6;
  x = +x.toFixed(Math.min(12, dec + 2));
  return Math.max(min, Math.min(max, x));
}

const CHEV_L = '<svg viewBox="0 0 8 12" aria-hidden="true"><path d="M6 1 L2 6 L6 11"/></svg>';
const CHEV_R = '<svg viewBox="0 0 8 12" aria-hidden="true"><path d="M2 1 L6 6 L2 11"/></svg>';

// Wrap a range input in [<] input [>]; buttons step by the input's own
// min/max/step and dispatch 'input'. Returns the wrapper element.
export function addSteppers(input, { holdMs = 400, repeatMs = 80, wrapClass = 'fk-slider-flex', btnClass = 'fk-step-btn' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = wrapClass;
  input.parentNode.insertBefore(wrap, input);
  const mkBtn = dir => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = btnClass;
    b.setAttribute('aria-label', (dir < 0 ? 'decrease' : 'increase') + ' ' + (input.id || input.name || 'value'));
    b.innerHTML = dir < 0 ? CHEV_L : CHEV_R;
    let holdT = null, holdIv = null;
    const fire = () => {
      const step = parseFloat(input.step) || 1;
      const min = parseFloat(input.min) || 0;
      const max = Number.isFinite(parseFloat(input.max)) ? parseFloat(input.max) : 100;
      const v = stepClamp((parseFloat(input.value) || 0) + dir * step, min, max, step);
      if (v === parseFloat(input.value)) return;
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const stop = () => { clearTimeout(holdT); clearInterval(holdIv); holdT = holdIv = null; };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();   // keep focus off the button (no sticky outline)
      fire();
      holdT = setTimeout(() => { holdIv = setInterval(fire, repeatMs); }, holdMs);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    // Keyboard activation (Enter/Space) arrives as a click with detail 0 -
    // no pointerdown ever fires. Mouse clicks (detail >= 1) already fired.
    b.addEventListener('click', e => { if (e.detail === 0) fire(); });
    return b;
  };
  wrap.appendChild(mkBtn(-1));
  wrap.appendChild(input);
  wrap.appendChild(mkBtn(1));
  return wrap;
}

export function wireSlider(input, { label, fmt, onInput, onChange, steppers = false, stepperOpts } = {}) {
  const lbl = typeof label === 'string' ? document.querySelector(label) : (label || null);
  const format = fmt || (v => String(v));
  const read = () => parseFloat(input.value);
  const refresh = () => { if (lbl) lbl.textContent = format(read()); };
  const hInput = () => { refresh(); if (onInput) onInput(read(), input); };
  const hChange = () => { if (onChange) onChange(read(), input); };
  input.addEventListener('input', hInput);
  input.addEventListener('change', hChange);
  let wrap = null;
  if (steppers) wrap = addSteppers(input, stepperOpts);
  refresh();
  return {
    input, label: lbl, wrap,
    get: read,
    set(v, fire = false) {
      const min = parseFloat(input.min) || 0;
      const max = Number.isFinite(parseFloat(input.max)) ? parseFloat(input.max) : 100;
      input.value = stepClamp(v, min, max, parseFloat(input.step) || 0);
      if (fire) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else refresh();
      return this;
    },
    refresh,
    destroy() {
      input.removeEventListener('input', hInput);
      input.removeEventListener('change', hChange);
    },
  };
}

// Wire every range under root that names its label: <input type="range"
// data-label="#id"> (fmt from data-fmt: 'int' | 'fixed:2' | 'pct').
export function wireSliders(root, { onInput, onChange, steppers = false } = {}) {
  const out = {};
  for (const input of root.querySelectorAll('input[type="range"][data-label]')) {
    const f = input.dataset.fmt || '';
    const fmt = f === 'int' ? v => String(Math.round(v))
      : f.startsWith('fixed:') ? v => v.toFixed(+f.slice(6) || 0)
      : f === 'pct' ? v => Math.round(v * 100) + '%'
      : v => String(v);
    out[input.id || input.name] = wireSlider(input, { label: input.dataset.label, fmt, onInput, onChange, steppers });
  }
  return out;
}
