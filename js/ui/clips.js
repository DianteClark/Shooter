// Saved replay clips (docs/REPLAYS.md): up to MAX_CLIPS in IndexedDB, database CLIPS_DB (js/shared/reset.js wipes it with
// the progress). Two stores, so History lists clips without reading their frames: 'meta' (what the list shows) and
// 'data' (the packed clip, js/game/replay.js packClip). Every call resolves; failures come back as { ok: false, reason }.
import { packClip, unpackClip } from '../game/replay.js';
import { CLIPS_DB } from '../shared/reset.js';

export const MAX_CLIPS = 5;
export const CLIP_MAX_BYTES = 4 * 1024 * 1024;     // A clip bigger than this is thinned before it is stored.

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(CLIPS_DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('data')) d.createObjectStore('data', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onversionchange = () => { d.close(); dbp = null; };     // The reset's deleteDatabase must not wait on us.
      res(d);
    };
    req.onerror = () => rej(req.error);
    req.onblocked = () => rej(new Error('blocked'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('abort')); });
const ask = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

// Newest first: [{ id, at, mapId, mode, dur, bytes, kills, title }].
export async function listClips() {
  try {
    const d = await db();
    const all = await ask(d.transaction('meta').objectStore('meta').getAll());
    return all.sort((a, b) => b.at - a.at);
  } catch { return []; }
}

// Shot events are most of a clip's bytes; past the cap a shotgun's pellets go first, then every other shot's tracer.
function thin(clip) {
  const ev = clip.ev.map(e => (e.t === 'shot' && e.rays?.length > 1 ? { ...e, rays: [e.rays[0]] } : e));
  let rec = packClip({ ...clip, ev });
  if (rec.bytes <= CLIP_MAX_BYTES) return rec;
  const keep = [], keepAt = [];
  let odd = false;
  ev.forEach((e, i) => { if (e.t === 'shot' && (odd = !odd)) return; keep.push(e); keepAt.push(clip.evAt[i]); });
  rec = packClip({ ...clip, ev: keep, evAt: Float32Array.from(keepAt) });
  return rec.bytes <= CLIP_MAX_BYTES ? rec : null;
}

// Stores a clip. { ok, id } or { ok: false, reason: 'full' | 'big' | 'storage' }.
export async function saveClip(clip, extra = {}) {
  try {
    const d = await db();
    const n = await ask(d.transaction('meta').objectStore('meta').count());
    if (n >= MAX_CLIPS) return { ok: false, reason: 'full' };
    let rec = packClip(clip);
    if (rec.bytes > CLIP_MAX_BYTES) rec = thin(clip);
    if (!rec) return { ok: false, reason: 'big' };
    const id = `c${clip.at.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const kills = clip.ev.filter(e => e.t === 'kill' && e.by === clip.localId && e.target !== clip.localId).length;
    const meta = { id, at: clip.at, mapId: clip.mapId, mode: clip.mode, dur: clip.dur, bytes: rec.bytes, kills, ...extra };
    const tx = d.transaction(['meta', 'data'], 'readwrite');
    tx.objectStore('meta').put(meta);
    tx.objectStore('data').put({ id, rec });
    await done(tx);
    clip.savedId = id;
    return { ok: true, id };
  } catch (err) {
    console.error('save clip', err);
    return { ok: false, reason: 'storage' };
  }
}

export async function loadClip(id) {
  try {
    const d = await db();
    const row = await ask(d.transaction('data').objectStore('data').get(id));
    if (!row) return null;
    const clip = unpackClip(row.rec);
    clip.savedId = id;
    return clip;
  } catch (err) { console.error('load clip', err); return null; }
}

export async function deleteClip(id) {
  try {
    const d = await db();
    const tx = d.transaction(['meta', 'data'], 'readwrite');
    tx.objectStore('meta').delete(id);
    tx.objectStore('data').delete(id);
    await done(tx);
    return true;
  } catch { return false; }
}
