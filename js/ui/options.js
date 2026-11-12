// Player settings, stored on this device apart from the progression save so a save code never overrides them.
const KEY = 'switchyard-options';

// Ids match QUALITY_STEPS in js/render/quality.js. 'high' and 'low' keep their meaning from older saves.
export const QUALITY_LEVELS = [['auto', 'Auto'], ['ultra', 'Ultra'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['potato', 'Potato']];

// The in-match HUD's panels (js/ui/hud.js setHudSize): the streak tiles never go below their touch size.
export const HUD_SIZES = [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']];

export const OPTION_DEFAULTS = Object.freeze({
  quality: 'auto', sensitivity: 1, aimAssist: 1, lefty: false, hudSize: 'normal', voice: 1, sound: 1, music: 1, matchMusic: false, fps: false, touchDebug: false, autoRespawn: false,
  squad: '',     // Squad tag for public rooms (js/net/lobbies.js): letters and digits, up to 10; '' for none.
  hardcore: false,   // The Hardcore switch on the Multiplayer screen (and what a hosted friend room starts with).
  voiceMode: 'open',   // 'open': the mic sends while it is on. 'ptt': push to talk, only while the mic (or Talk) is held.
  // Controller (js/ui/gamepad.js, docs/CONTROLLER.md). padMap holds only the actions moved off their default button:
  // action id -> standard-mapping button index, or -1 for unbound.
  padDead: 0.15, padSens: 1, padInvertY: false, padMap: {},
});

// Slider-style settings: unit is the on-screen step, and what the bar and label report.
export const STEPPED = {
  sensitivity: { label: 'Aim stick speed', min: 0.6, max: 1.6, step: 0.1, text: v => v.toFixed(1) + 'x', hint: 'Thumb travel needed to fire' },
  aimAssist: { label: 'Aim assist', min: 0, max: 1, step: 0.25, text: v => (v === 0 ? 'Off' : Math.round(v * 100) + '%'), hint: 'Pull onto visible targets' },
  sound: { label: 'Sound effects', min: 0, max: 1, step: 0.1, text: v => Math.round(v * 100) + '%' },
  music: { label: 'Music', min: 0, max: 1, step: 0.1, text: v => Math.round(v * 100) + '%' },
  voice: { label: 'Team voice', min: 0, max: 1, step: 0.1, text: v => Math.round(v * 100) + '%' },
  padDead: { label: 'Stick deadzone', min: 0.05, max: 0.35, step: 0.05, text: v => Math.round(v * 100) + '%', hint: 'Stick travel ignored around centre' },
  padSens: { label: 'Aim sensitivity', min: 0.5, max: 2, step: 0.1, text: v => v.toFixed(1) + 'x', hint: 'How fast the aim follows the right stick' },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...OPTION_DEFAULTS };
    for (const key of Object.keys(OPTION_DEFAULTS)) if (typeof raw[key] === typeof OPTION_DEFAULTS[key]) out[key] = raw[key];
    if (!QUALITY_LEVELS.some(([id]) => id === out.quality)) out.quality = 'auto';
    if (!HUD_SIZES.some(([id]) => id === out.hudSize)) out.hudSize = 'normal';
    if (out.voiceMode !== 'open' && out.voiceMode !== 'ptt') out.voiceMode = 'open';
    const map = {};
    if (out.padMap && typeof out.padMap === 'object' && !Array.isArray(out.padMap)) {
      for (const [k, v] of Object.entries(out.padMap)) if (Number.isInteger(v) && v >= -1 && v < 20) map[k] = v;
    }
    out.padMap = map;
    out.squad = out.squad.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
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
