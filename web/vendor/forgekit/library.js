// ForgeKit library - client for the server-side named-document library
// (fkserve.py DocLibrary; CircuitForge's lobe speaks the same shape).
//
// Every device pointed at the server sees the same list, instead of
// .json files stranded in a phone's Downloads. Three apps carried this
// client and its modal; the regexes had already drifted.
//
//   import { LibraryClient, renderLibrary, saveOrDownload, validName } from './forgekit/library.js';
//   const lib = new LibraryClient({ base: '/api/builds', listKey: 'builds' });
//   await lib.list();  await lib.get(name);  await lib.put(name, doc);  await lib.remove(name);
//
//   // Save = PUT; if the server is unreachable (file://, plain static host)
//   // the document is downloaded instead, so a save never silently goes nowhere.
//   const r = await saveOrDownload(lib, name, doc);   // r.where = 'server' | 'file'
//
//   // Fill a list element with rows (Load / two-tap Del):
//   renderLibrary(listEl, { client: lib, current: state.name,
//     meta: row => `${row.nodes} nodes`, onLoad: (doc, row) => adopt(doc) });

import { downloadJSON, slug } from './files.js';

// Same rule as fkserve.NAME_RE: one path component, no "." / "..".
export const NAME_RE = /^(?!\.+$)[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
export const NAME_RULE = '1-64 chars: letters, digits, space . _ - ; starts with a letter or digit';
export function validName(name) { return NAME_RE.test(String(name || '')); }

export class LibraryClient {
  constructor({ base = '/api/docs', listKey = 'docs', fetch: f } = {}) {
    this.base = String(base).replace(/\/+$/, '');
    this.listKey = listKey;
    this._fetch = f || ((...a) => globalThis.fetch(...a));
  }

  async _req(path, opts) {
    const r = await this._fetch(this.base + path, opts);
    let j = {};
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok || j.ok === false) throw new Error((j && j.error) || `HTTP ${r.status}`);
    return j;
  }

  async list() {
    const j = await this._req('', { cache: 'no-store' });
    return j[this.listKey] || j.docs || [];
  }

  get(name) { return this._req('/' + encodeURIComponent(name), { cache: 'no-store' }); }

  put(name, doc) {
    if (!validName(name)) return Promise.reject(new Error('bad name (' + NAME_RULE + ')'));
    return this._req('/' + encodeURIComponent(name), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
    });
  }

  remove(name) { return this._req('/' + encodeURIComponent(name), { method: 'DELETE' }); }
}

export async function saveOrDownload(client, name, doc, { filename, fallback = 'document' } = {}) {
  try {
    const result = await client.put(name, doc);
    return { where: 'server', result };
  } catch (error) {
    const fn = filename || slug(name, fallback) + '.json';
    downloadJSON(fn, doc);
    return { where: 'file', filename: fn, error };
  }
}

// Render library rows into listEl. Returns the rows (or null if unreachable).
export async function renderLibrary(listEl, {
  client, current = null, onLoad, onError = null, meta = null, hintEl = null,
  emptyText = 'Nothing saved yet.', reachableText = 'Saved on the server - the same list on every device.',
  unreachableText = 'Server library unreachable',
  loadLabel = 'Load', delLabel = 'Del', confirmLabel = 'sure?', confirmMs = 2500,
  actions = [],
} = {}) {
  // actions: extra per-row buttons between Load and Del, e.g. an "Insert"
  // that merges the document into the current one instead of replacing it:
  //   [{ label: 'Insert', title: '...', onPick: (doc, row) => ... }]
  // The document is fetched first unless the action sets needsDoc: false.
  const hint = m => { if (hintEl) hintEl.textContent = m; };
  const fail = m => { if (onError) onError(m); };
  listEl.innerHTML = '<p class="fk-modal-hint">loading...</p>';
  let rows;
  try { rows = await client.list(); }
  catch (e) {
    listEl.innerHTML = '';
    hint(`${unreachableText} (${e.message}).`);
    return null;
  }
  listEl.innerHTML = '';
  hint(reachableText);
  if (!rows.length) { listEl.innerHTML = `<p class="fk-modal-hint">${emptyText}</p>`; return rows; }
  for (const row of rows) {
    const div = document.createElement('div');
    div.className = 'fk-lib-row' + (row.name === current ? ' fk-current' : '');
    const nm = document.createElement('span'); nm.className = 'fk-nm'; nm.textContent = row.name;
    const mt = document.createElement('span'); mt.className = 'fk-meta';
    const when = row.savedAt ? new Date(row.savedAt) : null;
    const whenText = when && !isNaN(when) ? when.toLocaleDateString() : '';
    mt.textContent = row.corrupt ? 'corrupt' : [meta ? meta(row) : `${row.bytes || 0} B`, whenText].filter(Boolean).join(' - ');
    const loadB = document.createElement('button'); loadB.textContent = loadLabel;
    loadB.disabled = !!row.corrupt;
    loadB.addEventListener('click', async () => {
      try { const doc = await client.get(row.name); if (onLoad) onLoad(doc, row); }
      catch (e) { fail(e.message); }
    });
    const actBs = actions.map(act => {
      const b = document.createElement('button');
      b.textContent = act.label;
      if (act.title) b.title = act.title;
      b.disabled = !!row.corrupt;
      b.addEventListener('click', async () => {
        try {
          const doc = act.needsDoc === false ? null : await client.get(row.name);
          if (act.onPick) act.onPick(doc, row);
        } catch (e) { fail(e.message); }
      });
      return b;
    });
    const delB = document.createElement('button'); delB.textContent = delLabel; delB.className = 'fk-danger';
    delB.addEventListener('click', async () => {
      if (delB.textContent === delLabel) {           // two-tap confirm, phone-friendly
        delB.textContent = confirmLabel;
        setTimeout(() => { delB.textContent = delLabel; }, confirmMs);
        return;
      }
      try { await client.remove(row.name); div.remove(); if (!listEl.children.length) listEl.innerHTML = `<p class="fk-modal-hint">${emptyText}</p>`; }
      catch (e) { fail(e.message); }
    });
    div.append(nm, mt, loadB, ...actBs, delB);
    listEl.appendChild(div);
  }
  return rows;
}
