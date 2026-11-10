# UI overhaul: AAA pass (owner: "pop and polish, eye grabbing at every scene")

## Direction: "Switchyard after dark"
Keep the established identity and push it to premium: a freight yard at dusk. Steel and ballast darks, sodium-lamp orange as the hero accent, team blue and red as signal lamps, chalk white text. Stencil display type for titles and numbers, a clean condensed face for body. Everything feels like heavy, engineered hardware: cut corners, bevelled plates, rivet and hazard-stripe details, subtle grain, light that sweeps across metal.

## Rules
- **One system.** Colors, type scale, spacing, radii and cut corners, shadows, and motion all come from `css/tokens.css` (custom properties) and `js/ui/motion.js`. No one-off values.
- **One icon set.** `js/ui/icons.js` returns crisp original SVG icons for every weapon (silhouette per gun), category, perk, streak, tactical, lethal, mode, map, medal and UI action, drawn in one consistent style. No emoji, no letters as icons, nothing traced from real games.
- **Motion with purpose.** Staggered entrances, parallax, number roll-ups, impact flashes, sweeping light on focus. Transforms and opacity only; respect `prefers-reduced-motion`. Every tap gets instant pressed feedback and a UI sound (`audio.uiClick` and kin).
- **Every screen, every state.** Loading, empty, error, locked, disabled, long names, max values, 8 iPhone sizes from 667x375 to 956x440 with safe areas. No clipped text, no overlap, nothing unreadable over the game world.
- **iPhone budget.** 60 fps on menus and HUD: no layout thrash, no large blur stacks; `backdrop-filter` only on small panels and never during a match; animate only transform/opacity; images pre-sized.
- **Gallery.** `dev/ui-gallery.html` shows every screen and HUD state side by side at chosen sizes, for review.
