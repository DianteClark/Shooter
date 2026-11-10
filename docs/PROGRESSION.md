# Mastery and the heavier unlock path (save v4)

Owner: progression (`js/shared/progression.js`, `js/ui/progress.js`, `js/game/awards.js`, `js/ui/mastery.js`).

## Ids the cards and operators engineer needs to create

Granted rewards use these ids. Everything below is final; nothing else will be granted.

### Calling cards: `card:mastery-<item>` (card id `mastery-<item>`)
One per mastery track, granted at tier 3 (equipment and streaks) or tier 4 (operators).
The data rows already exist in `CARDS` (`js/shared/progression.js`, group `Mastery`) with working default art
(pattern by kind, the item's own icon as the emblem), so `cardHtml('mastery-frag')` draws today.
To restyle one, change its `art` in `MASTERY_CARD_ART` (progression.js, tell me) or override by id in cards.js.

- Tactical: `mastery-smoke` `mastery-flash` `mastery-stim` `mastery-decoy` `mastery-sensor` `mastery-trophy`
- Lethal: `mastery-frag` `mastery-sticky` `mastery-molotov` `mastery-mine` `mastery-cluster` `mastery-hatchet`
- Scorestreak: `mastery-uav` `mastery-jammer` `mastery-resupply` `mastery-turret` `mastery-mortar` `mastery-strike`
  `mastery-overwatch` `mastery-chopper` `mastery-emp` `mastery-gunship`
- Operator: `mastery-trooper` `mastery-wisp` `mastery-anvil` `mastery-relay` `mastery-yarddog` `mastery-ronin`
  `mastery-ghoul` `mastery-ram` `mastery-monarch`

### Operator skins: `skin:<operator>-<tier>`
Two per operator, granted at operator mastery tier 3 and tier 5 (the tier-5 one is the mastery look). These are the
ids in `SKINS` (js/ui/operators.js), which keeps which skin is worn in its own store; Progress only grants them.

`skin:trooper-3` `skin:trooper-5` `skin:wisp-3` `skin:wisp-5` `skin:anvil-3` `skin:anvil-5` `skin:relay-3`
`skin:relay-5` `skin:yarddog-3` `skin:yarddog-5` `skin:ronin-3` `skin:ronin-5` `skin:ghoul-3` `skin:ghoul-5`
`skin:ram-3` `skin:ram-5` `skin:monarch-3` `skin:monarch-5`

### Weapon mastery cards: `card:mastery-<weapon>`
Granted when a gun finishes its mastery ladder (tier 5). The rows are cardbook.js's (`mastery-<weapon>`).

### Reading grants, skins, emblem, lifetime
- `Progress.hasReward(id)` -> bool for any reward id (`card:...`, `skin:...`, `badge:...`): use it as `granted(id)`.
- `Progress.rewards()` -> Set of every granted id. `Progress.skins(op)` -> the mastery skins with `unlocked`.
- `Progress.operatorSkin(op)` / `setOperatorSkin(op, id|null)`: any earned skin of that operator (field skins by their
  career rule, mastery ones by tier; `skinUnlock` judges). `Progress.emblem()` / `setEmblem(id|null)`.
  Both live in the save (and its codes). `switchyard.custom.v1` (operators.js) is folded in on load and then kept as a
  mirror, so cards.js `equipSkin` can call `Progress.setOperatorSkin` for field skins too instead of `setLocalSkin`.
- `Progress.loadout()` carries `skin` (null = issue look) and `emblem` (earned id or null).
- `Progress.lifetime()` -> lifetime ChallengeTally counts plus `map:<id>` and `mapwon:<id>`.
- `masteryChip('<operator>')` and `masteryPips(Progress.mastery('<operator>'))` from `js/ui/mastery.js`: the tier chip
  and the tier strip for the operator picker (operatorscreen.js); the loadout's operator tile already shows the strip.

Emblem badges (`badge:<item>-1` bronze at tier 2, `badge:<item>-2` gold at the top tier) are drawn by
`js/ui/mastery.js` (`masteryBadge`); nobody else needs to make them.

## Mastery tracks
Every tactical, lethal, scorestreak and operator has a track of sequential tiers (4 for gear, 5 for operators).
Counters are cumulative and only count while the item is in use (thrown, called, or the operator in the loadout at
spawn). Tier rewards: equipment and streaks `+1,000 XP / bronze badge / calling card / gold badge +3,000 XP`;
operators `+1,000 XP / bronze badge / skin / calling card / elite skin + gold badge +5,000 XP`.
Rules and goals: `MASTERY_TRACKS` in progression.js. Counting: `MasteryTracker` (pure, node-testable). The operator
ids and names are repeated in progression.js (`MASTERY_OPERATORS`): operators.js imports cardbook.js, which imports
progression.js, so progression.js cannot import operators.js. A new operator needs a line there to get a track.

## Weapon mastery ladder
After weapon level 30 each gun has five more tiers (`WEAPON_LADDER`): 100 kills, 30 kills while hurt, 15 multi-kills,
five 5-kill lives, 300 kills (counted only once the gun has reached level 30). Tiers pay 2,000 to 6,000 XP and the
badges and the gun's `card:mastery-<weapon>`; finishing the ladder is now required, on top of every camo challenge, for the mastery camos (Sovereign,
Molten Core, Prism). The Gunsmith has a Mastery tab with the goals.

## Unlock challenges
A few late items need a small challenge on top of their level (`UNLOCK_CHALLENGES`): Cluster (10 Frag kills),
Hatchet (15 lethal kills), Trophy (40 tacticals thrown), Attack Chopper (5 streaks called), EMP (10 streaks called),
Gunship (15 scorestreak kills). Level 1 gear is never gated.

## Save v4 and migration
New fields: `mastery: {track: {s:{stat:n}, t:tiers}}`, per weapon `lad:{stat:n}` and `ladT`, `granted:['kind:id']`,
`skins:{operator: skinId}`, `emblem`, `life:{stat:n}`. Migrating from v1 to v3 keeps everything and grandfathers: any gated item already open by
level goes into `granted`, and any mastery camo already earned goes into that weapon's `owned` list, so nobody loses
an unlock. Save codes are `SY4.`; `SY2.` and `SY3.` codes still import through the same migration.

## Requests for other owners
- main.js: pass `mastery: results.mastery` into `menu.results(...)`. Until then results.js falls back to
  `Progress.lastMastery()`, which MatchAwards sets at the end of each match.

Tests: `node dev/ui-mastery-test.mjs` (counting, applying, unlock gates, v1/v3 migration, SY3 and SY4 codes, Progress
over a stored v3 save, and one bot match through the tracker; `quick` skips the match).
