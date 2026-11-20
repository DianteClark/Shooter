# Operator showpieces: active skins, suits and silhouettes

Piloted on Anvil and Coyote (ROADMAP item 44, build 1119-11/12), then done for every operator (ROADMAP item 49).
Low tiers stay recolours; every Elite skin (tier 3) has its own animated effect, every Mastery skin (tier 5) its own
showpiece suit, and every kit operator a piece of kit nobody else wears. Season skins are untouched. All of it is data
keyed by skin id: ids, unlocks, saves and progress never change. Nothing here adds a draw call for anyone not wearing
a suit.

## 1. Active skins (an animated effect on the gear)

`js/ui/operators.js`:

```js
export const SKIN_FX = { holo: 1, circuit: 2, ..., shockwave: 35 };   // the shader's numbers; append only
const ELITE_FX = { trooper: 'hex', anvil: 'circuit', ... };            // operator -> its Elite skin's effect
```

`SKIN_ART` (built from `ELITE_FX` and one `suit: true` per Mastery skin) is merged into the skin by id. `fx` is drawn by
`skinFx()` in `js/render/operator-suits.js` (`SKIN_FX_GLSL`, included by `CHAR_FRAG` in characters.js) over the
skin's plain gear pieces (part 0, not ACC, not KEEP) and, since item 49, over the sleeves, trousers, gloves and boots
too (the limb meshes' part-2 tint, through the skin look's `limbFx`), in object space so it rides with the body,
coloured by the skin's `accent`. Team armour (part 1), faces and accents are never touched, so sides still read.

Effects 1-3 are the pilot's own GLSL. Effects 4-35 are **rows of numbers** (`FX_ROWS`) run by one parametric
function, `fxUber()`: a band pattern (along a direction, rings out of the chest, a sweep turning round the body, a grid
of two, or chevrons), warped and scrolled, hard or soft; a hash grid of cells, lit, twinkling, reshuffling or climbing;
how the two mix (added or multiplied); a palette (accent, fire, prism, thermal, white); how much gear colour is kept;
a time step (jumps and flicker) and a beat. The table is the uniform array `FXT` (5 vec4 a row, 160 vec4 of the
fragment budget). Why not one branch of code per effect: a software renderer (SwiftShader, the perf sweeps) runs every
branch for every character pixel under a mask, whether anyone wears the effect or not, and a phone GPU sizes its
registers for the biggest branch; 32 branches doubled the character draw cost. Why a uniform and not a const array: a
dynamically indexed const array is copied into every fragment's memory by the same renderer (another doubling).
Measured with `dev/ops-lineup.html?bench=40` (12 operators at match scale, base / Elite / Mastery skins): the same as
build 1119-13 within the machine's noise.

| # | fx | look | operator (Elite skin) |
| --- | --- | --- | --- |
| 1 | holo | iridescent sheen, scan lines climbing | Marshal (Staff) |
| 2 | circuit | traces with pulses running up | Anvil (Bastion) |
| 3 | shimmer | heat-haze ripples | Coyote (Mirage) |
| 4 | flame | tongues licking up, white-hot tips | Warden (Watchfire) |
| 5 | frost | icy glaze, veins, twinkling crystals | Halcyon (Long Night) |
| 6 | glitch | torn bands, channel swaps, stutter | Wren (Night Flight) |
| 7 | starfield | deep space, twinkling stars, nebula | Monarch (Usurper) |
| 8 | lightning | forks crawling over it, flashes | Tinker (Arc Weld) |
| 9 | camo | digital blocks shuffling, a cloak band sweeping up | Wisp (Veil) |
| 10 | lava | dark crust split by molten veins | Ox (Smelter) |
| 11 | aurora | shifting curtains of colour | Vesper (Dusk) |
| 12 | hex | shield grid with pulses | Trooper (Night Recon) |
| 13 | void | swallows light, edges burn | Nyx (Nightshade) |
| 14 | sparkle | glints and a rising sheen | Linnet (Lockbox) |
| 15 | caustics | light through rippling water | Mako (Riptide) |
| 16 | radar | a sweep turning round the body | Relay (Long Wave) |
| 17 | bubbles | rising bubbles | Ghoul (Cyclops) |
| 18 | coderain | glyph columns falling | Cipher (Encrypted) |
| 19 | embers | sparks rising off a smoulder | Flint (Fuse) |
| 20 | hazard | chevron stripes scrolling, a beacon blink | Yard Dog (Switch Tender) |
| 21 | morse | dots and dashes running along lines | Morse (Dot Dash) |
| 22 | heartbeat | a cardiogram trace running round | Sparrow (Night Ward) |
| 23 | thermal | heat-camera bands | Nightjar (Ashfall) |
| 24 | sandstorm | streaks of sand racing past | Sable (Red Rock) |
| 25 | chevron | arrows driving forward | Brigid (Promotion) |
| 26 | ink | brush strokes, a red streak | Ronin (Oni) |
| 27 | checker | board squares flipping in waves | Rook (Riot) |
| 28 | clouds | a sky drifting over it | Skylark (Free Fall) |
| 29 | snow | flakes falling, rimed white | Harrow (Pine) |
| 30 | rays | radiance turning round | Seraph (Fallen) |
| 31 | scan | a security sweep, fine grid | Courier (Contraband) |
| 32 | smoke | grave mist curling | Corvid (Crowfoot) |
| 33 | harlequin | diamonds trading colours | Gambit (Dead Man's Hand) |
| 34 | tracer | rounds streaking across | Garrison (Frontline) |
| 35 | shockwave | rings bursting out of the chest | Ram (Siege) |

Per instance it is `aOp.y` (`slot + 4 x glow + 16 x suit + 32 x fx`), so it costs no attribute, uniform or draw call;
instances without an fx skip it on one branch. The distance LOD keeps the fx. The Operators screen marks active skins
with a sweeping band on the swatch (`.op-skin.active`, css/cards.css).

**Adding an effect**: a row in `FX_ROWS` (fields documented above it), its name appended to `FX_ORDER` and to
`SKIN_FX` (operators.js), in the same order. Try it on everyone with `dev/ops-lineup.html?fx=name&skin=3`. Only add a
new pattern to `fxUber()` itself when no row can make the look, and keep it branch-free (a `mix` or `step` on a row
field, not an `if` around a block).

## 2. Suits (a whole new torso and head)

`SUITS` in `js/render/operator-kit.js` holds the pilot's two; `js/render/operator-suits.js` adds the rest
(`MORE_SUITS`, merged into `SUITS` on import). Each is `{ limbs, torso(b), head(b) }`, worn with `suit: true` on the
skin (every Mastery skin). While a suit skin is worn the operator's torso and head are drawn from its **suit bank**
and nothing of its usual torso and head shows.

| operator | suit | reads from above as |
| --- | --- | --- |
| Trooper | knight in plate, kite shield | gold pauldrons, long team plume |
| Wisp | ghillie monster, will-o'-the-wisps | shaggy mound, team tufts round the shoulders |
| Anvil | mech armour (pilot) | pylons, team chest |
| Relay | tin robot with its radio mast | box head, team shoulder joints, the mast |
| Yard Dog | firefighter | team helmet with the long back brim |
| Ronin | samurai, sashimono banner | team neck guard flaring under a gold crescent |
| Ghoul | hazmat suit | yellow mound, team tape, lit visor |
| Ram | bighorn | two team horn spirals |
| Monarch | lion king | the mane (the biggest disc), team cape |
| Sparrow | plague doctor | wide black hat with a team band, beak |
| Coyote | bear (pilot) | team harness on brown fur |
| Vesper | owl | team wing coverts, two ear tufts |
| Wren | bee | team wings lying flat, stripes |
| Ox | silverback gorilla | crossed team ammo belts, silver back |
| Morse | panda in a beret | team beret, bamboo across the back |
| Cipher | alien in a flight suit | big head, flared silver collar, team suit |
| Harrow | yeti | white mound, team bobble hat |
| Sable | pharaoh | team and gold collar rings, striped nemes |
| Marshal | nutcracker | gold epaulettes, black shako, team tunic |
| Flint | tyrannosaur | tail, a row of team plates down the spine |
| Nyx | spider | eight legs (the widest outline), team band |
| Halcyon | penguin | team ear muffs and scarf, orange beak |
| Tinker | deep-sea diver | the round brass helmet, team collar |
| Rook | viking | round team shield, horns |
| Mako | shark | the team dorsal fin |
| Seraph | phoenix | fanned wings with team coverts, flame crest |
| Warden | wizard, staff with a lit orb | the broad pointed hat, team robe |
| Courier | ninja | team sash tails, shoulder guards, the case |
| Nightjar | wolf | team bandana and harness, the brush |
| Skylark | astronaut | round white helmet, life-support pack |
| Gambit | cowboy | tan hat with curled brim, team shirt |
| Corvid | scarecrow with a crow | the crossbar across the shoulders |
| Linnet | pirate with a treasure chest | the tricorn triangle, team coat |
| Garrison | walking tank | the gun along his aim, team fenders |
| Brigid | dragon | team wing membranes, horns, tail |

- `torso(b)` / `head(b)`: MeshBuilder calls in the usual frames (forward +X, up +Y, left +Z; torso origin at the hips,
  head origin at the top of the chest). Everything is tagged SUIT automatically.
- Colours: plain part-0 pieces take the skin's gear colour (keep a dark/mid/light spread); `tag(b, KEEP, ...)` for
  fixed colours (fur, wood, brass); `tag(b, ACC, ...)` for lit parts (accent + glow mode); `TONE` / `LOCKS` for the
  operator's skin tone and hair; `setPart(1)` for team colour. Every suit keeps a good share of team colour where the
  match camera sees it (shoulders, back, hat): it is what tells sides apart. `harness(b)` is the bear's fix, reusable.
- `limbs`: `bulk` thickens arms and legs, `hands` recolours gloves, `feet` boots (default: hands; null: the skin's
  gear colour), `sleeve` / `trouser` dress the arms and legs (fur, a wetsuit, white trousers) instead of the skin's.
- Helpers in operator-suits.js: `roundBody`, `harness`, `chain` (horns, tails, hoses), `shag` (seeded strips: fur,
  ghillie, straw), `profileX` / `extrude` (flat profiles: shields, banners, fins), `ring`, `skullBack`.
- A suit works for hand-made and kit operators alike and shows everywhere the renderer draws soldiers: menus, matches,
  killcam, replays, results. Flying corpse parts use the one-variant meshes.

### Banks and budget

Suits are dealt into banks of `SUIT_BANK` (10) in roster order (characters.js `SUIT_BANKS`): a wearer's vertex shader
walks only its own bank, and a bank is drawn (+2 calls, and its x-ray pair) only while someone on screen wears one of
its suits. Suit k of a bank is picked through the high bits of the operator's slot 0 / 4 selection (`own + 32 x (k + 1)`
in `uSel`): no new uniforms. Measured (node, item 49): 73.5k suit vertices in all, banks of 23.5k, 20.1k, 19.3k and
10.7k, so a suit wearer costs about what a kit soldier does (kit bank 28.9k). Keep a new suit around 1.2k-2.5k.

### Distance twins

Each bank has a far twin (`B.ft` / `B.fh`), built by running the same suit code through `farSuitBuilder()`: bevels
dropped, prisms capped at six sides (four when thin), every piece scored by what the match camera sees of it (top-down
area plus some height, team colour weighted up) and the best kept up to `FAR_BUDGET` ([360, 210] vertices, torso and
head). A suit wearer past the LOD distance (or past the ten nearest) gets its suit's twin (~540 vertices, ~5.3k per
far wearer for a bank) instead of the plain distance soldier, so a bear still reads as a bear across the map. No
authoring needed; a suit that loses something it needs at range can make that piece part 1 or bigger.

## 3. Silhouettes

New kit parts go in the slot tables (`CORE`, `BACK`, `EXTRA`, `GEAR`, `HAIR`, faces) and are picked by the operator's
`kit`; unused parts cost nothing (only parts some operator or undead uses are merged). Hand-made operators reshape in
`TORSOS` / `HEADS` (characters.js). Each merged part costs its vertices on every soldier of that bank, so prefer
unbevelled boxes and 6-8 sided prisms; aim for the top-down read: shoulders, pack, hat outline.

- Pilot: Anvil's drum with a brass belt feed, gorget and tiered pauldrons; Coyote's team poncho and dust cap.
- Item 49, a piece only that operator wears, for every kit operator that shared its outline: Sparrow's medic cross
  on the helmet (`medhelm`), Vesper's scrim veil (`veilhood`), Morse's wire reel (`spool`), Flint's door on her back
  (`door`), Nyx's crossed blades and night hood (`blades`, `nvghood`), Rook's sledgehammer (`sledge`), Courier's hard
  case (`briefcase`), Nightjar's hunting cloak (`cloak`), Corvid's cowl (`cowl`), Linnet's scavenger frame taller than
  she is (`junkpack`), Garrison's company radio with a team pennant and his dish helmet (`bigradio`, `brodie`),
  Brigid's champion's cape and laurel (`cape`, `laurel`). Kit bank (with the undead's parts): 24.4k -> 28.9k vertices.

## Review tools

`dev/ops-lineup.html`: `?skin=base|field|2|3|4|5`, `view=game` (match scale), `view=close`, `view=front`, `zoom=2`
(close and front), `far=1` (everyone on the distance meshes), `mixteams=1`, `ops=a,b`, `per=N`, `aim=1.3`,
`move=1`, `fx=name`. Perf: `python3 dev/ui-sweep-perf.py PORT OUT tdm --suits` dresses the whole match in twelve
different suits.
