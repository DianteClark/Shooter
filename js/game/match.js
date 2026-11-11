// Runs one match on this device. Each human simulates their own player every render frame
// (see docs/ARCHITECTURE.md); the host additionally runs bots, damage and scoring.

import { MAPS } from '../shared/map.js';
import { SIM_HZ, SNAPSHOT_EVERY, STATE_SEND_HZ, INTERP_DELAY } from '../shared/constants.js';
import {
  createPlayerState, respawnPlayer, stepPlayer, traceShot, applyAimAssist,
  encodeHumanState, decodeHumanState, armPlayer, applyDaze,
} from '../sim/player.js';
import { Sim, scavengeRefill } from '../sim/sim.js';
import { previewThrow, maxThrowRange } from '../sim/equipment.js';
import { Interpolator } from './interp.js';
import { MatchAwards } from './awards.js';
import { Killcam } from './killcam.js';
import { ctfCarrying } from '../sim/ctf.js';
import { MatchTelemetry } from './telemetry.js';

// Smallest signed rotation from b to a.
function angleDiffSigned(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

const STEP = 1 / SIM_HZ;
const MAX_FRAME = 0.1;
const MAX_CATCHUP_STEPS = 4;
const END_HOLD = 4.5;              // Seconds of final-kill replay before the results screen.

export class Match {
  constructor(config) {
    Object.assign(this, config);   // canvas, mapId, seed, limits, roster, ids, net, controls, hud, renderer, audio, onEnd
    this.map = MAPS[this.mapId];
    this.me = this.roster.find(r => r.id === this.localId);
    this.ps = createPlayerState({ id: this.localId, primary: this.me.primary, camo: this.me.camo, loadout: this.me.loadout, instantReload: this.mode === 'range' });
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
    this.ended = false;            // Set once results have been handed to onEnd.
    this.rng = Math.random;
    this.frameEvents = [];
    this.resolvedInput = { mx: 0, mz: 0, aim: 0, aiming: false, fire: false, sprint: false, slide: false, swap: false, tactical: false, lethal: false, streak: -1 };

    // Guests build a Sim too, purely as the snapshot codec; only the host ever steps it.
    this.sim = new Sim({
      roster: this.roster, map: this.map, seed: this.seed,
      scoreLimit: this.scoreLimit, timeLimit: this.timeLimit, mode: this.mode,
    });
    // The host's view is a fresh 30 Hz local copy, so it needs far less smoothing than a 15 Hz network stream.
    this.telemetry = new MatchTelemetry({ localId: this.localId });
    this.killcam = new Killcam({ renderer: this.renderer, localId: this.localId });
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
    this.killcam.dispose();
  }

  // Tap to respawn: the host holds a dead human until they ask (or its auto-respawn timeout).
  requestRespawn(msg = {}) {
    this.#command({ ...msg, cmd: 'respawn' });
  }

  // Cuts the end-of-match hold short so results show at once.
  endNow() {
    if (this.endTimer >= 0) this.endTimer = 0;
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
      this.#wireHostHandlers();
    } else {
      net.onSnapshot(data => {
        this.interp.push(this.sim.decodeSnapshot(data, this.localId), this.now());
      });
      net.onEvents(events => this.#receiveEvents(events));
    }
  }

  #wireHostHandlers() {
    const net = this.net;
    net.onState((peerId, data) => this.sim.applyHumanState(peerId, decodeHumanState(data)));
    net.onShot((peerId, msg) => {
      if (msg.cmd) this.sim.applyCommand(peerId, msg);
      else this.sim.applyShot(peerId, msg, msg.age);
    });
    net.onPeerLeave(peerId => this.sim.humanLeft(peerId));
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
      if (e.t === 'dazed' && e.id === this.localId) applyDaze(this.ps, e.amount, e.dur);   // Stun, Gas, Shock slow you.
      if (e.t === 'rejoin' && e.oldId !== e.id) this.#rebind(e);   // A newcomer took an open slot.
      if (e.t === 'arm' && e.id === this.localId) {   // Gun Game promotion or setback, in that gun's own camo.
        armPlayer(this.ps, e.weapon);
        this.ps.camo = this.me.loadout?.camos?.[e.weapon] ?? 'none';
      }
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
      // Big maps send each guest its own cut of the events and snapshot (sim interest management).
      const perGuest = this.net && this.sim.interest ? this.net.guests : null;
      if (events.length) {
        if (perGuest) for (const id of perGuest) { const own = this.sim.eventsFor(id, events); if (own.length) this.net.sendEvents(own, id); }
        else this.net?.sendEvents(events);
        this.#receiveEvents(events);
      }
      this.#pushHostView();
      if (this.net && this.tick % SNAPSHOT_EVERY === 0) {
        if (perGuest) for (const id of perGuest) this.net.sendSnapshot(this.sim.encodeSnapshotFor(id), id);
        else this.net.sendSnapshot(this.sim.encodeSnapshot());
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
      const assisted = applyAimAssist(input.aim, this.ps, view.players, this.map, this.dt);
      aim = input.aim + angleDiffSigned(assisted, input.aim) * (this.controls.aimAssist ?? 1);
    } else if (moving) {
      aim = Math.atan2(input.mz, input.mx);
    }
    // Steering your own Cruise Missile: the aim stick flies it, so the gun holds fire and an idle stick keeps course.
    if (view.gunships?.some(g => g.kind === 'missile' && g.owner === this.localId)) {
      r.fire = false;
      if (input.aim === null || input.aim === undefined) aim = this.lastAim;
    }
    this.lastAim = aim;
    r.aim = aim;
    // Everyone holds position through the warmup countdown, as bots do; aiming stays live.
    if (view.phase === 'warmup') {
      r.mx = 0; r.mz = 0; r.fire = false; r.sprint = false; r.slide = false;
      r.tactical = false; r.lethal = false; r.streak = -1; r.throwAim = null;
    }
    return r;
  }

  #stepLocal(input, view, dt) {
    const r = this.#resolveInput(input, view);
    this.audio.trigger = r.fire;                          // The dry-fire click needs to know the trigger is held.
    this.ps.noSlide = ctfCarrying(view, this.localId);   // A flag carrier cannot slide.
    const shots = stepPlayer(this.ps, r, dt, this.map, this.rng);
    for (const shot of shots) {
      const rays = traceShot(shot, this.map, view.players, this.localId);
      this.frameEvents.push({
        t: 'shot', by: this.localId, weapon: shot.weapon, camo: this.ps.camo,
        ox: shot.ox, oz: shot.oz, aim: shot.aim, rays, sup: shot.sup,
      });
      if (this.isHost) {
        this.sim.applyShot(this.localId, shot, this.interp.delay);
      } else {
        // Age tells the host how far to rewind targets to match what this player saw.
        this.net.sendShot({ ...shot, age: INTERP_DELAY + (this.net.rtt ?? 80) / 2000 });
      }
    }
    if (this.ps.overheatEdge) this.frameEvents.push({ t: 'overheat', id: this.localId });
    if (r.streak >= 0) this.#command({ cmd: 'streak', slot: r.streak });
    if (r.tactical) this.#throw('tactical', r);
    if (r.lethal) this.#throw('lethal', r);
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

  #throw(slot, input) {
    const ps = this.ps;
    this.#command({ cmd: 'throw', slot, ox: ps.x, oz: ps.z, aim: input.throwAim?.aim ?? ps.aim, dist: input.throwDist ?? undefined });
  }

  // While a throw is being aimed, the arc is computed by the same code the host will use for the real one.
  #updateThrowPreview(view, input) {
    const a = input.throwAim;
    if (!a || !this.localAlive || view.phase === 'warmup') { view.throwPreview = null; return; }
    const ps = this.ps;
    const kind = a.slot === 'tactical' ? ps.tactical : ps.lethal;
    view.throwPreview = previewThrow(this.map, ps.x, ps.z, a.aim, Math.min(a.dist, maxThrowRange(ps.perks)), kind, ps.perks, ps.pro);
  }

  // The host vanished and this device was elected: carry on from the newest snapshot.
  promoteToHost({ goneIds = [] } = {}) {
    const net = this.net, view = this.interp.newest;
    if (!view) return;
    this.sim = Sim.fromSnapshot(view, this.roster, {
      map: this.map, seed: this.seed, timeLimit: this.timeLimit, scoreLimit: this.scoreLimit, gone: goneIds,
    });
    this.isHost = true;
    this.hostId = this.localId;
    this.interp.delay = STEP * 1.5;
    net.onSnapshot(null);
    net.onEvents(null);
    this.#wireHostHandlers();
  }

  humanRejoined(id) {
    if (this.isHost) this.sim.humanRejoin(id);
  }

  // Host: whether this player id has a human slot in the match (on the field, or held for them since they dropped).
  holdsHuman(id) {
    const p = this.sim.byId.get(id);
    return !!p && !p.isBot && !p.dummy;
  }

  // Host: seats a newcomer in an open held slot. Returns the slot's roster entry, now carrying the newcomer, or null.
  claimOpenSlot(id, name, loadout, info) {
    if (!this.isHost) return null;
    const r = this.sim.claimOpenSlot(id, name, loadout, info);
    if (!r) return null;
    return this.#rebind({ oldId: r.oldId, id, name, info, loadout });
  }

  // A slot changed hands: the roster (shared with main.js's match info, which a returning player is sent) follows, and
  // so do the guest's snapshot codec and the character art. Safe to run twice (host: claim, then its own event).
  #rebind({ oldId, id, name, info, loadout }) {
    const entry = this.roster.find(r => r.id === oldId) ?? this.roster.find(r => r.id === id);
    if (!this.isHost) this.sim.rebindPlayer(oldId, id, name);
    if (!entry) return null;
    if (entry.id !== id) {
      entry.id = id;
      entry.name = name;
      if (loadout) entry.loadout = { ...loadout };
      if (loadout?.primary) { entry.primary = loadout.primary; entry.camo = loadout.camo ?? entry.camo; }
      entry.badge = info?.badge ?? null;
      entry.operator = info?.operator ?? entry.operator;
      if (entry.loadout) Object.assign(entry.loadout, { operator: entry.operator, skin: info?.skin ?? null, emblem: info?.emblem ?? null });
      this.renderer.chars?.setRoster(this.roster);
      this.hud.badges?.set(id, entry.badge);
    }
    return entry;
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
    if (this.ended) return;
    if (this.endTimer < 0) {
      this.controls.setEnabled(false);
      let hold = 0;
      try { hold = (view.lastKill && this.killcam.playFinal(view.lastKill)) || 0; } catch (err) { console.error('final kill replay', err); }
      this.endTimer = hold || END_HOLD;
    }
    this.endTimer -= this.dt;
    if (this.endTimer <= 0 || this.killcam.skipped) this.#close(view);
  }

  // The match is over: stop, save, and hand the results on, exactly once. Nothing here may stand between the end of a
  // match and its results screen, so stats and awards failing costs only their own part of the results.
  #close(view) {
    if (this.ended) return;
    this.ended = true;
    try { this.stop(); } catch (err) { this.running = false; console.error('match stop', err); }
    try { this.telemetry.finish(view); } catch (err) { console.error('match stats', err); }
    let awards = {};
    try { awards = this.awards.finish(view) ?? {}; } catch (err) { console.error('match awards', err); }
    this.onEnd({
      scores: view.scores, winner: view.winner, lastKill: view.lastKill, localId: this.localId, modeId: view.modeId ?? this.mode,
      myTeam: this.me.team, players: view.players.map(p => ({ ...p })),
      snd: view.snd ?? view.points?.snd ?? null,
      ...awards,
    });
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
    this.#updateThrowPreview(view, input);

    const events = this.frameEvents;
    try {
      this.killcam.render(view, events, dt);
      if (this.renderer.ambient?.strikeNow) this.audio.lightning();
      this.hud.onEvents(events);
      this.hud.update(view, dt);
      this.audio.onEvents(events, view);
      this.audio.update(view, dt);
      this.awards.onEvents(events, view);
      this.telemetry.onEvents(events, view);
    } finally {
      events.length = 0;
      // A frame that throws while drawing the end (the final replay, a HUD readout) must still let the match end.
      if (view.phase === 'ended') this.#finish(view);
    }
  }
}
