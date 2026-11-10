// Watches the local player's events through one match and turns them into progression at the end.
// Lead: new MatchAwards({localId,team,loadout}) at match start, onEvents(events,view) every frame,
// finish(view) once when the match ends. Merge the return value into the results passed to onEnd.
// Pro challenges are counted here too (ProTracker), for the perks in use at each spawn; the result carries `proProgress`
// and Pro perks and calling cards earned in `unlocks` (kinds 'pro' and 'card', first in the list).
import { Progress } from '../ui/progress.js';
import { MATCH_XP, WEAPON_XP, longshotDist, ProTracker } from '../shared/progression.js';

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
    this.result = null;
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

  onEvents(events, view) {
    this.pro.onEvents(events, view);
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
  }

  // Applies the match to the save once; a repeat call returns the same result.
  finish(view) {
    if (this.result) return this.result;
    const won = view?.winner === this.team;
    const drawn = view?.winner === null || view?.winner === undefined;
    const lines = [['Match played', MATCH_XP.played]];
    if (this.kills) lines.push([`Kills x${this.kills}`, this.kills * MATCH_XP.kill]);
    if (this.headshots) lines.push([`Headshots x${this.headshots}`, this.headshots * MATCH_XP.headshot]);
    if (this.assists) lines.push([`Assists x${this.assists}`, this.assists * MATCH_XP.assist]);
    if (this.medalCount) lines.push([`Medals x${this.medalCount}`, this.medalCount * MATCH_XP.medal]);
    if (won) lines.push(['Win', MATCH_XP.win]);
    else if (drawn) lines.push(['Draw', MATCH_XP.draw]);
    const total = lines.reduce((sum, l) => sum + l[1], 0);

    const applied = Progress.applyMatch({ xp: total, weapons: this.weapons, pro: this.pro.gains() });
    this.result = {
      xp: { total, lines },
      level: applied.level,
      weapons: applied.weapons,
      unlocks: applied.unlocks,
      proProgress: applied.proProgress,
      medals: { ...this.medals },
      stats: {
        kills: this.kills, headshots: this.headshots, longshots: this.longshots, slideKills: this.slideKills,
        equipmentKills: this.equipKills, streakKills: this.streakKills, assists: this.assists,
      },
    };
    return this.result;
  }
}
