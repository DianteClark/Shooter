// Buffers authoritative GameViews and produces a smoothed view for rendering.
// Remote players are shown slightly in the past so there are always two snapshots to blend between.

import { INTERP_DELAY } from '../shared/constants.js';

const BUFFER_MAX = 12;
const TELEPORT_DIST = 6;

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Interpolator {
  constructor(delay = INTERP_DELAY) {
    this.delay = delay;
    this.buffer = [];        // [{at, view}], oldest first.
    this.output = null;
    this.byId = new Map();   // id -> reusable output player object.
    this.newestById = new Map();
  }

  push(view, at) {
    this.buffer.push({ at, view });
    if (this.buffer.length > BUFFER_MAX) this.buffer.shift();
  }

  get newest() {
    return this.buffer.length ? this.buffer[this.buffer.length - 1].view : null;
  }

  // Returns a view blended for time `now`, or null until the first snapshot arrives.
  sample(now) {
    const buf = this.buffer;
    if (!buf.length) return null;
    const target = now - this.delay;

    let older = buf[0], newer = buf[0];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].at <= target) {
        older = buf[i];
        newer = buf[Math.min(i + 1, buf.length - 1)];
        break;
      }
    }
    const span = newer.at - older.at;
    const t = span > 1e-4 ? Math.min(1, Math.max(0, (target - older.at) / span)) : 1;
    return this.#blend(older.view, newer.view, t);
  }

  #blend(a, b, t) {
    const out = this.output || (this.output = { players: [] });
    out.t = b.t;
    out.phase = b.phase;
    out.timeLeft = b.timeLeft;
    out.scores = b.scores;
    out.winner = b.winner;
    out.uav = b.uav;
    out.localId = b.localId;
    out.lastKill = b.lastKill;
    out.projectiles = b.projectiles;
    out.smokes = b.smokes;
    out.turrets = b.turrets;
    out.gunships = b.gunships;
    out.mode = b.mode;
    out.tags = b.tags;
    out.points = b.points;
    out.scoreLimit = b.scoreLimit;
    out.hardT = b.hardT;

    const fromById = this.newestById;
    fromById.clear();
    for (const p of a.players) fromById.set(p.id, p);

    out.players.length = b.players.length;
    for (let i = 0; i < b.players.length; i++) {
      const to = b.players[i];
      let p = this.byId.get(to.id);
      if (!p) { p = {}; this.byId.set(to.id, p); }
      Object.assign(p, to);
      const from = fromById.get(to.id);
      if (from && from.alive === to.alive) {
        const dx = to.x - from.x, dz = to.z - from.z;
        if (dx * dx + dz * dz < TELEPORT_DIST * TELEPORT_DIST) {
          p.x = from.x + dx * t;
          p.z = from.z + dz * t;
          p.aim = lerpAngle(from.aim, to.aim, t);
        }
      }
      out.players[i] = p;
    }
    return out;
  }
}
