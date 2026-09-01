# TrussForge

A SodaConstructor-style springs-and-beams physics sandbox. Build a truss
out of nodes and members, give it muscles, press Run, and watch it crawl
across the floor. Phone-first: everything works with one finger.

CircuitForge's sibling: same dark UI, same headless-engine + canvas-web
split, same known-answer testing discipline.

## Quick start

```
# physics tests (must be 100%)
node tests/run-tests.js

# web UI - serve over http (file:// blocks ES modules)
python -m http.server 8341
# then open http://localhost:8341/web/index.html
```

Load the "Walker" demo and press Run.

## What you build with

- **Node** - a point mass (mass editable: pill chip cycles 0.5/1/2/4 kg,
  panel slider for fine control). Two independent flags:
  - **Anchor** - fixed to the world. Pivots (merry-go-round), hanging
    points. (Engine field: `pinned`.)
  - **Weld** - the ANGLES between all members meeting at that node are
    held - a rigid joint. Round nodes are free hinges. Needs 2+ members
    to do anything. (Engine field: `locked`.)
- **Beam** - rigid stick.
- **Spring** - passive, stiffness + damping sliders.
- **Actuator** - the muscle: a beam whose REST LENGTH follows a waveform.
  Per actuator: sine or square (with duty cycle), amplitude (+/- fraction
  of rest length), period, phase. All actuators share one global clock,
  so phase relationships choreograph gaits.

## Controls

- **Palette**: Select / Node / Beam / Spring / Actuator / Erase.
- Tap empty space (Node tool) to place a node. Grid snap is on by
  default; toggle it off for freeform placement.
- Drag node-to-node (member tools) to connect; drag node-to-empty to
  create the far node and the member in one gesture.
- Tap a node: pill with Anchor / Weld / mass / Del. Tap a member: the
  properties panel (side panel on desktop, slide-up sheet on phones) with
  live sliders - tweak while the sim runs. Every control has a one-line
  tip (hover on desktop, status line on phone). Nothing selected = a
  legend of what everything means.
- One-finger drag on empty space pans; pinch zooms (mouse: wheel).
- **Run/Pause**, **Reset** (restores the build pose), **Undo/Redo**,
  gravity toggle, follow-camera toggle, **World** (gravity, friction,
  drag, sim speed - opens in the properties panel), Save/Open (JSON file)
  plus localStorage autosave. Clear and Demo are undoable.
- Keys: Space run, R reset, G snap, V/N/B/S/A/E tools, Esc deselect,
  Del delete, Ctrl+Z/Ctrl+Y undo/redo, Ctrl+S/Ctrl+O.

## Physics notes

- Position Verlet at a fixed 240 Hz with 12 constraint-relaxation passes.
- Beams and actuators are hard distance constraints; springs are soft,
  force-based (elastic + axial damping), so a lone mass on a spring rings
  at (1/2pi)sqrt(k/m) - the test suite checks exactly that.
- Locked nodes are implemented by hidden bracing constraints between the
  far endpoints of each pair of incident members (triangle rigidity).
- Ground at y=0: restitution ~0, Coulomb-ish friction (the friction
  slider is the fraction of tangential speed removed per 1/60 s of
  contact). Asymmetric loading across the gait is what makes creatures
  crawl.
- Actuator amplitude fades in over ~0.8 s from t=0 (soft start), so a
  wave that starts at full throw does not kick the build off the ground.
- Test suite: SHM frequency, pendulum period, beam strain under load,
  actuator waveform tracking, locked-angle preservation, 100k-step
  boundedness, pinned-node immobility, walker locomotion - all against
  independent closed-form math. `node tests/run-tests.js`, exit 0 = green.

## Headless verification hooks

- URL params: `?demo=walker|merry`, `&run=1` (auto-run),
  `&check=N` (fast-forward N simulated seconds, publish centroid motion
  into `#checkResult` + `document.title` for `--dump-dom`),
  `&layout=1` (toolbar geometry dump).
- Console: `window.TF` = `{state, step, loadDemo, draw, serialize, load,
  play, pause, setTool, centroid, cam, toScreen, toWorld, ...}`.
- Note: Chrome headless clamps window width to 500 px minimum - use a
  real viewport (devtools emulation) for narrower layout checks.

## Roadmap

- Member strain coloring / force readouts.
- More demos (bridge under load, catapult, inchworm).
- Copy/paste of substructures; mirror.
- Actuator group editing (select several, phase-spread them).
