// Map registry. Each map is one file in ./maps; see ./maps/build.js for what the wall kinds block.
import railyard from './maps/railyard.js';
import harbor from './maps/harbor.js';
import neon from './maps/neon.js';
import dust from './maps/dust.js';
import frost from './maps/frost.js';
import topside from './maps/topside.js';
import sunken from './maps/sunken.js';
import harvest from './maps/harvest.js';
import range from './maps/range.js';
import turnstile from './maps/turnstile.js';
import overpass from './maps/overpass.js';
import downtown from './maps/downtown.js';
import oasis from './maps/oasis.js';
import canyon from './maps/canyon.js';
import { MODE_IDS, MODES } from './modes.js';

export const MAPS = { railyard, harbor, neon, dust, frost, topside, sunken, harvest, range, turnstile, overpass, downtown, oasis, canyon };
// Every map says which modes it hosts. A map that lists none hosts the 6v6 modes; Ground War maps list their own.
for (const id in MAPS) if (!MAPS[id].modes) MAPS[id].modes = MODE_IDS.filter(m => !MODES[m].large);
// What the vote and match setup offer. The firing range is reached from its own menu entry only.
export const MAP_IDS = Object.keys(MAPS).filter(id => !MAPS[id].hidden);
export const DEFAULT_MAP = 'railyard';
