// Runs one help video's match (js/shared/help-videos.js): the real Sim with bots only, seeded, plus the script's
// moments. No DOM and no renderer, so node runs every script headless (dev/help-videos-test.mjs); the player
// (js/game/help-video.js) draws what it produces.
//
//   const d = new HelpDirector(video);   // builds the roster and the Sim, runs the warmup and `pre` headless
//   d.advance(dt)                       // steps the Sim at its own rate up to video time t + dt; returns the events
//   d.view()                            // the current view, as the host decodes its own snapshot (a fresh object)
//   d.t, d.done                         // video seconds shown, and whether t reached the script's length
//   d.input                             // the star's input this tick: mx, mz, aiming, fire, sprint (ghost thumbs)
//   d.cam, d.castId                     // the camera the script wants now, and who the caster camera follows
//
// The star is the roster's first player made a veteran bot with the script's kit. Moments drive it through the same
// doors a phone uses: the throw and streak commands, and its bot's input for slides and sprints.
import { Sim, buildRoster } from '../sim/sim.js';
import { normalizeLoadout, LETHALS, TACTICALS } from '../shared/catalog.js';
import { addScore } from '../sim/streaks.js';
import { SIM_HZ } from '../shared/constants.js';
import { cycle } from './caster-core.js';

const STEP = 1 / SIM_HZ;
export const STAR_ID = 'star';
const SLIDE_TRY_S = 1.2;          // A slide that cannot start yet (too slow) keeps trying this long, running meanwhile.

export function videoRoster(v) {
  const loadout = normalizeLoadout({ ...v.star, camo: 'none' });
  const star = { id: STAR_ID, name: 'You', team: 0, primary: loadout.primary, camo: 'none', loadout };
  const opts = { botSkill: v.skill ?? 'regular', mode: v.mode === 'range' ? null : v.mode, mapId: v.map, seed: v.seed };
  if (v.mode === 'range') opts.teamSize = 0;
  else if (v.team) opts.teamSize = v.team;
  const roster = buildRoster([star], opts);
  return roster.map(r => (r.id === STAR_ID ? { ...r, isBot: true, skill: 'veteran', badge: { prestige: 0, level: 30 } } : { ...r, badge: r.badge ?? { prestige: 0, level: 1 + (r.id.length * 7) % 50 } }));
}

export class HelpDirector {
  constructor(video, { lazy = false } = {}) {
    this.v = video;
    this.roster = videoRoster(video);
    this.sim = new Sim({ roster: this.roster, map: video.map, seed: video.seed, mode: video.mode });
    this.star = this.sim.byId.get(STAR_ID);
    this.t = 0;
    this.acc = 0;
    this.opI = 0;
    this.ops = [...(video.ops ?? [])].sort((a, b) => a[0] - b[0]);
    this.cam = video.cam;
    this.castId = STAR_ID;
    this.sprintUntil = -1;
    this.slideUntil = -1;
    this.events = [];
    this.input = { mx: 0, mz: 0, aiming: false, fire: false, sprint: false };
    this.counts = { slide: 0, throw: 0, streak: 0, kill: 0, shot: 0 };     // The star's, for the tests.
    // The warmup and the lead-in run headless: the first frame is already where the script starts. Lazy: the player
    // runs them a slice per frame (prepare) behind its loading bar.
    this.preTotal = this.preLeft = Math.round(Math.max(0, video.pre ?? 0) * SIM_HZ);
    if (!lazy) this.prepare(Infinity);
  }

  get ready() { return this.preLeft <= 0; }
  get prepK() { return this.preTotal ? 1 - this.preLeft / this.preTotal : 1; }

  // Runs lead-in steps for up to `ms` milliseconds (at least one). True once the video can start.
  prepare(ms = 8) {
    const until = performance.now() + ms;
    while (this.preLeft > 0) {
      this.sim.step(STEP); this.sim.drainEvents();
      this.preLeft--;
      this.#hook();
      if (this.preLeft % 4 === 0) this.#keepStarIn();
      if (performance.now() >= until) break;
    }
    return this.ready;
  }

  get done() { return this.t >= this.v.len - 1e-6; }

  // The star's brain decides as any bot; a moment overrides only what it is about.
  // Bots get their brains on the Sim's first step, and a new one may replace it: hooked whenever it changes.
  #hook() {
    const brain = this.star?.bot;
    if (!brain || brain === this.hooked) return;
    this.hooked = brain;
    const drive = brain.drive.bind(brain);
    brain.drive = dt => {
      drive(dt);
      const I = brain.input, ps = this.star.ps;
      if (this.t < this.sprintUntil || this.t < this.slideUntil) {
        if (Math.hypot(I.mx, I.mz) < 0.5) { I.mx = Math.cos(ps.aim); I.mz = Math.sin(ps.aim); }
        const len = Math.hypot(I.mx, I.mz) || 1;
        I.mx /= len; I.mz /= len;
        I.sprint = true; I.aiming = false; I.fire = false;
      }
      if (this.t < this.slideUntil && !ps.sliding) I.slide = true;
      const o = this.input;
      o.mx = I.mx; o.mz = I.mz; o.aiming = !!I.aiming; o.fire = !!I.fire; o.sprint = !!I.sprint;
    };
  }

  // A video about one player should never lose them for long: the star respawns at once in modes that allow it.
  #keepStarIn() {
    const p = this.star;
    if (p && !p.alive && p.respawnT > 0.4 && !this.sim.snd && !this.sim.br) p.respawnT = 0.4;
  }

  #op([, kind, arg]) {
    const sim = this.sim, p = this.star;
    switch (kind) {
      case 'sprint': this.sprintUntil = this.t + (arg ?? 2); break;
      case 'slide': this.slideUntil = this.t + SLIDE_TRY_S; break;
      case 'swap': if (p?.bot) p.bot.input.swap = true; break;
      case 'lethal': case 'tactical': {
        if (!p?.alive) break;
        const ps = p.ps;
        if (kind === 'lethal' && ps.lethalLeft < 1) ps.lethalLeft = LETHALS[ps.lethal]?.count ?? 1;
        if (kind === 'tactical' && ps.tacticalLeft < 1) ps.tacticalLeft = TACTICALS[ps.tactical]?.count ?? 1;
        sim.applyCommand(p.id, { cmd: 'throw', slot: kind, ox: ps.x, oz: ps.z, aim: ps.aim, dist: arg > 0 ? arg : undefined });
        break;
      }
      case 'charge': {
        const st = p?.score, slot = st?.slots?.[arg | 0];
        if (slot && !slot.held) { try { addScore(st, Math.max(1, slot.cost - st.score)); } catch { /* capped */ } }
        break;
      }
      case 'streak': if (p?.alive) sim.useStreak(p.id, arg | 0); break;
      case 'cam': this.cam = arg; break;
      case 'next': this.castId = cycle(this.view(), this.castId, 1) ?? this.castId; break;
    }
  }

  // Steps to video time t + dt. Returns this frame's events (the array is reused).
  advance(dt) {
    const ev = this.events;
    ev.length = 0;
    if (this.done || !this.ready) return ev;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP && !this.done) {
      this.acc -= STEP;
      while (this.opI < this.ops.length && this.ops[this.opI][0] <= this.t + 1e-6) this.#op(this.ops[this.opI++]);
      this.#hook();
      this.sim.step(STEP);
      this.t = Math.min(this.v.len, this.t + STEP);
      for (const e of this.sim.drainEvents()) {
        ev.push(e);
        if (e.t === 'slide' && e.id === STAR_ID) { this.counts.slide++; this.slideUntil = -1; }
        else if (e.t === 'throw' && e.id === STAR_ID) this.counts.throw++;
        else if (e.t === 'streak' && e.id === STAR_ID) this.counts.streak++;
        else if (e.t === 'kill' && e.by === STAR_ID) this.counts.kill++;
        else if (e.t === 'shot' && e.by === STAR_ID) this.counts.shot++;
      }
      this.#keepStarIn();
    }
    if (ev.length > 400) ev.splice(0, ev.length - 400);
    return ev;
  }

  view() { return this.sim.decodeSnapshot(this.sim.encodeSnapshot(), STAR_ID); }
}
