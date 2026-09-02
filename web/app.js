// TrussForge web app - canvas board UI over the headless engine.
// Pointer Events ONLY (mouse / touch / pen unified). No engine physics
// here: all simulation lives in ../engine/.

import {
  createState, addNode, addMember, removeNode, removeMember,
  getNode, getMember, findMember, membersAt, rebuildBraces, reset,
  serialize, deserialize, centroid, DEFAULTS,
  componentOf, extractSub, insertSub, mirrorSub, fragmentBounds,
  splitMember, mergeNodes, chain,
} from '../engine/model.js';
import { applyTheme, THEMES, themeNames } from './vendor/forgekit/theme.js';
import { ValuePod } from './vendor/forgekit/pod.js';
import { step, memberForce, FIXED_DT, WAVE_TYPES } from '../engine/sim.js';
import { DEMOS, DEMO_HINTS } from '../engine/demos.js';
import { snapToLattice, forEachLatticePoint, rowHeight, rowOffset, PITCHES } from '../engine/lattice.js';

// ============================================================
// CONFIG / VERSION
// ============================================================

const APP_VERSION = '0.12.0';
const BUILD_DATE = '2026-09-02';
const PREFS_KEY = 'trussforge.prefs';
const NODE_R = 0.055;         // node draw radius, meters
const TAP_PX = 7;             // movement under this = a tap
const HIT_NODE_PX = 16;       // node hit radius, screen px
const HIT_MEMBER_PX = 11;     // member hit distance, screen px
const AUTOSAVE_KEY = 'trussforge.autosave';
const CLIP_KEY = 'trussforge.clipboard';
const VIEW_KEY = 'trussforge.view';
const MAX_STEPS_FRAME = 24;   // sim steps per frame cap (heavy tab safety)
const UNDO_DEPTH = 60;
const MASS_STEPS = [0.5, 1, 2, 4];   // pill mass chip cycles through these
const STATUS_HOLD_MS = 2500;  // a status message survives this long while running

// ============================================================
// APP STATE
// ============================================================

let state = createState();
let running = false;
let tool = 'select';          // select | node | beam | spring | actuator | erase
let snapOn = true;
let follow = false;
let strainOn = false;         // force view: color members by axial force

// Grid / view preferences: per device (localStorage), NOT part of the
// build file - open any save and change the lattice to suit it.
const PREF_DEFAULTS = { theme: 'forge', gridType: 'square', pitch: 0.25, gridStyle: 'dots', gridBright: 0.5, gridSize: 2 };
let prefs = { ...PREF_DEFAULTS };
try { prefs = { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch (e) { /* defaults */ }
if (!PITCHES.includes(prefs.pitch)) prefs.pitch = PREF_DEFAULTS.pitch;
if (!THEMES[prefs.theme]) prefs.theme = 'forge';
// ForgeKit theme: CSS tokens for the chrome + a canvas palette for the board
let theme = applyTheme(prefs.theme);
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const withAlpha = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
}
let sel = { kind: null, id: 0 };       // kind: 'node' | 'member' | 'group' (ids[]) | 'world' | null
let cam = { x: 0.6, y: 0.9, zoom: 110 };   // world center + px per meter
let toolHint = '';

const $ = id => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const narrow = matchMedia('(max-width: 820px)');   // phone layout (props = sheet)

// ============================================================
// CAMERA / TRANSFORM  (world y is UP, screen y is down)
// ============================================================

let vw = 0, vh = 0, dpr = 1;

let pendingFit = false;     // fitView ran before the board had a real size

function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  vw = r.width; vh = r.height;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  if (pendingFit && vw > 50 && vh > 50) fitView();
  draw();
}
window.addEventListener('resize', resize);

const sx = wx => (wx - cam.x) * cam.zoom + vw / 2;
const sy = wy => vh / 2 - (wy - cam.y) * cam.zoom;
const wx = px => (px - vw / 2) / cam.zoom + cam.x;
const wy = py => cam.y - (py - vh / 2) / cam.zoom;

// Joint (x, y) snap: a triangular lattice cannot be snapped one axis at
// a time. Every placement / drag path goes through snapPt.
function snapPt(x, y) {
  return snapOn ? snapToLattice(prefs.gridType, prefs.pitch, x, y) : { x, y };
}
// Translations (paste offsets) snap the same way: lattice vectors form
// the lattice, so snapping the offset keeps pasted nodes on-grid.
const snapVec = snapPt;

function fitView() {
  // a hidden / not-yet-laid-out board has no size: fit again on resize
  pendingFit = !(vw > 50 && vh > 50);
  if (pendingFit) return;
  if (!state.nodes.length) { cam = { x: 0.6, y: 0.9, zoom: 110 }; return; }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const n of state.nodes) {
    x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
    y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
  }
  y0 = Math.min(y0, 0);                          // keep the ground in frame
  const pad = 0.9;
  const zx = vw / Math.max(0.5, x1 - x0 + 2 * pad);
  const zy = vh / Math.max(0.5, y1 - y0 + 2 * pad);
  cam.zoom = Math.max(30, Math.min(220, Math.min(zx, zy)));
  cam.x = (x0 + x1) / 2;
  cam.y = (y0 + y1) / 2 + 0.15;
  saveView();
}

function saveView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(cam)); } catch (e) { /* ignore */ }
}
function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (v && v.zoom) cam = v;
  } catch (e) { /* ignore */ }
}

// ============================================================
// RENDERER
// ============================================================

// draw() is the ONLY place the board repaints. While paused the frame
// loop does not call it (a static scene at 60 fps just burns phone
// battery), so every paused edit path calls draw() itself.
// Force view scale: a member carrying the whole build's weight is fully
// saturated. Floor of 5 N so a weightless world still shows something.
let fRef = 5;
function forceRef() {
  let mass = 0;
  for (const n of state.nodes) if (!n.pinned) mass += n.mass;
  return Math.max(5, mass * Math.abs(state.world.gravity));
}
// neutral gray -> red (tension) / blue (compression); {color, strength 0..1}
function strainStyle(f) {
  const t = Math.max(-1, Math.min(1, f / fRef));
  const a = Math.pow(Math.abs(t), 0.7);
  const [r0, g0, b0] = hexRgb(theme.canvas.beam);
  const [r1, g1, b1] = t > 0 ? [255, 86, 72] : [64, 160, 255];
  const color = `rgb(${Math.round(r0 + (r1 - r0) * a)},${Math.round(g0 + (g1 - g0) * a)},${Math.round(b0 + (b1 - b0) * a)})`;
  return { color, a };
}
const fmtForce = f => {
  const kind = f > 0.05 ? ' tension' : f < -0.05 ? ' compression' : '';
  return `${Math.abs(f).toFixed(1)} N${kind}`;
};

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.canvas.board;
  ctx.fillRect(0, 0, vw, vh);
  if (strainOn) fRef = forceRef();

  drawGrid();
  drawGround();

  for (const m of state.members) drawMember(m);
  drawGesture();
  chainNodes = chainNodeSet();
  for (const n of state.nodes) drawNode(n);
  positionPill();
}

// nodes whose members are ALL chain links draw small (they are the
// chain's joints, not places you build on)
let chainNodes = new Set();
function chainNodeSet() {
  const kinds = new Map();
  for (const m of state.members) {
    for (const id of [m.a, m.b]) {
      const k = kinds.get(id);
      if (k === undefined) kinds.set(id, m.kind === 'chain' ? 1 : 2);
      else if (m.kind !== 'chain') kinds.set(id, 2);
    }
  }
  const out = new Set();
  for (const [id, k] of kinds) if (k === 1) out.add(id);
  return out;
}

function drawGrid() {
  if (!snapOn) return;
  const type = prefs.gridType, p = prefs.pitch;
  const px = p * cam.zoom;                  // pitch on screen
  if (px < 7) return;                       // too dense to mean anything
  const alpha = 0.1 + 0.8 * prefs.gridBright;
  const fade = Math.min(1, (px - 7) / 12);  // ease in as you zoom in
  const col = `rgba(${theme.canvas.grid}, ${(alpha * fade).toFixed(3)})`;
  const s = prefs.gridSize;
  const x0 = wx(-px), x1 = wx(vw + px), y0 = wy(vh + px), y1 = wy(-px);
  if (prefs.gridStyle === 'lines') {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(0.5, s * 0.5);
    ctx.beginPath();
    if (type === 'tri') {
      // three line families through the lattice: horizontal rows plus
      // the two 60-degree diagonals (each drawn as one long line per
      // row so the path stays small)
      const h = rowHeight(type, p);
      const jA = Math.floor(y0 / h) - 1, jB = Math.ceil(y1 / h) + 1;
      for (let j = jA; j <= jB; j++) {
        const y = j * h;
        ctx.moveTo(0, sy(y)); ctx.lineTo(vw, sy(y));
      }
      // diagonals: lines x = c +- y / sqrt3 ... walk along row 0 and
      // extend up/down across the whole view
      const span = (y1 - y0) / Math.sqrt(3) + p;
      const iA = Math.floor((x0 - span) / p), iB = Math.ceil((x1 + span) / p);
      for (let i = iA; i <= iB; i++) {
        const cx0 = i * p;
        // direction (0.5, s3/2): x = cx0 + t*0.5, y = t*s3/2 -> at y, x = cx0 + y/sqrt3
        ctx.moveTo(sx(cx0 + y0 / Math.sqrt(3)), sy(y0)); ctx.lineTo(sx(cx0 + y1 / Math.sqrt(3)), sy(y1));
        ctx.moveTo(sx(cx0 - y0 / Math.sqrt(3)), sy(y0)); ctx.lineTo(sx(cx0 - y1 / Math.sqrt(3)), sy(y1));
      }
    } else {
      for (let i = Math.floor(x0 / p); i <= Math.ceil(x1 / p); i++) {
        ctx.moveTo(sx(i * p), 0); ctx.lineTo(sx(i * p), vh);
      }
      for (let j = Math.floor(y0 / p); j <= Math.ceil(y1 / p); j++) {
        ctx.moveTo(0, sy(j * p)); ctx.lineTo(vw, sy(j * p));
      }
    }
    ctx.stroke();
    return;
  }
  ctx.fillStyle = col;
  const half = s / 2;
  forEachLatticePoint(type, p, x0, y0, x1, y1, (x, y) => {
    ctx.fillRect(sx(x) - half, sy(y) - half, s, s);
  });
}

function drawGround() {
  const gy = sy(state.world.groundY);
  if (gy > vh + 40 || gy < -40) return;
  ctx.fillStyle = theme.canvas.ground;
  ctx.fillRect(0, gy, vw, vh - gy);
  ctx.strokeStyle = theme.canvas.groundLine;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(vw, gy); ctx.stroke();
  // hatching
  ctx.strokeStyle = theme.canvas.hatch;
  ctx.lineWidth = 1.5;
  const hs = 14;
  ctx.beginPath();
  for (let x = -hs; x < vw + hs; x += hs) {
    ctx.moveTo(x, gy + 2); ctx.lineTo(x - hs * 0.8, gy + 2 + hs);
  }
  ctx.stroke();
}

function memberEnds(m) {
  const a = getNode(state, m.a), b = getNode(state, m.b);
  return [sx(a.x), sy(a.y), sx(b.x), sy(b.y), a, b];
}

function drawMember(m) {
  const [x1, y1, x2, y2, a, b] = memberEnds(m);
  const gs = groupSet();
  const seld = (sel.kind === 'member' && sel.id === m.id) || (gs && gs.has(m.a) && gs.has(m.b));
  let w = Math.max(2.5, 0.055 * cam.zoom);
  let col = null;
  if (strainOn) {
    const st = strainStyle(memberForce(m));
    col = st.color;
    w *= 1 + 0.5 * st.a;             // loaded members also get thicker
  }
  if (seld) {
    ctx.strokeStyle = `rgba(${theme.canvas.select}, .45)`;
    ctx.lineWidth = w + 7;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  if (m.solid) {
    // solid = things collide with it: a pale hard edge around the member
    ctx.strokeStyle = theme.canvas.solidEdge;
    ctx.lineWidth = w + 4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.lineCap = 'round';
  if (m.kind === 'beam') {
    ctx.strokeStyle = col || theme.canvas.beam;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  } else if (m.kind === 'chain') {
    drawChainLink(x1, y1, x2, y2, col, w);
  } else if (m.kind === 'spring') {
    drawSpring(x1, y1, x2, y2, m, col);
  } else {
    drawActuator(x1, y1, x2, y2, a, b, m, w, col);
  }
}

// Chain link: a hollow capsule along the member, so a run of them reads
// as a chain rather than a row of beams.
function drawChainLink(x1, y1, x2, y2, col, w) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const h = Math.max(3, w * 0.9);
  const pad = Math.min(len * 0.12, 2);
  ctx.save();
  ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
  ctx.rotate(Math.atan2(y2 - y1, x2 - x1));
  ctx.strokeStyle = col || theme.canvas.beam;
  ctx.lineWidth = Math.max(1.4, w * 0.3);
  ctx.beginPath();
  ctx.roundRect(-len / 2 + pad, -h / 2, len - 2 * pad, h, h / 2);
  ctx.stroke();
  ctx.restore();
}

// Coil spring: the number of turns comes from the REST length (so the
// drawing is stable while it stretches and the coils visibly open and
// close), the turn count is even so the shape is symmetric end to end,
// and a faint core line keeps a stretched spring reading as one member.
function drawSpring(x1, y1, x2, y2, m, col) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;       // axis
  const nx = -uy, ny = ux;                  // normal
  const turns = Math.max(3, Math.min(24, Math.round((m.restLen || len / cam.zoom) / 0.08)));
  const half = turns * 2;                   // half-turns = zig vertices + 1
  const amp = Math.max(2.5, 0.038 * cam.zoom);
  const lead = Math.min(len * 0.12, Math.max(4, 0.07 * cam.zoom));
  const span = len - 2 * lead;
  const color = col || theme.canvas.spring;
  // faint core
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.globalAlpha = 1;
  // coil
  ctx.lineWidth = Math.max(1.4, 0.022 * cam.zoom) * (col ? 1.4 : 1);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + ux * lead, y1 + uy * lead);
  for (let i = 1; i < half; i++) {
    const t = lead + span * (i / half);
    const side = (i % 2 ? 1 : -1);
    ctx.lineTo(x1 + ux * t + nx * amp * side, y1 + uy * t + ny * amp * side);
  }
  ctx.lineTo(x2 - ux * lead, y2 - uy * lead);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawActuator(x1, y1, x2, y2, a, b, m, w, col) {
  const curLen = Math.hypot(b.x - a.x, b.y - a.y);
  const ext = (curLen - m.restLen) / (m.restLen || 1);   // -amp..+amp
  // base rod (takes the force color in force view; the core keeps its
  // extension glow so you still see what the muscle is doing)
  ctx.strokeStyle = col || theme.canvas.actuatorBase;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // glowing core: brightness follows extension
  const g = Math.max(0, Math.min(1, 0.55 + ext * 1.8));
  const r = Math.round(140 + 87 * g), gr = Math.round(105 + 74 * g), bl = Math.round(45 + 40 * g);
  ctx.strokeStyle = `rgb(${r},${gr},${bl})`;
  ctx.lineWidth = Math.max(1.5, w * 0.42);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // piston block at the middle
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const bs = Math.max(4, 0.09 * cam.zoom);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.translate(mx, my); ctx.rotate(ang);
  ctx.fillStyle = `rgb(${r},${gr},${bl})`;
  ctx.strokeStyle = theme.canvas.board;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-bs * 0.9, -bs * 0.55, bs * 1.8, bs * 1.1, 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawNode(n) {
  const x = sx(n.x), y = sy(n.y);
  // heavier nodes draw bigger (area ~ mass), capped so 4 kg stays tappable
  const small = chainNodes.has(n.id) && !n.pinned && !n.locked;
  const r = Math.max(4, NODE_R * cam.zoom) * Math.min(1.6, Math.sqrt(Math.max(0.3, n.mass))) * (small ? 0.5 : 1);
  const gs = groupSet();
  const seld = (sel.kind === 'node' && sel.id === n.id) || (gs && gs.has(n.id));
  if (seld) {
    ctx.fillStyle = `rgba(${theme.canvas.select}, .35)`;
    ctx.beginPath(); ctx.arc(x, y, r + 7, 0, 7); ctx.fill();
  }
  if (n.pinned && !running) {
    // anchored: a small support triangle + ground line under the node
    // (structural-diagram style). Only while paused - while running the
    // gold node is enough and the symbol just clutters the motion.
    ctx.strokeStyle = theme.canvas.anchor;
    ctx.fillStyle = withAlpha(theme.canvas.anchor, 0.18);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.6);
    ctx.lineTo(x - r - 2, y + r + 6);
    ctx.lineTo(x + r + 2, y + r + 6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r - 5, y + r + 9); ctx.lineTo(x + r + 5, y + r + 9);
    ctx.stroke();
  }
  ctx.fillStyle = n.pinned ? theme.canvas.anchor : theme.canvas.node;
  ctx.strokeStyle = theme.canvas.nodeStroke;
  ctx.lineWidth = 2;
  if (n.locked) {
    // square = welded joint (angles held); round = hinge
    ctx.beginPath();
    ctx.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.3);
    ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
  }
}

function drawGesture() {
  if (!gesture) return;
  if (gesture.type === 'marquee') {
    const x = Math.min(gesture.x0, gesture.x1), y = Math.min(gesture.y0, gesture.y1);
    const w = Math.abs(gesture.x1 - gesture.x0), h = Math.abs(gesture.y1 - gesture.y0);
    ctx.fillStyle = `rgba(${theme.canvas.select}, .10)`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = `rgba(${theme.canvas.select}, .8)`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    return;
  }
  if (gesture.type !== 'member') return;
  const a = gesture.from ? getNode(state, gesture.from) : { x: gesture.startX, y: gesture.startY };
  if (!a) return;
  if (!gesture.from) {   // the start node does not exist yet: show where it will be
    ctx.strokeStyle = `rgba(${theme.canvas.select}, .7)`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx(a.x), sy(a.y), 7, 0, 7); ctx.stroke();
  }
  ctx.strokeStyle = `rgb(${theme.canvas.select})`;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(sx(a.x), sy(a.y));
  ctx.lineTo(gesture.sx, gesture.sy);
  ctx.stroke();
  ctx.setLineDash([]);
  const p = snapPointForGesture();
  ctx.strokeStyle = `rgba(${theme.canvas.select}, .7)`;
  ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 7, 0, 7); ctx.stroke();
}

function snapPointForGesture() {
  const hit = hitNode(gesture.sx, gesture.sy);
  if (hit && hit.id !== gesture.from) return { x: hit.x, y: hit.y };
  // ending on a line: the hub will go at the nearest point of that line
  const onM = hitMember(gesture.sx, gesture.sy, gesture.from ?? undefined);
  if (onM) return nearestOnMember(onM, wx(gesture.sx), wy(gesture.sy));
  return snapPt(wx(gesture.sx), wy(gesture.sy));
}
function nearestOnMember(m, x, y) {
  const a = getNode(state, m.a), b = getNode(state, m.b);
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0.05, Math.min(0.95, ((x - a.x) * dx + (y - a.y) * dy) / l2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// ============================================================
// HIT TESTING
// ============================================================

function hitNode(px, py, exceptId) {
  let best = null, bestD = HIT_NODE_PX;
  for (const n of state.nodes) {
    if (n.id === exceptId) continue;
    const d = Math.hypot(sx(n.x) - px, sy(n.y) - py);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function hitMember(px, py, exceptNodeId) {
  let best = null, bestD = HIT_MEMBER_PX;
  for (const m of state.members) {
    if (exceptNodeId !== undefined && (m.a === exceptNodeId || m.b === exceptNodeId)) continue;
    const [x1, y1, x2, y2] = memberEnds(m);
    const d = distToSeg(px, py, x1, y1, x2, y2);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ============================================================
// UNDO / REDO  (snapshots of the serialized build; cheap for toy sizes)
// ============================================================

const undoStack = [], redoStack = [];
const snapshot = () => JSON.stringify(serialize(state));

// Call BEFORE a mutation. Identical consecutive snapshots collapse, so it
// is safe to call speculatively (pointerdown on a node that ends up a tap).
function pushUndo() {
  const s = snapshot();
  if (undoStack.length && undoStack[undoStack.length - 1] === s) return;
  undoStack.push(s);
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
  redoStack.length = 0;
  syncUndoButtons();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop());
  setStatus('Undo.');
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop());
  setStatus('Redo.');
}
function restoreSnapshot(s) {
  state = deserialize(JSON.parse(s));     // lands in the build pose
  if (running) setRunning(false);
  syncToolbar();
  syncName();
  syncUndoButtons();
  select(null);
  markDirty();
  draw();
}
function syncUndoButtons() {
  $('undoBtn').disabled = !undoStack.length;
  $('redoBtn').disabled = !redoStack.length;
}
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);

// ============================================================
// POINTER INPUT  (Pointer Events only - mouse / touch / pen)
// ============================================================

const pointers = new Map();   // pointerId -> {sx, sy, startX, startY, moved}
let gesture = null;           // null | {type:'pan'|'pinch'|'dragNode'|'member', ...}

// Board-relative position. clientX minus the canvas rect rather than
// offsetX: identical for real input, and correct for synthetic events too.
function evPos(ev) {
  const r = canvas.getBoundingClientRect();
  return [ev.clientX - r.left, ev.clientY - r.top];
}

canvas.addEventListener('pointerdown', ev => {
  ev.preventDefault();
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic events */ }
  const [ex, ey] = evPos(ev);
  const p = { sx: ex, sy: ey, startX: ex, startY: ey, moved: false };
  pointers.set(ev.pointerId, p);

  if (pointers.size === 2) {
    // second finger: whatever was happening becomes a pinch. Mark BOTH
    // pointers as moved so the finger that lifts last can never count
    // as a tap (a pinch must never place a node).
    const [a, b] = [...pointers.values()];
    a.moved = true; b.moved = true;
    gesture = {
      type: 'pinch',
      dist: Math.hypot(a.sx - b.sx, a.sy - b.sy),
      mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2,
    };
    return;
  }
  if (pointers.size > 2) return;

  const n = hitNode(p.sx, p.sy);
  const gs = groupSet();
  if (tool === 'group' && n && gs && gs.has(n.id)) {
    // drag moves the whole group; a tap removes this node from it
    if (!running) pushUndo();
    gesture = { type: 'dragGroup', id: n.id, ids: [...gs], moved: false };
  } else if (tool === 'group' && n) {
    // a tap adds this node to the group; a drag moves just this node
    if (!running) pushUndo();
    gesture = { type: 'dragNode', id: n.id, moved: false, addToGroup: true };
  } else if (tool === 'group') {
    gesture = { type: 'marquee', x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy };
  } else if (tool === 'select' && n) {
    if (!running) pushUndo();             // a drag is about to move the build pose
    gesture = { type: 'dragNode', id: n.id, moved: false };
  } else if (tool === 'weld' && n) {
    // tap = toggle weld; drag onto another node = merge the two
    pushUndo();
    gesture = { type: 'dragNode', id: n.id, moved: false, weld: true };
  } else if (tool === 'beam' || tool === 'spring' || tool === 'actuator' || tool === 'chain') {
    if (n) {
      gesture = { type: 'member', from: n.id, sx: p.sx, sy: p.sy };
    } else {
      // start anywhere: on a line = a welded hub goes in there, on empty
      // space = a fresh node. Both are created on release, not now.
      const onM = hitMember(p.sx, p.sy);
      const st = snapPt(wx(p.sx), wy(p.sy));
      gesture = { type: 'member', from: null, startM: onM ? onM.id : null, startX: st.x, startY: st.y, sx: p.sx, sy: p.sy };
    }
  } else {
    gesture = { type: 'pan' };
  }
});

canvas.addEventListener('pointermove', ev => {
  const p = pointers.get(ev.pointerId);
  if (!p) return;
  const [nx, ny] = evPos(ev);
  const dxs = nx - p.sx, dys = ny - p.sy;
  if (Math.hypot(nx - p.startX, ny - p.startY) > TAP_PX) p.moved = true;
  p.sx = nx; p.sy = ny;
  if (!gesture) return;

  if (gesture.type === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.sx - b.sx, a.sy - b.sy);
    const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
    if (gesture.dist > 0) zoomAt(mx, my, dist / gesture.dist);
    cam.x -= (mx - gesture.mx) / cam.zoom;
    cam.y += (my - gesture.my) / cam.zoom;
    gesture.dist = dist; gesture.mx = mx; gesture.my = my;
    saveView();
  } else if (gesture.type === 'pan') {
    cam.x -= dxs / cam.zoom;
    cam.y += dys / cam.zoom;
    saveView();
  } else if (gesture.type === 'dragNode' && p.moved) {
    gesture.moved = true;
    const n = getNode(state, gesture.id);
    if (n) {
      const t = snapPt(wx(nx), wy(ny));
      n.x = t.x; n.y = t.y;
      n.px = n.x; n.py = n.y;   // carry, do not fling
    }
  } else if (gesture.type === 'dragGroup' && p.moved) {
    gesture.moved = true;
    const lead = getNode(state, gesture.id);
    if (lead) {
      // the grabbed node snaps; everyone else follows by the same delta,
      // so the group's internal geometry is untouched
      const t = snapPt(wx(nx), wy(ny));
      const dx = t.x - lead.x, dy = t.y - lead.y;
      for (const id of gesture.ids) {
        const n = getNode(state, id);
        if (!n) continue;
        n.x += dx; n.y += dy; n.px = n.x; n.py = n.y;
      }
    }
  } else if (gesture.type === 'marquee') {
    gesture.x1 = nx; gesture.y1 = ny;
  } else if (gesture.type === 'member') {
    gesture.sx = nx; gesture.sy = ny;
  }
  if (!running) draw();
});

function endPointer(ev) {
  const p = pointers.get(ev.pointerId);
  pointers.delete(ev.pointerId);
  if (!p) return;
  if (gesture && gesture.type === 'pinch') {
    if (pointers.size < 2) gesture = null;
    return;
  }
  const g = gesture;
  gesture = null;
  if (ev.type === 'pointercancel') { if (!running) draw(); return; }

  if (g && g.type === 'member') {
    finishMember(g, p);
  } else if (g && g.type === 'dragNode') {
    const dropTarget = g.moved && !g.addToGroup ? hitMember(p.sx, p.sy, g.id) : null;
    if (g.moved && g.weld) {
      const to = hitNode(p.sx, p.sy, g.id);
      if (to) mergeInto(to.id, g.id);
      else if (dropTarget) weldOntoMember(g.id, dropTarget, p);
      else bakeNode(g.id);
    } else if (g.moved && dropTarget) weldOntoMember(g.id, dropTarget, p);
    else if (g.moved) bakeNode(g.id);
    else if (g.addToGroup) toggleInGroup(g.id);
    else tapAt(p.sx, p.sy);
  } else if (g && g.type === 'dragGroup') {
    if (g.moved) bakeGroup(g.ids);
    else toggleInGroup(g.id);
  } else if (g && g.type === 'marquee') {
    finishMarquee(g, p);
  } else if (!p.moved) {
    tapAt(p.sx, p.sy);
  }
  if (!running) draw();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', ev => {
  ev.preventDefault();
  const [zx, zy] = evPos(ev);
  zoomAt(zx, zy, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  saveView();
  if (!running) draw();
}, { passive: false });

function zoomAt(px, py, factor) {
  const wxp = wx(px), wyp = wy(py);
  cam.zoom = Math.max(20, Math.min(500, cam.zoom * factor));
  cam.x = wxp - (px - vw / 2) / cam.zoom;
  cam.y = wyp + (py - vh / 2) / cam.zoom;
}

// ============================================================
// TOOLS / EDITING
// ============================================================

function tapAt(px, py) {
  const n = hitNode(px, py);
  const m = n ? null : hitMember(px, py);

  if (tool === 'erase') {
    if (n) { pushUndo(); removeNode(state, n.id); select(null); markDirty(); }
    else if (m) { pushUndo(); removeMember(state, m.id); select(null); markDirty(); }
    return;
  }
  if (tool === 'weld') {
    if (n) { select('node', n.id); toggleWeld(); return; }
    if (m) { insertHub(m, px, py); return; }
    select(null);
    return;
  }
  if (tool === 'node') {
    if (n) { select('node', n.id); return; }
    if (m) { insertHub(m, px, py); return; }
    pushUndo();
    const t = snapPt(wx(px), wy(py));
    const nn = addNode(state, t.x, t.y);   // born at rest where placed
    select('node', nn.id);
    markDirty();
    return;
  }
  // select / beam / spring / actuator: a tap selects
  if (n) select('node', n.id);
  else if (m) select('member', m.id);
  else select(null);
}

// A node at a spot: an existing node, a welded hub split into the member
// under the spot, or a fresh node on the snap grid.
function nodeAt(px, py, exceptNodeId) {
  const n = hitNode(px, py, exceptNodeId);
  if (n) return n;
  const onM = hitMember(px, py, exceptNodeId);
  if (onM) {
    const t = snapPt(wx(px), wy(py));
    const r = splitMember(state, onM.id, t.x, t.y);
    if (r) return r.node;
  }
  const t = snapPt(wx(px), wy(py));
  return addNode(state, t.x, t.y);
}

function finishMember(g, p) {
  if (!g.from && !p.moved) {
    // a tap with a member tool: put a node there (hub if on a line)
    pushUndo();
    const nn = nodeAt(p.sx, p.sy);
    if (running) rebuildBraces(state, true);
    select('node', nn.id); markDirty();
    setStatus(nn.locked ? 'Welded hub added to the member. Drag from it to build on.' : 'Node placed. Drag from it to build on.');
    return;
  }
  if (!p.moved) { select('node', g.from); return; }   // just a tap on a node
  pushUndo();
  let from = g.from ? getNode(state, g.from) : null;
  if (!from) {
    // the start point: hub into the line it began on, else a new node
    if (g.startM) {
      const r = splitMember(state, g.startM, g.startX, g.startY);
      from = r ? r.node : null;
    }
    if (!from) from = addNode(state, g.startX, g.startY);
  }
  const to = nodeAt(p.sx, p.sy, from.id);
  if (!to || to.id === from.id) { markDirty(); if (running) rebuildBraces(state, true); select('node', from.id); return; }
  const dup = findMember(state, from.id, to.id);
  if (dup) {
    setStatus('Those two nodes are already connected.');
    select('member', dup.id);
    markDirty();
    return;
  }
  if (tool === 'chain') {
    // one link per grid pitch (at least 10 cm), straight; gravity sags it
    const linkLen = Math.max(0.1, prefs.pitch);
    const links = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / linkLen));
    const r = chain(state, from, to, links);
    if (running) rebuildBraces(state, true);
    if (r && r.members.length) select('member', r.members[Math.floor(r.members.length / 2)].id);
    setStatus(`Chain of ${links} link${links === 1 ? '' : 's'}. Anchor one end, or drape it over a solid member.`);
    markDirty();
    return;
  }
  const m = addMember(state, from, to, tool);
  if (running) rebuildBraces(state, true);
  if (m) select('member', m.id);
  markDirty();
}

// Put a welded hub INTO a member at the tapped spot (splits it in two).
function insertHub(m, px, py) {
  const t = snapPt(wx(px), wy(py));
  pushUndo();
  const r = splitMember(state, m.id, t.x, t.y);
  if (!r) { undoStack.pop(); syncUndoButtons(); setStatus('Tap nearer the middle of the member to add a hub.', true); return; }
  if (running) rebuildBraces(state, true);
  markDirty();
  select('node', r.node.id);
  setStatus('Added a welded hub: the member stays straight. Unweld it (Weld tool or panel) for a hinge.');
}

// Drop a dragged node ONTO a member: split the member there (welded hub)
// and merge the dragged node into the hub. The node's own members now
// hang off the line. (Undo was pushed when the drag started.)
function weldOntoMember(nodeId, m, p) {
  const n = getNode(state, nodeId);
  if (!n) return;
  const mass = n.mass;
  const r = splitMember(state, m.id, wx(p.sx), wy(p.sy));
  if (!r) { bakeNode(nodeId); return; }
  const keep = mergeNodes(state, r.node.id, nodeId);
  keep.mass = mass;
  if (running) rebuildBraces(state, true);
  else { keep.rx = keep.x; keep.ry = keep.y; rebuildBraces(state); }
  markDirty();
  select('node', keep.id);
  setStatus(`Welded onto the member: ${membersAt(state, keep.id).length} members meet here.`);
}

// Merge node dropId into keepId (weld tool drag-and-drop).
function mergeInto(keepId, dropId) {
  const keep = mergeNodes(state, keepId, dropId);
  if (!keep) return;
  if (running) rebuildBraces(state, true);
  else { keep.rx = keep.x; keep.ry = keep.y; rebuildBraces(state); }
  markDirty();
  select('node', keep.id);
  setStatus(`Welded together: one joint, ${membersAt(state, keep.id).length} members.`);
}

// group selection helpers
const groupSet = () => (sel.kind === 'group' ? new Set(sel.ids) : null);

function finishMarquee(g, p) {
  if (!p.moved) { select(null); return; }          // a tap on empty space
  const x0 = Math.min(g.x0, g.x1), x1 = Math.max(g.x0, g.x1);
  const y0 = Math.min(g.y0, g.y1), y1 = Math.max(g.y0, g.y1);
  const ids = state.nodes.filter(n => {
    const x = sx(n.x), y = sy(n.y);
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }).map(n => n.id);
  if (!ids.length) { select(null); setStatus('Nothing inside the box.'); return; }
  select('group', ids);
}

function toggleInGroup(id) {
  const gs = groupSet() || new Set();
  if (gs.has(id)) gs.delete(id); else gs.add(id);
  select('group', [...gs]);
}

function bakeGroup(ids) {
  if (!running) {
    for (const id of ids) {
      const n = getNode(state, id);
      if (n) { n.rx = n.x; n.ry = n.y; }
    }
    rebuildBraces(state);
  }
  markDirty();
}

function selectBody(nodeId) {
  select('group', componentOf(state, nodeId));
  setTool('group');
}

function bakeNode(id) {
  const n = getNode(state, id);
  if (!n) return;
  if (!running) {
    // adopt the dragged position as the new build pose for this node
    n.rx = n.x; n.ry = n.y;
    for (const m of membersAt(state, n.id)) {
      const a = getNode(state, m.a), b = getNode(state, m.b);
      m.restLen = Math.hypot(b.x - a.x, b.y - a.y);
    }
    rebuildBraces(state);
    if (sel.kind === 'member') renderProps();   // rest length may have changed
  }
  markDirty();
}

const TOOL_HINTS = {
  select: 'Drag a node to move it (drop it on a line to weld it in). Tap anything to see its settings.',
  group: 'Drag a box around nodes to group them. Tap a node to add or remove it. Drag a grouped node to move the group.',
  weld: 'Tap a node to weld / unweld it. Tap a beam to put a welded hub in it. Drag a node onto another node to merge them.',
  node: 'Tap empty space to place a node.',
  beam: 'Drag anywhere to add a rigid beam: nodes are made where needed. Start or end on a line to weld a hub into it.',
  spring: 'Drag anywhere to add a stretchy spring. Start or end on a line to weld a hub into it.',
  actuator: 'Drag anywhere to add a muscle, then tap it to shape its wave. Start or end on a line to weld a hub into it.',
  chain: 'Drag to lay a chain: one link per grid pitch. Anchor an end, hang a weight, or drape it over a solid member.',
  erase: 'Tap a node or member to delete it.',
};

function setTool(t) {
  tool = t;
  document.querySelectorAll('.palItem').forEach(el =>
    el.classList.toggle('active', el.dataset.tool === t));
  toolHint = TOOL_HINTS[t] || '';
  setHint(toolHint);
}
document.querySelectorAll('.palItem').forEach(el =>
  el.addEventListener('pointerup', () => setTool(el.dataset.tool)));

// ============================================================
// SELECTION / NODE PILL
// ============================================================

function select(kind, id) {
  if (kind === 'group') {
    const ids = [...new Set(id || [])].filter(i => getNode(state, i));
    sel = ids.length ? { kind: 'group', id: 0, ids } : { kind: null, id: 0 };
  } else {
    sel = { kind: kind || null, id: id || 0 };
  }
  renderProps();
  if (!running) draw();        // draw() positions the pill too
  else positionPill();
}

function selectedNode() { return sel.kind === 'node' ? getNode(state, sel.id) : null; }
function selectedMember() { return sel.kind === 'member' ? getMember(state, sel.id) : null; }

const pill = $('nodePill');

function positionPill() {
  const n = selectedNode();
  if (!n) { pill.classList.add('hidden'); return; }
  pill.classList.remove('hidden');
  $('pillAnchor').classList.toggle('active', n.pinned);
  $('pillWeld').classList.toggle('active', n.locked);
  $('pillMass').textContent = fmtMass(n.mass);
  const px = Math.max(8, Math.min(vw - pill.offsetWidth - 8, sx(n.x) - pill.offsetWidth / 2));
  const py = Math.max(8, Math.min(vh - 46, sy(n.y) - 58));
  pill.style.left = px + 'px';
  pill.style.top = py + 'px';
}

const fmtMass = m => `${+m.toFixed(1)} kg`;

function toggleAnchor() {
  const n = selectedNode(); if (!n) return;
  pushUndo();
  n.pinned = !n.pinned;
  if (n.pinned) { n.px = n.x; n.py = n.y; }
  afterNodeEdit(n.pinned ? 'Anchored: this node is fixed to the world.' : 'Released: the node moves freely again.');
}
function toggleWeld() {
  const n = selectedNode(); if (!n) return;
  pushUndo();
  n.locked = !n.locked;
  rebuildBraces(state, running);
  const k = membersAt(state, n.id).length;
  afterNodeEdit(n.locked
    ? (k >= 2 ? 'Welded: members meeting here now keep their angles.'
              : 'Welded. It needs 2+ members here to have any effect.')
    : 'Unwelded: this joint is a free hinge again.');
}
function cycleMass() {
  const n = selectedNode(); if (!n) return;
  pushUndo();
  // jump to the next preset above the current mass (wraps around)
  const next = MASS_STEPS.find(m => m > n.mass + 1e-9) ?? MASS_STEPS[0];
  n.mass = next;
  afterNodeEdit(`Mass ${fmtMass(next)}.`);
}
function deleteSelectedNode() {
  const n = selectedNode(); if (!n) return;
  pushUndo();
  removeNode(state, n.id);
  select(null); markDirty();
}
function afterNodeEdit(msg) {
  setStatus(msg);
  renderProps();
  markDirty();
  if (!running) draw(); else positionPill();
}
$('pillAnchor').addEventListener('click', toggleAnchor);
$('pillWeld').addEventListener('click', toggleWeld);
$('pillMass').addEventListener('click', cycleMass);
$('pillDel').addEventListener('click', deleteSelectedNode);

// ============================================================
// PROJECT NAME  (lives in the build file; the title is the field)
// ============================================================

const nameEl = $('projName');
function syncName() {
  const nm = state.name || 'Untitled';
  nameEl.value = nm;
  nameEl.size = Math.max(6, Math.min(36, nm.length + 1));
  document.title = `${nm} - TrussForge`;
}
nameEl.addEventListener('change', () => {
  const v = nameEl.value.trim().slice(0, 64) || 'Untitled';
  if (v !== state.name) {
    pushUndo();
    state.name = v;
    markDirty();
    setStatus(`Renamed to "${v}". Save stores it on the server under that name.`);
  }
  syncName();
});
nameEl.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); nameEl.blur(); }
  ev.stopPropagation();       // typing a name must not trigger tool shortcuts
});
nameEl.addEventListener('focus', () => nameEl.select());

// ============================================================
// CLIPBOARD  (copy / paste / duplicate of substructures)
// ============================================================

let clip = null;    // fragment from extractSub + where it came from
try { clip = JSON.parse(localStorage.getItem(CLIP_KEY)); } catch (e) { clip = null; }

function idsToCopy() {
  if (sel.kind === 'group') return sel.ids;
  if (sel.kind === 'node') return componentOf(state, sel.id);
  if (sel.kind === 'member') { const m = selectedMember(); return m ? componentOf(state, m.a) : []; }
  return [];
}

function copySelection() {
  const ids = idsToCopy();
  if (!ids.length) { setStatus('Nothing to copy: group some nodes first (Group tool).'); return false; }
  const frag = extractSub(state, ids);
  const b = fragmentBounds(frag);
  clip = { frag, src: { cx: b.cx, cy: b.cy } };
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch (e) { /* ignore */ }
  syncPasteButton();
  setStatus(`Copied ${frag.nodes.length} nodes, ${frag.members.length} members.`);
  return true;
}

// Paste to the right of where it was copied if that spot is on screen,
// otherwise into the middle of the view. Never below the ground.
function pasteClipboard() {
  if (!clip || !clip.frag || !clip.frag.nodes.length) { setStatus('Clipboard is empty.'); return; }
  const b = fragmentBounds(clip.frag);
  const srcOnScreen = clip.src && (vw < 50 ||
    (sx(clip.src.cx) > 0 && sx(clip.src.cx) < vw && sy(clip.src.cy) > 0 && sy(clip.src.cy) < vh));
  let tx, ty;
  if (srcOnScreen) { tx = clip.src.cx + b.w + 0.5; ty = clip.src.cy; }
  else { tx = wx(vw / 2); ty = wy(vh / 2); }
  let dx = tx - b.cx, dy = ty - b.cy;
  if (b.y0 + dy < 0) dy = -b.y0;            // keep it above ground
  if (snapOn) { const v = snapVec(dx, dy); dx = v.x; dy = v.y; }
  pushUndo();
  const ids = insertSub(state, clip.frag, dx, dy);
  if (running) rebuildBraces(state, true);
  clip.src = { cx: b.cx + dx, cy: b.cy + dy };   // a second paste lands further right
  markDirty();
  setTool('group');
  select('group', ids);
  setStatus('Pasted. Drag a grouped node to move it into place.');
}

function duplicateSelection() { if (copySelection()) pasteClipboard(); }

function syncPasteButton() {
  $('pasteBtn').disabled = !(clip && clip.frag && clip.frag.nodes.length);
}
$('pasteBtn').addEventListener('click', pasteClipboard);

// ============================================================
// PROPERTIES PANEL  (node / member / group / world / legend)
// ============================================================

const propsEl = $('props');
const propsBody = $('propsBody');
$('propsClose').addEventListener('click', () => {
  if (sel.kind === 'world') select(null);
  else if (sel.kind === 'grid') select(null);
  else propsEl.classList.remove('open');
});

// hovering / tapping a row shows its explanation in the hint bar
propsBody.addEventListener('pointerover', ev => {
  const row = ev.target.closest('[data-tip]');
  if (row) setHint(row.dataset.tip);
});
propsBody.addEventListener('pointerleave', () => setHint(toolHint));

const LEGEND_HTML = `
<div class="legend">
  <h4>How it works</h4>
  <p><b>Nodes</b> are point masses. Drag them with Select. Round = hinge, square = welded.</p>
  <p><span class="sw" style="background:#8b9cb6"></span><b>Beam</b> - rigid stick, holds its length.</p>
  <p><span class="sw" style="background:#58a6ff"></span><b>Spring</b> - stretchy; stiffness and damping.</p>
  <p><span class="sw" style="background:#e3b341"></span><b>Actuator</b> - a muscle. Its length follows a wave. Give muscles different phases to make a gait.</p>
  <p><b>Chain</b> - a run of rigid links (Chain tool, <kbd>C</kbd>). Sags, swings, wraps over solid members.</p>
  <p><b>Anchor</b> - fixes a node to the world.</p>
  <p><b>Solid</b> (member panel) - a member other bodies land on and slide along. Pass-through by default. Anchored solid beams = ramps and platforms.</p>
  <p><b>Weld</b> - members meeting at a node keep their angles (rigid joint).</p>
  <p><b>View</b> button: theme (dark / soft / light paper), square or triangle lattice, pitch, brightness (<kbd>[</kbd> <kbd>]</kbd> change pitch). Per device, not saved with builds.</p>
  <p><b>Weld</b> tool (<kbd>W</kbd>): tap a node to weld it, tap a beam to add a welded hub, drag a node onto another to merge.</p>
  <p><b>Dial</b>: the card over the board turns the selected thing's numbers. Chips pick which one; <b>=</b> opens the full sheet. Drag its grip bar to move it.</p>
  <p><b>Lines</b>: beams, springs and muscles can start anywhere. Start or end a drag on a line, or drop a node on one, and a welded hub goes in there.</p>
  <p><b>Group</b> tool: box-select nodes, then copy / paste / mirror / move them. "Select body" on a node or member grabs the whole creature.</p>
  <p><b>Force view</b> (<kbd>F</kbd>) colors members: <span style="color:#ff5648">red = tension</span>, <span style="color:#40a0ff">blue = compression</span>. Full color = carrying the whole build's weight.</p>
  <p class="keys"><kbd>Space</kbd> run <kbd>R</kbd> reset <kbd>G</kbd> snap <kbd>Ctrl+Z</kbd> undo<br>
  <kbd>V</kbd> <kbd>M</kbd> <kbd>W</kbd> <kbd>N</kbd> <kbd>B</kbd> <kbd>S</kbd> <kbd>A</kbd> <kbd>C</kbd> <kbd>E</kbd> tools <kbd>Del</kbd> delete<br>
  <kbd>Ctrl+C</kbd> copy <kbd>Ctrl+V</kbd> paste <kbd>Ctrl+D</kbd> duplicate <kbd>Ctrl+A</kbd> all</p>
</div>`;

const MEMBER_DESC = {
  beam: 'Rigid stick. Holds its length exactly.',
  chain: 'One rigid chain link. Runs of them sag, swing and wrap over solid members. The Chain tool lays a run in one drag.',
  spring: 'Stretchy. Stiffness sets the pull, damping kills the bounce.',
  actuator: 'A muscle: its length follows the wave. Offset the phase between muscles to make a gait.',
};

const TIPS = {
  kind: 'Change what this member is. Beams and muscles are rigid, springs stretch.',
  restLen: 'Length the member wants to be. Change it while paused to pre-stress the build.',
  k: 'How hard the spring pulls back per meter of stretch.',
  c: 'How fast the spring stops bouncing. 0 = rings forever.',
  wtype: 'sine = smooth push/pull. triangle = constant-speed back and forth. smooth = holds long, holds short, rounded transitions.',
  lo: 'Shortest the muscle contracts to.',
  hi: 'Longest the muscle extends to. It swings between the two lengths.',
  amp: 'How far the length swings, as a fraction of the mid length (+/-).',
  period: 'Seconds per cycle. All muscles share one clock.',
  phase: 'Offset into the cycle. Stops at 1/24 steps so 1/2, 1/3, 1/4, 1/6, 1/8 and 1/12 land exactly. 1/2 = opposite of a phase-0 muscle.',
  solid: 'Solid members are surfaces: nodes of OTHER bodies land on them and slide with friction. Default is pass-through. Build ramps and platforms from anchored solid beams.',
  duty: 'Fraction of each cycle spent at the long length (smooth wave).',
  mass: 'Heavier nodes swing harder and sink into springs more.',
  anchor: 'Anchor: fixed to the world, never moves. Good for hanging things and pivots.',
  weld: 'Weld: members meeting here keep their angles. Needs 2+ members to do anything.',
  gravity: 'Downward pull in m/s^2. Earth is 9.8. 0 = floaty.',
  body: 'Select every node connected to this one (the whole creature) as a group.',
  copy: 'Copy the group to the clipboard (Ctrl+C). Survives reloads.',
  paste: 'Paste a copy next to the original, or mid-view (Ctrl+V). Ctrl+D duplicates in one go.',
  mirror: 'Flip the group left-right about its centre. A mirrored walker walks the other way.',
  spread: 'Give the muscles evenly spaced phases from left to right - the quickest way to a gait.',
  force: 'Axial force through this member right now. Tension pulls its ends together, compression pushes them apart. Toggle the force view (F) to see the whole build.',
  theme: 'Forge and Slate are dark; Paper is light for phones in daylight. Per device.',
  gtype: 'square = classic. triangles = every cell is an equilateral triangle: trusses, domes and hex frames snap exactly.',
  gpitch: 'Distance between grid points, meters. Smaller = finer detail.',
  gstyle: 'Dots or full lines.',
  gbright: 'How visible the grid is. Turn it up on a phone in daylight.',
  gsize: 'Dot size / line thickness in pixels.',
  friction: 'Friction coefficient. 0 = ice, 0.7 = rubber, 2 = glue. A foot only grips as hard as it is pressed down, so a lifting foot slides free.',
  drag: 'Air resistance. Higher = everything settles faster.',
  speed: 'Simulation speed. 0.25x for slow motion.',
};

// ---- value pod: dial + chips floating over the board (ForgeKit) --------
// Shows the numeric properties of the selection in the editing window.
// On phones the member / node sheet no longer opens by itself: turn the
// dial, or press "=" for the full sheet.
const pod = new ValuePod($('boardWrap'), {
  // phones: bottom-right for the thumb; desktops: top-right, next to the
  // panel and the toolbar. Drag the grip to move it; remembered.
  position: narrow.matches ? 'bottom-right' : 'top-right',
  storageKey: 'trussforge.pod',
  onStart: () => pushUndo(),
  onChange: () => { refreshSliders(); markDirty(); if (!running) draw(); else positionPill(); },
  onMore: () => { openSheet(true); },
});

function podTargets() {
  const n = selectedNode(), m = selectedMember();
  if (n) {
    return { title: 'Node', targets: [
      { key: 'mass', label: 'mass', unit: 'kg', min: 0.05, max: 5, step: 0.05, get: () => n.mass, set: v => { n.mass = v; } },
    ] };
  }
  if (m) {
    const T = [];
    const lenMax = Math.max(4, Math.ceil(m.restLen * 1.6 * 20) / 20);
    if (m.kind !== 'actuator') {
      T.push({ key: 'restLen', label: 'rest', unit: 'm', min: 0.1, max: lenMax, step: 0.05, get: () => m.restLen, set: v => { m.restLen = v; rebuildBraces(state, running); } });
    }
    if (m.kind === 'spring') {
      T.push({ key: 'k', label: 'stiffness', unit: 'N/m', min: 1, max: 400, step: 1, get: () => m.k, set: v => { m.k = v; } });
      T.push({ key: 'c', label: 'damping', min: 0, max: 10, step: 0.1, get: () => m.c, set: v => { m.c = v; } });
    }
    if (m.kind === 'actuator') {
      T.push({ key: 'lo', label: 'short', unit: 'm', min: 0.05, max: lenMax, step: 0.01, get: () => m.restLen * (1 - m.wave.amp), set: v => setActuatorLengths(m, v, null) });
      T.push({ key: 'hi', label: 'long', unit: 'm', min: 0.05, max: lenMax, step: 0.01, get: () => m.restLen * (1 + m.wave.amp), set: v => setActuatorLengths(m, null, v) });
      T.push({ key: 'period', label: 'period', unit: 's', min: 0.2, max: 4, step: 0.05, get: () => m.wave.period, set: v => { m.wave.period = v; } });
      T.push({ key: 'phase', label: 'phase', min: 0, max: 1, step: 1 / 24, fmt: fmtPhase, get: () => m.wave.phase, set: v => { m.wave.phase = v; } });
      if (m.wave.type === 'smooth' || m.wave.type === 'square') {
        T.push({ key: 'duty', label: 'long time', min: 0.05, max: 0.95, step: 0.05, get: () => m.wave.duty, set: v => { m.wave.duty = v; } });
      }
    }
    return { title: { beam: 'Beam', spring: 'Spring', actuator: 'Actuator', chain: 'Chain link' }[m.kind], targets: T };
  }
  if (sel.kind === 'group') {
    const gs = groupSet();
    const acts = state.members.filter(x => gs.has(x.a) && gs.has(x.b) && x.kind === 'actuator');
    if (!acts.length) return { title: `Group: ${sel.ids.length} nodes`, targets: [] };
    return { title: `Group: ${acts.length} muscle${acts.length === 1 ? '' : 's'}`, targets: [
      { key: 'gperiod', label: 'period (all)', unit: 's', min: 0.2, max: 4, step: 0.05, get: () => acts[0].wave.period, set: v => { for (const a of acts) a.wave.period = v; } },
      { key: 'gamp', label: 'amplitude (all)', min: 0, max: 0.45, step: 0.01, get: () => acts[0].wave.amp, set: v => { for (const a of acts) a.wave.amp = v; } },
    ] };
  }
  if (sel.kind === 'world') {
    const W = state.world;
    return { title: 'World', targets: [
      { key: 'gravity', label: 'gravity', unit: 'm/s2', min: 0, max: 25, step: 0.1, get: () => W.gravity, set: v => { W.gravity = v; } },
      { key: 'friction', label: 'grip', min: 0, max: 2, step: 0.01, get: () => W.friction, set: v => { W.friction = v; } },
      { key: 'drag', label: 'air drag', min: 0, max: 2, step: 0.01, get: () => W.drag, set: v => { W.drag = v; } },
    ] };
  }
  if (sel.kind === 'grid') {
    return { title: 'View', targets: [
      { key: 'gbright', label: 'grid brightness', min: 0, max: 1, step: 0.05, get: () => prefs.gridBright, set: v => { prefs.gridBright = v; savePrefs(); } },
      { key: 'gsize', label: 'grid size', unit: 'px', min: 1, max: 4, step: 0.5, get: () => prefs.gridSize, set: v => { prefs.gridSize = v; savePrefs(); } },
    ] };
  }
  return null;
}

function syncPod() {
  const pt = podTargets();
  if (!pt) { pod.hide(); return; }
  pod.show(pt.targets, { title: pt.title, active: pod.active && pod.active.key });
}

// after a dial turn, keep the side panel's sliders in step
function refreshSliders() {
  for (const t of pod.targets) {
    const el = $('pp_' + t.key);
    if (!el) continue;
    const v = t.get();
    el.value = v;
    const pv = $('pv_' + t.key);
    if (pv) pv.textContent = t.key === 'phase' ? fmtPhase(v) : fmtVal(v) + ' ' + (pv.dataset.unit || '');
  }
  if (sel.kind === 'node') positionPill();
}

function renderProps() {
  renderPropsInner();
  syncPod();
}

function renderPropsInner() {
  $('worldBtn').classList.toggle('active', sel.kind === 'world');
  const n = selectedNode(), m = selectedMember();
  $('gridBtn').classList.toggle('active', sel.kind === 'grid');
  if (sel.kind === 'world') { renderWorldProps(); openSheet(true); return; }
  if (sel.kind === 'grid') { renderGridProps(); openSheet(true); return; }
  // phone: node / member / group selections show the pod; "=" opens the sheet
  if (n) { renderNodeProps(n); openSheet(false); return; }
  if (sel.kind === 'group') { renderGroupProps(); openSheet(false); return; }
  if (m) { renderMemberProps(m); openSheet(false); return; }
  propsBody.innerHTML = LEGEND_HTML;
  openSheet(false);
}
function openSheet(open) { propsEl.classList.toggle('open', open); }

function renderNodeProps(n) {
  const k = membersAt(state, n.id).length;
  propsBody.innerHTML = `
    <div class="propTitle">Node</div>
    <p class="desc">A point mass with ${k} member${k === 1 ? '' : 's'}. Round = hinge, square = welded.</p>
    <div class="toggles">
      <button id="npAnchor" class="${n.pinned ? 'active' : ''}" data-tip="${TIPS.anchor}" title="${TIPS.anchor}">Anchor</button>
      <button id="npWeld" class="${n.locked ? 'active' : ''}" data-tip="${TIPS.weld}" title="${TIPS.weld}">Weld</button>
    </div>
    ${propSlider('mass', 'mass', 0.05, 5, 0.05, n.mass, 'kg')}
    <div class="propBtns"><button id="npBody" data-tip="${TIPS.body}" title="${TIPS.body}">Select body</button><button id="npDel" class="danger">Delete node</button></div>`;
  $('npAnchor').addEventListener('click', toggleAnchor);
  $('npWeld').addEventListener('click', toggleWeld);
  $('npBody').addEventListener('click', () => selectBody(n.id));
  $('npDel').addEventListener('click', deleteSelectedNode);
  wireProp('mass', v => { n.mass = v; });
}

function renderMemberProps(m) {
  const rows = [];
  const title = { beam: 'Beam', spring: 'Spring', actuator: 'Actuator', chain: 'Chain link' }[m.kind];
  rows.push(`<div class="propTitle">${title}</div>`);
  rows.push(`<p class="desc">${MEMBER_DESC[m.kind]}</p>`);
  rows.push(propSelect('kind', 'type', ['beam', 'spring', 'actuator', 'chain'], m.kind));
  rows.push(`<div class="toggles" data-tip="${TIPS.solid}" title="${TIPS.solid}">
    <button id="mSolid" class="${m.solid ? 'active' : ''}">${m.solid ? 'Solid: things collide with it' : 'Pass-through (tap for solid)'}</button></div>`);
  // a freeform build can be longer than the default range: widen it
  const lenMax = Math.max(4, Math.ceil(m.restLen * 1.6 * 20) / 20);
  if (m.kind !== 'actuator') rows.push(propSlider('restLen', 'rest length', 0.1, lenMax, 0.05, m.restLen, 'm'));
  if (m.kind === 'spring') {
    rows.push(propSlider('k', 'stiffness', 1, 400, 1, m.k, 'N/m'));
    rows.push(propSlider('c', 'damping', 0, 10, 0.1, m.c, ''));
  }
  if (m.kind === 'actuator') {
    const lo = m.restLen * (1 - m.wave.amp), hi = m.restLen * (1 + m.wave.amp);
    rows.push(propSelect('wtype', 'waveform', WAVE_TYPES, WAVE_TYPES.includes(m.wave.type) ? m.wave.type : 'smooth'));
    rows.push(propSlider('lo', 'short length', 0.05, lenMax, 0.01, lo, 'm'));
    rows.push(propSlider('hi', 'long length', 0.05, lenMax, 0.01, hi, 'm'));
    rows.push(propSlider('period', 'period', 0.2, 4, 0.05, m.wave.period, 's'));
    rows.push(propSlider('phase', 'phase', 0, 1, 1 / 24, m.wave.phase, ''));
    if (m.wave.type === 'smooth' || m.wave.type === 'square') {
      rows.push(propSlider('duty', 'time spent long', 0.05, 0.95, 0.05, m.wave.duty, ''));
    }
  }
  rows.push(`<div class="propRow readout" data-tip="${TIPS.force}" title="${TIPS.force}"><label>force <span class="pv" id="pv_force">${fmtForce(memberForce(m))}</span></label></div>`);
  rows.push(`<div class="propBtns"><button id="mBody" data-tip="${TIPS.body}" title="${TIPS.body}">Select body</button><button id="mDel" class="danger">Delete</button></div>`);
  propsBody.innerHTML = rows.join('');
  $('mBody').addEventListener('click', () => selectBody(m.a));

  if (m.kind !== 'actuator') wireProp('restLen', v => { m.restLen = v; rebuildBraces(state, running); });
  if (m.kind === 'spring') {
    wireProp('k', v => { m.k = v; });
    wireProp('c', v => { m.c = v; });
  }
  if (m.kind === 'actuator') {
    wireSel('wtype', v => { m.wave.type = v; renderProps(); });
    wireProp('lo', v => { setActuatorLengths(m, v, null); refreshSliders(); });
    wireProp('hi', v => { setActuatorLengths(m, null, v); refreshSliders(); });
    wireProp('period', v => { m.wave.period = v; });
    wireProp('phase', v => { m.wave.phase = v; });
    if (m.wave.type === 'smooth' || m.wave.type === 'square') wireProp('duty', v => { m.wave.duty = v; });
  }
  wireSel('kind', v => { changeKind(m, v); });
  $('mSolid').addEventListener('click', () => {
    pushUndo();
    m.solid = !m.solid;
    markDirty(); renderProps();
    setStatus(m.solid ? 'Solid: nodes of other bodies now bounce off and slide on this member.' : 'Pass-through: nothing collides with this member.');
    if (!running) draw();
  });
  $('mDel').addEventListener('click', () => {
    pushUndo();
    removeMember(state, m.id);
    select(null); markDirty();
  });
}

function renderGroupProps() {
  const gs = groupSet();
  const ids = sel.ids;
  const mems = state.members.filter(m => gs.has(m.a) && gs.has(m.b));
  const acts = mems.filter(m => m.kind === 'actuator');
  const rows = [];
  rows.push(`<div class="propTitle">Group</div>`);
  rows.push(`<p class="desc">${ids.length} node${ids.length === 1 ? '' : 's'}, ${mems.length} member${mems.length === 1 ? '' : 's'}${acts.length ? `, ${acts.length} muscle${acts.length === 1 ? '' : 's'}` : ''}. Drag a grouped node to move them all.</p>`);
  rows.push(`<div class="propBtns"><button id="gCopy" data-tip="${TIPS.copy}" title="${TIPS.copy}">Copy</button><button id="gPaste" data-tip="${TIPS.paste}" title="${TIPS.paste}">Paste</button></div>`);
  rows.push(`<div class="propBtns"><button id="gMirror" data-tip="${TIPS.mirror}" title="${TIPS.mirror}">Mirror</button><button id="gDel" class="danger">Delete</button></div>`);
  if (acts.length) {
    rows.push(`<div class="propTitle" style="margin-top:10px">Muscles in group</div>`);
    rows.push(propSlider('gperiod', 'period (all)', 0.2, 4, 0.05, acts[0].wave.period, 's'));
    rows.push(propSlider('gamp', 'amplitude (all)', 0, 0.45, 0.01, acts[0].wave.amp, '+/-'));
    rows.push(`<div class="propBtns"><button id="gSpread" data-tip="${TIPS.spread}" title="${TIPS.spread}">Spread phases</button></div>`);
  }
  propsBody.innerHTML = rows.join('');
  $('gCopy').addEventListener('click', copySelection);
  $('gPaste').addEventListener('click', pasteClipboard);
  $('gPaste').disabled = !(clip && clip.frag);
  $('gMirror').addEventListener('click', () => {
    pushUndo();
    mirrorSub(state, ids);
    if (running) rebuildBraces(state, true);
    markDirty(); setStatus('Mirrored left-right.');
    if (!running) draw();
  });
  $('gDel').addEventListener('click', deleteGroup);
  if (acts.length) {
    wireProp('gperiod', v => { for (const m of acts) m.wave.period = v; });
    wireProp('gamp', v => { for (const m of acts) m.wave.amp = v; });
    $('gSpread').addEventListener('click', () => {
      pushUndo();
      const mid = m => { const a = getNode(state, m.a), b = getNode(state, m.b); return (a.rx + b.rx) / 2; };
      const sorted = [...acts].sort((p, q) => mid(p) - mid(q));
      sorted.forEach((m, i) => { m.wave.phase = +(i / sorted.length).toFixed(3); });
      markDirty();
      setStatus(`Phases spread 0 .. ${((sorted.length - 1) / sorted.length).toFixed(2)} left to right.`);
    });
  }
}

function deleteGroup() {
  if (sel.kind !== 'group') return;
  pushUndo();
  for (const id of sel.ids) removeNode(state, id);
  select(null); markDirty();
}

function renderGridProps() {
  propsBody.innerHTML = `
    <div class="propTitle">View</div>
    <p class="desc">Theme and snap grid. Lives on this device, not in the build file - open any save and change it to fit the design.</p>
    ${propSelect('theme', 'theme', themeNames(), prefs.theme, v => THEMES[v].label)}
    ${propSelect('gtype', 'lattice', ['square', 'tri'], prefs.gridType, v => ({ square: 'square', tri: 'triangles (equilateral)' })[v])}
    ${propSelect('gpitch', 'pitch', PITCHES.map(String), String(prefs.pitch), v => v + ' m')}
    ${propSelect('gstyle', 'style', ['dots', 'lines'], prefs.gridStyle)}
    ${propSlider('gbright', 'brightness', 0, 1, 0.05, prefs.gridBright, '')}
    ${propSlider('gsize', 'dot / line size', 1, 4, 0.5, prefs.gridSize, 'px')}
    <div class="propBtns"><button id="gReset">Defaults</button></div>`;
  wirePref('theme', v => { prefs.theme = v; theme = applyTheme(v); });
  wirePref('gtype', v => { prefs.gridType = v; });
  wirePref('gpitch', v => { prefs.pitch = parseFloat(v); });
  wirePref('gstyle', v => { prefs.gridStyle = v; });
  wirePref('gbright', v => { prefs.gridBright = parseFloat(v); });
  wirePref('gsize', v => { prefs.gridSize = parseFloat(v); });
  $('gReset').addEventListener('click', () => { prefs = { ...PREF_DEFAULTS }; savePrefs(); theme = applyTheme(prefs.theme); renderProps(); if (!running) draw(); });
}
// prefs are not part of the build: no undo entry, no autosave
function wirePref(id, fn) {
  const el = $('pp_' + id);
  const ev = el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(ev, () => {
    fn(el.value);
    const pv = $('pv_' + id);
    if (pv) pv.textContent = fmtVal(parseFloat(el.value)) + ' ' + pv.dataset.unit;
    savePrefs();
    if (!running) draw();
  });
}

function renderWorldProps() {
  const W = state.world;
  propsBody.innerHTML = `
    <div class="propTitle">World</div>
    <p class="desc">Applies to the whole build. Saved with it.</p>
    ${propSlider('gravity', 'gravity', 0, 25, 0.1, W.gravity, 'm/s2')}
    ${propSlider('friction', 'ground grip', 0, 2, 0.01, W.friction, '')}
    ${propSlider('drag', 'air drag', 0, 2, 0.01, W.drag, '')}
    ${propSelect('speed', 'sim speed', ['0.25', '0.5', '1', '2', '4'], String(W.speed), v => v + 'x')}`;
  wireProp('gravity', v => { W.gravity = v; });
  wireProp('friction', v => { W.friction = v; });
  wireProp('drag', v => { W.drag = v; });
  wireSel('speed', v => { W.speed = parseFloat(v); });
}

function propSlider(id, label, min, max, stepv, val, unit) {
  const tip = TIPS[id] || '';
  return `<div class="propRow" data-tip="${tip}" title="${tip}">
    <label for="pp_${id}">${label} <span class="pv" id="pv_${id}" data-unit="${unit}">${id === 'phase' ? fmtPhase(val) : fmtVal(val) + ' ' + unit}</span></label>
    <input type="range" id="pp_${id}" min="${min}" max="${max}" step="${stepv}" value="${val}"></div>`;
}
function propSelect(id, label, opts, val, show = o => o) {
  const tip = TIPS[id] || '';
  const os = opts.map(o => `<option value="${o}"${o === val ? ' selected' : ''}>${show(o)}</option>`).join('');
  return `<div class="propRow" data-tip="${tip}" title="${tip}"><label for="pp_${id}">${label}</label><select id="pp_${id}">${os}</select></div>`;
}
// Sliders push ONE undo entry per drag (on pointerdown), not one per tick.
function wireProp(id, fn) {
  const el = $('pp_' + id);
  el.addEventListener('pointerdown', pushUndo);
  el.addEventListener('keydown', pushUndo);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    const pv = $('pv_' + id);
    pv.textContent = id === 'phase' ? fmtPhase(v) : fmtVal(v) + ' ' + pv.dataset.unit;
    fn(v);
    pod.refresh();
    markDirty();
    if (!running) draw();
  });
}
function wireSel(id, fn) {
  const el = $('pp_' + id);
  el.addEventListener('change', () => { pushUndo(); fn(el.value); markDirty(); if (!running) draw(); });
}
const fmtVal = v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
// phase detents are 1/24 of a cycle: show the reduced fraction + degrees
function fmtPhase(v) {
  let k = Math.round(v * 24), d = 24;
  if (k === 0 || k === 24) return '0 (0 deg)';
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(k, d); k /= g; d /= g;
  return `${k}/${d} (${Math.round(v * 360)} deg)`;
}

// short / long lengths map onto restLen (mid) + amp (half-swing / mid)
function setActuatorLengths(m, lo, hi) {
  let L = lo ?? m.restLen * (1 - m.wave.amp), H = hi ?? m.restLen * (1 + m.wave.amp);
  if (lo != null && L > H - 0.02) H = L + 0.02;
  if (hi != null && H < L + 0.02) L = H - 0.02;
  L = Math.max(0.03, L); H = Math.max(L + 0.02, H);
  m.restLen = (L + H) / 2;
  m.wave.amp = (H - L) / (H + L);
  rebuildBraces(state, running);
}

function changeKind(m, kind) {
  m.kind = kind;
  if (kind === 'actuator' && !m.wave) m.wave = { ...DEFAULTS.wave };
  if (kind !== 'actuator') m.wave = null;
  renderProps();
}

// ============================================================
// TOOLBAR
// ============================================================

$('ver').textContent = `v${APP_VERSION} - ${BUILD_DATE}`;

const runBtn = $('runBtn');
function setRunning(r) {
  running = r;
  runBtn.textContent = r ? 'Pause' : 'Run';
  runBtn.classList.toggle('running', r);
  if (r) { acc = 0; lastTs = 0; }
  setStatus(r ? 'Running.' : 'Paused.');
  if (!r) draw();
}
runBtn.addEventListener('click', () => setRunning(!running));

$('resetBtn').addEventListener('click', () => {
  reset(state);
  if (running) setRunning(false);      // reset means "stop and go back", not "restart"
  setStatus('Reset to build pose. Paused.');
  updateForceReadout();
  draw();
});

$('snapBtn').addEventListener('click', () => {
  snapOn = !snapOn;
  $('snapBtn').classList.toggle('active', snapOn);
  if (!running) draw();
});
$('gravBtn').addEventListener('click', () => {
  pushUndo();
  state.world.gravityOn = !state.world.gravityOn;
  syncToolbar();
  setStatus(state.world.gravityOn ? 'Gravity on.' : 'Gravity off.');
  markDirty();
});
$('followBtn').addEventListener('click', () => {
  follow = !follow;
  $('followBtn').classList.toggle('active', follow);
});
$('strainBtn').addEventListener('click', () => {
  strainOn = !strainOn;
  $('strainBtn').classList.toggle('active', strainOn);
  setStatus(strainOn ? 'Force view: red = tension, blue = compression.' : 'Force view off.');
  if (!running) draw();
});
$('worldBtn').addEventListener('click', () => {
  select(sel.kind === 'world' ? null : 'world');
});
$('gridBtn').addEventListener('click', () => {
  select(sel.kind === 'grid' ? null : 'grid');
});
// [ and ] step the grid pitch through the standard set
function stepPitch(dir) {
  const i = PITCHES.indexOf(prefs.pitch);
  const j = Math.max(0, Math.min(PITCHES.length - 1, i + dir));
  prefs.pitch = PITCHES[j];
  savePrefs();
  setStatus(`Grid pitch ${prefs.pitch} m.`);
  if (sel.kind === 'grid') renderProps();
  if (!running) draw();
}

// toolbar state that lives in the world/build (gravity toggle, world panel)
function syncToolbar() {
  $('gravBtn').classList.toggle('active', state.world.gravityOn);
  if (sel.kind === 'world') renderProps();
}

$('clearBtn').addEventListener('click', () => {
  if (!state.nodes.length) return;
  pushUndo();
  state = createState();
  select(null);
  setRunning(false);
  syncToolbar();
  syncName();
  markDirty();
  setStatus('Cleared. Ctrl+Z (or the undo arrow) brings it back.');
  draw();
});

// Buttons keep keyboard focus after a click, so Space would re-press
// them AND fire the run/pause shortcut. Drop focus once clicked.
document.addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (b) b.blur();
});

// keyboard
window.addEventListener('keydown', ev => {
  const tag = ev.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const k = ev.key.toLowerCase();
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && k === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
  else if (mod && k === 'y') { ev.preventDefault(); redo(); }
  else if (mod && k === 's') { ev.preventDefault(); saveToServer(); }
  else if (mod && k === 'o') { ev.preventDefault(); openLibrary(); }
  else if (mod && k === 'c') { ev.preventDefault(); copySelection(); }
  else if (mod && k === 'v') { ev.preventDefault(); pasteClipboard(); }
  else if (mod && k === 'd') { ev.preventDefault(); duplicateSelection(); }
  else if (mod && k === 'a') { ev.preventDefault(); select('group', state.nodes.map(n => n.id)); setTool('group'); }
  else if (mod) return;
  else if (k === ' ') { ev.preventDefault(); setRunning(!running); }
  else if (k === 'r') $('resetBtn').click();
  else if (k === 'g') $('snapBtn').click();
  else if (k === 'f') $('strainBtn').click();
  else if (k === '[') stepPitch(-1);
  else if (k === ']') stepPitch(1);
  else if (k === 'v') setTool('select');
  else if (k === 'm') setTool('group');
  else if (k === 'w') setTool('weld');
  else if (k === 'c') setTool('chain');
  else if (k === 'n') setTool('node');
  else if (k === 'b') setTool('beam');
  else if (k === 's') setTool('spring');
  else if (k === 'a') setTool('actuator');
  else if (k === 'e') setTool('erase');
  else if (k === 'escape') { if (!libModal.classList.contains('hidden')) closeLibrary(); else select(null); }
  else if (k === 'delete' || k === 'backspace') {
    if (selectedNode()) deleteSelectedNode();
    else if (sel.kind === 'group') deleteGroup();
    else if (selectedMember()) { pushUndo(); removeMember(state, sel.id); select(null); markDirty(); }
  }
});

// ============================================================
// SAVE / OPEN / AUTOSAVE
// ============================================================

// The build library lives on the server that serves the app
// (tools/serve.py, same origin: no CORS). Save = PUT under the project
// name; if the server is unreachable (file:// or a plain static host)
// the build is downloaded as a file instead, so a save never silently
// goes nowhere.
function buildDoc() {
  const doc = serialize(state);
  doc.savedAt = new Date().toISOString();
  return doc;
}
const slug = s => (s || 'trussforge-build').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'trussforge-build';

function downloadFile() {
  const doc = buildDoc();
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = slug(state.name) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`Downloaded ${a.download}.`);
}

async function api(path, opts) {
  const r = await fetch('/api/builds' + path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function saveToServer() {
  const name = (state.name || '').trim();
  if (!name || name === 'Untitled') {
    setStatus('Give the build a name first (click the title), then Save.', true);
    nameEl.focus();
    return;
  }
  try {
    const out = await api('/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDoc()),
    });
    setStatus(`Saved "${out.name}" to the server (${out.nodes} nodes, ${out.members} members).`);
  } catch (e) {
    downloadFile();
    setStatus(`Server unreachable (${e.message}) - downloaded ${slug(name)}.json instead.`, true);
  }
}

function adoptState(next, label) {
  pushUndo();
  state = next;
  select(null);
  setRunning(false);
  syncToolbar();
  syncName();
  fitView();
  markDirty();
  setStatus(label);
  draw();
}

const libModal = $('libModal');
function openLibrary() {
  libModal.classList.remove('hidden');
  refreshLibrary();
}
function closeLibrary() { libModal.classList.add('hidden'); }
async function refreshLibrary() {
  const list = $('libList');
  list.innerHTML = '<p class="hint">loading...</p>';
  try {
    const { builds } = await api('');
    list.innerHTML = '';
    $('libHint').textContent = 'Saved on the server - the same list on every device.';
    if (!builds.length) {
      list.innerHTML = '<p class="hint">Nothing saved yet. Name your build (click the title) and press Save.</p>';
      return;
    }
    for (const b of builds) {
      const row = document.createElement('div');
      row.className = 'libRow' + (b.name === state.name ? ' current' : '');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = b.name;
      const meta = document.createElement('span'); meta.className = 'meta';
      const when = b.savedAt ? new Date(b.savedAt) : null;
      meta.textContent = b.corrupt ? 'corrupt' :
        `${b.nodes} nodes, ${b.members} members${when && !isNaN(when) ? ' - ' + when.toLocaleDateString() : ''}`;
      const loadB = document.createElement('button'); loadB.textContent = 'Load';
      loadB.onclick = async () => {
        try {
          const doc = await api('/' + encodeURIComponent(b.name));
          adoptState(deserialize(doc), `Opened "${b.name}" from the server.`);
          closeLibrary();
        } catch (e) { setStatus(e.message, true); }
      };
      const delB = document.createElement('button'); delB.textContent = 'Del'; delB.className = 'danger';
      delB.onclick = async () => {
        if (delB.textContent === 'Del') {     // two-tap confirm, phone-friendly
          delB.textContent = 'sure?';
          setTimeout(() => { delB.textContent = 'Del'; }, 2500);
          return;
        }
        try { await api('/' + encodeURIComponent(b.name), { method: 'DELETE' }); refreshLibrary(); }
        catch (e) { setStatus(e.message, true); }
      };
      row.append(nm, meta, loadB, delB);
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = '';
    $('libHint').textContent = `Server library unreachable (${e.message}). You can still open or download files.`;
  }
}
$('saveBtn').addEventListener('click', saveToServer);
$('openBtn').addEventListener('click', openLibrary);
$('libClose').addEventListener('click', closeLibrary);
$('libDownload').addEventListener('click', () => { downloadFile(); });
$('libOpenFile').addEventListener('click', () => $('openFile').click());
libModal.addEventListener('click', ev => { if (ev.target === libModal) closeLibrary(); });
$('openFile').addEventListener('change', async ev => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  try {
    const doc = JSON.parse(await f.text());
    const next = deserialize(doc);
    if (!doc.name) next.name = f.name.replace(/\.json$/i, '').slice(0, 64) || 'Untitled';
    adoptState(next, `Opened ${f.name}.`);
    closeLibrary();
  } catch (e) {
    setStatus('Could not open that file: ' + e.message, true);
  }
});

let dirtyTimer = 0;
function markDirty() {
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize(state))); }
    catch (e) { /* storage may be unavailable */ }
  }, 400);
}

function loadAutosave() {
  try {
    const doc = JSON.parse(localStorage.getItem(AUTOSAVE_KEY));
    if (doc) { state = deserialize(doc); return true; }
  } catch (e) { /* fall through */ }
  return false;
}

// ============================================================
// DEMOS / URL PARAMS / SELF-CHECK
// ============================================================

function loadDemo(name, { keepUndo = true } = {}) {
  const make = DEMOS[name];
  if (!make) return false;
  if (keepUndo && state.nodes.length) pushUndo();
  state = make();
  select(null);
  syncToolbar();
  syncName();
  fitView();
  const hint = DEMO_HINTS[name] || {};
  if (hint.forceView && !strainOn) $('strainBtn').click();
  setStatus(hint.status || `Demo: ${name}.`);
  draw();
  return true;
}
$('demoSel').addEventListener('change', () => {
  const v = $('demoSel').value;
  $('demoSel').value = '';
  if (v && loadDemo(v)) { setRunning(true); markDirty(); }
});

function handleParams() {
  const q = new URLSearchParams(location.search);
  const demo = q.get('demo');
  let loaded = false;
  if (demo && DEMOS[demo]) loaded = loadDemo(demo, { keepUndo: false });
  if (!loaded) {
    if (loadAutosave()) {
      syncToolbar(); syncName(); fitView(); draw();
      setStatus('Restored your last build.');
    } else {
      loadDemo('walker', { keepUndo: false });
    }
  }

  const checkSecs = parseFloat(q.get('check') || '0');
  if (checkSecs > 0) runSelfCheck(checkSecs);
  if (q.get('layout') === '1') dumpLayout();
  if (q.get('run') === '1') setRunning(true);
}

// Headless verification hook: fast-forward the sim synchronously and
// publish the result in the DOM + window.TF.checkResult.
function runSelfCheck(seconds) {
  const before = centroid(state);
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) step(state, FIXED_DT);
  const after = centroid(state);
  const pinnedMoved = state.nodes.some(n =>
    n.pinned && (Math.abs(n.x - n.rx) > 1e-9 || Math.abs(n.y - n.ry) > 1e-9));
  const result = {
    seconds,
    dx: +(after.x - before.x).toFixed(4),
    dy: +(after.y - before.y).toFixed(4),
    pinnedMoved,
    nodes: state.nodes.length,
    members: state.members.length,
    finite: state.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)),
  };
  window.TF.checkResult = result;
  const el = document.getElementById('checkResult');
  el.textContent = 'TF-CHECK ' + JSON.stringify(result);
  document.title = 'TF-CHECK ' + JSON.stringify(result);
}

// Headless layout debugging (?layout=1): toolbar child geometry into the
// hidden #checkResult element so --dump-dom can read it.
function dumpLayout() {
  const rows = [...document.querySelectorAll('#toolbar > *')].map(el => {
    const r = el.getBoundingClientRect();
    return `${el.id || el.className}=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}`;
  });
  document.getElementById('checkResult').textContent =
    `TF-LAYOUT vw=${innerWidth} coarse=${matchMedia('(pointer: coarse)').matches} ` + rows.join(' ');
}

// ============================================================
// STATUS / MAIN LOOP
// ============================================================

let statusHoldUntil = 0;
function setStatus(msg, isErr) {
  const el = $('status');
  el.textContent = msg;
  el.className = isErr ? 'err' : '';
  statusHoldUntil = performance.now() + STATUS_HOLD_MS;   // survive the running ticker
}
// The hint bar is hidden on phones, so there the hint goes to the status
// line instead - tool guidance is most useful right after switching tools.
function setHint(msg) {
  $('hint').textContent = msg;
  if (narrow.matches && msg) setStatus(msg);
}

let acc = 0, lastTs = 0;

function frame(ts) {
  requestAnimationFrame(frame);
  if (!running) { lastTs = ts; return; }
  if (!lastTs) lastTs = ts;
  acc += Math.min(0.1, (ts - lastTs) / 1000) * (state.world.speed || 1);
  lastTs = ts;
  let n = 0;
  while (acc >= FIXED_DT && n < MAX_STEPS_FRAME) {
    step(state, FIXED_DT);
    acc -= FIXED_DT; n++;
  }
  if (n === MAX_STEPS_FRAME) acc = 0;   // cannot keep up: drop time
  if (follow && state.nodes.length) {
    const c = centroid(state);
    cam.x += (c.x - cam.x) * 0.06;
    cam.y += (Math.max(c.y, 0.6) - cam.y) * 0.06;
  }
  if (ts > statusHoldUntil) {
    $('status').textContent =
      `t=${state.t.toFixed(1)}s  ${state.nodes.length} nodes, ${state.members.length} members`;
  }
  updateForceReadout();
  draw();
}

function updateForceReadout() {
  const m = selectedMember();
  const el = m && $('pv_force');
  if (el) el.textContent = fmtForce(memberForce(m));
}

// ============================================================
// CONSOLE HOOKS (window.TF) + BOOT
// ============================================================

window.TF = {
  get state() { return state; },
  set state(s) { state = s; },
  step: (n = 1) => { for (let i = 0; i < n; i++) step(state, FIXED_DT); updateForceReadout(); draw(); },
  memberForce,
  copy: copySelection, paste: pasteClipboard, duplicate: duplicateSelection,
  selectBody,
  get clip() { return clip; },
  get prefs() { return prefs; },
  get theme() { return theme; },
  pod,
  insertHub, mergeInto,
  set prefs(p) { prefs = { ...prefs, ...p }; savePrefs(); draw(); },
  snapPt,
  get strain() { return strainOn; },
  set strain(v) { if (!!v !== strainOn) $('strainBtn').click(); },
  loadDemo,
  draw,
  fitView,
  serialize: () => serialize(state),
  load: doc => { state = deserialize(doc); syncName(); fitView(); draw(); },
  saveToServer, openLibrary, downloadFile,
  get name() { return state.name; },
  set name(v) { state.name = v; syncName(); markDirty(); },
  play: () => setRunning(true),
  pause: () => setRunning(false),
  setTool,
  select,
  undo, redo,
  get undoDepth() { return undoStack.length; },
  centroid: () => centroid(state),
  get cam() { return cam; },
  get tool() { return tool; },
  get running() { return running; },
  get sel() { return sel; },
  toScreen: (x, y) => ({ x: sx(x), y: sy(y) }),
  toWorld: (x, y) => ({ x: wx(x), y: wy(y) }),
  version: APP_VERSION,
  checkResult: null,
};

loadView();
setTool('select');
resize();
handleParams();
syncToolbar();
syncUndoButtons();
syncPasteButton();
syncName();
requestAnimationFrame(frame);
