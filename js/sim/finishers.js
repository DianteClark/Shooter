// Finishing moves and emotes in the sim (docs/FINISHERS.md). Host only, deterministic: the host decides, pins both
// players, and the snapshot's finisher block (encodeFins/decodeFins) tells every guest who is locked with whom and how
// far in. Hooks in sim.js: startFinisher/emote commands (applyCommand), stepFins every tick, cancelFin when the attacker
// takes damage or either player dies, and the bots' own use (botFinishers).
//
// A finisher {a, v, k, t, dur, ax, az, aaim, vx, vz, vaim}: the attacker and target sim players, the FINISHERS index, the
// seconds played and its length, and the pinned positions. Both players carry it as p.fin while it runs.
import { EMOTES, FIN, FINISHERS, FINISHER_IDS, finishable, finisherIndex, getFinisher } from '../shared/finishers.js';
import { hasLineOfSight } from '../shared/geometry.js';
import { SIM_HZ } from '../shared/constants.js';

const STEP = 1 / SIM_HZ;
export const FIN_SLACK = FIN.slack;
const round2 = v => Math.round(v * 100) / 100;
const BOT_LOOK_TICKS = 6;            // Bots look for a finisher this often (staggered by index).
const BOT_CHANCE = { downed: 0.45, behind: 0.55, stalk: 0.5, stalkDowned: 0.4 };
const STALK_RANGE = 10;              // Metres: how far a bot will creep for a finisher.
const STALK_SECS = 4;
const BOT_RETRY = 3;                 // Seconds a bot that passed on one waits before rolling again.
const BOT_TAUNT = 0.3;               // Chance a bot emotes after a finisher of its own.

// A sim player as finishable() reads it. One scratch pair: nothing here is re-entrant.
const RA = {}, RV = {};
function rec(p, out) {
  out.x = p.ps.x; out.z = p.ps.z; out.aim = p.ps.aim; out.team = p.team;
  out.alive = p.alive && !p.away; out.downed = !!p.downed; out.air = !!p.brAir; out.fin = !!p.fin;
  out.spawnProtect = p.spawnProtect > 0; out.zk = 0;
  return out;
}

// Whether the mode and moment allow finishers at all. Graveyard Shift's horde is not a player to finish.
export function finishersOn(sim) {
  if (sim.phase !== 'live' || sim.mode === 'zm') return false;
  if (sim.snd && !sim.snd.combat) return false;      // Between Search and Destroy rounds nothing hurts.
  return true;
}

export function canFinish(sim, a, v, slack = 0) {
  if (!a || !v || !finishersOn(sim)) return false;
  if (!a.alive || a.away || a.downed || a.brAir || a.fin) return false;
  if (!finishable(rec(a, RA), rec(v, RV), slack)) return false;
  return hasLineOfSight(sim.map, a.ps.x, a.ps.z, v.ps.x, v.ps.z);
}

// The nearest enemy `a` could finish now, or null.
export function finisherTarget(sim, a, slack = 0) {
  let best = null, bd = Infinity;
  for (let i = 0; i < sim.players.length; i++) {
    const v = sim.players[i];
    if (v === a || v.team === a.team || !v.alive) continue;
    const d = Math.hypot(v.ps.x - a.ps.x, v.ps.z - a.ps.z);
    if (d < bd && canFinish(sim, a, v, slack)) { bd = d; best = v; }
  }
  return best;
}

// The 'finish' command and the bots: starts a finisher on `targetId` (or the nearest one in reach). True if it started.
export function startFinisher(sim, a, targetId = null, slack = 0) {
  // The phone names the one it saw; if that one no longer qualifies, the nearest that does.
  let v = targetId != null ? sim.byId.get(targetId) : null;
  if (!v || !canFinish(sim, a, v, slack)) v = finisherTarget(sim, a, slack);
  if (!v) return false;
  const def = getFinisher(a.finisher);
  const dx = a.ps.x - v.ps.x, dz = a.ps.z - v.ps.z, d = Math.hypot(dx, dz) || 1;
  // The attacker steps in to arm's length on the line they came from (clear: they could see the target along it).
  const ax = v.ps.x + dx / d * FIN.stand, az = v.ps.z + dz / d * FIN.stand;
  const f = { a, v, k: finisherIndex(def.id), t: 0, dur: def.dur, ax, az, aaim: Math.atan2(-dz, -dx), vx: v.ps.x, vz: v.ps.z, vaim: v.ps.aim };
  sim.fins.push(f);
  a.fin = f; v.fin = f;
  a.spawnProtect = 0;
  for (const p of [a, v]) { p.ps.sprinting = false; p.ps.sliding = false; p.ps.vx = 0; p.ps.vz = 0; }
  pin(f);
  sim._emit({ t: 'fin', by: a.id, target: v.id, k: f.k, x: round2(v.ps.x), z: round2(v.ps.z), down: v.downed ? 1 : 0 });
  return true;
}

// Holds both players where the finisher put them (a phone's late states and the bots' brains are overruled).
export function pin(f) {
  const a = f.a.ps, v = f.v.ps;
  a.x = f.ax; a.z = f.az; a.aim = f.aaim; a.vx = 0; a.vz = 0;
  v.x = f.vx; v.z = f.vz; v.aim = f.vaim; v.vx = 0; v.vz = 0;
}

function release(sim, f) {
  if (f.a.fin === f) f.a.fin = null;
  if (f.v.fin === f) f.v.fin = null;
  const i = sim.fins.indexOf(f);
  if (i >= 0) sim.fins.splice(i, 1);
}

// Ends a finisher without the kill: the attacker was hit ('hit'), or someone died or left ('broken').
export function cancelFin(sim, f, why = 'hit') {
  if (!f || sim.fins.indexOf(f) < 0) return;
  release(sim, f);
  sim._emit({ t: 'finx', by: f.a.id, target: f.v.id, why });
}

export function stepFins(sim) {
  for (let i = sim.fins.length - 1; i >= 0; i--) {
    const f = sim.fins[i];
    if (!f) continue;
    const { a, v } = f;
    if (!a.alive || !v.alive || a.away || v.away || a.downed || sim.phase !== 'live') { cancelFin(sim, f, 'broken'); continue; }
    f.t += STEP;
    pin(f);
    if (f.t + 1e-6 < f.dur) continue;
    // Done: the lock lets go first, so the kill below sees two free players.
    release(sim, f);
    const dist = Math.hypot(a.ps.x - v.ps.x, a.ps.z - v.ps.z);
    sim._emit({ t: 'hit', by: a.id, target: v.id, dmg: Math.max(1, Math.ceil(v.hp)), x: round2(v.ps.x), z: round2(v.ps.z), killed: true, fin: 1 });
    sim._finKill = FINISHER_IDS[f.k];
    sim._kill(v, a, a.ps.weapon, dist, null, false, null);
    sim._finKill = null;
    if (a.bot && sim.finRng() < BOT_TAUNT) {
      const pick = BOT_TAUNTS[Math.floor(sim.finRng() * BOT_TAUNTS.length)];
      emote(sim, a, EMOTES.findIndex(e => e.id === pick));
    }
  }
}

const BOT_TAUNTS = ['taunt', 'laugh', 'salute', 'thumbs'];

// Bots: now and then a bot with an enemy in finishing reach takes the finisher instead of shooting, and one that sees
// an enemy's back (or a downed enemy) close by may creep up for one (p.finStalk, which BotBrain.update follows through
// stalkInput). One look every BOT_LOOK_TICKS ticks per bot, staggered; a pass on one waits BOT_RETRY seconds.
export function botFinishers(sim) {
  if (!finishersOn(sim)) return;
  for (let i = 0; i < sim.players.length; i++) {
    const p = sim.players[i];
    if (!p.bot || p.dummy || (sim.tick + i) % BOT_LOOK_TICKS) continue;
    if (!p.alive || p.fin || p.downed || p.brAir) { p.finStalk = null; continue; }
    const st = p.finStalk;
    if (st) {
      const v = sim.byId.get(st.id);
      if (v && canFinish(sim, p, v)) { p.finStalk = null; startFinisher(sim, p, v.id); continue; }
      if (!v || !stalkable(sim, p, v) || sim.time > st.until) { p.finStalk = null; p.finCool = sim.time + BOT_RETRY; }
      continue;
    }
    if ((p.finCool ?? 0) > sim.time) continue;
    const v = finisherTarget(sim, p);
    if (v) {
      if (sim.finRng() < (v.downed ? BOT_CHANCE.downed : BOT_CHANCE.behind)) startFinisher(sim, p, v.id);
      else p.finCool = sim.time + BOT_RETRY;
      continue;
    }
    const prey = stalkTarget(sim, p);
    if (!prey) continue;
    if (sim.finRng() < (prey.downed ? BOT_CHANCE.stalkDowned : BOT_CHANCE.stalk)) p.finStalk = { id: prey.id, until: sim.time + STALK_SECS };
    else p.finCool = sim.time + BOT_RETRY;
  }
}

// An enemy worth creeping up on: in sight, within STALK_RANGE, down or with their back turned.
function stalkable(sim, p, v) {
  if (!v.alive || v.fin || v.team === p.team || v.spawnProtect > 0 || v.brAir || v.away) return false;
  const dx = p.ps.x - v.ps.x, dz = p.ps.z - v.ps.z, d = Math.hypot(dx, dz);
  if (d > STALK_RANGE || d < 1e-3) return false;
  if (!v.downed && (Math.cos(v.ps.aim) * dx + Math.sin(v.ps.aim) * dz) / d >= FIN.behindCos) return false;
  return hasLineOfSight(sim.map, p.ps.x, p.ps.z, v.ps.x, v.ps.z);
}
function stalkTarget(sim, p) {
  let best = null, bd = Infinity;
  for (let i = 0; i < sim.players.length; i++) {
    const v = sim.players[i];
    if (v === p || v.team === p.team) continue;
    const d = Math.hypot(v.ps.x - p.ps.x, v.ps.z - p.ps.z);
    if (d < bd && stalkable(sim, p, v)) { bd = d; best = v; }
  }
  return best;
}

// BotBrain.update's input while stalking: straight for the target's back (or the downed body), gun down, no sprint.
export function stalkInput(sim, p, I) {
  const v = sim.byId.get(p.finStalk.id);
  if (!v || !v.alive) { p.finStalk = null; return; }
  const back = v.downed ? 0.9 : 1.1;
  const tx = v.ps.x - Math.cos(v.ps.aim) * back * (v.downed ? 0 : 1) + (v.downed ? (p.ps.x - v.ps.x) * 0.3 : 0);
  const tz = v.ps.z - Math.sin(v.ps.aim) * back * (v.downed ? 0 : 1) + (v.downed ? (p.ps.z - v.ps.z) * 0.3 : 0);
  const dx = tx - p.ps.x, dz = tz - p.ps.z, d = Math.hypot(dx, dz);
  const k = d > 0.25 ? 1 / d : 0;
  I.mx = dx * k; I.mz = dz * k;
  I.aim = Math.atan2(v.ps.z - p.ps.z, v.ps.x - p.ps.x);
  I.fire = false; I.aiming = false; I.sprint = false; I.slide = false;
}

// The 'emote' command: { e: index into EMOTES }. Cosmetic; rate limited per player. True if it went out.
export function emote(sim, p, e) {
  if (!p || !p.alive || p.away || p.fin || p.downed || !EMOTES[e] || sim.phase === 'ended') return false;
  if ((p.emoteAt ?? -99) + 1 > sim.time) return false;
  p.emoteAt = sim.time;
  sim._emit({ t: 'emote', id: p.id, e });
  return true;
}

// Snapshot block: [attacker index, target index, finisher index, centiseconds in, ...], or 0 when none run.
export function encodeFins(sim) {
  if (!sim.fins.length) return 0;
  const out = [];
  for (const f of sim.fins) out.push(f.a.index, f.v.index, f.k, Math.round(f.t * 100));
  return out;
}

// Into each decoded player: fin = { k (finisher id), role 'a'|'v', other (id), t, dur } or null.
export function decodeFins(block, sim, players) {
  for (let i = 0; i < players.length; i++) players[i].fin = null;
  if (!Array.isArray(block)) return;
  for (let i = 0; i + 3 < block.length; i += 4) {
    const a = players[block[i]], v = players[block[i + 1]], def = FINISHERS[block[i + 2]];
    if (!a || !v || !def) continue;
    const t = block[i + 3] / 100;
    a.fin = { k: def.id, role: 'a', other: v.id, t, dur: def.dur };
    v.fin = { k: def.id, role: 'v', other: a.id, t, dur: def.dur };
  }
}
