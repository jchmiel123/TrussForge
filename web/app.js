// TrussForge web app - canvas board UI over the headless engine.
// Pointer Events ONLY (mouse / touch / pen unified). No engine physics
// here: all simulation lives in ../engine/.

import {
  createState, addNode, addMember, removeNode, removeMember,
  getNode, getMember, findMember, membersAt, rebuildBraces, reset,
  serialize, deserialize, centroid, DEFAULTS,
  componentOf, extractSub, insertSub, mirrorSub, fragmentBounds,
} from '../engine/model.js';
import { step, memberForce, FIXED_DT } from '../engine/sim.js';
import { DEMOS, DEMO_HINTS } from '../engine/demos.js';
import { snapToLattice, forEachLatticePoint, rowHeight, rowOffset, PITCHES } from '../engine/lattice.js';

// ============================================================
// CONFIG / VERSION
// ============================================================

const APP_VERSION = '0.7.0';
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
const PREF_DEFAULTS = { gridType: 'square', pitch: 0.25, gridStyle: 'dots', gridBright: 0.5, gridSize: 2 };
let prefs = { ...PREF_DEFAULTS };
try { prefs = { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch (e) { /* defaults */ }
if (!PITCHES.includes(prefs.pitch)) prefs.pitch = PREF_DEFAULTS.pitch;
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
  const [r0, g0, b0] = [139, 156, 182];
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
  ctx.fillStyle = '#0d131a';
  ctx.fillRect(0, 0, vw, vh);
  if (strainOn) fRef = forceRef();

  drawGrid();
  drawGround();

  for (const m of state.members) drawMember(m);
  drawGesture();
  for (const n of state.nodes) drawNode(n);
  positionPill();
}

function drawGrid() {
  if (!snapOn) return;
  const type = prefs.gridType, p = prefs.pitch;
  const px = p * cam.zoom;                  // pitch on screen
  if (px < 7) return;                       // too dense to mean anything
  const alpha = 0.1 + 0.8 * prefs.gridBright;
  const fade = Math.min(1, (px - 7) / 12);  // ease in as you zoom in
  const col = `rgba(125, 155, 195, ${(alpha * fade).toFixed(3)})`;
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
  ctx.fillStyle = 'rgba(20, 28, 38, .55)';
  ctx.fillRect(0, gy, vw, vh - gy);
  ctx.strokeStyle = '#3a4c63';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(vw, gy); ctx.stroke();
  // hatching
  ctx.strokeStyle = '#26344660';
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
    ctx.strokeStyle = 'rgba(47, 129, 247, .45)';
    ctx.lineWidth = w + 7;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.lineCap = 'round';
  if (m.kind === 'beam') {
    ctx.strokeStyle = col || '#8b9cb6';
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  } else if (m.kind === 'spring') {
    drawSpring(x1, y1, x2, y2, m, col);
  } else {
    drawActuator(x1, y1, x2, y2, a, b, m, w, col);
  }
}

function drawSpring(x1, y1, x2, y2, m, col) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;       // axis
  const nx = -uy, ny = ux;                  // normal
  const zigs = 8;
  const ampPx = Math.max(3, 0.05 * cam.zoom);
  const lead = Math.min(len * 0.15, 10);    // straight leads at the ends
  ctx.strokeStyle = col || '#58a6ff';
  ctx.lineWidth = Math.max(1.5, 0.028 * cam.zoom) * (col ? 1.4 : 1);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + ux * lead, y1 + uy * lead);
  const span = len - 2 * lead;
  for (let i = 1; i < zigs; i++) {
    const t = lead + span * (i / zigs);
    const side = (i % 2 ? 1 : -1);
    ctx.lineTo(x1 + ux * t + nx * ampPx * side, y1 + uy * t + ny * ampPx * side);
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
  ctx.strokeStyle = col || '#55637a';
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
  ctx.strokeStyle = '#0d131a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-bs * 0.9, -bs * 0.55, bs * 1.8, bs * 1.1, 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawNode(n) {
  const x = sx(n.x), y = sy(n.y);
  // heavier nodes draw bigger (area ~ mass), capped so 4 kg stays tappable
  const r = Math.max(4, NODE_R * cam.zoom) * Math.min(1.6, Math.sqrt(Math.max(0.3, n.mass)));
  const gs = groupSet();
  const seld = (sel.kind === 'node' && sel.id === n.id) || (gs && gs.has(n.id));
  if (seld) {
    ctx.fillStyle = 'rgba(47, 129, 247, .35)';
    ctx.beginPath(); ctx.arc(x, y, r + 7, 0, 7); ctx.fill();
  }
  if (n.pinned) {
    // anchored: a support triangle + ground line under the node, the
    // way a fixed support is drawn on a structural diagram
    ctx.strokeStyle = '#e3b341';
    ctx.fillStyle = 'rgba(227, 179, 65, .18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - r - 6, y + r + 9);
    ctx.lineTo(x + r + 6, y + r + 9);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r - 10, y + r + 13); ctx.lineTo(x + r + 10, y + r + 13);
    ctx.stroke();
  }
  ctx.fillStyle = n.pinned ? '#e3b341' : '#d3dce6';
  ctx.strokeStyle = '#0d131a';
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
    ctx.fillStyle = 'rgba(47, 129, 247, .10)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(88, 166, 255, .8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    return;
  }
  if (gesture.type !== 'member') return;
  const a = getNode(state, gesture.from);
  if (!a) return;
  ctx.strokeStyle = '#2f81f7';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(sx(a.x), sy(a.y));
  ctx.lineTo(gesture.sx, gesture.sy);
  ctx.stroke();
  ctx.setLineDash([]);
  const p = snapPointForGesture();
  ctx.strokeStyle = 'rgba(88, 166, 255, .7)';
  ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 7, 0, 7); ctx.stroke();
}

function snapPointForGesture() {
  const hit = hitNode(gesture.sx, gesture.sy);
  if (hit && hit.id !== gesture.from) return { x: hit.x, y: hit.y };
  return snapPt(wx(gesture.sx), wy(gesture.sy));
}

// ============================================================
// HIT TESTING
// ============================================================

function hitNode(px, py) {
  let best = null, bestD = HIT_NODE_PX;
  for (const n of state.nodes) {
    const d = Math.hypot(sx(n.x) - px, sy(n.y) - py);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function hitMember(px, py) {
  let best = null, bestD = HIT_MEMBER_PX;
  for (const m of state.members) {
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
  } else if ((tool === 'beam' || tool === 'spring' || tool === 'actuator') && n) {
    gesture = { type: 'member', from: n.id, sx: p.sx, sy: p.sy };
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
    if (g.moved) bakeNode(g.id);
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
  if (tool === 'node') {
    if (n) { select('node', n.id); return; }
    if (m) { select('member', m.id); return; }
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

function finishMember(g, p) {
  const from = getNode(state, g.from);
  if (!from) return;
  if (!p.moved) { select('node', from.id); return; }   // just a tap on a node
  let to = hitNode(p.sx, p.sy);
  if (to && to.id === from.id) return;
  if (to && findMember(state, from.id, to.id)) {
    setStatus('Those two nodes are already connected.');
    select('member', findMember(state, from.id, to.id).id);
    return;
  }
  pushUndo();
  if (!to) {
    const t = snapPt(wx(p.sx), wy(p.sy));
    to = addNode(state, t.x, t.y);
  }
  const m = addMember(state, from, to, tool);
  if (m) {
    if (running) rebuildBraces(state, true);
    select('member', m.id);
  }
  markDirty();
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
  select: 'Drag a node to move it. Tap anything to see its settings.',
  group: 'Drag a box around nodes to group them. Tap a node to add or remove it. Drag a grouped node to move the group.',
  node: 'Tap empty space to place a node.',
  beam: 'Drag from a node to another node (or to empty space) to add a rigid beam.',
  spring: 'Drag from a node to add a stretchy spring.',
  actuator: 'Drag from a node to add a muscle. Tap it afterwards to shape its wave.',
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
  <p><b>Anchor</b> - fixes a node to the world.</p>
  <p><b>Weld</b> - members meeting at a node keep their angles (rigid joint).</p>
  <p><b>Grid</b> button: square or triangle lattice, pitch, brightness (<kbd>[</kbd> <kbd>]</kbd> change pitch). Per device, not saved with builds.</p>
  <p><b>Group</b> tool: box-select nodes, then copy / paste / mirror / move them. "Select body" on a node or member grabs the whole creature.</p>
  <p><b>Force view</b> (<kbd>F</kbd>) colors members: <span style="color:#ff5648">red = tension</span>, <span style="color:#40a0ff">blue = compression</span>. Full color = carrying the whole build's weight.</p>
  <p class="keys"><kbd>Space</kbd> run <kbd>R</kbd> reset <kbd>G</kbd> snap <kbd>Ctrl+Z</kbd> undo<br>
  <kbd>V</kbd> <kbd>M</kbd> <kbd>N</kbd> <kbd>B</kbd> <kbd>S</kbd> <kbd>A</kbd> <kbd>E</kbd> tools <kbd>Del</kbd> delete<br>
  <kbd>Ctrl+C</kbd> copy <kbd>Ctrl+V</kbd> paste <kbd>Ctrl+D</kbd> duplicate <kbd>Ctrl+A</kbd> all</p>
</div>`;

const MEMBER_DESC = {
  beam: 'Rigid stick. Holds its length exactly.',
  spring: 'Stretchy. Stiffness sets the pull, damping kills the bounce.',
  actuator: 'A muscle: its length follows the wave. Offset the phase between muscles to make a gait.',
};

const TIPS = {
  kind: 'Change what this member is. Beams and muscles are rigid, springs stretch.',
  restLen: 'Length the member wants to be. Change it while paused to pre-stress the build.',
  k: 'How hard the spring pulls back per meter of stretch.',
  c: 'How fast the spring stops bouncing. 0 = rings forever.',
  wtype: 'sine = smooth push/pull. square = snaps between long and short.',
  amp: 'How far the length swings, as a fraction of rest length (+/-).',
  period: 'Seconds per cycle. All muscles share one clock.',
  phase: 'Offset into the cycle (0-1). 0.5 = the opposite of a phase-0 muscle.',
  duty: 'Fraction of each cycle spent long (square wave only).',
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
  gtype: 'square = classic. triangles = every cell is an equilateral triangle: trusses, domes and hex frames snap exactly.',
  gpitch: 'Distance between grid points, meters. Smaller = finer detail.',
  gstyle: 'Dots or full lines.',
  gbright: 'How visible the grid is. Turn it up on a phone in daylight.',
  gsize: 'Dot size / line thickness in pixels.',
  friction: 'Friction coefficient. 0 = ice, 0.7 = rubber, 2 = glue. A foot only grips as hard as it is pressed down, so a lifting foot slides free.',
  drag: 'Air resistance. Higher = everything settles faster.',
  speed: 'Simulation speed. 0.25x for slow motion.',
};

function renderProps() {
  $('worldBtn').classList.toggle('active', sel.kind === 'world');
  const n = selectedNode(), m = selectedMember();
  $('gridBtn').classList.toggle('active', sel.kind === 'grid');
  if (sel.kind === 'world') { renderWorldProps(); openSheet(true); return; }
  if (sel.kind === 'grid') { renderGridProps(); openSheet(true); return; }
  if (n) { renderNodeProps(n); openSheet(!narrow.matches); return; }   // phone: the pill is enough
  if (sel.kind === 'group') { renderGroupProps(); openSheet(true); return; }
  if (m) { renderMemberProps(m); openSheet(true); return; }
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
    ${propSlider('mass', 'mass', 0.2, 5, 0.1, n.mass, 'kg')}
    <div class="propBtns"><button id="npBody" data-tip="${TIPS.body}" title="${TIPS.body}">Select body</button><button id="npDel" class="danger">Delete node</button></div>`;
  $('npAnchor').addEventListener('click', toggleAnchor);
  $('npWeld').addEventListener('click', toggleWeld);
  $('npBody').addEventListener('click', () => selectBody(n.id));
  $('npDel').addEventListener('click', deleteSelectedNode);
  wireProp('mass', v => { n.mass = v; });
}

function renderMemberProps(m) {
  const rows = [];
  const title = { beam: 'Beam', spring: 'Spring', actuator: 'Actuator' }[m.kind];
  rows.push(`<div class="propTitle">${title}</div>`);
  rows.push(`<p class="desc">${MEMBER_DESC[m.kind]}</p>`);
  rows.push(propSelect('kind', 'type', ['beam', 'spring', 'actuator'], m.kind));
  // a freeform build can be longer than the default range: widen it
  const lenMax = Math.max(4, Math.ceil(m.restLen * 1.5 * 20) / 20);
  rows.push(propSlider('restLen', 'rest length', 0.1, lenMax, 0.05, m.restLen, 'm'));
  if (m.kind === 'spring') {
    rows.push(propSlider('k', 'stiffness', 1, 400, 1, m.k, 'N/m'));
    rows.push(propSlider('c', 'damping', 0, 10, 0.1, m.c, ''));
  }
  if (m.kind === 'actuator') {
    rows.push(propSelect('wtype', 'waveform', ['sine', 'square'], m.wave.type));
    rows.push(propSlider('amp', 'amplitude', 0, 0.45, 0.01, m.wave.amp, '+/-'));
    rows.push(propSlider('period', 'period', 0.2, 4, 0.05, m.wave.period, 's'));
    rows.push(propSlider('phase', 'phase', 0, 1, 0.05, m.wave.phase, ''));
    if (m.wave.type === 'square') {
      rows.push(propSlider('duty', 'duty cycle', 0.05, 0.95, 0.05, m.wave.duty, ''));
    }
  }
  rows.push(`<div class="propRow readout" data-tip="${TIPS.force}" title="${TIPS.force}"><label>force <span class="pv" id="pv_force">${fmtForce(memberForce(m))}</span></label></div>`);
  rows.push(`<div class="propBtns"><button id="mBody" data-tip="${TIPS.body}" title="${TIPS.body}">Select body</button><button id="mDel" class="danger">Delete</button></div>`);
  propsBody.innerHTML = rows.join('');
  $('mBody').addEventListener('click', () => selectBody(m.a));

  wireProp('restLen', v => { m.restLen = v; rebuildBraces(state, running); });
  if (m.kind === 'spring') {
    wireProp('k', v => { m.k = v; });
    wireProp('c', v => { m.c = v; });
  }
  if (m.kind === 'actuator') {
    wireSel('wtype', v => { m.wave.type = v; renderProps(); });
    wireProp('amp', v => { m.wave.amp = v; });
    wireProp('period', v => { m.wave.period = v; });
    wireProp('phase', v => { m.wave.phase = v; });
    if (m.wave.type === 'square') wireProp('duty', v => { m.wave.duty = v; });
  }
  wireSel('kind', v => { changeKind(m, v); });
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
    <div class="propTitle">Grid</div>
    <p class="desc">Snap lattice for building. Lives on this device, not in the build file - open any save and change it to fit the design.</p>
    ${propSelect('gtype', 'lattice', ['square', 'tri'], prefs.gridType, v => ({ square: 'square', tri: 'triangles (equilateral)' })[v])}
    ${propSelect('gpitch', 'pitch', PITCHES.map(String), String(prefs.pitch), v => v + ' m')}
    ${propSelect('gstyle', 'style', ['dots', 'lines'], prefs.gridStyle)}
    ${propSlider('gbright', 'brightness', 0, 1, 0.05, prefs.gridBright, '')}
    ${propSlider('gsize', 'dot / line size', 1, 4, 0.5, prefs.gridSize, 'px')}
    <div class="propBtns"><button id="gReset">Defaults</button></div>`;
  wirePref('gtype', v => { prefs.gridType = v; });
  wirePref('gpitch', v => { prefs.pitch = parseFloat(v); });
  wirePref('gstyle', v => { prefs.gridStyle = v; });
  wirePref('gbright', v => { prefs.gridBright = parseFloat(v); });
  wirePref('gsize', v => { prefs.gridSize = parseFloat(v); });
  $('gReset').addEventListener('click', () => { prefs = { ...PREF_DEFAULTS }; savePrefs(); renderProps(); if (!running) draw(); });
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
    <label for="pp_${id}">${label} <span class="pv" id="pv_${id}" data-unit="${unit}">${fmtVal(val)} ${unit}</span></label>
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
    pv.textContent = fmtVal(v) + ' ' + pv.dataset.unit;
    fn(v);
    markDirty();
    if (!running) draw();
  });
}
function wireSel(id, fn) {
  const el = $('pp_' + id);
  el.addEventListener('change', () => { pushUndo(); fn(el.value); markDirty(); if (!running) draw(); });
}
const fmtVal = v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

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
  setStatus('Reset to build pose.');
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
  else if (mod && k === 's') { ev.preventDefault(); saveFile(); }
  else if (mod && k === 'o') { ev.preventDefault(); $('openFile').click(); }
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
  else if (k === 'n') setTool('node');
  else if (k === 'b') setTool('beam');
  else if (k === 's') setTool('spring');
  else if (k === 'a') setTool('actuator');
  else if (k === 'e') setTool('erase');
  else if (k === 'escape') select(null);
  else if (k === 'delete' || k === 'backspace') {
    if (selectedNode()) deleteSelectedNode();
    else if (sel.kind === 'group') deleteGroup();
    else if (selectedMember()) { pushUndo(); removeMember(state, sel.id); select(null); markDirty(); }
  }
});

// ============================================================
// SAVE / OPEN / AUTOSAVE
// ============================================================

function saveFile() {
  const doc = serialize(state);
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trussforge-build.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus('Saved.');
}
$('saveBtn').addEventListener('click', saveFile);
$('openBtn').addEventListener('click', () => $('openFile').click());
$('openFile').addEventListener('change', async ev => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  try {
    const doc = JSON.parse(await f.text());
    const next = deserialize(doc);
    pushUndo();
    state = next;
    select(null);
    setRunning(false);
    syncToolbar();
    fitView();
    markDirty();
    setStatus(`Opened ${f.name}.`);
    draw();
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
      syncToolbar(); fitView(); draw();
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
  set prefs(p) { prefs = { ...prefs, ...p }; savePrefs(); draw(); },
  snapPt,
  get strain() { return strainOn; },
  set strain(v) { if (!!v !== strainOn) $('strainBtn').click(); },
  loadDemo,
  draw,
  fitView,
  serialize: () => serialize(state),
  load: doc => { state = deserialize(doc); fitView(); draw(); },
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
requestAnimationFrame(frame);
