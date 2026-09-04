// TrussForge engine - shapes: parametric starting pieces (wheel / ring /
// box / Warren truss). HEADLESS: no DOM, no deps.
//
// Every builder returns a trussforge-fragment - the same object extractSub
// produces - with nodes at ABSOLUTE world coordinates, so the editor drops
// it in with insertSub(state, frag, 0, 0). After that it is an ordinary
// group of nodes and members; nothing remembers it was a shape.
//
// Members carry no restLen: addMember measures the geometry, which is the
// intended rest pose. Node ids are 1..N within the fragment.
//
// `startIndex` on the fragment = index (into frag.nodes / the ids that
// insertSub returns) of the node sitting at the point the drag STARTED
// (wheel hub, box / truss first corner). The editor merges that node into
// an existing one when the drag began on a node, so a wheel can be drawn
// straight onto an axle.

export const SHAPE_KINDS = ['wheel', 'ring', 'box', 'truss'];

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const frag = (nodes, members, extra = {}) =>
  ({ app: 'trussforge-fragment', version: 1, nodes, members, ...extra });

// Regular polygon of `sides` around (cx, cy), radius r. hub = centre node
// + spokes (a wheel: fully triangulated, so it rolls as a rigid disc). No
// hub = a ring of hinged links (a mechanism - it squashes under load; use
// springs or add bracing). Default rotation puts an EDGE at the bottom so
// a wheel sits flat on the ground.
export function polygonShape({ cx, cy, r, sides = 8, rot, hub = true, kind = 'beam' } = {}) {
  if (!(r > 1e-6)) return null;
  const n = clampInt(sides, 3, 64);
  if (rot === undefined) rot = Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
  const nodes = [], members = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (2 * Math.PI * i) / n;
    nodes.push({ id: i + 1, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  for (let i = 0; i < n; i++) members.push({ a: i + 1, b: (i + 1) % n + 1, kind });
  let startIndex;
  if (hub) {
    nodes.push({ id: n + 1, x: cx, y: cy });
    for (let i = 0; i < n; i++) members.push({ a: n + 1, b: i + 1, kind });
    startIndex = n;
  }
  return frag(nodes, members, { startIndex });
}

// Rectangle from corner (x0, y0) to (x1, y1). brace: 'one' diagonal
// (rigid), 'cross' both (they cross without a joint), 'none' (a hinged
// four-bar: it folds). Node 1 is the FIRST corner given.
export function boxShape({ x0, y0, x1, y1, brace = 'one', kind = 'beam' } = {}) {
  const w = x1 - x0, h = y1 - y0;
  if (Math.abs(w) < 1e-6 || Math.abs(h) < 1e-6) return null;
  const nodes = [
    { id: 1, x: x0, y: y0 }, { id: 2, x: x1, y: y0 },
    { id: 3, x: x1, y: y1 }, { id: 4, x: x0, y: y1 },
  ];
  const members = [
    { a: 1, b: 2, kind }, { a: 2, b: 3, kind }, { a: 3, b: 4, kind }, { a: 4, b: 1, kind },
  ];
  if (brace === 'one' || brace === 'cross') members.push({ a: 1, b: 3, kind });
  if (brace === 'cross') members.push({ a: 2, b: 4, kind });
  return frag(nodes, members, { startIndex: 0 });
}

// Warren truss: bottom chord from (x0, y0) to (x1, y0) in `bays` equal
// bays, top chord at height h = y1 - y0 with one node over each bay
// midpoint, a zig-zag of diagonals. Every panel is a triangle, so it is
// rigid with hinges alone. h < 0 hangs the top chord below (an inverted
// truss). Node 1 is the bottom node at x0. Members = 4 * bays - 1.
export function trussShape({ x0, y0, x1, y1, bays = 4, kind = 'beam' } = {}) {
  const w = x1 - x0, h = y1 - y0;
  if (Math.abs(w) < 1e-6 || Math.abs(h) < 1e-6) return null;
  const nb = clampInt(bays, 1, 24);
  const nodes = [], members = [];
  for (let i = 0; i <= nb; i++) nodes.push({ id: i + 1, x: x0 + (w * i) / nb, y: y0 });
  const top = i => nb + 2 + i;                       // id of the top node over bay i
  for (let i = 0; i < nb; i++) nodes.push({ id: top(i), x: x0 + (w * (i + 0.5)) / nb, y: y0 + h });
  for (let i = 0; i < nb; i++) members.push({ a: i + 1, b: i + 2, kind });          // bottom chord
  for (let i = 0; i + 1 < nb; i++) members.push({ a: top(i), b: top(i + 1), kind }); // top chord
  for (let i = 0; i < nb; i++) {                                                   // diagonals
    members.push({ a: i + 1, b: top(i), kind });
    members.push({ a: top(i), b: i + 2, kind });
  }
  return frag(nodes, members, { startIndex: 0 });
}

// One entry point for the editor: kind from SHAPE_KINDS + that shape's
// geometry. 'wheel' / 'ring' take { cx, cy, r, sides, kind }; 'box' and
// 'truss' take { x0, y0, x1, y1, ... }. Returns null when too small.
export function shapeFragment(shape, geom = {}) {
  switch (shape) {
    case 'wheel': return polygonShape({ ...geom, hub: true });
    case 'ring': return polygonShape({ ...geom, hub: false });
    case 'box': return boxShape(geom);
    case 'truss': return trussShape(geom);
    default: return null;
  }
}
