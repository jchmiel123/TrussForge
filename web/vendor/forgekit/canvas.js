// ForgeKit canvas - size a canvas to its CSS box at device resolution.
//
// Ten near-identical copies of this existed (and EvoForge recomputed the
// DPR six separate times). The contract everyone wants:
//
//   const { w, h, dpr } = fitCanvas(cv);           // w,h in CSS px
//   ctx.setTransform(dpr, 0, 0, dpr, 0, 0);          // or pass transform: true
//   const stop = observeResize(cv.parentElement, () => { fitCanvas(cv); draw(); });
//
// Setting canvas.width resets the 2D context transform, so with
// { transform: true } the transform is (re)applied on every call, which
// is what a per-frame caller wants.

export function fitCanvas(cv, { maxDpr = Infinity, dpr, transform = false, min = 1 } = {}) {
  const ratio = Math.min(maxDpr, dpr ?? ((typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const r = cv.getBoundingClientRect();
  const pw = Math.max(min, Math.round(r.width * ratio));
  const ph = Math.max(min, Math.round(r.height * ratio));
  const changed = cv.width !== pw || cv.height !== ph;
  if (changed) { cv.width = pw; cv.height = ph; }
  if (transform) {
    const g = cv.getContext && cv.getContext('2d');
    if (g && g.setTransform) g.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  return { w: r.width, h: r.height, pw, ph, dpr: ratio, changed, rect: r };
}

// Call cb whenever el changes size (ResizeObserver, else window resize).
// Returns a stop() function.
export function observeResize(el, cb) {
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => cb());
    ro.observe(el);
    return () => ro.disconnect();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', cb);
    return () => window.removeEventListener('resize', cb);
  }
  return () => {};
}

// Pointer position in CSS px relative to the canvas box (pass the rect
// from fitCanvas to avoid a layout read per event).
export function canvasPoint(cv, ev, rect) {
  const r = rect || cv.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

// A pure helper for tests and for apps that size offscreen canvases.
export function scaledSize(cssW, cssH, dpr, { maxDpr = Infinity, min = 1 } = {}) {
  const ratio = Math.min(maxDpr, dpr || 1);
  return { pw: Math.max(min, Math.round(cssW * ratio)), ph: Math.max(min, Math.round(cssH * ratio)), dpr: ratio };
}
