// Weapons wave 5's effects on the match (js/shared/weapons-w5.js, js/sim/arsenal-w5.js): a Fusee's target burning,
// and a Skyhook rocket climbing to the aircraft it locked on to. Built from the shared particle pools in vfx.js, so it
// adds no draw call and nothing at all while no one is burning or locking.
const FLAME = [1.0, 0.55, 0.15], CORE = [1.0, 0.85, 0.45], FLARE = [1.0, 0.35, 0.25];
const LOCK_Y = 5.6;               // Where the rocket meets the aircraft: about a chopper's height (streaks-v9.js AIR_Y).
const ROCKET_SPEED = 92;          // vfx.js ROCKET_SPEED: the burst waits for the rocket.
const EMBER_EVERY = 0.045;        // Seconds between flame particles on a burning player.

export class W5Fx {
  constructor(vfx) {
    this.vfx = vfx;
    this.burning = new Map();     // player id -> { left, clock }
    this.booms = [];              // { x, y, z, t }
  }

  onEvent(ev) {
    if (ev.t === 'ignite') this.burning.set(ev.id, { left: ev.dur, clock: 0 });
    else if (ev.t === 'kill' || ev.t === 'spawn') this.burning.delete(ev.t === 'kill' ? ev.target : ev.id);
  }

  // A locked Skyhook rocket: drawn from the muzzle up to the aircraft, which bursts where it meets it.
  lockShot(mx, my, mz, lk) {
    const x = lk[0], z = lk[1];
    this.vfx.rocket(mx, my, mz, x, LOCK_Y, z);
    this.booms.push({ x, y: LOCK_Y, z, t: Math.hypot(x - mx, LOCK_Y - my, z - mz) / ROCKET_SPEED });
  }

  update(dt, chars, localTeam) {
    const vfx = this.vfx;
    for (const [id, b] of this.burning) {
      b.left -= dt;
      if (b.left <= 0) { this.burning.delete(id); continue; }
      const r = chars.rigs.get(id);
      if (!r || !(r.visible || r.team === localTeam)) continue;
      b.clock -= dt;
      while (b.clock <= 0) {
        b.clock += EMBER_EVERY;
        const a = Math.random() * 6.283, s = 0.18 + Math.random() * 0.2;
        vfx.ember(r.x + Math.cos(a) * s, 0.5 + Math.random() * 1.1, r.z + Math.sin(a) * s, Math.random() < 0.3 ? CORE : FLAME);
      }
      if (Math.random() < dt * 6) vfx.pop(r.x, 1.1, r.z, 2.2, FLARE, 0.12);     // The flare's red light flickering on them.
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const m = this.booms[i];
      m.t -= dt;
      if (m.t > 0) continue;
      this.booms.splice(i, 1);
      vfx.fireball(m.x, m.y, m.z, 1.5, 0.32);
      vfx.sparks(m.x, m.y, m.z, 0, 0, CORE, 10, 9);
      vfx.pop(m.x, m.y, m.z, 5, CORE, 0.16);
    }
  }

  dispose() { this.burning.clear(); this.booms.length = 0; }
}
