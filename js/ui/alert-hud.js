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
    const r = Math.min(W, H) * 0.32, pulse = 0.55 + 0.45 * Math.sin(t * 9);
    const grad = g.createRadialGradient(ex, ey, 0, ex, ey, r);
    grad.addColorStop(0, css);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.5 * pulse;
    g.fillStyle = grad;
    g.beginPath(); g.arc(ex, ey, r, 0, Math.PI * 2); g.fill();
    // A bright chevron on the edge pointing at them.
    const a = Math.atan2(dy, dx), ix = ex - Math.cos(a) * 18, iy = ey - Math.sin(a) * 18;
    g.globalAlpha = 0.95 * pulse;
    g.fillStyle = '#fff2ec';
    g.beginPath();
    g.moveTo(ix + Math.cos(a) * 11, iy + Math.sin(a) * 11);
    g.lineTo(ix + Math.cos(a + 2.4) * 9, iy + Math.sin(a + 2.4) * 9);
    g.lineTo(ix + Math.cos(a - 2.4) * 9, iy + Math.sin(a - 2.4) * 9);
    g.closePath(); g.fill();
    drawn = true;
  }
  g.globalAlpha = 1;
  return drawn;
}
