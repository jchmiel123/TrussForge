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
  Node flags: `pinned` (infinite mass, never moves - the UI calls it
  **Anchor**) and `locked` (angle weld - the UI calls it **Weld**; do not
  reintroduce "Pin"/"Lock" labels, "pin" means hinge in truss vocabulary
  and confused the user). The weld is implemented as hidden distance constraints between
  the FAR endpoints of each pair of members at the locked node
  (`rebuildBraces`; pass `fromCurrent=true` when toggling mid-run so the
  weld grabs the deformed pose instead of jolting). Member rest length
  is taken from CURRENT positions on creation (safe mid-run adds).
- `engine/sim.js` - `step(state, dt)` at FIXED_DT = 1/240:
  spring forces (soft, force-based - that is what makes the SHM
  frequency test exact) -> verlet integrate with gravity/drag ->
  12 relaxation passes over beams/actuators/braces + ground clamp (which
  accumulates each node's normal correction `_gn`) -> ground response:
  restitution 0 + Coulomb friction, tangential POSITION correction capped
  at mu * `_gn` (position, not velocity-only: velocity-only let planted
  feet creep a*dt^2 per step, T13e). `world.friction` IS mu (0..2).
  Actuator target = rest * (1 + amp * env(t) * wave(t)); env is the
  world.actuatorRamp soft start - without it, a wave that is nonzero at
  t=0 snaps the rigid constraint in one step and kicks the build off
  the ground (that was a real bug, do not remove).
- `engine/demos.js` - walker + hopper + merry. Walker gait (period 0.8,
  amps 0.30/0.18, phases 0/0.05/0.6) was tuned by sweep for the Coulomb
  model: forward for grip 0.3-2.0, < 2 % airborne. Hopper = same body,
  bounding. Gaits are chaotic-sensitive - re-run a sweep (score = WORST
  dx across mu 0.3..2.0, constrain airborne fraction for a crawl) before
  touching the engine's contact code or the gait numbers.
- `tests/run-tests.js` - `node tests/run-tests.js`, exit 0 = pass.
- `web/app.js` - board UI, organized with section banners. World y is UP
  in the engine; the renderer flips. `window.TF` console hooks (incl.
  `select`, `undo`, `redo`, `undoDepth`).
  - ONE properties panel (`renderProps`) for node / member / world /
    legend, driven by `sel.kind`. The World button is `select('world')`.
    On phones (`narrow` media query) the panel is a slide-up sheet that
    opens for members and world but NOT for nodes (the pill is enough).
  - Undo = JSON snapshots of `serialize(state)`; `pushUndo()` BEFORE a
    mutation, consecutive identical snapshots collapse. Sliders push on
    pointerdown (one entry per drag).
  - The frame loop does not repaint while paused; every paused edit path
    calls `draw()` itself (draw also positions the pill).
  - Pointer position = clientX minus canvas rect (`evPos`), not offsetX:
    synthetic PointerEvents get wrong offsetX inside the preview pane.
  - `fitView` before the board has a size sets `pendingFit`; `resize`
    retries. The preview pane opens tabs at 0x0 first.
- `web/index.html` / `web/style.css` - CircuitForge tokens (--bg #0d131a,
  --accent #2f81f7 family). Toolbar groups get `flex-shrink: 0` on
  mobile so rows wrap whole groups.

## Hosting (VULCAN)

- Lives on Vulcan at ~/vulcan/repos/TrussForge, served by launchd agent
  com.vulcan.trussforge (userland python http.server, 0.0.0.0:8337,
  repo root, KeepAlive). Open http://vulcan:8337/web/index.html - the
  AnvilLab portal at http://vulcan/ has its card.
- Vulcan has NO git: deploy = `git archive` locally, scp the tarball,
  extract over ~/vulcan/repos/TrussForge. Static files - no restart
  needed. Restart anyway: `ssh vulcan "launchctl kickstart -k
  gui/$(id -u)/com.vulcan.trussforge"`.
- Portal card lives in ~/vulcan/repos/AnvilLab/server.py (SERVICES
  list) + the icon map in its index.html; restart com.vulcan.anvillab
  after editing.

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
- Undo/redo shipped in 0.2.0 (snapshot based, depth 60).
