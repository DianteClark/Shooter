// Watches the local player's events through one match and turns them into progression at the end.
// Lead: new MatchAwards({localId,team,loadout}) at match start, onEvents(events,view) every frame,
// finish(view) once when the match ends. Merge the return value into the results passed to onEnd.
// Pro challenges are counted here too (ProTracker), for the perks in use at each spawn; the result carries `proProgress`
// and Pro perks and calling cards earned in `unlocks` (kinds 'pro' and 'card', first in the list).
// Daily and weekly challenges (ChallengeTally) are settled here as well: their XP is part of the match's XP lines, and the
// result carries `challenges` (what moved, see applyChallengeTally). The match also goes into the history (`history`).
// Mastery (MasteryTracker): every tactical, lethal, streak and operator track and each gun's ladder past level 30. Tiers
// finished pay XP as a line of the match, come back first in `unlocks` (kind 'mastery'), and `mastery` lists what moved.
// Seasons (docs/SEASONS.md): the match's XP and challenge counts move the season track and its weekly sets, and a
// ranked match (`ranked = { lobby, rating }`, set by main.js for the Ranked playlist only) moves the rating; the result
// carries `season` (the track's move) and `ranked` (the rating's). Training and Custom never set `ranked`.
// `practice = true` (the tutorial) makes finish() record and pay nothing. observe(fn) hands fn(events, view) every
// frame's events after the awards have seen them, for the tutorial's prompts.
import { Progress, Challenges, MatchHistory, matchScore } from '../ui/progress.js';
import { MATCH_XP, WEAPON_XP, longshotDist, ProTracker, ChallengeTally, MasteryTracker } from '../shared/progression.js';
import { landingOf, maxThrowRange } from '../sim/equipment.js';
import { MAPS } from '../shared/map.js';
import { FFA_TEAM } from '../shared/constants.js';
import { isFfa, BR } from '../shared/modes.js';
import { extractionPay, EX_UNLOCKS, exUnlockStatus } from '../shared/extraction.js';
import { objOf } from '../sim/rules.js';
import { getCamo } from '../shared/camos.js';
import { performance } from '../shared/ranked.js';

const MAX_FRAME = 0.5;           // A longer gap between frames (backgrounded tab) adds no held time.
const GUN_SECONDS = 3;           // Held at least this long counts as a gun used, for the history.
const HISTORY_GUNS = 4;
// A throw banked off a wall ends up off its aim line, or well short of where it was thrown on open ground.
const BANK_SIDE = 0.75;
const BANK_SHORT = 1.5;

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
    this.mastery = new MasteryTracker(localId, { loadout: loadout ?? Progress.loadout(), bounced: e => this.#banked(e) });
    this.held = {};                // weapon id -> seconds in hand while alive in the live phase
    this.live = 0;
    this.lastT = null;
    this.mapId = null;
    this.mode = null;
    this.practice = false;
    this.ranked = null;
    this.observers = [];
    this.result = null;
  }

  observe(fn) { this.observers.push(fn); }

  // Runs a throw through the shared throw preview on this match's map (the same flight the sim flies).
  #banked(e) {
    const map = MAPS[this.mapId];
    if (!map) return false;
    const perks = Progress.loadout().perks;
    const dist = Math.min(e.dist ?? 0, maxThrowRange(perks));
    const end = landingOf(map, e.ox, e.oz, e.aim, dist, e.kind, perks, Progress.proPerks());
    if (!end) return false;
    const dx = end.x - e.ox, dz = end.z - e.oz, c = Math.cos(e.aim), s = Math.sin(e.aim);
    return Math.abs(-dx * s + dz * c) > BANK_SIDE || dx * c + dz * s < dist - BANK_SHORT;
  }

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
    this.#clock(view);
    this.pro.onEvents(events, view);
    this.tally.onEvents(events, view);
    try { this.mastery.onEvents(events, view); } catch (err) { console.error('mastery', err); }
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
          if (e.id === this.localId) {
            this.usedEquipment = false;
            const l = Progress.loadout();
            this.pro.setPerks(l.perks);
            this.mastery.setLoadout(l);
          }
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
    if (objOf(view)?.ex) return null;        // Extraction squads are not placed: they get out or they do not.
    const ffa = isFfa(this.mode) || (me?.team ?? 0) >= FFA_TEAM;
    if (!ffa || !me) return null;
    if (Number.isFinite(me.place)) return me.place;
    const score = p => view.scores?.[p.team] ?? p.kills ?? 0;
    const ahead = p => score(p) - score(me) || (me.deaths ?? 0) - (p.deaths ?? 0) || (p.kills ?? 0) - (me.kills ?? 0);
    let place = 1;
    for (const p of view.players ?? []) if (p.id !== me.id && !p.dummy && ahead(p) > 0) place++;
    return place;
  }

  // How the player did for ranked (js/shared/ranked.js performance): their place in their team's table by score.
  #performance(view, me) {
    if (!me) return 0;
    const mates = (view?.players ?? []).filter(p => !p.dummy && p.team === me.team);
    const sorted = mates.slice().sort((a, b) => matchScore(b) - matchScore(a) || (a.deaths ?? 0) - (b.deaths ?? 0));
    return performance({ rank: sorted.indexOf(me) + 1, of: sorted.length, kills: me.kills ?? 0, deaths: me.deaths ?? 0 });
  }

  // The history entry for this match (see cleanHistoryEntry in js/shared/progression.js).
  #historyEntry(view, me, outcome, place, xpTotal, level, challenges) {
    const guns = Object.keys({ ...this.held, ...this.weapons })
      .map(id => ({ id, kills: this.weapons[id]?.kills ?? 0, head: this.weapons[id]?.head ?? 0, secs: Math.round(this.held[id] ?? 0) }))
      .filter(g => g.kills > 0 || g.secs >= GUN_SECONDS)
      .sort((a, b) => b.kills - a.kills || b.secs - a.secs)
      .slice(0, HISTORY_GUNS);
    const objective = (this.medals.capture ?? 0) + (this.medals.confirm ?? 0) + (this.medals.flag_capture ?? 0) + (this.medals.flag_return ?? 0)
      + (this.medals.hq_capture ?? 0) + (this.medals.hq_destroy ?? 0) + (this.medals.vip_kill ?? 0) + (this.medals.ctl_capture ?? 0) + (this.medals.grind_bank ?? 0);
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
      Progress.lastMastery([]);
      this.result = { xp: { total: 0, lines: [] }, weapons: [], unlocks: [], proProgress: [], challenges: [], mastery: [], medals: { ...this.medals }, stats: {}, practice: true };
      return this.result;
    }
    const lines = [['Match played', MATCH_XP.played]];
    if (this.kills) lines.push([`Kills x${this.kills}`, this.kills * MATCH_XP.kill]);
    if (this.headshots) lines.push([`Headshots x${this.headshots}`, this.headshots * MATCH_XP.headshot]);
    if (this.assists) lines.push([`Assists x${this.assists}`, this.assists * MATCH_XP.assist]);
    if (this.medalCount) lines.push([`Medals x${this.medalCount}`, this.medalCount * MATCH_XP.medal]);
    // Battle royale: placement, revives and time alive (js/sim/br.js keeps the numbers; BR.xp prices them).
    if (view?.br && me) {
      const at = view.players.indexOf(me), st = view.br.stats?.[at] ?? [0, 0, 0, 0, 0];
      const squads = new Set(view.players.map(p => p.team)).size;
      const placed = won ? 1 : place || squads;
      const placeXp = Math.round(BR.xp.place * (squads - placed) / Math.max(1, squads - 1));
      if (placeXp > 0) lines.push([`Placed ${placed} of ${squads}`, placeXp]);
      if (st[1] > 0) lines.push([`Revives x${st[1]}`, st[1] * BR.xp.revive]);
      const minutes = Math.floor((st[4] ?? 0) / 600);
      if (minutes > 0) lines.push([`Survived ${minutes} min`, minutes * BR.xp.minute]);
    }
    // Extraction: contracts pay only if the squad got out (anyone in it); the whole pot is banked for everyone in it.
    const exObj = objOf(view)?.ex ? objOf(view) : null;
    let ex = null;
    if (exObj && me) {
      const squad = exObj.squads?.find(s => s.team === me.team) ?? null;
      const lo = this.loadout ?? Progress.loadout();
      const pay = extractionPay(squad, { primary: lo?.primary ?? null, operator: lo?.operator ?? 'trooper' });
      lines.push(...pay.lines);
      if (pay.weaponXp && lo?.primary) this.#bucket(lo.primary).xp += pay.weaponXp;
      try { if (pay.opSecs) this.mastery.add(this.mastery.op ?? lo?.operator ?? 'trooper', 'secs', pay.opSecs); } catch (err) { console.error('extraction mastery', err); }
      const before = EX_UNLOCKS.map(u => exUnlockStatus(u, Progress.lifetime()));
      ex = { extracted: pay.extracted, banked: pay.banked, lost: pay.lost, life: pay.life, before, lives: squad?.lives ?? 0, me: !!me.out };
    }
    const exWon = ex ? ex.extracted : null;
    if (exWon !== null) { /* The Extracted line is the win. */ }
    else if (won) lines.push(['Win', MATCH_XP.win]);
    else if (drawn) lines.push(['Draw', MATCH_XP.draw]);
    // Challenges settle first so the XP they pay is part of this match's total. A failure here costs only them.
    let challenges = [], tallied = null;
    try {
      tallied = this.tally.finish({ won: exWon ?? won, place });
      const settled = Challenges.apply(tallied);
      challenges = settled.moved;
      for (const period of ['daily', 'weekly']) {
        const done = challenges.filter(c => c.fresh && c.period === period);
        if (done.length) lines.push([`${period === 'daily' ? 'Daily' : 'Weekly'} challenge${done.length > 1 ? ` x${done.length}` : ''}`, done.reduce((n, c) => n + c.xp, 0)]);
      }
    } catch (err) { console.error('challenges', err); }
    // Mastery tiers this match finishes pay their XP here too; the save itself changes in applyMatch.
    let mastery = {};
    try {
      mastery = this.mastery.finish({ won: exWon ?? won });
      const tierXp = Progress.masteryXp(mastery);
      if (tierXp > 0) lines.push(['Mastery tiers', tierXp]);
    } catch (err) { console.error('mastery', err); mastery = {}; }
    const total = lines.reduce((sum, l) => sum + l[1], 0);

    // Lifetime totals take the same counts the challenges do, plus where it was played and whether it was won.
    // Career totals for the leaderboards: kills and deaths as the scoreboard has them, a battle royale's placing, and
    // whether this player's squad got out of an extraction.
    const brPlace = view?.br ? (won ? 1 : place || new Set((view.players ?? []).map(p => p.team)).size) : null;
    const career = { kills: me?.kills ?? this.kills, deaths: me?.deaths ?? 0, br: !!view?.br, place: brPlace, extracted: !!ex?.extracted };
    const life = { ...(tallied ?? this.tally.counts()) };
    if (ex) for (const [k, n] of Object.entries(ex.life)) life[k] = (life[k] ?? 0) + n;
    const applied = Progress.applyMatch({ xp: total, weapons: this.weapons, pro: this.pro.gains(), mastery, life, mapId: this.mapId, won: exWon ?? won, career, extracted: !!ex?.extracted });
    if (ex) {
      // Exclusive unlock progress this match, and anything it opened.
      const after = Progress.lifetime();
      ex.unlocks = EX_UNLOCKS.map((u, i) => ({ ...exUnlockStatus(u, after), before: ex.before[i].value }));
      for (const u of ex.unlocks) if (u.done && !ex.before.find(b => b.id === u.id)?.done && !applied.unlocks.some(x => `${x.kind}:${x.id}` === u.id)) applied.unlocks.push({ kind: u.kind, id: u.item, name: u.name, req: u.label, ...(u.kind === 'camo' ? { colors: getCamo(u.item).colors, weaponName: 'every gun' } : {}) });
    }
    const outcome = exWon !== null ? (exWon ? 'win' : 'loss') : won ? 'win' : drawn ? 'draw' : 'loss';
    // The season track, weekly season sets and (ranked only) the rating. A failure here costs only them.
    let season = null;
    try {
      season = Progress.applySeasonMatch({
        xp: total, counts: tallied ?? this.tally.counts(), career: { ...career, won: exWon ?? won },
        ranked: this.ranked ? { outcome, perf: this.#performance(view, me), lobby: this.ranked.lobby ?? null, rating: this.ranked.rating ?? null } : null,
      });
    } catch (err) { console.error('season', err); }
    let history = null;
    try { history = MatchHistory.add(this.#historyEntry(view, me, outcome, place, total, applied.level, challenges)); } catch (err) { console.error('match history', err); }
    this.result = {
      xp: { total, lines },
      level: applied.level,
      weapons: applied.weapons,
      unlocks: applied.unlocks,
      proProgress: applied.proProgress,
      mastery: applied.mastery,
      challenges,
      place,
      history,
      season: season?.track ?? null,
      ranked: season?.ranked ?? null,
      medals: { ...this.medals },
      ex,
      stats: {
        kills: this.kills, headshots: this.headshots, longshots: this.longshots, slideKills: this.slideKills,
        equipmentKills: this.equipKills, streakKills: this.streakKills, assists: this.assists,
      },
    };
    return this.result;
  }
}
