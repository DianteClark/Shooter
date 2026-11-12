// Options > Accessibility (docs/ACCESSIBILITY.md): colour mode, menu text size, calmer effects, visual sound cues and the
// touch layout editor. Every setting is an Options key; main.js applyOptions puts it to work.
import { Options, TEXT_SIZES, CUE_LEVELS } from './options.js';
import { COLOR_MODES } from '../shared/palette.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';
import { layoutEditor } from './layouteditor.js';
import { layoutIsDefault } from './layout.js';

const segs = (act, list) => `<div class="opt-segs">${list.map(([id, label]) => `<button class="seg" data-act="${act}" data-id="${id}">${esc(label)}</button>`).join('')}</div>`;

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
          ${segs('a11yColor', COLOR_MODES)}
          <div class="a11y-swatch" aria-hidden="true"><i class="sw-ally"></i><b>Your side</b><i class="sw-enemy"></i><b>Enemy</b><i class="sw-go"></i><b>Ready</b></div>
        </div>
        <div class="opt-row a11y-stack">
          <div class="opt-name"><b>Menu text size</b><small>Menus and screens; the HUD has HUD size</small></div>
          ${segs('a11yText', TEXT_SIZES)}
        </div>
        <div class="opt-row">
          <div class="opt-name"><b>Reduce shake and flashes</b><small>Less camera shake, dim explosions, a dark flashbang veil, no blinking</small></div>
          <button class="opt-toggle a11y-calm" data-act="a11yCalm"><i class="opt-knob"></i><b></b></button>
        </div>
      </section>
      <section class="opt-col scroll-y" data-in="up">
        <h4>${ico('ui:volume')}Hearing and touch</h4>
        <div class="opt-row a11y-stack">
          <div class="opt-name"><b>Sound cues</b><small>Grenades near you as a marker that points at them. Steps: enemy footsteps you would hear, as an arc on their side</small></div>
          ${segs('a11yCues', CUE_LEVELS)}
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
    for (const [act, key] of [['a11yColor', 'colorMode'], ['a11yText', 'textSize'], ['a11yCues', 'cues']]) {
      for (const b of menu.el.querySelectorAll(`[data-act="${act}"]`)) b.classList.toggle('on', b.dataset.id === v[key]);
    }
    q('.a11y-cb-note').textContent = COLOR_NOTES[v.colorMode] ?? '';
    const calm = q('.a11y-calm');
    calm.classList.toggle('on', v.calm);
    calm.querySelector('b').textContent = v.calm ? 'On' : 'Off';
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
    a11yLayout: () => layoutEditor({ onClose: paint }),
    a11yLayoutReset: () => { Options.set('layout', {}); paint(); },
  });
  paint();
  menu.show();
}
