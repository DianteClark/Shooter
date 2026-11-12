// Voice on screen (roadmap item 28): speaking marks, per-player mute, push to talk on the mic buttons, and the lobby mic.
//
// Markup elsewhere only carries hooks, and this module paints them a few times a second:
//   [data-voice="<player id>"]       gets .talking while that player is heard (the lobby car, a scoreboard row)
//   [data-voice-mute="<player id>"]  a mute button: .on while muted, hidden unless that player's voice reaches this phone
//   .lb-mic, .hud .chip-btn.mic      mic buttons: data-state follows the voice state; in push to talk a hold sends
// The scoreboard's rows get their mute buttons and talking dots here (inside .lb-name), so hud.js only tags each row.
// In a match a short list of who is talking sits under the HUD's corner chips. Styles: css/voice.css.
import { icon } from './icons.js';
import { esc } from './widgets.js';

const PAINT_MS = 150;


const MIC_TEXT = { off: 'Mic off', on: 'Talking', requesting: 'Mic...', denied: 'Mic blocked', ptt: 'Hold to talk' };
const MIC_TEXT_OPEN_ON = 'Mic on';

export class VoiceUI {
  // deps: { hud, voice: () => Voice|null, nameOf: id => string }
  constructor({ hud, voice, nameOf }) {
    this.hud = hud;
    this.voice = voice;
    this.nameOf = nameOf;
    this.holding = false;
    this.talkKey = '';
    this.talkers = document.createElement('div');
    this.talkers.className = 'vc-talkers';
    hud?.el?.appendChild(this.talkers);

    // Push to talk: a press on either mic sends until that finger (or any) lifts. Lobby repaints may replace the button
    // under the finger, so the release is heard on the document.
    const down = e => {
      const v = this.voice();
      if (!v || v.mode !== 'ptt') return;
      if (!e.target?.closest?.('.lb-mic, .chip-btn.mic')) return;
      this.holding = true;
      v.talk(true);
    };
    const up = () => {
      if (!this.holding) return;
      this.holding = false;
      this.voice()?.talk(false);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);

    // Scoreboard mutes: a HUD tap of their own (data-tap keeps the sticks off them).
    hud?.el?.addEventListener('click', e => {
      const b = e.target.closest?.('.lb-mute');
      if (!b) return;
      this.toggleMute(b.dataset.voiceMute);
    });
    setInterval(() => this.paint(), PAINT_MS);
  }

  toggleMute(id) {
    const v = this.voice();
    if (!v || !id) return;
    v.setPeerMuted(id, !v.isPeerMuted(id));
    this.paint();
  }

  // The board's rows are retexted by hud.js; each tagged row gets a dot and a mute button once.
  #boardHooks() {
    const rows = this.hud?.el?.querySelectorAll('.lb-row') ?? [];
    for (const row of rows) {
      const name = row.querySelector('.lb-name');
      if (!name) continue;
      if (!name.querySelector('.vc-dot')) name.insertAdjacentHTML('afterbegin', `<i class="vc-dot">${icon('ui:mic', { size: 12 })}</i>`);
      let b = name.querySelector('.lb-mute');
      if (!b) {
        name.insertAdjacentHTML('beforeend', `<button class="lb-mute" type="button" data-tap="1" data-sound="tab" hidden aria-label="Mute">${icon('ui:volume', { size: 12 })}</button>`);
        b = name.querySelector('.lb-mute');
      }
      const id = row.dataset.voice ?? '';
      if (b.dataset.voiceMute !== id) b.dataset.voiceMute = id;
    }
  }

  paint() {
    const v = this.voice();
    if (this.hud?.boardOpen) this.#boardHooks();
    const speaking = v ? v.speaking() : new Set();
    for (const el of document.querySelectorAll('[data-voice]')) {
      const on = speaking.has(el.dataset.voice);
      if (el.classList.contains('talking') !== on) el.classList.toggle('talking', on);
    }
    for (const b of document.querySelectorAll('[data-voice-mute]')) {
      const id = b.dataset.voiceMute;
      const can = !!v && !!id && v.teammates.has(id);
      if (b.hidden === can) b.hidden = !can;
      const muted = can && v.isPeerMuted(id);
      if (b.classList.contains('on') !== muted) {
        b.classList.toggle('on', muted);
        b.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      }
    }
    for (const b of document.querySelectorAll('.lb-mic')) {
      const st = v ? v.shownState : 'unavailable';
      if (b.dataset.state !== st) {
        b.dataset.state = st;
        const t = b.querySelector('b');
        if (t) t.textContent = st === 'on' && v?.mode === 'open' ? MIC_TEXT_OPEN_ON : MIC_TEXT[st] ?? 'Mic';
      }
    }
    // In a match: who is talking, under the corner chips. Others only: your own mic button already says so.
    const self = v?.localId;
    const names = [...speaking].filter(id => id !== self).map(id => this.nameOf?.(id)).filter(Boolean);
    const key = names.join('|');
    if (key !== this.talkKey) {
      this.talkKey = key;
      this.talkers.innerHTML = names.map(n => `<span><i class="vc-dot">${icon('ui:mic', { size: 12 })}</i>${esc(n)}</span>`).join('');
    }
  }
}
