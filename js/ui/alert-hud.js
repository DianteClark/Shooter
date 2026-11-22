// High Alert (perks wave, js/shared/catalog.js): the screen edge pulses toward anyone off screen who has you in their
// sights, and Sixth Sense (its Pro) pings the minimap with enemies close behind you. Pure over the view (no DOM, no
// three): hud.js calls these from its Pro layer and minimap, so nothing runs for a player without the perk.
import { hasLineOfSight } from '../shared/geometry.js';

export const ALERT_RANGE = 34;            // Metres: past this nobody is "on you".
export const ALERT_CONE = 0.13;           // Radians either side of their aim (about 7.5 degrees).
export const ALERT_HZ = 10;               // Sight checks a second (they test walls).
export const SIXTH_RANGE = 8;             // Sixth Sense: metres behind you.
const BEHIND = 1.75;                      // Radians off your own aim that count as behind.

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// Enemies alive in the view whose aim is on `me` and who can see them. Fills and returns `out`.
export function sightedBy(view, me, map, out = []) {
  out.length = 0;
  if (!me || !me.alive || !view?.players) return out;
  for (let i = 0; i < view.players.length; i++) {
    const p = view.players[i];
    if (p.team === me.team || !p.alive || p.id === me.id) continue;
    const dx = me.x - p.x, dz = me.z - p.z, d = Math.hypot(dx, dz);
    if (d > ALERT_RANGE || d < 0.5) continue;
    if (Math.abs(wrap(Math.atan2(dz, dx) - p.aim)) > ALERT_CONE + 0.45 / d) continue;   // A wider cone up close.
    if (!hasLineOfSight(map, p.x, p.z, me.x, me.z, view.smokes)) continue;
    out.push(p);
  }
  return out;
}

// Enemies within SIXTH_RANGE behind `me` (outside a forward half-cone), for the minimap. Fills and returns `out`.
export function behindMe(view, me, out = []) {
  out.length = 0;
  if (!me || !me.alive || !view?.players) return out;
  for (let i = 0; i < view.players.length; i++) {
    const p = view.players[i];
    if (p.team === me.team || !p.alive) continue;
    const dx = p.x - me.x, dz = p.z - me.z;
    if (Math.hypot(dx, dz) > SIXTH_RANGE) continue;
    if (Math.abs(wrap(Math.atan2(dz, dx) - me.aim)) < BEHIND) continue;
    out.push(p);
  }
  return out;
}

// Draws one pulse on the edge of a W x H canvas toward each threat that is off screen (or nearly at its edge).
// `project(x, y, z)` gives screen pixels or null; `t` is a clock in seconds for the pulse; `css` the warning colour.
export function drawAlerts(g, threats, project, W, H, t, css = '#ff4d3d') {
  let drawn = false;
  const cx = W / 2, cy = H / 2, pad = 0.06;
  for (const p of threats) {
    const q = project(p.x, 1, p.z);
    if (!q) continue;
    const sx = q.x, sy = q.y;
    const inside = sx > W * pad && sx < W * (1 - pad) && sy > H * pad && sy < H * (1 - pad);
    if (inside) continue;                  // On screen: you can see them yourself.
    const dx = sx - cx, dy = sy - cy, k = Math.min(Math.abs(cx / (dx || 1e-6)), Math.abs(cy / (dy || 1e-6)));
    const ex = cx + dx * k, ey = cy + dy * k;
    const r = Math.min(W, H) * 0.42, pulse = 0.65 + 0.35 * Math.sin(t * 9);
    const grad = g.createRadialGradient(ex, ey, 0, ex, ey, r);
    grad.addColorStop(0, css);
    grad.addColorStop(0.35, css);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.55 * pulse;
    g.fillStyle = grad;
    g.beginPath(); g.arc(ex, ey, r, 0, Math.PI * 2); g.fill();
    // A bright chevron in from the edge, pointing at them, with a dark outline so it reads over anything.
    const a = Math.atan2(dy, dx), ix = ex - Math.cos(a) * 30, iy = ey - Math.sin(a) * 30;
    g.globalAlpha = pulse;
    g.fillStyle = '#fff2ec'; g.strokeStyle = 'rgba(20,10,10,.8)'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ix + Math.cos(a) * 17, iy + Math.sin(a) * 17);
    g.lineTo(ix + Math.cos(a + 2.45) * 14, iy + Math.sin(a + 2.45) * 14);
    g.lineTo(ix + Math.cos(a) * 3, iy + Math.sin(a) * 3);
    g.lineTo(ix + Math.cos(a - 2.45) * 14, iy + Math.sin(a - 2.45) * 14);
    g.closePath(); g.fill(); g.stroke();
    drawn = true;
  }
  g.globalAlpha = 1;
  return drawn;
}

// Skyhook (weapons wave 5): the enemy aircraft a lock-on launcher in hand is pointed at, the same pick the host makes
// (js/sim/arsenal-w5.js lockTarget), so the box on screen is the one the rocket will fly to. `air` is the view's
// aircraft (gunships and drones together). Returns {g, locked} or null.
export function lockCandidate(me, air, lock) {
  if (!me?.alive || !lock || !air?.length) return null;
  let best = null, bestA = lock.cone;
  for (const g of air) {
    if (g.team === me.team || g.kind === 'reticle' || g.kind === 'plates' || g.kind === 'juggernaut') continue;
    const dx = g.x - me.x, dz = g.z - me.z, d = Math.hypot(dx, dz);
    if (d > lock.range) continue;
    const a = d < 3 ? 0 : Math.abs(wrap(Math.atan2(dz, dx) - me.aim));
    if (a <= bestA) { best = g; bestA = a; }
  }
  return best ? { g: best, locked: (me.adsT ?? 0) >= 0.85 } : null;
}

// The lock box: four corner brackets round the aircraft, closing in as the sights come up, red and solid once locked.
export function drawLock(g, q, adsT, locked, t) {
  const r = 34 - 14 * Math.min(1, adsT), c = locked ? '#ff4d3d' : '#ffd659';
  g.strokeStyle = c; g.lineWidth = locked ? 3 : 2; g.globalAlpha = locked ? 1 : 0.6 + 0.4 * Math.sin(t * 14);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.beginPath();
    g.moveTo(q.x + sx * r, q.y + sy * (r - 9)); g.lineTo(q.x + sx * r, q.y + sy * r); g.lineTo(q.x + sx * (r - 9), q.y + sy * r);
    g.stroke();
  }
  if (locked) { g.font = 'bold 11px system-ui, sans-serif'; g.fillStyle = c; g.textAlign = 'center'; g.fillText('LOCK', q.x, q.y + r + 13); }
  g.globalAlpha = 1;
}
