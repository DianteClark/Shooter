# Animation pass (ROADMAP item 62)

Renderer only: nothing here touches the sim, the wire, bots, replays or maps. Every soldier is still the procedural rig
in `js/render/characters.js` (instanced body parts, two-bone IK for the limbs, springs for weight); this pass adds
layers to it. All state lives on the `Rig` (declared in its constructor, so every rig has one hidden class and the frame
loop's reads stay monomorphic) and every per-frame path writes into preallocated scratch: no allocations per frame.

## Vault and mantle: why there is none

There is no vault or mantle in the sim, and adding one does not fit cleanly: every map is flat (`groundAt` is 0 or
water), there is no low cover (every move-blocking wall also blocks vision, so "over low cover" has no data to work
from), and a vault would need new map data, movement and client prediction changes, bot navigation and replay
handling. So the pass does the visual-only version for the traversal that exists:

- **Slides**: a `DIP` spring drops the body into the legs on the way in and pops it up on the way out (it overshoots).
- **Revive kneel**: the same spring on kneeling down and standing up.
- **Battle royale landing**: on touch-down the off hand goes to the ground by the lead foot (a three-point landing),
  on top of the existing knee dip.
- **Water**: wading sinks the body a little and lifts the knees higher.

## Locomotion blending

`r.locF` / `r.locS` are the smoothed travel along and across the aim. The hips (boot yaw and knee poles) face the
travel when moving forward, the aim when backpedalling, and part way between when strafing; the weights blend, so
direction changes pass through the gaits rather than snapping. Backpedalling shortens the stride, strafing shortens it
and sets the feet wider (they never cross). Standing still the weight drifts from foot to foot (`shift`). Walk, run
and sprint already blended on speed; the lean springs carry starts and stops.

## Reloads

`js/render/anim.js` keeps the per-class tracks (rifle mag swap, side mag, top mag, belt LMG, bolt, pistol, revolver
dump, launcher tube, shell by shell) and adds **tactical** twins for the rifle, bolt, side-mag, top-mag and pistol
tracks: the old magazine goes to a pouch (no magazine drops to the ground) and nothing is charged at the end. The
existing tracks are the **empty** ones (mag dropped free, then the charging handle, slide or bolt). The rig picks by the
rounds in the gun when the reload began (`p.ammo === 0`, `r.relEmpty`); every `RELOADS` entry carries its `tac` track.
A shell-fed gun loaded from empty is racked once full: the reload's end starts the pump / lever / bolt cycle from
`js/render/gun-actions.js` (build 1120-2), so it shares its look with the cycle between shots. LMG belt links still
spill as the cover shuts.

## Weapon swap, throw, flinch

- **Swap**: `r.swapU` runs 0..1 over the new gun's `swapTime`. For the first 42 % the old gun (its own model and
  attachments) goes down and rolls away, then the new one comes up; the support hand leaves the gun in between. The
  `swap` event and the view's weapon change both start it, without restarting each other.
- **Throw**: the existing overhand arc, plus the body's weight going back through the wind-up and forward through the
  release (scaled by the motion setting).
- **Flinch**: `onHit` also kicks `FLINCH_T` (shoulder twist toward the side of the hit), `KNOCK` (the gun knocked off
  line) and, for a headshot, `SNAP` (the head thrown back). Reduced motion scales the kicks down.

## Deaths

`js/render/death-anim.js`. A kill seen on screen keeps the body: `Characters.onKill` picks a fall with `pickDeath`,
freezes a copy of the view (`r.dview`: where it stood, what it held) and the main loop keeps posing the rig from that
copy, with the fall as a pose layer in the finisher shape (`finisher-anim.js`). Because it is the same rig drawn
through the same meshes, every operator, kit piece, Mastery suit, skin and active skin effect falls as itself, at
full or distance detail by the usual LOD rules.

| kind | when | the fall |
| --- | --- | --- |
| back | shot from the front | jolt back, knees go, down on the back, arms flung up and out |
| front | shot from behind | stumble, a knee, face down with the hands out |
| side | hit across the body | spun half round, then down the way it turned |
| head | headshot | head snaps back, drops straight to the knees, folds forward |
| melee | a melee weapon | spun right round, a stagger, onto the back |
| blown | heavy shove (shotgun, sniper, antimat: `forceOf` >= 11) from the front, or a home-run bat | lifted and thrown back a body length or two, lands on the back |
| down | killed while downed (battle royale, Extraction) | stays down, a last shudder, arms out |
| fin | killed by a finisher | holds the finisher's last pose |
| explode | grenades, launchers, streaks, equipment | blown apart by `corpses.js` as before |

The curves are targets; under-damped springs (`stepDeath`, 15 channels) chase them, the same idea as the undead's
limp-on-springs deaths in `zm-bodies.js`: the body overshoots, bounces as it lands and settles, the hands flop. The
gun leaves the hands and tumbles to the ground beside the body (`_droppedGun`). The body lies until `DIE_LIE`, then
dither-fades over `DIE_FADE` (2.25 s in all, inside the 2.5 s respawn). No ring or contact shadow while dying.

After `DIE_SETTLE` (1.15 s) a body is **settled**: its limbs are copied from the last posed matrices (`r.pose`)
instead of solved again, which keeps a pile of bodies cheap. When more bodies are falling than the quality step's
corpse budget (`corpses.limit`), further kills are taken apart the old way.

**Reduced motion** (the OS setting or Options > Reduce shake and flashes, `feelMotion() < 1`): no blown or exploding
bodies (both fall as `back`), the springs are critically damped (no flop), the dropped gun does not spin, and the flinch,
slide dip and throw lean are scaled down.

## Tools

- `dev/anim-gallery.html` (+ `dev/anim-shots.py`): grids of every fall over time, suits and kit operators falling,
  tactical vs empty reloads per class, locomotion directions, swap / throw / flinch / slide.
  `python3 dev/anim-shots.py --scenes=deaths --view=front --extra=only=head&aim=0`
- `dev/ui-anim-test.py`: a real match; kills each way, checks the fall kind, the settling and the fade, the reload
  track pick, swap and flinch, then again with reduced motion. No console errors.
- `dev/anim-bench-node.mjs` + `dev/anim-bench-cmp.sh`: Characters CPU before/after in Node (CPU time, trimmed mean,
  rounds alternated). `dev/anim-bench.html` + `dev/anim-bench.mjs`: the same crowd in Chromium.

## Performance

The bench crowd walks, strafes, backpedals, sprints, slides, shoots, reloads (tactical and empty), swaps, throws, is
hit, and dies every 24 s per player (a heavy TDM) with a 3 s respawn; a third wear Mastery suits, a third kit
operators. Things done to stay inside the budget:

- the per-frame easing factors (`damp`, `Math.exp`) are worked out once per frame, not per rig;
- every `Rig` field is declared in the constructor (swing, cycle, zk, tracer clock were added on the fly before, which
  gave rigs several hidden classes);
- settled bodies copy their limbs instead of solving them;
- the tactical track is a field on the reload entry, not a lookup;
- the frame loop reads each player through one fixed-shape record (`readView`), whatever produced the view (sim,
  snapshot, interpolator, replay, killcam, a falling body's frozen copy). Without it, the first falling body made every
  property read in the loop polymorphic for every rig, which cost more than the falls themselves.

### Measured (2026-11-20, 2-core machine under load average ~9)

`dev/anim-bench-cmp.sh` against an export of the commit before the pass, CPU time per `Characters.update`, trimmed
mean, median of rounds:

| crowd | before | after | change |
| --- | --- | --- | --- |
| 12 (TDM), 4 rounds x 20000 frames | 0.0543 ms | 0.0566 ms | +4.1 % |
| 32 (BR), 4 rounds x 12000 frames | 0.1340 ms | 0.1340 ms | +0.0 % |
| 12, nobody dies, 3 rounds x 8000 frames | 0.0512 ms | 0.0517 ms | +1.0 % |

Short runs on this machine swing by +-15 % round to round; use long runs. No per-frame allocations: the scavenge
count over a run matches the old code's (`node --trace-gc`).
