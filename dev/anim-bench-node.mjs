// Characters CPU, in Node (docs/ANIMATION.md "Performance"): the dev/anim-bench.html crowd without a browser, so the
// timing is steadier on a busy machine and a profiler or deopt trace is one flag away. One run of one checkout:
//   ROOT=/path/to/checkout node --import ./dev/anim-bench-hooks.mjs dev/anim-bench-node.mjs [n=12] [frames=3000] [nodeath]
// dev/anim-bench-cmp.sh alternates two checkouts and prints the trimmed means.
const ROOT = process.env.ROOT;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis; 
const THREE = await import('three');
const { Characters } = await import(ROOT + '/js/render/characters.js');
const { OPERATORS, SKINS } = await import(ROOT + '/js/ui/operators.js');
const N = +(process.argv[2] || 12), FRAMES = +(process.argv[3] || 3000), NODEATH = process.argv[4] === 'nodeath';
const BR = N > 16;
const scene = new THREE.Scene(); const time = { value: 0 };
const chars = new Characters(scene, { walls: [] }, time);
const W = ['ar', 'smg', 'shotgun', 'sniper', 'lmg', 'pistol', 'launcher', 'dmr', 'revolver', 'pdw', 'burst', 'autoshot'];
const players = Array.from({ length: N }, (_, i) => ({
  id: 'p' + i, team: i & 1, x: (i % 8) * 3 - 10, z: Math.floor(i / 8) * 3 - 5, aim: i, vx: 0, vz: 0, hp: 100, alive: true,
  weapon: W[i % W.length], camo: 'none', ammo: 30, adsT: 0, reloadT: 0, reloadDur: 0, sprinting: false, sliding: false, spawnProtect: false, heat: 0,
}));
const suits = SKINS.filter(s => s.suit), kits = OPERATORS.filter(o => o.kit);
chars.setRoster(players.map((p, i) => {
  if (i % 3 === 1 && suits.length) { const s = suits[i % suits.length]; return { id: p.id, operator: s.operator, skin: s.id }; }
  if (i % 3 === 2 && kits.length) return { id: p.id, operator: kits[i % kits.length].id, isBot: true };
  return { id: p.id, operator: OPERATORS[i % OPERATORS.length].id, isBot: true };
}));
const view = { t: 0, players, smokes: null, br: BR ? {} : null };
const opts = { localId: 'p0', localTeam: 0, uav: true, revealAll: false };
const kill = { dirX: 1, dirZ: 0, weapon: 'ar', head: false, explosive: false };
function script(p, i, t, dt) {
  const u = (t + i * 0.37) % 6;
  const dirA = p.aim + [0, Math.PI, Math.PI / 2, -Math.PI / 2, 0.6, 0][Math.floor(u)];
  const sp = u < 4 ? (u < 1 ? 6 : 3.5) : u < 5 ? 1.2 : 0;
  p.vx = Math.cos(dirA) * sp; p.vz = Math.sin(dirA) * sp;
  p.x += p.vx * dt * 0.2; p.z += p.vz * dt * 0.2;
  p.aim += 0.6 * dt;
  p.sprinting = u < 1; p.sliding = u > 0.8 && u < 1.2;
  p.adsT = u > 3 && u < 4 ? 1 : 0;
  if (u >= 4 && u < 4 + dt) { p.reloadDur = 2; p.reloadT = 2; p.ammo = i & 1 ? 0 : 7; }
  if (p.reloadT > 0) { p.reloadT = Math.max(0, p.reloadT - dt); if (p.reloadT === 0) p.ammo = 30; }
  if (u >= 1.5 && u < 3 && Math.floor(t * 8) !== Math.floor((t - dt) * 8)) chars.onShot(p.id, 0.4, p.weapon);
  if (u >= 2.2 && u < 2.2 + dt) chars.onHit(p.id, 1, 0, 0.7);
  if (u >= 5.2 && u < 5.2 + dt) chars.onThrow(p.id, 'frag');
  if (u >= 3.5 && u < 3.5 + dt) { p.weapon = W[(W.indexOf(p.weapon) + 1) % W.length]; chars.onSwap(p.id); }
  if (NODEATH) return;
  const d = (t + i * 1.9) % 24;
  if (d < dt && t > 1) { kill.dirX = Math.cos(i); kill.dirZ = Math.sin(i); kill.head = i % 4 === 0; kill.explosive = i % 5 === 0; kill.weapon = p.weapon; chars.onKill(p.id, kill); }
  p.alive = !(d > 0.15 && d < 3);
}
const dt = 1 / 60; let t = 0;
const step = () => { t += dt; time.value = t; view.t = t; for (let i = 0; i < N; i++) script(players[i], i, t, dt); chars.focusX = 0; chars.focusZ = 0;
  // CPU time, not wall time: on a shared machine the wall clock also counts the other processes' turns.
  const a = process.cpuUsage(); chars.update(view, dt, opts); const b = process.cpuUsage(a); return (b.user + b.system) / 1000; };
for (let i = 0; i < 1200; i++) step();
const s = []; for (let i = 0; i < FRAMES; i++) s.push(step());
s.sort((a, b) => a - b);
// Trimmed mean: the slowest 3% are the shared machine (and the GC), not the code.
const kept = s.slice(0, Math.floor(s.length * 0.97));
console.log(JSON.stringify({ root: ROOT, n: N, trimmed: +(kept.reduce((a, b) => a + b, 0) / kept.length).toFixed(4), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(4), median: +s[s.length >> 1].toFixed(4), p95: +s[Math.floor(s.length * 0.95)].toFixed(4) }));
