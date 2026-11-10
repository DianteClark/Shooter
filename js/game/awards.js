// Watches the local player's events through one match and turns them into progression at the end.
// Lead: new MatchAwards({localId,team,loadout}) at match start, onEvents(events,view) every frame,
// finish(view) once when the match ends. Merge the return value into the results passed to onEnd.
// Pro challenges are counted here too (ProTracker), for the perks in use at each spawn; the result carries `proProgress`
// and Pro perks and calling cards earned in `unlocks` (kinds 'pro' and 'card', first in the list).
// Daily and weekly challenges (ChallengeTally) are settled here as well: their XP is part of the match's XP lines, and the
// result carries `challenges` (what moved, see applyChallengeTally). The match also goes into the history (`history`).
// `practice = true` (the tutorial) makes finish() record and pay nothing. observe(fn) hands fn(events, view) every
// frame's events after the awards have seen them, for the tutorial's prompts.
import { Progress, Challenges, MatchHistory, matchScore } from '../ui/progress.js';
import { MATCH_XP, WEAPON_XP, longshotDist, ProTracker, ChallengeTally } from '../shared/progression.js';
import { FFA_TEAM } from '../shared/constants.js';
import { isFfa } from '../shared/modes.js';

const MAX_FRAME = 0.5;           // A longer gap between frames (backgrounded tab) adds no held time.
const GUN_SECONDS = 3;           // Held at least this long counts as a gun used, for the history.
const HISTORY_GUNS = 4;

export class MatchAwards {
  constructor({ localId, team, loadout }) {
    this.localId = localId;
    this.team = team;
    this.loadout = loadout;
    this.kills = 0;
    this.headshots = 0;
    this.longshots = 0;
    this.slideKills = 0;
    this.equipKills = 0;
    this.streakKills = 0;
    this.assists = 0;
    this.medals = {};
    this.medalCount = 0;
    this.weapons = {};             // weapon id -> {xp,kills,head,long,slide,clean}
    this.usedEquipment = false;    // This life, for equipment-free kills.
    this.pro = new ProTracker(localId, loadout?.perks ?? Progress.loadout().perks);
    this.tally = new ChallengeTally(localId);
    this.held = {};                // weapon id -> seconds in hand while alive in the live phase
    this.live = 0;
    this.lastT = null;
    this.mapId = null;
    this.mode = null;
    this.practice = false;
    this.observers = [];
    this.result = null;
  }

  observe(fn) { this.observers.push(fn); }

  #bucket(weapon) {
    return this.weapons[weapon] ??= { xp: 0, kills: 0, head: 0, long: 0, slide: 0, clean: 0 };
  }

  #onKill(e, view) {
    this.kills++;
    // Weapon stats and camo challenges credit gunplay only; a sim kill's weapon is a gun id even for grenades.
    if (e.streak) { this.streakKills++; return; }
    if (e.equip) { this.equipKills++; return; }
    const b = this.#bucket(e.weapon);
    b.kills++;
    b.xp += WEAPON_XP.kill;
    if (e.head) { this.headshots++; b.head++; b.xp += WEAPON_XP.headshot; }
    if ((e.dist ?? 0) >= longshotDist(e.weapon)) { this.longshots++; b.long++; b.xp += WEAPON_XP.longshot; }
    if (view?.players?.find(p => p.id === this.localId)?.sliding) { this.slideKills++; b.slide++; b.xp += WEAPON_XP.slide; }
    if (!this.usedEquipment) { b.clean++; b.xp += WEAPON_XP.clean; }
  }

  #clock(view) {
    if (!view || typeof view.t !== 'number') return;
    const dt = this.lastT === null ? 0 : Math.min(MAX_FRAME, Math.max(0, view.t - this.lastT));
    this.lastT = view.t;
    this.mapId = view.mapId ?? this.mapId;
    this.mode = view.modeId ?? view.mode ?? this.mode;
    if (view.phase !== 'live' || !(dt > 0)) return;
    this.live += dt;
    const me = view.players?.find(p => p.id === this.localId);
    if (me?.alive && me.weapon) this.held[me.weapon] = (this.held[me.weapon] ?? 0) + dt;
  }

  onEvents(events, view) {
    if (this.result) return;
    this.pro.onEvents(events, view);
    this.tally.onEvents(events, view);
    this.#clock(view);
    for (const e of events) {
      switch (e.t) {
        case 'kill':
          if (e.by === this.localId && e.target !== this.localId) this.#onKill(e, view);
          if (e.assist === this.localId) this.assists++;
          break;
        case 'medal':
          if (e.id === this.localId) { this.medals[e.medal] = (this.medals[e.medal] ?? 0) + 1; this.medalCount++; }
          break;
        case 'spawn':
          // A loadout picked on the death screen applies from this spawn, and so do its perks' challenges.
          if (e.id === this.localId) { this.usedEquipment = false; this.pro.setPerks(Progress.loadout().perks); }
          break;
        case 'throw':
        case 'heal':
          if (e.id === this.localId) this.usedEquipment = true;
          break;
      }
    }
    for (const fn of this.observers) {
      try { fn(events, view); } catch (err) { console.error('awards observer', err); }
    }
  }

  // Placing in a free-for-all, 1 = first; null in team modes. Ranked as the sim and the results screen rank it: each
  // player is a side of one, so by that side's score (kills, or rungs in Gun Game), then fewer deaths, then kills.
  #placing(view, me) {
    const ffa = isFfa(this.mode) || (me?.team ?? 0) >= FFA_TEAM;
    if (!ffa || !me) return null;
    if (Number.isFinite(me.place)) return me.place;
    const score = p => view.scores?.[p.team] ?? p.kills ?? 0;
    const ahead = p => score(p) - score(me) || (me.deaths ?? 0) - (p.deaths ?? 0) || (p.kills ?? 0) - (me.kills ?? 0);
    let place = 1;
    for (const p of view.players ?? []) if (p.id !== me.id && !p.dummy && ahead(p) > 0) place++;
    return place;
  }

  // The history entry for this match (see cleanHistoryEntry in js/shared/progression.js).
  #historyEntry(view, me, outcome, place, xpTotal, level, challenges) {
    const guns = Object.keys({ ...this.held, ...this.weapons })
      .map(id => ({ id, kills: this.weapons[id]?.kills ?? 0, head: this.weapons[id]?.head ?? 0, secs: Math.round(this.held[id] ?? 0) }))
      .filter(g => g.kills > 0 || g.secs >= GUN_SECONDS)
      .sort((a, b) => b.kills - a.kills || b.secs - a.secs)
      .slice(0, HISTORY_GUNS);
    const objective = (this.medals.capture ?? 0) + (this.medals.confirm ?? 0) + (this.medals.flag_capture ?? 0) + (this.medals.flag_return ?? 0);
    const players = (view?.players ?? []).filter(p => !p.dummy);
    const team = me?.team ?? this.team ?? 0;
    // Team modes: ours and theirs. A free-for-all: mine and the best other score.
    const sc = t => view?.scores?.[t] ?? 0;
    const scores = place === null ? [sc(team), sc(1 - team)]
      : [sc(team), Math.max(0, ...players.filter(p => p.id !== me?.id).map(p => sc(p.team)))];
    return {
      at: Date.now(), map: this.mapId ?? view?.mapId, mode: this.mode ?? 'tdm', result: outcome, place,
      field: players.length, team, scores,
      kills: me?.kills ?? this.kills, deaths: me?.deaths ?? 0, assists: me?.assists ?? this.assists,
      score: matchScore({ kills: me?.kills ?? this.kills, head: me?.head ?? this.headshots, assists: me?.assists ?? this.assists, confirms: this.medals.confirm ?? 0, captures: this.medals.capture ?? 0 }),
      head: this.headshots, long: this.longshots, medals: this.medalCount, obj: objective,
      xp: xpTotal, level: level?.after ?? 1, levelUp: (level?.after ?? 0) > (level?.before ?? 0),
      bots: players.filter(p => p.isBot).length, humans: players.filter(p => !p.isBot).length, secs: Math.round(this.live),
      guns, challenges: challenges.filter(c => c.fresh).map(c => ({ id: c.id, xp: c.xp })),
    };
  }

  // Applies the match to the save once; a repeat call returns the same result.
  finish(view) {
    if (this.result) return this.result;
    if (view) this.#clock(view);
    const me = view?.players?.find(p => p.id === this.localId) ?? null;
    const place = this.#placing(view, me);
    // A free-for-all has no team: winning is coming first.
    const won = place !== null ? place === 1 : view?.winner === this.team;
    const drawn = place === null && (view?.winner === null || view?.winner === undefined);
    if (this.practice) {
      this.result = { xp: { total: 0, lines: [] }, weapons: [], unlocks: [], proProgress: [], challenges: [], medals: { ...this.medals }, stats: {}, practice: true };
      return this.result;
    }
    const lines = [['Match played', MATCH_XP.played]];
    if (this.kills) lines.push([`Kills x${this.kills}`, this.kills * MATCH_XP.kill]);
    if (this.headshots) lines.push([`Headshots x${this.headshots}`, this.headshots * MATCH_XP.headshot]);
    if (this.assists) lines.push([`Assists x${this.assists}`, this.assists * MATCH_XP.assist]);
    if (this.medalCount) lines.push([`Medals x${this.medalCount}`, this.medalCount * MATCH_XP.medal]);
    if (won) lines.push(['Win', MATCH_XP.win]);
    else if (drawn) lines.push(['Draw', MATCH_XP.draw]);
    // Challenges settle first so the XP they pay is part of this match's total. A failure here costs only them.
    let challenges = [];
    try {
      const settled = Challenges.apply(this.tally.finish({ won, place }));
      challenges = settled.moved;
      for (const period of ['daily', 'weekly']) {
        const done = challenges.filter(c => c.fresh && c.period === period);
        if (done.length) lines.push([`${period === 'daily' ? 'Daily' : 'Weekly'} challenge${done.length > 1 ? ` x${done.length}` : ''}`, done.reduce((n, c) => n + c.xp, 0)]);
      }
    } catch (err) { console.error('challenges', err); }
    const total = lines.reduce((sum, l) => sum + l[1], 0);

    const applied = Progress.applyMatch({ xp: total, weapons: this.weapons, pro: this.pro.gains() });
    const outcome = won ? 'win' : drawn ? 'draw' : 'loss';
    let history = null;
    try { history = MatchHistory.add(this.#historyEntry(view, me, outcome, place, total, applied.level, challenges)); } catch (err) { console.error('match history', err); }
    this.result = {
      xp: { total, lines },
      level: applied.level,
      weapons: applied.weapons,
      unlocks: applied.unlocks,
      proProgress: applied.proProgress,
      challenges,
      place,
      history,
      medals: { ...this.medals },
      stats: {
        kills: this.kills, headshots: this.headshots, longshots: this.longshots, slideKills: this.slideKills,
        equipmentKills: this.equipKills, streakKills: this.streakKills, assists: this.assists,
      },
    };
    return this.result;
  }
}
