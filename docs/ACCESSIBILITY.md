# Accessibility (roadmap item 23)

Options > Accessibility (the button on the Graphics heading, `js/ui/a11yscreen.js`) holds every setting below. Each is
an Options key (`js/ui/options.js`), applied in `main.js applyOptions`, kept on the phone like the rest of Options.

| Setting | Key | Values (default first) |
|---|---|---|
| Colour mode | `colorMode` | `off`, `protan` (Protanopia), `deutan` (Deuteranopia), `tritan` (Tritanopia), `contrast` (High contrast) |
| Menu text size | `textSize` | `normal`, `large`, `larger` |
| Reduce shake and flashes | `calm` | `false`, `true` |
| Sound cues | `cues` | `nades` (grenades), `off`, `all` (grenades and steps) |
| Touch layout | `layout` | `{}` (the default layout), or the editor's places and sizes |

## Colour modes

One palette module, `js/shared/palette.js`, decides every colour that carries meaning. `applyPalette(id)` swaps them in
place, so no reader changes:

- `TEAMS[i].color` and `.css` (`js/shared/constants.js`): team 0 and 1, the twelve free-for-all colours and the battle
  royale squads past them. The HUD, minimap, kill feed, scoreboard, squad panels, pings, quick chat, the lobby and the
  world build read these at use time.
- `TEAM_RGB`: the `[r, g, b]` arrays the renderers share (`characters.js` team rings and tints, `combat.js` objective
  zones, flags and team effects, `renderer.js` tracers and hit bursts). They are rewritten in place, so a change shows
  on the next frame.
- `BR.rarityCss` / `rarityHex`: loot beams, the Take prompt and the hand slots.
- CSS tokens on the root: `--c-blue`, `--c-red`, `--c-go` with their `-lo`, `-hi`, `-glow` and `--face-*`. Every screen
  and the HUD already read these: damage arcs, the kill skull, low health, the down states in squad panels and Graveyard
  Shift's crew, the objective HUDs (Domination, Hardpoint, Control, CTF, Gunfight's flag, Search's bomb).
- `html[data-cb="<mode>"]` for the shape cues below.

Per mode the two sides are picked to differ for that colour vision in both hue and lightness, and danger never relies on
red against green: Protanopia and Deuteranopia use blue against yellow with success in cyan; Tritanopia uses teal against
rose; High contrast uses the brightest pair with solid HUD plates and heavier outlines. Danger and damage take the enemy
colour.

Shapes, so colour is never the only cue (in every colour mode):

- Enemy team rings in the world are broken into six dashes (`uShapes` on the ring material); teammates' stay whole.
- Kill feed rows of the enemy side have a hatched edge instead of a solid one.
- Battle royale's Take prompt shows the rarity tier as pips (one for Common to five for Legendary).
- Already shape-coded everywhere: minimap teammates are squares and enemies diamonds, gunfire pings hollow rings, hit
  markers a cross, an armour bracket, a skull for a kill.

## Touch layout

Options > Accessibility > Touch layout > Edit layout opens `js/ui/layouteditor.js`, a full-screen editor drawn with the
match's own control classes. Tap a control to pick it, drag to move it, minus and plus to size it; Reset puts the picked
control back, Reset all every control; Left hand previews the mirrored layout; Save writes `Options.layout`.

| Control | Moves | Size |
|---|---|---|
| Move stick, Aim stick | yes, each on its own thumb's half | 80-130%: the ring grows with it (the move stick's travel to full speed, the aim ring's travel to fire) |
| Slide, Swap, Tactical, Lethal | yes | 75-150% |
| Streak tiles (with the score) | yes: placed tiles leave the dock and count as a button for the HUD layout | 100-140% (never under the 44 px touch size) |
| Mic, quick chat, emote chips | no: they stay in the top corner | 80-140% (their wheels open under them) |

There are no touch Reload or Melee buttons: reload is automatic and Melee is the Finish prompt in the lane (and a
controller button), which the HUD layout places.

`Options.layout` holds only what changed: `id -> { x, y, s }`, the centre as fractions of the safe area (x measured in
the right-handed layout) and the size. Fractions make one layout fit every phone.

`js/ui/layout.js placeControls()` is the one placement pass, run by the editor's preview and by `Controls.#measure` in a
match (so on every match start, rotation, hand and size change), before the touch rects are measured. It:

- keeps each moved control inside the safe area and under the band the HUD keeps along the top (42% of the safe height
  on the move side, where the kill feed's rows sit under the minimap; 34% on the aim side, where the weapon panel
  shrinks to fit over the buttons);
- keeps each stick on its own thumb's half (the touch split stays the middle of the screen);
- pushes a moved control clear of every other one (8 px between faces; a stick counts by the inner part a thumb starts
  on), fixed controls first and the one being dragged last.

`js/ui/hud.js layout()` then runs as before from the measured rects: health, the prompt lane, the weapon panel and the
kill feed keep clear of wherever the controls are.

Left-handed mirrors the custom layout too: a placed control's x is mirrored, defaults use the existing `.lefty` rules.
`dev/ui-a11y-test.py` checks a custom layout and its mirror in a match at three sizes against the HUD layout test's
panel checks; `dev/ui-hud-layout-test.py` covers the default layout in every mode, both hands and three HUD sizes.

## Reduce shake and flashes

- Camera shake (every source, including the killcam's) and gun kick at a quarter (`js/render/feel.js feelMotion`, which
  also follows the system's reduce-motion setting).
- Explosion and muzzle light pops at about a third (`feelFlash`, `vfx.applyPops`).
- The flashbang still blinds, with a dark veil instead of a white flash.
- Blinking warnings hold still (low-health pulse, the enemy UAV tag, killcam REC, Swap's urge, Search's planted bomb),
  and the scripted UI motion of `js/ui/motion.js` (`setReducedMotion`) and the HUD's hit punch and respawn flash are off.

## Sound cues

`js/ui/cues-hud.js`, drawn around the middle of the screen:

- Grenades (on by default): a thrown explosive or flash within 10 m, yours or an enemy's (a teammate's cannot hurt you),
  as a marker that points at it with its name; it blinks inside 5 m (not with Reduce flashes).
- Steps (off by default): enemy footsteps exactly when `js/audio/audio.js` plays them (moving, not sliding, not on Dead
  Silence, within 24 m), as a thin arc on their side, stronger for nearer and running. Direction only, never a position:
  the same information the sound gives.

Text callouts already cover the other key sounds (incoming mortars, enemy streaks, UAV, EMP, the bomb).

## Menu text size

Large and Larger raise the type tokens (`--fs-micro` to `--fs-title`) inside menus and overlays. The HUD has its own
HUD size.

## Tests

`python3 dev/ui-a11y-test.py [port]`: each colour mode changes the palette (tokens, TEAMS, rarity; in a match the
renderer's colours, the ring shape and a HUD element), the editor's drag, overlap push, top band and resize, Save, the
layout in a match and mirrored, Reset, calm, the cues, and the title's emote row at 640-956 px.
