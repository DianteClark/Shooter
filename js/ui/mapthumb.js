// Map art for the vote and the solo picker, cached as image URLs by map id so each is only drawn once.
import { TEAMS } from '../shared/constants.js';
import { mapThumbnail } from '../render/world.js';

const WIDTH = 360;               // Card art is around 270 CSS pixels wide at most; this stays crisp without weighing much.
const cache = new Map();

export function mapImage(map) {
  let url = cache.get(map.id);
  if (!url) {
    url = mapThumbnail(map, { width: WIDTH, teams: TEAMS }).toDataURL('image/png');
    cache.set(map.id, url);
  }
  return url;
}
