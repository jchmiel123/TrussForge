// ForgeKit prefs - one place for "remember this on this device".
//
// Every CodeLab web app grew its own `try { localStorage... } catch {}`
// blocks (35+ of them across four apps when this was written). This is
// that block, once: a named bag of JSON-able values with defaults, a
// single try/catch, and a swappable storage so tests run headless.
//
//   import { Prefs } from './forgekit/prefs.js';
//   const prefs = new Prefs('cellforge.prefs', { theme: 'forge', speed: 1 });
//   prefs.get('speed');             // 1, or whatever was saved
//   prefs.set('speed', 5);          // saves immediately
//   prefs.set({ theme: 'paper', speed: 2 });
//   prefs.ensure('speed', v => [0, 1, 2, 5, 20].includes(v));  // fall back if junk
//   prefs.reset();                  // back to defaults
//
// The app owns the values; Prefs only owns persistence. Never store
// document state (a build, a board) here - that belongs in a library or
// a file. Prefs is for per-device conveniences: theme, grid, last tab.

export class Prefs {
  constructor(key, defaults = {}, { storage } = {}) {
    this.key = key;
    this.defaults = { ...defaults };
    this.storage = storage !== undefined ? storage : defaultStorage();
    this.data = { ...this.defaults, ...this._load() };
  }

  _load() {
    try {
      const raw = this.storage ? this.storage.getItem(this.key) : null;
      const o = raw ? JSON.parse(raw) : null;
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
  }

  _save() {
    try { if (this.storage) this.storage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { /* private mode, quota */ }
  }

  has(k) { return Object.prototype.hasOwnProperty.call(this.data, k); }

  get(k) { return this.has(k) ? this.data[k] : this.defaults[k]; }

  // set('k', v) or set({ k: v, k2: v2 }); saves once
  set(k, v) {
    if (k && typeof k === 'object') Object.assign(this.data, k);
    else this.data[k] = v;
    this._save();
    return this;
  }

  all() { return { ...this.data }; }

  // reset() = everything; reset('k') = one key
  reset(k) {
    if (k === undefined) this.data = { ...this.defaults };
    else if (Object.prototype.hasOwnProperty.call(this.defaults, k)) this.data[k] = this.defaults[k];
    else delete this.data[k];
    this._save();
    return this;
  }

  // Validate a saved value; junk (an old enum, a removed option) falls
  // back to the default. Returns the value now in force.
  ensure(k, isValid) {
    if (!isValid(this.data[k])) { this.data[k] = this.defaults[k]; this._save(); }
    return this.data[k];
  }

  clear() {
    this.data = { ...this.defaults };
    try { if (this.storage) this.storage.removeItem(this.key); } catch (e) { /* ignore */ }
    return this;
  }
}

// One-off helpers for a single key that is not part of a bag (a clipboard,
// an autosave blob). Same try/catch discipline.
export function loadJSON(key, fallback = null, storage = defaultStorage()) {
  try {
    const raw = storage ? storage.getItem(key) : null;
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}

export function saveJSON(key, value, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    if (value === undefined || value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) { return false; }
}

// An in-memory storage with the localStorage shape, for tests and for
// pages that run where storage throws (sandboxed iframes, previews).
export function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    get length() { return m.size; },
    key: i => Array.from(m.keys())[i] ?? null,
  };
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}
