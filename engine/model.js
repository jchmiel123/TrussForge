// TrussForge engine - model: state, nodes, members, braces, serialize.
// HEADLESS: no DOM, no deps. Runs in Node and the browser unchanged.
//
// Coordinates: y is UP, ground is the half-plane y <= 0 (ground surface
// at y = 0). The web renderer flips y for the screen.
//
// Node flags (independent, 4 combinations):
//   pinned - fixed to the world, never moves.
//   locked - the ANGLES between all members meeting at this node are
//            welded. Implemented by hidden bracing constraints between
//            the far endpoints of each pair of incident members
//            (triangle rigidity). Rebuilt by rebuildBraces().
//
// Member flag `solid` (default false = pass-through): nodes of OTHER
// bodies collide with a solid member (sim.js). Build ramps, walls and
// platforms out of anchored solid beams. Nodes of the member itself and
// their direct neighbours never collide with it (no self-jamming).
//
// Member kinds:
//   beam     - rigid stick (hard distance constraint).
//   spring   - passive, stiffness k + damping c (soft, force-based).
//   actuator - beam whose REST LENGTH is driven by a waveform:
//              target = restLen * (1 + amp * wave(t)).

export const MEMBER_KINDS = ['beam', 'spring', 'actuator'];

export const DEFAULTS = {
  springK: 60,        // N/m-ish (world units are meters, masses ~1 kg)
  springC: 1.5,       // damping N*s/m
  wave: { type: 'sine', amp: 0.2, period: 1.2, phase: 0, duty: 0.5 },
  nodeMass: 1,
};

export function createState(opts = {}) {
  return {
    t: 0,
    nodes: [],
    members: [],
    braces: [],          // hidden constraints from locked nodes
    nextId: 1,
    world: {
      gravity: 9.81,
      gravityOn: true,
      friction: 0.7,     // Coulomb coefficient mu (0 = ice, ~1 = rubber)
      drag: 0.08,        // air drag, 1/s
      groundY: 0,
      actuatorRamp: 0.8, // seconds to fade actuator amplitude in from t=0
      iterations: 12,    // constraint relaxation passes per step
      speed: 1,          // sim speed multiplier (web uses it; step() does not)
      ...opts.world,
    },
  };
}

export function addNode(state, x, y, opts = {}) {
  const n = {
    id: state.nextId++,
    x, y, px: x, py: y,    // current + previous (verlet)
    rx: x, ry: y,          // rest/build pose (Reset restores this)
    pinned: !!opts.pinned,
    locked: !!opts.locked,
    mass: opts.mass || DEFAULTS.nodeMass,
  };
  state.nodes.push(n);
  return n;
}

export function addMember(state, a, b, kind = 'beam', opts = {}) {
  if (a === b) return null;
  const na = getNode(state, a), nb = getNode(state, b);
  if (!na || !nb) return null;
  if (findMember(state, a, b)) return null;   // no duplicate edges
  // rest length from CURRENT positions: identical to the rest pose when
  // building paused, and avoids a violent snap when adding mid-run.
  const restLen = Math.hypot(nb.x - na.x, nb.y - na.y);
  if (restLen < 1e-6) return null;
  const m = {
    id: state.nextId++,
    a: na.id, b: nb.id,
    kind,
    solid: !!opts.solid,
    restLen: opts.restLen ?? restLen,
    k: opts.k ?? DEFAULTS.springK,
    c: opts.c ?? DEFAULTS.springC,
    wave: kind === 'actuator'
      ? { ...DEFAULTS.wave, ...opts.wave }
      : null,
  };
  state.members.push(m);
  rebuildBraces(state);
  return m;
}

export function getNode(state, id) {
  if (typeof id === 'object' && id !== null) return id;
  return state.nodes.find(n => n.id === id) || null;
}

export function getMember(state, id) {
  return state.members.find(m => m.id === id) || null;
}

export function findMember(state, a, b) {
  const ia = getNode(state, a).id, ib = getNode(state, b).id;
  return state.members.find(m =>
    (m.a === ia && m.b === ib) || (m.a === ib && m.b === ia)) || null;
}

export function removeMember(state, id) {
  const i = state.members.findIndex(m => m.id === id);
  if (i >= 0) state.members.splice(i, 1);
  rebuildBraces(state);
}

export function removeNode(state, id) {
  const nid = getNode(state, id) ? getNode(state, id).id : id;
  state.members = state.members.filter(m => m.a !== nid && m.b !== nid);
  const i = state.nodes.findIndex(n => n.id === nid);
  if (i >= 0) state.nodes.splice(i, 1);
  rebuildBraces(state);
}

export function membersAt(state, nodeId) {
  return state.members.filter(m => m.a === nodeId || m.b === nodeId);
}

// Rebuild the hidden bracing constraints implied by locked nodes.
// For each locked node, every PAIR of incident members gets a distance
// constraint between the two far endpoints, at their rest-pose distance
// (pass fromCurrent=true to weld at the CURRENT deformed pose instead -
// the editor uses that when a lock is toggled while the sim runs, so the
// weld does not jolt the structure back toward the build pose).
// Call after any topology change or lock toggle.
export function rebuildBraces(state, fromCurrent = false) {
  state.braces = [];
  for (const n of state.nodes) {
    if (!n.locked) continue;
    const inc = membersAt(state, n.id);
    for (let i = 0; i < inc.length; i++) {
      for (let j = i + 1; j < inc.length; j++) {
        const farA = getNode(state, inc[i].a === n.id ? inc[i].b : inc[i].a);
        const farB = getNode(state, inc[j].a === n.id ? inc[j].b : inc[j].a);
        if (!farA || !farB || farA.id === farB.id) continue;
        const len = fromCurrent
          ? Math.hypot(farB.x - farA.x, farB.y - farA.y)
          : Math.hypot(farB.rx - farA.rx, farB.ry - farA.ry);
        if (len < 1e-6) continue;
        state.braces.push({ a: farA.id, b: farB.id, len });
      }
    }
  }
}

// Restore the build pose (positions = rest positions, velocities = 0, t = 0).
export function reset(state) {
  for (const n of state.nodes) {
    n.x = n.rx; n.y = n.ry; n.px = n.rx; n.py = n.ry;
  }
  for (const m of state.members) { m._f = 0; m._lam = 0; }
  state.t = 0;
  rebuildBraces(state);
}

// Adopt the CURRENT positions as the new build pose (used by the editor
// after dragging nodes around while paused).
export function bakeRestPose(state) {
  for (const n of state.nodes) { n.rx = n.x; n.ry = n.y; }
  for (const m of state.members) {
    const a = getNode(state, m.a), b = getNode(state, m.b);
    m.restLen = Math.hypot(b.rx - a.rx, b.ry - a.ry);
  }
  rebuildBraces(state);
}

export function centroid(state) {
  let x = 0, y = 0, k = 0;
  for (const n of state.nodes) { x += n.x; y += n.y; k++; }
  return k ? { x: x / k, y: y / k } : { x: 0, y: 0 };
}

// ---- substructures (copy / paste / mirror) -------------------------------

// Node ids reachable from nodeId through members (the connected "body").
export function componentOf(state, nodeId) {
  const seen = new Set([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop();
    for (const m of state.members) {
      const other = m.a === id ? m.b : m.b === id ? m.a : null;
      if (other !== null && !seen.has(other)) { seen.add(other); stack.push(other); }
    }
  }
  return [...seen];
}

// A portable fragment: the given nodes (rest pose, flags, mass) and every
// member whose BOTH ends are in the set. Ids are local to the fragment.
export function extractSub(state, ids) {
  const set = new Set(ids);
  const nodes = state.nodes.filter(n => set.has(n.id)).map(n => ({
    id: n.id, x: n.rx, y: n.ry,
    pinned: n.pinned || undefined, locked: n.locked || undefined,
    mass: n.mass !== DEFAULTS.nodeMass ? n.mass : undefined,
  }));
  const members = state.members.filter(m => set.has(m.a) && set.has(m.b)).map(m => ({
    a: m.a, b: m.b, kind: m.kind, restLen: m.restLen,
    solid: m.solid || undefined,
    k: m.kind === 'spring' ? m.k : undefined,
    c: m.kind === 'spring' ? m.c : undefined,
    wave: m.kind === 'actuator' ? { ...m.wave } : undefined,
  }));
  return { app: 'trussforge-fragment', version: 1, nodes, members };
}

export function fragmentBounds(frag) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const n of frag.nodes) {
    x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
    y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
  }
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

// Insert a fragment translated by (dx, dy). Nodes are born at rest in
// their new place (build pose = current pose). Member rest lengths are
// copied verbatim so pre-stressed members paste exactly. Returns the new
// node ids (same order as frag.nodes).
export function insertSub(state, frag, dx = 0, dy = 0) {
  const map = new Map();
  const ids = [];
  for (const d of frag.nodes) {
    const n = addNode(state, d.x + dx, d.y + dy, {
      pinned: !!d.pinned, locked: !!d.locked, mass: d.mass || DEFAULTS.nodeMass,
    });
    map.set(d.id, n.id);
    ids.push(n.id);
  }
  for (const d of frag.members) {
    addMember(state, map.get(d.a), map.get(d.b), d.kind, {
      restLen: d.restLen, k: d.k, c: d.c, wave: d.wave, solid: !!d.solid,
    });
  }
  rebuildBraces(state);
  return ids;
}

// Mirror the given nodes left-right about the vertical line x = axisX
// (default: the centre of their bounding box). Rest AND current pose,
// so it is safe while paused or running. Lengths are preserved.
export function mirrorSub(state, ids, axisX) {
  const set = new Set(ids);
  const ns = state.nodes.filter(n => set.has(n.id));
  if (!ns.length) return;
  if (axisX === undefined) {
    let x0 = Infinity, x1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.rx); x1 = Math.max(x1, n.rx); }
    axisX = (x0 + x1) / 2;
  }
  for (const n of ns) {
    n.rx = 2 * axisX - n.rx;
    n.x = 2 * axisX - n.x;
    n.px = 2 * axisX - n.px;
  }
  rebuildBraces(state);
}

// Translate the given nodes (rest and current pose) by (dx, dy).
export function translateSub(state, ids, dx, dy) {
  const set = new Set(ids);
  for (const n of state.nodes) {
    if (!set.has(n.id)) continue;
    n.rx += dx; n.ry += dy;
    n.x += dx; n.y += dy;
    n.px += dx; n.py += dy;
  }
  rebuildBraces(state);
}

// ---- serialization -------------------------------------------------------

export function serialize(state) {
  return {
    app: 'trussforge',
    version: 1,
    world: { ...state.world },
    nodes: state.nodes.map(n => ({
      id: n.id, x: n.rx, y: n.ry,
      pinned: n.pinned || undefined,
      locked: n.locked || undefined,
      mass: n.mass !== DEFAULTS.nodeMass ? n.mass : undefined,
    })),
    members: state.members.map(m => ({
      id: m.id, a: m.a, b: m.b, kind: m.kind,
      solid: m.solid || undefined,
      restLen: m.restLen,
      k: m.kind === 'spring' ? m.k : undefined,
      c: m.kind === 'spring' ? m.c : undefined,
      wave: m.kind === 'actuator' ? { ...m.wave } : undefined,
    })),
  };
}

export function deserialize(doc) {
  if (!doc || doc.app !== 'trussforge' || !Array.isArray(doc.nodes)) {
    throw new Error('not a trussforge document');
  }
  const state = createState();
  state.world = { ...state.world, ...doc.world };
  let maxId = 0;
  for (const d of doc.nodes) {
    const n = {
      id: d.id, x: d.x, y: d.y, px: d.x, py: d.y, rx: d.x, ry: d.y,
      pinned: !!d.pinned, locked: !!d.locked,
      mass: d.mass || DEFAULTS.nodeMass,
    };
    state.nodes.push(n);
    maxId = Math.max(maxId, d.id);
  }
  for (const d of doc.members) {
    const m = {
      id: d.id, a: d.a, b: d.b, kind: d.kind,
      solid: !!d.solid,
      restLen: d.restLen,
      k: d.k ?? DEFAULTS.springK,
      c: d.c ?? DEFAULTS.springC,
      wave: d.kind === 'actuator' ? { ...DEFAULTS.wave, ...d.wave } : null,
    };
    state.members.push(m);
    maxId = Math.max(maxId, d.id);
  }
  state.nextId = maxId + 1;
  rebuildBraces(state);
  return state;
}
