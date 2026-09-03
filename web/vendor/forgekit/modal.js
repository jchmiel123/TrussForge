// ForgeKit modal - a scrim + box with the three behaviours every app
// re-wired: backdrop click closes, Escape closes the top-most open modal,
// focus goes back to whatever opened it.
//
//   <div id="libModal" hidden>
//     <div class="fk-modal-box"> ... <div class="fk-modal-btns">...</div></div>
//   </div>
//
//   import { modal } from './forgekit/modal.js';
//   const lib = modal(document.getElementById('libModal'), { onOpen: refresh });
//   lib.open(); lib.close(); lib.toggle(); lib.isOpen
//
// State is the `hidden` attribute; forgekit.css styles .fk-modal (added
// here) and .fk-modal-box / .fk-modal-btns / .fk-modal-hint. The Escape
// handler runs in the capture phase and stops the event, so an app's own
// Escape binding (deselect, cancel tool) does not also fire.

const openStack = [];
let escapeBound = false;

function bindEscape() {
  if (escapeBound || typeof document === 'undefined') return;
  escapeBound = true;
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || !openStack.length) return;
    const top = openStack[openStack.length - 1];
    if (!top.closeOnEscape) return;
    ev.preventDefault();
    ev.stopPropagation();
    top.close();
  }, true);
}

export function modal(el, { closeOnBackdrop = true, closeOnEscape = true, onOpen = null, onClose = null, focus = true } = {}) {
  el.classList.add('fk-modal');
  if (!el.hasAttribute('hidden') && el.classList.contains('hidden')) { el.classList.remove('hidden'); el.hidden = true; }
  let opener = null;
  const api = {
    el,
    closeOnEscape,
    get isOpen() { return !el.hidden; },
    open() {
      if (!el.hidden) return api;
      opener = typeof document !== 'undefined' ? document.activeElement : null;
      el.hidden = false;
      openStack.push(api);
      if (onOpen) onOpen(api);
      if (focus) {
        const f = el.querySelector('[autofocus], input, select, textarea, button');
        if (f && f.focus) f.focus();
      }
      return api;
    },
    close() {
      if (el.hidden) return api;
      el.hidden = true;
      const i = openStack.indexOf(api);
      if (i >= 0) openStack.splice(i, 1);
      if (onClose) onClose(api);
      if (opener && opener.focus && opener.isConnected) opener.focus();
      opener = null;
      return api;
    },
    toggle() { return el.hidden ? api.open() : api.close(); },
  };
  if (closeOnBackdrop) el.addEventListener('click', ev => { if (ev.target === el) api.close(); });
  bindEscape();
  return api;
}

export function anyModalOpen() { return openStack.length > 0; }
