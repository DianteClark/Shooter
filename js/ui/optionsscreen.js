// The settings screen. Every control is a tap target (no drags), and a tap patches only its own row.
import { Options, QUALITY_LEVELS, STEPPED } from './options.js';
import { esc } from './widgets.js';
import { VOICE_LEVELS_WORK } from '../net/voice.js';

const stepper = key => {
  const s = STEPPED[key];
  return `
    <div class="opt-row" data-key="${key}">
      <div class="opt-name"><b>${esc(s.label)}</b>${s.hint ? `<small>${esc(s.hint)}</small>` : ''}</div>
      <button class="opt-step" data-act="optStep" data-key="${key}" data-d="-1" aria-label="Less">&minus;</button>
      <i class="opt-bar"><i></i></i>
      <em class="opt-val"></em>
      <button class="opt-step" data-act="optStep" data-key="${key}" data-d="1" aria-label="More">+</button>
    </div>`;
};

export function optionsScreen(menu, { onBack, onPreviewSound }) {
  menu.el.dataset.screen = 'options';
  menu.el.innerHTML = `
    <header class="bar">
      <button class="back" data-act="optBack">Done</button>
      <h2>Options</h2>
    </header>
    <div class="opt-cols enter">
      <section class="opt-col">
        <h4>Graphics</h4>
        <div class="opt-row">
          <div class="opt-name"><b>Quality</b><small>Low Power saves battery and heat</small></div>
          <div class="opt-segs">${QUALITY_LEVELS.map(([id, label]) => `<button class="seg" data-act="optQuality" data-id="${id}">${label}</button>`).join('')}</div>
        </div>
        <h4>Controls</h4>
        ${stepper('sensitivity')}
        ${stepper('aimAssist')}
        <div class="opt-row">
          <div class="opt-name"><b>Left-handed</b><small>Mirrors the sticks and buttons</small></div>
          <button class="opt-toggle" data-act="optLefty"><i></i><b></b></button>
        </div>
      </section>
      <section class="opt-col">
        <h4>Audio</h4>
        ${stepper('sound')}
        ${stepper('music')}
        ${VOICE_LEVELS_WORK ? stepper('voice') : `
        <div class="opt-row">
          <div class="opt-name"><b>Team voice</b><small>This phone plays voice on or off</small></div>
          <button class="opt-toggle opt-voice" data-act="optVoice"><i></i><b></b></button>
        </div>`}
        <p class="opt-note">Settings stay on this phone and are not part of your save code.</p>
      </section>
    </div>`;
  const q = sel => menu.el.querySelector(sel);
  const paint = () => {
    const v = Options.values;
    for (const b of menu.el.querySelectorAll('[data-act="optQuality"]')) b.classList.toggle('on', b.dataset.id === v.quality);
    const toggle = q('.opt-toggle');
    toggle.classList.toggle('on', v.lefty);
    toggle.querySelector('b').textContent = v.lefty ? 'On' : 'Off';
    const voice = q('.opt-voice');
    if (voice) {
      voice.classList.toggle('on', v.voice > 0);
      voice.querySelector('b').textContent = v.voice > 0 ? 'On' : 'Off';
    }
    for (const row of menu.el.querySelectorAll('.opt-row[data-key]')) {
      const key = row.dataset.key, s = STEPPED[key], frac = (v[key] - s.min) / (s.max - s.min);
      row.querySelector('.opt-bar i').style.transform = `scaleX(${frac.toFixed(3)})`;
      row.querySelector('.opt-val').textContent = s.text(v[key]);
    }
  };
  menu.on({
    optBack: () => onBack(),
    optQuality: ({ id }) => { Options.set('quality', id); paint(); },
    optLefty: () => { Options.set('lefty', !Options.get('lefty')); paint(); },
    optVoice: () => { Options.set('voice', Options.get('voice') > 0 ? 0 : 1); paint(); },
    optStep: ({ key, d }) => {
      Options.step(key, Number(d));
      paint();
      if (key === 'sound') onPreviewSound?.();
    },
  });
  paint();
  menu.show();
}
