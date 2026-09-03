// ForgeKit gesture - the two pointer primitives every board re-derives:
// "was that a tap or a drag" and "two fingers = pinch zoom + pan".
//
// Only the PRIMITIVES live here. What a tap does, what a drag moves,
// what a pinch scales - that is the app's policy and stays in the app.
// Pointer Events only; capture in try/catch (synthetic events have no
// pointer). Pure math exported and tested.
//
//   const stop = tapOrDrag(canvas, {
//     slop: 7,                                  // px before a press becomes a drag
//     onTap: p => select(hit(p)),               // pointerup without exceeding slop
//     onDragStart: p => begin(p), onDrag: p => move(p), onDragEnd: p => finish(p),
//   });
//   const stop2 = pinchZoom(canvas, {
//     onPinch: ({ scale, cx, cy, dx, dy }) => zoomAround(cx, cy, scale, dx, dy),
//   });
//
// Points are { x, y } in CSS px relative to the element, plus the raw
// event as p.event and p.pointerType.

export function movedBeyond(a, b, slop) {
  return Math.hypot(b.x - a.x, b.y - a.y) > slop;
}

// Two touch points -> distance + midpoint.
export function pinchState(a, b) {
  return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

// Start state vs now -> zoom factor and midpoint travel.
export function pinchDelta(start, now) {
  return { scale: now.d / start.d, dx: now.cx - start.cx, dy: now.cy - start.cy, cx: now.cx, cy: now.cy };
}

function localPoint(el, e) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, event: e, pointerType: e.pointerType, id: e.pointerId };
}

// Single-pointer tap vs drag. Ignores extra pointers while one is active
// (so a second finger for a pinch never turns into a drag). Returns stop().
export function tapOrDrag(el, { slop = 7, onTap, onDragStart, onDrag, onDragEnd, onCancel, button = 0 } = {}) {
  let active = null;   // { id, start, dragging }
  const down = e => {
    if (active || (e.pointerType === 'mouse' && e.button !== button)) return;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    active = { id: e.pointerId, start: localPoint(el, e), dragging: false };
  };
  const move = e => {
    if (!active || e.pointerId !== active.id) return;
    const p = localPoint(el, e);
    if (!active.dragging) {
      if (!movedBeyond(active.start, p, slop)) return;
      active.dragging = true;
      if (onDragStart) onDragStart(active.start);
    }
    if (onDrag) onDrag(p, active.start);
  };
  const up = e => {
    if (!active || e.pointerId !== active.id) return;
    const a = active; active = null;
    const p = localPoint(el, e);
    if (e.type === 'pointercancel') { if (onCancel) onCancel(p); return; }
    if (a.dragging) { if (onDragEnd) onDragEnd(p, a.start); }
    else if (onTap) onTap(p);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}

// Two-pointer pinch: onPinchStart(state) when the second touch lands,
// onPinch(delta) per move, onPinchEnd() when a finger lifts. Deltas are
// relative to the START of the pinch (scale = d / d0), so the app anchors
// once and applies absolute zoom, which never drifts. Returns stop().
export function pinchZoom(el, { onPinchStart, onPinch, onPinchEnd, touchOnly = true } = {}) {
  const pts = new Map();
  let start = null;
  const two = () => { const [a, b] = [...pts.values()]; return pinchState(a, b); };
  const down = e => {
    if (touchOnly && e.pointerType === 'mouse') return;
    pts.set(e.pointerId, localPoint(el, e));
    if (pts.size === 2) { start = two(); if (onPinchStart) onPinchStart(start); }
  };
  const move = e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, localPoint(el, e));
    if (start && pts.size >= 2 && onPinch) onPinch(pinchDelta(start, two()));
  };
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (start && pts.size < 2) { start = null; if (onPinchEnd) onPinchEnd(); }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
