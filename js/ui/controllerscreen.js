// Options > Controller (docs/CONTROLLER.md): the stick settings and the button map for in-match actions.
// Tap (or press A on) an action, then press the controller button it should use; the action that had that button
// takes the old one. Everything is saved in Options (padDead, padSens, padInvertY, padMap).
import { Options, STEPPED } from './options.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';
import { pop } from './motion.js';
import { PAD_ACTIONS, Pad, bindingOf, bindAction, buttonName, resetBindings } from './gamepad.js';

const NOTCHES = 10;
const LISTEN_MS = 6000;

const stepper = key => {
  const s = STEPPED[key];
  return `
    <div class="opt-row" data-key="${key}">
      <div class="opt-name"><b>${esc(s.label)}</b>${s.hint ? `<small>${esc(s.hint)}</small>` : ''}</div>
      <div class="opt-stepper">
        <button class="opt-step" data-act="padStep" data-key="${key}" data-d="-1" aria-label="Less">${ico('minus')}</button>
        <i class="opt-bar">${'<i></i>'.repeat(NOTCHES)}</i>
        <button class="opt-step" data-act="padStep" data-key="${key}" data-d="1" aria-label="More">${ico('plus')}</button>
        <em class="opt-val"></em>
      </div>
    </div>`;
};

export function controllerScreen(menu, { onBack }) {
  menu.el.dataset.screen = 'controller';
  menu.el.innerHTML = `
    ${header({ back: 'padBack', label: 'Done', title: 'Controller' })}
    <div class="pad-cols">
      <section class="opt-col pad-set" data-in="up">
        <h4>${ico('ui:controls')}Sticks</h4>
        <p class="pad-status"></p>
        ${stepper('padDead')}
        ${stepper('padSens')}
        <div class="opt-row">
          <div class="opt-name"><b>Invert Y</b><small>Right stick up aims down the screen</small></div>
          <button class="opt-toggle pad-invert" data-act="padInvert"><i class="opt-knob"></i><b></b></button>
        </div>
        <button class="seg pad-reset" data-act="padReset">${ico('ui:refresh')}<b>Default buttons</b></button>
      </section>
      <section class="opt-col pad-map" data-in="up">
        <h4>${ico('ui:gunsmith')}Buttons<small>Tap an action, then press a button</small></h4>
        <div class="pad-binds scroll-y">${PAD_ACTIONS.map(a => `
          <button class="pad-bind" data-act="padBind" data-id="${a.id}"><span>${esc(a.name)}</span><kbd class="pad-key"></kbd></button>`).join('')}
        </div>
      </section>
    </div>`;
  const q = sel => menu.el.querySelector(sel);
  let listening = null, timer = 0;

  const paint = () => {
    if (menu.el.dataset.screen !== 'controller') return;
    const v = Options.values;
    q('.pad-status').textContent = Pad.connected
      ? `${Pad.name || 'Controller'} connected. Menus: d-pad moves, ${buttonName(0)} picks, ${buttonName(1)} goes back, ${buttonName(4)}/${buttonName(5)} switch tabs.`
      : 'No controller yet. Pair one in the phone\'s Bluetooth settings, then press any of its buttons.';
    const inv = q('.pad-invert');
    inv.classList.toggle('on', v.padInvertY);
    inv.querySelector('b').textContent = v.padInvertY ? 'On' : 'Off';
    for (const row of menu.el.querySelectorAll('.opt-row[data-key]')) {
      const key = row.dataset.key, s = STEPPED[key], frac = (v[key] - s.min) / (s.max - s.min);
      const lit = Math.round(frac * NOTCHES);
      row.querySelectorAll('.opt-bar i').forEach((n, i) => n.classList.toggle('on', i < lit));
      row.querySelector('.opt-val').textContent = s.text(v[key]);
      for (const b of row.querySelectorAll('.opt-step')) b.disabled = b.dataset.d < 0 ? v[key] <= s.min + 1e-6 : v[key] >= s.max - 1e-6;
    }
    for (const b of menu.el.querySelectorAll('.pad-bind')) {
      const on = b.dataset.id === listening;
      b.classList.toggle('listen', on);
      const k = buttonName(bindingOf(b.dataset.id));
      b.querySelector('.pad-key').textContent = on ? 'Press a button' : k || 'None';
      b.classList.toggle('unbound', !k && !on);
    }
  };

  const stopListening = () => {
    clearTimeout(timer);
    listening = null;
    Pad.input?.listen(null);
  };

  const listen = id => {
    if (listening === id) { stopListening(); paint(); return; }
    stopListening();
    listening = id;
    timer = setTimeout(() => { stopListening(); paint(); }, LISTEN_MS);
    Pad.input?.listen(button => {
      clearTimeout(timer);
      const was = listening;
      listening = null;
      bindAction(was, button);
      paint();
      pop(menu.el.querySelector(`.pad-bind[data-id="${was}"] .pad-key`), { scale: 1.2 });
    });
    paint();
  };

  if (Pad.input) Pad.input.onChange = paint;
  menu.on({
    padBack: () => { stopListening(); if (Pad.input) Pad.input.onChange = null; onBack(); },
    padStep: ({ key, d }) => {
      Options.step(key, Number(d));
      paint();
      pop(menu.el.querySelector(`.opt-row[data-key="${key}"] .opt-val`), { scale: 1.25 });
    },
    padInvert: () => { Options.set('padInvertY', !Options.get('padInvertY')); paint(); },
    padReset: () => { stopListening(); resetBindings(); paint(); menu.toast('Controller buttons back to default'); },
    padBind: ({ id }) => listen(id),
  });
  paint();
  menu.show();
}
