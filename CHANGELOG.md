# Changelog

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
