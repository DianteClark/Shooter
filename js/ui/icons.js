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
};

export const icon = id => `<svg viewBox="0 0 32 32" aria-hidden="true">${ITEM_ICONS[id] ?? ''}</svg>`;
