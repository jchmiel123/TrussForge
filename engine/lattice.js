// TrussForge engine - snap lattices. HEADLESS: pure math, no DOM.
//
// A lattice is a VIEW setting (per device), never part of a saved build:
// you can open any file and switch lattice type or pitch to suit the
// design you are continuing.
//
//   square - points at (i*p, j*p).
//   tri    - equilateral triangles of side p: rows every p*sqrt(3)/2,
//            odd rows shifted by p/2. The natural truss lattice: every
//            triangle is already equilateral, so Warren trusses, domes
//            and hex frames snap exactly.
// Row 0 of every lattice is y = 0, the ground line.

export const LATTICE_TYPES = ['square', 'tri'];
export const PITCHES = [0.05, 0.1, 0.125, 0.2, 0.25, 0.5, 1];
const S3_2 = Math.sqrt(3) / 2;

export function rowHeight(type, pitch) {
  return type === 'tri' ? pitch * S3_2 : pitch;
}

// x offset of row j (tri lattice shifts odd rows by half a pitch)
export function rowOffset(type, pitch, j) {
  return type === 'tri' && (j & 1) ? pitch / 2 : 0;
}

// Nearest lattice point to (x, y).
export function snapToLattice(type, pitch, x, y) {
  if (!(pitch > 0)) return { x, y };
  if (type !== 'tri') {
    return { x: Math.round(x / pitch) * pitch, y: Math.round(y / pitch) * pitch };
  }
  const h = pitch * S3_2;
  const j0 = Math.floor(y / h);
  let best = null, bestD = Infinity;
  for (const j of [j0, j0 + 1]) {
    const off = rowOffset(type, pitch, j);
    const i = Math.round((x - off) / pitch);
    const px = i * pitch + off, py = j * h;
    const d = (px - x) * (px - x) + (py - y) * (py - y);
    if (d < bestD) { bestD = d; best = { x: px, y: py }; }
  }
  return best;
}

// Visit every lattice point inside a world-space box (x0..x1, y0..y1).
export function forEachLatticePoint(type, pitch, x0, y0, x1, y1, fn) {
  const h = rowHeight(type, pitch);
  const jA = Math.ceil(y0 / h), jB = Math.floor(y1 / h);
  for (let j = jA; j <= jB; j++) {
    const off = rowOffset(type, pitch, j);
    const iA = Math.ceil((x0 - off) / pitch), iB = Math.floor((x1 - off) / pitch);
    const y = j * h;
    for (let i = iA; i <= iB; i++) fn(i * pitch + off, y, i, j);
  }
}
