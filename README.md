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

# web UI + build library (file:// blocks ES modules)
python tools/serve.py 8329
# then open http://localhost:8329/web/index.html
# server smoke test
python tests/serve-smoke.py
```

Load the "Walker" demo and press Run. "Hopper" is the same body
driven into a bounding gait; "Inchworm" runs a contraction wave down a
three-hump body. "Bridge" is a Warren truss under a pumping load with
the force view on. "Catapult" flings a ball off a solid arm into a stop
bar. "Chain" drapes a chain over a solid bar.

## What you build with

- **Node** - a point mass (mass editable: pill chip cycles 0.5/1/2/4 kg,
  panel slider for fine control). Two independent flags:
  - **Anchor** - fixed to the world. Pivots (merry-go-round), hanging
    points. (Engine field: `pinned`.)
  - **Weld** - the ANGLES between all members meeting at that node are
    held - a rigid joint. Round nodes are free hinges. Needs 2+ members
    to do anything. (Engine field: `locked`.)
- **Beam** - rigid stick.
- **Chain** - a run of rigid links with light joints; sags, swings, wraps.
- Any member can be **Solid** (member panel): nodes of other bodies land
  on it and slide along it with friction. Default is pass-through.
  Anchored solid beams make ramps, walls and platforms.
- **Spring** - passive, stiffness + damping sliders.
- **Actuator** - the muscle: a beam whose length swings between a SHORT
  and a LONG length following a waveform: sine, triangle (constant
  speed) or smooth (holds long, holds short, rounded ends, with a "time
  spent long" duty). Period and phase per actuator; all actuators share
  one global clock, so phase relationships choreograph gaits.

## Controls

- **Palette**: Select / Group / Weld / Node / Beam / Spring / Actuator / Chain / Erase.
- **Chain** tool: drag to lay a run of rigid links (one per grid pitch).
  Anchor an end, hang a weight, drape it over a solid member and it wraps.
- **Weld** tool: tap a node to weld or unweld it; tap a beam to insert a
  welded hub (the beam stays one straight stick with a joint in it);
  drag a node onto another node to merge them into one welded joint.
  The Node tool also inserts a hub when you tap on a member.
- **Value pod**: a floating card over the board with a dial for the
  selected thing's numbers (chips switch which one). "=" opens the full
  panel. Built on ForgeKit, the shared CodeLab web widget kit.
- Tap empty space (Node tool) to place a node. Grid snap is on by
  default; toggle it off for freeform placement. **View** button: theme (Forge dark, Slate, Paper light), square
  or equilateral-triangle lattice, pitch (0.05-1 m), dots or lines,
  brightness. Grid settings live on the device, not in the build file,
  so you can open any save and change the lattice to suit it.
- Member tools (Beam / Spring / Actuator) drag from anywhere: nodes are
  created where needed, and a drag that starts or ends on a line welds a
  hub into that line. Dropping a dragged node onto a line welds it in.
- Tap a node: pill with Anchor / Weld / mass / Del. Tap a member: the
  properties panel (side panel on desktop, slide-up sheet on phones) with
  live sliders - tweak while the sim runs. Every control has a one-line
  tip (hover on desktop, status line on phone). Nothing selected = a
  legend of what everything means.
- One-finger drag on empty space pans; pinch zooms (mouse: wheel).
- **Project name**: click the title next to the logo to rename. **Save**
  stores the build on the server under that name (Ctrl+S; falls back to
  a file download when there is no server). **Open** lists the server
  library and also opens / downloads files.
- **Run/Pause**, **Reset** (restores the build pose and pauses), **Undo/Redo**,
  gravity toggle, follow-camera toggle, **World** (gravity, friction,
  drag, sim speed - opens in the properties panel), Save/Open (JSON file)
  plus localStorage autosave. Clear and Demo are undoable.
- **Group** tool: drag a box around nodes to group them, tap nodes to add
  or remove, drag a grouped node to move the group. The group panel has
  Copy / Paste / Mirror / Delete and, for muscles, shared period and
  amplitude plus "Spread phases". "Select body" on any node or member
  grabs the whole connected creature. Ctrl+C / Ctrl+V / Ctrl+D / Ctrl+A.
- **Force view** (toolbar arrows, key F): members turn red in tension
  and blue in compression, brighter and thicker the more of the build's
  weight they carry. The member panel shows a live "N tension /
  compression" readout.
- Keys: Space run, R reset, G snap, [ ] grid pitch, F force view, V/M/W/N/B/S/A/E tools, Esc deselect,
  Del delete, Ctrl+Z/Ctrl+Y undo/redo, Ctrl+S/Ctrl+O.

## Physics notes

- Position Verlet at a fixed 240 Hz with 12 constraint-relaxation passes.
- Beams and actuators are hard distance constraints; springs are soft,
  force-based (elastic + axial damping), so a lone mass on a spring rings
  at (1/2pi)sqrt(k/m) - the test suite checks exactly that.
- Welded nodes are implemented by hidden bracing constraints between the
  far endpoints of each pair of incident members (triangle rigidity).
  The brace keeps the ANGLE: its length is recomputed every step from
  the members' current lengths, so muscles and springs at a welded joint
  work normally.
- Ground at y=0: restitution ~0, Coulomb friction. The ground clamp
  records how far it pushed each node back up (the normal correction);
  friction may remove at most mu times that from the node's tangential
  displacement. So a foot grips in proportion to how hard it is pressed
  down and a lifting foot slides free - that asymmetry across the gait
  is what makes creatures crawl. A free slider stops in v0^2 / (2 mu g),
  which the tests check at two gravities.
- Actuator amplitude fades in over ~0.8 s from t=0 (soft start), so a
  wave that starts at full throw does not kick the build off the ground.
- Test suite: SHM frequency, pendulum period, beam strain under load,
  actuator waveform tracking, locked-angle preservation, 100k-step
  boundedness, pinned-node immobility, Coulomb stopping distance (two
  gravities, two masses), zero grip when unloaded, static hold, walker
  locomotion at grip 0.3 and 2.0, hopper, member force vs statics
  (hanging / standing mass, spring, two-bar truss), solid-member contact
  (rest height, stopping distance, momentum conservation) - all against
  independent closed-form math. `node tests/run-tests.js`, exit 0 = green.

## Headless verification hooks

- URL params: `?demo=walker|hopper|inchworm|bridge|catapult|merry|chain`, `&run=1` (auto-run),
  `&check=N` (fast-forward N simulated seconds, publish centroid motion
  into `#checkResult` + `document.title` for `--dump-dom`),
  `&layout=1` (toolbar geometry dump).
- Console: `window.TF` = `{state, step, loadDemo, draw, serialize, load,
  play, pause, setTool, centroid, cam, toScreen, toWorld, ...}`.
- Note: Chrome headless clamps window width to 500 px minimum - use a
  real viewport (devtools emulation) for narrower layout checks.

## Roadmap

- **Chains** (Justin, 2026-09-02): a chain / rope member built from many
  short links between two points - sags under gravity, can wrap over
  solid members, optionally solid itself. Probably its own tool that lays
  N links along a drag, plus an engine `chain(state, a, b, links)` helper.

- More demos (catapult, inchworm).
