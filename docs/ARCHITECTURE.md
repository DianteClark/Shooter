# Architecture (read fully before writing code)

iPhone-only, top-down, low-poly 6v6 team deathmatch. Static site, GitHub Pages, no build step.
Native ES modules. `three` and `trystero` resolve via the import map to `vendor/`. No CDNs, no npm in shipped code.

## Coordinates
Metres. X east (right on screen), Z south (down on screen), Y up. Map origin NW corner.
`aim` is radians with direction `(cos aim, sin aim)` in (x, z). See `js/shared/map.js`, `geometry.js`, `constants.js`.
Camera: fixed orientation, north up, tilted about 55 degrees. Landscape phone.

## Ownership (only edit your own area)
| Area | Paths |
|---|---|
| Lead | `index.html`, `js/shared/{constants,geometry,map}.js`, `js/game/`, `docs/` |
| Art | `js/render/`, `js/shared/camos.js`, `dev/render-*` |
| Gameplay | `js/sim/`, `js/shared/weapons.js`, `js/audio/`, `dev/sim-*` |
| Interface | `js/main.js`, `js/ui/`, `js/net/`, `css/`, `manifest.webmanifest`, `assets/`, `dev/ui-*` |

Need a shared-file change? Say so in your final report; do not edit it. No git commands.

## Networking model (client-authoritative, friends only)
Every human owns their own movement, aim, ammo and shots, so controls have zero input lag and no reconciliation is needed.
The host owns HP, kills, score, respawns, bots and match phase. No anti-cheat.
Bots run on the host through the same `stepPlayer` as humans.

## Frame flow (`js/game/match.js`, Lead)
```
input = controls.read()
shots = stepPlayer(localPs, input, dt, map, rng)    // instant, every render frame
each shot -> traceShot() -> local 'shot' event (VFX, audio now) -> host: sim.applyShot / guest: net send
host: fixed 30 Hz sim.step(); every 2 ticks broadcast snapshot; broadcast drained events
view = interpolated snapshots, with the local player overwritten by localPs
renderer.update(view, events, dt);  hud.update(view, dt);  hud.onEvents(events);  audio.onEvents(events, view)
```

## Data shapes

**Input** (from `controls.read()`; edge fields are true for one read only)
`{ mx, mz, aim, aiming, fire, sprint, slide, reload, swap, streak }`
`mx,mz` stick vector length 0..1. `aim` radians or `null` when the right stick is idle.
`aiming` = right stick held (ADS). `fire` = right stick pushed past the fire ring.
A fast flick therefore hipfires before ADS ramps up. No ADS button: thumbs are busy.
`slide, reload, swap, streak` are edge-triggered.

**PlayerState** `ps` (`js/sim/player.js`, human on owner's phone, bots on host)
`id, x, z, aim, vx, vz, slot (0|1), primary, secondary, weapon (current id), camo, ammo:[a,b], reserve:[a,b], reloadT, reloadDur, adsT (0..1), sprinting, sprintRecoverT, sliding, slideT, slideCool, cooldown, bloom (0..1), shotIndex`

**PlayerView** (one entry in `view.players`, what render/HUD consume)
`id, name, team, isBot, skill, x, z, aim, vx, vz, hp, alive, respawnT, weapon, camo, ammo, reserve, reloadT, reloadDur, adsT, sprinting, sliding, spawnProtect (bool), kills, deaths, streak, streakReady (null|'uav'|'strike'), bloom`
`ammo`/`reserve` here are numbers for the current weapon.

**GameView**
`{ t, phase:'warmup'|'live'|'ended', timeLeft, scores:[a,b], winner:null|0|1, uav:[secondsLeftTeam0, secondsLeftTeam1], players:[PlayerView], localId, lastKill:null|{by,target,weapon,camo,x,z} }`

**Events** (flat objects; broadcast by host; consumers receive each exactly once; Lead removes host echoes of the local player's own shots)
- `{t:'shot', by, weapon, camo, ox, oz, aim, rays:[{x,z,hit:'wall'|'player'|'none',nx,nz}]}` ray end points
- `{t:'hit', by, target, dmg, x, z, killed}`
- `{t:'kill', by, target, weapon, camo, x, z, assist, dist}`
- `{t:'medal', id, medal}` ids: `first_blood,double,triple,fury,revenge,longshot,streak3,streak5,streak10`
- `{t:'spawn', id, x, z, aim}`
- `{t:'reload', id, stage:'start'|'end'}`, `{t:'swap', id}`, `{t:'slide', id}`
- `{t:'streak', id, kind:'uav'|'strike', team, x?, z?}`
- `{t:'explosion', x, z, radius, by}`
- `{t:'phase', phase}`

## Module contracts

### Gameplay
`js/shared/weapons.js` : `export const WEAPONS = { ar:{id,name,...}, ... }` for `WEAPON_IDS`; invented names, no real gun names. Stats: damage, rpm, magazine, reserve, reload, range, adsSpread, hipSpread, bloomPerShot, bloomRecover, adsTime, sprintToFire, moveMult, adsMoveMult, pellets (default 1), falloff, kickCam (visual recoil strength), tracerWidth, auto (bool).

`js/sim/player.js` (no DOM, no three, runs in node)
- `createPlayerState({id,primary,camo})`
- `respawnPlayer(ps,x,z,aim,{primary,camo}?)`, refills ammo and resets timers
- `stepPlayer(ps,input,dt,map,rng)` returns `shots[]`, each `{ox,oz,aim,weapon,angles:[radians per pellet]}`; applies sprint, slide, ADS, reload, bloom, recoil, swap, collision via `resolveCircle`
- `traceShot(shot,map,players,selfId)` returns `rays[]` as in the `shot` event (players are `{id,x,z,alive}`; hit radius `PLAYER_RADIUS + 0.1`)
- `applyAimAssist(aim,ps,players,map,dt)` returns aim. Mild slowdown and magnetism at visible enemies within about 8 degrees; a phone needs this
- `encodeHumanState(ps)` / `decodeHumanState(data)` compact arrays for the wire

`js/sim/sim.js` (no DOM, no three, runs in node)
- `buildRoster(humans,{botSkill:'recruit'|'regular'|'veteran'|'elite'|'mixed',teamSize})` fills with named bots. humans `{id,name,team,primary,camo}`. Roster entries `{id,name,team,isBot,skill,primary,camo}`
- `new Sim({roster,map,seed,scoreLimit,timeLimit})`
- `step(dt)`, `applyHumanState(id,decoded)`, `applyShot(id,shot,ageSeconds)` (damage by rewinding targets through a ~300 ms position history), `useStreak(id)`, `humanLeft(id)` (slot held for rejoin, never bot-filled; opens to newcomers after 3 min, see `dev/sim-heldslots.mjs`), `drainEvents()`, `getView(localId)`, `encodeSnapshot()`, `decodeSnapshot(data,localId)` returns GameView
- Host-only damage. Bots: four tiers by reaction time, aim error, awareness, flanking, never aimbot. Think at staggered low rates. Use `hasLineOfSight`.
- Streaks: UAV at 3 kills (reveal enemies 20 s), Strike at 5 (line of explosions at the densest enemy cluster). Player taps to trigger (`input.streak`).
- Scoring: first to `SCORE_LIMIT`, or best at `TIME_LIMIT`. 3 s warmup. Respawn farthest from enemies.

### Engine performance (docs/BR-PERF.md, "After")
- `js/shared/geometry.js` keeps `map.walls` as the source of truth and indexes it with a wall grid (8 m cells, built
  on first use per walls array and cached; maps are static). `raycastMap`, `hasLineOfSight` and `resolveCircle` go
  through it and return exactly what the old loops over every wall returned (`dev/perf-geometry.mjs` proves it). For
  other wall loops: `wallsInBox(map, x0, z0, x1, z1, out)` and `wallsOnRay(map, ox, oz, dx, dz, maxT, out)` fill an
  Int32Array (`wallScratch(map, prev)`) with the indices, ascending, of every wall that may touch the box or segment,
  and return the count; loop over those in that order with the old body and nothing changes. `player.js` walkRay,
  `equipment.js` airHit/solidAt, `sim.js` _onRoof and `render/fog.js` castRay (lists of 64+ walls) do.
- `js/sim/nav.js` `NavGrid`: blocked cells and tactical points are built per wall, not per cell x wall. `coverIndex` /
  `holdIndex` (`PointIndex.near(x, z, r)` fills `.out` with list indices, ascending) let bots scan only nearby cover and
  holds. `big` is true past 40,000 cells (none of today's maps): `findPath` then routes over a sector graph (16 m
  squares split into connected regions) and runs the fine A* only in the sectors along that route, capped at 4,000
  cells; a capped search returns the way to the closest cell it reached and sets `partial`, and the bot plans the next
  leg when it gets there. On big maps a bot with no enemy within 75 m and no human within 100 m thinks at a third of
  its rate (`bots.js` _quiet).
- `js/sim/sim.js` interest management, on when the map is over 40,000 m^2 (`sim.interest`, `setInterest(bool)`):
  `encodeSnapshotFor(guestId)` is the snapshot for one guest (players more than 60 m from them get a position-only
  record, code 2, every third snapshot and nothing in between; teammates near them, anyone firing, every enemy under
  the guest's UAV, and slow blocks go out as ever) and `eventsFor(guestId, events)` drops shots fired more than 150 m
  from the guest by the other side. `decodeSnapshot` reads code 2. The host's match loop sends per guest when
  `sim.interest` is on: `net.sendSnapshot(d, target)`, `net.sendEvents(e, target)` and `net.guests` (linked guests).
- `js/render/world.js` packs the world mesh (position Float32, `aCol` normalised Uint16 x4 over COL_RANGE, `aNP`
  normalised Int8 x4: normal and wet amount): 24 bytes a vertex instead of 40. Maps over 5,000 m^2 (large, huge,
  bigger) cut every static layer (world, decals, signs, glow) into 32 m tiles; `world.chunks` lists them and
  `world.setView(camera, x, z, cut)` (called by the renderer each frame) hides tiles whose box is outside the frustum
  or further than `cut` from the camera target (quality step `cut`: 60 m on Low and Potato, none above; replays get
  none). Small and medium maps keep one mesh per layer. `world.decals` is a Group.

`js/audio/audio.js`: `class AudioEngine { unlock(); onEvents(events,view); setMicActive(bool); update(view,dt); hit markers, medals etc. }`. Synthesized via Web Audio (layered transient + body + tail per gun, no files). Mix must survive iOS mic-on volume drop (compressor; louder when mic active). Distance attenuation from `view.localId`.

### Art
`js/shared/camos.js`: `export const CAMOS = [{id,name,pattern,colors:[...],scale,animated?,tier,unlockKills}]`, `getCamo(id)`. First entry `id:'none'`, unlockKills 0. Patterns: digital, tiger, splinter, hex, and animated mastery tiers (gold, molten, ...). Adding a camo must be one line of data.

`js/render/renderer.js`
- `class GameRenderer { constructor(canvas,map); setLocal(id); update(view,events,dt); resize(); playFinalKill(lastKill); dispose() }`
- `class GunPreview { constructor(canvas); show(weaponId,camoId); tick(dt); dispose() }` for the gunsmith and end card
`update` handles everything: camera follow with lookahead when ADS, screen shake, recoil kick, players, muzzle, tracers, impacts, line-of-sight fog, ADS laser.

Line of sight: fog sampled in world materials from a low-res visibility mask (a world-space visibility polygon around the local player, computed with `raycastMap(..,'blocksVision')`). Enemies out of view are hidden unless UAV is running for the local team. Teammates always shown.

Art direction: flat-shaded low poly, muted slightly desaturated freight yard at dusk, very saturated team colors/tracers/camos. Guns chunky and oversized, big bold camo patterns readable at 40-60 px. Gun parts tagged body/grip/metal/accent with vertex data; camos only affect body.

### Interface
`js/main.js`: app flow (menu, lobby, match, results). Uses `new Match(config)` from `js/game/match.js`.
Match config: `{ canvas, mapId, seed, scoreLimit, timeLimit, roster, localId, hostId, isHost, net, controls, hud, renderer, audio, onEnd(results) }`.

`js/ui/controls.js`: `class Controls { constructor(root); read(); setEnabled(b); showAimHint(...)}` twin-stick, floating left stick; left stick past 92% sprints.
`js/ui/hud.js`: `class HUD { constructor(root); update(view,dt); onEvents(events); setSpectate(...); showEnd(results,onDone); onSetLoadout(cb) }` scores, timer, ammo, kill feed, medals, hitmarkers, damage direction, minimap, streak button, respawn screen with weapon picker, voice mic button.
`js/ui/progress.js`: localStorage (try/catch) weapon kills, camo unlocks.
`js/net/net.js`: `class Net { ...; static host(code,name); static join(code,name); peers; guests; localId; sendLobby(o); onLobby(cb); sendSnapshot(d, target?); onSnapshot(cb); sendEvents(e, target?); onEvents(cb); sendState(d); onState(cb(peerId,d)); sendShot(s); onShot(cb(peerId,s)); onPeerJoin(cb); onPeerLeave(cb); ping(peerId); leave(); }`
Also `js/net/local.js` : same interface over BroadcastChannel (query `?net=local`) so two tabs can test without WebRTC. And `null` net for solo.
`js/net/voice.js`: team voice via Trystero audio streams; opt-in toggle.

## Rules for everyone
- iPhone Safari only, landscape, touch. Target 60 fps on iPhone 13+. Budget: under 120 draw calls, merge static geometry, instancing, no per-frame allocations in hot paths, capped pixel ratio with dynamic resolution, no postprocessing chain.
- Readable, intentional code. Comments state what is non-obvious. No placeholder TODO stubs for promised features.
- Test what you build. Headless Chrome via Playwright: `chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']})`, viewport 844x390, hasTouch. Serve with `python3 -m http.server` from the repo root. Keep test scripts in `/tmp/`, demo pages in `dev/`. Look at screenshots of visual work.
