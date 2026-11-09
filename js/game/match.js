// Runs one match on this device. Each human simulates their own player every render frame
// (see docs/ARCHITECTURE.md); the host additionally runs bots, damage and scoring.

import { MAPS } from '../shared/map.js';
import { SIM_HZ, SNAPSHOT_EVERY, STATE_SEND_HZ, INTERP_DELAY } from '../shared/constants.js';
import {
  createPlayerState, respawnPlayer, stepPlayer, traceShot, applyAimAssist,
  encodeHumanState, decodeHumanState,
} from '../sim/player.js';
import { Sim, scavengeRefill } from '../sim/sim.js';
import { Interpolator } from './interp.js';
import { MatchAwards } from './awards.js';

const STEP = 1 / SIM_HZ;
const MAX_FRAME = 0.1;
const MAX_CATCHUP_STEPS = 4;
const END_HOLD = 4.5;              // Seconds of final-kill replay before the results screen.

export class Match {
  constructor(config) {
    Object.assign(this, config);   // canvas, mapId, seed, limits, roster, ids, net, controls, hud, renderer, audio, onEnd
    this.map = MAPS[this.mapId];
    this.me = this.roster.find(r => r.id === this.localId);
    this.ps = createPlayerState({ id: this.localId, primary: this.me.primary, camo: this.me.camo, loadout: this.me.loadout });
    this.nextLoadout = null;
    this.running = false;
    this.spawned = false;
    this.localAlive = false;
    this.lastSpawnAt = -10;
    this.accum = 0;
    this.tick = 0;
    this.sendAccum = 0;
    this.lastAim = 0;
    this.endTimer = -1;
    this.rng = Math.random;
    this.frameEvents = [];
    this.resolvedInput = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 };

    // Guests build a Sim too, purely as the snapshot codec; only the host ever steps it.
    this.sim = new Sim({
      roster: this.roster, map: this.map, seed: this.seed,
      scoreLimit: this.scoreLimit, timeLimit: this.timeLimit,
    });
    // The host's view is a fresh 30 Hz local copy, so it needs far less smoothing than a 15 Hz network stream.
    this.awards = new MatchAwards({ localId: this.localId, team: this.me.team, loadout: this.me.loadout });
    this.interp = new Interpolator(this.isHost ? STEP * 1.5 : INTERP_DELAY);
    this.frame = this.frame.bind(this);
    this.#wireNet();
  }

  start() {
    this.renderer.setLocal(this.localId);
    this.renderer.vfx.setLoadouts(this.roster);
    this.controls.setEnabled(true);
    this.running = true;
    this.lastTime = performance.now();
    if (this.isHost) {
      this.#pushHostView();
    }
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    this.controls.setEnabled(false);
  }

  // Applied the next time the local player spawns.
  setNextLoadout(loadout) {
    this.nextLoadout = loadout;
    this.#command({ cmd: 'loadout', loadout });
  }

  #wireNet() {
    const net = this.net;
    if (!net) return;
    if (this.isHost) {
      net.onState((peerId, data) => this.sim.applyHumanState(peerId, decodeHumanState(data)));
      net.onShot((peerId, msg) => {
        if (msg.cmd) this.sim.applyCommand(peerId, msg);
        else this.sim.applyShot(peerId, msg, msg.age);
      });
      net.onPeerLeave(peerId => this.sim.humanLeft(peerId));
    } else {
      net.onSnapshot(data => {
        this.interp.push(this.sim.decodeSnapshot(data, this.localId), this.now());
      });
      net.onEvents(events => this.#receiveEvents(events));
    }
  }

  now() {
    return performance.now() / 1000;
  }

  #receiveEvents(events) {
    for (const e of events) {
      // Own shots and overheats were already shown the instant they happened.
      if (e.t === 'shot' && e.by === this.localId) continue;
      if (e.t === 'overheat' && e.id === this.localId) continue;
      if (e.t === 'spawn' && e.id === this.localId) this.#spawnLocal(e.x, e.z, e.aim);
      if (e.t === 'kill' && e.target === this.localId) this.localAlive = false;
      if (e.t === 'scavenge' && e.id === this.localId) scavengeRefill(this.ps);
      this.frameEvents.push(e);
    }
  }

  #spawnLocal(x, z, aim) {
    respawnPlayer(this.ps, x, z, aim, this.nextLoadout || undefined);
    this.spawned = true;
    this.localAlive = true;
    this.lastSpawnAt = this.now();
    this.lastAim = aim;
  }

  #pushHostView() {
    // getView may reuse internal arrays, so snapshots buffered here must be independent copies.
    this.interp.push(this.sim.decodeSnapshot(this.sim.encodeSnapshot(), this.localId), this.now());
  }

  #stepHost(dt) {
    this.accum = Math.min(this.accum + dt, STEP * MAX_CATCHUP_STEPS);
    while (this.accum >= STEP) {
      this.accum -= STEP;
      if (this.spawned && this.localAlive) {
        this.sim.applyHumanState(this.localId, decodeHumanState(encodeHumanState(this.ps)));
      }
      this.sim.step(STEP);
      this.tick++;
      const events = this.sim.drainEvents();
      if (events.length) {
        this.net?.sendEvents(events);
        this.#receiveEvents(events);
      }
      this.#pushHostView();
      if (this.net && this.tick % SNAPSHOT_EVERY === 0) {
        this.net.sendSnapshot(this.sim.encodeSnapshot());
      }
    }
  }

  // Twin-stick facing: aim stick wins; otherwise face the direction of travel.
  #resolveInput(input, view) {
    const r = this.resolvedInput;
    Object.assign(r, input);
    const moving = input.mx * input.mx + input.mz * input.mz > 0.02;
    let aim = this.lastAim;
    if (input.aim !== null && input.aim !== undefined) {
      aim = applyAimAssist(input.aim, this.ps, view.players, this.map, this.dt);
    } else if (moving) {
      aim = Math.atan2(input.mz, input.mx);
    }
    this.lastAim = aim;
    r.aim = aim;
    // Everyone holds position through the warmup countdown, as bots do; aiming stays live.
    if (view.phase === 'warmup') {
      r.mx = 0; r.mz = 0; r.fire = false; r.sprint = false; r.slide = false;
      r.tactical = false; r.lethal = false; r.streak = -1;
    }
    return r;
  }

  #stepLocal(input, view, dt) {
    const shots = stepPlayer(this.ps, this.#resolveInput(input, view), dt, this.map, this.rng);
    for (const shot of shots) {
      const rays = traceShot(shot, this.map, view.players, this.localId);
      this.frameEvents.push({
        t: 'shot', by: this.localId, weapon: shot.weapon, camo: this.ps.camo,
        ox: shot.ox, oz: shot.oz, aim: shot.aim, rays,
      });
      if (this.isHost) {
        this.sim.applyShot(this.localId, shot, this.interp.delay);
      } else {
        // Age tells the host how far to rewind targets to match what this player saw.
        this.net.sendShot({ ...shot, age: INTERP_DELAY + (this.net.rtt ?? 80) / 2000 });
      }
    }
    if (this.ps.overheatEdge) this.frameEvents.push({ t: 'overheat', id: this.localId });
    if (input.streak >= 0) this.#command({ cmd: 'streak', slot: input.streak });
    if (input.tactical) this.#throw('tactical');
    if (input.lethal) this.#throw('lethal');
    if (!this.isHost) {
      this.sendAccum += dt;
      if (this.sendAccum >= 1 / STATE_SEND_HZ) {
        this.sendAccum = 0;
        this.net.sendState(encodeHumanState(this.ps));
      }
    }
  }

  #command(msg) {
    if (this.isHost) this.sim.applyCommand(this.localId, msg);
    else this.net.sendShot(msg);
  }

  #throw(slot) {
    const ps = this.ps;
    this.#command({ cmd: 'throw', slot, ox: ps.x, oz: ps.z, aim: ps.aim });
  }

  // The local player is drawn from its own state so controls never lag behind the network.
  #overlayLocal(view) {
    const ps = this.ps, p = view.players.find(q => q.id === this.localId);
    if (!p) return null;
    if (this.localAlive) {
      p.x = ps.x; p.z = ps.z; p.aim = ps.aim; p.vx = ps.vx; p.vz = ps.vz;
      p.weapon = ps.weapon; p.camo = ps.camo;
      p.ammo = ps.ammo[ps.slot]; p.reserve = ps.reserve[ps.slot];
      p.reloadT = ps.reloadT; p.reloadDur = ps.reloadDur;
      p.adsT = ps.adsT; p.sprinting = ps.sprinting; p.sliding = ps.sliding; p.bloom = ps.bloom;
      p.heat = ps.heat; p.overheated = ps.overheated; p.firingT = ps.firingT;
    }
    return p;
  }

  #syncLifeFromAuthority() {
    const newest = this.interp.newest;
    const me = newest?.players.find(p => p.id === this.localId);
    if (!me) return;
    // A guest's first snapshot can arrive before it has seen the opening spawn events.
    if (!this.spawned && me.alive) this.#spawnLocal(me.x, me.z, me.aim);
    if (this.localAlive && !me.alive && this.now() - this.lastSpawnAt > 0.5) this.localAlive = false;
  }

  #finish(view) {
    if (this.endTimer < 0) {
      this.endTimer = END_HOLD;
      this.controls.setEnabled(false);
      if (view.lastKill) this.renderer.playFinalKill(view.lastKill);
    }
    this.endTimer -= this.dt;
    if (this.endTimer <= 0) {
      this.stop();
      this.onEnd({
        scores: view.scores, winner: view.winner, lastKill: view.lastKill, localId: this.localId,
        myTeam: this.me.team, players: view.players.map(p => ({ ...p })),
        ...this.awards.finish(view),
      });
    }
  }

  frame() {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    const nowMs = performance.now();
    const dt = this.dt = Math.min(MAX_FRAME, (nowMs - this.lastTime) / 1000);
    this.lastTime = nowMs;

    if (this.isHost) this.#stepHost(dt);
    this.#syncLifeFromAuthority();

    const view = this.interp.sample(this.now());
    if (!view) return;           // Guest still waiting on the first snapshot.

    const input = this.controls.read();
    if (this.localAlive && view.phase !== 'ended') this.#stepLocal(input, view, dt);
    this.#overlayLocal(view);

    const events = this.frameEvents;
    this.renderer.update(view, events, dt);
    this.hud.onEvents(events);
    this.hud.update(view, dt);
    this.audio.onEvents(events, view);
    this.audio.update(view, dt);
    this.awards.onEvents(events, view);
    events.length = 0;

    if (view.phase === 'ended') this.#finish(view);
  }
}
