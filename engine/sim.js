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
//   4. Ground velocity response: restitution 0 + Coulomb-ish friction
//      (fraction of tangential velocity removed per contact step).
// Pinned nodes have infinite mass: they never move.

import { getNode } from './model.js';

export const FIXED_DT = 1 / 240;

// Waveform value in [-1, 1]. phase is a fraction of the period (0..1).
export function waveValue(w, t) {
  const period = Math.max(1e-6, w.period);
  const ph = t / period + (w.phase || 0);
  const s = ph - Math.floor(ph);
  if (w.type === 'square') return s < (w.duty ?? 0.5) ? 1 : -1;
  return Math.sin(2 * Math.PI * s);
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
  if (wsum === 0) return;
  let dx = b.x - a.x, dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-9) { dx = 1e-9; dist = 1e-9; }
  const delta = stiff * (dist - target) / dist / wsum;
  a.x += dx * delta * wa;
  a.y += dy * delta * wa;
  b.x -= dx * delta * wb;
  b.y -= dy * delta * wb;
}

// Advance the world by one fixed step of dt seconds.
export function step(state, dt = FIXED_DT) {
  const W = state.world;
  const nodes = state.nodes;
  state.t += dt;
  const t = state.t;

  // --- 1. spring forces -> per-node accelerations --------------------------
  for (const n of nodes) { n._fx = 0; n._fy = 0; }
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
  for (let it = 0; it < iters; it++) {
    for (const m of state.members) {
      if (m.kind === 'spring') continue;
      const a = getNode(state, m.a), b = getNode(state, m.b);
      if (!a || !b) continue;
      relax(a, b, targetLength(m, t, W.actuatorRamp), 1);
    }
    for (const br of state.braces) {
      const a = getNode(state, br.a), b = getNode(state, br.b);
      if (!a || !b) continue;
      relax(a, b, br.len, 1);
    }
    for (const n of nodes) {
      if (!n.pinned && n.y < gy) n.y = gy;
    }
  }

  // --- 4. ground velocity response ----------------------------------------
  // slip = fraction of tangential velocity removed this step; W.friction is
  // the fraction removed per 1/60 s of continuous contact (0..1).
  const f = Math.min(1, Math.max(0, W.friction));
  const slip = f >= 1 ? 1 : 1 - Math.pow(1 - f, dt * 60);
  for (const n of nodes) {
    if (n.pinned) continue;
    if (n.y <= gy + 1e-6) {
      n.py = n.y;                       // restitution 0
      const vtx = n.x - n.px;
      n.px = n.x - vtx * (1 - slip);    // kill part of tangential velocity
    }
  }
  return state;
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
