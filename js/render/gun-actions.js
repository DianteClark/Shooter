// Working the action between shots (ROADMAP item 51, "visible reload variety"): a pump shotgun racks its fore-end, a
// bolt rifle's hand leaves the grip to throw the bolt, a lever gun flicks its lever. Cheap transforms only:
// js/render/characters.js asks cycleKindOf() on each shot, runs a timer, and adds cyclePose()'s offsets to the gun and
// to the hands' targets (fore hand back along the gun, grip hand up to the bolt). Nothing is allocated.
import { WEAPONS } from '../shared/weapons.js';

// 'pump' | 'bolt' | 'lever' | null for a weapon id. Read once per id and cached.
const KIND = new Map();
export function cycleKindOf(id) {
  if (KIND.has(id)) return KIND.get(id);
  const d = WEAPONS[id];
  let k = null;
  if (d && !d.melee) {
    if (id === 'lever') k = 'lever';
    else if (d.category === 'Sniper' && d.rpm <= 60 && id !== 'rail') k = 'bolt';
    else if (d.category === 'Shotgun' && !d.auto && d.shellReload && d.rpm <= 130) k = 'pump';
  }
  KIND.set(id, k);
  return k;
}

// Seconds each takes, and how long after the shot it starts (the recoil goes first).
export const CYCLE = { pump: { dur: 0.3, delay: 0.06 }, bolt: { dur: 0.55, delay: 0.12 }, lever: { dur: 0.32, delay: 0.05 } };

const bump = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(Math.PI * (u - a) / (b - a)));

// u 0..1 through the cycle. Writes { roll, pitch, x, fore, bolt }: gun offsets, how far the fore hand slides back
// (metres along the gun) and how much the grip hand goes to the bolt (0..1).
export function cyclePose(kind, u, o) {
  o.roll = o.pitch = o.x = o.fore = o.bolt = 0;
  if (kind === 'pump') {
    const back = bump(u, 0, 1);
    o.fore = back * 0.22; o.x = -back * 0.03; o.pitch = back * 0.05;
  } else if (kind === 'bolt') {
    // Hand up to the bolt, lift and pull it back, push it home, hand back down: the gun rolls a little toward it.
    const reach = bump(u, 0, 1), work = bump(u, 0.25, 0.8);
    o.bolt = Math.min(1, reach * 1.6); o.roll = -reach * 0.35 - work * 0.15; o.x = -work * 0.05; o.pitch = reach * 0.06;
  } else if (kind === 'lever') {
    const flick = bump(u, 0, 1);
    o.pitch = -flick * 0.22; o.roll = flick * 0.12;
  }
  return o;
}
