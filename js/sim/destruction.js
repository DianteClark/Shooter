// Destruction on the host (docs/DESTRUCTION.md "Sim"): health per breakable piece, blasts and heavy rounds that wear
// it down, and what a piece breaking changes (its wall, the nav grid, bots' routes). Guests never run this: they read
// the stages from snapshots (js/shared/destruction.js setBreakState).
import { WEAPON_CATEGORY } from '../shared/constants.js';
import { MAT, MATERIALS, DAMAGED_AT, applyStage, encodeBreak, decodeBreak, prepareBreakables, resetBreakables } from '../shared/destruction.js';
import { hasLineOfSight, wallsInBox, wallsOnRay, wallScratch } from '../shared/geometry.js';
import { NEAR_COVER } from './player.js';
import { reblockNav } from '../shared/zombies.js';

// Modes whose design a breaking map would spoil: Graveyard Shift keeps its own barricades, the campaign its scripted
// set pieces, the range and training their fixed lanes, Showdown its tiny symmetric rounds.
const OFF_RULES = new Set(['zm', 'cp', 'range', 'gf']);

// Structural power of each blast source (see docs/DESTRUCTION.md "Materials"). Equipment by kind, guns by weapon,
// streaks by the `k` their explosion event carries. Anything else: by radius.
const POWER_BANG = { frag: 460, sticky: 480, mine: 420, cluster: 200, bomblet: 160, impact: 400, claymore: 380, drill: 600, charge: 900, tripwire: 320 };
const POWER_GUN = { launcher: 640, thumper: 280 };
const POWER_STREAK = { strike: 1000, mortar: 600, missile: 1200, swarm: 450, artillery: 800, bomb: 3000 };
// Blasts that only scratch heavy walls (MAT.heavy.light): hand-thrown and grenade-launcher class.
const LIGHT_BLAST = new Set(['frag', 'sticky', 'mine', 'cluster', 'bomblet', 'impact', 'claymore', 'tripwire', 'thumper']);
// Structural damage per round, as a share of the round's own damage, by gun category. Glass takes any round whole.
const CHIP = { LMG: 0.55, Marksman: 0.8, Sniper: 1.3, Shotgun: 0.45 };
const REPLAN_NEAR = 32;           // Bots this close to a broken piece, or heading this close to it, replan.
const SECTOR_EVERY = 2;           // Seconds between big-map sector rebuilds.
const SEND_FOR = 30;              // Ticks the break string rides every snapshot after a change.
const SEND_EVERY = 15;            // Otherwise every this many ticks.

const OWN_COVER = NEAR_COVER;     // Cover this close to the shooter is fired over (player.js ownCover).
const r2 = v => Math.round(v * 100) / 100;
const rectDist = (w, x, z) => Math.hypot(Math.max(w.x - x, 0, x - w.x - w.w), Math.max(w.z - z, 0, z - w.z - w.d));
// Entry distance of a normalised ray into a rect (0 when it starts inside), or -1 for a miss.
function slab(ox, oz, dx, dz, r) {
  let t0 = 0, t1 = Infinity;
  if (Math.abs(dx) < 1e-9) { if (ox < r.x || ox > r.x + r.w) return -1; }
  else { let a = (r.x - ox) / dx, b = (r.x + r.w - ox) / dx; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
  if (Math.abs(dz) < 1e-9) { if (oz < r.z || oz > r.z + r.d) return -1; }
  else { let a = (r.z - oz) / dz, b = (r.z + r.d - oz) / dz; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
  return t0 <= t1 ? t0 : -1;
}

export class Destruction {
  constructor(sim) {
    this.sim = sim;
    const map = sim.map;
    this.list = prepareBreakables(map);
    resetBreakables(map);         // An earlier match on this shared map object may have left pieces down.
    const rules = sim.mode;
    this.on = this.list.length > 0 && !OFF_RULES.has(rules) && !sim.training;
    this.n = this.list.length;
    this.hp = new Float32Array(this.n);
    this.stage = new Uint8Array(this.n);
    // Pieces this mode keeps standing: Search and Destroy's bomb sites.
    this.locked = new Uint8Array(this.n);
    if (rules === 'snd') for (const p of this.list) if (p.snd) this.locked[p.id] = 1;
    for (const p of this.list) this.hp[p.id] = p.hp;
    this.text = '';
    this.dirty = false;
    this.any = false;             // Anything ever changed this match: from then on the string goes out (it may be '').
    this.changedTick = -999;
    this.sectorT = 0;
    this.sectorDirty = false;
    this.breaks = 0;
    this._near = null;
  }

  // Every piece back up (a new Search and Destroy or Control round).
  restoreAll() {
    if (!this.on || !this.any) return;
    let changed = false;
    for (let i = 0; i < this.n; i++) {
      this.hp[i] = this.list[i].hp;
      if (this.stage[i] === 2) changed = true;
      this.stage[i] = 0;
      if (applyStage(this.sim.map, i, 0)) this._reblock(this.list[i]);
      else this.list[i].wall._brk = 0;
    }
    if (changed) this._replan(null);
    this._touch();
  }

  _touch() { this.dirty = true; this.any = true; this.changedTick = this.sim.tick; }

  // The break string, recomputed only after a change.
  encode() {
    if (this.dirty) { this.text = encodeBreak(this.stage); this.dirty = false; }
    return this.text;
  }

  // Whether this tick's snapshot carries the string: every one for a second after a change and in a match's first
  // ticks, then every SEND_EVERY-th, so a guest that joins late has it within half a second.
  sendNow(tick, metaUntil) {
    if (!this.any) return false;
    return tick <= metaUntil || tick - this.changedTick < SEND_FOR || tick % SEND_EVERY === 0;
  }

  // Host migration: the stages a snapshot had; health back to the top of each stage's band.
  restore(text) {
    if (!this.on || !text) return;
    const st = decodeBreak(text, this.n);
    if (!st) return;
    for (let i = 0; i < this.n; i++) {
      if (!st[i]) continue;
      this.stage[i] = st[i];
      this.hp[i] = st[i] >= 2 ? 0 : this.list[i].hp * DAMAGED_AT;
      if (applyStage(this.sim.map, i, st[i])) this._reblock(this.list[i]);
    }
    this._touch();
  }

  // A blast: every unlocked piece within reach, seen from the blast, takes the source's power with falloff.
  // `e` is the explosion or bang event as emitted.
  blast(e, radius, source, kind) {
    if (!this.on) return;
    const sim = this.sim, map = sim.map;
    const power = (kind === 'bang' ? POWER_BANG[source] : kind === 'gun' ? POWER_GUN[source] : POWER_STREAK[source]) ?? Math.round(radius * 120);
    const reach = radius * 0.8 + 0.5, x = e.x, z = e.z;
    const near = this._near = wallScratch(map, this._near);
    const n = wallsInBox(map, x - reach, z - reach, x + reach, z + reach, near);
    for (let k = 0; k < n; k++) {
      const w = map.walls[near[k]];
      const id = w.brk;
      if (id === undefined || this.stage[id] === 2 || this.locked[id]) continue;
      const p = this.list[id];
      // Nearest point of the piece's own (intact) rect, and the distance to it.
      const cx = Math.max(p.x, Math.min(x, p.x + p.w)), cz = Math.max(p.z, Math.min(z, p.z + p.d));
      const d = Math.hypot(cx - x, cz - z);
      if (d > reach) continue;
      // A wall standing between the blast and the piece shields it. The test ends a hair short of the piece's face.
      if (d > 0.3) {
        const k2 = (d - 0.12) / d;
        if (!hasLineOfSight(map, x, z, x + (cx - x) * k2, z + (cz - z) * k2)) continue;
      }
      let dmg = power * (1 - 0.6 * d / reach);
      if (p.mat === 'heavy' && LIGHT_BLAST.has(source)) dmg *= MAT.heavy.light;
      const dx = (p.x + p.w / 2) - x, dz = (p.z + p.d / 2) - z, dl = Math.hypot(dx, dz) || 1;
      this._hit(id, dmg, dx / dl, dz / dl, e.by ?? null);
    }
  }

  // Gunfire: every breakable piece a round's ray crossed (a penetrating round goes through cover) or ended on takes a
  // chip if the round is heavy enough; glass takes anything. Cover at the shooter's own feet is fired over, not hit.
  bullet(shot, rays, w) {
    if (!this.on) return;
    const map = this.sim.map, cat = WEAPON_CATEGORY[shot.weapon], chip = CHIP[cat] ?? 0;
    const near = this._near = wallScratch(map, this._near);
    const ox = shot.ox, oz = shot.oz;
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      const len = Math.hypot(r.x - ox, r.z - oz);
      if (len < 1e-3) continue;
      const dx = (r.x - ox) / len, dz = (r.z - oz) / len, reach = len + 0.06;
      const n = wallsOnRay(map, ox, oz, dx, dz, reach, near);
      for (let k = 0; k < n; k++) {
        const q = map.walls[near[k]];
        const id = q.brk;
        if (id === undefined || this.stage[id] === 2 || this.locked[id]) continue;
        const t = slab(ox, oz, dx, dz, q);
        if (t < 0 || t > reach) continue;
        const p = this.list[id];
        // Own cover: the shooter is crouched at it and fires across its top.
        if (!q.blocksBullet && rectDist(q, ox, oz) < OWN_COVER) continue;
        const dmg = p.mat === 'glass' ? Math.max(w.damage ?? 20, p.hp) : MAT[p.mat].bullet ? (w.damage ?? 0) * chip : 0;
        if (dmg > 0) this._hit(id, dmg, dx, dz, null);
      }
    }
  }

  _hit(id, dmg, dx, dz, by) {
    const p = this.list[id];
    this.hp[id] -= dmg;
    const s = this.hp[id] <= 0 ? 2 : this.hp[id] < p.hp * DAMAGED_AT ? 1 : 0;
    if (s <= this.stage[id]) return;
    this.stage[id] = s;
    this._touch();
    const sim = this.sim;
    if (s === 2) {
      this.breaks++;
      if (applyStage(sim.map, id, 2)) this._reblock(p);
      this._replan(p);
    }
    sim._emit({ t: 'brk', i: id, s, x: r2(p.x + p.w / 2), z: r2(p.z + p.d / 2), m: MATERIALS.indexOf(p.mat), dx: r2(dx), dz: r2(dz), by });
  }

  // Re-marks the nav cells round a piece's old rect; a big map's sector graph is rebuilt at most every SECTOR_EVERY.
  _reblock(p) {
    const nav = this.sim.nav;
    if (!nav) return;
    reblockNav(nav, this.sim.map, p);
    if (nav.regionOf) this.sectorDirty = true;
  }

  // Bots near the opening, or bound for somewhere near it, look for a better way (the path budget spreads the work).
  _replan(p) {
    const sim = this.sim;
    for (let i = 0; i < sim.players.length; i++) {
      const b = sim.players[i].bot;
      if (!b || !sim.players[i].alive) continue;
      if (p) {
        const cx = p.x + p.w / 2, cz = p.z + p.d / 2, ps = sim.players[i].ps;
        if (Math.hypot(ps.x - cx, ps.z - cz) > REPLAN_NEAR && Math.hypot(b.goalX - cx, b.goalZ - cz) > REPLAN_NEAR) continue;
      }
      if (b.pathLen > 0 && !b.arrived) b.pathDirty = true;
    }
  }

  // Per tick, host only.
  step(dt) {
    if (!this.sectorDirty) return;
    this.sectorT -= dt;
    if (this.sectorT > 0) return;
    this.sectorT = SECTOR_EVERY;
    this.sectorDirty = false;
    this.sim.nav?._buildSectors();
  }

  // The intact breakable piece (light wall or shed class) nearest a segment, within `pad` of it, or null: what a bot
  // walking from a to b could blow a way through. Returns the piece.
  blockerOn(ax, az, bx, bz, pad = 0.6) {
    if (!this.on) return null;
    const map = this.sim.map, near = this._near = wallScratch(map, this._near);
    const n = wallsInBox(map, Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad, near);
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    let best = null, bestT = Infinity;
    for (let k = 0; k < n; k++) {
      const w = map.walls[near[k]];
      const id = w.brk;
      if (id === undefined || this.stage[id] === 2 || this.locked[id] || !w.blocksVision) continue;
      const p = this.list[id];
      if (p.mat !== 'light' && p.mat !== 'wood') continue;
      // Closest approach of the segment to the rect's centre, against its half-size plus the pad.
      const cx = p.x + p.w / 2, cz = p.z + p.d / 2;
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (len * len)));
      const qx = ax + dx * t, qz = az + dz * t;
      if (Math.abs(qx - cx) > p.w / 2 + pad || Math.abs(qz - cz) > p.d / 2 + pad) continue;
      if (t < bestT) { bestT = t; best = p; }
    }
    return best;
  }

  stats() { return { pieces: this.n, broken: this.stage.reduce((a, s) => a + (s === 2 ? 1 : 0), 0), damaged: this.stage.reduce((a, s) => a + (s === 1 ? 1 : 0), 0), breaks: this.breaks }; }
}
