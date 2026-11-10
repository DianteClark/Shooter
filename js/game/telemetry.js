// Per-gun match statistics for balance work: every player in the match, humans and bots, from the same event stream
// the HUD sees, so host and guest record the same thing. Kept locally in a capped, versioned store; the Stats screen
// (js/ui/stats.js) reads it and exports a compact code the owner can paste to the lead.
//
// Lead wiring (js/game/match.js), next to MatchAwards:
//   this.telemetry = new MatchTelemetry({ localId });
//   this.telemetry.onEvents(events, view);    every frame, with the same events and view the HUD gets
//   this.telemetry.finish(view);              once when the match ends; saves, returns the match record (or null)
// The firing range and matches with no gunfire record nothing.
//
// Three scopes per gun: a = everyone in the match, h = human players only, m = the local player only.
// Each gun's numbers in a scope are one flat array, laid out by FIELDS.

export const STATS_VERSION = 1;
const STORE_KEY = 'switchyard.gunstats';
const MAX_MATCHES = 40;          // Newest matches kept one by one; older ones are folded into one archive record.
const FIGHT_RESET = 7;           // Seconds without a hit after which a target has healed and a new fight starts.
const MAX_FRAME = 0.5;           // A longer gap between frames (backgrounded tab) adds no held time.
const PICK_SECONDS = 3;          // Held at least this long in a match counts as picking the gun.

// Damage by distance: buckets ending at these ranges (metres); the last one is open.
export const DIST_EDGES = [5, 10, 20, 30, 45];
export const DIST_LABELS = ['0-5', '5-10', '10-20', '20-30', '30-45', '45+'];
const NB = DIST_LABELS.length;

export const FIELDS = [
  'kills',      // gunfire kills with it (not streaks, not thrown kit)
  'deaths',     // deaths while holding it, from any cause
  'shots',      // trigger pulls that fired (a shotgun shell is one shot)
  'hits',       // hit events on enemies: one per target per shot, so a rocket can hit several
  'headHits',
  'headKills',
  'dmg',        // damage dealt, only what the target had left
  'ttkMs',      // sum of times to kill, ms: killer's first hit on the victim in this fight to the kill
  'ttkN',       // kills that have a time to kill
  'picks',      // player-matches that held it for PICK_SECONDS or more
  'heldS',      // seconds alive with it in hand while the match was live
  ...DIST_LABELS.map((_, i) => 'dmg' + i),
  ...DIST_LABELS.map((_, i) => 'hit' + i),
];
const F = Object.fromEntries(FIELDS.map((k, i) => [k, i]));
const NF = FIELDS.length;
export const SCOPES = ['a', 'h', 'm'];

function bucketOf(dist) {
  for (let i = 0; i < DIST_EDGES.length; i++) if (dist < DIST_EDGES[i]) return i;
  return NB - 1;
}

const newRow = () => new Array(NF).fill(0);

// ---- One match ----

export class MatchTelemetry {
  constructor({ localId }) {
    this.localId = localId;
    this.scopes = { a: {}, h: {}, m: {} };    // scope -> gunId -> row
    this.players = new Map();                  // id -> { bot, held: {gunId: seconds} }
    this.fights = new Map();                   // targetId -> { last, first: Map(attackerId -> time) }
    this.clock = 0;                            // Seconds of match time seen, from view.t.
    this.lastT = null;
    this.live = 0;                             // Seconds of live phase.
    this.mapId = null;
    this.mode = null;
    this.result = undefined;
  }

  #row(scope, gun) {
    const s = this.scopes[scope];
    return s[gun] || (s[gun] = newRow());
  }

  // Adds `v` to field `f` of `gun` for whoever `id` is: everyone, humans, and the local player.
  #add(id, gun, f, v) {
    if (!gun) return;
    this.#row('a', gun)[f] += v;
    const p = this.players.get(id);
    if (p && !p.bot) this.#row('h', gun)[f] += v;
    if (id === this.localId) this.#row('m', gun)[f] += v;
  }

  #player(v) {
    let p = this.players.get(v.id);
    if (!p) { p = { bot: !!v.isBot, held: {} }; this.players.set(v.id, p); }
    return p;
  }

  #heldTime(view) {
    const t = view.t;
    if (typeof t !== 'number') return;
    let dt = this.lastT === null ? 0 : t - this.lastT;
    this.lastT = t;
    if (!(dt > 0)) return;
    if (dt > MAX_FRAME) dt = MAX_FRAME;
    this.clock += dt;
    if (view.phase !== 'live') return;
    this.live += dt;
    const list = view.players;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v.alive || !v.weapon || v.dummy) continue;
      const p = this.#player(v);
      p.held[v.weapon] = (p.held[v.weapon] || 0) + dt;
      this.#add(v.id, v.weapon, F.heldS, dt);
    }
  }

  onEvents(events, view) {
    if (this.result !== undefined || !view) return;
    if (view.mode === 'range') return;
    this.mapId = view.mapId ?? this.mapId;
    this.mode = view.mode ?? this.mode;
    if (this.players.size === 0) for (const v of view.players) this.#player(v);
    this.#heldTime(view);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'shot': this.#add(e.by, e.weapon, F.shots, 1); break;
        case 'hit': this.#onHit(e); break;
        case 'kill': this.#onKill(e, view); break;
        case 'spawn': this.fights.delete(e.id); break;
      }
    }
  }

  #onHit(e) {
    if (!e.w) return;                 // A streak or thrown kit: not gunplay.
    const by = e.by, gun = e.w, dmg = e.dmg || 0;
    this.#add(by, gun, F.hits, 1);
    this.#add(by, gun, F.dmg, dmg);
    if (e.head) this.#add(by, gun, F.headHits, 1);
    if (typeof e.dist === 'number') {
      const b = bucketOf(e.dist);
      this.#add(by, gun, F.dmg0 + b, dmg);
      this.#add(by, gun, F.hit0 + b, 1);
    }
    let f = this.fights.get(e.target);
    if (!f || this.clock - f.last > FIGHT_RESET) {
      f = { last: this.clock, first: new Map() };
      this.fights.set(e.target, f);
    }
    f.last = this.clock;
    if (!f.first.has(by)) f.first.set(by, this.clock);
  }

  #onKill(e, view) {
    // Deaths go to whatever the victim had in hand; an older host does not send it, so fall back to the view.
    const vw = e.vw || view.players.find(p => p.id === e.target)?.weapon;
    this.#add(e.target, vw, F.deaths, 1);
    const f = this.fights.get(e.target);
    this.fights.delete(e.target);
    if (e.streak || e.equip) return;
    this.#add(e.by, e.weapon, F.kills, 1);
    if (e.head) this.#add(e.by, e.weapon, F.headKills, 1);
    const start = f?.first.get(e.by);
    if (start !== undefined) {
      this.#add(e.by, e.weapon, F.ttkMs, Math.round((this.clock - start) * 1000));
      this.#add(e.by, e.weapon, F.ttkN, 1);
    }
  }

  // Closes the match, saves it and returns its record; null when there was nothing to record. Repeat calls return
  // the same result and save nothing more.
  finish(view) {
    if (this.result !== undefined) return this.result;
    if (view) this.onEvents([], view);
    let shots = 0;
    for (const gun in this.scopes.a) shots += this.scopes.a[gun][F.shots];
    if (!shots || this.mode === 'range') return (this.result = null);
    const pm = { a: 0, h: 0, m: 0 };
    for (const [id, p] of this.players) {
      pm.a++;
      if (!p.bot) pm.h++;
      if (id === this.localId) pm.m++;
      for (const gun in p.held) {
        if (p.held[gun] < PICK_SECONDS) continue;
        this.#add(id, gun, F.picks, 1);
      }
    }
    const g = {};
    for (const s of SCOPES) {
      const out = {};
      for (const gun in this.scopes[s]) out[gun] = this.scopes[s][gun].map(v => Math.round(v));
      g[s] = out;
    }
    const record = { at: Date.now(), map: this.mapId, mode: this.mode, live: Math.round(this.live), pm, g };
    GunStats.add(record);
    return (this.result = record);
  }
}

// ---- The store ----

function emptyAggregate() {
  return { matches: 0, live: 0, pm: { a: 0, h: 0, m: 0 }, g: { a: {}, h: {}, m: {} } };
}

// Adds a match record (or another aggregate) into an aggregate.
function fold(agg, rec) {
  agg.matches += rec.matches ?? 1;
  agg.live += rec.live || 0;
  for (const s of SCOPES) {
    agg.pm[s] += rec.pm?.[s] || 0;
    const src = rec.g?.[s];
    if (!src) continue;
    const dst = agg.g[s];
    for (const gun in src) {
      const row = dst[gun] || (dst[gun] = newRow());
      const r = src[gun];
      for (let i = 0; i < NF && i < r.length; i++) row[i] += r[i] || 0;
    }
  }
  return agg;
}

function validAggregate(a) {
  return a && typeof a.matches === 'number' && a.pm && a.g && SCOPES.every(s => a.g[s] && typeof a.g[s] === 'object');
}

let cache = null;

function read() {
  if (cache) return cache;
  let data = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch { data = null; }
  // A store from another version starts over: old fields would mean something else.
  if (!data || data.v !== STATS_VERSION || !Array.isArray(data.recent) || !validAggregate(data.archive)) {
    data = { v: STATS_VERSION, archive: emptyAggregate(), recent: [] };
  }
  cache = data;
  return data;
}

function write(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* Full or private mode: stats are optional. */ }
}

export const GunStats = {
  add(record) {
    const data = read();
    data.recent.push(record);
    while (data.recent.length > MAX_MATCHES) fold(data.archive, data.recent.shift());
    write(data);
  },

  // Everything recorded so far, every scope: { matches, live, pm:{a,h,m}, g:{a:{gun:row},h,m} }.
  totals() {
    const data = read();
    const agg = fold(emptyAggregate(), data.archive);
    for (const r of data.recent) fold(agg, r);
    return agg;
  },

  matchCount() { const d = read(); return d.archive.matches + d.recent.length; },

  clear() {
    cache = { v: STATS_VERSION, archive: emptyAggregate(), recent: [] };
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  },

  exportCode() { return encodeStatsCode(this.totals()); },
};

// ---- Derived numbers, for the screen and for whoever reads an export ----

// One row per gun in a scope with the numbers people compare guns by. `ids` limits and orders the guns.
export function gunRows(agg, scope, ids) {
  const g = agg.g[scope] || {};
  const pm = agg.pm[scope] || 0;
  return ids.map(id => {
    const r = g[id] || newRow();
    const kills = r[F.kills], deaths = r[F.deaths], shots = r[F.shots], hits = r[F.hits];
    return {
      id, kills, deaths, shots, hits, raw: r,
      kd: deaths ? kills / deaths : (kills ? kills : null),
      acc: shots ? Math.min(1, hits / shots) : null,
      head: kills ? r[F.headKills] / kills : null,
      ttk: r[F.ttkN] ? r[F.ttkMs] / r[F.ttkN] / 1000 : null,
      pick: pm ? r[F.picks] / pm : null,
      kpm: r[F.heldS] >= 30 ? kills / (r[F.heldS] / 60) : null,
      dmgPerHit: DIST_LABELS.map((_, i) => r[F.hit0 + i] ? r[F.dmg0 + i] / r[F.hit0 + i] : null),
    };
  });
}

// ---- Export code ----
// SYS1~<matches>.<live s>~<scope>:<pm>:<gun>=<f0>.<f1>...;<gun>=...~<scope>:... with every number in base 36.
// Only characters that survive any chat app. decodeStatsCode reverses it.

export function encodeStatsCode(agg) {
  const parts = [`SYS${STATS_VERSION}`, `${agg.matches.toString(36)}.${Math.round(agg.live).toString(36)}`];
  for (const s of SCOPES) {
    const guns = Object.keys(agg.g[s]).sort()
      .map(gun => `${gun}=${agg.g[s][gun].map(v => Math.max(0, Math.round(v)).toString(36)).join('.')}`);
    parts.push(`${s}:${(agg.pm[s] || 0).toString(36)}:${guns.join(';')}`);
  }
  return parts.join('~');
}

// Returns the aggregate an export code was made from, or null if it is not one.
export function decodeStatsCode(code) {
  try {
    const parts = String(code).trim().split('~');
    if (parts[0] !== `SYS${STATS_VERSION}`) return null;
    const [m, live] = parts[1].split('.').map(x => parseInt(x, 36));
    const agg = emptyAggregate();
    agg.matches = m; agg.live = live;
    for (const p of parts.slice(2)) {
      const [s, pm, body] = p.split(':');
      if (!SCOPES.includes(s)) continue;
      agg.pm[s] = parseInt(pm, 36);
      if (!body) continue;
      for (const item of body.split(';')) {
        const [gun, nums] = item.split('=');
        const row = newRow(), vals = nums.split('.');
        for (let i = 0; i < NF && i < vals.length; i++) row[i] = parseInt(vals[i], 36) || 0;
        agg.g[s][gun] = row;
      }
    }
    return agg;
  } catch { return null; }
}
