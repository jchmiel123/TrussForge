# Changelog

## 0.2.0 - 2026-09-01

UI clarity pass. Engine and file format unchanged (33/33 tests).

- Renamed node flags in the UI: Pin -> **Anchor** (fixed to the world),
  Lock -> **Weld** (rigid joint, angles held). "Pin" reads as a hinge in
  truss vocabulary and "Lock" reads as "lock in place", so the old labels
  each described the other button. Engine fields stay `pinned`/`locked`.
- Anchored nodes draw a structural support triangle + ground line.
- Node pill: Anchor / Weld / mass chip (cycles 0.5-1-2-4 kg) / Del.
  Node mass is now editable (chip, or slider in the panel). Heavier
  nodes draw larger.
- One properties panel for everything: node, member, World settings,
  and a legend when nothing is selected. The World drawer no longer
  expands the toolbar and shoves the board down. Panel is narrower with
  compact rows; every control has a one-line tip (hover on desktop,
  status line on phone) and each thing gets a one-sentence description.
- Undo / redo: Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) plus toolbar arrows.
  Covers edits, slider drags (one entry per drag), Clear, demo loads and
  Open, so Clear and Demo are no longer destructive.
- Escape deselects. Rest-length slider range widens for long members.
- Fixed: a pinch that ended with one finger nearly still fell through to
  a tap and could place a node.
- Fixed: Space after clicking a toolbar button pressed the button AND
  fired run/pause (focus is dropped after a click).
- Fixed: status messages were overwritten by the running ticker the same
  frame; they now hold for 2.5 s.
- Fixed: dragging a node while paused no longer leaves a stale rest
  length in an open member panel.
- Perf: no repaint while paused (was redrawing at 60 fps; phone battery).
- Connecting two already-connected nodes now says so and selects the
  existing member.

## 0.1.0 - 2026-09-01

Initial release.

- Headless engine (`engine/`): position Verlet + iterated distance
  constraints at 240 Hz. Beams (rigid), springs (soft, force-based,
  k + damping), actuators (rest length driven by sine/square wave with
  amplitude/period/phase/duty on a global clock, soft-start ramp).
  Node flags: pinned (fixed to world) and locked (angle weld via hidden
  far-endpoint bracing). Ground with restitution-0 contact and
  Coulomb-ish friction, air drag, gravity toggle.
- Test suite: 33 known-answer checks against independent closed-form
  math (SHM frequency, pendulum period, beam strain, waveform tracking,
  locked-angle hold, 100k-step boundedness, pinned immobility, walker
  locomotion, serialization round trip).
- Web UI (`web/`): canvas board, Pointer Events only (tap / drag / pan /
  pinch), tool palette, node pill (pin/lock/delete), live member props,
  World drawer, grid snap toggle, follow camera, Save/Open JSON +
  localStorage autosave, phone layout (bottom palette, slide-up sheet).
- Demos: walker (tuned gait, ~27 cm/s forward, robust for friction
  0.3-1.0) and merry-go-round (pinned + locked hub rotor with a pumping
  bob).
- Headless hooks: `?demo=&run=1&check=N&layout=1`, `window.TF`.
