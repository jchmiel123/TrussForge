// ForgeKit ValuePod - a floating card over the work area that edits the
// numeric properties of whatever is selected: one chip per property, a
// Dial for the active chip, +/- nudge buttons and a "=" button that
// hands off to the app's full settings surface (side panel, sheet...).
//
// Lives inside the editing window instead of a side panel, so on a phone
// the board stays visible while you turn a value. Styled by forgekit.css
// (classes fk-pod / fk-chips / fk-chip / fk-col) with theme tokens.
//
//   const pod = new ValuePod(boardWrapEl, {
//     onChange: (target, v) => { ... },   // after target.set(v) ran
//     onMore: () => openFullPanel(),
//   });
//   pod.show([{ key: 'mass', label: 'mass', unit: 'kg', min: 0.2, max: 5, step: 0.1,
//               get: () => n.mass, set: v => { n.mass = v; } }], { title: 'Node' });
//   pod.hide();
//
// Options: position 'bottom-right' (default) | 'top-right' | 'bottom-left'
// | 'top-left'; storageKey remembers where the user dragged it (the grip
// bar at the top moves it, double-tap the grip to snap back).

import { Dial } from './dial.js';

export class ValuePod {
  constructor(host, { onChange, onMore, onTap, onStart, size = 104, moreLabel = '=', position = 'bottom-right', storageKey } = {}) {
    this.onChange = onChange || (() => {});
    this.onMore = onMore || null;
    this.targets = [];
    this.active = null;
    this.host = host;
    this.homeCorner = position;
    this.storageKey = storageKey;
    this._pos = null;
    const el = document.createElement('div');
    el.className = 'fk-pod fk-hidden';
    el.innerHTML = `
      <div class="fk-grip" title="Drag to move (double-tap: snap back)"></div>
      <div class="fk-chips"></div>
      <div class="fk-body">
        <canvas class="fk-dial"></canvas>
        <div class="fk-col">
          <button class="fk-plus" title="Up one step">+</button>
          <button class="fk-minus" title="Down one step">-</button>
          <button class="fk-more" title="All settings">${moreLabel}</button>
        </div>
      </div>`;
    host.appendChild(el);
    this.el = el;
    this.chips = el.querySelector('.fk-chips');
    this.onStart = onStart || (() => {});
    this.dial = new Dial(el.querySelector('.fk-dial'), {
      size,
      onChange: v => this._apply(v),
      onTap: onTap || (() => {}),
      onStart: () => { if (this.active) this.onStart(this.active); },
    });
    el.querySelector('.fk-plus').addEventListener('click', () => { if (this.active) this.onStart(this.active); this.dial.nudge(1); });
    el.querySelector('.fk-minus').addEventListener('click', () => { if (this.active) this.onStart(this.active); this.dial.nudge(-1); });
    const more = el.querySelector('.fk-more');
    more.addEventListener('click', () => { if (this.onMore) this.onMore(); });
    // buttons keep focus after a click, which steals Space / arrows from
    // the app; drop it
    el.addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) b.blur(); });
    // position: remembered drag spot, else the home corner
    let restored = null;
    try { restored = storageKey ? JSON.parse(localStorage.getItem(storageKey)) : null; } catch (e) { restored = null; }
    if (restored && Number.isFinite(restored.left) && Number.isFinite(restored.top)) this._applyPos(restored);
    else this.setCorner(position);
    const grip = el.querySelector('.fk-grip');
    let drag = null;
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
      const r = el.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
    });
    grip.addEventListener('pointermove', e => {
      if (!drag) return;
      drag.moved = true;
      const hr = host.getBoundingClientRect();
      const left = Math.max(0, Math.min(hr.width - el.offsetWidth, e.clientX - hr.left - drag.dx));
      const top = Math.max(0, Math.min(hr.height - el.offsetHeight, e.clientY - hr.top - drag.dy));
      this._applyPos({ left, top });
    });
    const endDrag = () => {
      if (!drag) return;
      if (drag.moved && storageKey) { try { localStorage.setItem(storageKey, JSON.stringify(this._pos)); } catch (e) { /* ignore */ } }
      drag = null;
    };
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
    grip.addEventListener('dblclick', () => {
      this.setCorner(this.homeCorner);
      try { if (storageKey) localStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
    });
  }

  _applyPos(p) {
    this._pos = p;
    Object.assign(this.el.style, { left: p.left + 'px', top: p.top + 'px', right: 'auto', bottom: 'auto' });
  }

  // park the pod in a corner of the host ('top-right', 'bottom-left', ...)
  setCorner(corner) {
    this._pos = null;
    this.homeCorner = corner;
    const s = this.el.style;
    s.left = s.top = s.right = s.bottom = 'auto';
    if (corner.includes('top')) s.top = '10px'; else s.bottom = '10px';
    if (corner.includes('left')) s.left = '10px'; else s.right = '10px';
  }

  // after a host resize a remembered spot can be off-screen: pull it back
  _clampPos() {
    if (!this._pos || !this.visible) return;
    const hr = this.host.getBoundingClientRect();
    const left = Math.max(0, Math.min(hr.width - this.el.offsetWidth, this._pos.left));
    const top = Math.max(0, Math.min(hr.height - this.el.offsetHeight, this._pos.top));
    if (left !== this._pos.left || top !== this._pos.top) this._applyPos({ left, top });
  }

  get visible() { return !this.el.classList.contains('fk-hidden'); }

  show(targets, { title = '', active } = {}) {
    this.targets = targets || [];
    this.title = title;
    this.el.classList.remove('fk-hidden');
    this._clampPos();
    this.el.querySelector('.fk-more').style.display = this.onMore ? '' : 'none';
    this.chips.innerHTML = '';
    if (!this.targets.length) {
      this.chips.innerHTML = `<span class="fk-chip fk-static">${title || ''}</span>`;
      this.dial.setTarget(null);
      this.active = null;
      return;
    }
    for (const t of this.targets) {
      const b = document.createElement('button');
      b.className = 'fk-chip';
      b.dataset.key = t.key;
      b.textContent = t.label;
      b.title = t.tip || t.label;
      b.addEventListener('click', () => this.setActive(t.key));
      this.chips.appendChild(b);
    }
    const want = active && this.targets.find(t => t.key === active) ? active : this.targets[0].key;
    this.setActive(want);
  }

  hide() {
    this.el.classList.add('fk-hidden');
    this.targets = [];
    this.active = null;
  }

  setActive(key) {
    const t = this.targets.find(x => x.key === key);
    if (!t) return;
    this.active = t;
    for (const c of this.chips.children) c.classList.toggle('fk-on', c.dataset.key === key);
    this.dial.setTarget({
      value: t.get(), min: t.min, max: t.max, step: t.step,
      label: t.label, unit: t.unit || '', fmt: t.fmt, title: this.title,
    });
  }

  // re-read the active target (after an edit elsewhere)
  refresh() {
    if (this.active && this.visible) this.dial.setValue(this.active.get());
  }

  _apply(v) {
    const t = this.active;
    if (!t) return;
    t.set(v);
    this.onChange(t, v);
  }
}
