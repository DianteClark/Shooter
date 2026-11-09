// Stroke icons on a 32x32 grid, shared by the touch controls and the loadout screen.
export const ITEM_ICONS = {
  uav: '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="5"/><path d="M16 16L25 9"/>',
  turret: '<path d="M4 12h16l8 2.5L20 17H4zM12 17v5M12 22l-7 6M12 22l7 6"/>',
  strike: '<circle cx="16" cy="16" r="9"/><path d="M16 3v9M16 20v9M3 16h9M20 16h9"/>',
  gunship: '<path d="M16 3l3 9 10 5v3l-10-2v6l3 3v2l-6-2-6 2v-2l3-3v-6L3 20v-3l10-5z"/>',
  smoke: '<path d="M9 24a6 6 0 0 1-1-12 8 8 0 0 1 15-2 7 7 0 0 1 1 14z"/>',
  flash: '<circle cx="16" cy="16" r="4"/><path d="M16 3v6M16 23v6M3 16h6M23 16h6M7 7l4 4M21 21l4 4M25 7l-4 4M11 21l-4 4"/>',
  stim: '<path d="M12 4h8v8h8v8h-8v8h-8v-8H4v-8h8z"/>',
  frag: '<path d="M11 12h10l3 6-2 9H10l-2-9zM13 12V7h6v5M19 8l6-4"/>',
  sticky: '<path d="M16 4l9 5v9l-9 5-9-5V9zM11 22v5M21 22v5M16 23v6"/>',
  slide: '<path d="M4 20h24M7 15l9 2 5-6 5 1M15 8a2.5 2.5 0 1 0 0-.01"/>',
  swap: '<path d="M5 11h19l-5-5M27 21H8l5 5"/>',
  lock: '<path d="M9 14h14v12H9zM12 14v-4a4 4 0 0 1 8 0v4"/>',
  // Streaks
  jammer: '<path d="M16 15v13M10 22h12M16 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 5a11 11 0 0 0 0 14M24 5a11 11 0 0 1 0 14M4 3l24 24"/>',
  resupply: '<path d="M5 12l11-6 11 6v12l-11 6-11-6zM5 12l11 6 11-6M16 18v12M11 3l5 3 5-3"/>',
  mortar: '<path d="M8 27l11-17 5 3-11 17zM14 21l6 6M19 4l2 1M25 6l2 1M23 2l2 1"/>',
  overwatch: '<path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8-13-8-13-8zM16 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>',
  chopper: '<path d="M3 8h26M16 8v5M9 13h12l5 5-5 4H9a5 5 0 0 1 0-9zM26 18h4M12 22v4h8v-4"/>',
  emp: '<path d="M18 3L8 18h7l-2 11 11-16h-8z"/>',
  // Tactical and lethal
  decoy: '<path d="M16 3a13 13 0 1 0 0 26 13 13 0 0 0 0-26zM10 12h4M18 12h4M10 21c4-4 8-4 12 0"/>',
  sensor: '<path d="M16 16v12M11 28h10M16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 18a10 10 0 0 1 0-12M23 18a10 10 0 0 0 0-12"/>',
  trophy: '<path d="M9 28h14M16 28v-8M6 12a10 10 0 0 0 20 0zM16 12V4M12 6l4-3 4 3"/>',
  molotov: '<path d="M13 12h6l3 5v11H10V17zM14 12V6h4v6M16 3c3 1 4 2 3 4"/>',
  mine: '<path d="M5 22a11 8 0 0 1 22 0zM3 22h26M16 14V9M12 9h8"/>',
  cluster: '<path d="M16 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM7 18a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM25 18a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM16 21a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>',
  hatchet: '<path d="M12 3l-3 25M9 6c5-2 13-1 16 5-5 0-10 2-16 3z"/>',
  // Perks: Body
  marathon: '<path d="M18 5a2.5 2.5 0 1 0 .01 0M6 16l5-5 6 1-4 7 5 4 1 7M13 19l-3 6-6 1M17 12l5 4 5-1"/>',
  flak: '<path d="M16 3l11 4v9c0 7-5 11-11 13-6-2-11-6-11-13V7zM16 10l-2 6h4l-2 6"/>',
  quickmend: '<path d="M16 28S4 21 4 12a6.5 6.5 0 0 1 12-3 6.5 6.5 0 0 1 12 3c0 9-12 16-12 16zM10 15h4l2-4 2 7 2-3h3"/>',
  tacmask: '<path d="M4 11c8-4 16-4 24 0v8c-3 6-7 9-12 9s-9-3-12-9zM9 15h6M17 15h6M12 23h8"/>',
  adrenaline: '<path d="M3 16h7l3-9 5 18 3-9h8"/>',
  // Perks: Hands
  scavenger: '<path d="M5 20h22l-3 8H8zM8 20V8l5 4 3-6 3 6 5-4v12"/>',
  fasthands: '<path d="M12 3L6 17h8l-2 12 13-17h-8l3-9z"/>',
  strongarm: '<path d="M7 27c0-7 3-13 9-15l-3-6 7-2 3 8c3 6 1 12-3 15M13 21c4-2 7-2 10 0"/>',
  bandolier: '<path d="M4 5l24 22M7 12l5-5M12 17l5-5M17 22l5-5M4 10l2 2M23 26l2 2"/>',
  hardline: '<path d="M5 16l8 8 14-16M5 8h9M5 12h5"/>',
  // Perks: Senses
  ghost: '<path d="M6 28V14a10 10 0 0 1 20 0v14l-4-3-3 3-3-3-3 3-3-3zM12 13h2M18 13h2"/>',
  coldblood: '<path d="M16 3v26M5 9.5l22 13M27 9.5l-22 13M16 8l-3-3M16 8l3-3M16 24l-3 3M16 24l3 3"/>',
  deadsilence: '<path d="M3 12h5l7-6v20l-7-6H3zM20 12l8 8M28 12l-8 8"/>',
  tracker: '<path d="M16 3a13 13 0 1 0 0 26 13 13 0 0 0 0-26zM16 9a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 15v2M2 16h7M23 16h7"/>',
  engineer: '<path d="M6 26l11-11a7 7 0 0 1 9-9l-5 5 1 4 4 1 5-5a7 7 0 0 1-9 9L11 31z"/>',
  // Attachment slots
  optic: '<path d="M3 13h26v9H3zM7 13V9h6v4M19 13V9h6v4M3 22l-1 4M29 22l1 4"/>',
  barrel: '<path d="M2 12h20v8H2zM22 14h8v4h-8M7 12v8M12 12v8M17 12v8"/>',
  mag: '<path d="M10 3h12l2 11-3 15H12L9 14zM10 9h12M10 15h13"/>',
  grip: '<path d="M4 9h24v6H17l-2 13H8l2-13H4z"/>',
};

export const icon = id => `<svg viewBox="0 0 32 32" aria-hidden="true">${ITEM_ICONS[id] ?? ''}</svg>`;
