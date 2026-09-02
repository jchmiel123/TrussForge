// TrussForge engine - built-in demo builds.
// HEADLESS: shared by the Node test suite and the web UI.

import { createState, addNode, addMember, reset } from './model.js';

// A small crawling creature: a triangle of three actuators (two legs and a
// stride muscle) phased a quarter-period apart, plus a beam head for charm.
// The gait: the stride lengthens while the back foot is planted and the
// front leg is lifting, then shortens while the front foot is planted.
export function walker() {
  const s = createState();
  const B = addNode(s, 0.0, 0.0);      // back foot
  const F = addNode(s, 0.9, 0.0);      // front foot
  const T = addNode(s, 0.45, 0.78);    // top / hip
  const H = addNode(s, 1.18, 0.62);    // head
  // Gait re-tuned by sweep for Coulomb friction (0.3.0, 2026-09-01):
  // period 0.8 s, stride amp 0.30, leg amp 0.18, phases 0 / 0.05 / 0.6.
  // Crawls forward (+x) for grip 0.3-2.0 (4.5 m .. 15.5 m in 20 s, faster
  // on grippier floors), feet lift < 0.31 m, airborne < 2 % of the time.
  // The earlier gait (P 1.0, phases 0 / 0.25 / 0.5) reversed below mu 0.5.
  const P = 0.8;                       // gait period, seconds
  addMember(s, B, F, 'actuator', { wave: { type: 'sine', amp: 0.30, period: P, phase: 0.0 } });
  addMember(s, B, T, 'actuator', { wave: { type: 'sine', amp: 0.18, period: P, phase: 0.05 } });
  addMember(s, F, T, 'actuator', { wave: { type: 'sine', amp: 0.18, period: P, phase: 0.6 } });
  addMember(s, F, H, 'beam');
  addMember(s, T, H, 'beam');
  s.world.friction = 0.7;
  reset(s);
  return s;
}

// A pinned toy: rigid rotor (pinned + locked hub, 4 locked spokes, rim
// beams) with a bob hanging from one rim node on an actuator. The pumping
// bob rocks the wheel around its pin.
export function merry() {
  const s = createState();
  const cx = 0, cy = 1.6, r = 0.6;
  const hub = addNode(s, cx, cy, { pinned: true, locked: true });
  const rim = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;   // 45, 135, 225, 315 deg
    rim.push(addNode(s, cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  for (const n of rim) addMember(s, hub, n, 'beam');           // spokes
  for (let i = 0; i < 4; i++) addMember(s, rim[i], rim[(i + 1) % 4], 'beam'); // rim
  // bob hanging from the lower-right rim node (315 deg = rim[3])
  const anchor = rim[3];
  const bob = addNode(s, anchor.x, anchor.y - 0.65, { mass: 2 });
  addMember(s, anchor, bob, 'actuator', {
    wave: { type: 'sine', amp: 0.3, period: 0.9, phase: 0 },
  });
  s.world.friction = 0.6;
  reset(s);
  return s;
}

// Same body as the walker, driven hard and fast: a bounding hop that is
// airborne ~60 % of the time. Found by the same sweep; forward for grip
// 0.2-2.0 (13-35 m in 20 s). Shows off load-proportional friction: it
// only pushes off while a foot is pressed down.
export function hopper() {
  const s = createState();
  const B = addNode(s, 0.0, 0.0);
  const F = addNode(s, 0.9, 0.0);
  const T = addNode(s, 0.45, 0.78);
  const H = addNode(s, 1.18, 0.62);
  const P = 0.6;
  addMember(s, B, F, 'actuator', { wave: { type: 'sine', amp: 0.34, period: P, phase: 0.0 } });
  addMember(s, B, T, 'actuator', { wave: { type: 'sine', amp: 0.20, period: P, phase: 0.05 } });
  addMember(s, F, T, 'actuator', { wave: { type: 'sine', amp: 0.20, period: P, phase: 0.6 } });
  addMember(s, F, H, 'beam');
  addMember(s, T, H, 'beam');
  s.world.friction = 0.7;
  reset(s);
  return s;
}

export const DEMOS = { walker, hopper, merry };
