// The caster camera's pure parts (docs/RANKED.md, ROADMAP item 60): who can be followed, Next / Previous, the player
// list's order, the tactical view's framing and the eased shot. No DOM, no renderer: js/game/caster.js drives them and
// dev/sim-ranked.mjs tests them. Nothing here allocates per call except listOrder (run a few times a second).
export const TILT = 55 * Math.PI / 180;       // The match camera's tilt (js/render/renderer.js, js/game/replay-player.js).
export const FOLLOW_DIST = 30, FOLLOW_FOV = 26;
export const FREE_DIST = 44, FREE_FOV = 30, FREE_MIN = 22, FREE_MAX = 90;
export const TACTICAL_MIN = 56, TACTICAL_MAX = 130, TACTICAL_FOV = 34;
export const EASE_FOLLOW = 6, EASE_FREE = 12, EASE_TACTICAL = 2.4;

// The living players worth a camera: not the undead, not extraction's patrols, not someone aboard the plane.
export const followable = p => !!p && p.alive && !p.zk && !p.ai && p.air !== 1 && !p.dummy;

// The next (step 1) or previous (-1) followable player after `id`, in the view's order (sides in turn). From nobody, or
// someone no longer followable, the first one. null when nobody can be followed.
export function cycle(view, id, step = 1) {
  const list = view?.players ?? [];
  let n = 0, at = -1;
  for (let i = 0; i < list.length; i++) if (followable(list[i])) { if (list[i].id === id) at = n; n++; }
  if (!n) return null;
  const want = at < 0 ? 0 : (at + step + n) % n;
  for (let i = 0, k = 0; i < list.length; i++) if (followable(list[i])) { if (k === want) return list[i].id; k++; }
  return null;
}

// The player list: sides in order (team 0 first), best score first within a side; the undead and patrols left out.
// out: an array to fill (reused by the caller).
export function listOrder(players, out = [], firstTeam = 0) {
  out.length = 0;
  for (let i = 0; i < players.length; i++) { const p = players[i]; if (!p.zk && !p.ai && !p.dummy) out.push(p); }
  out.sort((a, b) => ((a.team === firstTeam ? 0 : 1) - (b.team === firstTeam ? 0 : 1)) || (a.team - b.team) || ((b.score ?? 0) - (a.score ?? 0)) || ((b.kills ?? 0) - (a.kills ?? 0)));
  return out;
}

// The tactical (overhead) view: centred on everyone in play, as high as it takes to keep them on screen (between
// TACTICAL_MIN and TACTICAL_MAX), the whole map when nobody is up. map: { width, height }. out reused when given.
export function tacticalFrame(players, map, out = { x: 0, z: 0, dist: TACTICAL_MIN, fov: TACTICAL_FOV }) {
  let n = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!followable(p)) continue;
    n++;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
  }
  if (!n) { x0 = 0; x1 = map.width; z0 = 0; z1 = map.height; }
  out.x = (x0 + x1) / 2; out.z = (z0 + z1) / 2;
  // A wide phone screen: the spread across is what decides the height, the depth a little less (the tilt shortens it).
  const span = Math.max(x1 - x0, (z1 - z0) * 1.5, 20);
  out.dist = Math.max(TACTICAL_MIN, Math.min(TACTICAL_MAX, span * 0.95 + 18));
  out.fov = TACTICAL_FOV;
  return out;
}

const damp = (k, dt) => (dt >= 1 ? 1 : 1 - Math.exp(-k * dt));
// Eases a cinematic shot (renderer.setCinematic's description) towards a goal { x, z, dist, fov } at the match tilt.
// ease: how quickly (per second); dt 1 or more snaps. The camera looks at the goal from the south, as in a match.
export function aimShot(shot, goal, dt, ease = EASE_FOLLOW) {
  const k = damp(ease, dt);
  const gy = goal.dist * Math.sin(TILT), gz = goal.z + goal.dist * Math.cos(TILT);
  shot.px += (goal.x - shot.px) * k; shot.py += (gy - shot.py) * k; shot.pz += (gz - shot.pz) * k;
  shot.tx += (goal.x - shot.tx) * k; shot.ty = 0; shot.tz += (goal.z - shot.tz) * k;
  shot.fov += (goal.fov - shot.fov) * k;
  return shot;
}
