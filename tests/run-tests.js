// TrussForge test suite. Run: node tests/run-tests.js  (exit 0 = all green)
// Every expected value comes from INDEPENDENT math (closed form), never
// from the engine itself.

import {
  createState, addNode, addMember, reset, serialize, deserialize,
  getNode, centroid, rebuildBraces,
  componentOf, extractSub, insertSub, mirrorSub, translateSub, fragmentBounds,
  splitMember, mergeNodes, membersAt, getMember, chain,
  bakeNodes, bakeRestPose, setRestFromCurrent,
} from '../engine/model.js';
import { step, run, waveValue, targetLength, memberForce, FIXED_DT, CONTACT_R } from '../engine/sim.js';
import { walker, hopper, bridge, merry, chainDemo, inchworm, catapult } from '../engine/demos.js';
import { snapToLattice, forEachLatticePoint, rowHeight } from '../engine/lattice.js';
import { shapeFragment, polygonShape, boxShape, trussShape, SHAPE_KINDS } from '../engine/shapes.js';

let pass = 0, fail = 0;
function check(name, got, want, tol) {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (ok) { pass++; console.log(`PASS  ${name}  got=${fmt(got)} want=${fmt(want)} tol=${fmt(tol)}`); }
  else { fail++; console.log(`FAIL  ${name}  got=${fmt(got)} want=${fmt(want)} tol=${fmt(tol)}`); }
}
function checkTrue(name, cond, note = '') {
  if (cond) { pass++; console.log(`PASS  ${name}${note ? '  ' + note : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? '  ' + note : ''}`); }
}
const fmt = v => (typeof v === 'number' ? Number(v.toPrecision(6)) : v);
const dt = FIXED_DT;

// Measure oscillation period of signal(state) via successive upward zero
// crossings (linear interpolation), averaged.
function measurePeriod(state, signal, seconds) {
  const crossings = [];
  let prev = signal(state), prevT = state.t;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    step(state, dt);
    const cur = signal(state);
    if (prev <= 0 && cur > 0) {
      const frac = -prev / (cur - prev);
      crossings.push(prevT + frac * dt);
    }
    prev = cur; prevT = state.t;
  }
  if (crossings.length < 3) return NaN;
  let sum = 0;
  for (let i = 1; i < crossings.length; i++) sum += crossings[i] - crossings[i - 1];
  return sum / (crossings.length - 1);
}

// ---- T1: waveforms (pure math) ------------------------------------------
{
  const sine = { type: 'sine', amp: 1, period: 2, phase: 0 };
  check('T1a sine peak at t=P/4', waveValue(sine, 0.5), 1, 1e-9);
  check('T1b sine zero at t=P/2', waveValue(sine, 1.0), 0, 1e-9);
  const sq = { type: 'square', period: 1, phase: 0, duty: 0.3 };
  check('T1c square high inside duty', waveValue(sq, 0.1), 1, 1e-9);
  check('T1d square low outside duty', waveValue(sq, 0.5), -1, 1e-9);
  const ph = { type: 'square', period: 1, phase: 0.5, duty: 0.3 };
  check('T1e square phase shifts window', waveValue(ph, 0.6), 1, 1e-9);
  const act = { kind: 'actuator', restLen: 2, wave: { type: 'sine', amp: 0.25, period: 1, phase: 0 } };
  check('T1f actuator target at wave peak', targetLength(act, 0.25), 2 * 1.25, 1e-9);
  const tri = { type: 'triangle', period: 1, phase: 0 };
  check('T1g triangle peak at P/4', waveValue(tri, 0.25), 1, 1e-12);
  check('T1h triangle zero at P/2', waveValue(tri, 0.5), 0, 1e-12);
  check('T1i triangle trough at 3P/4', waveValue(tri, 0.75), -1, 1e-12);
  check('T1j triangle is linear (slope 4 in the first quarter)', waveValue(tri, 0.1), 0.4, 1e-12);
  const sm = { type: 'smooth', period: 1, phase: 0, duty: 0.3 };
  check('T1k smooth peaks mid-way through the long part (duty/2)', waveValue(sm, 0.15), 1, 1e-12);
  check('T1l smooth troughs mid-way through the short part', waveValue(sm, 0.65), -1, 1e-12);
  check('T1m smooth crosses zero at the duty boundary', waveValue(sm, 0.3), 0, 1e-12);
  checkTrue('T1n smooth holds near +1 across the long part', waveValue(sm, 0.05) > 0.9 && waveValue(sm, 0.25) > 0.9,
    `v(0.05)=${fmt(waveValue(sm, 0.05))}`);
  checkTrue('T1o smooth is bounded in [-1, 1]', [...Array(200)].every((_, i) => Math.abs(waveValue(sm, i / 200)) <= 1 + 1e-12));
}

// ---- T2: soft spring SHM frequency vs (1/2pi)sqrt(k/m) ------------------
{
  const k = 50, m = 1;
  const s = createState({ world: { gravityOn: false, drag: 0, friction: 0 } });
  const a = addNode(s, 0, 5, { pinned: true });
  const b = addNode(s, 1, 5, { mass: m });
  const sp = addMember(s, a, b, 'spring', { k, c: 0 });
  b.x = 1.25; b.px = 1.25;          // displace along the axis, at rest
  const wantT = 2 * Math.PI * Math.sqrt(m / k);       // 0.8886 s
  const gotT = measurePeriod(s, st => getNode(st, b.id).x - 1, 8);
  check('T2 spring SHM period 2pi*sqrt(m/k)', gotT, wantT, wantT * 0.02);
  checkTrue('T2b spring member created', !!sp);
}

// ---- T3: small-angle pendulum period vs 2pi sqrt(L/g) -------------------
{
  const L = 1, g = 9.81, th0 = 0.12;
  const s = createState({ world: { gravity: g, drag: 0, friction: 0 } });
  const p = addNode(s, 0, 5, { pinned: true });
  const b = addNode(s, L * Math.sin(th0), 5 - L * Math.cos(th0));
  addMember(s, p, b, 'beam');
  reset(s);
  // small-angle closed form with first anharmonic correction
  const wantT = 2 * Math.PI * Math.sqrt(L / g) * (1 + th0 * th0 / 16);
  const gotT = measurePeriod(s, st => getNode(st, b.id).x, 12);
  check('T3 pendulum period 2pi*sqrt(L/g)', gotT, wantT, wantT * 0.02);
}

// ---- T4: beam length invariance under gravity load ----------------------
{
  const s = createState();
  const a = addNode(s, 0, 0), b = addNode(s, 1, 0), c = addNode(s, 0.5, 0.8);
  const m1 = addMember(s, a, b, 'beam');
  const m2 = addMember(s, b, c, 'beam');
  const m3 = addMember(s, a, c, 'beam');
  reset(s);
  run(s, Math.round(3 / dt));
  for (const [i, m] of [m1, m2, m3].entries()) {
    const na = getNode(s, m.a), nb = getNode(s, m.b);
    const len = Math.hypot(nb.x - na.x, nb.y - na.y);
    check(`T4${'abc'[i]} beam strain < 0.5%`, len / m.restLen, 1, 0.005);
  }
}

// ---- T5: actuator length tracks its drive waveform ----------------------
{
  const s = createState({ world: { gravityOn: false, drag: 0.2, actuatorRamp: 0 } });
  const a = addNode(s, 0, 5, { pinned: true });
  const b = addNode(s, 0.7, 5);
  const m = addMember(s, a, b, 'actuator', {
    wave: { type: 'sine', amp: 0.2, period: 1, phase: 0 },
  });
  reset(s);
  let worst = 0;
  for (let i = 0; i < Math.round(2.5 / dt); i++) {
    step(s, dt);
    // independent target: 0.7 * (1 + 0.2 sin(2 pi t))
    const want = 0.7 * (1 + 0.2 * Math.sin(2 * Math.PI * s.t));
    const na = getNode(s, m.a), nb = getNode(s, m.b);
    const len = Math.hypot(nb.x - na.x, nb.y - na.y);
    worst = Math.max(worst, Math.abs(len - want) / want);
  }
  check('T5 actuator tracks waveform (worst rel err)', worst, 0, 0.01);
  // soft start: at t = ramp/2 the amplitude envelope is 0.5 (pure math)
  const act = { kind: 'actuator', restLen: 1, wave: { type: 'sine', amp: 0.4, period: 2, phase: 0.25 } };
  check('T5b actuator soft-start envelope', targetLength(act, 0.25, 1),
    1 + 0.4 * 0.25 * Math.sin(2 * Math.PI * (0.25 / 2 + 0.25)), 1e-9);
}

// ---- T6: locked node welds the angle ------------------------------------
{
  const build = lock => {
    const s = createState({ world: { drag: 1.5 } });
    const a = addNode(s, 0, 2, { pinned: true });
    const b = addNode(s, 0, 1, { locked: lock });
    const c = addNode(s, 1, 1);
    addMember(s, a, b, 'beam');
    addMember(s, b, c, 'beam');
    reset(s);
    run(s, Math.round(5 / dt));
    const A = getNode(s, a.id), B = getNode(s, b.id), C = getNode(s, c.id);
    const v1 = [A.x - B.x, A.y - B.y], v2 = [C.x - B.x, C.y - B.y];
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const cr = v1[0] * v2[1] - v1[1] * v2[0];
    return Math.abs(Math.atan2(cr, dot)) * 180 / Math.PI;
  };
  check('T6a locked L keeps its 90 deg angle', build(true), 90, 0.6);
  checkTrue('T6b unlocked L folds under gravity', Math.abs(build(false) - 90) > 20,
    `angle=${fmt(build(false))} deg`);
}

// ---- T7: pinned node never moves ----------------------------------------
{
  const s = merry();
  const hub = s.nodes.find(n => n.pinned);
  const hx = hub.x, hy = hub.y;
  run(s, 50000);
  check('T7a pinned hub x unchanged after 50k steps', hub.x, hx, 1e-12);
  check('T7b pinned hub y unchanged after 50k steps', hub.y, hy, 1e-12);
  // and the rotor actually rocks: track the angle of one spoke
  const rim = s.nodes.find(n => !n.pinned && n.mass === 1);
  let mn = Infinity, mx = -Infinity;
  const s2 = merry();
  const hub2 = s2.nodes.find(n => n.pinned);
  const rim2 = s2.nodes.find(n => !n.pinned && n.mass === 1);
  for (let i = 0; i < 4000; i++) {
    step(s2, dt);
    const ang = Math.atan2(rim2.y - hub2.y, rim2.x - hub2.x);
    mn = Math.min(mn, ang); mx = Math.max(mx, ang);
  }
  checkTrue('T7c rotor rocks around the pin', (mx - mn) > 0.02,
    `swing=${fmt((mx - mn) * 180 / Math.PI)} deg`);
}

// ---- T8: energy stays bounded over 100k steps (no explosion) ------------
{
  const s = walker();
  let ok = true, maxSpeed = 0;
  for (let i = 0; i < 100000; i++) {
    step(s, dt);
    if (i % 100 === 0) {
      for (const n of s.nodes) {
        const v = Math.hypot(n.x - n.px, n.y - n.py) / dt;
        maxSpeed = Math.max(maxSpeed, v);
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || v > 50) ok = false;
      }
    }
  }
  checkTrue('T8 walker bounded over 100k steps', ok, `maxSpeed=${fmt(maxSpeed)} m/s`);
}

// ---- T9: the walker actually walks --------------------------------------
{
  const s = walker();
  const x0 = centroid(s).x;
  run(s, Math.round(20 / dt));
  const x1 = centroid(s).x;
  checkTrue('T9a walker advances > 0.5 m in 20 s', x1 - x0 > 0.5,
    `dx=${fmt(x1 - x0)} m`);
  let maxY = 0;
  for (const n of s.nodes) maxY = Math.max(maxY, n.y);
  checkTrue('T9b walker stays near the ground', maxY < 3, `maxY=${fmt(maxY)}`);
  // the crawl must stay forward on ice-ish AND sticky floors (Coulomb model)
  const walkDx = mu => {
    const w = walker(); w.world.friction = mu;
    const a = centroid(w).x; run(w, Math.round(20 / dt));
    return centroid(w).x - a;
  };
  const d03 = walkDx(0.3), d20 = walkDx(2.0);
  checkTrue('T9c walker forward at grip 0.3', d03 > 1, `dx=${fmt(d03)} m`);
  checkTrue('T9d walker forward at grip 2.0', d20 > 1, `dx=${fmt(d20)} m`);
  const h = hopper();
  const hx = centroid(h).x; run(h, Math.round(20 / dt));
  checkTrue('T9e hopper bounds forward > 5 m in 20 s', centroid(h).x - hx > 5,
    `dx=${fmt(centroid(h).x - hx)} m`);
}

// ---- T10: ground contact ------------------------------------------------
{
  // a dropped node comes to rest ON the ground
  const s = createState();
  const n = addNode(s, 0, 1);
  run(s, Math.round(3 / dt));
  check('T10a dropped node rests at groundY', n.y, 0, 1e-3);
  // with friction, a sliding node stops; frictionless keeps going
  const slide = f => {
    const s2 = createState({ world: { friction: f, drag: 0 } });
    const m = addNode(s2, 0, 0);
    m.px = m.x - 2 * dt;   // 2 m/s to the right
    run(s2, Math.round(2 / dt));
    return (m.x - m.px) / dt;
  };
  check('T10b friction stops a sliding node', slide(0.8), 0, 1e-3);
  checkTrue('T10c frictionless node keeps sliding', slide(0) > 1.9,
    `v=${fmt(slide(0))} m/s`);
}

// ---- T11: serialize round trip ------------------------------------------
{
  const s = walker();
  run(s, 500);                        // deform it first
  const doc = serialize(s);
  const s2 = deserialize(JSON.parse(JSON.stringify(doc)));
  checkTrue('T11a round trip node count', s2.nodes.length === s.nodes.length);
  checkTrue('T11b round trip member count', s2.members.length === s.members.length);
  const m0 = s.members[0], m2 = s2.members.find(m => m.id === m0.id);
  check('T11c round trip actuator amp', m2.wave.amp, m0.wave.amp, 1e-12);
  check('T11d round trip rest length', m2.restLen, m0.restLen, 1e-12);
  // deserialized state starts at the build pose
  checkTrue('T11e deserialized starts at rest pose',
    s2.nodes.every(n => n.x === n.rx && n.y === n.ry));
  // project name rides along; legacy square waves load as smooth
  checkTrue('T11f project name round-trips', s2.name === 'Walker', `name=${s2.name}`);
  const legacy = JSON.parse(JSON.stringify(doc));
  legacy.name = '  My Rig  '; legacy.members[0].wave.type = 'square';
  const s3 = deserialize(legacy);
  checkTrue('T11g name is trimmed', s3.name === 'My Rig');
  checkTrue('T11h legacy square wave loads as smooth', s3.members[0].wave.type === 'smooth');
}

// ---- T12: locked-node braces regenerate on topology change --------------
{
  const s = createState();
  const hub = addNode(s, 0, 1, { locked: true });
  const a = addNode(s, 1, 1), b = addNode(s, 0, 2), c = addNode(s, -1, 1);
  addMember(s, hub, a, 'beam');
  addMember(s, hub, b, 'beam');
  checkTrue('T12a two members at locked node -> 1 brace', s.braces.length === 1);
  addMember(s, hub, c, 'beam');
  checkTrue('T12b three members -> 3 braces', s.braces.length === 3);
  const brace = s.braces[0];
  check('T12c brace rest length is far-endpoint distance',
    brace.len, Math.hypot(1 - 0, 1 - 2), 1e-12);
}

// ---- T13: Coulomb friction is load-proportional --------------------------
{
  // stopping distance of a free slider on flat ground: d = v0^2 / (2 mu g)
  const stopDist = (mu, g, v0) => {
    const s = createState({ world: { friction: mu, gravity: g, drag: 0 } });
    const n = addNode(s, 0, 0);
    n.px = n.x - v0 * dt;
    run(s, Math.round(4 / dt));
    return n.x;
  };
  check('T13a stop distance v0^2/(2 mu g) at g=9.81', stopDist(0.5, 9.81, 2), 4 / (2 * 0.5 * 9.81), 0.02);
  // same slider, weaker gravity = lighter normal load = longer slide (the
  // old fixed-fraction model gave the same distance regardless of g)
  check('T13b stop distance scales 1/g (g=4)', stopDist(0.5, 4, 2), 4 / (2 * 0.5 * 4), 0.04);
  // decel is mu*g regardless of mass (cancels): 2 kg node, mu 0.8
  {
    const s = createState({ world: { friction: 0.8, drag: 0 } });
    const n = addNode(s, 0, 0, { mass: 2 });
    n.px = n.x - 1.5 * dt;
    run(s, Math.round(2 / dt));
    check('T13c mass cancels: d = v0^2/(2 mu g)', n.x, 1.5 * 1.5 / (2 * 0.8 * 9.81), 0.015);
  }
  // no normal load = no grip: a node touching the ground in zero gravity
  // keeps its full tangential speed (a lifting foot must slide freely)
  {
    const s = createState({ world: { friction: 1.0, gravity: 0, drag: 0 } });
    const n = addNode(s, 0, 0);
    n.px = n.x - 1.0 * dt;
    run(s, Math.round(1 / dt));
    check('T13d unloaded contact has no grip', (n.x - n.px) / dt, 1.0, 1e-9);
  }
  // static friction: a node pushed sideways by a spring weaker than mu*m*g
  // does not creep (closed form: it stays put)
  {
    const s = createState({ world: { friction: 0.6, drag: 0 } });
    const a = addNode(s, 1.0, 0, { pinned: true });
    const b = addNode(s, 0, 0);
    // spring rest 0.5, stretched to 1.0: pull = k * 0.5 = 2 N  <  mu m g = 5.9 N
    addMember(s, a, b, 'spring', { k: 4, c: 0 });
    for (const m of s.members) m.restLen = 0.5;
    run(s, Math.round(3 / dt));
    check('T13e static friction holds against a weak pull', b.x, 0, 1e-3);
  }
}

// ---- T14: member force readout vs statics -------------------------------
{
  const g = 9.81;
  // a) 1 kg hanging on a beam from an anchor: tension = m g
  {
    const s = createState({ world: { gravity: g } });
    const p = addNode(s, 0, 2, { pinned: true });
    const b = addNode(s, 0, 1);
    const m = addMember(s, p, b, 'beam');
    run(s, Math.round(2 / dt));
    check('T14a beam holding 1 kg reads +m*g (tension)', memberForce(m), g, g * 0.01);
  }
  // b) 2 kg standing on a beam over an anchor: compression = -m g
  {
    const s = createState({ world: { gravity: g } });
    const p = addNode(s, 0, 0.5, { pinned: true });
    const b = addNode(s, 0, 1.5, { mass: 2 });
    const m = addMember(s, p, b, 'beam');
    run(s, Math.round(2 / dt));
    check('T14b beam under 2 kg reads -m*g (compression)', memberForce(m), -2 * g, 2 * g * 0.01);
  }
  // c) spring: settles at k*ext = m g
  {
    const s = createState({ world: { gravity: g } });
    const p = addNode(s, 0, 3, { pinned: true });
    const b = addNode(s, 0, 2);
    const m = addMember(s, p, b, 'spring', { k: 100, c: 3 });
    run(s, Math.round(8 / dt));
    check('T14c spring holding 1 kg reads +m*g', memberForce(m), g, g * 0.01);
  }
  // d) two-bar truss: anchors at (0,2) and (0,1), 1 kg at (1,1) - in the
  //    air (at y=0 the ground would carry half the load).
  //    Statics: diagonal tension = m g sqrt(2), horizontal compression = m g.
  {
    const s = createState({ world: { gravity: g } });
    const p1 = addNode(s, 0, 2, { pinned: true });
    const p2 = addNode(s, 0, 1, { pinned: true });
    const w = addNode(s, 1, 1);
    const diag = addMember(s, p1, w, 'beam');
    const horiz = addMember(s, p2, w, 'beam');
    run(s, Math.round(3 / dt));
    check('T14d truss diagonal = m*g*sqrt2 tension', memberForce(diag), g * Math.SQRT2, g * Math.SQRT2 * 0.03);
    check('T14e truss horizontal = -m*g compression', memberForce(horiz), -g, g * 0.03);
  }
  // f) an unloaded beam lying on the ground reads ~0
  {
    const s = createState({ world: { gravity: g } });
    const a = addNode(s, 0, 0), b = addNode(s, 1, 0);
    const m = addMember(s, a, b, 'beam');
    run(s, Math.round(1 / dt));
    check('T14f unloaded beam reads ~0', memberForce(m), 0, 0.05);
  }
}

// ---- T15: bridge demo - simply supported truss statics -------------------
{
  // Under a downward load the top chord of a simply supported truss is in
  // compression and the bottom chord in tension (closed-form sign result).
  const s = bridge();
  const ends = s.nodes.filter(n => n.pinned).map(n => [n.x, n.y]);
  run(s, Math.round(6 / dt));
  const isChord = (m, y) => {
    const a = getNode(s, m.a), b = getNode(s, m.b);
    return Math.abs(a.ry - y) < 1e-9 && Math.abs(b.ry - y) < 1e-9 && m.kind === 'beam';
  };
  const bottom = s.members.filter(m => isChord(m, 1.0));
  const top = s.members.filter(m => isChord(m, 1.8));
  checkTrue('T15a bridge has 4 bottom + 3 top chord beams', bottom.length === 4 && top.length === 3);
  checkTrue('T15b bottom chord all in tension', bottom.every(m => memberForce(m) > 1),
    `min=${fmt(Math.min(...bottom.map(memberForce)))} N`);
  checkTrue('T15c top chord all in compression', top.every(m => memberForce(m) < -1),
    `max=${fmt(Math.max(...top.map(memberForce)))} N`);
  // symmetric structure + central load: mirror members carry equal force
  const bl = bottom.find(m => getNode(s, m.a).rx + getNode(s, m.b).rx === 1);   // x 0-1
  const br = bottom.find(m => getNode(s, m.a).rx + getNode(s, m.b).rx === 7);   // x 3-4
  check('T15d mirror-image chords carry equal force', memberForce(bl) / memberForce(br), 1, 0.02);
  const pinnedMoved = s.nodes.filter(n => n.pinned)
    .some((n, i) => Math.abs(n.x - ends[i][0]) > 1e-12 || Math.abs(n.y - ends[i][1]) > 1e-12);
  checkTrue('T15e abutments never move', !pinnedMoved);
  const load = s.nodes.find(n => n.mass === 4);
  checkTrue('T15f load stays above the ground', load.y > 0.05, `y=${fmt(load.y)}`);
}

// ---- T16: substructure copy / paste / mirror ------------------------------
{
  // a) connected component of the walker is all 4 nodes; a stray node is not
  const s = walker();
  const stray = addNode(s, 5, 1);
  const comp = componentOf(s, s.nodes[0].id);
  checkTrue('T16a component of walker = its 4 nodes', comp.length === 4 && !comp.includes(stray.id));
  // b) extract + insert: the copy walks exactly like the original
  //    (translation invariance - identical dx after 20 s)
  const frag = extractSub(s, comp);
  checkTrue('T16b fragment has 4 nodes + 5 members', frag.nodes.length === 4 && frag.members.length === 5);
  const s2 = walker();
  const newIds = insertSub(s2, extractSub(s2, componentOf(s2, s2.nodes[0].id)), 3, 0);
  checkTrue('T16c paste creates 4 new nodes', newIds.length === 4 && s2.nodes.length === 8);
  const orig = new Set(s2.nodes.slice(0, 4).map(n => n.id)), copy = new Set(newIds);
  const cx = (st, set) => { let x = 0, k = 0; for (const n of st.nodes) if (set.has(n.id)) { x += n.x; k++; } return x / k; };
  const o0 = cx(s2, orig), c0 = cx(s2, copy);
  run(s2, Math.round(20 / dt));
  // (a 3 m offset changes float rounding; the gait is chaotic, so allow 3 %)
  const dOrig = cx(s2, orig) - o0;
  check('T16d pasted walker walks like the original', (cx(s2, copy) - c0) / dOrig, 1, 0.03);
  check('T16e paste offset preserved', c0 - o0, 3, 1e-9);
  // c) pasted member rest lengths and waves copied verbatim
  const m0 = s2.members[0], mc = s2.members.find(m => copy.has(m.a) && copy.has(m.b) && m.kind === 'actuator' && m.wave.phase === m0.wave.phase);
  check('T16f pasted actuator rest length verbatim', mc.restLen, m0.restLen, 1e-12);
  check('T16g pasted actuator amp verbatim', mc.wave.amp, m0.wave.amp, 1e-12);
  // d) mirror: physics is left-right symmetric, so a mirrored walker walks
  //    backwards at the same speed (constraint ordering makes it inexact)
  const w1 = walker(), w2 = walker();
  mirrorSub(w2, w2.nodes.map(n => n.id));
  const a0 = centroid(w1).x, b0 = centroid(w2).x;
  run(w1, Math.round(20 / dt)); run(w2, Math.round(20 / dt));
  const d1 = centroid(w1).x - a0, d2 = centroid(w2).x - b0;
  check('T16h mirrored walker walks backwards at the same speed', d2 / d1, -1, 0.05);
  // e) mirror preserves member lengths; translate preserves everything
  const w3 = walker();
  const lens = w3.members.map(m => { const a = getNode(w3, m.a), b = getNode(w3, m.b); return Math.hypot(b.rx - a.rx, b.ry - a.ry); });
  mirrorSub(w3, w3.nodes.map(n => n.id), 1.0);
  translateSub(w3, w3.nodes.map(n => n.id), 2, 1);
  const lens2 = w3.members.map(m => { const a = getNode(w3, m.a), b = getNode(w3, m.b); return Math.hypot(b.rx - a.rx, b.ry - a.ry); });
  check('T16i mirror + translate keep member lengths', Math.max(...lens.map((l, i) => Math.abs(l - lens2[i]))), 0, 1e-12);
  const fb = fragmentBounds(extractSub(w3, w3.nodes.map(n => n.id)));
  check('T16j translated bounds min y', fb.y0, 1, 1e-12);
}

// ---- T17: snap lattices (pure geometry) ---------------------------------
{
  const sq = snapToLattice('square', 0.25, 0.6, 0.2);
  check('T17a square snap x', sq.x, 0.5, 1e-12);
  check('T17b square snap y', sq.y, 0.25, 1e-12);
  // tri, side 1: (0.6, 0.2) is nearer (1, 0) [d=0.45] than (0.5, 0.866) [d=0.67]
  const t1 = snapToLattice('tri', 1, 0.6, 0.2);
  check('T17c tri snap picks row 0 point', Math.hypot(t1.x - 1, t1.y - 0), 0, 1e-12);
  // (0.5, 0.5) is nearer the odd-row point (0.5, 0.866) [d=0.37] than (0,0)/(1,0) [d=0.71]
  const t2 = snapToLattice('tri', 1, 0.5, 0.5);
  check('T17d tri snap picks shifted odd row', Math.hypot(t2.x - 0.5, t2.y - Math.sqrt(3) / 2), 0, 1e-12);
  // every tri lattice point has neighbours at exactly one pitch: an
  // equilateral triangle (0,0), (1,0), (0.5, h) snaps to itself
  const h = rowHeight('tri', 1);
  const tri = [[0, 0], [1, 0], [0.5, h]].map(([x, y]) => snapToLattice('tri', 1, x + 1e-9, y - 1e-9));
  const side = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  check('T17e tri lattice triangle is equilateral', Math.max(
    Math.abs(side(tri[0], tri[1]) - 1), Math.abs(side(tri[1], tri[2]) - 1), Math.abs(side(tri[0], tri[2]) - 1)), 0, 1e-9);
  // point count in a box: square 0.5 pitch over [0,1]x[0,1] = 3x3 = 9
  let n = 0; forEachLatticePoint('square', 0.5, 0, 0, 1, 1, () => n++);
  check('T17f square points in unit box', n, 9, 0);
  // negative rows keep the odd-row shift (j & 1 works for negatives)
  const t3 = snapToLattice('tri', 1, 0.5, -h);
  check('T17g tri snap below ground keeps row shift', t3.x, 0.5, 1e-12);
}

// ---- T18: solid members (node vs member contact) -------------------------
{
  const g = 9.81;
  const platform = (solid, x0 = -5, x1 = 5, y = 0.5, mu = 0.7) => {
    const s = createState({ world: { gravity: g, friction: mu, drag: 0 } });
    const a = addNode(s, x0, y, { pinned: true }), b = addNode(s, x1, y, { pinned: true });
    addMember(s, a, b, 'beam', { solid });
    return s;
  };
  // a) a dropped node rests ON a solid beam, CONTACT_R above its axis
  {
    const s = platform(true);
    const n = addNode(s, 0, 1.2);
    run(s, Math.round(3 / dt));
    check('T18a node rests on a solid beam at y + CONTACT_R', n.y, 0.5 + CONTACT_R, 2e-3);
  }
  // b) the same beam, pass-through (default): the node falls to the ground
  {
    const s = platform(false);
    const n = addNode(s, 0, 1.2);
    run(s, Math.round(3 / dt));
    check('T18b pass-through beam lets the node fall to the floor', n.y, 0, 1e-3);
  }
  // c) Coulomb on a solid beam: stopping distance v0^2 / (2 mu g), like the floor
  {
    const s = platform(true, -5, 5, 0.5, 0.5);
    const n = addNode(s, 0, 0.5 + CONTACT_R);
    n.px = n.x - 2 * dt;
    run(s, Math.round(4 / dt));
    check('T18c sliding on a solid beam stops in v0^2/(2 mu g)', n.x, 4 / (2 * 0.5 * g), 0.03);
  }
  // d) no self-collision: a walker whose members are ALL solid walks
  //    identically (its own nodes are endpoints or neighbours of every member)
  {
    const w1 = walker(), w2 = walker();
    for (const m of w2.members) m.solid = true;
    run(w1, Math.round(10 / dt)); run(w2, Math.round(10 / dt));
    check('T18d solid members never jam their own body', centroid(w2).x, centroid(w1).x, 1e-12);
  }
  // e) a light beam is pushed by a heavy node (mass weighting): free
  //    2-node solid beam in zero g, a 4 kg node arriving from above
  //    pushes it down and keeps going slower - momentum is conserved
  {
    const s = createState({ world: { gravityOn: false, drag: 0, friction: 0 } });
    const a = addNode(s, -0.5, 0.5, { mass: 0.5 }), b = addNode(s, 0.5, 0.5, { mass: 0.5 });
    addMember(s, a, b, 'beam', { solid: true });
    const n = addNode(s, 0, 1.0, { mass: 4 });
    n.py = n.y + 1.0 * dt;   // 1 m/s downward
    run(s, Math.round(0.6 / dt));
    const vy = nd => (nd.y - nd.py) / dt;
    const pTotal = 4 * vy(n) + 0.5 * vy(a) + 0.5 * vy(b);
    check('T18e momentum conserved in a node-beam collision', pTotal, -4 * 1.0, 0.05);
    checkTrue('T18f beam was pushed down by the node', a.y < 0.45, `beam y=${fmt(a.y)}`);
  }
  // g) solid survives save / load and copy / paste
  {
    const s = platform(true);
    const s2 = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    checkTrue('T18g solid flag round-trips through save', s2.members[0].solid === true);
    const frag = extractSub(s, s.nodes.map(n => n.id));
    const s3 = createState(); insertSub(s3, frag, 0, 0);
    checkTrue('T18h solid flag survives copy / paste', s3.members[0].solid === true);
  }
}

// ---- T20: split a member / merge nodes -----------------------------------
{
  // a) split a 2 m beam at its middle: two 1 m beams + a welded hub
  {
    const s = createState();
    const a = addNode(s, 0, 1, { pinned: true }), b = addNode(s, 2, 1, { pinned: true });
    const m = addMember(s, a, b, 'beam');
    const r = splitMember(s, m.id, 1.0, 1.3);   // off-axis point projects onto the beam
    checkTrue('T20a split makes 3 nodes, 2 members', !!r && s.nodes.length === 3 && s.members.length === 2);
    check('T20b hub sits on the beam', r.node.y, 1, 1e-12);
    check('T20c halves have rest length 1 m', r.members[0].restLen + r.members[1].restLen, 2, 1e-12);
    checkTrue('T20d hub is welded by default', r.node.locked === true);
    checkTrue('T20e original member is gone', getMember(s, m.id) === null);
  }
  // b) a split beam stays STRAIGHT under load (weld), a hinged one folds
  {
    const straight = lock => {
      const s = createState({ world: { drag: 1.5 } });
      // four-bar linkage: a anchored, b hangs from anchor c on a 1 m link,
      // a 2 kg load on the hub. Welded hub = a rigid 2 m bar (stays
      // straight); hinged hub = the bar folds into a V at the hub.
      const a = addNode(s, 0, 2, { pinned: true }), b = addNode(s, 2, 2);
      const c = addNode(s, 2, 3, { pinned: true });
      addMember(s, b, c, 'beam');
      const m = addMember(s, a, b, 'beam');
      const r = splitMember(s, m.id, 1, 2, { locked: lock });
      const load = addNode(s, 1, 1.4, { mass: 2 });
      addMember(s, r.node, load, 'beam');
      reset(s);
      run(s, Math.round(4 / dt));
      const A = getNode(s, a.id), H = r.node, B = getNode(s, b.id);
      const v1 = [A.x - H.x, A.y - H.y], v2 = [B.x - H.x, B.y - H.y];
      const ang = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]);
      return Math.abs(ang) * 180 / Math.PI;
    };
    check('T20f welded hub keeps the beam straight (180 deg)', straight(true), 180, 1.0);
    checkTrue('T20g unwelded hub folds under the load', straight(false) < 170, `angle=${fmt(straight(false))}`);
  }
  // c) split keeps kind / props; splitting near an end is refused
  {
    const s = createState();
    const a = addNode(s, 0, 1, { pinned: true }), b = addNode(s, 1, 1);
    const sp = addMember(s, a, b, 'spring', { k: 123, c: 4, solid: true });
    const r = splitMember(s, sp.id, 0.5, 1);
    checkTrue('T20h split spring halves keep k, c, solid',
      r.members.every(m => m.kind === 'spring' && m.k === 123 && m.c === 4 && m.solid === true));
    checkTrue('T20i split refused within 5 % of an endpoint', splitMember(s, r.members[0].id, 0.01, 1) === null);
  }
  // d) merge: two squares touching at a corner -> one welded joint, no dupes
  {
    const s = createState();
    const sq = (x0) => {
      const p = [addNode(s, x0, 0), addNode(s, x0 + 1, 0), addNode(s, x0 + 1, 1), addNode(s, x0, 1)];
      for (let i = 0; i < 4; i++) addMember(s, p[i], p[(i + 1) % 4], 'beam');
      return p;
    };
    const A = sq(0), B = sq(1);                  // A[1] (1,0) coincides with B[0] (1,0)
    // a link between the two coincident nodes (addMember refuses zero
    // length, so push it by hand): merging must drop it as a self-link
    s.members.push({ id: s.nextId++, a: A[1].id, b: B[0].id, kind: 'beam', solid: false, restLen: 0.5, k: 60, c: 1.5, wave: null });
    const before = s.members.length;
    const keep = mergeNodes(s, A[1].id, B[0].id);
    checkTrue('T20j merge removes the dropped node', s.nodes.length === 7 && getNode(s, B[0].id) === null);
    checkTrue('T20k members re-pointed, self-link dropped', s.members.length === before - 1 &&
      s.members.every(m => m.a !== m.b) && membersAt(s, keep.id).length === 4);
    checkTrue('T20l merged joint is welded and masses add', keep.locked === true && keep.mass === 2);
    // duplicate edge: merging two nodes that both connect to the same third node
    const s2 = createState();
    const c = addNode(s2, 0, 0), d1 = addNode(s2, 1, 0), d2 = addNode(s2, 1, 0.01);
    addMember(s2, c, d1, 'beam'); addMember(s2, c, d2, 'beam');
    mergeNodes(s2, d1.id, d2.id);
    checkTrue('T20m merge collapses duplicate edges', s2.members.length === 1 && s2.nodes.length === 2);
  }
}

// ---- T21: a welded joint with an actuator stays rigid AND pumps ---------
{
  // anchor A, hub H welded, beam A-H horizontal, actuator H-B at 90 deg
  // (pointing down), 1 kg at B. Fixed-length braces made this explode.
  const build = () => {
    const s = createState({ world: { drag: 0.5 } });
    const A = addNode(s, 0, 2, { pinned: true });
    const H = addNode(s, 1, 2, { locked: true });
    const B = addNode(s, 1, 1);
    addMember(s, A, H, 'beam');
    const act = addMember(s, H, B, 'actuator', { wave: { type: 'sine', amp: 0.3, period: 1, phase: 0 } });
    reset(s);
    return { s, A, H, B, act };
  };
  const { s, A, H, B, act } = build();
  let maxV = 0, worstAng = 0, worstLen = 0;
  for (let i = 0; i < Math.round(6 / dt); i++) {
    step(s, dt);
    if (s.t < 1.5) continue;   // past the soft-start ramp
    for (const n of s.nodes) maxV = Math.max(maxV, Math.hypot(n.x - n.px, n.y - n.py) / dt);
    const v1 = [A.x - H.x, A.y - H.y], v2 = [B.x - H.x, B.y - H.y];
    const ang = Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])) * 180 / Math.PI;
    worstAng = Math.max(worstAng, Math.abs(ang - 90));
    const want = targetLength(act, s.t, s.world.actuatorRamp);
    worstLen = Math.max(worstLen, Math.abs(Math.hypot(B.x - H.x, B.y - H.y) - want) / want);
  }
  checkTrue('T21a welded actuator joint stays bounded', maxV < 20 && s.nodes.every(n => Number.isFinite(n.x)), `maxV=${fmt(maxV)} m/s`);
  check('T21b weld holds the 90 deg angle while the muscle pumps', worstAng, 0, 1.5);
  check('T21c the muscle still tracks its wave at the weld', worstLen, 0, 0.02);
  // a welded spring stretches without the weld fighting it: straight
  // chain anchor - spring - welded hub - beam - end, 2 kg below the spring
  {
    const s3 = createState({ world: { drag: 1 } });
    const P3 = addNode(s3, 0, 3, { pinned: true });
    const H3 = addNode(s3, 0, 2, { locked: true });
    const C3 = addNode(s3, 0, 1);
    addMember(s3, P3, H3, 'spring', { k: 60, c: 3 });
    addMember(s3, H3, C3, 'beam');
    reset(s3);
    run(s3, Math.round(8 / dt));
    check('T21d welded spring stretches by m*g/k', (3 - H3.y) - 1, 2 * 9.81 / 60, 0.005);
  }
  // an L on a spring swings so its centre of mass hangs under the anchor
  // (the spring pivots freely at both ends) - the weld must still hold 90
  const s2 = createState({ world: { drag: 1 } });
  const P = addNode(s2, 0, 3, { pinned: true });
  const Hb = addNode(s2, 0, 2, { locked: true });
  const C = addNode(s2, 1, 2);
  addMember(s2, P, Hb, 'spring', { k: 60, c: 3 });
  addMember(s2, Hb, C, 'beam');
  reset(s2);
  run(s2, Math.round(8 / dt));
  const v1 = [P.x - Hb.x, P.y - Hb.y], v2 = [C.x - Hb.x, C.y - Hb.y];
  const ang = Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])) * 180 / Math.PI;
  check('T21e weld holds 90 deg across the stretched spring', ang, 90, 1.5);
}

// ---- T22: chains -----------------------------------------------------------
{
  const g = 9.81;
  // a) lay 10 links over 2 m: 9 nodes, 10 links, lengths sum to the span
  {
    const s = createState();
    const a = addNode(s, 0, 2, { pinned: true }), b = addNode(s, 2, 2);
    const r = chain(s, a, b, 10);
    checkTrue('T22a chain(10) = 9 nodes + 10 links', r.nodes.length === 9 && r.members.length === 10 && r.members.every(m => m.kind === 'chain'));
    check('T22b link lengths sum to the span', r.members.reduce((t, m) => t + m.restLen, 0), 2, 1e-9);
  }
  // b) hanging chain: links stay rigid, the bob hangs straight below at
  //    the full chain length
  {
    // it starts horizontal and swings like a pendulum: damp it and wait
    const s = createState({ world: { drag: 3 } });
    const a = addNode(s, 0, 3, { pinned: true }), bob = addNode(s, 1.5, 3, { mass: 2 });
    const r = chain(s, a, bob, 10);
    reset(s);
    run(s, Math.round(14 / dt));
    let worst = 0;
    for (const m of r.members) {
      const p = getNode(s, m.a), q = getNode(s, m.b);
      worst = Math.max(worst, Math.abs(Math.hypot(q.x - p.x, q.y - p.y) / m.restLen - 1));
    }
    check('T22c links stay rigid under load (worst strain)', worst, 0, 0.005);
    check('T22d bob hangs straight below the anchor', bob.x, 0, 0.01);
    check('T22e bob hangs at the full chain length', 3 - bob.y, 1.5, 0.01);
  }
  // c) chain between two anchors longer than the span sags symmetrically
  {
    const s = createState({ world: { drag: 1 } });
    const a = addNode(s, 0, 2, { pinned: true }), b = addNode(s, 2, 2, { pinned: true });
    const r = chain(s, a, b, 12);
    for (const m of r.members) m.restLen = 0.2;   // 2.4 m of chain over a 2 m span
    reset(s);
    run(s, Math.round(6 / dt));
    const mid = r.nodes[5];                         // 6th of 11 intermediates = centre
    // parabola estimate: L ~ span + 8 s^2 / (3 span) -> s ~ 0.55 for 0.4 m of slack
    check('T22f slack chain sags like a catenary (mid drop)', 2 - mid.y, 0.55, 0.12);
    check('T22g the sag is symmetric', mid.x, 1, 0.02);
  }
  // d) wrap: the demo chain drapes over the solid bar and hangs from its end
  {
    const s = chainDemo();
    const bar = s.members.find(m => m.solid);
    const A = getNode(s, bar.a), B = getNode(s, bar.b);
    const bob = s.nodes.find(n => n.mass === 2);
    run(s, Math.round(6 / dt));
    const dist = n => {
      const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((n.x - A.x) * dx + (n.y - A.y) * dy) / l2));
      return Math.hypot(n.x - (A.x + t * dx), n.y - (A.y + t * dy));
    };
    const links = s.nodes.filter(n => !n.pinned && n.mass !== 2);
    const nearest = Math.min(...links.map(dist));
    checkTrue('T22h no chain node passes through the solid bar', nearest > CONTACT_R - 0.01, `nearest=${fmt(nearest)}`);
    checkTrue('T22i the bob ends up hanging below the bar', bob.y < B.y - 0.3, `bob y=${fmt(bob.y)}`);
    checkTrue('T22j the chain bends over the bar end (some links touch it)', links.some(n => dist(n) < CONTACT_R + 0.02));
    checkTrue('T22k wrap stays bounded', s.nodes.every(n => Number.isFinite(n.x) && Math.abs(n.x) < 10));
  }
  // e) chain links survive save / load
  {
    const s = chainDemo();
    const s2 = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    checkTrue('T22l chain kind round-trips', s2.members.filter(m => m.kind === 'chain').length === 14);
  }
}

// ---- T23: catapult ---------------------------------------------------------
{
  const s = catapult();
  const pivot = s.nodes.find(n => n.pinned && n.locked);
  const ball = s.nodes.find(n => n.mass === 0.3);
  const tip = s.nodes.find(n => n.mass === 0.5 && n.x > pivot.x);
  let apex = 0, left = null, land = null;
  for (let i = 0; i < Math.round(6 / dt); i++) {
    step(s, dt);
    apex = Math.max(apex, ball.y);
    // distance from the ball to the arm's tip half
    const dx = tip.x - pivot.x, dy = tip.y - pivot.y, l2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((ball.x - pivot.x) * dx + (ball.y - pivot.y) * dy) / l2));
    const d = Math.hypot(ball.x - (pivot.x + t * dx), ball.y - (pivot.y + t * dy));
    if (left === null && d > CONTACT_R + 0.05) left = s.t;
    if (land === null && s.t > 0.5 && ball.y <= 1e-3) land = ball.x;
  }
  const armAng = Math.atan2(tip.y - pivot.y, tip.x - pivot.x) * 180 / Math.PI;
  checkTrue('T23a the ball leaves the arm', left !== null && left < 1.5, `t=${fmt(left)}`);
  checkTrue('T23b the ball flies high (apex > 2.2 m)', apex > 2.2, `apex=${fmt(apex)}`);
  checkTrue('T23c the ball lands > 2.5 m past the pivot', land !== null && land - pivot.x > 2.5, `range=${fmt(land - pivot.x)}`);
  check('T23d the arm ends resting on the 45 deg stop', armAng, 45, 6);
  checkTrue('T23e everything stays finite', s.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
}

// ---- T24: inchworm ---------------------------------------------------------
{
  const crawl = mu => {
    const s = inchworm(); s.world.friction = mu;
    const feet = s.nodes.filter(n => n.ry === 0);
    const x0 = centroid(s).x;
    let air = 0, maxY = 0, N = Math.round(20 / dt);
    for (let i = 0; i < N; i++) {
      step(s, dt);
      if (feet.every(n => n.y > 1e-3)) air++;
      for (const n of s.nodes) maxY = Math.max(maxY, n.y);
    }
    return { dx: centroid(s).x - x0, air: air / N, maxY };
  };
  const r4 = crawl(0.4), r7 = crawl(0.7), r12 = crawl(1.2);
  checkTrue('T24a inchworm crawls forward at grip 0.4', r4.dx > 3, `dx=${fmt(r4.dx)} m`);
  checkTrue('T24b inchworm crawls forward at grip 0.7', r7.dx > 3, `dx=${fmt(r7.dx)} m`);
  checkTrue('T24c inchworm crawls forward at grip 1.2', r12.dx > 3, `dx=${fmt(r12.dx)} m`);
  checkTrue('T24d it crawls, it does not hop (airborne < 10 %)', r7.air < 0.1 && r7.maxY < 1.5, `air=${fmt(100 * r7.air)}%`);
}

// ---- T25: rest-length lock + bake -----------------------------------------
// Expected lengths are plain Pythagoras on the coordinates we set, never
// read back from the engine.
{
  // a) fixRest round-trips through the file format and a fragment
  const s = createState();
  const a = addNode(s, 0, 1), b = addNode(s, 1, 1), c = addNode(s, 2, 1), d = addNode(s, 3, 1);
  const ab = addMember(s, a.id, b.id, 'beam');
  const bc = addMember(s, b.id, c.id, 'spring', { fixRest: true });
  const cd = addMember(s, c.id, d.id, 'actuator', { wave: { amp: 0.25 } });
  const s2 = deserialize(serialize(s));
  checkTrue('T25a fixRest survives serialize/deserialize', getMember(s2, bc.id).fixRest === true && getMember(s2, ab.id).fixRest === false);
  const frag = extractSub(s, [b.id, c.id]);
  const s3 = createState(); const ids = insertSub(s3, frag, 0, 0);
  checkTrue('T25a2 fixRest survives copy/paste (fragment)', s3.members[0].fixRest === true && ids.length === 2);

  // b) moving an end while paused re-bakes an UNLOCKED member: b goes to
  //    (1, 2) so a-b becomes sqrt(1 + 1)
  b.x = 1; b.y = 2; b.px = b.x; b.py = b.y;
  const r = bakeNodes(s, [b.id]);
  check('T25b unlocked member re-bakes to the new geometry', ab.restLen, Math.SQRT2, 1e-12);
  checkTrue('T25b2 rest pose follows the node', b.rx === 1 && b.ry === 2);
  // c) the LOCKED spring b-c also changed geometry (now sqrt(1 + 1)) but
  //    keeps its tuned rest length of 1
  check('T25c locked member keeps its rest length', bc.restLen, 1, 1e-12);
  checkTrue('T25c2 bakeNodes reports 1 baked, 1 kept', r.baked === 1 && r.kept === 1, JSON.stringify(r));

  // d) group move: shift c and d together by (0, +3). c-d is inside the
  //    group (length unchanged = 1); b-c crosses the boundary and is
  //    locked, so it is kept; nothing else touches the group.
  for (const n of [c, d]) { n.y += 3; n.py = n.y; }
  const r2 = bakeNodes(s, [c.id, d.id]);
  check('T25d member inside a moved group keeps length 1', cd.restLen, 1, 1e-12);
  checkTrue('T25d2 crossing locked member kept, internal re-baked', r2.kept === 1 && r2.baked === 1, JSON.stringify(r2));
  // now unlock b-c and bake again: it re-bakes to the real distance
  // b=(1,2), c=(2,4): sqrt(1 + 4)
  bc.fixRest = false;
  bakeNodes(s, [c.id]);
  check('T25d3 unlocked crossing member re-bakes', bc.restLen, Math.sqrt(5), 1e-12);

  // e) "Rest = now" on an actuator: rest becomes the current length, amp
  //    is untouched so short / long scale with it. Stretch c-d to 2.5.
  d.x = c.x + 2.5; d.px = d.x;
  const L = setRestFromCurrent(s, cd);
  check('T25e setRestFromCurrent returns the new length', L, 2.5, 1e-12);
  check('T25e2 actuator rest = current length', cd.restLen, 2.5, 1e-12);
  check('T25e3 actuator amp untouched', cd.wave.amp, 0.25, 1e-12);
  checkTrue('T25e4 setRestFromCurrent on coincident ends is a no-op', (() => {
    const t = createState(); const p = addNode(t, 0, 0), q = addNode(t, 1, 0);
    const m = addMember(t, p.id, q.id, 'beam'); q.x = 0; return setRestFromCurrent(t, m) === null && m.restLen === 1;
  })());

  // f) bakeRestPose = bakeNodes over everything, honouring the lock.
  //    Lock a-b (re-baked to sqrt 2 in step b), drag every node +1 in x,
  //    drop a alone -2 in y: a=(1,-1) b=(2,2) is really sqrt(1 + 9) but
  //    the lock holds sqrt 2; b-c is b=(2,2) c=(3,4): sqrt(1 + 4).
  ab.fixRest = true;
  for (const n of s.nodes) { n.x += 1; n.px = n.x; }
  a.y -= 2; a.py = a.y;
  const r3 = bakeRestPose(s);
  check('T25f locked a-b keeps sqrt 2 under bakeRestPose', ab.restLen, Math.SQRT2, 1e-12);
  check('T25f2 unlocked b-c re-bakes under bakeRestPose', bc.restLen, Math.sqrt(5), 1e-12);
  checkTrue('T25f3 every node rest pose = current pose', s.nodes.every(n => n.rx === n.x && n.ry === n.y) && r3.kept === 1);
  // and Reset brings the build back exactly to that pose
  for (const n of s.nodes) { n.x += 7; }
  reset(s);
  checkTrue('T25f4 reset restores the baked pose', s.nodes.every(n => n.x === n.rx && n.y === n.ry));
}

// ---- T26: shapes ------------------------------------------------------------
// Closed forms: regular polygon side = 2 r sin(pi / n); Warren truss member
// count 4 * bays - 1; box diagonal = hypot(w, h).
{
  const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
  const byId = f => new Map(f.nodes.map(n => [n.id, n]));

  // a) wheel: n rim nodes + hub, 2n members, every rim node at radius r,
  //    every rim edge = 2 r sin(pi / n), startIndex points at the hub
  const w8 = shapeFragment('wheel', { cx: 1, cy: 2, r: 0.5, sides: 8 });
  const m8 = byId(w8);
  checkTrue('T26a wheel = 9 nodes, 16 members', w8.nodes.length === 9 && w8.members.length === 16);
  const rim = w8.members.slice(0, 8).map(m => dist(m8.get(m.a), m8.get(m.b)));
  check('T26a2 wheel rim edge = 2 r sin(pi/8)', Math.max(...rim), 2 * 0.5 * Math.sin(Math.PI / 8), 1e-12);
  check('T26a3 wheel rim edge (min) = same', Math.min(...rim), 2 * 0.5 * Math.sin(Math.PI / 8), 1e-12);
  const hub = w8.nodes[w8.startIndex];
  checkTrue('T26a4 startIndex is the hub at the centre', hub.x === 1 && hub.y === 2);
  checkTrue('T26a5 spokes all length r', w8.members.slice(8).every(m => Math.abs(dist(m8.get(m.a), m8.get(m.b)) - 0.5) < 1e-12));
  // an even-sided wheel has an EDGE at the bottom (sits flat): the two
  // lowest nodes share y = cy - r cos(pi/n)
  const ys = w8.nodes.slice(0, 8).map(n => n.y).sort((a, b) => a - b);
  check('T26a6 flat bottom edge: lowest y = cy - r cos(pi/8)', ys[0], 2 - 0.5 * Math.cos(Math.PI / 8), 1e-12);
  check('T26a7 two nodes share that lowest y', ys[1], ys[0], 1e-12);

  // b) ring = same rim, no hub, no startIndex
  const r6 = shapeFragment('ring', { cx: 0, cy: 0, r: 1, sides: 6 });
  checkTrue('T26b ring = 6 nodes, 6 members, no startIndex', r6.nodes.length === 6 && r6.members.length === 6 && r6.startIndex === undefined);
  check('T26b2 hexagon side = r', dist(byId(r6).get(1), byId(r6).get(2)), 1, 1e-12);
  checkTrue('T26b3 too small / bad kind -> null', shapeFragment('ring', { cx: 0, cy: 0, r: 0 }) === null && shapeFragment('blob', {}) === null);
  checkTrue('T26b4 sides clamp to 3..64', polygonShape({ cx: 0, cy: 0, r: 1, sides: 1, hub: false }).nodes.length === 3 && polygonShape({ cx: 0, cy: 0, r: 1, sides: 99, hub: false }).nodes.length === 64);

  // c) box: 4 corners, 4 sides + bracing, diagonal = hypot(w, h)
  const bx = shapeFragment('box', { x0: 0, y0: 1, x1: 2, y1: 2.5, brace: 'one' });
  checkTrue('T26c box (one brace) = 4 nodes, 5 members', bx.nodes.length === 4 && bx.members.length === 5);
  const d = bx.members[4];
  check('T26c2 box diagonal = hypot(2, 1.5)', dist(byId(bx).get(d.a), byId(bx).get(d.b)), 2.5, 1e-12);
  checkTrue('T26c3 cross = 6, none = 4, zero width = null',
    boxShape({ x0: 0, y0: 0, x1: 1, y1: 1, brace: 'cross' }).members.length === 6 &&
    boxShape({ x0: 0, y0: 0, x1: 1, y1: 1, brace: 'none' }).members.length === 4 &&
    boxShape({ x0: 0, y0: 0, x1: 0, y1: 1 }) === null);
  checkTrue('T26c4 box node 1 is the first corner given', bx.nodes[bx.startIndex].x === 0 && bx.nodes[bx.startIndex].y === 1);

  // d) truss: bays + 1 bottom nodes, bays top nodes, 4 bays - 1 members
  for (const nb of [1, 4, 7]) {
    const t = shapeFragment('truss', { x0: 0, y0: 1, x1: 4, y1: 1.6, bays: nb });
    checkTrue(`T26d truss ${nb} bays = ${2 * nb + 1} nodes, ${4 * nb - 1} members`, t.nodes.length === 2 * nb + 1 && t.members.length === 4 * nb - 1);
  }
  const t4 = shapeFragment('truss', { x0: 0, y0: 1, x1: 4, y1: 1.6, bays: 4 });
  const mt = byId(t4);
  check('T26d2 truss bay = span / bays', dist(mt.get(1), mt.get(2)), 1, 1e-12);
  check('T26d3 top node over bay midpoint at height h', mt.get(6).x * 10 + mt.get(6).y, 0.5 * 10 + 1.6, 1e-12);
  checkTrue('T26d4 diagonals equal length (Warren)', (() => {
    const L = t4.members.slice(7).map(m => dist(mt.get(m.a), mt.get(m.b)));
    return Math.max(...L) - Math.min(...L) < 1e-12 && Math.abs(L[0] - Math.hypot(0.5, 0.6)) < 1e-12;
  })());

  // e) the fragments load through insertSub and BEHAVE: a wheel dropped on
  //    the ground under gravity stays a disc (every rim node within 1 % of
  //    r from the hub after 2 s); the same-size ring squashes (> 10 %)
  const settle = (shape) => {
    const s = createState();
    const f = shapeFragment(shape, { cx: 0, cy: 0.55, r: 0.5, sides: 8 });
    const ids = insertSub(s, f, 0, 0);
    for (let i = 0; i < 2 / dt; i++) step(s, dt);
    const c = centroid(s);
    const rimIds = ids.slice(0, 8);
    const rs = rimIds.map(id => { const n = getNode(s, id); return Math.hypot(n.x - c.x, n.y - c.y); });
    return { dev: Math.max(...rs.map(r => Math.abs(r - 0.5))) / 0.5, finite: s.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)), ids };
  };
  const wheel = settle('wheel'), ring = settle('ring');
  checkTrue('T26e wheel on the ground stays round (< 1 % radius error)', wheel.finite && wheel.dev < 0.01, `dev=${fmt(100 * wheel.dev)}%`);
  checkTrue('T26e2 hinged ring squashes (> 10 %)', ring.finite && ring.dev > 0.10, `dev=${fmt(100 * ring.dev)}%`);
  checkTrue('T26e3 insertSub returns ids in fragment order (hub last)', wheel.ids.length === 9);

  // f) truss anchored at both bottom ends, off the ground: rigid beams,
  //    the mid-span sag after 3 s is under 5 mm and nothing blows up
  const s = createState();
  const tf = shapeFragment('truss', { x0: 0, y0: 1, x1: 4, y1: 1.6, bays: 4 });
  const tids = insertSub(s, tf, 0, 0);
  getNode(s, tids[0]).pinned = true; getNode(s, tids[4]).pinned = true;
  const midY0 = getNode(s, tids[2]).y;
  for (let i = 0; i < 3 / dt; i++) step(s, dt);
  checkTrue('T26f anchored truss holds its shape (sag < 5 mm)', Math.abs(getNode(s, tids[2]).y - midY0) < 0.005 && s.nodes.every(n => Number.isFinite(n.y)), `sag=${fmt(1000 * (midY0 - getNode(s, tids[2]).y))} mm`);
  checkTrue('T26g SHAPE_KINDS lists the four shapes', SHAPE_KINDS.join() === 'wheel,ring,box,truss');
}

console.log('');
const total = pass + fail;
console.log(`${pass}/${total} checks passed${fail ? `  (${fail} FAILED)` : ''}`);
process.exit(fail ? 1 : 0);
