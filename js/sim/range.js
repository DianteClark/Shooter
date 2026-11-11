// Firing range: mode rules, target dummies and the DPS/TTK numbers the HUD shows. Solo only, host side. In training
// (sim.training) every bot is a target too, so the same readout works on any map.
// Dummies are ordinary players on team 1 so hits, kills, hitmarkers and the renderer need no special case;
// they carry `dummy: true` on the view, have no brain and stand back up a second after dying.
import { MAX_HP, SIM_HZ } from '../shared/constants.js';
import { normalizeLoadout } from '../shared/catalog.js';
import { damageAt, shotsToKill } from '../shared/weapons.js';
import { weaponDef } from './player.js';

const STEP = 1 / SIM_HZ;
const DPS_WINDOW = 3;            // Seconds of damage the live DPS is averaged over.
const MIN_WINDOW = 0.25;         // Never divides a first hit by almost nothing.
const DUMMY_RESPAWN = 1;

export const RANGE_MODE = { id: 'range', name: 'Firing Range', short: 'Range', scoreLimit: 9999, timeLimit: 5999, desc: 'Free fire at marked distances.' };

// One roster entry per dummy on this map, appended after the human.
export function rangeDummies(map) {
  return (map.dummies || []).map((home, i) => ({
    id: `dummy${i}`, name: `${home.d} m`, team: 1, isBot: true, skill: null, dummy: true, home,
    primary: 'ar', camo: 'none', loadout: normalizeLoadout({ primary: 'ar', secondary: 'pistol' }),
  }));
}

export class RangeDirector {
  constructor(sim) {
    this.sim = sim;
    this.isTarget = sim.training ? p => p.dummy || p.isBot : p => p.dummy;
    this.resetStats();
  }

  resetStats() {
    this.samples = [];               // {t, dmg} inside the DPS window.
    this.dps = 0;
    this.peakDps = 0;
    this.lastTtk = null;
    this.bestTtk = null;
    this.shots = 0;
    this.hits = 0;
    this.heads = 0;
    this.kills = 0;
    this.lastDmg = 0;
    this.lastDist = 0;
    this.lastHead = false;
    this.lastKill = false;
    this.lastWeapon = null;
    this.hitAt = new Map();          // dummy -> time of the first hit since it was last at full health.
  }

  step() {
    for (const p of this.sim.players) {
      if (!p.dummy || !p.alive || !p.home.move) continue;
      const m = p.home.move, ps = p.ps;
      p.dir = p.dir || 1;
      ps.z += p.dir * m.speed * STEP;
      if (ps.z >= m.z1) { ps.z = m.z1; p.dir = -1; }
      else if (ps.z <= m.z0) { ps.z = m.z0; p.dir = 1; }
      ps.vz = p.dir * m.speed;
      ps.vx = 0;
    }
    this._refreshDps();
  }

  _refreshDps() {
    const now = this.sim.time, s = this.samples;
    while (s.length && now - s[0].t > DPS_WINDOW) s.shift();
    if (!s.length) { this.dps = 0; return; }
    let sum = 0;
    for (let i = 0; i < s.length; i++) sum += s[i].dmg;
    this.dps = sum / Math.max(MIN_WINDOW, Math.min(DPS_WINDOW, now - s[0].t + STEP));
    if (this.dps > this.peakDps) this.peakDps = this.dps;
  }

  onShot(shooter, shot, rays) {
    if (this.isTarget(shooter)) return;
    this.shots++;
    this.lastWeapon = shot.weapon;
    for (let i = 0; i < rays.length; i++) {
      if (rays[i].hit !== 'player') continue;
      this.hits++;
      break;
    }
  }

  // Called before the damage lands, with the dummy's health still intact. `dmg` is already capped at the health the
  // dummy had left (Sim._damage), so a lethal headshot reads as the kill it is, not as a x9 multiplier on paper.
  onDamage(target, attacker, dmg, dist, head, indirect) {
    if (!this.isTarget(target) || this.isTarget(attacker)) return;
    if (!this.hitAt.has(target) || target.hp >= MAX_HP - 1e-6) this.hitAt.set(target, this.sim.time);
    if (indirect) return;              // Grenades and streaks hurt the dummy, but say nothing about the gun.
    this.samples.push({ t: this.sim.time, dmg });
    if (head) this.heads++;
    this.lastDmg = Math.round(dmg);
    this.lastDist = dist;
    this.lastHead = !!head;
    this.lastKill = dmg >= target.hp - 1e-6;
    this._refreshDps();
  }

  onKill(target) {
    if (!this.isTarget(target)) return;
    if (target.dummy) target.respawnT = DUMMY_RESPAWN;
    this.kills++;
    const from = this.hitAt.get(target);
    this.hitAt.delete(target);
    if (from === undefined) return;
    this.lastTtk = this.sim.time - from;
    if (this.bestTtk === null || this.lastTtk < this.bestTtk) this.bestTtk = this.lastTtk;
  }

  // Everything the HUD needs, updated live. TTK is first hit to death; `model` is what the gun can do on paper
  // at the last hit's distance (full damage to the body, every round landing), so a readout can compare the two.
  view() {
    const human = this.sim.players.find(p => !p.dummy && !p.isBot);
    let model = null;
    if (human) {
      const w = weaponDef(human.ps), dist = this.lastDist || 10;
      const interval = w.burst ? burstInterval(w) : 60 / w.rpm;
      const n = shotsToKill(w, dist, MAX_HP, true, false);
      model = {
        weapon: human.ps.weapon, dist: Math.round(dist * 10) / 10,
        dps: damageAt(w, dist, true) * (w.pellets || 1) * w.rpm / 60,
        ttk: (n - 1) * interval,
        shots: n,
        // Any head hit kills outright (explosives excepted), so the head is a one-shot, not a multiplier.
        headShots: w.explosive ? n : 1,
      };
    }
    return {
      dps: this.dps, peakDps: this.peakDps, lastTtk: this.lastTtk, bestTtk: this.bestTtk,
      shots: this.shots, hits: this.hits, accuracy: this.shots ? this.hits / this.shots : 0,
      headshots: this.heads, kills: this.kills,
      lastDamage: this.lastDmg, lastDist: this.lastDist, lastHead: this.lastHead, lastWeapon: this.lastWeapon,
      lastKill: this.lastKill,
      model,
    };
  }
}

// A burst gun's rated rpm is its true cadence including the pause, which is what a TTK needs.
function burstInterval(w) {
  return 60 / w.rpm;
}
