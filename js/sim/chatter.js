// Bot chatter: short text reactions from bots in the kill feed's chat lines ("Nice shot", "Flag's ours", "Reloading",
// "Need a revive!", clanmates cheering their tag). Flavour, not spam: a few lines a minute at most.
//
// Runs on the host only, beside the Sim (js/game/match.js #stepHost): observe(events) reads a tick's events and returns
// new { t: 'chatter', id, l } events that go out with them, like any other event, so every phone shows the same line.
// Deterministic for a match seed: its own random stream, consumed in event order, and the sim's clock.
// id: the bot speaking; l: an index into CHATTER (append only: the index is on the wire). js/ui/quickchat.js draws them
// (to the speaker's team, or everyone for an `all` line), unless Options > Bot chatter is off.

export const CHATTER = [
  { id: 'nice', text: 'Nice shot', icon: 'ui:aim' },
  { id: 'gotem', text: 'Got one', icon: 'ui:skull' },
  { id: 'reload', text: 'Reloading', icon: 'ui:timer' },
  { id: 'revive', text: 'Need a revive!', icon: 'ui:warning' },
  { id: 'flag', text: "Flag's ours", icon: 'ui:flag' },
  { id: 'point', text: 'Point is ours', icon: 'ui:flag' },
  { id: 'lostflag', text: 'They have our flag!', icon: 'ui:warning' },
  { id: 'roll', text: 'On a roll', icon: 'ui:star' },
  { id: 'cheer', text: "Let's go {tag}!", icon: 'ui:party' },
  { id: 'cheer2', text: '{tag} on top', icon: 'ui:crown' },
  { id: 'glhf', text: 'GL HF', icon: 'ui:party', all: true },
  { id: 'gg', text: 'GG', icon: 'ui:cup', all: true },
  { id: 'ugh', text: 'They got me', icon: 'ui:skull' },
  { id: 'thanks', text: 'Thanks for the pick-up', icon: 'ui:check' },
  { id: 'uav', text: 'UAV up', icon: 'ui:eye' },
  { id: 'wp', text: 'Well played', icon: 'ui:cup', all: true },
];
const L = Object.fromEntries(CHATTER.map((c, i) => [c.id, i]));

export const GAP_S = 4.5;          // Shortest gap between two lines in a match (start and end lines aside).
export const SPEAKER_GAP_S = 22;   // One bot says nothing again for this long.
export const WINDOW_S = 60, WINDOW_MAX = 7;    // At most this many lines in any minute.

// The clan tag a name carries ("[VXN] Brakie" -> 'VXN'), for clanmates cheering.
export const tagOf = name => /^\[([A-Z0-9]{2,4})\] /.exec(String(name ?? ''))?.[1] ?? null;
// A line's text for a speaker: {tag} is their clan tag.
export const chatterText = (l, name) => (CHATTER[l]?.text ?? '').replace('{tag}', tagOf(name) ?? 'team');

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BotChatter {
  // sim: anything with time, phase, mode, players [{ id, team, isBot, ai, dummy, alive, name, streak }]; ffa: no sides.
  constructor(sim, seed = 1, { ffa = false } = {}) {
    this.sim = sim;
    this.ffa = ffa;
    this.rng = mulberry32((seed ^ 0x2c1b3c6d) >>> 0);
    this.last = -99;
    this.recent = [];
    this.spoke = new Map();       // speaker id -> time of their last line
    this.queue = [];              // { at, id, l, free } lines waiting for their moment
    this.saidStart = false;
    this.saidEnd = false;
  }

  #byId(id) { return this.sim.byId?.get?.(id) ?? this.sim.players.find(p => p.id === id) ?? null; }
  #talker(p) { return !!p && p.isBot && !p.ai && !p.dummy; }
  // A live bot on `team` other than `not`, picked by the stream (null when there is none).
  #mate(team, not = null, pred = null) {
    const list = this.sim.players.filter(p => this.#talker(p) && p.alive && p.team === team && p.id !== not && (!pred || pred(p)) && this.#fresh(p.id));
    return list.length ? list[Math.floor(this.rng() * list.length)] : null;
  }
  #fresh(id) { return this.sim.time - (this.spoke.get(id) ?? -99) >= SPEAKER_GAP_S; }
  // Queue a line `delay` seconds from now. free: a start or end line, past the match-wide limits.
  #say(p, l, delay = 0.5, free = false) {
    if (!p) return;
    this.queue.push({ at: this.sim.time + delay + this.rng() * 0.8, id: p.id, l, free });
  }

  // A tick's events in; the chatter events due now out (to be sent and shown with them).
  observe(events) {
    const sim = this.sim, r = () => this.rng();
    for (const e of events) {
      switch (e.t) {
        case 'phase':
          if (e.phase === 'live' && !this.saidStart) {
            this.saidStart = true;
            for (const team of this.#teams()) if (r() < 0.45) this.#say(this.#mate(team), L.glhf, 1.2, true);
          } else if (e.phase === 'ended' && !this.saidEnd) {
            this.saidEnd = true;
            for (const team of this.#teams()) if (r() < 0.7) this.#say(this.#anyBot(team), r() < 0.75 ? L.gg : L.wp, 0.3, true);
          }
          break;
        case 'kill': {
          const k = this.#byId(e.by), v = this.#byId(e.target);
          if (!k || !v || k === v || (!this.ffa && k.team === v.team)) break;
          if (this.#talker(k) && (k.streak === 5 || k.streak === 10) && r() < 0.6) { this.#say(k, L.roll); break; }
          if (!this.ffa) {
            const tag = tagOf(k.name);
            // Clanmates cheer their own; anyone else on the side now and then says nice shot (to a human too).
            const mate = tag ? this.#mate(k.team, k.id, p => tagOf(p.name) === tag) : null;
            if (mate && r() < 0.3) { this.#say(mate, r() < 0.6 ? L.cheer : L.cheer2); break; }
            if (r() < (this.#talker(k) ? 0.1 : 0.22)) { this.#say(this.#mate(k.team, k.id), L.nice, 0.7); break; }
          }
          if (this.#talker(k) && r() < 0.05) { this.#say(k, L.gotem); break; }
          if (this.#talker(v) && r() < 0.05) this.#say(v, L.ugh, 0.4);
          break;
        }
        case 'down': {
          const v = this.#byId(e.target);
          if (this.#talker(v) && r() < 0.55) this.#say(v, L.revive, 0.3);
          break;
        }
        case 'revive': {
          const p = this.#byId(e.id);
          if (this.#talker(p) && e.by !== e.id && r() < 0.35) this.#say(p, L.thanks, 0.6);
          break;
        }
        case 'reload': {
          const p = this.#byId(e.id);
          if (e.stage === 'start' && this.#talker(p) && p.alive && !this.ffa && r() < 0.03) this.#say(p, L.reload, 0.1);
          break;
        }
        case 'capture': {
          if (!Number.isInteger(e.team) || this.ffa) break;
          if (r() < 0.45) this.#say(this.#mate(e.team), /dom/.test(sim.mode ?? '') ? L.flag : L.point, 0.6);
          break;
        }
        case 'ctf': {
          if (e.kind === 'capture') { const p = this.#byId(e.id); if (p && r() < 0.6) this.#say(this.#talker(p) ? p : this.#mate(p.team, p.id), L.flag, 0.5); }
          else if (e.kind === 'take' && r() < 0.45) this.#say(this.#mate(e.team), L.lostflag, 0.4);
          break;
        }
        case 'streak': {
          const p = this.#byId(e.id);
          if (e.kind === 'uav' && this.#talker(p) && r() < 0.4) this.#say(p, L.uav, 0.3);
          break;
        }
        default: break;
      }
    }
    return this.#due();
  }

  #teams() {
    return [...new Set(this.sim.players.filter(p => this.#talker(p)).map(p => p.team))].sort((a, b) => a - b).slice(0, this.ffa ? 3 : 2);
  }
  #anyBot(team) {
    const list = this.sim.players.filter(p => this.#talker(p) && p.team === team);
    return list.length ? list[Math.floor(this.rng() * list.length)] : null;
  }

  // Lines whose moment has come and that the limits allow. A line that would break them is dropped, not delayed.
  #due() {
    const now = this.sim.time, out = [];
    if (!this.queue.length) return out;
    const keep = [];
    for (const q of this.queue) {
      if (q.at > now) { keep.push(q); continue; }
      const p = this.#byId(q.id);
      if (!p) continue;
      if (!q.free) {
        this.recent = this.recent.filter(t => now - t < WINDOW_S);
        if (now - this.last < GAP_S || this.recent.length >= WINDOW_MAX || !this.#fresh(q.id)) continue;
        // Most lines need the speaker up; asking for a revive or groaning is what the downed and dead do.
        if (!p.alive && q.l !== L.ugh && q.l !== L.revive) continue;
        this.last = now;
        this.recent.push(now);
      }
      this.spoke.set(q.id, now);
      out.push({ t: 'chatter', id: q.id, l: q.l });
    }
    this.queue = keep;
    return out;
  }
}
