// Live feel tuning (Wave 6). One registry of every number the tuning panel can change, read at use time by the code
// that owns the behaviour, so a change applies on the next frame with no reload. No DOM: the sim imports this in node.
//
//   TUNING[key]            current value, a plain property read (cheap enough for hot paths)
//   TUNABLES / GROUPS      the registry: key, group, label, help, min, max, step, def, unit
//   setTune(key, v)        clamps and snaps to the step; notifies listeners; persists
//   resetTune(key?)        one value, or every value when key is omitted
//   onTune(cb)             cb(key) after a change; key is null after a bulk change (reset all, import). Returns off().
//   exportTuning()         compact code of the values that differ from default
//   importTuning(code)     applies a code; returns how many values it set, or throws on a bad code
//
// Tuning is local to the phone. Movement and shots are client-authoritative, so a guest's tuning is what they play
// with; the host's copy also drives its bots, which step through the same stepPlayer.

export const GROUPS = [
  { id: 'move', label: 'Movement' },
  { id: 'aim', label: 'Aiming' },
  { id: 'controls', label: 'Controls' },
  { id: 'camera', label: 'Camera' },
];

const t = (group, key, label, def, min, max, step, unit, help) => ({ group, key, label, def, min, max, step, unit, help });

export const TUNABLES = [
  t('move', 'run', 'Run speed', 5.6, 3, 9, 0.1, 'm/s', 'Top speed with the stick held, before the gun\'s weight.'),
  t('move', 'sprint', 'Sprint speed', 7.9, 5, 12, 0.1, 'm/s', 'Top speed with the stick pushed to the sprint edge.'),
  t('move', 'accel', 'Acceleration', 75, 15, 160, 5, 'm/s²', 'How fast you reach run speed or turn. Lower feels heavier.'),
  t('move', 'slideBoost', 'Slide boost', 11.6, 6, 18, 0.2, 'm/s', 'Entry speed of a slide.'),
  t('move', 'slideDuration', 'Slide length', 0.58, 0.2, 1.2, 0.02, 's', 'Time a slide lasts before it bleeds to a run.'),
  t('move', 'slideCooldown', 'Slide cooldown', 1.15, 0, 3, 0.05, 's', 'Wait after a slide ends before the next.'),

  t('aim', 'adsTime', 'ADS time', 1, 0.3, 2.5, 0.05, '×', 'Multiplies every gun\'s aim-down-sights time. Lower is faster.'),
  t('aim', 'recoil', 'Recoil', 1, 0, 2.5, 0.05, '×', 'Multiplies every gun\'s recoil pattern.'),
  t('aim', 'spread', 'Spread', 1, 0.2, 2.5, 0.05, '×', 'Multiplies hipfire, ADS and bloom spread.'),
  t('aim', 'assist', 'Assist strength', 1, 0, 2.5, 0.05, '×', 'How far assist can hold your aim back on a target.'),
  t('aim', 'assistSlow', 'Assist slowdown', 1, 0, 2.5, 0.05, '×', 'How much stick turn is cancelled over a target.'),
  t('aim', 'assistReach', 'Assist reach', 1, 0.6, 3, 0.05, '×', 'Width of the zone around a body where assist works.'),
  t('aim', 'assistRange', 'Assist range', 30, 5, 60, 1, 'm', 'Targets further than this get no assist.'),

  t('controls', 'fireRing', 'Fire ring size', 52, 34, 90, 1, 'px', 'Aim stick travel before it fires. Options sensitivity scales it.'),
  t('controls', 'aimDeadzone', 'Aim deadzone', 8, 2, 24, 0.5, 'px', 'Aim thumb travel before the aim turns.'),
  t('controls', 'aimSmoothing', 'Aim smoothing', 1, 0, 3, 0.05, '×', 'Filtering of a slow aim thumb. 0 is raw.'),
  t('controls', 'leftSize', 'Move stick size', 64, 40, 110, 1, 'px', 'Radius of the move stick: thumb travel to full speed.'),
  t('controls', 'sprintAt', 'Sprint threshold', 0.92, 0.5, 1, 0.01, '', 'Fraction of the move stick that starts a sprint.'),

  t('camera', 'camKick', 'Camera kick', 1, 0, 3, 0.05, '×', 'Camera shove and zoom punch when you fire.'),
  t('camera', 'camShake', 'Screen shake', 1, 0, 3, 0.05, '×', 'Shake from firing, hits and explosions.'),
  t('camera', 'camLook', 'ADS lookahead', 7.5, 0, 15, 0.25, 'm', 'How far the camera leads toward your aim while ADS.'),
  t('camera', 'camZoom', 'Zoom out', 1, 0.8, 1.25, 0.01, '×', 'Camera distance. Higher shows more of the map.'),
];

export const TUNABLE = Object.fromEntries(TUNABLES.map(d => [d.key, d]));
export const TUNING = Object.fromEntries(TUNABLES.map(d => [d.key, d.def]));

const STORE = 'switchyard.tuning.v1';
const CODE_PREFIX = 'SYT1.';
const listeners = new Set();

const decimals = step => (String(step).split('.')[1] || '').length;

// Clamped to the range and snapped to the step grid, rounded so 0.1 + 0.2 stays 0.3.
export function cleanValue(key, v) {
  const d = TUNABLE[key];
  if (!d || !Number.isFinite(v)) return d ? d.def : v;
  const snapped = d.min + Math.round((v - d.min) / d.step) * d.step;
  return Number(Math.max(d.min, Math.min(d.max, snapped)).toFixed(decimals(d.step) + 1));
}

export const isTuned = key => TUNING[key] !== TUNABLE[key].def;
export const tunedCount = () => TUNABLES.reduce((n, d) => n + (isTuned(d.key) ? 1 : 0), 0);

export function onTune(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(key) {
  save();
  for (const cb of listeners) {
    try { cb(key); } catch (e) { console.warn('tuning listener', e); }
  }
}

export function setTune(key, v) {
  if (!TUNABLE[key]) return;
  const c = cleanValue(key, v);
  if (c === TUNING[key]) return;
  TUNING[key] = c;
  emit(key);
}

export function resetTune(key) {
  if (key) return setTune(key, TUNABLE[key]?.def);
  let any = false;
  for (const d of TUNABLES) if (TUNING[d.key] !== d.def) { TUNING[d.key] = d.def; any = true; }
  if (any) emit(null);
}

function changed() {
  const out = {};
  for (const d of TUNABLES) if (isTuned(d.key)) out[d.key] = TUNING[d.key];
  return out;
}

// Base64url of a JSON object of changed values only. An all-default code is just the prefix.
export function exportTuning() {
  const o = changed();
  if (!Object.keys(o).length) return CODE_PREFIX;
  return CODE_PREFIX + btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Sets every tunable: values the code names, defaults for the rest, so the result matches the exporting phone.
export function importTuning(code) {
  const s = String(code || '').trim();
  if (!s.startsWith(CODE_PREFIX)) throw new Error('Not a tuning code');
  const body = s.slice(CODE_PREFIX.length);
  let o = {};
  if (body) {
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    o = JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)));
    if (!o || typeof o !== 'object') throw new Error('Bad tuning code');
  }
  let n = 0;
  for (const d of TUNABLES) {
    const v = d.key in o ? cleanValue(d.key, Number(o[d.key])) : d.def;
    if (d.key in o) n++;
    TUNING[d.key] = v;
  }
  emit(null);
  return n;
}

// Coalesced: a slider drag changes a value every frame, and one write after it settles is enough.
let saveTimer = null;
function save() {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 300);
  saveTimer.unref?.();      // Node: a pending save must not keep a test process alive.
}

function saveNow() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORE, JSON.stringify(changed())); } catch { /* private mode */ }
}

function load() {
  try {
    if (typeof localStorage === 'undefined') return;
    const o = JSON.parse(localStorage.getItem(STORE) || '{}');
    for (const k in o) if (TUNABLE[k]) TUNING[k] = cleanValue(k, Number(o[k]));
  } catch { /* corrupt or unavailable: defaults */ }
}

load();
