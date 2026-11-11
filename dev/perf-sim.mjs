// Engine performance (docs/BR-PERF.md, "After"): host sim cost per 30 Hz tick with 32 bots, snapshot bytes, and a
// determinism fingerprint, so the same script run on an older checkout shows both the speed-up and that nothing about
// play changed.
//   node dev/perf-sim.mjs                         Harvest, Downtown (16 v 16 Ground War TDM) and the giant test map
//   node dev/perf-sim.mjs harvest giant2          only these (giant = density 1 spread, giant2 = density 2,
//                                                 giantd = density 1 with all 32 in the middle 120 m)
//   node dev/perf-sim.mjs --seconds=30 --hash     --hash also prints a fingerprint of every player's position, aim and
//                                                 hp on every tick and of every event: equal fingerprints mean the
//                                                 same match, bit for bit
//   node dev/perf-sim.mjs --interest              7 of the 32 count as human guests (their bots still play them):
//                                                 bytes a guest receives per second, snapshots and events, broadcast
//                                                 against per-guest interest management (sim.encodeSnapshotFor and
//                                                 eventsFor, forced on whatever the map's size). Changes the match.
// Tick times are CPU time per tick (process.cpuUsage), live ticks only: on a shared machine wall clock mostly measures
// the neighbours (a quiet tick can read 200 ms). The first tick (nav grid and bots) is reported on its own as "start".
import { brMap } from './br-map.mjs';
import { Sim, buildRoster } from '../js/sim/sim.js';
import { SIM_HZ } from '../js/shared/constants.js';
import { MAPS } from '../js/shared/map.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const SECONDS = Number(opt('seconds', 30));
const HASH = args.includes('--hash');
const INTEREST = args.includes('--interest');
const STEP = 1 / SIM_HZ;
const ids = args.filter(a => !a.startsWith('--'));
const MAPSETS = {
  harvest: () => MAPS.harvest,
  downtown: () => MAPS.downtown,
  expedition: () => MAPS.expedition,
  giant: () => brMap({ density: 1 }),
  giant2: () => brMap({ density: 2 }),
  giantd: () => brMap({ density: 1, spawnArea: 'dense' }),
};

// FNV-1a over the raw bits of doubles, so a difference in the last place shows.
const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
class Hash {
  constructor() { this.h = 0x811c9dc5; }
  num(v) { F64[0] = v; this._u(U32[0]); this._u(U32[1]); }
  _u(u) { for (let i = 0; i < 4; i++) { this.h ^= (u >>> (i * 8)) & 255; this.h = Math.imul(this.h, 0x01000193) >>> 0; } }
  str(s) { for (let i = 0; i < s.length; i++) { this.h ^= s.charCodeAt(i) & 255; this.h = Math.imul(this.h, 0x01000193) >>> 0; } }
  get hex() { return this.h.toString(16).padStart(8, '0'); }
}

function run(name, map) {
  const t0 = performance.now();
  const roster = buildRoster([], { botSkill: 'regular', teamSize: 16, mapId: map.id, mode: 'gwtdm', seed: 5 });
  const sim = new Sim({ roster, map, seed: 5, mode: 'gwtdm', timeLimit: 3600, scoreLimit: 9999 });
  const c0 = process.cpuUsage();
  sim.step(STEP);                       // The first tick builds the nav grid and the bots.
  const cs = process.cpuUsage(c0), start = (cs.user + cs.system) / 1000;
  const guests = INTEREST ? [0, 1, 2, 3, 4, 5, 6].map(g => sim.players[g * 4 + (g & 1)]) : [];
  for (const q of guests) q.isBot = false;      // Humans for the snapshot's rules; their bots still drive them.
  if (INTEREST) sim.setInterest?.(true);
  let bcastBytes = 0, guestBytes = 0;
  // Two guests decode what they are sent, on their own Sim as a phone would: what they show of players near them must
  // match the host exactly (to the wire's rounding), and of far ones stay within what 200 ms of running covers.
  const watch = INTEREST && sim.encodeSnapshotFor ? guests.slice(0, 2).map(q => ({ q, sim: new Sim({ roster, map, seed: 5, mode: 'gwtdm', timeLimit: 3600, scoreLimit: 9999 }) })) : [];
  let nearErr = 0, farErr = 0;
  const times = [], snap = [], guest = [];
  let cpu = 0, live = 0, kills = 0;
  const hash = new Hash();
  const ticks = Math.round((3.2 + SECONDS) * SIM_HZ);
  for (let i = 0; i < ticks; i++) {
    const c = process.cpuUsage();
    sim.step(STEP);
    const cu = process.cpuUsage(c);
    if (sim.phase === 'live') { times.push((cu.user + cu.system) / 1000); cpu += (cu.user + cu.system) / 1000; live++; }
    if (i % 2 === 0 && sim.phase === 'live') {
      const b = JSON.stringify(sim.encodeSnapshot()).length;
      snap.push(b);
      if (INTEREST && sim.encodeSnapshotFor) {
        let sum = 0;
        for (const q of guests) sum += JSON.stringify(sim.encodeSnapshotFor(q.id)).length;
        for (const w of watch) {
          const v = w.sim.decodeSnapshot(JSON.parse(JSON.stringify(sim.encodeSnapshotFor(w.q.id))), w.q.id);
          for (let k = 0; k < sim.players.length; k++) {
            const p = sim.players[k], s2 = v.players[k];
            if (!p.alive || !s2.alive) continue;
            const e = Math.hypot(s2.x - p.ps.x, s2.z - p.ps.z);
            const far = Math.abs(p.ps.x - w.q.ps.x) > 40 || Math.abs(p.ps.z - w.q.ps.z) > 40;
            if (far) farErr = Math.max(farErr, e); else nearErr = Math.max(nearErr, e);
          }
        }
        guest.push(sum / guests.length);
        if (sim.phase === 'live') { bcastBytes += b; guestBytes += sum / guests.length; }
      }
    }
    const ev = sim.drainEvents();
    if (INTEREST && sim.eventsFor && ev.length && sim.phase === 'live') {
      bcastBytes += JSON.stringify(ev).length;
      let sum = 0;
      for (const q of guests) { const own = sim.eventsFor(q.id, ev); if (own.length) sum += JSON.stringify(own).length; }
      guestBytes += sum / guests.length;
    }
    for (const e of ev) {
      if (e.t === 'kill') kills++;
      if (HASH) hash.str(JSON.stringify(e));
    }
    if (HASH) for (const p of sim.players) { hash.num(p.ps.x); hash.num(p.ps.z); hash.num(p.ps.aim); hash.num(p.hp); }
  }
  times.sort((x, y) => x - y);
  const q = k => times[Math.min(times.length - 1, Math.floor(times.length * k))];
  const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const f = (v, d = 2) => v.toFixed(d);
  console.log(`${name.padEnd(10)} walls ${String(map.walls.length).padEnd(5)} start ${f(start, 0).padStart(6)} ms  tick mean ${f(cpu / live)}  p99 ${f(q(0.99))}  worst ${f(times[times.length - 1])} ms` +
    `  snapshot ${f(mean(snap), 0)} B${guest.length ? ` (per guest ${f(mean(guest), 0)} B; a guest's downlink ${f(bcastBytes / live * SIM_HZ / 1024, 1)} -> ${f(guestBytes / live * SIM_HZ / 1024, 1)} KB/s; decoded position error near ${f(nearErr, 3)} m, far ${f(farErr, 2)} m)` : ''}  kills ${kills}${HASH ? `  hash ${hash.hex}` : ''}  (${f((performance.now() - t0) / 1000, 1)} s)`);
}

console.log(`32 bots, 16 v 16 Ground War TDM, ${SECONDS} s live, node ${process.version}`);
for (const id of ids.length ? ids : ['harvest', 'downtown', 'giant', 'giant2']) run(id, MAPSETS[id] ? MAPSETS[id]() : MAPS[id]);
