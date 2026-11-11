// Map registry. Each map is one file in ./maps; see ./maps/build.js for what the wall kinds block.
import railyard from './maps/railyard.js';
import harbor from './maps/harbor.js';
import neon from './maps/neon.js';
import dust from './maps/dust.js';
import frost from './maps/frost.js';
import topside from './maps/topside.js';
import sunken from './maps/sunken.js';
import harvest from './maps/harvest.js';
import pier from './maps/pier.js';
import foundry from './maps/foundry.js';
import range from './maps/range.js';
import turnstile from './maps/turnstile.js';
import overpass from './maps/overpass.js';
import downtown from './maps/downtown.js';
import oasis from './maps/oasis.js';
import canyon from './maps/canyon.js';

import ruins from './maps/ruins.js';
import canopy from './maps/canopy.js';
import riverbend from './maps/riverbend.js';
import expedition from './maps/expedition.js';
import icebreaker from './maps/icebreaker.js';
import { MODE_IDS, MODES } from './modes.js';

export const MAPS = { railyard, harbor, neon, dust, frost, topside, sunken, harvest, pier, foundry, turnstile, overpass, downtown, oasis, canyon, ruins, canopy, riverbend, expedition, icebreaker, range };
// Every map says which modes it hosts. A map that lists none hosts the 6v6 modes; Ground War maps list their own.
for (const id in MAPS) if (!MAPS[id].modes) MAPS[id].modes = MODE_IDS.filter(m => !MODES[m].large);
// What the vote and match setup offer. The firing range is reached from its own menu entry only.
export const MAP_IDS = Object.keys(MAPS).filter(id => !MAPS[id].hidden);
export const DEFAULT_MAP = 'railyard';

// Size tiers (docs/MAPS-OVERHAUL.md), smallest first. A map without `size` counts as medium. `label` heads the picker
// section; `weight` is the tier's share of a Random or Quick play roll, split evenly between its maps (huge maps only
// come up when the mode asked for is a Ground War mode, so they carry none).
export const SIZES = {
  small:  { id: 'small',  label: 'Small',  note: 'Close quarters', weight: 0.3 },
  medium: { id: 'medium', label: 'Medium', note: '6 v 6', weight: 0.45 },
  large:  { id: 'large',  label: 'Large',  note: 'Long lanes', weight: 0.25 },
  huge:   { id: 'huge',   label: 'Huge',   note: '16 v 16', weight: 0 },
};
export const SIZE_IDS = Object.keys(SIZES);
export const sizeOf = map => (map && SIZES[map.size] ? map.size : 'medium');

// Regions of the one world the maps belong to, for the tag on each map card.
export const REGIONS = {
  metro: 'Metro', desert: 'Desert', jungle: 'Jungle', arctic: 'Arctic', coast: 'Coast', industrial: 'Industrial', farmland: 'Farmland',
};
export const regionName = map => REGIONS[map?.region] ?? '';
