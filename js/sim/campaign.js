// The co-op campaign's mission script (docs/CAMPAIGN.md), a rules module like the modes overhaul's (js/sim/rules.js).
// One mission a match: js/shared/campaign.js has the missions (steps, groups, radio), the difficulty and the numbers;
// the match's scoreLimit names the mission and difficulty (cpCode). The squad is team 0 (humans first, bots fill, and an
// escorted VIP in its own seat); the Meridian Line is team CP.team, AI seats that groups take as the script spawns them.
//
// The script, on the host: a state (0 briefing, 1 live, 2 failed, 3 complete), the step under way (objective, its
// progress, a timer, the gate it is at), the triggers of the step that fired (a bit each), the last checkpoint (the
// step it was set on, where, and the step's gate and timer then), the alarm, the bonus objective, deaths and fails.
// Fail conditions: the squad wiped (nobody up), the VIP killed, a timer run out, the defended zone lost, the target
// escaped. A failed mission holds CP.failHold s, then everything is put back to the last checkpoint: the Line's seats
// are cleared, the checkpoint's step starts again (its triggers up to the checkpoint's gate count as fired), and the
// whole squad stands up there. Abort ({cmd:'cp', act:'abort'}, a human, while failed) ends the match instead.
// Everything is deterministic: the sim's rng, the map and the script. Places resolve on open ground by pure geometry,
// so every phone draws them in the same spot without a nav grid.
//
// Enemy AI is the bot system (BotBrain) with mission roles: guard (posts, look about), patrol (walk a loop at walking
// pace), assault (hunt toward the objective or the squad), sniper (overwatch: hold a far spot, see further), target (a
// fleeing HVT and his minders), boss (the juggernaut commander: own health pool, phases, telegraphed barrages and
// charges, a guard he calls in). Guards and patrols are calm until they see, hear or are shot at; then the group goes
// after the trouble, on a leash from home. Stealth steps: guards are blind but for their torch cones (rules-side
// detection: range, angle, line of sight; a meter fills while someone is in the cone), and an alarm (a full meter,
// gunfire near them, a guard shot and left alive or a body seen) wakes everything and brings the mission's alarm waves.
//
// Events: {t:'cpstep', i}, {t:'cpdone', i}, {t:'cpradio', k} (missionLines index), {t:'cpcheck', x, z},
// {t:'cpfail', why}, {t:'cpretry', i}, {t:'cpwin'}, {t:'cpalarm'}, {t:'cpplant', i, pulled?}, {t:'cpboom', x, z, r},
// {t:'cpgate', n}, {t:'cpphase', n}, {t:'cpping', x, z}, {t:'cpwarn', k, x, z}; downs as in battle royale
// ({t:'down'}, {t:'revive'}).
import { CP, CP_DIFFS, cpDecode, cpPoint, missionLines } from '../shared/campaign.js';
import { MAX_HP } from '../shared/constants.js';
import { normalizeLoadout } from '../shared/catalog.js';
import { wallsInBox, hasLineOfSight, hyp } from '../shared/geometry.js';
import { botAttachments, skillOf } from './bots.js';
import { stepPlayer, weaponDef, angleDiff } from './player.js';
import { downedInput } from './br.js';

const PLAN_EVERY = 15;            // Ticks between the squad's and the Line's plans (0.5 s).
const BACKUP_EVERY = 180;         // Snapshots between host-migration backups.
const SLOT_REST = 2;
const ROLES = ['guard', 'patrol', 'assault', 'sniper', 'target', 'boss'];
const GUNS = {
  guard: ['ar', 'smg', 'carbine', 'shotgun', 'heavyar'], patrol: ['smg', 'ar', 'carbine', 'tacsmg'],
  assault: ['ar', 'heavyar', 'smg', 'lmg', 'autoshot', 'burst'], sniper: ['dmr', 'sniper', 'battle'], target: ['pdw'], boss: ['lmg'],
};
const OPS = { guard: 'ghoul', patrol: 'ghoul', assault: 'ram', sniper: 'vesper', target: 'courier', boss: 'marshal' };
const STATES = ['brief', 'live', 'failed', 'complete'];
// Appended only (the wire sends the index): 5 is an abort, then Operation Starfall's lost pursuit and moved hostage.
const FAILS = ['wipe', 'vip', 'time', 'lost', 'escaped', 'abort', 'trail', 'hostage'];
const r1 = v => Math.round(v * 10);
const dist = (ax, az, bx, bz) => hyp(ax - bx, az - bz);

// Open ground: no wall that blocks movement within r of (x, z), and not under a roof (as js/sim/extract.js).
const _wb = [];
function openAt(map, x, z, r) {
  if (x < r + 2 || z < r + 2 || x > map.width - r - 2 || z > map.height - r - 2) return false;
  const n = wallsInBox(map, x - r, z - r, x + r, z + r, _wb);
  for (let i = 0; i < n; i++) {
    const w = map.walls[_wb[i]];
    if (!w.blocksMove) continue;
    if (w.x < x + r && w.x + w.w > x - r && w.z < z + r && w.z + w.d > z - r) return false;
  }
  return true;
}
function openNear(map, x, z, r = 0.6, reach = 30) {
  if (openAt(map, x, z, r)) return { x, z };
  for (let d = 1.5; d <= reach; d += 1.5) {
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (openAt(map, px, pz, r)) return { x: Math.round(px * 10) / 10, z: Math.round(pz * 10) / 10 };
    }
  }
  return { x, z };
}

export class CampaignRules {
  constructor(sim, seed) {
    this.sim = sim;
    this.seed = seed;
    const { k, mission, diff } = cpDecode(sim.scoreLimit);
    this.k = k; this.m = mission; this.diff = diff; this.D = CP_DIFFS[diff];
    this.lines = missionLines(mission);
    this.ownSpawns = true;        // spawnAll places the squad at the insertion point.
    this.ownClock = true;         // The script ends the match.
    this.allIn = true;            // Every bot plays the script, whatever its roll.
    this.noStreaks = true;
    this.authority = false;
    this.V = { cp: true, rules: this };
    this.t = 0; this.state = 0; this.stateT = 0;
    this.stepI = -1; this.stepT = 0; this.prog = 0; this.fired = 0; this.timer = 0; this.gate = 0; this.lost = 0; this.hold = 0;
    this.cpStep = 0; this.cpGate = 0; this.cpTimer = 0; this.cpAlarm = 0; this.cpAt = null; this.cpBoss = null; this.cpStepT = 0;
    this.alarm = 0; this.alarmT = 0; this.alarmLater = false;
    this.bonusOk = true; this.fails = 0; this.deaths = 0; this.why = -1;
    this.sites = []; this.fuseT = -1; this.hazards = []; this.groups = []; this.gid = 0;
    this.boss = null; this.target = null; this.killAt = null; this.pingT = 0; this.ping = null;
    this.vipMin = 100; this.charge = null;
    // Operation Starfall: the night (a flare's time left), the hostage (freed yet, the clock once they are moving her).
    this.night = !!mission.night; this.flareT = 0; this.freed = false; this.execT = 0;
    this._geo = new Map();
    this.saved = null;
  }

  // ---- Places ----

  _pt(ref) {
    const map = this.sim.map, raw = cpPoint(map, ref, this.killAt);
    return openNear(map, raw.x, raw.z, 1.1, 30);
  }
  // A step's resolved places (the same on every phone).
  geo(i) {
    const s = this.m.steps[i];
    if (!s) return null;
    const key = s.at === '@kill' ? `${i}:${this.killAt ? r1(this.killAt.x) + ',' + r1(this.killAt.z) : '-'}` : i;
    let g = this._geo.get(key);
    if (g) return g;
    g = {
      at: s.at ? this._pt(s.at) : null,
      route: (s.route ?? []).map(r => this._pt(r)),
      sites: (s.sites ?? []).map(r => this._pt(r)),
      cp: s.checkpoint ? this._pt(s.cp ?? s.at ?? this.m.insert) : null,
    };
    this._geo.set(key, g);
    return g;
  }
  get cur() { return this.m.steps[this.stepI] ?? null; }

  // ---- Seats ----

  _squad() { return this.sim.players.filter(p => p.team === 0 && !p.ai && !p.away); }
  _up(p) { return p.alive && !p.downed && !p.away; }
  _anyUp(except = null) { for (const p of this.sim.players) if (p !== except && p.team === 0 && !p.ai && this._up(p)) return true; return false; }
  _vip() { return this._vipP ??= this.sim.players.find(p => p.id === 'cp-vip') ?? null; }
  _humans() { return this.sim.players.some(p => p.team === 0 && !p.isBot && !p.dummy); }

  spawnAll() {
    const sim = this.sim;
    const ins = this._pt(this.m.insert), aim = Math.atan2(sim.map.height / 2 - ins.z, sim.map.width / 2 - ins.x);
    this.cpAt = ins;
    for (const p of sim.players) {
      p.downed = false;
      p.cp = { reviveT: 0, downedBy: null, revives: 0 };
      if (p.ai) { p.alive = false; p.hp = 0; p.cpGroup = null; p.cpFreeAt = 0; continue; }
    }
    this._placeSquad(ins, aim);
    return true;
  }

  _placeSquad(at, aim) {
    const sim = this.sim, squad = this._squad();
    squad.forEach((p, k) => {
      const a = aim + Math.PI / 2, off = (k - (squad.length - 1) / 2) * 2;
      const s = openNear(sim.map, at.x + Math.cos(a) * off, at.z + Math.sin(a) * off, 0.6, 8);
      p.downed = false; p.cp.reviveT = 0;
      sim._placeAt(p, s, aim);
      p.spawnProtect = 1.5;
    });
  }

  holdDead(p) {
    if (p.ai) return true;
    return this.state !== 1 && this.state !== 0;
  }

  // A squad member's respawn: at the checkpoint, or behind a squadmate when the fight has moved far from it.
  respawn(p) {
    if (p.ai) return true;
    const sim = this.sim, at = this.cpAt ?? this._pt(this.m.insert);
    let mate = null, md = Infinity;
    for (const q of sim.players) {
      if (q === p || q.team !== 0 || q.ai || !this._up(q)) continue;
      const d = dist(q.ps.x, q.ps.z, at.x, at.z);
      if (d < md) { md = d; mate = q; }
    }
    let spot = { x: at.x + (sim.rng() - 0.5) * 3, z: at.z + (sim.rng() - 0.5) * 3 };
    if (mate && md > 45) {
      const e = this._nearestEnemy(mate.ps.x, mate.ps.z, 60);
      const away = e ? Math.atan2(mate.ps.z - e.ps.z, mate.ps.x - e.ps.x) : sim.rng() * Math.PI * 2;
      for (let k = 0; k < 10; k++) {
        const a = away + (sim.rng() - 0.5) * 1.6, d = 8 + sim.rng() * 5;
        const x = mate.ps.x + Math.cos(a) * d, z = mate.ps.z + Math.sin(a) * d;
        if (sim.nav?.isWalkable(x, z)) { spot = { x, z }; break; }
      }
    }
    spot = openNear(sim.map, spot.x, spot.z, 0.5, 10);
    sim._placeAt(p, spot, 0);
    return true;
  }

  _nearestEnemy(x, z, r) {
    let best = null, bd = r;
    for (const q of this.sim.players) {
      if (q.team === 0 || !q.alive) continue;
      const d = dist(q.ps.x, q.ps.z, x, z);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  onSpawn(p) {
    p.downed = false;
    if (p.cp) { p.cp.reviveT = 0; p.cp.downedBy = null; }
    if (p.ai && p.id !== 'cp-vip') { p.ps.tacticalLeft = 0; p.ps.lethalLeft = p.cpNades ?? 0; }
    if (p.bot) this._sight(p);
  }

  // Who sees what: stealth guards and, before an alarm, the squad's own bots are blind (the rules do the seeing);
  // snipers see further.
  _sight(p) {
    const b = p.bot;
    if (!b) return;
    const quiet = this._stealthOn(), dark = this.night && !(this.flareT > 0) ? CP.nightSight : 1;
    if (p.team === 0) b.sightK = (quiet && !p.ai ? 0.02 : 1) * dark;
    else b.sightK = (p.cpGroup?.stealth && quiet ? 0.02 : p.cpGroup?.role === 'sniper' ? 1.6 : 1) * dark;
    b.calm = p.team !== 0 && !!p.cpGroup && p.cpGroup.state === 'calm';
  }
  _stealthOn() { return !!this.cur?.stealth && !this.alarm; }

  // ---- Downs ----

  tryDown(p, attacker, weapon) {
    if (p.ai || p.downed || p.team !== 0 || !this._anyUp(p)) return false;
    p.downed = true;
    p.hp = CP.downHp;
    p.cp.reviveT = 0;
    p.cp.downedBy = attacker && attacker !== p ? attacker.id : null;
    p.cp.downWeapon = weapon;
    p.ps.sprinting = false; p.ps.sliding = false;
    this.sim._emit({ t: 'down', by: attacker?.id ?? p.id, target: p.id, weapon, x: Math.round(p.ps.x * 100) / 100, z: Math.round(p.ps.z * 100) / 100 });
    return true;
  }

  _stepDowned(p, dt) {
    const sim = this.sim, b = p.cp;
    p.hp -= CP.downHp / CP.bleed * dt;
    if (p.hp <= 0) { this._die(p); return; }
    if (p.fin) return;
    let helper = null;
    for (const q of sim.players) {
      if (q === p || q.team !== 0 || q.ai || !this._up(q)) continue;
      if (dist(q.ps.x, q.ps.z, p.ps.x, p.ps.z) > CP.reviveReach) continue;
      if (q.ps.firingT > 1.2 || hyp(q.ps.vx, q.ps.vz) > 2.6) continue;
      helper = q; break;
    }
    if (helper) {
      b.reviveT += dt;
      if (b.reviveT >= CP.reviveTime) {
        p.downed = false; p.hp = CP.reviveHp; p.regenT = 2; b.reviveT = 0; b.downedBy = null;
        helper.cp.revives++;
        sim._emit({ t: 'revive', id: p.id, by: helper.id });
      }
    } else b.reviveT = Math.max(0, b.reviveT - dt * 1.5);
  }

  _die(p) {
    const sim = this.sim;
    if (!p.alive) return;
    p.downed = false;
    const killer = p.cp?.downedBy ? sim.byId.get(p.cp.downedBy) : null;
    if (killer && killer !== p) sim._kill(p, killer, p.cp.downWeapon ?? killer.ps.weapon, dist(killer.ps.x, killer.ps.z, p.ps.x, p.ps.z), null, false, null);
    else sim._selfKill(p, 'bleed');
  }

  // ---- Damage and deaths ----

  damage(target, attacker, dmg, weapon) {
    const sim = this.sim;
    // The VIP: hit only on the move (escort steps); once delivered she is in cover (the platform's shelter).
    if (target.id === 'cp-vip') return this.cur?.type === 'escort' ? dmg * (this.diff === 0 ? 0.2 : this.diff === 1 ? 0.26 : 0.32) : 0;
    if (attacker?.team === CP.team && !this._raw) dmg *= attacker.cpDeal ?? this.D.deal;
    if (target.team !== CP.team) return dmg;
    const g = target.cpGroup;
    if (this.boss && target === this.boss.p) {
      const B = this.boss;
      if (B.inv > 0) return 0;
      B.pool -= dmg;
      if (B.pool > 0) return Math.min(dmg, Math.max(0, target.hp - 1));
      return 9999;
    }
    dmg *= target.cpTake ?? this.D.take;
    // A pursued target on the run: plates and a moving target, most of it does nothing.
    if (target.cpTarget && this.cur?.type === 'pursue' && this.target?.moving) dmg *= CP.runTake;
    if (g && attacker && attacker.team === 0) {
      if (g.stealth && this._stealthOn()) {
        // A guard shot and left standing, or a body another guard can see, is the alarm.
        if (dmg < target.hp) this._raiseAlarm(target.ps.x, target.ps.z);
        else if (this._witness(target)) this._raiseAlarm(target.ps.x, target.ps.z);
      } else this._alert(g, attacker.ps.x, attacker.ps.z);
    }
    void weapon; void sim;
    return dmg;
  }

  // Nobody finishes the escorted VIP or the hostage (js/sim/finishers.js canFinish): a finisher would skip the
  // damage rules above.
  noFinish(a, v) { return v?.id === 'cp-vip'; }

  _witness(victim) {
    for (const q of this.sim.players) {
      if (q === victim || q.team !== CP.team || !q.alive || !q.cpGroup?.stealth) continue;
      if (dist(q.ps.x, q.ps.z, victim.ps.x, victim.ps.z) < 12 && hasLineOfSight(this.sim.map, q.ps.x, q.ps.z, victim.ps.x, victim.ps.z)) return true;
    }
    return false;
  }

  onShot(p) {
    if (p.team !== 0 || !this._stealthOn()) return;
    const w = weaponDef(p.ps);
    if (!w || w.melee) return;
    const reach = w.suppressed ? 6 : 24;
    for (const q of this.sim.players) {
      if (q.team !== CP.team || !q.alive || !q.cpGroup?.stealth) continue;
      if (dist(q.ps.x, q.ps.z, p.ps.x, p.ps.z) < reach) { this._raiseAlarm(p.ps.x, p.ps.z); return; }
    }
  }

  onKill(target, killer, info = {}) {
    const sim = this.sim;
    target.downed = false;
    if (target.id === 'cp-vip') { if (!info.away && this.state === 1) this._fail('vip'); return; }
    if (target.ai) {
      const g = target.cpGroup;
      target.cpFreeAt = this.t + SLOT_REST;
      target.cpGroup = null;
      if (g) {
        g.members = g.members.filter(q => q !== target);
        if (killer && killer.team === 0 && !g.stealth) this._alert(g, killer.ps.x, killer.ps.z);
        if (target.cpTarget) this._targetDown(target);
        if (this.boss && target === this.boss.p) this._bossDown();
      }
      return;
    }
    if (target.team !== 0) return;
    if (!info.away) {
      target.respawnT = this.D.respawn;
      if (this.state === 1 && (!target.isBot || !this._humans())) { this.deaths++; this._dirty(); }
    }
    if (!this._anyUp()) {
      for (const q of sim.players) if (q !== target && q.team === 0 && !q.ai && q.alive && q.downed) this._die(q);
    }
    this._checkWipe();
  }

  _checkWipe() {
    if (this.state !== 1) return;
    const squad = this._squad();
    if (squad.length && !squad.some(p => this._up(p))) this._fail('wipe');
  }

  // ---- One tick ----

  step(dt) {
    const sim = this.sim;
    this.authority = true;
    if (sim.phase !== 'live') return;
    this.t += dt;
    this.stateT += dt;
    if (this.state === 0) { this.state = 1; this.stateT = 0; this._begin(0); }
    if (this.state === 2) {
      if (this.stateT >= CP.failHold) this._retry();
      return;
    }
    if (this.state === 3) {
      if (this.stateT >= CP.endHold) sim._end(0);
      return;
    }
    this.stepT += dt;
    for (const p of sim.players) {
      if (p.team !== 0 || p.ai || !p.alive) continue;
      if (p.downed) this._stepDowned(p, dt);
    }
    if (this.boss) this._stepBoss(dt);
    if (this.flareT > 0) { this.flareT -= dt; if (this.flareT <= 0) { this.flareT = 0; for (const p of sim.players) if (p.bot && p.alive) this._sight(p); this._dirty(); } }
    this._stepHazards(dt);
    if (this._stealthOn()) this._stepDetect(dt);
    if (this.alarm) this._stepAlarm(dt);
    this._stepObjective(dt);
    if (this.state !== 1) return;
    if (sim.tick % 15 === 3) this._checkWipe();
    if (sim.tick % PLAN_EVERY === 0) this._planGroups();
    if (sim.tick % PLAN_EVERY === 7) this._planSquad();
    const vip = this._vip();
    if (vip?.alive) this.vipMin = Math.min(this.vipMin, vip.hp);
    if (this.m.bonus?.id === 'vip' && this.vipMin < 50 && this.bonusOk) { this.bonusOk = false; this._dirty(); }
    sim.timeLeft = Math.max(0, this.timer);
  }

  // ---- The script ----

  _begin(i, retry = false) {
    const sim = this.sim, s = this.m.steps[i];
    this.stepI = i; this.stepT = 0; this.prog = 0; this.fired = 0; this.lost = 0; this.hold = 0; this.gate = 0;
    this.timer = s.timer ? s.timer * this.D.timer : 0;
    this.fuseT = -1;
    const G = this.geo(i);
    this.sites = G.sites.map((p, k) => ({ i: k, x: p.x, z: p.z, state: 0, prog: 0, def: 0 }));
    if (s.checkpoint && !retry) this._checkpoint(G.cp);
    // A hostage (Operation Starfall): held at her spot until the step that frees her is done.
    this.freed = this.m.steps.slice(0, i).some(x => x.hostage);
    if (this.m.vip?.early && !this.freed) this._holdHostage();
    for (const def of s.spawn ?? []) {
      // Back at a checkpoint part way through a step: no posts on top of the squad (a stop it already took).
      if (retry && this.cpAt && (def.role === 'guard' || def.role === 'patrol' || def.role === 'sniper')) {
        const h = this._pt(def.at);
        if (dist(h.x, h.z, this.cpAt.x, this.cpAt.z) < 22 && (this.cpGate > 0 || this.cpStepT > 0)) continue;
      }
      this._spawnGroup(def, i);
    }
    // Back at the checkpoint of a step whose target an earlier step brought on (Dead Man's Run: the commander turns up at
    // the last relay of the chase): _retry cleared him with everyone else, so he comes back here, or the step could
    // never be done.
    if (retry && (s.type === 'kill' || s.type === 'pursue') && !this.target?.p?.alive) {
      let def = null;
      for (const st of this.m.steps.slice(0, i)) for (const d of [...(st.spawn ?? []), ...(st.on ?? []).flatMap(tr => tr.spawn ?? [])]) if (d.role === 'target') def = d;
      if (def) this._spawnGroup(def, i);
    }
    for (const l of s.say ?? []) this._say(l);
    if (s.type === 'escort') this._startVip(retry);
    // The escape after a quiet rescue: the whole place knows.
    if (s.loud && !this.alarm) this._raiseAlarm(G.route[0]?.x ?? this.cpAt?.x ?? 0, G.route[0]?.z ?? this.cpAt?.z ?? 0);
    sim._emit({ t: 'cpstep', i });
    for (const p of sim.players) if (p.bot && p.alive) this._sight(p);
    this._dirty();
  }

  _checkpoint(at) {
    if (!at) return;
    this.cpBoss = null; this.cpStepT = 0;
    this.cpAt = { x: at.x, z: at.z }; this.cpStep = this.stepI; this.cpGate = this.gate; this.cpTimer = this.timer; this.cpAlarm = this.alarm;
    this.sim._emit({ t: 'cpcheck', x: r1(at.x) / 10, z: r1(at.z) / 10 });
  }

  _complete() {
    const s = this.cur;
    if (s.hostage) { this.freed = true; this.execT = 0; this.timer = 0; }
    for (const l of s.done ?? []) this._say(l);
    this.sim._emit({ t: 'cpdone', i: this.stepI });
    if (this.stepI + 1 < this.m.steps.length) this._begin(this.stepI + 1);
    else {
      this.state = 3; this.stateT = 0;
      this.hazards = [];
      this.sim._emit({ t: 'cpwin' });
      this._dirty();
    }
  }

  _fail(why) {
    if (this.state !== 1) return;
    this.state = 2; this.stateT = 0; this.why = FAILS.indexOf(why);
    this.fails++;
    this.hazards = []; this.charge = null;
    this.sim._emit({ t: 'cpfail', why });
    this._dirty();
  }

  // Back to the last checkpoint: the Line cleared, the step started again, the squad on its feet there.
  _retry() {
    const sim = this.sim;
    for (const p of sim.players) {
      if (!p.ai || p.team !== CP.team) continue;
      p.alive = false; p.hp = 0; p.cpGroup = null; p.cpFreeAt = 0; p.cpTarget = false;
      if (p.bot) p.bot.setObjective(null);
    }
    this.groups = []; this.boss = null; this.target = null; this.charge = null; this.hazards = []; this.ping = null;
    if (this.cpAlarm === 0 && this.alarm) { this.alarm = 0; this.alarmLater = false; }
    const vip = this._vip();
    if (vip) { vip.alive = false; vip.hp = 0; }
    this.state = 1; this.stateT = 0;
    const i = this.cpStep, gate = this.cpGate, timer = this.cpTimer, held = this.cpStepT ?? 0;
    sim._emit({ t: 'cpretry', i });
    this._begin(i, true);
    this.gate = gate;
    if (this.m.steps[i].timer) this.timer = Math.max(timer, 45 * this.D.timer);
    // The checkpoint's gate: its triggers have been and gone.
    (this.m.steps[i].on ?? []).forEach((tr, k) => { if ((tr.when.gate && tr.when.gate <= gate) || (held && tr.when.t !== undefined && tr.when.t < held)) this.fired |= 1 << k; });
    if (held && this.m.steps[i].type === 'defend') { this.stepT = held; this.cpStepT = held; }
    this.execT = this.alarm && this.m.hostage && !this.freed ? this.m.hostage.clock * this.D.timer : 0;
    this.flareT = 0;
    if (this.target && gate > 0) this._placeTargetAt(gate);
    // Past the escort (holding the platform), the VIP stands up at the checkpoint with the squad.
    if (vip && this.m.vip && this.cur.type !== 'escort' && this.m.steps.slice(0, i).some(s => s.type === 'escort')) this._startVip(true);
    for (const p of this._squad()) { p.alive = false; p.downed = false; }
    const at = this.cpAt ?? this._pt(this.m.insert);
    const ahead = this.geo(i).route[gate] ?? this.geo(i).at ?? at;
    this._placeSquad(at, Math.atan2(ahead.z - at.z, ahead.x - at.x) || 0);
    this._dirty();
  }

  _say(line) {
    const k = this.lines.indexOf(line);
    if (k >= 0) this.sim._emit({ t: 'cpradio', k });
  }

  _trigger(when) {
    const on = this.cur?.on ?? [];
    for (let k = 0; k < on.length; k++) {
      if (this.fired & (1 << k)) continue;
      const w = on[k].when;
      const hit = (w.t !== undefined && this.stepT >= w.t) || (w.prog !== undefined && this.prog >= w.prog) || (w.gate !== undefined && when.gate >= w.gate)
        || (w.planted !== undefined && when.planted >= w.planted) || (w.phase !== undefined && when.phase >= w.phase);
      if (!hit) continue;
      this.fired |= 1 << k;
      // A wave into a defence is a checkpoint of its own: a retry starts the hold from this wave, not the first.
      if (w.t !== undefined && w.t > 10 && this.cur?.type === 'defend' && this.state === 1) {
        this.cpStepT = w.t;
        if (this.cpStep === this.stepI) this.sim._emit({ t: 'cpcheck', x: r1(this.cpAt?.x ?? 0) / 10, z: r1(this.cpAt?.z ?? 0) / 10 });
      }
      for (const def of on[k].spawn ?? []) this._spawnGroup(def, this.stepI);
      for (const l of on[k].say ?? []) this._say(l);
      if (on[k].flare) this._flare();
      this._dirty();
    }
  }

  // A flare over a night mission: the field lit for CP.flare s (everyone sees, the phones' dark lifts).
  _flare() {
    if (!this.night) return;
    this.flareT = CP.flare;
    const at = this.geo(this.stepI)?.at ?? this.cpAt ?? { x: 0, z: 0 };
    this.sim._emit({ t: 'cpflare', x: r1(at.x) / 10, z: r1(at.z) / 10, life: CP.flare });
    for (const p of this.sim.players) if (p.bot && p.alive) this._sight(p);
  }

  // The hostage at her spot, not moving, until she is freed (the mission's vip with `early`).
  _holdHostage() {
    const vip = this._vip();
    if (!vip) return;
    const at = this._pt(this.m.vip.at);
    vip.pendingLoadout = normalizeLoadout({ primary: 'pistol', secondary: 'pistol', camo: 'none', operator: 'sparrow', perks: [], streaks: [] });
    vip.rating = 0; vip.skill = 'recruit';
    if (!vip.alive || dist(vip.ps.x, vip.ps.z, at.x, at.z) > 3) this.sim._placeAt(vip, openNear(this.sim.map, at.x, at.z, 0.5, 8), 0);
    vip.spawnProtect = 0;
    vip.name = this.m.vip.name ?? vip.name;
    this.vipMoving = false;
  }

  _stepObjective(dt) {
    const sim = this.sim, s = this.cur, G = this.geo(this.stepI);
    if (!s) return;
    this._trigger({ gate: this.gate, planted: this.sites.filter(x => x.state === 1).length, phase: this.boss?.phase ?? 0 });
    const squad = this._squad().filter(p => this._up(p));
    // They are moving the hostage: the clock the alarm started.
    if (this.execT > 0) {
      this.execT -= dt; this.timer = Math.max(0, this.execT);
      if (this.execT <= 0) { this.execT = 0; this._fail('hostage'); return; }
    }
    switch (s.type) {
      case 'goto': {
        const r = s.r ?? 5;
        if (squad.some(p => dist(p.ps.x, p.ps.z, G.at.x, G.at.z) < r)) this._complete();
        break;
      }
      case 'extract': {
        const r = s.r ?? 6;
        const inside = squad.filter(p => dist(p.ps.x, p.ps.z, G.at.x, G.at.z) < r);
        if (inside.length && inside.length === squad.length) this.hold += dt; else this.hold = Math.max(0, this.hold - dt * 2);
        this.prog = Math.min(1, this.hold / (s.time ?? 4));
        if (this.prog >= 1) this._complete();
        break;
      }
      case 'hack': {
        const { ours, them } = this._inZone(G.at, s.r ?? 5);
        if (ours && them && this.m.bonus?.id === 'clean' && this.bonusOk) { this.bonusOk = false; this._dirty(); }
        if (ours && !them) this.prog = Math.min(1, this.prog + dt / s.time);
        this.contested = ours && them;
        if (this.prog >= 1) this._complete();
        break;
      }
      case 'defend': {
        const { ours, them } = this._inZone(G.at, s.r ?? 8);
        if (them && !ours) this.lost += dt / CP.lostAfter; else this.lost = Math.max(0, this.lost - dt / (CP.lostAfter * 2));
        this.contested = ours && them;
        if (this.lost >= 0.5 && this.m.bonus?.id === 'zone' && this.bonusOk) { this.bonusOk = false; this._dirty(); }
        this.prog = Math.min(1, this.stepT / s.time);
        if (this.lost >= 1) this._fail('lost');
        else if (this.prog >= 1) this._complete();
        break;
      }
      case 'plant': this._stepPlant(s, dt); break;
      case 'escort': this._stepVip(s, G, dt); break;
      case 'chase': {
        this.timer -= dt;
        const gate = G.route[this.gate];
        if (gate && squad.some(p => dist(p.ps.x, p.ps.z, gate.x, gate.z) < (s.r ?? 10))) {
          this.gate++;
          this.timer += (s.add ?? 40) * this.D.timer;
          sim._emit({ t: 'cpgate', n: this.gate });
          this._checkpoint(gate);
          if (this.gate >= G.route.length) { this._complete(); break; }
          this._dirty();
        }
        this.prog = this.gate / G.route.length;
        if (this.timer < 15 && this.m.bonus?.id === 'spare' && this.bonusOk) { this.bonusOk = false; this._dirty(); }
        if (this.timer <= 0) this._fail('time');
        break;
      }
      case 'kill': this._stepTarget(s, dt); break;
      case 'pursue': {
        this._stepTarget(s, dt);
        const T = this.target;
        if (!T?.p?.alive || !T.started || this.state !== 1) break;
        const near = squad.some(p => dist(p.ps.x, p.ps.z, T.p.ps.x, T.p.ps.z) < (s.r ?? 30));
        this.lost = near ? Math.max(0, this.lost - dt / (CP.trail * 1.5)) : this.lost + dt / CP.trail;
        if (this.lost >= 0.5 && this.m.bonus?.id === 'close' && this.bonusOk) { this.bonusOk = false; this._dirty(); }
        if (this.lost >= 1) this._fail('trail');
        break;
      }
      case 'boss':                 // _stepBoss; done when he falls (_bossDown). A launch clock, when the step has one.
        if (s.timer) { this.timer -= dt; if (this.timer <= 0) this._fail('time'); }
        break;
    }
  }

  _inZone(at, r) {
    let ours = false, them = false;
    for (const q of this.sim.players) {
      if (!q.alive || q.downed || q.away || q.id === 'cp-vip') continue;
      if (dist(q.ps.x, q.ps.z, at.x, at.z) > r) continue;
      if (q.team === 0) ours = true; else them = true;
    }
    return { ours, them };
  }

  // ---- Charges and taps ----

  _stepPlant(s, dt) {
    const sim = this.sim;
    const planted = () => this.sites.filter(x => x.state === 1).length;
    if (s.timer && this.timer > 0 && planted() < this.sites.length) {
      this.timer -= dt;
      if (this.timer <= 0) { this._fail('time'); return; }
    }
    for (const site of this.sites) {
      if (site.state === 0) {
        let planter = null;
        for (const q of sim.players) {
          if (q.team !== 0 || q.ai || !this._up(q)) continue;
          if (dist(q.ps.x, q.ps.z, site.x, site.z) < CP.plantReach && hyp(q.ps.vx, q.ps.vz) < 1.8) { planter = q; break; }
        }
        site.prog = planter ? site.prog + dt / (s.plant ?? 3) : Math.max(0, site.prog - dt * 0.5);
        if (site.prog >= 1) { site.state = 1; site.prog = 1; site.def = 0; sim._emit({ t: 'cpplant', i: site.i }); this._dirty(); }
      } else if (s.fuse) {
        let puller = null;
        for (const q of sim.players) {
          if (q.team !== CP.team || !q.alive || !q.cpGroup || q === this.boss?.p) continue;
          if (dist(q.ps.x, q.ps.z, site.x, site.z) < CP.plantReach && hyp(q.ps.vx, q.ps.vz) < 1.8) { puller = q; break; }
        }
        site.def = puller ? site.def + dt / CP.defuseTime : Math.max(0, site.def - dt);
        if (site.def >= 1) {
          site.state = 0; site.prog = 0; site.def = 0; this.fuseT = -1;
          if (this.m.bonus?.id === 'charges') this.bonusOk = false;
          sim._emit({ t: 'cpplant', i: site.i, pulled: 1 });
          this._dirty();
        }
      }
    }
    const n = planted();
    this.prog = this.sites.length ? n / this.sites.length : 1;
    if (n < this.sites.length) return;
    if (!s.fuse) { this._complete(); return; }
    if (this.fuseT < 0) { this.fuseT = s.fuse; this._dirty(); }
    this.fuseT -= dt;
    if (this.fuseT <= 0) {
      for (const site of this.sites) {
        sim._emit({ t: 'cpboom', x: r1(site.x) / 10, z: r1(site.z) / 10, r: 7 });
        for (const q of sim.players) if (q.team === CP.team && q.alive && q !== this.boss?.p && dist(q.ps.x, q.ps.z, site.x, site.z) < 7) { q.hp = 0; q.alive = false; this.onKill(q, null, {}); }
      }
      this.fuseT = -1;
      this._complete();
    }
  }

  // ---- The escorted VIP ----

  _startVip(retry) {
    const sim = this.sim, vip = this._vip(), s = this.cur;
    if (!vip) return;
    const at = retry ? this.cpAt : this._pt(this.m.vip?.at ?? this.m.insert);
    const spot = openNear(sim.map, at.x + 1.5, at.z + 1.5, 0.5, 8);
    vip.pendingLoadout = normalizeLoadout({ primary: 'pistol', secondary: 'pistol', camo: 'none', operator: 'sparrow', perks: [], streaks: [] });
    vip.rating = 0; vip.skill = 'recruit';
    sim._placeAt(vip, spot, 0);
    vip.spawnProtect = 0;
    vip.name = this.m.vip?.name ?? vip.name;
    this.vipPath = null; this.vipStuck = 0;
    void s;
  }

  _stepVip(s, G, dt) {
    const sim = this.sim, vip = this._vip();
    if (!vip?.alive) return;
    const goal = G.route[this.gate];
    if (!goal) { this._complete(); return; }
    let near = false, block = false;
    for (const q of sim.players) {
      if (!q.alive || q.downed || q.away || q === vip) continue;
      const d = dist(q.ps.x, q.ps.z, vip.ps.x, vip.ps.z);
      if (q.team === 0 && d < 9) near = true;
      else if (q.team !== 0 && d < 10 && hasLineOfSight(sim.map, q.ps.x, q.ps.z, vip.ps.x, vip.ps.z)) block = true;
    }
    this.vipMoving = near && !block;
    this.contested = block;
    if (dist(vip.ps.x, vip.ps.z, goal.x, goal.z) < 2.6) {
      this.gate++;
      this.vipPath = null;
      sim._emit({ t: 'cpgate', n: this.gate });
      this._checkpoint({ x: vip.ps.x, z: vip.ps.z });
      if (this.gate >= G.route.length) { this._complete(); return; }
      this._dirty();
    }
    const from = this.gate ? G.route[this.gate - 1] : this._pt(this.m.vip?.at ?? this.m.insert);
    const total = dist(from.x, from.z, goal.x, goal.z) || 1;
    this.prog = Math.min(1, (this.gate + Math.max(0, 1 - dist(vip.ps.x, vip.ps.z, goal.x, goal.z) / total)) / G.route.length);
    void dt;
  }

  // ---- The fleeing target and commanders ----

  _stepTarget(s, dt) {
    const sim = this.sim, T = this.target;
    if (!T) return;
    const p = T.p;
    if (!p?.alive) return;
    const G = T.route;
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = CP.ping;
      this.ping = { x: r1(p.ps.x) / 10, z: r1(p.ps.z) / 10 };
      sim._emit({ t: 'cpping', x: this.ping.x, z: this.ping.z });
      this._dirty();
    }
    if (!G.length) return;
    if (T.moving) {
      const goal = G[T.wp];
      if (dist(p.ps.x, p.ps.z, goal.x, goal.z) < 3.5) {
        T.moving = false; T.holdT = 0;
        this.gate = T.wp + 1;
        sim._emit({ t: 'cpgate', n: this.gate });
        const back = T.wp ? G[T.wp - 1] : T.home;
        this._checkpoint(openNear(sim.map, back.x, back.z, 0.6, 12));
        this._dirty();
      }
      return;
    }
    T.holdT += dt;
    const last = T.wp >= G.length - 1 && this.gate >= G.length;
    if (s.type === 'pursue') {
      // He runs stop to stop without waiting, once the squad is on him; cornered at the last, he turns and fights.
      if (last) { this.prog = 1; return; }
      let close = false;
      for (const q of sim.players) if (q.team === 0 && !q.ai && this._up(q) && dist(q.ps.x, q.ps.z, p.ps.x, p.ps.z) < (s.r ?? 30)) { close = true; break; }
      if ((T.started && T.holdT > 0.6) || close) {
        if (this.gate > 0 || T.wp > 0 || T.started) T.wp = Math.min(G.length - 1, this.gate);
        T.started = true; T.moving = true;
        this._dirty();
      }
      this.prog = this.gate / G.length;
      return;
    }
    if (last) {
      this.prog = Math.min(1, T.holdT / CP.hvtEscape);
      if (T.holdT >= CP.hvtEscape) this._fail('escaped');
      return;
    }
    let close = false;
    for (const q of sim.players) if (q.team === 0 && !q.ai && this._up(q) && dist(q.ps.x, q.ps.z, p.ps.x, p.ps.z) < CP.hvtNear) { close = true; break; }
    if ((close && T.holdT > 3) || T.holdT > CP.hvtWait) {
      if (this.gate > 0 || T.wp > 0 || T.started) T.wp = Math.min(G.length - 1, this.gate);
      T.started = true;
      T.moving = true;
      this._dirty();
    }
  }

  _placeTargetAt(gate) {
    const T = this.target;
    if (!T?.p?.alive) return;
    const at = T.route[Math.min(T.route.length - 1, gate - 1)];
    if (!at) return;
    for (const q of T.g.members) this.sim._placeAt(q, openNear(this.sim.map, at.x + (this.sim.rng() - 0.5) * 3, at.z + (this.sim.rng() - 0.5) * 3, 0.5, 8), 0);
    T.wp = gate - 1; T.moving = false; T.holdT = 0; T.started = true;
    this.gate = gate;
  }

  _targetDown(p) {
    this.killAt = { x: r1(p.ps.x) / 10, z: r1(p.ps.z) / 10 };
    if (this.m.bonus?.id === 'early' && this.gate >= 2) this.bonusOk = false;
    this.target = null; this.ping = null;
    this._dirty();
    if (this.cur?.type === 'kill' || this.cur?.type === 'pursue') this._complete();
  }

  // ---- The boss ----

  _stepBoss(dt) {
    const sim = this.sim, B = this.boss, p = B.p;
    if (!p?.alive) return;
    p.hp = Math.max(1, Math.min(MAX_HP, Math.ceil(B.pool / B.max * MAX_HP)));
    p.armor = 0;
    if (B.inv > 0) B.inv -= dt;
    const frac = B.pool / B.max, phase = frac < 0.33 ? 2 : frac < 0.66 ? 1 : 0;
    if (phase > B.phase) {
      B.phase = phase; B.inv = 3.5; B.atk = 4;
      this.charge = null;
      // A checkpoint mid-fight: a retry brings him back at this phase's health, not full.
      this.cpBoss = [phase, Math.round(B.pool)];
      sim._emit({ t: 'cpphase', n: phase });
      // He kneels and calls his guard.
      for (let k = 0; k < 2; k++) this._spawnGroup({ role: 'assault', at: [this.cur.at, (k ? 14 : -14), (k ? -6 : 6)], n: CP.boss.guard / 2 }, this.stepI);
      this._dirty();
    }
    if (B.inv > 0) return;
    if (this.charge) { this._stepCharge(dt); return; }
    B.atk -= dt;
    if (B.atk > 0) return;
    B.atk = CP.boss.barrage[B.phase];
    const squad = this._squad().filter(q => this._up(q));
    if (!squad.length) return;
    B.n = (B.n ?? 0) + 1;
    if (B.phase === 2 && B.n % 2 === 0) {
      // A charge: lined up on the nearest of the squad, a moment to see it coming, then he runs it.
      let best = null, bd = 30;
      for (const q of squad) { const d = dist(q.ps.x, q.ps.z, p.ps.x, p.ps.z); if (d < bd && d > 3) { bd = d; best = q; } }
      if (best) {
        const a = Math.atan2(best.ps.z - p.ps.z, best.ps.x - p.ps.x), len = Math.min(26, bd + 6);
        let ex = p.ps.x, ez = p.ps.z;
        for (let d = 0; d < len; d += 0.5) {
          const x = p.ps.x + Math.cos(a) * d, z = p.ps.z + Math.sin(a) * d;
          if (!sim.nav?.isWalkable(x, z)) break;
          ex = x; ez = z;
        }
        this.charge = { a, x: p.ps.x, z: p.ps.z, ex, ez, t: CP.boss.chargeWarn, go: false, hit: new Set() };
        this.hazards.push({ k: 1, x: p.ps.x, z: p.ps.z, x2: ex, z2: ez, r: CP.boss.chargeW, t: CP.boss.chargeWarn, w: CP.boss.chargeWarn, live: false });
        sim._emit({ t: 'cpwarn', k: 1, x: r1(p.ps.x) / 10, z: r1(p.ps.z) / 10 });
        this._dirty();
        return;
      }
    }
    // A salvo (a mission's boss with `salvo`): a line of rings walked out toward one of the squad, each landing a
    // moment after the one before; step off the line.
    if (this.m.boss?.salvo && B.n % 3 === 2) {
      const q = squad[B.n % squad.length], a = Math.atan2(q.ps.z - p.ps.z, q.ps.x - p.ps.x);
      for (let k = 0; k < 6; k++) {
        const d = 3 + k * 3.2, x = p.ps.x + Math.cos(a) * d, z = p.ps.z + Math.sin(a) * d;
        if (sim.nav && !sim.nav.isWalkable(x, z)) break;
        this.hazards.push({ k: 0, x, z, x2: x, z2: z, r: 2.3, t: CP.boss.warn + k * 0.22, w: CP.boss.warn + k * 0.22, live: true });
      }
      sim._emit({ t: 'cpwarn', k: 2, x: r1(p.ps.x) / 10, z: r1(p.ps.z) / 10 });
      this._dirty();
      return;
    }
    // A barrage: a ring on (just ahead of) each of up to three of the squad.
    const n = Math.min(3, squad.length), lead = 0.5 * CP.boss.warn;
    for (let k = 0; k < n; k++) {
      const q = squad[(B.n + k) % squad.length];
      const x = q.ps.x + q.ps.vx * lead, z = q.ps.z + q.ps.vz * lead;
      this.hazards.push({ k: 0, x, z, x2: x, z2: z, r: CP.boss.ring, t: CP.boss.warn, w: CP.boss.warn, live: true });
    }
    sim._emit({ t: 'cpwarn', k: 0, x: r1(p.ps.x) / 10, z: r1(p.ps.z) / 10 });
    this._dirty();
  }

  _stepCharge(dt) {
    const sim = this.sim, C = this.charge, p = this.boss.p;
    if (!C.go) {
      C.t -= dt;
      if (C.t <= 0) C.go = true;
      return;
    }
    const step = CP.boss.chargeSpeed * dt, dx = C.ex - p.ps.x, dz = C.ez - p.ps.z, d = hyp(dx, dz);
    if (d <= step + 0.05) { p.ps.x = C.ex; p.ps.z = C.ez; this.charge = null; p.ps.vx = 0; p.ps.vz = 0; this._dirty(); return; }
    p.ps.x += dx / d * step; p.ps.z += dz / d * step; p.ps.vx = dx / d * CP.boss.chargeSpeed; p.ps.vz = dz / d * CP.boss.chargeSpeed; p.ps.aim = C.a;
    for (const q of sim.players) {
      if (q.team !== 0 || !q.alive || q.ai || C.hit.has(q)) continue;
      if (dist(q.ps.x, q.ps.z, p.ps.x, p.ps.z) < CP.boss.chargeW + 0.4) {
        C.hit.add(q);
        if (this.m.bonus?.id === 'dodge') this.bonusOk = false;
        this._raw = true;
        sim._damage(q, p, CP.boss.chargeHit * this._hitK(), p.ps.weapon, 1, null, false, 'frag');
        this._raw = false;
      }
    }
  }

  _hitK() { return [0.7, 1, 1.3][this.diff]; }
  // The boss's pool: the numbers' base, the difficulty and the mission's own (Operation Starfall's Vane).
  _bossMax() { return CP.boss.hp * this.D.boss * (this.m.boss?.hp ?? 1); }

  _stepHazards(dt) {
    if (!this.hazards.length) return;
    const sim = this.sim, src = this.boss?.p;
    for (const h of this.hazards) {
      h.t -= dt;
      if (h.t > 0 || !h.live) continue;
      h.done = true;
      sim._emit({ t: 'cpboom', x: r1(h.x) / 10, z: r1(h.z) / 10, r: h.r });
      if (!src) continue;
      for (const q of sim.players) {
        if (q.team !== 0 || !q.alive || q.ai || dist(q.ps.x, q.ps.z, h.x, h.z) > h.r) continue;
        if (this.m.bonus?.id === 'dodge' && this.bonusOk) { this.bonusOk = false; this._dirty(); }
        this._raw = true;
        sim._damage(q, src, CP.boss.hit * this._hitK(), src.ps.weapon, dist(q.ps.x, q.ps.z, src.ps.x, src.ps.z), null, false, 'frag');
        this._raw = false;
      }
    }
    // The charge's line goes when he has run it.
    this.hazards = this.hazards.filter(h => !h.done && !(h.k === 1 && h.t < -1.2));
  }

  _bossDown() {
    this.boss = null; this.charge = null; this.hazards = [];
    this._dirty();
    if (this.cur?.type === 'boss') this._complete();
  }

  // ---- Stealth ----

  _stepDetect(dt) {
    const sim = this.sim, C = CP.detect;
    for (const g of this.groups) {
      if (!g.stealth) continue;
      for (const q of g.members) {
        if (!q.alive) continue;
        let fill = 0;
        for (const p of sim.players) {
          if (p.team !== 0 || p.ai || !this._up(p)) continue;
          const dx = p.ps.x - q.ps.x, dz = p.ps.z - q.ps.z, d = hyp(dx, dz);
          if (d > C.range) continue;
          if (d > 2.2 && Math.abs(angleDiff(Math.atan2(dz, dx), q.ps.aim)) > C.cone) continue;
          if (!hasLineOfSight(sim.map, q.ps.x, q.ps.z, p.ps.x, p.ps.z, sim.smokes)) continue;
          const speed = hyp(p.ps.vx, p.ps.vz);
          let k = C.rate * (1.15 - d / C.range * 0.75) * (p.ps.sprinting ? 1.5 : speed < 0.5 ? C.crouchK : 1);
          if (p.isBot) k *= 0.5;
          fill = Math.max(fill, k);
        }
        q.cpSee = Math.max(0, Math.min(1, (q.cpSee ?? 0) + (fill > 0 ? fill * dt : -C.fall * dt)));
        if (q.cpSee >= 1) { this._raiseAlarm(q.ps.x, q.ps.z); return; }
      }
    }
  }

  _raiseAlarm(x, z) {
    if (this.alarm) return;
    const sim = this.sim;
    this.alarm = 1; this.alarmT = 0; this.alarmLater = false;
    if (this.m.bonus?.id === 'hidden') this.bonusOk = false;
    // Before the hostage is free: the bonus is gone and they start moving her.
    if (this.m.hostage && !this.freed) {
      if (this.m.bonus?.id === 'quiet') this.bonusOk = false;
      this.execT = this.m.hostage.clock * this.D.timer;
    }
    sim._emit({ t: 'cpalarm', x: r1(x) / 10, z: r1(z) / 10 });
    for (const g of this.groups) { if (g.stealth) { g.stealth = false; for (const q of g.members) q.cpSee = 0; } this._alert(g, x, z); }
    for (const def of this.m.alarm?.spawn ?? []) this._spawnGroup(def, this.stepI);
    for (const l of this.m.alarm?.say ?? []) this._say(l);
    for (const p of sim.players) if (p.bot && p.alive) this._sight(p);
    this._dirty();
  }

  _stepAlarm(dt) {
    this.alarmT += dt;
    const later = this.m.alarm?.later;
    if (later && !this.alarmLater && this.alarmT >= later.t) {
      this.alarmLater = true;
      for (const def of later.spawn ?? []) this._spawnGroup(def, this.stepI);
      this._dirty();
    }
  }

  // ---- The Line's groups ----

  _freeSeats(n) {
    const out = [];
    for (const p of this.sim.players) {
      if (!p.ai || p.team !== CP.team || p.alive || p.cpGroup || (p.cpFreeAt ?? 0) > this.t) continue;
      out.push(p);
      if (out.length >= n) break;
    }
    return out;
  }

  // Somewhere near (x, z) the squad cannot see from up close: reinforcements walk in, they do not appear in faces.
  _spawnSpot(x, z) {
    const sim = this.sim;
    const seen = (px, pz) => sim.players.some(q => q.team === 0 && q.alive && !q.ai && dist(q.ps.x, q.ps.z, px, pz) < 16);
    if (!seen(x, z)) return { x, z };
    const a0 = sim.rng() * Math.PI * 2;
    for (let k = 0; k < 12; k++) {
      const a = a0 + k * 0.52, d = 20 + (k % 3) * 6, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!(sim.nav ? sim.nav.isWalkable(px, pz) : openAt(sim.map, px, pz, 0.6))) continue;
      if (!seen(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }

  _spawnGroup(def, stepI) {
    const sim = this.sim;
    const base = def.fixed ? def.n : Math.max(1, Math.round(def.n * this.D.count));
    const n = base + Math.max(0, Math.round((def.escorts ?? 0) * (def.fixed ? Math.min(1.2, this.D.count) : 1)));
    const home = this._pt(def.at);
    const g = {
      id: this.gid++, role: def.role, step: stepI, x: home.x, z: home.z, home, members: [], wp: 0, state: def.role === 'assault' || def.role === 'boss' ? 'alert' : 'calm',
      alertX: home.x, alertZ: home.z, alertT: -99, stealth: !!def.stealth && !this.alarm, name: def.name ?? null,
      route: (def.route ?? []).map(r => this._pt(r)), look: 0,
    };
    const seats = this._freeSeats(n);
    if (!seats.length) return null;
    const at = def.role === 'assault' ? this._spawnSpot(home.x, home.z) : home;
    seats.forEach((p, k) => {
      const lead = k === 0 && (def.role === 'target' || def.role === 'boss');
      this._dress(p, def.role, k, lead, def);
      p.cpGroup = g;
      p.cpSee = 0;
      const a = k * 2.4, d = k ? 1.6 + k * 0.5 : 0;
      const spot = openNear(sim.map, at.x + Math.cos(a) * d, at.z + Math.sin(a) * d, 0.5, 10);
      sim._placeAt(p, spot, sim.rng() * Math.PI * 2);
      p.spawnProtect = 0;
      if (p.bot) { p.bot.S = skillOf(p); p.bot.interval = 1 / p.bot.S.thinkHz; }
      g.members.push(p);
      if (lead && def.role === 'target') {
        p.cpTarget = true;
        this.target = { p, g, route: g.route, home, wp: 0, moving: false, holdT: 0, started: false };
        this.pingT = 2;
      }
      if (lead && def.role === 'boss') {
        const max = this._bossMax(), saved = this.cpBoss;
        this.boss = { p, g, pool: saved ? Math.min(max, saved[1]) : max, max, phase: saved ? saved[0] : 0, inv: 0, atk: 5, n: 0 };
      }
      this._sight(p);
    });
    this.groups.push(g);
    if (g.state === 'alert') this._alert(g, g.alertX, g.alertZ);
    return g;
  }

  _dress(p, role, k, lead, def) {
    const pool = GUNS[role] ?? GUNS.guard;
    const primary = lead && def.commander ? 'lmg' : pool[(p.index * 5 + k * 3 + this.stepI) % pool.length];
    const D = this.D;
    p.rating = role === 'boss' ? 0.25 + 0.1 * this.diff : Math.min(1, D.rating + (role === 'sniper' ? 0.12 : 0) + (lead ? 0.25 : 0));
    p.skill = p.rating > 0.5 ? 'veteran' : p.rating > 0.2 ? 'regular' : 'recruit';
    p.cpTake = lead && role === 'target' ? D.take * (def.commander ? 0.45 : 0.6) : D.take;
    p.cpDeal = role === 'boss' ? 0.22 + 0.05 * this.diff : D.deal * (role === 'sniper' ? 1.15 : lead ? 1.2 : 1);
    p.cpNades = role === 'assault' && this.diff > 0 && k === 0 ? 1 : 0;
    p.cpTarget = false;
    p.name = lead && def.name ? def.name : role === 'sniper' ? 'Marksman' : 'Meridian';
    p.pendingLoadout = normalizeLoadout({
      primary, secondary: 'pistol', camo: 'none', attachments: { [primary]: botAttachments(primary, p.skill, p.index) },
      perks: role === 'boss' ? ['flak', 'fasthands', 'tracker'] : ['marathon', 'fasthands', 'tracker'], tactical: 'flash', lethal: 'frag',
      streaks: [], operator: lead && (def.commander || role === 'boss') ? 'marshal' : OPS[role] ?? 'ghoul',
    });
    p.hp = MAX_HP;
  }

  _alert(g, x, z) {
    g.alertX = x; g.alertZ = z; g.alertT = this.t;
    if (g.state !== 'alert') {
      g.state = 'alert';
      for (const q of g.members) if (q.bot) { q.bot.calm = false; q.bot.thinkT = Math.min(q.bot.thinkT, 0.1); }
    }
  }

  _walk(x, z) {
    const nav = this.sim.nav, W = this.sim.map.width, H = this.sim.map.height;
    x = Math.max(3, Math.min(W - 3, x)); z = Math.max(3, Math.min(H - 3, z));
    if (nav && !nav.isWalkable(x, z)) { const k = nav.nearestFree(x, z); x = k % nav.w + 0.5; z = Math.floor(k / nav.w) + 0.5; }
    return { x, z };
  }

  _nearestSquad(x, z) {
    let best = null, bd = Infinity;
    for (const q of this.sim.players) {
      if (q.team !== 0 || !q.alive || q.away) continue;
      const d = dist(q.ps.x, q.ps.z, x, z) + (q.downed ? 6 : 0);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  // Where an assault group heads: the objective it is there to stop, else the nearest of the squad.
  _assaultGoal(g) {
    const s = this.cur, G = this.geo(this.stepI);
    const lead = g.members[0];
    const sq = lead ? this._nearestSquad(lead.ps.x, lead.ps.z) : null;
    if (sq && lead && dist(sq.ps.x, sq.ps.z, lead.ps.x, lead.ps.z) < 22) return { x: sq.ps.x, z: sq.ps.z, r: 3 };
    if (s?.type === 'hack' || s?.type === 'defend') return { x: G.at.x, z: G.at.z, r: (s.r ?? 6) * 0.7 };
    if (s?.type === 'plant') {
      const on = this.sites.filter(x => x.state === 1);
      if (on.length && lead) {
        on.sort((a, b) => dist(a.x, a.z, lead.ps.x, lead.ps.z) - dist(b.x, b.z, lead.ps.x, lead.ps.z));
        return { x: on[0].x, z: on[0].z, r: 0.7, pull: true };
      }
    }
    const vip = this._vip();
    if (s?.type === 'escort' && vip?.alive) return { x: vip.ps.x, z: vip.ps.z, r: 4 };
    if (sq) return { x: sq.ps.x, z: sq.ps.z, r: 4 };
    return { x: g.x, z: g.z, r: 4 };
  }

  _planGroups() {
    for (const g of this.groups) {
      if (!g.members.length) continue;
      const lead = g.members[0];
      // What the group knows.
      if (!g.stealth) {
        for (const q of g.members) {
          const b = q.bot;
          if (!b) continue;
          if (b.targetVisible && b.target) this._alert(g, b.target.ps.x, b.target.ps.z);
          else if (b.hasKnown && !b.knownSoft && this.t - g.alertT > 2) this._alert(g, b.knownX, b.knownZ);
        }
      }
      if (g.state === 'alert' && g.role !== 'assault' && g.role !== 'boss' && g.role !== 'target' && this.t - g.alertT > CP.alertKeep) {
        g.state = 'calm';
        for (const q of g.members) if (q.bot) q.bot.calm = true;
      }
      g.members.forEach((q, k) => {
        const b = q.bot;
        if (!b || !q.alive) return;
        if (q.id === 'cp-vip') return;
        b.calm = g.state === 'calm';
        if (g.role === 'target') { this._orderTarget(g, q, k); return; }
        if (g.role === 'boss') {
          const sq = this._nearestSquad(g.home.x, g.home.z);
          const at = sq && dist(sq.ps.x, sq.ps.z, g.home.x, g.home.z) < 24 ? sq.ps : g.home;
          const w = this._walk(at.x, at.z);
          b.setObjective({ key: `cb${Math.round(w.x / 5)}:${Math.round(w.z / 5)}`, role: 'attack', x: w.x, z: w.z, r: 6 });
          return;
        }
        if (g.role === 'assault') {
          const goal = this._assaultGoal(g);
          const a = k * 2.1, w = goal.pull ? goal : this._walk(goal.x + Math.cos(a) * goal.r, goal.z + Math.sin(a) * goal.r);
          b.setObjective({ key: `ca${g.id}:${Math.round(w.x / 4)}:${Math.round(w.z / 4)}`, role: goal.pull ? 'defend' : 'attack', x: w.x, z: w.z, r: goal.pull ? 0.7 : 3 });
          return;
        }
        if (g.role === 'sniper') { b.setObjective({ key: `cs${g.id}`, role: 'defend', x: g.x, z: g.z, r: 1.2, aim: this._lookFor(g, q) }); return; }
        if (g.state === 'alert') {
          if (b.targetVisible) return;
          let ex = g.alertX, ez = g.alertZ;
          const dh = dist(ex, ez, g.x, g.z);
          if (dh > CP.leash) { ex = g.x + (ex - g.x) / dh * CP.leash; ez = g.z + (ez - g.z) / dh * CP.leash; }
          const a = k * 2.1, w = this._walk(ex + Math.cos(a) * 3, ez + Math.sin(a) * 3);
          b.setObjective({ key: `cg${g.id}:${Math.round(w.x / 4)}:${Math.round(w.z / 4)}`, role: 'collect', x: w.x, z: w.z, r: 2 });
          return;
        }
        if (g.role === 'patrol' && g.route.length) {
          let wp = g.route[g.wp % g.route.length];
          if (q === lead && dist(wp.x, wp.z, q.ps.x, q.ps.z) < 3) { g.wp++; wp = g.route[g.wp % g.route.length]; }
          const tx = q === lead ? wp.x : lead.ps.x - Math.cos(lead.ps.aim) * 2.2 * k, tz = q === lead ? wp.z : lead.ps.z - Math.sin(lead.ps.aim) * 2.2 * k;
          const w = this._walk(tx, tz);
          b.setObjective({ key: `cp${g.id}:${q === lead ? g.wp : Math.round(w.x / 5) + ':' + Math.round(w.z / 5)}`, role: 'collect', x: w.x, z: w.z, r: 1.5 });
          return;
        }
        // A post: spread round the spot, each looking its own way, turning now and then.
        const a = k * 2.4 + 0.6, w = this._walk(g.x + Math.cos(a) * (k ? 2.5 : 0), g.z + Math.sin(a) * (k ? 2.5 : 0));
        b.setObjective({ key: `cd${g.id}:${k}`, role: 'defend', x: w.x, z: w.z, r: 1.2, aim: this._lookFor(g, q, k) });
      });
    }
  }

  // A guard's watch direction: its own sector, turned every few seconds (a stealth guard's torch sweeps).
  _lookFor(g, q, k = 0) {
    const turn = Math.floor((this.t + k * 1.7 + g.id) / (g.stealth ? 3.2 : 5));
    const base = Math.atan2(this.sim.map.height / 2 - g.z, this.sim.map.width / 2 - g.x);
    return base + k * 2.1 + ((turn % 4) - 1.5) * 0.7;
  }

  _orderTarget(g, q, k) {
    const T = this.target, b = q.bot;
    const lead = g.members[0];
    if (q.cpTarget && T) {
      if (T.moving && T.route[T.wp]) {
        const w = T.route[T.wp];
        b.calm = false;
        b.setObjective({ key: `ct${T.wp}`, role: 'collect', x: w.x, z: w.z, r: 1.5 });
      } else b.setObjective({ key: `ch${T.wp}:${T.started ? 1 : 0}`, role: 'defend', x: q.ps.x, z: q.ps.z, r: 2 });
      return;
    }
    // Minders: close behind him; with him gone (or a commander's guard), a post.
    if (lead?.cpTarget && lead.alive) {
      const a = lead.ps.aim + Math.PI + (k % 2 ? 0.7 : -0.7), w = this._walk(lead.ps.x + Math.cos(a) * 2.5, lead.ps.z + Math.sin(a) * 2.5);
      b.setObjective({ key: `cm${g.id}:${Math.round(w.x / 3)}:${Math.round(w.z / 3)}`, role: 'collect', x: w.x, z: w.z, r: 1.5 });
    } else {
      const sq = this._nearestSquad(q.ps.x, q.ps.z);
      const at = sq && dist(sq.ps.x, sq.ps.z, g.x, g.z) < CP.leash ? sq.ps : g;
      const w = this._walk(at.x, at.z);
      b.setObjective({ key: `cx${g.id}:${Math.round(w.x / 4)}:${Math.round(w.z / 4)}`, role: 'attack', x: w.x, z: w.z, r: 3 });
    }
  }

  // ---- The squad's bots ----

  _planSquad() {
    const sim = this.sim, s = this.cur, G = this.geo(this.stepI);
    if (!s) return;
    const squad = this._squad(), bots = squad.filter(p => p.isBot && p.bot && p.alive && !p.downed);
    if (!bots.length) return;
    const humans = squad.filter(p => !p.isBot && this._up(p));
    const taken = new Set();
    // Downed squadmates first: the nearest bot within 40 m goes to pick them up.
    for (const d of squad) {
      if (!d.alive || !d.downed) continue;
      let best = null, bd = 40;
      for (const b of bots) { if (taken.has(b)) continue; const dd = dist(b.ps.x, b.ps.z, d.ps.x, d.ps.z); if (dd < bd) { bd = dd; best = b; } }
      if (best) { taken.add(best); best.bot.setObjective({ key: `rv${d.index}`, role: 'defend', x: d.ps.x, z: d.ps.z, r: 0.8, commit: bd < 10 }); }
    }
    // Out of the boss's rings and off his charge line.
    for (const b of bots) {
      if (taken.has(b)) continue;
      const out = this._dodge(b);
      if (out) { taken.add(b); b.bot.setObjective({ key: `dg${Math.round(out.x)}:${Math.round(out.z)}`, role: 'collect', x: out.x, z: out.z, r: 0.5 }); }
    }
    const free = bots.filter(b => !taken.has(b));
    const lead = humans[0] ?? null;
    let i = 0;
    for (const b of free) {
      const k = i++;
      let o = this._squadOrder(b, k, free.length, s, G);
      // With a human in the squad, bots stay with them when the objective is far from where they are.
      if (lead && o && dist(lead.ps.x, lead.ps.z, o.x, o.z) > 32 && dist(lead.ps.x, lead.ps.z, b.ps.x, b.ps.z) > 14) {
        const a = lead.ps.aim + Math.PI + (k - 1) * 0.8, w = this._walk(lead.ps.x + Math.cos(a) * 4, lead.ps.z + Math.sin(a) * 4);
        o = { key: `fl${Math.round(w.x / 4)}:${Math.round(w.z / 4)}`, role: 'collect', x: w.x, z: w.z, r: 2 };
      }
      if (o) b.bot.setObjective(o);
    }
    void sim;
  }

  _squadOrder(b, k, n, s, G) {
    const ring = (x, z, r, role = 'defend', key = 'o') => {
      const a = k / Math.max(1, n) * Math.PI * 2 + this.stepI, w = this._walk(x + Math.cos(a) * r, z + Math.sin(a) * r);
      return { key: `${key}${this.stepI}:${Math.round(w.x)}:${Math.round(w.z)}`, role, x: w.x, z: w.z, r: Math.max(1, r * 0.5) };
    };
    switch (s.type) {
      case 'goto': case 'extract': return ring(G.at.x, G.at.z, Math.min(3, (s.r ?? 5) * 0.4), 'collect', 'g');
      case 'hack': case 'defend': return ring(G.at.x, G.at.z, (s.r ?? 6) * 0.55, 'defend', 'h');
      case 'plant': {
        const open = this.sites.filter(x => x.state === 0);
        if (open.length) {
          // The nearest bot to each open site sets it; the others cover the nearest one.
          const mine = open[k % open.length];
          if (k < open.length) return { key: `pl${this.stepI}:${mine.i}`, role: 'defend', x: mine.x, z: mine.z, r: 0.7, commit: dist(b.ps.x, b.ps.z, mine.x, mine.z) < 10 };
          return ring(mine.x, mine.z, 4, 'defend', 'pc');
        }
        const on = this.sites[k % this.sites.length];
        return on ? ring(on.x, on.z, 2.5, 'defend', 'pd') : null;
      }
      case 'escort': {
        const vip = this._vip(), goal = G.route[this.gate];
        if (!vip?.alive || !goal) return null;
        const a = Math.atan2(goal.z - vip.ps.z, goal.x - vip.ps.x), ahead = k === 0 ? 7 : k === 1 ? 3 : -3, side = (k % 2 ? 1 : -1) * 2.5;
        const w = this._walk(vip.ps.x + Math.cos(a) * ahead - Math.sin(a) * side, vip.ps.z + Math.sin(a) * ahead + Math.cos(a) * side);
        return { key: `es${Math.round(w.x / 3)}:${Math.round(w.z / 3)}`, role: 'collect', x: w.x, z: w.z, r: 1.5 };
      }
      case 'chase': {
        const goal = G.route[this.gate];
        return goal ? ring(goal.x, goal.z, 3, 'collect', 'c') : null;
      }
      case 'kill': case 'pursue': {
        const T = this.target;
        if (T?.p?.alive) {
          const x = T.p.ps.x, z = T.p.ps.z;
          const w = this._walk(x + Math.cos(k * 1.6) * 4, z + Math.sin(k * 1.6) * 4);
          return { key: `kt${Math.round(w.x / 5)}:${Math.round(w.z / 5)}`, role: 'attack', x: w.x, z: w.z, r: 3 };
        }
        return null;
      }
      case 'boss': {
        const B = this.boss;
        if (!B?.p?.alive) return ring(G.at.x, G.at.z, 12, 'attack', 'b');
        return ring(B.p.ps.x, B.p.ps.z, 13 + (k % 2) * 4, 'attack', 'b');
      }
    }
    return null;
  }

  _dodge(p) {
    for (const h of this.hazards) {
      if (h.k === 0) {
        const d = dist(p.ps.x, p.ps.z, h.x, h.z);
        if (d < h.r + 0.8) {
          const a = d > 0.1 ? Math.atan2(p.ps.z - h.z, p.ps.x - h.x) : 0;
          return this._walk(h.x + Math.cos(a) * (h.r + 2.2), h.z + Math.sin(a) * (h.r + 2.2));
        }
      } else {
        const dx = h.x2 - h.x, dz = h.z2 - h.z, L = hyp(dx, dz) || 1, ux = dx / L, uz = dz / L;
        const px = p.ps.x - h.x, pz = p.ps.z - h.z, along = px * ux + pz * uz, off = -px * uz + pz * ux;
        if (along > -1 && along < L + 1 && Math.abs(off) < h.r + 1) {
          const side = off >= 0 ? 1 : -1;
          return this._walk(p.ps.x - uz * side * (h.r + 2.5 - Math.abs(off)), p.ps.z + ux * side * (h.r + 2.5 - Math.abs(off)));
        }
      }
    }
    return null;
  }

  // Bots the rules drive this tick: the downed crawl to a squadmate, the VIP walks the route, the boss runs a charge.
  driveBot(p, dt) {
    const sim = this.sim;
    if (p.id === 'cp-vip') { this._driveVip(p, dt); return true; }
    if (this.boss && p === this.boss.p && (this.charge || this.boss.inv > 0)) {
      const I = this._in();
      I.aim = this.charge ? this.charge.a : p.ps.aim;
      if (!this.charge?.go) stepPlayer(p.ps, I, dt, sim.map, sim.rng);
      return true;
    }
    if (!p.downed) return false;
    let best = null, bd = 40;
    for (const q of sim.players) {
      if (q === p || q.team !== 0 || q.ai || !this._up(q)) continue;
      const d = dist(q.ps.x, q.ps.z, p.ps.x, p.ps.z);
      if (d < bd) { bd = d; best = q; }
    }
    const I = this._in();
    I.aim = p.ps.aim;
    if (best && bd > 1.4) {
      const dx = best.ps.x - p.ps.x, dz = best.ps.z - p.ps.z;
      if (sim.nav.isWalkable(p.ps.x + dx / bd, p.ps.z + dz / bd)) { I.mx = dx / bd; I.mz = dz / bd; I.aim = Math.atan2(dz, dx); }
    }
    downedInput(I);
    stepPlayer(p.ps, I, dt, sim.map, sim.rng);
    return true;
  }

  _in() {
    const I = this._input ??= { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 };
    I.mx = 0; I.mz = 0; I.fire = false; I.sprint = false; I.slide = false; I.aiming = false; I.swap = false; I.tactical = false; I.lethal = false; I.streak = -1;
    return I;
  }

  _driveVip(p, dt) {
    const sim = this.sim, I = this._in();
    I.aim = p.ps.aim;
    const G = this.geo(this.stepI), goal = this.cur?.type === 'escort' ? G?.route[this.gate] : null;
    if (goal && this.vipMoving && sim.nav) {
      if (!this.vipPath || this.vipPathT === undefined || this.t - this.vipPathT > 4) {
        const out = new Float32Array(128), n = sim.nav.findPath(p.ps.x, p.ps.z, goal.x, goal.z, out, 64);
        this.vipPath = n ? Array.from(out.slice(0, n * 2)) : [goal.x, goal.z];
        this.vipPi = 0; this.vipPathT = this.t;
      }
      let tx = goal.x, tz = goal.z;
      while (this.vipPi < this.vipPath.length) {
        tx = this.vipPath[this.vipPi]; tz = this.vipPath[this.vipPi + 1];
        if (dist(tx, tz, p.ps.x, p.ps.z) < 0.8 && this.vipPi + 2 < this.vipPath.length) this.vipPi += 2; else break;
      }
      const dx = tx - p.ps.x, dz = tz - p.ps.z, d = hyp(dx, dz);
      if (d > 0.2) { I.mx = dx / d * 0.45; I.mz = dz / d * 0.45; I.aim = Math.atan2(dz, dx); }
    }
    stepPlayer(p.ps, I, dt, sim.map, sim.rng);
  }

  // ---- Commands ----

  command(p, msg) {
    if (!p || p.isBot || p.team !== 0) return false;
    if (msg.act === 'abort' && (this.state === 2 || this.state === 1)) { this.why = this.state === 1 ? 5 : this.why; this.sim._end(null); return true; }
    if (msg.act === 'retry' && this.state === 2 && this.stateT > 1.5) { this._retry(); return true; }
    return false;
  }

  // ---- The view ----

  playerView(p, v) {
    v.ai = !!p.ai;
    v.downed = !!p.downed;
    v.reviveK = p.downed ? (p.cp?.reviveT ?? 0) / CP.reviveTime : 0;
    v.cpSee = p.cpGroup?.stealth && p.alive ? (p.cpSee ?? 0) : -1;
    v.cpRole = p.cpGroup ? ROLES.indexOf(p.cpGroup.role) : -1;
    v.cpTarget = !!p.cpTarget;
    if (this.boss && p === this.boss.p) v.armor = 200;
  }

  view() {
    const V = this.V, G = this.geo(this.stepI);
    V.k = this.k; V.id = this.m.id; V.diff = this.diff; V.mission = this.m;
    V.state = STATES[this.state]; V.stateT = this.stateT; V.t = this.t;
    V.stepI = this.stepI; V.step = this.cur; V.prog = this.prog; V.timer = this.timer; V.gate = this.gate; V.lost = this.lost;
    V.at = G?.at ?? null; V.route = G?.route ?? []; V.sites = this.sites; V.fuse = this.fuseT; V.contested = !!this.contested;
    V.cpAt = this.cpAt; V.alarm = !!this.alarm; V.stealth = this._stealthOn(); V.bonusOk = this.bonusOk;
    V.fails = this.fails; V.deaths = this.deaths; V.why = FAILS[this.why] ?? null;
    V.night = this.night; V.flareT = this.flareT; V.freed = this.freed; V.hostage = !!this.m.hostage && !this.freed && this.execT > 0;
    V.hazards = this.hazards; V.ping = this.ping; V.killAt = this.killAt;
    V.boss = this.boss ? { idx: this.boss.p.index, frac: Math.max(0, this.boss.pool / this.boss.max), phase: this.boss.phase, inv: this.boss.inv > 0 } : null;
    V.target = this.target?.p?.alive ? { idx: this.target.p.index, wp: this.target.wp, moving: !!this.target.moving, hold: this.target.holdT ?? 0 } : null;
    const vip = this._vip();
    V.vip = vip && vip.alive ? { idx: vip.index, hp: vip.hp, min: this.vipMin, moving: !!this.vipMoving } : null;
    V.stats = this.sim.players.map(p => (p.cp && p.team === 0 && !p.ai ? p.cp.revives : 0));
    return V;
  }

  _dirty() { this.ver = (this.ver ?? 0) + 1; }

  // [t, state | alarm << 2 | bonus << 3, stepI, prog, timer, gate, lost, stateT, cp at, fails, deaths, why,
  //  sites [state, prog, def], fuse, hazards, boss, target, vip, ping, kill spot, per-player (down, revive, see),
  //  revives, backup]
  encode() {
    const sim = this.sim;
    const per = [];
    for (const p of sim.players) {
      const see = p.cpGroup?.stealth && p.alive ? Math.round((p.cpSee ?? 0) * 100) + 1 : 0;
      per.push((p.downed ? 1 : 0) | (Math.min(15, Math.round((p.downed ? p.cp.reviveT / CP.reviveTime : 0) * 15)) << 1) | (see << 5) | ((p.cpGroup ? ROLES.indexOf(p.cpGroup.role) + 1 : 0) << 12) | (p.cpTarget ? 1 << 15 : 0));
    }
    const B = this.boss, T = this.target, vip = this._vip();
    this._enc = ((this._enc ?? 0) + 1) % (BACKUP_EVERY / 2);
    this._bk = this._enc === 0 ? this.backup() : 0;
    return this._lastBlock = [r1(this.t), this.state | (this.alarm ? 4 : 0) | (this.bonusOk ? 8 : 0) | (this.contested ? 16 : 0) | (this.vipMoving ? 32 : 0)
      | (Math.min(127, Math.round(this.flareT * 10)) << 6) | (this.execT > 0 ? 1 << 13 : 0), this.stepI,
      Math.round(this.prog * 1000), r1(this.timer), this.gate, Math.round(this.lost * 100), r1(this.stateT),
      this.cpAt ? [r1(this.cpAt.x), r1(this.cpAt.z)] : 0, this.fails, this.deaths, this.why,
      this.sites.map(s => s.state | (Math.round(s.prog * 100) << 1) | (Math.round(s.def * 100) << 8)), r1(this.fuseT),
      this.hazards.flatMap(h => [h.k, r1(h.x), r1(h.z), r1(h.x2), r1(h.z2), r1(h.r), r1(h.t), r1(h.w)]),
      B?.p?.alive ? [B.p.index, Math.round(B.pool / B.max * 1000), B.phase, B.inv > 0 ? 1 : 0] : 0,
      T?.p?.alive ? [T.p.index, T.wp, T.moving ? 1 : 0, r1(T.holdT)] : 0,
      vip?.alive ? [vip.index, Math.round(this.vipMin)] : 0,
      this.ping ? [r1(this.ping.x), r1(this.ping.z)] : 0, this.killAt ? [r1(this.killAt.x), r1(this.killAt.z)] : 0,
      per, sim.players.map(p => p.cp?.revives ?? 0), this._bk];
  }

  encodeFor(g) {
    const b = this._lastBlock ?? this.encode();
    return g.isBot ? [...b.slice(0, -1), 0] : b;
  }

  decode(a, out, host) {
    const sim = this.sim;
    if (host || this.authority) {
      for (let i = 0; i < out.players.length && i < sim.players.length; i++) this.playerView(sim.players[i], out.players[i]);
      return this.view();
    }
    if (a) {
      const [t, flags, stepI, prog, timer, gate, lost, stateT, cpAt, fails, deaths, why, sites, fuse, haz, boss, target, vip, ping, killAt, per, revives, backup] = a;
      this.t = t / 10;
      this.state = flags & 3; this.alarm = flags & 4 ? 1 : 0; this.bonusOk = !!(flags & 8); this.contested = !!(flags & 16); this.vipMoving = !!(flags & 32);
      this.flareT = ((flags >> 6) & 127) / 10; this.execT = flags & (1 << 13) ? Math.max(0.1, timer / 10) : 0;
      if (killAt) this.killAt = { x: killAt[0] / 10, z: killAt[1] / 10 }; else this.killAt = null;
      if (stepI !== this.stepI) { this.stepI = stepI; this.sites = this.geo(stepI)?.sites.map((p, k) => ({ i: k, x: p.x, z: p.z, state: 0, prog: 0, def: 0 })) ?? []; }
      this.prog = prog / 1000; this.timer = timer / 10; this.gate = gate; this.lost = lost / 100; this.stateT = stateT / 10;
      this.cpAt = cpAt ? { x: cpAt[0] / 10, z: cpAt[1] / 10 } : this.cpAt;
      this.fails = fails; this.deaths = deaths; this.why = why;
      (sites || []).forEach((n, k) => { const s = this.sites[k]; if (s) { s.state = n & 1; s.prog = ((n >> 1) & 127) / 100; s.def = ((n >> 8) & 127) / 100; } });
      this.fuseT = fuse / 10;
      this.hazards = [];
      for (let i = 0; i + 7 < (haz?.length ?? 0); i += 8) this.hazards.push({ k: haz[i], x: haz[i + 1] / 10, z: haz[i + 2] / 10, x2: haz[i + 3] / 10, z2: haz[i + 4] / 10, r: haz[i + 5] / 10, t: haz[i + 6] / 10, w: haz[i + 7] / 10 });
      this._mBoss = boss ? { idx: boss[0], frac: boss[1] / 1000, phase: boss[2], inv: !!boss[3] } : null;
      this._mTarget = target ? { idx: target[0], wp: target[1], moving: !!target[2], hold: target[3] / 10 } : null;
      this._mVip = vip ? { idx: vip[0], min: vip[1] } : null;
      if (vip) this.vipMin = vip[1];
      this.ping = ping ? { x: ping[0] / 10, z: ping[1] / 10 } : null;
      this._per = per || [];
      this._rev = revives || [];
      if (backup) this.saved = backup;
    }
    const per = this._per ?? [];
    for (let i = 0; i < out.players.length; i++) {
      const v = out.players[i], n = per[i] ?? 0, p = sim.players[i];
      v.ai = !!p?.ai;
      v.downed = !!(n & 1); v.reviveK = ((n >> 1) & 15) / 15;
      const see = (n >> 5) & 127;
      v.cpSee = see ? (see - 1) / 100 : -1;
      v.cpRole = ((n >> 12) & 7) - 1; v.cpTarget = !!(n & (1 << 15));
      if (this._mBoss && i === this._mBoss.idx) v.armor = 200;
    }
    const V = this.view();
    V.boss = this._mBoss ? { ...this._mBoss } : null;
    V.target = this._mTarget;
    const vp = this._mVip ? out.players[this._mVip.idx] : null;
    V.vip = this._mVip ? { idx: this._mVip.idx, hp: vp?.hp ?? 100, min: this._mVip.min, moving: this.vipMoving } : null;
    V.stats = this._rev ?? [];
    return V;
  }

  // ---- Host migration ----

  // What only the host knows: the Line's groups and their seats, trigger bits, the checkpoint's gate and timer, the
  // boss's pool and clocks, the target's stop, per-seat toughness.
  backup() {
    const sim = this.sim, B = this.boss, T = this.target;
    const groups = this.groups.filter(g => g.members.length).map(g => [g.id, ROLES.indexOf(g.role), g.step, r1(g.x), r1(g.z), g.members.map(q => q.index), g.wp, g.state === 'alert' ? 1 : 0,
      r1(g.alertX), r1(g.alertZ), Math.round(g.alertT), g.stealth ? 1 : 0, g.route.flatMap(w => [r1(w.x), r1(w.z)]), g.name ?? 0]);
    const ai = sim.players.map(p => (p.ai && p.alive ? [Math.round((p.cpTake ?? 1) * 100), Math.round((p.cpDeal ?? 1) * 100), Math.round((p.rating ?? 0.2) * 100)] : 0));
    return [this.gid, this.fired, this.stepT * 10 | 0, this.cpStep, this.cpGate, r1(this.cpTimer), this.cpAlarm, r1(this.alarmT), this.alarmLater ? 1 : 0, groups, ai,
      B ? [Math.round(B.pool), Math.round(B.max), r1(B.atk), B.n ?? 0] : 0, T ? [r1(T.holdT), T.started ? 1 : 0, r1(T.home.x), r1(T.home.z)] : 0, r1(this.pingT), this.hold * 10 | 0, this.cpBoss ?? 0, r1(this.cpStepT ?? 0)];
  }

  restore(view) {
    const sim = this.sim, obj = view.obj ?? view.points?.obj, old = obj?.rules ?? null;
    this.authority = true;
    if (old && old !== this) {
      Object.assign(this, { t: old.t, state: old.state, stateT: old.stateT, stepI: old.stepI, prog: old.prog, timer: old.timer, gate: old.gate, lost: old.lost,
        cpAt: old.cpAt, fails: old.fails, deaths: old.deaths, why: old.why, alarm: old.alarm, bonusOk: old.bonusOk, killAt: old.killAt, ping: old.ping, vipMin: old.vipMin,
        flareT: old.flareT ?? 0, execT: old.execT ?? 0, freed: old.m.steps.slice(0, old.stepI).some(x => x.hostage) });
      this.sites = old.sites.map(s => ({ ...s }));
      this.fuseT = old.fuseT;
      this.hazards = old.hazards.map(h => ({ ...h, live: h.k === 0 }));
    }
    const bk = old?.saved ?? null;
    sim.players.forEach((p, i) => {
      const v = view.players[i];
      p.cp ??= { reviveT: 0, downedBy: null, revives: 0 };
      p.cp.revives = old?._rev?.[i] ?? p.cp.revives;
      if (p.team === 0 && !p.ai) {
        p.downed = !!v?.downed && p.alive;
        p.cp.reviveT = p.downed ? (v.reviveK ?? 0) * CP.reviveTime : 0;
      }
      if (p.ai) { p.cpGroup = null; p.cpFreeAt = 0; p.cpTarget = false; }
    });
    this.groups = [];
    if (bk) {
      const [gid, fired, stepT, cpStep, cpGate, cpTimer, cpAlarm, alarmT, alarmLater, groups, ai, boss, target, pingT, hold, cpBoss, cpStepT] = bk;
      this.cpStepT = (cpStepT ?? 0) / 10;
      Object.assign(this, { gid, fired, stepT: stepT / 10, cpStep, cpGate, cpTimer: cpTimer / 10, cpAlarm, alarmT: alarmT / 10, alarmLater: !!alarmLater, pingT: pingT / 10, hold: hold / 10, cpBoss: cpBoss || null });
      ai.forEach((e, i) => { const p = sim.players[i]; if (p && e) { p.cpTake = e[0] / 100; p.cpDeal = e[1] / 100; p.rating = e[2] / 100; } });
      for (const e of groups) {
        const home = { x: e[3] / 10, z: e[4] / 10 }, route = [];
        for (let k = 0; k + 1 < e[12].length; k += 2) route.push({ x: e[12][k] / 10, z: e[12][k + 1] / 10 });
        const g = { id: e[0], role: ROLES[e[1]], step: e[2], x: home.x, z: home.z, home, members: [], wp: e[6], state: e[7] ? 'alert' : 'calm',
          alertX: e[8] / 10, alertZ: e[9] / 10, alertT: e[10], stealth: !!e[11], name: e[13] || null, route, look: 0 };
        for (const idx of e[5]) { const q = sim.players[idx]; if (q?.ai && q.alive) { q.cpGroup = g; g.members.push(q); } }
        this.groups.push(g);
      }
      const bi = old?._mBoss?.idx;
      if (boss && bi !== undefined && sim.players[bi]?.alive) {
        const p = sim.players[bi];
        // Health from the snapshot itself (every one carries it), not from the backup, which can be seconds old.
        const pool = old._mBoss.frac != null ? old._mBoss.frac * boss[1] : boss[0];
        this.boss = { p, g: p.cpGroup, pool, max: boss[1], phase: old._mBoss.phase, inv: 0, atk: boss[2] / 10, n: boss[3] };
      }
      const ti = old?._mTarget?.idx;
      if (target && ti !== undefined && sim.players[ti]?.alive) {
        const p = sim.players[ti];
        p.cpTarget = true;
        const g = p.cpGroup;
        this.target = { p, g, route: g?.route ?? [], home: { x: target[2] / 10, z: target[3] / 10 }, wp: old._mTarget.wp, moving: old._mTarget.moving, holdT: target[0] / 10, started: !!target[1] };
      }
    }
    // Living Line soldiers nobody claimed (a backup a moment old): one group that hunts the squad.
    const loose = sim.players.filter(p => p.ai && p.team === CP.team && p.alive && !p.cpGroup);
    if (loose.length) {
      const g = { id: this.gid++, role: 'assault', step: this.stepI, x: loose[0].ps.x, z: loose[0].ps.z, home: { x: loose[0].ps.x, z: loose[0].ps.z }, members: loose, wp: 0, state: 'alert',
        alertX: loose[0].ps.x, alertZ: loose[0].ps.z, alertT: this.t, stealth: false, name: null, route: [], look: 0 };
      for (const q of loose) q.cpGroup = g;
      this.groups.push(g);
    }
    if (!this.boss && old?._mBoss && sim.players[old._mBoss.idx]?.alive) {
      const p = sim.players[old._mBoss.idx], max = this._bossMax();
      this.boss = { p, g: p.cpGroup, pool: old._mBoss.frac * max, max, phase: old._mBoss.phase, inv: 0, atk: 4, n: 0 };
    }
    for (const p of sim.players) if (p.bot && p.alive) this._sight(p);
    this._dirty();
  }
}

export { STATES as CP_STATES, FAILS as CP_FAILS, ROLES as CP_ROLES };
