// Options > Accessibility (docs/ACCESSIBILITY.md): colour mode, high-contrast HUD, menu text size, calmer effects, visual
// sound cues, gunfire marks, sound captions, haptics, the left hand, controller hold or toggle, and the touch layout
// editor. Every setting is an Options key; main.js applyOptions puts it to work.
import { Options, TEXT_SIZES, CUE_LEVELS, HOLD_MODES } from './options.js';
import { hapticsSupported } from './haptics.js';
import { COLOR_MODES } from '../shared/palette.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';
import { layoutEditor } from './layouteditor.js';
import { layoutIsDefault } from './layout.js';

const segs = (act, list, name = '') => `<div class="opt-segs" role="radiogroup"${name ? ` aria-label="${esc(name)}"` : ''}>${list.map(([id, label]) => `<button class="seg" role="radio" data-act="${act}" data-id="${id}">${esc(label)}</button>`).join('')}</div>`;
const toggle = (act, cls, name) => `<button class="opt-toggle ${cls}" data-act="${act}" role="switch" aria-label="${esc(name)}"><i class="opt-knob"></i><b></b></button>`;
// On/off rows: [action, class, Options key, name, note]. Haptics only where the browser can vibrate.
const SWITCHES = [
  ['a11yHc', 'a11y-hc', 'hudContrast', 'High-contrast HUD', 'Solid plates behind HUD text, heavier hit marks and outlines, with any colour mode'],
  ['a11yShots', 'a11y-shots', 'shotCues', 'Gunfire marks', 'Enemy gunfire you would hear, as a dashed red arc on its side'],
  ['a11yCaps', 'a11y-caps', 'captions', 'Sound captions', 'A line for each important sound and where it came from: gunfire, explosions, enemy streaks'],
  ['a11yHaptics', 'a11y-haptics', 'haptics', 'Haptics', 'Vibrate on hits, kills and being hit (where the browser can)'],
  ['a11yLefty', 'a11y-lefty', 'lefty', 'Left-handed', 'Mirrors the sticks, buttons and the whole HUD'],
];
const switchRow = ([act, cls, , name, note]) => `<div class="opt-row"><div class="opt-name"><b>${esc(name)}</b><small>${esc(note)}</small></div>${toggle(act, cls, name)}</div>`;

// What each colour mode is for, under its buttons.
const COLOR_NOTES = {
  off: 'The usual blue and red',
  protan: 'Red-weak: blue against yellow, dashed enemy rings, hatched enemy feed rows',
  deutan: 'Green-weak: blue against yellow, dashed enemy rings, hatched enemy feed rows',
  tritan: 'Blue-weak: teal against rose, dashed enemy rings, hatched enemy feed rows',
  contrast: 'Brightest colours, solid HUD plates and heavier outlines',
};

export function a11yScreen(menu, { onBack }) {
  menu.el.dataset.screen = 'a11y';
  menu.el.innerHTML = `
    ${header({ back: 'a11yBack', label: 'Done', title: 'Accessibility' })}
    <div class="a11y-cols">
      <section class="opt-col scroll-y" data-in="up">
        <h4>${ico('ui:eye')}Seeing</h4>
        <div class="opt-row a11y-stack">
          <div class="opt-name"><b>Colour mode</b><small class="a11y-cb-note"></small></div>
          ${segs('a11yColor', COLOR_MODES, 'Colour mode')}
          <div class="a11y-swatch" aria-hidden="true"><i class="sw-ally"></i><b>Your side</b><i class="sw-enemy"></i><b>Enemy</b><i class="sw-go"></i><b>Ready</b></div>
        </div>
        <div class="opt-row a11y-stack">
          <div class="opt-name"><b>Menu text size</b><small>Menus and screens; the HUD has HUD size</small></div>
          ${segs('a11yText', TEXT_SIZES, 'Menu text size')}
        </div>
        ${switchRow(SWITCHES[0])}
        <div class="opt-row">
          <div class="opt-name"><b>Reduce shake and flashes</b><small>Less camera shake, dim explosions, a dark flashbang veil, no blinking</small></div>
          ${toggle('a11yCalm', 'a11y-calm', 'Reduce shake and flashes')}
        </div>
      </section>
      <section class="opt-col scroll-y" data-in="up">
        <h4>${ico('ui:volume')}Hearing and touch</h4>
        <div class="opt-row a11y-stack">
          <div class="opt-name"><b>Sound cues</b><small>Grenades near you as a marker that points at them. Steps: enemy footsteps you would hear, as an arc on their side</small></div>
          ${segs('a11yCues', CUE_LEVELS, 'Sound cues')}
        </div>
        ${switchRow(SWITCHES[1])}
        ${switchRow(SWITCHES[2])}
        ${hapticsSupported() ? switchRow(SWITCHES[3]) : ''}
        ${switchRow(SWITCHES[4])}
        <div class="opt-row a11y-stack">
          <div class="opt-name"><b>Controller aim</b><small>Hold the aim button, or press once to aim in and again to aim out</small></div>
          ${segs('a11yPadAim', HOLD_MODES, 'Controller aim')}
        </div>
        <div class="opt-row a11y-stack">
          <div class="opt-name"><b>Controller sprint</b><small>Click once to sprint until you stop, or hold the button</small></div>
          ${segs('a11yPadSprint', HOLD_MODES, 'Controller sprint')}
        </div>
        <div class="opt-row a11y-stack">
          <div class="opt-name"><b>Touch layout</b><small class="a11y-lay-note"></small></div>
          <div class="a11y-lay">
            <button class="seg a11y-edit" data-act="a11yLayout">${ico('ui:edit')}<b>Edit layout</b></button>
            <button class="seg a11y-reset" data-act="a11yLayoutReset">${ico('ui:refresh')}<b>Reset</b></button>
          </div>
        </div>
      </section>
    </div>`;
  const q = sel => menu.el.querySelector(sel);
  const paint = () => {
    if (menu.el.dataset.screen !== 'a11y') return;
    const v = Options.values;
    for (const [act, key] of [['a11yColor', 'colorMode'], ['a11yText', 'textSize'], ['a11yCues', 'cues'], ['a11yPadAim', 'padAim'], ['a11yPadSprint', 'padSprint']]) {
      for (const b of menu.el.querySelectorAll(`[data-act="${act}"]`)) { b.classList.toggle('on', b.dataset.id === v[key]); b.setAttribute('aria-checked', String(b.dataset.id === v[key])); }
    }
    for (const [, cls, key] of SWITCHES) {
      const t = q(`.${cls}`);
      if (!t) continue;
      t.classList.toggle('on', v[key] === true);
      t.setAttribute('aria-checked', String(v[key] === true));
      t.querySelector('b').textContent = v[key] === true ? 'On' : 'Off';
    }
    q('.a11y-cb-note').textContent = COLOR_NOTES[v.colorMode] ?? '';
    const calm = q('.a11y-calm');
    calm.classList.toggle('on', v.calm);
    calm.querySelector('b').textContent = v.calm ? 'On' : 'Off';
    calm.setAttribute('aria-checked', String(!!v.calm));
    const custom = !layoutIsDefault(v.layout);
    q('.a11y-lay-note').textContent = custom
      ? `Custom: ${Object.keys(v.layout).length} control${Object.keys(v.layout).length === 1 ? '' : 's'} moved or resized${v.lefty ? ', mirrored for the left hand' : ''}`
      : 'Default. Drag the sticks and buttons where your thumbs want them and resize them';
    q('.a11y-reset').disabled = !custom;
  };
  menu.on({
    a11yBack: () => onBack(),
    a11yColor: ({ id }) => { Options.set('colorMode', id); paint(); },
    a11yText: ({ id }) => { Options.set('textSize', id); paint(); },
    a11yCues: ({ id }) => { Options.set('cues', id); paint(); },
    a11yCalm: () => { Options.set('calm', !Options.get('calm')); paint(); },
    ...Object.fromEntries(SWITCHES.map(([act, , key]) => [act, () => {
      Options.set(key, Options.get(key) !== true);
      if (key === 'haptics' && Options.get('haptics')) try { navigator.vibrate?.(20); } catch { /* blocked */ }
      paint();
    }])),
    a11yPadAim: ({ id }) => { Options.set('padAim', id); paint(); },
    a11yPadSprint: ({ id }) => { Options.set('padSprint', id); paint(); },
    a11yLayout: () => layoutEditor({ onClose: paint }),
    a11yLayoutReset: () => { Options.set('layout', {}); paint(); },
  });
  paint();
  menu.show();
}
