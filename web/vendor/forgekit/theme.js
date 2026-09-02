// ForgeKit theme - one place for the look of a CodeLab web app.
//
// A theme is a set of CSS custom properties (the UI tokens every
// stylesheet already uses: --bg, --panel, --accent ...) plus a canvas
// palette for apps that draw their own board. applyTheme() writes the
// tokens onto the document root, stamps data-theme, and returns the
// theme so canvas code can read colors from theme.canvas.
//
// Dependency-free ES module. No DOM access until you call applyTheme.
//
//   import { applyTheme, THEMES, recallTheme, rememberTheme } from './forgekit/theme.js';
//   const theme = applyTheme(recallTheme('myapp.theme', 'forge'));
//   ctx.fillStyle = theme.canvas.board;

export const THEMES = {
  forge: {
    label: 'Forge (dark)', dark: true,
    tokens: {
      bg: '#0d131a', panel: '#141c26', panel2: '#18222e', border: '#243244',
      line: '#16202c', text: '#d3dce6', dim: '#7c8ba1', icon: '#9fb2c8',
      accent: '#2f81f7', accent2: '#58a6ff', active: '#1c3252', track: '#2a3b50',
      ok: '#3fb950', err: '#f85149', warn: '#e3b341',
      shadow: 'rgba(0, 0, 0, .5)', overlay: 'rgba(5, 8, 12, .7)', card: 'rgba(18, 26, 36, .94)',
    },
    canvas: {
      board: '#0d131a', grid: '125,155,195', ground: 'rgba(20, 28, 38, .55)',
      groundLine: '#3a4c63', hatch: 'rgba(38, 52, 70, .38)',
      beam: '#8b9cb6', spring: '#58a6ff', actuatorBase: '#55637a',
      node: '#d3dce6', nodeStroke: '#0d131a', anchor: '#e3b341',
      select: '47,129,247', solidEdge: 'rgba(232, 240, 250, .55)',
      textDim: '#5a6c82', text: '#8fa3ba',
    },
  },
  slate: {
    label: 'Slate (soft dark)', dark: true,
    tokens: {
      bg: '#1b1f26', panel: '#232932', panel2: '#2a313c', border: '#3a4351',
      line: '#2a313c', text: '#e2e6eb', dim: '#98a2b3', icon: '#b0bac8',
      accent: '#4c8dff', accent2: '#78a9ff', active: '#2b3d5c', track: '#3e4859',
      ok: '#4cc06a', err: '#f26d68', warn: '#e8b64a',
      shadow: 'rgba(0, 0, 0, .45)', overlay: 'rgba(10, 12, 16, .7)', card: 'rgba(35, 41, 50, .95)',
    },
    canvas: {
      board: '#1b1f26', grid: '150,170,200', ground: 'rgba(40, 46, 56, .6)',
      groundLine: '#4a5568', hatch: 'rgba(58, 67, 81, .38)',
      beam: '#a3adbd', spring: '#78a9ff', actuatorBase: '#6b7686',
      node: '#e2e6eb', nodeStroke: '#1b1f26', anchor: '#e8b64a',
      select: '76,141,255', solidEdge: 'rgba(240, 244, 250, .55)',
      textDim: '#6f7a8c', text: '#aeb8c8',
    },
  },
  paper: {
    label: 'Paper (light)', dark: false,
    tokens: {
      bg: '#f4f6f9', panel: '#e9edf2', panel2: '#dfe5ec', border: '#c5cdd8',
      line: '#d5dce5', text: '#1c2530', dim: '#5b6b80', icon: '#4a5a70',
      accent: '#2f6fd6', accent2: '#1f5bc4', active: '#cfe0fa', track: '#b9c4d2',
      ok: '#1f8a3d', err: '#c8322b', warn: '#a8730e',
      shadow: 'rgba(30, 40, 60, .25)', overlay: 'rgba(40, 50, 70, .45)', card: 'rgba(249, 251, 253, .96)',
    },
    canvas: {
      board: '#f8fafc', grid: '60,80,110', ground: 'rgba(200, 208, 218, .6)',
      groundLine: '#9aa7b8', hatch: 'rgba(154, 167, 184, .38)',
      beam: '#4a5a70', spring: '#2f6fd6', actuatorBase: '#8a94a6',
      node: '#ffffff', nodeStroke: '#1c2530', anchor: '#b8860b',
      select: '47,111,214', solidEdge: 'rgba(28, 37, 48, .45)',
      textDim: '#7a8798', text: '#3a475a',
    },
  },
};

export function themeNames() { return Object.keys(THEMES); }

// Write a theme's tokens onto `root` (default: <html>). Returns the theme.
export function applyTheme(name, { root } = {}) {
  const th = THEMES[name] || THEMES.forge;
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (el) {
    for (const [k, v] of Object.entries(th.tokens)) el.style.setProperty('--' + k, v);
    el.dataset.theme = THEMES[name] ? name : 'forge';
    el.style.colorScheme = th.dark ? 'dark' : 'light';
  }
  return th;
}

// Read a CSS token off an element (for canvas code that wants to follow
// the stylesheet rather than theme.canvas).
export function cssVar(name, fallback, el) {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const target = el || document.documentElement;
  const v = getComputedStyle(target).getPropertyValue('--' + name).trim();
  return v || fallback;
}

export function recallTheme(storageKey, fallback = 'forge') {
  try {
    const v = localStorage.getItem(storageKey);
    return v && THEMES[v] ? v : fallback;
  } catch (e) { return fallback; }
}

export function rememberTheme(storageKey, name) {
  try { localStorage.setItem(storageKey, name); } catch (e) { /* ignore */ }
}

// Build a <select> of themes. onChange(name) fires after applyTheme.
export function themeSelect({ storageKey, current, onChange, className = '' } = {}) {
  const sel = document.createElement('select');
  sel.className = className;
  for (const [k, th] of Object.entries(THEMES)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = th.label;
    if (k === (current || 'forge')) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    const th = applyTheme(sel.value);
    if (storageKey) rememberTheme(storageKey, sel.value);
    if (onChange) onChange(sel.value, th);
  });
  return sel;
}
