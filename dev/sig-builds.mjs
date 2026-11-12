// Signature builds for the balance rig: each gun's best build (dev/out/best-builds.json) with every one of its own
// signature attachments fitted in its slot (replacing what the best build had there; two signatures for one slot: the
// first). Conversion kits are left out: they change what the gun is, not how good it is. Guns with no signature keep
// their best build. This is what an Elite bot carries (botAttachments fits every signature) on top of a tuned kit, so
// it is the "signatures at their strongest" case.
//
//   node dev/sig-builds.mjs [--in=dev/out/best-builds.json] [--out=dev/out/sig-builds.json] [--only]
//   --only: stock plus the signatures (no best-build parts), to see the signatures on their own.
//   then: node dev/balance-sim.mjs --no-duels --builds=dev/out/sig-builds.json ...
import { readFileSync, writeFileSync } from 'node:fs';
import { PRIMARY_IDS } from '../js/shared/constants.js';
import { WEAPONS } from '../js/shared/weapons.js';
import { availableFor, normalizeKit } from '../js/shared/attachments.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const best = JSON.parse(readFileSync(opt('in', 'dev/out/best-builds.json'), 'utf8'));
const only = args.includes('--only');
const out = {};
for (const gun of PRIMARY_IDS.filter(id => WEAPONS[id] && !WEAPONS[id].melee)) {
  const kit = only ? {} : { ...(best[gun]?.kit ?? {}) };
  const done = new Set();
  for (const a of availableFor(gun).filter(a => a.kind === 'sig')) {
    if (done.has(a.slot)) continue;
    kit[a.slot] = a.id; done.add(a.slot);
  }
  out[gun] = { kit: normalizeKit(gun, kit), sigs: [...done].map(s => kit[s]) };
}
writeFileSync(opt('out', only ? 'dev/out/sig-only.json' : 'dev/out/sig-builds.json'), JSON.stringify(out, null, 1));
console.log(Object.entries(out).map(([g, r]) => `${g}: ${r.sigs.join('+') || '-'}`).join(', '));
