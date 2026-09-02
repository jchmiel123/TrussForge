// ForgeKit toast + status line - the two ways an app says something.
//
// toast(msg)      a transient card that stacks bottom-centre and fades;
//                 for events (saved, divided, error) the user did not ask
//                 to watch.
// statusLine(el)  a persistent one-liner the app already owns (a footer
//                 span); set() remembers a hold time so a running ticker
//                 does not overwrite a fresh message in the same frame.
//
// Tones: 'info' (default) | 'ok' | 'warn' | 'err'. Styled by forgekit.css
// (.fk-toasts / .fk-toast) from the theme tokens.
//
//   import { toast, statusLine } from './forgekit/toast.js';
//   toast('Saved as royer', { tone: 'ok' });
//   const status = statusLine(document.getElementById('status'));
//   status.set('Running', 'info');
//   if (!status.held()) status.set(`t=${t.toFixed(1)}s`);

const MAX_STACK = 4;
const hosts = new WeakMap();

function ensureHost(host) {
  const parent = host || document.body;
  let wrap = hosts.get(parent);
  if (!wrap || !wrap.isConnected) {
    wrap = document.createElement('div');
    wrap.className = 'fk-toasts';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    parent.appendChild(wrap);
    hosts.set(parent, wrap);
  }
  return wrap;
}

export function toast(msg, { tone = 'info', ms = 3200, host } = {}) {
  const wrap = ensureHost(host);
  const el = document.createElement('div');
  el.className = 'fk-toast fk-' + tone;
  el.textContent = msg;
  wrap.appendChild(el);
  while (wrap.children.length > MAX_STACK) wrap.firstChild.remove();
  // next frame so the transition runs
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f => setTimeout(f, 0));
  raf(() => el.classList.add('fk-in'));
  let timer = ms > 0 ? setTimeout(() => dismiss(el), ms) : null;
  el.addEventListener('click', () => { if (timer) clearTimeout(timer); dismiss(el); });
  el.dismiss = () => { if (timer) clearTimeout(timer); dismiss(el); };
  return el;
}

function dismiss(el) {
  if (!el.isConnected) return;
  el.classList.remove('fk-in');
  el.classList.add('fk-out');
  setTimeout(() => el.remove(), 220);
}

// Tone shortcuts
toast.ok = (msg, o = {}) => toast(msg, { ...o, tone: 'ok' });
toast.warn = (msg, o = {}) => toast(msg, { ...o, tone: 'warn' });
toast.err = (msg, o = {}) => toast(msg, { ...o, tone: 'err', ms: o.ms ?? 5000 });

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function statusLine(el, { holdMs = 1500 } = {}) {
  let holdUntil = 0;
  return {
    el,
    set(msg, tone = '') {
      if (!el) return;
      el.textContent = msg;
      if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
      holdUntil = now() + holdMs;
    },
    // true while a set() message should not be overwritten by a ticker
    held() { return now() < holdUntil; },
    clear() { if (el) { el.textContent = ''; delete el.dataset.tone; } holdUntil = 0; },
  };
}
