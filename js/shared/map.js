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
import millbrook from './maps/millbrook.js';
import ashgrove from './maps/ashgrove.js';   // Graveyard Shift only (hidden, no modes of its own).
import polestar from './maps/polestar.js';   // Graveyard Shift only, like Ashgrove.
import wrenfield from './maps/wrenfield.js';   // Graveyard Shift only: the third built for it.
import frontier from './maps/br-frontier.js';
import jadefall from './maps/br-jadefall.js';
import tidebreak from './maps/gw-tidebreak.js';   // Ground War on Jadefall's coast.
import coral from './maps/gw-coral.js';   // The second battle royale island (docs/BR.md "Jadefall").
import brtest from './maps/brtest.js';     // Battle royale test map: small, fast to build, used by dev/sim-br.mjs.
// ROADMAP 56: new 6v6 maps, appended (ids and order of the ones above never change).
import launchpad from './maps/launchpad.js';
import observatory from './maps/observatory.js';
import pagoda from './maps/pagoda.js';
// ROADMAP 66/67 (docs/DISTRICTS.md): Meridian City's four districts, each a 6v6 map, and the city assembled from them.
import midtown from './maps/midtown.js';
import oldquarter from './maps/oldquarter.js';
import canalrow from './maps/canalrow.js';
import unionsq from './maps/unionsq.js';
import meridian from './maps/br-meridian.js';
import saltmere from './maps/saltmere.js';   // Graveyard Shift only: the fourth built for it (appended).
// The second region (docs/DISTRICTS.md): Sirocco Basin's four districts, each a 6v6 map, and the basin assembled from them.
import caravanserai from './maps/caravanserai.js';
import redgulch from './maps/redgulch.js';
import copperstep from './maps/copperstep.js';
import signalridge from './maps/signalridge.js';
import sirocco from './maps/br-sirocco.js';
// The Coast (docs/DISTRICTS.md): Kittiwake Bay's four districts, each a 6v6 map, and the bay assembled from them.
import fishmarket from './maps/fishmarket.js';
import shipyard from './maps/shipyard.js';
import boardwalk from './maps/boardwalk.js';
import stiltrow from './maps/stiltrow.js';
import kittiwake from './maps/br-kittiwake.js';
import { MODE_IDS, MODES } from './modes.js';
import { prepareBreakables } from './destruction.js';

export const MAPS = { railyard, harbor, neon, dust, frost, topside, sunken, harvest, pier, foundry, turnstile, overpass, downtown, oasis, canyon, ruins, canopy, riverbend, expedition, tidebreak, coral, icebreaker, millbrook, ashgrove, polestar, wrenfield, range, frontier, jadefall, brtest, launchpad, observatory, pagoda, midtown, oldquarter, canalrow, unionsq, meridian, saltmere, caravanserai, redgulch, copperstep, signalridge, sirocco,
  fishmarket, shipyard, boardwalk, stiltrow, kittiwake };
// Every map says which modes it hosts. A map that lists none hosts the 6v6 modes; Ground War maps list their own.
for (const id in MAPS) if (!MAPS[id].modes) MAPS[id].modes = MODE_IDS.filter(m => !MODES[m].large);
// Destruction (docs/DESTRUCTION.md): what breaks on each map, resolved once here, before anything indexes the walls.
for (const id in MAPS) prepareBreakables(MAPS[id]);
// What the vote and match setup offer. The firing range is reached from its own menu entry only.
// Giant battle royale maps (docs/BR.md) are never in a 6v6 or Ground War rotation, the solo picker's size sections or
// the menu backdrop: the battle royale mode lists them itself (BR_MAP_IDS).
export const MAP_IDS = Object.keys(MAPS).filter(id => !MAPS[id].hidden && MAPS[id].size !== 'giant');
export const BR_MAP_IDS = Object.keys(MAPS).filter(id => MAPS[id].size === 'giant');
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
  metro: 'Metro', desert: 'Desert', jungle: 'Jungle', arctic: 'Arctic', coast: 'Coast', industrial: 'Industrial', farmland: 'Farmland', mountain: 'Mountain',
};
export const regionName = map => REGIONS[map?.region] ?? '';
