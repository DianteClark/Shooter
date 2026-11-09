// Player settings, stored on this device apart from the progression save so a save code never overrides them.
const KEY = 'switchyard-options';

export const QUALITY_LEVELS = [['auto', 'Auto'], ['high', 'High'], ['low', 'Low Power']];

export const OPTION_DEFAULTS = Object.freeze({
  quality: 'auto', sensitivity: 1, aimAssist: 1, lefty: false, voice: 1, sound: 1, music: 1,
});

// Slider-style settings: unit is the on-screen step, and what the bar and label report.
export const STEPPED = {
  sensitivity: { label: 'Aim stick speed', min: 0.6, max: 1.6, step: 0.1, text: v => v.toFixed(1) + 'x', hint: 'Thumb travel needed to fire' },
  aimAssist: { label: 'Aim assist', min: 0, max: 1, step: 0.25, text: v => (v === 0 ? 'Off' : Math.round(v * 100) + '%'), hint: 'Pull onto visible targets' },
  sound: { label: 'Sound effects', min: 0, max: 1, step: 0.1, text: v => Math.round(v * 100) + '%' },
  music: { label: 'Music', min: 0, max: 1, step: 0.1, text: v => Math.round(v * 100) + '%' },
  voice: { label: 'Team voice', min: 0, max: 1, step: 0.1, text: v => Math.round(v * 100) + '%' },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...OPTION_DEFAULTS };
    for (const key of Object.keys(OPTION_DEFAULTS)) if (typeof raw[key] === typeof OPTION_DEFAULTS[key]) out[key] = raw[key];
    if (!QUALITY_LEVELS.some(([id]) => id === out.quality)) out.quality = 'auto';
    for (const [key, s] of Object.entries(STEPPED)) out[key] = clamp(out[key], s.min, s.max);
    return out;
  } catch {
    return { ...OPTION_DEFAULTS };
  }
}

const listeners = new Set();
let values = load();

export const Options = {
  get values() { return values; },
  get(key) { return values[key]; },

  set(key, value) {
    if (values[key] === value) return;
    values = { ...values, [key]: value };
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* private mode: settings last this session */ }
    for (const fn of listeners) fn(values, key);
  },

  step(key, direction) {
    const s = STEPPED[key];
    const next = clamp(Math.round((values[key] + direction * s.step) / s.step) * s.step, s.min, s.max);
    this.set(key, Number(next.toFixed(3)));
  },

  // cb(values, changedKey); also called once immediately so a subscriber is applied at startup.
  subscribe(cb) {
    listeners.add(cb);
    cb(values, null);
    return () => listeners.delete(cb);
  },
};
