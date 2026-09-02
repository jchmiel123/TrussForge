// TrussForge engine - simulation: position verlet + iterated constraint
// relaxation, actuator waveforms, ground contact with friction.
// HEADLESS: no DOM, no deps.
//
// Integration scheme (per fixed step dt, default 1/240 s):
//   1. Accumulate spring forces (elastic + axial damping) as accelerations.
//   2. Position verlet with global air drag and gravity.
//   3. iterations x relaxation passes over hard constraints:
//      beams (rest length), actuators (waveform target length), braces
//      (locked-node angle welds), ground position clamp.
//   4. Ground velocity response: restitution 0 + Coulomb friction.
//      The ground clamp in (3) records, per node, how far it had to push
//      the node back up this step (the normal correction, position
//      units). Friction may remove at most mu * that amount from the
//      tangential displacement: a foot grips in proportion to how hard
//      it is pressed down, and a foot being lifted (no normal push)
//      slides freely. A free node sliding on flat ground decelerates at
//      exactly mu * g, so v0^2 / (2 mu g) is the stopping distance.
// Pinned nodes have infinite mass: they never move.
//
// Solid members (m.solid): inside the relaxation loop every node that is
// not an endpoint / direct neighbour of the member is kept CONTACT_R
// away from the segment (point-segment PBD constraint, mass-weighted
// between the node and the two endpoints). The node's normal
// correction accumulates in n._cn and the last contact frame is kept in
// n._ct so step 4 can apply the same Coulomb cap and restitution-0 rule
// as the ground: a node resting on an anchored solid beam behaves
// exactly like one resting on the floor (T18 checks the closed forms).
//
// Member force (memberForce): springs report k*ext + c*vrel directly.
// For rigid members the relaxation corrections ARE the impulses the
// member applied this step: relax() returns lambda = (dist - target) /
// wsum per pass (a position-impulse), the passes are summed, and force =
// sum / dt^2. Positive = tension (member was too long, pulled its ends
// in), negative = compression. A 1 kg mass hanging on a beam reads
// exactly +9.81 N; standing on one reads -9.81 N (tests T14).

import { getNode } from './model.js';

export const FIXED_DT = 1 / 240;
export const CONTACT_R = 0.06;   // node vs solid-member contact distance, m

// Waveform value in [-1, 1]. phase is a fraction of the period (0..1).
// All shapes share the sine's timing: 0 at s=0 rising, +1 (longest) a
// quarter of the way through the "long" part, -1 (shortest) opposite.
//   sine     - smooth push / pull.
//   triangle - constant-speed back and forth.
//   smooth   - holds long, holds short, rounded transitions; `duty` is
//              the fraction of the cycle spent long. Built as tanh of a
//              duty-warped sine, so it is C-infinity and never snaps.
//   square   - legacy (pre-0.9 files load as smooth); kept for the tests.
export const WAVE_TYPES = ['sine', 'triangle', 'smooth'];
const SMOOTH_K = 3.5;
const TANH_K = Math.tanh(SMOOTH_K);

export function waveValue(w, t) {
  const period = Math.max(1e-6, w.period);
  const ph = t / period + (w.phase || 0);
  const s = ph - Math.floor(ph);
  const duty = Math.min(0.95, Math.max(0.05, w.duty ?? 0.5));
  switch (w.type) {
    case 'square': return s < duty ? 1 : -1;
    case 'triangle':
      return s < 0.25 ? 4 * s : s < 0.75 ? 2 - 4 * s : 4 * s - 4;
    case 'smooth': {
      // warp the phase so the first half-cycle (the long part) lasts `duty`
      const sp = s < duty ? s / (2 * duty) : 0.5 + (s - duty) / (2 * (1 - duty));
      return Math.tanh(SMOOTH_K * Math.sin(2 * Math.PI * sp)) / TANH_K;
    }
    default: return Math.sin(2 * Math.PI * s);
  }
}

// Current target length of a member at time t. ramp (seconds) fades the
// actuator amplitude in from t=0, so a wave whose value is nonzero at
// t=0 does not snap the rigid constraint instantly and kick the build
// off the ground (soft start).
export function targetLength(m, t, ramp = 0) {
  if (m.kind !== 'actuator' || !m.wave) return m.restLen;
  const env = ramp > 0 ? Math.min(1, t / ramp) : 1;
  const L = m.restLen * (1 + m.wave.amp * env * waveValue(m.wave, t));
  return Math.max(0.05 * m.restLen, L);
}

const invMass = n => (n.pinned ? 0 : 1 / n.mass);

function relax(a, b, target, stiff) {
  const wa = invMass(a), wb = invMass(b);
  const wsum = wa + wb;
  if (wsum === 0) return 0;
  let dx = b.x - a.x, dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-9) { dx = 1e-9; dist = 1e-9; }
  const delta = stiff * (dist - target) / dist / wsum;
  a.x += dx * delta * wa;
  a.y += dy * delta * wa;
  b.x -= dx * delta * wb;
  b.y -= dy * delta * wb;
  return delta * dist;     // lambda: position-impulse, +ve = tension
}

// Axial force through a member after the last step, Newtons.
// Positive = tension, negative = compression. 0 before the first step.
export function memberForce(m) {
  return m._f || 0;
}

// Advance the world by one fixed step of dt seconds.
export function step(state, dt = FIXED_DT) {
  const W = state.world;
  const nodes = state.nodes;
  state.t += dt;
  const t = state.t;

  // --- 1. spring forces -> per-node accelerations --------------------------
  for (const n of nodes) { n._fx = 0; n._fy = 0; }
  for (const m of state.members) m._lam = 0;
  for (const m of state.members) {
    if (m.kind !== 'spring') continue;
    const a = getNode(state, m.a), b = getNode(state, m.b);
    if (!a || !b) continue;
    let dx = b.x - a.x, dy = b.y - a.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 1e-9) continue;
    const ux = dx / dist, uy = dy / dist;
    const ext = dist - m.restLen;
    // relative velocity of b w.r.t. a along the axis (verlet velocities)
    const vax = (a.x - a.px) / dt, vay = (a.y - a.py) / dt;
    const vbx = (b.x - b.px) / dt, vby = (b.y - b.py) / dt;
    const vrel = (vbx - vax) * ux + (vby - vay) * uy;
    const f = m.k * ext + m.c * vrel;   // >0 pulls the ends together
    m._f = f;                            // spring force = tension (+) / compression (-)
    a._fx += f * ux; a._fy += f * uy;
    b._fx -= f * ux; b._fy -= f * uy;
  }

  // --- 2. verlet integration ----------------------------------------------
  const g = W.gravityOn ? W.gravity : 0;
  const dragK = Math.max(0, 1 - W.drag * dt);
  for (const n of nodes) {
    if (n.pinned) { n.px = n.x; n.py = n.y; continue; }
    const vx = (n.x - n.px) * dragK;
    const vy = (n.y - n.py) * dragK;
    const ax = n._fx / n.mass;
    const ay = n._fy / n.mass - g;
    n.px = n.x; n.py = n.y;
    n.x += vx + ax * dt * dt;
    n.y += vy + ay * dt * dt;
  }

  // --- 3. constraint relaxation -------------------------------------------
  const iters = Math.max(1, W.iterations | 0);
  const gy = W.groundY;
  for (const n of nodes) { n._gn = 0; n._cn = 0; n._ct = null; }
  // solid members: exclusion sets (endpoints + their direct neighbours)
  let solids = null;
  for (const m of state.members) {
    if (!m.solid) continue;
    if (!solids) solids = [];
    const ex = new Set([m.a, m.b]);
    for (const o of state.members) {
      if (o.a === m.a || o.a === m.b) ex.add(o.b);
      if (o.b === m.a || o.b === m.b) ex.add(o.a);
    }
    solids.push({ m, ex });
  }
  for (let it = 0; it < iters; it++) {
    for (const m of state.members) {
      if (m.kind === 'spring') continue;
      const a = getNode(state, m.a), b = getNode(state, m.b);
      if (!a || !b) continue;
      m._lam += relax(a, b, targetLength(m, t, W.actuatorRamp), 1);
    }
    for (const br of state.braces) {
      const a = getNode(state, br.a), b = getNode(state, br.b);
      if (!a || !b) continue;
      relax(a, b, br.len, 1);
    }
    if (solids) {
      for (const { m, ex } of solids) {
        const a = getNode(state, m.a), b = getNode(state, m.b);
        if (!a || !b) continue;
        for (const n of nodes) {
          if (ex.has(n.id) || n.pinned) continue;
          collideNodeSegment(n, a, b);
        }
      }
    }
    for (const n of nodes) {
      if (!n.pinned && n.y < gy) { n._gn += gy - n.y; n.y = gy; }
    }
  }

  // rigid members: summed position-impulse -> force
  const invDt2 = 1 / (dt * dt);
  for (const m of state.members) {
    if (m.kind !== 'spring') m._f = m._lam * invDt2;
  }

  // --- 4b. solid-member contact response (same rules as the ground) --------
  const mu0 = Math.max(0, W.friction);
  for (const n of nodes) {
    const c = n._ct;
    if (!c || n.pinned) continue;
    // relative displacement vs the contact point on the segment this step
    const rvx = (n.x - n.px) - c.svx, rvy = (n.y - n.py) - c.svy;
    const vn = rvx * c.nx + rvy * c.ny;
    // restitution 0: kill the relative normal velocity with a mass-
    // weighted impulse shared by the node and the beam's endpoints
    // (perfectly inelastic - momentum is conserved, T18e)
    const J = vn / c.denom;
    n.px += c.wn * J * c.nx; n.py += c.wn * J * c.ny;
    c.a.px -= c.wa * (1 - c.t) * J * c.nx; c.a.py -= c.wa * (1 - c.t) * J * c.ny;
    c.b.px -= c.wb * c.t * J * c.nx;       c.b.py -= c.wb * c.t * J * c.ny;
    // Coulomb: tangential correction capped at mu * normal correction
    const tx = -c.ny, ty = c.nx;
    const vt = rvx * tx + rvy * ty;
    const cut = Math.min(Math.abs(vt), mu0 * n._cn);
    n.x -= Math.sign(vt) * cut * tx;
    n.y -= Math.sign(vt) * cut * ty;
  }

  // --- 4. ground velocity response ----------------------------------------
  // Coulomb: the tangential displacement removed this step is capped at
  // mu * normal correction. Below the cap the node sticks (static
  // friction); above it, it slides while shedding mu * g of speed per
  // second (kinetic). No normal push (foot lifting) = no grip.
  const mu = Math.max(0, W.friction);
  for (const n of nodes) {
    if (n.pinned) continue;
    if (n.y <= gy + 1e-6) {
      n.py = n.y;                       // restitution 0
      const vt = n.x - n.px;            // tangential displacement this step
      const cut = Math.min(Math.abs(vt), mu * n._gn);
      // position correction, not just a velocity kill: moving x back also
      // undoes this step's displacement, so a planted foot under a gentle
      // side load truly holds instead of creeping by a*dt^2 every step.
      n.x -= Math.sign(vt) * cut;
    }
  }
  return state;
}

// Keep node n at least CONTACT_R from segment a-b (point-segment PBD).
// Mass-weighted: a heavy node pushes a light beam aside. Records the
// node's normal correction (n._cn) and contact frame (n._ct) for the
// friction / restitution pass.
function collideNodeSegment(n, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return;
  let t = ((n.x - a.x) * dx + (n.y - a.y) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx, cy = a.y + t * dy;
  let ex = n.x - cx, ey = n.y - cy;
  const dist = Math.hypot(ex, ey);
  if (dist >= CONTACT_R) return;
  let nx, ny;
  if (dist > 1e-9) { nx = ex / dist; ny = ey / dist; }
  else {
    // exactly on the line: push toward the side the node came from
    const len = Math.sqrt(l2);
    nx = -dy / len; ny = dx / len;
    const side = (n.px - cx) * nx + (n.py - cy) * ny;
    if (side < 0) { nx = -nx; ny = -ny; }
  }
  const wn = invMass(n), wa = invMass(a), wb = invMass(b);
  const denom = wn + wa * (1 - t) * (1 - t) + wb * t * t;
  if (denom === 0) return;
  const lam = (CONTACT_R - dist) / denom;
  n.x += wn * lam * nx; n.y += wn * lam * ny;
  a.x -= wa * (1 - t) * lam * nx; a.y -= wa * (1 - t) * lam * ny;
  b.x -= wb * t * lam * nx; b.y -= wb * t * lam * ny;
  n._cn += wn * lam;
  n._ct = {
    nx, ny, a, b, t, wn, wa, wb, denom,
    // velocity (per step) of the contact point on the segment
    svx: (a.x - a.px) * (1 - t) + (b.x - b.px) * t,
    svy: (a.y - a.py) * (1 - t) + (b.y - b.py) * t,
  };
}

// Run n fixed steps.
export function run(state, n, dt = FIXED_DT) {
  for (let i = 0; i < n; i++) step(state, dt);
  return state;
}

// Kinetic + potential energy (diagnostics / tests).
export function energy(state, dt = FIXED_DT) {
  const W = state.world;
  let e = 0;
  const g = W.gravityOn ? W.gravity : 0;
  for (const n of state.nodes) {
    if (n.pinned) continue;
    const vx = (n.x - n.px) / dt, vy = (n.y - n.py) / dt;
    e += 0.5 * n.mass * (vx * vx + vy * vy) + n.mass * g * (n.y - W.groundY);
  }
  for (const m of state.members) {
    if (m.kind !== 'spring') continue;
    const a = getNode(state, m.a), b = getNode(state, m.b);
    const ext = Math.hypot(b.x - a.x, b.y - a.y) - m.restLen;
    e += 0.5 * m.k * ext * ext;
  }
  return e;
}
