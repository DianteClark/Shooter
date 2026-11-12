// The settings screen. Every control is a tap target (no drags), and a tap patches only its own row.
import { Options, QUALITY_LEVELS, HUD_SIZES, STEPPED } from './options.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';
import { pop } from './motion.js';
import { VOICE_LEVELS_WORK } from '../net/voice.js';
import { deviceProfile, savedAutoStep, QUALITY_STEPS } from '../render/quality.js';
import { controllerScreen } from './controllerscreen.js';
import { hapticsSupported } from './haptics.js';
import { fullscreenSupported, enterFullscreen } from './android.js';

const stepLabel = id => QUALITY_STEPS.find(s => s.id === id)?.label ?? id;

// What Auto will start from on this phone: the step it settled on last match, else the device guess.
function autoNote() {
  const saved = savedAutoStep();
  if (saved) return `Auto starts at ${stepLabel(saved)}, where it settled last match`;
  const p = deviceProfile(null);
  return `Auto starts at ${stepLabel(p.step)} on this phone, then adapts`;
}

const NOTCHES = 10;

const stepper = key => {
  const s = STEPPED[key];
  return `
    <div class="opt-row" data-key="${key}">
      <div class="opt-name"><b>${esc(s.label)}</b>${s.hint ? `<small>${esc(s.hint)}</small>` : ''}</div>
      <div class="opt-stepper">
        <button class="opt-step" data-act="optStep" data-key="${key}" data-d="-1" aria-label="Less">${ico('minus')}</button>
        <i class="opt-bar">${'<i></i>'.repeat(NOTCHES)}</i>
        <button class="opt-step" data-act="optStep" data-key="${key}" data-d="1" aria-label="More">${ico('plus')}</button>
        <em class="opt-val"></em>
      </div>
    </div>`;
};

const toggle = (act, cls = '') => `<button class="opt-toggle${cls ? ' ' + cls : ''}" data-act="${act}"><i class="opt-knob"></i><b></b></button>`;

// Audio's Mic chip: open mic or push to talk (js/net/voice.js). It rides on the column's heading, which has room to
// spare, as Controls' Controller button does: the columns are full at 393 px tall.
const voiceModeChip = `<button class="seg opt-voicemode" data-act="optVoiceMode" aria-label="Microphone mode"><small>Mic</small><b></b></button>`;

export function optionsScreen(menu, opts) {
  const { onBack, onPreviewSound, onSquad } = opts;
  menu.el.dataset.screen = 'options';
  menu.el.innerHTML = `
    ${header({ back: 'optBack', label: 'Done', title: 'Options' })}
    <div class="opt-cols">
      <section class="opt-col" data-in="up">
        <h4>${ico('graphics')}Graphics</h4>
        <div class="opt-row opt-quality">
          <div class="opt-name"><b>Quality</b><small>${esc(autoNote())}. Lower steps save battery and heat.</small></div>
          <div class="opt-segs">${QUALITY_LEVELS.map(([id, label]) => `<button class="seg" data-act="optQuality" data-id="${id}">${label}</button>`).join('')}</div>
        </div>
        <div class="opt-row">
          <div class="opt-name"><b>Performance overlay</b><small>Frame rate, 1% low, CPU or GPU bound, quality step</small></div>
          ${toggle('optFps', 'opt-fps')}
        </div>
        <div class="opt-row">
          <div class="opt-name"><b>Touch debug</b><small>Shows every finger and the last touch events. Screenshot it when a control misbehaves</small></div>
          ${toggle('optTouchDebug', 'opt-touchdebug')}
        </div>
        ${fullscreenSupported() ? `<div class="opt-row">
          <div class="opt-name"><b>Full screen</b><small>Hides the browser and system bars in a browser tab</small></div>
          ${toggle('optFullscreen', 'opt-fullscreen')}
        </div>` : ''}
      </section>
      <section class="opt-col" data-in="up">
        <h4>${ico('controls')}Controls<button class="seg opt-pad" data-act="optPad" aria-label="Controller settings">${ico('ui:controls')}<b>Controller</b></button></h4>
        ${stepper('sensitivity')}
        ${stepper('aimAssist')}
        <div class="opt-row">
          <div class="opt-name"><b>Left-handed</b><small>Mirrors the sticks, buttons and HUD</small></div>
          ${toggle('optLefty')}
        </div>
        <div class="opt-row opt-hudsize">
          <div class="opt-name"><b>HUD size</b><small>Health, weapon, feed and objectives</small></div>
          <div class="opt-segs">${HUD_SIZES.map(([id, label]) => `<button class="seg" data-act="optHudSize" data-id="${id}">${label}</button>`).join('')}</div>
        </div>
        <div class="opt-row">
          <div class="opt-name"><b>Auto-respawn</b><small>Respawn as soon as the timer ends</small></div>
          ${toggle('optAutoRespawn', 'opt-autorespawn')}
        </div>
        ${hapticsSupported() ? `<div class="opt-row">
          <div class="opt-name"><b>Vibrate on hits</b><small>A buzz when you are hit or land a hit</small></div>
          ${toggle('optHaptics', 'opt-haptics')}
        </div>` : ''}
      </section>
      <section class="opt-col" data-in="up">
        <h4>${ico('sound')}Audio${voiceModeChip}</h4>
        ${stepper('sound')}
        ${stepper('music').replace('<div class="opt-name"><b>Music</b>', `<div class="opt-name opt-name-mm"><b>Music</b><button class="seg opt-matchmusic" data-act="optMatchMusic" aria-label="Music in matches"><small>In matches</small><b></b></button>`)}
        ${VOICE_LEVELS_WORK ? stepper('voice') : `
        <div class="opt-row">
          <div class="opt-name"><b>Team voice</b><small>Plays your squad's voice on this phone</small></div>
          ${toggle('optVoice', 'opt-voice')}
        </div>`}
        <div class="opt-row opt-squad">
          <div class="opt-name"><b>Squad tag</b><small>Public rooms with a tag show only to the same tag</small></div>
          <div class="opt-squad-ctl">
            <button class="seg opt-squad-tag" data-act="optSquad"><b></b></button>
            <button class="opt-step opt-squad-clear" data-act="optSquadClear" aria-label="Clear squad tag">${ico('close')}</button>
          </div>
        </div>
        <p class="opt-note">${ico('info')}Settings stay on this phone and are not part of your save code.</p>
      </section>
    </div>`;
  const q = sel => menu.el.querySelector(sel);
  const paint = () => {
    const v = Options.values;
    for (const b of menu.el.querySelectorAll('[data-act="optQuality"]')) b.classList.toggle('on', b.dataset.id === v.quality);
    for (const b of menu.el.querySelectorAll('[data-act="optHudSize"]')) b.classList.toggle('on', b.dataset.id === v.hudSize);
    const fps = q('.opt-fps');
    fps.classList.toggle('on', v.fps);
    fps.querySelector('b').textContent = v.fps ? 'On' : 'Off';
    const td = q('.opt-touchdebug');
    td.classList.toggle('on', v.touchDebug);
    td.querySelector('b').textContent = v.touchDebug ? 'On' : 'Off';
    const ar = q('.opt-autorespawn');
    ar.classList.toggle('on', v.autoRespawn === true);
    ar.querySelector('b').textContent = v.autoRespawn === true ? 'On' : 'Off';
    for (const [cls, key] of [['.opt-haptics', 'haptics'], ['.opt-fullscreen', 'fullscreen']]) {
      const t = q(cls);
      if (!t) continue;
      t.classList.toggle('on', v[key] === true);
      t.querySelector('b').textContent = v[key] === true ? 'On' : 'Off';
    }
    const mm = q('.opt-matchmusic');
    mm.classList.toggle('on', v.matchMusic === true);
    mm.querySelector('b').textContent = v.matchMusic === true ? 'On' : 'Off';
    const vm = q('.opt-voicemode');
    vm.classList.toggle('on', v.voiceMode === 'ptt');
    vm.querySelector('b').textContent = v.voiceMode === 'ptt' ? 'Hold to talk' : 'Open';
    const tag = q('.opt-squad-tag');
    tag.classList.toggle('on', !!v.squad);
    tag.querySelector('b').textContent = v.squad || 'None';
    q('.opt-squad-clear').hidden = !v.squad;
    const toggle = q('[data-act="optLefty"]');
    toggle.classList.toggle('on', v.lefty);
    toggle.querySelector('b').textContent = v.lefty ? 'On' : 'Off';
    const voice = q('.opt-voice');
    if (voice) {
      voice.classList.toggle('on', v.voice > 0);
      voice.querySelector('b').textContent = v.voice > 0 ? 'On' : 'Off';
    }
    for (const row of menu.el.querySelectorAll('.opt-row[data-key]')) {
      const key = row.dataset.key, s = STEPPED[key], frac = (v[key] - s.min) / (s.max - s.min);
      const lit = Math.round(frac * NOTCHES);
      row.querySelectorAll('.opt-bar i').forEach((n, i) => n.classList.toggle('on', i < lit));
      row.querySelector('.opt-val').textContent = s.text(v[key]);
      for (const b of row.querySelectorAll('.opt-step')) b.disabled = b.dataset.d < 0 ? v[key] <= s.min + 1e-6 : v[key] >= s.max - 1e-6;
    }
  };
  menu.on({
    optBack: () => onBack(),
    optQuality: ({ id }) => { Options.set('quality', id); paint(); },
    optHudSize: ({ id }) => { Options.set('hudSize', id); paint(); },
    optLefty: () => { Options.set('lefty', !Options.get('lefty')); paint(); },
    optAutoRespawn: () => { Options.set('autoRespawn', !Options.get('autoRespawn')); paint(); },
    optMatchMusic: () => { Options.set('matchMusic', !Options.get('matchMusic')); paint(); },
    optHaptics: () => { Options.set('haptics', !Options.get('haptics')); if (Options.get('haptics')) try { navigator.vibrate?.(20); } catch { /* blocked */ } paint(); },
    optFullscreen: () => {
      Options.set('fullscreen', !Options.get('fullscreen'));
      if (Options.get('fullscreen')) enterFullscreen();
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      paint();
    },
    optFps: () => { Options.set('fps', !Options.get('fps')); paint(); },
    optTouchDebug: () => { Options.set('touchDebug', !Options.get('touchDebug')); paint(); },
    optSquad: () => onSquad?.(),
    optSquadClear: () => { Options.set('squad', ''); paint(); },
    optVoiceMode: () => { Options.set('voiceMode', Options.get('voiceMode') === 'ptt' ? 'open' : 'ptt'); paint(); },
    optPad: () => controllerScreen(menu, { onBack: () => optionsScreen(menu, opts) }),
    optVoice: () => { Options.set('voice', Options.get('voice') > 0 ? 0 : 1); paint(); },
    optStep: ({ key, d }) => {
      Options.step(key, Number(d));
      paint();
      pop(menu.el.querySelector(`.opt-row[data-key="${key}"] .opt-val`), { scale: 1.25 });
      if (key === 'sound') onPreviewSound?.();
    },
  });
  paint();
  menu.show();
}
