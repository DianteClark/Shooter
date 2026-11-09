// Map art for the vote and the solo picker. A rendered snapshot at assets/maps/<id>.jpg is used when one exists; until it has
// loaded, or if there is none, the drawn top-down thumbnail stands in. Both are cached by map id, so each is made once.
import { TEAMS } from '../shared/constants.js';
import { mapThumbnail } from '../render/world.js';

const WIDTH = 360;               // Card art is around 270 CSS pixels wide at most; this stays crisp without weighing much.
const drawn = new Map();
const photos = new Map();        // map id -> url when loaded, null when absent, undefined until asked.
const waiting = new Map();       // map id -> [callback]

function thumbUrl(map) {
  let url = drawn.get(map.id);
  if (!url) {
    url = mapThumbnail(map, { width: WIDTH, teams: TEAMS }).toDataURL('image/png');
    drawn.set(map.id, url);
  }
  return url;
}

// The best art available right now. A first call for a map starts looking for its snapshot.
export function mapImage(map) {
  probe(map.id);
  return photos.get(map.id) ?? thumbUrl(map);
}

function probe(id) {
  if (photos.has(id) || waiting.has(id)) return;
  waiting.set(id, []);
  const img = new Image();
  const url = `assets/maps/${id}.jpg`;
  const finish = ok => {
    photos.set(id, ok ? url : null);
    const list = waiting.get(id);
    waiting.delete(id);
    if (ok) for (const fn of list) fn(url);
  };
  img.onload = () => finish(true);
  img.onerror = () => finish(false);
  img.src = url;
}

// Swaps a card's art in place once a snapshot has arrived, without touching anything else on the card.
export function followMapArt(root) {
  for (const art of root.querySelectorAll('.vc-art[data-map]')) {
    const id = art.dataset.map;
    if (photos.get(id)) {
      art.style.backgroundImage = `url(${photos.get(id)})`;
    } else if (waiting.has(id)) {
      waiting.get(id).push(url => { if (art.isConnected) art.style.backgroundImage = `url(${url})`; });
    }
  }
}
