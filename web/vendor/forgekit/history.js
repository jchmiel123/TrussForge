// ForgeKit history - undo / redo over serialized snapshots.
//
// Three apps had this (TrussForge, CircuitForge, MolForge) in two
// flavours, both kept here:
//
//   EXPLICIT (TrussForge): call push() BEFORE a mutation. Identical
//   consecutive snapshots collapse, so it is safe to call speculatively
//   (pointerdown on a node that turns out to be a tap).
//
//   COALESCED (CircuitForge): call mark() after ANY edit; when the burst
//   settles (settleMs) the previous committed snapshot is pushed once, so
//   a knob turn, a drag or a slider scrub is ONE history entry.
//
//   const hist = new History({
//     snapshot: () => JSON.stringify(serialize(state)),   // must return a string
//     restore: s => { state = deserialize(JSON.parse(s)); redraw(); },
//     depth: 60,
//     coalesce: true, settleMs: 400,                        // omit for explicit
//     onChange: h => { undoBtn.disabled = !h.canUndo; },    // or hist.bind(undoBtn, redoBtn)
//   });
//
// The app owns the document; History only owns the two stacks. Pure
// logic, no DOM, headless-tested.

export class History {
  constructor({ snapshot, restore, depth = 60, coalesce = false, settleMs = 400, onChange = null } = {}) {
    if (typeof snapshot !== 'function' || typeof restore !== 'function') throw new Error('History needs snapshot() and restore()');
    this._snapshot = snapshot;
    this._restore = restore;
    this.depth = depth;
    this.coalesce = !!coalesce;
    this.settleMs = settleMs;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
    this.committed = this.coalesce ? this.snapshot() : null;
    this._timer = null;
    this._buttons = null;
  }

  snapshot() {
    const s = this._snapshot();
    return typeof s === 'string' ? s : JSON.stringify(s);
  }

  get canUndo() { return this.undoStack.length > 0 || this.pending; }
  get canRedo() { return this.redoStack.length > 0; }
  get pending() { return this._timer !== null; }

  // EXPLICIT: record the current state as the point undo returns to.
  push() { return this._push(this.snapshot()); }

  _push(s) {
    if (this.undoStack.length && this.undoStack[this.undoStack.length - 1] === s) return false;
    this.undoStack.push(s);
    if (this.undoStack.length > this.depth) this.undoStack.shift();
    this.redoStack.length = 0;
    this._changed();
    return true;
  }

  // EXPLICIT: drop the most recent push (a speculative push whose mutation
  // did not happen after all). Returns the discarded snapshot or null.
  discard() {
    if (!this.undoStack.length) return null;
    const s = this.undoStack.pop();
    this._changed();
    return s;
  }

  // COALESCED: an edit happened; commit once the burst settles.
  mark() {
    if (!this.coalesce) return this.push();
    if (this._timer) clearTimeout(this._timer);
    if (this.settleMs > 0) {
      this._timer = setTimeout(() => this.commit(), this.settleMs);
      this._changed();
      return true;
    }
    return this.commit();
  }

  // COALESCED: flush now. Returns true if a history entry was made.
  commit() {
    if (!this.coalesce) return false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const s = this.snapshot();
    let made = false;
    if (s !== this.committed) { made = this._push(this.committed); this.committed = s; }
    this._changed();
    return made;
  }

  undo() {
    this.commit();
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this._apply(this.undoStack.pop());
    return true;
  }

  redo() {
    this.commit();
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this._apply(this.redoStack.pop());
    return true;
  }

  _apply(s) {
    this._restore(s);
    if (this.coalesce) this.committed = s;   // restored state is committed: no phantom entry
    this._changed();
  }

  // Forget everything (after loading a different document, say).
  clear() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    if (this.coalesce) this.committed = this.snapshot();
    this._changed();
    return this;
  }

  // Keep two buttons' disabled state in step.
  bind(undoBtn, redoBtn) {
    this._buttons = { undoBtn, redoBtn };
    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
    this._changed();
    return this;
  }

  _changed() {
    if (this._buttons) {
      const { undoBtn, redoBtn } = this._buttons;
      if (undoBtn) undoBtn.disabled = !this.canUndo;
      if (redoBtn) redoBtn.disabled = !this.canRedo;
    }
    if (this.onChange) this.onChange(this);
  }
}
