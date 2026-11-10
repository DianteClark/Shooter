// Map registry. Each map is one file in ./maps; see ./maps/build.js for what the wall kinds block.
import railyard from './maps/railyard.js';
import harbor from './maps/harbor.js';
import neon from './maps/neon.js';
import dust from './maps/dust.js';
import frost from './maps/frost.js';
import topside from './maps/topside.js';
import sunken from './maps/sunken.js';
import range from './maps/range.js';

export const MAPS = { railyard, harbor, neon, dust, frost, topside, sunken, range };
// What the vote and match setup offer. The firing range is reached from its own menu entry only.
export const MAP_IDS = Object.keys(MAPS).filter(id => !MAPS[id].hidden);
export const DEFAULT_MAP = 'railyard';
