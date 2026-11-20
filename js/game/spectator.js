// A friend room's spectator seat (docs/RANKED.md, ROADMAP item 60): a guest who chose Watch in the lobby is left out of
// the match roster and watches it instead, through the caster camera (js/game/caster.js). Nothing is simulated or sent
// from this phone: it decodes the host's snapshots and events (which go to every guest in the room) and draws them.
//
//   app.match = new SpectatorMatch({ mapId, mode, mods, seed, roster, scoreLimit, timeLimit, net, renderer, audio,
//                                     title, onExit, onEnd });
//   .start() / .stop()
//
// It answers the few things main.js asks of app.match (isHost false, interp, ps) so the room's code needs no branches.
import { MAPS } from '../shared/map.js';
import { INTERP_DELAY } from '../shared/constants.js';
import { Sim } from '../sim/sim.js';
import { Interpolator } from './interp.js';
import { CasterCam } from './caster.js';

const END_HOLD = 3.5;          // Seconds of the ended match on screen before going back to the room.
const MAX_FRAME = 0.1;

export class SpectatorMatch {
  constructor(cfg) {
    Object.assign(this, cfg);
    this.map = MAPS[this.mapId];
    this.isHost = false;
    this.spectator = true;
    this.localId = this.net?.localId ?? 'spectator';
    this.ps = { primary: null, secondary: null };
    this.awards = {};
    this.running = false;
    this.ended = false;
    this.endT = -1;
    this.frameEvents = [];
    // The snapshot codec only (never stepped), as a guest's Match has.
    this.sim = new Sim({ roster: this.roster, map: this.map, seed: this.seed, scoreLimit: this.scoreLimit, timeLimit: this.timeLimit, mode: this.mode, mods: this.mods ?? [] });
    this.interp = new Interpolator(INTERP_DELAY);
    this.caster = new CasterCam({ renderer: this.renderer, map: this.map, localId: this.localId, spectator: true, title: this.title ?? '', onExit: () => this.onExit?.() });
    this.frame = this.frame.bind(this);
    this.net?.onSnapshot(data => this.interp.push(this.sim.decodeSnapshot(data, this.localId), performance.now() / 1000));
    this.net?.onEvents(events => {
      for (const e of events) {
        if (e.t === 'team') { const p = this.sim.byId.get(e.id); if (p) p.team = e.team; }
        if (e.t === 'gf') this.sim.rules?.event?.(e);
        if (e.t === 'rejoin' && e.oldId !== e.id) this.sim.rebindPlayer?.(e.oldId, e.id, e.name);
        this.frameEvents.push(e);
      }
    });
  }

  start() {
    this.renderer.setLocal(null);
    this.renderer.vfx.setLoadouts(this.roster);
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    this.net?.onSnapshot(null);
    this.net?.onEvents(null);
    this.caster.dispose();
  }

  frame() {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const nowMs = performance.now();
    const dt = Math.min(MAX_FRAME, (nowMs - this.lastTime) / 1000);
    this.lastTime = nowMs;
    const view = this.interp.sample(nowMs / 1000);
    if (!view) return;
    const events = this.frameEvents;
    try {
      this.caster.frame(view, events, dt);
      this.caster.direct(view, dt);
      this.renderer.update(view, events, dt);
      if (this.audio) {
        // The listener rides the camera: there is no player of ours to hear from.
        this.audio.lx = this.renderer.camTarget.x; this.audio.lz = this.renderer.camTarget.z;
        this.audio.onEvents(events, view);
        this.audio.update(view, dt);
      }
    } catch (err) {
      console.error('spectate frame', err);
    } finally {
      events.length = 0;
    }
    if (view.phase === 'ended' && !this.ended) {
      if (this.endT < 0) this.endT = END_HOLD;
      this.endT -= dt;
      if (this.endT <= 0) { this.ended = true; this.onEnd?.(view); }
    }
  }
}
