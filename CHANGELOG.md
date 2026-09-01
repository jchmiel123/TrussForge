# Changelog

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
