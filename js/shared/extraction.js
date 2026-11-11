// Extraction rewards and the exclusive unlocks (docs/EXTRACT.md), shared by the awards (js/game/awards.js), the save
// rules (js/shared/progression.js), the operator and camo gates and the results screen. Data and pure functions only.
import { EX, CONTRACT_NAMES } from './modes.js';

// Items only extraction pays for. Each counts one lifetime tally in the save (`save.life[key]`, added when a squad
// banks contracts by getting out); `goal` of it opens the item. Achievable over several matches: a squad banks two to
// six contracts in a good run, of mixed types.
export const EX_UNLOCKS = [
  { id: 'operator:courier', kind: 'operator', item: 'courier', name: 'Courier', key: 'ex:intel', goal: 4, label: 'Bank 4 Secure Intel contracts' },
  { id: 'perk:hardtarget', kind: 'perk', item: 'hardtarget', name: 'Hard Target', key: 'ex:escort', goal: 4, label: 'Bank 4 Escort Asset contracts' },
  { id: 'streak:blackbird', kind: 'streak', item: 'blackbird', name: 'Blackbird', key: 'ex:hack', goal: 4, label: 'Bank 4 Hack Terminal contracts' },
  { id: 'streak:vulture', kind: 'streak', item: 'vulture', name: 'Vulture', key: 'ex:hvt', goal: 5, label: 'Bank 5 Eliminate HVT contracts' },
  { id: 'camo:blackbox', kind: 'camo', item: 'blackbox', name: 'Black Box', key: 'ex:cache', goal: 4, label: 'Bank 4 Destroy Cache contracts' },
  { id: 'camo:flare', kind: 'camo', item: 'flare', name: 'Exfil Flare', key: 'ex:big', goal: 3, label: 'Extract 3 times with 4 or more contracts' },
  { id: 'operator:nightjar', kind: 'operator', item: 'nightjar', name: 'Nightjar', key: 'ex:contracts', goal: 20, label: 'Bank 20 contracts of any kind' },
];
const BY_ID = new Map(EX_UNLOCKS.map(u => [u.id, u]));
export const exUnlock = (kind, item) => BY_ID.get(`${kind}:${item}`) ?? null;
export const BIG_HAUL = 4;          // Contracts in one extraction that count for Exfil Flare.

// {value, goal, done, label} for one exclusive item against a save's lifetime counts.
export function exUnlockStatus(u, life = {}) {
  const value = Math.min(u.goal, Math.floor(life?.[u.key] ?? 0));
  return { id: u.id, kind: u.kind, item: u.item, name: u.name, label: u.label, goal: u.goal, value, done: value >= u.goal };
}

// What one squad's extraction (or none) pays the local player, from the match's extraction view (js/sim/extract.js
// view()). Returns XP lines, weapon XP for the primary, operator mastery seconds and the lifetime counts it adds.
//   squad: {pot, banked, extracted}; me: the player's view ({out}); primary: weapon id; operator: id.
export function extractionPay(squad, { primary = null, operator = null } = {}) {
  const lines = [], life = {}, banked = squad?.extracted ? squad.banked ?? [] : [];
  let weaponXp = 0, opSecs = 0;
  if (!squad) return { extracted: false, lines, weaponXp, opSecs, life, banked: [], lost: [] };
  if (squad.extracted) {
    lines.push(['Extracted', EX.extractXp]);
    for (const c of banked) {
      lines.push([`${CONTRACT_NAMES[c.type] ?? 'Contract'} (tier ${c.tier})`, EX.reward.xp[c.tier] ?? 0]);
      weaponXp += EX.reward.weaponXp[c.tier] ?? 0;
      opSecs += EX.reward.opSecs[c.tier] ?? 0;
      life[`ex:${c.type}`] = (life[`ex:${c.type}`] ?? 0) + 1;
    }
    life['ex:out'] = 1;
    if (banked.length) life['ex:contracts'] = banked.length;
    if (banked.length >= BIG_HAUL) life['ex:big'] = 1;
  } else lines.push(['Took part', EX.stayXp]);
  const lost = squad.extracted ? squad.pot ?? [] : [...(squad.banked ?? []), ...(squad.pot ?? [])];
  return { extracted: !!squad.extracted, lines, weaponXp: primary ? weaponXp : 0, opSecs: operator ? opSecs : 0, life, banked, lost };
}
