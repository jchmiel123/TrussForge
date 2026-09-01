// TrussForge web app - canvas board UI over the headless engine.
// Pointer Events ONLY (mouse / touch / pen unified). No engine physics
// here: all simulation lives in ../engine/.

import {
  createState, addNode, addMember, removeNode, removeMember,
  getNode, getMember, findMember, membersAt, rebuildBraces, reset,
  serialize, deserialize, centroid, DEFAULTS,
} from '../engine/model.js';
import { step, waveValue, targetLength, FIXED_DT } from '../engine/sim.js';
import { DEMOS } from '../engine/demos.js';

// ============================================================
// CONFIG / VERSION
// ============================================================

const APP_VERSION = '0.1.0';
const BUILD_DATE = '2026-09-01';
const GRID = 0.25;            // snap pitch, meters
const NODE_R = 0.055;         // node draw radius, meters
const TAP_PX = 7;             // movement under this = a tap
const HIT_NODE_PX = 16;       // node hit radius, screen px
const HIT_MEMBER_PX = 11;     // member hit distance, screen px
const AUTOSAVE_KEY = 'trussforge.autosave';
const VIEW_KEY = 'trussforge.view';
const MAX_STEPS_FRAME = 24;   // sim steps per frame cap (heavy tab safety)

// ============================================================
// APP STATE
// ============================================================

let state = createState();
let running = false;
let tool = 'select';          // select | node | beam | spring | actuator | erase
let snapOn = true;
let follow = false;
let sel = { kind: null, id: 0 };       // kind: 'node' | 'member' | null
let cam = { x: 0.6, y: 0.9, zoom: 110 };   // world center + px per meter
let statusMsg = 'Ready.';

const $ = id => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');

// ============================================================
// CAMERA / TRANSFORM  (world y is UP, screen y is down)
// ============================================================

let vw = 0, vh = 0, dpr = 1;

function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  vw = r.width; vh = r.height;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  draw();
}
window.addEventListener('resize', resize);

const sx = wx => (wx - cam.x) * cam.zoom + vw / 2;
const sy = wy => vh / 2 - (wy - cam.y) * cam.zoom;
const wx = px => (px - vw / 2) / cam.zoom + cam.x;
const wy = py => cam.y - (py - vh / 2) / cam.zoom;

function snap(v) { return snapOn ? Math.round(v / GRID) * GRID : v; }

function fitView() {
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

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d131a';
  ctx.fillRect(0, 0, vw, vh);

  drawGrid();
  drawGround();

  for (const m of state.members) drawMember(m);
  drawGesture();
  for (const n of state.nodes) drawNode(n);
}

function drawGrid() {
  const pitch = GRID * cam.zoom;
  if (pitch < 9 || !snapOn) return;
  ctx.fillStyle = '#1c2836';
  const gx0 = Math.floor(wx(0) / GRID) * GRID;
  const gy0 = Math.ceil(wy(vh) / GRID) * GRID;
  for (let gx = gx0; sx(gx) < vw + pitch; gx += GRID) {
    for (let gy = gy0; sy(gy) > -pitch; gy += GRID) {
      ctx.fillRect(sx(gx) - 1, sy(gy) - 1, 2, 2);
    }
  }
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
  const seld = sel.kind === 'member' && sel.id === m.id;
  const w = Math.max(2.5, 0.055 * cam.zoom);
  if (seld) {
    ctx.strokeStyle = 'rgba(47, 129, 247, .45)';
    ctx.lineWidth = w + 7;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.lineCap = 'round';
  if (m.kind === 'beam') {
    ctx.strokeStyle = '#8b9cb6';
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  } else if (m.kind === 'spring') {
    drawSpring(x1, y1, x2, y2, m);
  } else {
    drawActuator(x1, y1, x2, y2, a, b, m, w);
  }
}

function drawSpring(x1, y1, x2, y2, m) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;       // axis
  const nx = -uy, ny = ux;                  // normal
  const zigs = 8;
  const ampPx = Math.max(3, 0.05 * cam.zoom);
  const lead = Math.min(len * 0.15, 10);    // straight leads at the ends
  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = Math.max(1.5, 0.028 * cam.zoom);
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

function drawActuator(x1, y1, x2, y2, a, b, m, w) {
  const curLen = Math.hypot(b.x - a.x, b.y - a.y);
  const ext = (curLen - m.restLen) / (m.restLen || 1);   // -amp..+amp
  // base rod
  ctx.strokeStyle = '#55637a';
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
  const r = Math.max(4, NODE_R * cam.zoom);
  const seld = sel.kind === 'node' && sel.id === n.id;
  if (seld) {
    ctx.fillStyle = 'rgba(47, 129, 247, .35)';
    ctx.beginPath(); ctx.arc(x, y, r + 7, 0, 7); ctx.fill();
  }
  ctx.fillStyle = n.pinned ? '#e3b341' : '#d3dce6';
  ctx.strokeStyle = '#0d131a';
  ctx.lineWidth = 2;
  if (n.locked) {
    // square-ish = welded angles
    ctx.beginPath();
    ctx.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.3);
    ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
  }
  if (n.pinned) {
    // anchor ring + ground flag
    ctx.strokeStyle = '#e3b341';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r - 2, y + r + 6); ctx.lineTo(x + r + 2, y + r + 6);
    ctx.stroke();
  }
}

function drawGesture() {
  if (!gesture || gesture.type !== 'member') return;
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
  return { x: snap(wx(gesture.sx)), y: snap(wy(gesture.sy)) };
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
// POINTER INPUT  (Pointer Events only - mouse / touch / pen)
// ============================================================

const pointers = new Map();   // pointerId -> {sx, sy, startX, startY, moved}
let gesture = null;           // null | {type:'pan'|'pinch'|'dragNode'|'member', ...}

canvas.addEventListener('pointerdown', ev => {
  ev.preventDefault();
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic events */ }
  const p = { sx: ev.offsetX, sy: ev.offsetY, startX: ev.offsetX, startY: ev.offsetY, moved: false };
  pointers.set(ev.pointerId, p);

  if (pointers.size === 2) {
    // second finger: whatever was happening becomes a pinch
    const [a, b] = [...pointers.values()];
    gesture = {
      type: 'pinch',
      dist: Math.hypot(a.sx - b.sx, a.sy - b.sy),
      mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2,
    };
    return;
  }
  if (pointers.size > 2) return;

  const n = hitNode(p.sx, p.sy);
  if (tool === 'select' && n) {
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
  const nx = ev.offsetX, ny = ev.offsetY;
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
      n.x = snap(wx(nx)); n.y = snap(wy(ny));
      n.px = n.x; n.py = n.y;   // carry, do not fling
    }
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
    else tapAt(p.sx, p.sy);
  } else if (!p.moved) {
    tapAt(p.sx, p.sy);
  }
  if (!running) draw();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', ev => {
  ev.preventDefault();
  zoomAt(ev.offsetX, ev.offsetY, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
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
    if (n) { removeNode(state, n.id); select(null); markDirty(); }
    else if (m) { removeMember(state, m.id); select(null); markDirty(); }
    return;
  }
  if (tool === 'node') {
    if (n) { select('node', n.id); return; }
    if (m) { select('member', m.id); return; }
    const nn = addNode(state, snap(wx(px)), snap(wy(py)));
    if (running) { /* born at rest where placed */ }
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
  if (!to) {
    to = addNode(state, snap(wx(p.sx)), snap(wy(p.sy)));
  }
  if (!findMember(state, from.id, to.id)) {
    const m = addMember(state, from, to, tool);
    if (m) {
      if (running) rebuildBraces(state, true);
      select('member', m.id);
    }
  }
  markDirty();
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
  }
  markDirty();
}

function setTool(t) {
  tool = t;
  document.querySelectorAll('.palItem').forEach(el =>
    el.classList.toggle('active', el.dataset.tool === t));
  setHint({
    select: 'Drag a node to move it. Tap to select.',
    node: 'Tap empty space to place a node.',
    beam: 'Drag node to node (or node to empty) to add a beam.',
    spring: 'Drag node to node (or node to empty) to add a spring.',
    actuator: 'Drag node to node to add a muscle. Select it to shape its wave.',
    erase: 'Tap a node or member to delete it.',
  }[t] || '');
}
document.querySelectorAll('.palItem').forEach(el =>
  el.addEventListener('pointerup', () => setTool(el.dataset.tool)));

// ============================================================
// SELECTION / NODE PILL / PROPS
// ============================================================

function select(kind, id) {
  sel = { kind: kind || null, id: id || 0 };
  renderProps();
  positionPill();
}

function selectedNode() { return sel.kind === 'node' ? getNode(state, sel.id) : null; }
function selectedMember() { return sel.kind === 'member' ? getMember(state, sel.id) : null; }

const pill = $('nodePill');

function positionPill() {
  const n = selectedNode();
  if (!n) { pill.classList.add('hidden'); return; }
  pill.classList.remove('hidden');
  $('pillPin').classList.toggle('active', n.pinned);
  $('pillLock').classList.toggle('active', n.locked);
  const px = Math.max(8, Math.min(vw - pill.offsetWidth - 8, sx(n.x) - pill.offsetWidth / 2));
  const py = Math.max(8, Math.min(vh - 46, sy(n.y) - 58));
  pill.style.left = px + 'px';
  pill.style.top = py + 'px';
}

$('pillPin').addEventListener('click', () => {
  const n = selectedNode(); if (!n) return;
  n.pinned = !n.pinned;
  if (n.pinned) { n.px = n.x; n.py = n.y; }
  positionPill(); markDirty(); if (!running) draw();
});
$('pillLock').addEventListener('click', () => {
  const n = selectedNode(); if (!n) return;
  n.locked = !n.locked;
  rebuildBraces(state, running);
  positionPill(); markDirty(); if (!running) draw();
});
$('pillDel').addEventListener('click', () => {
  const n = selectedNode(); if (!n) return;
  removeNode(state, n.id);
  select(null); markDirty(); if (!running) draw();
});

// --- member props sheet ---------------------------------------------------

const propsEl = $('props');
const propsBody = $('propsBody');
$('propsClose').addEventListener('click', () => propsEl.classList.remove('open'));

function renderProps() {
  const m = selectedMember();
  if (!m) {
    propsBody.innerHTML = '<p class="hint">Tap a member to edit it. Tap a node for pin / lock / delete.</p>';
    propsEl.classList.remove('open');
    return;
  }
  const rows = [];
  const title = { beam: 'Beam', spring: 'Spring', actuator: 'Actuator' }[m.kind];
  rows.push(`<div class="propTitle">${title}</div>`);
  rows.push(propSelect('kind', 'kind', ['beam', 'spring', 'actuator'], m.kind));
  rows.push(propSlider('restLen', 'rest length', 0.1, 4, 0.05, m.restLen, 'm'));
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
  rows.push('<div class="propBtns"><button id="mDel" class="danger">Delete</button></div>');
  propsBody.innerHTML = rows.join('');
  propsEl.classList.add('open');

  wireProp('restLen', v => { m.restLen = v; syncBraces(); });
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
    removeMember(state, m.id);
    select(null); markDirty(); if (!running) draw();
  });
}

function propSlider(id, label, min, max, stepv, val, unit) {
  return `<div class="propRow"><label>${label} <span class="pv" id="pv_${id}">${fmtVal(val)} ${unit}</span></label>
    <input type="range" id="pp_${id}" min="${min}" max="${max}" step="${stepv}" value="${val}"></div>`;
}
function propSelect(id, label, opts, val) {
  const os = opts.map(o => `<option value="${o}"${o === val ? ' selected' : ''}>${o}</option>`).join('');
  return `<div class="propRow"><label>${label}</label><select id="pp_${id}">${os}</select></div>`;
}
function wireProp(id, fn) {
  const el = $('pp_' + id);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    $('pv_' + id).textContent = fmtVal(v) + ' ' + ($('pv_' + id).textContent.split(' ').pop() || '');
    fn(v);
    markDirty();
    if (!running) draw();
  });
}
function wireSel(id, fn) {
  const el = $('pp_' + id);
  el.addEventListener('change', () => { fn(el.value); markDirty(); if (!running) draw(); });
}
const fmtVal = v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

function changeKind(m, kind) {
  m.kind = kind;
  if (kind === 'actuator' && !m.wave) m.wave = { ...DEFAULTS.wave };
  if (kind !== 'actuator') m.wave = null;
  renderProps();
}

function syncBraces() { rebuildBraces(state, running); }

// ============================================================
// TOOLBAR / WORLD DRAWER
// ============================================================

$('ver').textContent = `v${APP_VERSION} - ${BUILD_DATE}`;

const runBtn = $('runBtn');
function setRunning(r) {
  running = r;
  runBtn.textContent = r ? 'Pause' : 'Run';
  runBtn.classList.toggle('running', r);
  if (r) { acc = 0; lastTs = 0; }
  setStatus(r ? 'Running.' : 'Paused.');
}
runBtn.addEventListener('click', () => setRunning(!running));

$('resetBtn').addEventListener('click', () => {
  reset(state);
  setStatus('Reset to build pose.');
  draw();
});

$('snapBtn').addEventListener('click', () => {
  snapOn = !snapOn;
  $('snapBtn').classList.toggle('active', snapOn);
  if (!running) draw();
});
$('gravBtn').addEventListener('click', () => {
  state.world.gravityOn = !state.world.gravityOn;
  $('gravBtn').classList.toggle('active', state.world.gravityOn);
  markDirty();
});
$('followBtn').addEventListener('click', () => {
  follow = !follow;
  $('followBtn').classList.toggle('active', follow);
});
$('worldBtn').addEventListener('click', () => {
  $('toolbar').classList.toggle('world-open');
  syncWorldUI();
});

function syncWorldUI() {
  $('wGrav').value = state.world.gravity;
  $('wFric').value = state.world.friction;
  $('wDrag').value = state.world.drag;
  $('wSpeed').value = String(state.world.speed);
  $('wGravV').textContent = state.world.gravity.toFixed(1);
  $('wFricV').textContent = state.world.friction.toFixed(2);
  $('wDragV').textContent = state.world.drag.toFixed(2);
}
$('wGrav').addEventListener('input', () => {
  state.world.gravity = parseFloat($('wGrav').value);
  $('wGravV').textContent = state.world.gravity.toFixed(1);
  markDirty();
});
$('wFric').addEventListener('input', () => {
  state.world.friction = parseFloat($('wFric').value);
  $('wFricV').textContent = state.world.friction.toFixed(2);
  markDirty();
});
$('wDrag').addEventListener('input', () => {
  state.world.drag = parseFloat($('wDrag').value);
  $('wDragV').textContent = state.world.drag.toFixed(2);
  markDirty();
});
$('wSpeed').addEventListener('change', () => {
  state.world.speed = parseFloat($('wSpeed').value);
  markDirty();
});

$('clearBtn').addEventListener('click', () => {
  state = createState();
  select(null);
  setRunning(false);
  markDirty();
  setStatus('Cleared.');
  draw();
});

// keyboard
window.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  const k = ev.key.toLowerCase();
  if (k === ' ') { ev.preventDefault(); setRunning(!running); }
  else if (k === 'r') $('resetBtn').click();
  else if (k === 'g') $('snapBtn').click();
  else if (k === 'v') setTool('select');
  else if (k === 'n') setTool('node');
  else if (k === 'b') setTool('beam');
  else if (k === 's' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); saveFile(); }
  else if (k === 's') setTool('spring');
  else if (k === 'a') setTool('actuator');
  else if (k === 'e') setTool('erase');
  else if (k === 'o' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); $('openFile').click(); }
  else if (k === 'delete' || k === 'backspace') {
    if (selectedNode()) $('pillDel').click();
    else if (selectedMember()) { removeMember(state, sel.id); select(null); markDirty(); draw(); }
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
    state = deserialize(doc);
    select(null);
    setRunning(false);
    syncWorldUI();
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

function loadDemo(name) {
  const make = DEMOS[name];
  if (!make) return false;
  state = make();
  select(null);
  syncWorldUI();
  $('gravBtn').classList.toggle('active', state.world.gravityOn);
  fitView();
  setStatus(`Demo: ${name}.`);
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
  if (demo && DEMOS[demo]) loaded = loadDemo(demo);
  if (!loaded) {
    if (loadAutosave()) {
      syncWorldUI(); fitView(); draw();
      setStatus('Restored your last build.');
    } else {
      loadDemo('walker');
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

function setStatus(msg, isErr) {
  statusMsg = msg;
  const el = $('status');
  el.textContent = msg;
  el.className = isErr ? 'err' : '';
}
function setHint(msg) { $('hint').textContent = msg; }

let acc = 0, lastTs = 0;

function frame(ts) {
  requestAnimationFrame(frame);
  if (running) {
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
    $('status').textContent =
      `t=${state.t.toFixed(1)}s  ${state.nodes.length} nodes, ${state.members.length} members`;
  } else {
    lastTs = ts;
  }
  draw();
  positionPill();
}

// ============================================================
// CONSOLE HOOKS (window.TF) + BOOT
// ============================================================

window.TF = {
  get state() { return state; },
  set state(s) { state = s; },
  step: (n = 1) => { for (let i = 0; i < n; i++) step(state, FIXED_DT); draw(); },
  loadDemo,
  draw,
  fitView,
  serialize: () => serialize(state),
  load: doc => { state = deserialize(doc); fitView(); draw(); },
  play: () => setRunning(true),
  pause: () => setRunning(false),
  setTool,
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
resize();
setTool('select');
handleParams();
syncWorldUI();
$('gravBtn').classList.toggle('active', state.world.gravityOn);
requestAnimationFrame(frame);
