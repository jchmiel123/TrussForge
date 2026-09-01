# TrussForge - Claude Instructions

SodaConstructor-style springs-and-beams sandbox. CircuitForge's sibling:
same dark theme tokens, same engine/web split, same testing discipline.
Everything in-house and dependency-free.

## Hard rules

1. **Engine stays headless.** `engine/` must never import from `web/` or
   touch the DOM. It runs in Node and the browser unchanged.
2. **Tests before engine changes.** Any change to `engine/` must keep
   `node tests/run-tests.js` at 100% pass. Every new behavior gets a
   known-answer check whose expected value comes from an INDEPENDENT
   method (closed form), never from the engine itself.
3. **No external deps.** Pure JS, ES modules, zero npm packages.
4. **Pointer Events only** in the web UI - do NOT add mouse/touch
   listeners to the board. Taps act on pointerup (so a pinch never
   places anything); wrap setPointerCapture in try/catch (synthetic
   test events have no live pointer).
5. **ASCII only** in code/docs/output (CodeLab rule).

## Layout

- `engine/model.js` - state, nodes, members, braces, serialize.
  Node flags: `pinned` (infinite mass, never moves) and `locked` (angle
  weld). The weld is implemented as hidden distance constraints between
  the FAR endpoints of each pair of members at the locked node
  (`rebuildBraces`; pass `fromCurrent=true` when toggling mid-run so the
  weld grabs the deformed pose instead of jolting). Member rest length
  is taken from CURRENT positions on creation (safe mid-run adds).
- `engine/sim.js` - `step(state, dt)` at FIXED_DT = 1/240:
  spring forces (soft, force-based - that is what makes the SHM
  frequency test exact) -> verlet integrate with gravity/drag ->
  12 relaxation passes over beams/actuators/braces + ground clamp ->
  ground velocity response (restitution 0, friction slider = fraction of
  tangential speed removed per 1/60 s of contact).
  Actuator target = rest * (1 + amp * env(t) * wave(t)); env is the
  world.actuatorRamp soft start - without it, a wave that is nonzero at
  t=0 snaps the rigid constraint in one step and kicks the build off
  the ground (that was a real bug, do not remove).
- `engine/demos.js` - walker + merry. The walker gait (phases 0 / 0.25 /
  0.5, period 1.0) was tuned by sweep: forward for friction 0.3-1.0.
  Gaits are chaotic-sensitive - re-run the T9 sweep before touching it.
- `tests/run-tests.js` - `node tests/run-tests.js`, exit 0 = pass.
- `web/app.js` - board UI, organized with section banners. World y is UP
  in the engine; the renderer flips. `window.TF` console hooks.
- `web/index.html` / `web/style.css` - CircuitForge tokens (--bg #0d131a,
  --accent #2f81f7 family). Toolbar groups get `flex-shrink: 0` on
  mobile so rows wrap whole groups.

## Dev workflow

- Serve over http (`python -m http.server 8341`) - file:// blocks ES
  module imports.
- Headless verification:
  `chrome --headless=new --user-data-dir=<fresh> --dump-dom
  --virtual-time-budget=8000 ".../web/index.html?demo=walker&check=20"`
  then grep `TF-CHECK` (gives centroid dx/dy, pinnedMoved, finite).
  Use a FRESH --user-data-dir: headless caches aggressively.
  Chrome headless clamps window width to 500 px min - phone-width
  screenshots get cropped, not reflowed; use devtools emulation for
  real narrow-viewport checks. `?layout=1` dumps toolbar geometry.
- SemVer in `VERSION`; update `CHANGELOG.md` and the version constants
  in `web/app.js` (APP_VERSION, BUILD_DATE) with every feature commit -
  the version + build date badge on the page is a CodeLab convention.

## Conventions

- Engine units: meters, kilograms, seconds; gravity default 9.81;
  ground surface at y = 0.
- Grid snap pitch 0.25 m (`GRID` in app.js).
- Undo is out of scope for v0.1 (roadmap).
