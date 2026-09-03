// TrussForge engine - built-in demo builds.
// HEADLESS: shared by the Node test suite and the web UI.

import { createState, addNode, addMember, reset, chain } from './model.js';
import { CONTACT_R } from './sim.js';

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
  s.name = 'Walker';
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
  s.name = 'Merry-go-round';
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
  s.name = 'Hopper';
  reset(s);
  return s;
}

// A Warren truss bridge over a 4 m gap: bottom chord at y = 1, top chord
// 0.8 m up, zig-zag diagonals. Left end anchored; right end hangs from a
// short link off an anchored pier - a rocker bearing, so the span is
// simply supported. (Anchoring BOTH ends makes it a two-hinged arch: the
// abutments push inward and the end bays of the bottom chord go into
// compression - T15b caught that.) A 4 kg load pumps at mid-span on a
// slow actuator so the stress pattern breathes. Meant for the force
// view: bottom chord red (tension), top chord blue (compression),
// diagonals alternating - the textbook picture.
export function bridge() {
  const s = createState();
  const y0 = 1.0, h = 0.8, bay = 1.0, bays = 4;
  const bot = [], top = [];
  for (let i = 0; i <= bays; i++) {
    bot.push(addNode(s, i * bay, y0, { pinned: i === 0, mass: 0.5 }));
  }
  for (let i = 0; i < bays; i++) {
    top.push(addNode(s, (i + 0.5) * bay, y0 + h, { mass: 0.5 }));
  }
  for (let i = 0; i < bays; i++) addMember(s, bot[i], bot[i + 1], 'beam');   // bottom chord
  for (let i = 0; i < bays - 1; i++) addMember(s, top[i], top[i + 1], 'beam'); // top chord
  for (let i = 0; i < bays; i++) {                                           // diagonals
    addMember(s, bot[i], top[i], 'beam');
    addMember(s, top[i], bot[i + 1], 'beam');
  }
  // rocker bearing: the right end hangs from an anchored pier top
  const pier = addNode(s, bays * bay, y0 + 0.5, { pinned: true });
  addMember(s, pier, bot[bays], 'beam');
  const mid = bot[bays / 2];
  const load = addNode(s, mid.x, mid.y - 0.6, { mass: 4 });
  addMember(s, mid, load, 'actuator', {
    wave: { type: 'sine', amp: 0.3, period: 1.6, phase: 0 },
  });
  s.name = 'Bridge';
  reset(s);
  return s;
}

// A chain hung from an anchor with a 2 kg bob, laid out straight over an
// anchored SOLID bar. The bob falls, the chain bends over the bar's end
// and hangs from it - chains wrap over solid members.
export function chainDemo() {
  const s = createState();
  const P = addNode(s, 0.2, 1.8, { pinned: true });
  const bob = addNode(s, 2.3, 1.8, { mass: 2 });
  chain(s, P, bob, 14);
  const l = addNode(s, 0.6, 1.2, { pinned: true });
  const r = addNode(s, 1.6, 1.2, { pinned: true });
  addMember(s, l, r, 'beam', { solid: true });
  s.name = 'Chain';
  reset(s);
  return s;
}

// Inchworm: three walker cells in a row sharing feet (a base muscle and
// two leg muscles per hump), phases lagging 0.2 of a cycle per segment
// so a wave of contraction travels along the body. Tuned by sweep
// (2026-09-03): forward for grip 0.4-1.2 (13-18 m in 20 s), feet on the
// ground, no hopping.
export function inchworm() {
  const s = createState();
  const S = 3, d = 0.6, h = 0.45, P = 0.7, aBase = 0.32, aLeg = 0.2, D = 0.2;
  const feet = [];
  for (let i = 0; i <= S; i++) feet.push(addNode(s, i * d, 0));
  for (let i = 0; i < S; i++) {
    const top = addNode(s, (i + 0.5) * d, h);
    const ph = x => ((x + i * D) % 1 + 1) % 1;
    addMember(s, feet[i], feet[i + 1], 'actuator', { wave: { type: 'sine', amp: aBase, period: P, phase: ph(0) } });
    addMember(s, feet[i], top, 'actuator', { wave: { type: 'sine', amp: aLeg, period: P, phase: ph(0.05) } });
    addMember(s, feet[i + 1], top, 'actuator', { wave: { type: 'sine', amp: aLeg, period: P, phase: ph(0.6) } });
  }
  s.world.friction = 0.7;
  s.name = 'Inchworm';
  reset(s);
  return s;
}

// Catapult: a straight SOLID arm (tail - welded, anchored pivot - tip),
// an 8 kg counterweight hung from the tail, a 0.3 kg ball resting on the
// arm near the tip, and an anchored solid stop bar across the tip's path
// at 45 degrees. Press Run: the weight drops, the arm swings up, the tip
// slams the stop and the ball keeps going (2.5 m apex, ~2.9 m throw).
// Tuned by sweep (2026-09-03): a heavier weight / steeper cock just
// slides the ball off early.
export function catapult() {
  const s = createState();
  const px = 2.0, py = 1.2, armTip = 1.6, armTail = 0.7, theta = -25 * Math.PI / 180;
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const pivot = addNode(s, px, py, { pinned: true, locked: true });
  const tip = addNode(s, px + armTip * ux, py + armTip * uy, { mass: 0.5 });
  const tail = addNode(s, px - armTail * ux, py - armTail * uy, { mass: 0.5 });
  addMember(s, tail, pivot, 'beam', { solid: true });
  addMember(s, pivot, tip, 'beam', { solid: true });
  const weight = addNode(s, tail.x, tail.y - 0.35, { mass: 8 });
  addMember(s, tail, weight, 'beam');
  // the ball sits on top of the arm, a contact radius above it
  let nx = -uy, ny = ux; if (ny < 0) { nx = -nx; ny = -ny; }
  const at = 1.45;
  addNode(s, px + at * ux + nx * (CONTACT_R + 0.004), py + at * uy + ny * (CONTACT_R + 0.004), { mass: 0.3 });
  // stop bar across the tip's circle at 45 degrees
  const sa = 45 * Math.PI / 180;
  const sx = px + armTip * Math.cos(sa), sy = py + armTip * Math.sin(sa);
  const tx = -Math.sin(sa), ty = Math.cos(sa);
  const b1 = addNode(s, sx + 0.25 * ty, sy - 0.25 * tx, { pinned: true });
  const b2 = addNode(s, sx - 0.25 * ty, sy + 0.25 * tx, { pinned: true });
  addMember(s, b1, b2, 'beam', { solid: true });
  s.name = 'Catapult';
  reset(s);
  return s;
}

export const DEMOS = { walker, hopper, inchworm, bridge, catapult, merry, chain: chainDemo };

// UI hints per demo (the engine ignores these).
export const DEMO_HINTS = {
  walker: { follow: true, status: 'Walker: three muscles, phased. Press Run.' },
  hopper: { follow: true, status: 'Hopper: same body, driven hard. Press Run.' },
  bridge: { forceView: true, status: 'Bridge: red members pull, blue members push. Tap one for its force.' },
  merry: { status: 'Merry-go-round: anchored, welded hub. Press Run.' },
  chain: { status: 'Chain: 14 links over a solid bar. Press Run and watch it wrap.' },
  inchworm: { follow: true, status: 'Inchworm: three humps, a wave of contraction runs down the body. Press Run.' },
  catapult: { status: 'Catapult: press Run. The weight drops, the arm hits the stop, the ball flies.' },
};
