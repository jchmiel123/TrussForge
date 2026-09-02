// ForgeKit files - "save this as a file" / "open a file" in the browser
// without a server. The Blob -> object URL -> synthetic <a> dance was
// pasted into four apps; here it is once.
//
//   import { downloadJSON, pickFile, slug } from './forgekit/files.js';
//   downloadJSON(slug(state.name, 'build') + '.json', doc);
//   const { name, text, data } = await pickFile({ accept: '.json', json: true });

export function slug(s, fallback = 'file') {
  const out = String(s || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return out || fallback;
}

export function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  return name;
}

export function downloadText(name, text, type = 'text/plain') {
  return downloadBlob(name, new Blob([text], { type }));
}

export function downloadJSON(name, obj, { indent = 1 } = {}) {
  return downloadText(name, JSON.stringify(obj, null, indent), 'application/json');
}

// Open the native file picker. Resolves { name, text, data } (data = parsed
// JSON when json: true) or null if the user cancelled.
export function pickFile({ accept = '', json = false } = {}) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    const finish = v => { inp.remove(); resolve(v); };
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return finish(null);
      const text = await f.text();
      let data;
      if (json) { try { data = JSON.parse(text); } catch (e) { return finish({ name: f.name, text, data: undefined, error: e }); } }
      finish({ name: f.name, text, data });
    });
    // cancel: focus returns without a change event
    window.addEventListener('focus', () => setTimeout(() => { if (inp.isConnected && !(inp.files && inp.files.length)) finish(null); }, 400), { once: true });
    inp.click();
  });
}
