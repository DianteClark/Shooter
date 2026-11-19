# Operator showpieces: active skins and suits

Pilot for ROADMAP item 44 (Anvil and Coyote, build NEXT 2026-11-19). Low tiers stay recolours; Elite and up get one of
two showpiece tools, both data-driven and both free of new draw calls for everyone not wearing them.

## 1. Active skins (animated effect on the gear)

`js/ui/operators.js`:

```js
export const SKIN_FX = { holo: 1, circuit: 2, shimmer: 3 };   // ids the shader knows; append only
const SKIN_ART = { 'skin:anvil-3': { fx: 'circuit' }, 'skin:coyote-3': { fx: 'shimmer' }, ... };
```

`SKIN_ART` is merged into the skin by id, so a skin's id, unlock and save entry never change. `fx` is drawn by the
operator fragment shader (`CHAR_FRAG` / `skinFx()` in `js/render/characters.js`) over the skin's plain gear pieces
(part 0, not ACC, not KEEP), in object space so it rides with the body, coloured by the skin's `accent`:

| fx | look |
| --- | --- |
| `holo` | iridescent sheen sliding over the gear, scan lines climbing it |
| `circuit` | accent-coloured traces with pulses running up them (Anvil, Bastion) |
| `shimmer` | heat-haze ripples of the accent rolling across the gear (Coyote, Mirage) |

Per instance it is 3 bits of `aOp.y` (`slot + 4 x glow + 16 x suit + 32 x fx`), so it costs no attribute, uniform or
draw call; instances without an fx skip it on one branch. The distance LOD keeps the fx. Team armour (part 1), faces
and accents are never touched, so sides still read. The Operators screen marks active skins with a sweeping band on
the swatch (`.op-skin.active`, css/cards.css).

**Adding an effect**: a new `k` branch in `skinFx()` and a name in `SKIN_FX`. Keep it to a few ALU ops: no textures,
no loops. Inputs: `c` (the lit colour), `p` (object position, metres), `a` (accent), `vLight`, `uTime`.

## 2. Suits (a whole new torso and head)

`js/render/operator-kit.js`:

```js
export const SUITS = {
  coyote: { limbs: { bulk: 1.38, hands: 0x603c22 }, torso(b) { ... }, head(b) { ... } },   // bear suit
  anvil:  { limbs: { bulk: 1.3, hands: null }, torso(b) { ... }, head(b) { ... } },         // mech armour
};
```

and `suit: true` on the skin in `SKIN_ART` (here both tier-5 Mastery skins). While a suit skin is worn the operator's
torso and head are drawn from the **suit bank** (`torsoSuit` / `headSuit`, one InstancedMesh pair holding every suit),
and nothing of its usual torso and head shows. That bank is drawn only when someone on screen wears a suit (+2 draw
calls then, like the kit bank); every other soldier's meshes do not contain suit vertices at all, so the roster's
vertex cost does not grow as suits are added. Suit k is selected through the high bits of the operator's slot 0 / 4
pick (`own + 32 x (k + 1)` in `uSel`): no new uniforms (MAX_OPERATORS budget unchanged).

- `torso(b)` / `head(b)`: MeshBuilder calls in the usual frames (forward +X, up +Y, left +Z; torso origin at the hips,
  head origin at the top of the chest). Everything is tagged SUIT automatically.
- Colours: plain part-0 pieces take the skin's gear colour (keep a dark/mid/light spread, the recolour keeps it);
  `tag(b, KEEP, ...)` for fixed colours (fur, muzzle); `tag(b, ACC, ...)` for lit parts (accent + glow mode);
  `setPart(1)` for team colour. Keep a good share of team colour: it is what tells sides apart top-down.
- `limbs.bulk` thickens arms and legs; `limbs.hands` recolours gloves and boots (null: the skin's gear colour). The
  sleeve and trouser colours are the skin's, as ever.
- A suit works for hand-made and kit operators alike and shows everywhere the renderer draws soldiers: menus, matches,
  killcam, replays, results. Far soldiers (distance LOD) and flying corpse parts use the one-variant meshes, so there a
  suit wearer is a recoloured standard soldier.
- Budget: Coyote's bear is ~1.1k + 0.6k vertices, Anvil's mech ~1.9k + 0.8k. Every suit wearer walks the whole suit
  bank, so at ~40 suits (~100k vertices) split it in two banks by roster half, or move suits to an index-picked bank.

## 3. Silhouettes

New kit parts go in the slot tables (`CORE`, `BACK`, `EXTRA`, `GEAR`, `HAIR`, faces) and are picked by the operator's
`kit`; unused parts cost nothing (only parts some operator uses are merged). Hand-made operators reshape in
`TORSOS` / `HEADS` (characters.js). Each merged part costs its vertices on every soldier of that bank, so prefer
unbevelled boxes and 6-8 sided prisms; aim for the top-down read: shoulders, pack, hat outline. Pilot changes:

- Anvil: bigger drum with a brass belt feed arcing over the right shoulder, a raised gorget ring, tiered pauldrons with
  a team ridge, cheek plates widening the helm.
- Coyote: a team-coloured striped poncho (an octagon past the shoulders with a lit trim, `EXTRA.poncho`) and a cap
  with a long havelock flap and dust goggles on the crown (`GEAR.dustcap`).

Review tools: `dev/ops-lineup.html?ops=anvil,coyote&skin=3&view=close&per=2` (also `view=game` at match scale,
`view=front`, `move=1`).
