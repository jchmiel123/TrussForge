# Changelog

## 0.13.0 - 2026-09-02

Reference consumer of ForgeKit 0.4.0 (Wave 2). No engine change; 120/120
tests, serve-smoke ALL PASS.

- Undo/redo is ForgeKit `History` (explicit mode); `pushUndo()` stays
  the call, `hist.discard()` replaces the hub-split pop. Buttons via
  `hist.bind`.
- `resize()` uses `fitCanvas`; the build library modal is ForgeKit
  `modal()` (Escape handled in capture, focus returns to the Open
  button) with `renderLibrary` rows and `saveOrDownload` (server, else a
  download - same behaviour, 90 fewer lines).
- `tools/serve.py` is now 40 lines on the vendored `fkserve.py`
  (DocLibrary with the trussforge validator/summary, `/api/builds`,
  `TF_BUILDS_DIR`). Wire format unchanged; `tests/serve-smoke.py`
  unchanged and green.
- Prefs bag is ForgeKit `Prefs`; downloads use `downloadJSON`.
- Version stamp ritual added (the app had none): `node tools/stamp.js`
  writes `web/version.js`; the `#ver` chip reads "v<ver> - updated
  <date time>". `APP_VERSION` follows the stamp.
- `tools/__pycache__` untracked; `.gitignore` covers it.

## 0.12.0 - 2026-09-02

Chains. 120/120 tests.

- Engine: member kind `chain` (a rigid link, physically a short beam)
  and `chain(state, a, b, links)` that lays a run of light links
  (0.1 kg per joint) along a straight line between two nodes. Chain
  nodes collide with solid members like any node, so a chain drapes and
  wraps. Tests T22a-l: link count and length sum, rigid under load, bob
  hangs at full length straight below, slack chain sags like a catenary
  (mid drop 0.55 m for 0.4 m of slack over 2 m) symmetrically, the demo
  chain never passes through the solid bar and ends up hanging over its
  end, round trip.
- Chain tool (C): drag from anywhere, one link per grid pitch (min
  10 cm). Links draw as hollow capsules; chain joints draw small.
- Demo: Chain - 14 links from an anchor to a 2 kg bob, laid over a solid
  bar; press Run and it wraps.
- Node mass slider / dial now go down to 0.05 kg (chain joints).

## 0.11.0 - 2026-09-02

Welds preserve angles (actuators at welded joints no longer explode),
members start anywhere, drop-on-line welding, movable dial. 108/108.

- Engine: weld braces store the rest ANGLE at the hub and recompute
  their length each step from the members' current target lengths
  (law of cosines; springs use their actual length). A fixed-length
  brace fought any member whose length changed - a muscle at a welded
  joint made two rigid constraints disagree and launched the model.
  Tests T21a-e: welded muscle joint bounded, holds 90 deg to 1e-8 while
  tracking its wave; welded spring stretches with the weld holding.
- Beam / Spring / Actuator tools: drag from anywhere. Empty space makes
  a node; starting or ending on a line welds a hub into it. A tap with a
  member tool places a node (or a hub on a line).
- Dragging a node (Select or Weld) and releasing it on a line splits the
  line and welds the node into it.
- ForgeKit 0.2.0: the pod has a grip bar - drag it anywhere, position
  remembered, double-tap to snap home. TrussForge parks it top-right on
  desktops (it was far away at the bottom) and bottom-right on phones.

## 0.10.0 - 2026-09-02

ForgeKit: themes + dial pod. Weld tool with hubs and merging.

- **ForgeKit** (new shared kit, D:\CodeLab\ForgeKit, vendored under
  `web/vendor/forgekit/` by `tools/sync-forgekit.py`): theme tokens and
  canvas palettes (Forge dark, Slate soft dark, Paper light), the Dial
  (270-degree bounded rotary control with step snapping) and the
  ValuePod (chips + dial + nudge + "=" card).
- Themes: View panel (was Grid) gets a theme select. Every stylesheet
  color is a token now; the board palette follows the theme.
- Value pod floats over the board for whatever is selected: node mass;
  member rest / stiffness / damping or short / long / period / phase /
  long-time; group period + amplitude; world gravity / grip / drag; view
  grid brightness / size. Phase snaps to 1/24. Turning the dial and the
  panel sliders stay in step; one undo entry per turn. On phones the
  sheet no longer opens by itself for nodes / members / groups - the pod
  does the quick edits and "=" opens the sheet.
- **Weld tool** (W): tap a node to weld / unweld; tap a beam (Node tool
  too) to insert a welded HUB - the member splits into two halves that
  stay straight, so a beam can carry a joint in its middle; drag a node
  onto another to MERGE them into one welded joint (members re-pointed,
  duplicates dropped, masses add). Engine: `splitMember`, `mergeNodes`,
  tests T20a-m (a welded hub holds 180 degrees under load, an unwelded
  one folds; merge collapses self-links and duplicate edges).
- 103/103 engine tests.

## 0.9.0 - 2026-09-02

Project name, save to server, new waveforms, start / stop lengths.

- `tools/serve.py`: one Python server for the app AND a build library
  (`/api/builds`: list / GET / PUT / DELETE, atomic writes, no-store
  caching so redeploys take effect on reload). Library dir
  `~/.trussforge-builds` (env TF_BUILDS_DIR), outside the app tree so
  deploys never touch it. `tests/serve-smoke.py` exercises it.
- Project name: an editable title in the toolbar, stored in the build
  file (`name`). Demos name themselves. Document title follows it.
- Save = PUT to the server under the project name (Ctrl+S); if the
  server is unreachable the build downloads as `<name>.json` instead.
  Open = the server library (Load / two-tap Del) plus "Open file..." and
  "Download current". Opened files without a name take the file name.
- Actuator waveforms: sine, triangle (constant speed), smooth (holds
  long / holds short with rounded transitions, duty = time spent long).
  Square is gone from the menu; old files that used it load as smooth.
  Tests T1g-o.
- Actuator panel edits short length and long length instead of rest
  length + amplitude (the file keeps rest + amp, so nothing changes on
  disk; the sliders map onto them).
- 84/84 engine tests + 12 server checks.

## 0.8.0 - 2026-09-02

Solid members (contact), phase detents, spring + anchor graphics, Reset
pauses. 78/78 tests.

- Engine: member flag `solid` (default false = pass-through). Nodes of
  other bodies keep CONTACT_R (6 cm) from a solid member: point-segment
  PBD constraint, mass-weighted, with the same Coulomb friction cap and
  restitution-0 rule as the floor, applied as a mass-weighted inelastic
  impulse so momentum is conserved. A member's own endpoints and their
  direct neighbours never collide with it (no self-jamming). Saved,
  copied and pasted with the member. Tests T18a-h: rests at y +
  CONTACT_R, pass-through falls, sliding stops in v0^2/(2 mu g), a fully
  solid walker walks identically, momentum conserved, round trips.
- Member panel: Solid / Pass-through toggle; solid members draw with a
  pale hard edge. Build ramps and platforms from anchored solid beams.
- Phase slider stops every 1/24 cycle (1/2, 1/3, 1/4, 1/6, 1/8, 1/12 all
  land exactly); readout shows the fraction and degrees.
- Spring drawn as a proper coil: turn count from rest length (stable
  while it stretches), symmetric ends, faint core line.
- Anchor symbol smaller and hidden while running (gold node remains).
- Reset now pauses the sim.

## 0.7.0 - 2026-09-02

Grid settings: lattice types, pitch set, brightness. 70/70 tests.

- New `engine/lattice.js` (headless): square and equilateral-triangle
  lattices, `snapToLattice` (joint x/y nearest point - a triangle grid
  cannot be snapped per axis), `forEachLatticePoint`. Tests T17a-g.
- Grid button + panel (per device, localStorage - NOT in the build
  file, so open any save and switch the grid to fit it): lattice square
  / triangles, pitch from a standard set (0.05 .. 1 m), dots or lines,
  brightness, dot/line size, Defaults. Keys [ and ] step the pitch.
- Default grid is much brighter (it was invisible on phones) and fades
  in as you zoom rather than popping.
- Every placement, drag, group move and paste offset snaps through the
  lattice.

## 0.6.0 - 2026-09-02

Copy / paste / mirror of substructures, group editing. 63/63 tests.

- Engine (`engine/model.js`): `componentOf` (connected body),
  `extractSub` / `insertSub` (portable fragment with rest pose, flags,
  mass, member rest lengths and waves verbatim), `mirrorSub` (left-right
  about the bounding-box centre, rest + current pose), `translateSub`,
  `fragmentBounds`. Tests T16a-j: pasted walker walks like the original
  (within 3 % - float rounding + chaotic gait), rest lengths / waves
  verbatim, mirrored walker walks BACKWARDS at the same speed (physics
  is left-right symmetric), lengths preserved.
- Web: new **Group** tool (M): drag a box to select nodes, tap to add /
  remove, drag a grouped node to move the whole group. Group panel:
  Copy, Paste, Mirror, Delete; when the group has muscles, shared period
  and amplitude sliders plus "Spread phases" (evenly spaced left to
  right - the actuator-group roadmap item).
- "Select body" on node and member panels grabs the connected creature.
- Clipboard persists in localStorage. Paste lands to the right of the
  source when it is on screen, else mid-view, never below ground; the
  pasted group is selected with the Group tool active so it can be
  dragged into place. Toolbar Paste button.
- Keys: Ctrl+C / Ctrl+V / Ctrl+D duplicate / Ctrl+A select all.

## 0.5.0 - 2026-09-02

Bridge demo. 53/53 tests.

- New demo: Bridge - a 4-bay Warren truss, left end anchored, right end
  on a rocker link (anchoring both ends made it a two-hinged arch whose
  thrust put the end bays into compression - the tests caught it), with
  a 4 kg load pumping on an actuator at mid-span. Loading it turns the
  force view on: bottom chord red (tension), top chord blue
  (compression), diagonals alternating.
- Demos carry UI hints (`DEMO_HINTS`: status line, force view on).
- Tests T15a-f: chord counts, bottom chord all tension / top chord all
  compression (closed-form sign result for a simply supported truss),
  mirror-image chords equal within 2 %, abutments immobile, load clears
  the ground.

## 0.4.0 - 2026-09-02

Force view (member strain coloring) + force readout. 47/47 tests.

- Engine: `memberForce(m)` - axial force through a member in Newtons,
  +tension / -compression. Springs report k*ext + c*vrel; rigid members
  sum their relaxation corrections (lambda = position-impulse) and divide
  by dt^2. Reset zeroes it.
- Tests T14a-f against statics: hanging mass = +m*g, standing mass =
  -m*g, spring settles at m*g, two-bar truss (diagonal m*g*sqrt2 tension,
  horizontal m*g compression, within 3 %), unloaded beam ~0.
- Web: Force view toggle (toolbar arrows icon, key F). Members color
  from neutral gray to red (tension) or blue (compression), thicker when
  loaded; full color = carrying the whole build's weight (floor 5 N).
  Actuator cores keep their extension glow. Legend explains it.
- Member panel shows a live force readout ("12.3 N tension") that
  updates while the sim runs.

## 0.3.0 - 2026-09-01

Load-proportional (Coulomb) ground friction. Engine change; 38/38 tests.

- Friction is now a coefficient mu: the tangential displacement removed
  per step is capped at mu times the normal correction the ground clamp
  applied that step. A foot grips in proportion to how hard it is pressed
  down; a lifting foot slides free. A free slider decelerates at exactly
  mu * g (stopping distance v0^2 / 2 mu g - tested at two gravities and
  two masses). Applied as a position correction so static friction truly
  holds (a velocity-only kill let planted feet creep by a*dt^2 per step).
- The `friction` world value keeps its scale (0.7 default = rubber), so
  existing saves stay sensible. Slider range widened to 2.
- Walker gait re-tuned by sweep (1700 crawl candidates x 6 grips):
  period 0.8, amps 0.30 / 0.18, phases 0 / 0.05 / 0.6. Forward for grip
  0.3-2.0, faster on grippier floors, feet stay low. The old gait walked
  backwards below mu 0.5 under the new model.
- New demo: Hopper - same body, a bounding gait airborne ~60 % of the
  time, forward for grip 0.2-2.0.
- Tests: T13a-e (Coulomb closed forms, unloaded contact has no grip,
  static hold), T9c-e (walker at grip 0.3 and 2.0, hopper).

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
