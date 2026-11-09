// Map registry. Each map is one file in ./maps; see ./maps/build.js for what the wall kinds block.
import railyard from './maps/railyard.js';
import harbor from './maps/harbor.js';
import neon from './maps/neon.js';
import dust from './maps/dust.js';

export const MAPS = { railyard, harbor, neon, dust };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'railyard';
