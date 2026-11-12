// Voice on screen (roadmap item 28): speaking marks, per-player mute, push to talk on the mic buttons, and the lobby mic.
//
// Markup elsewhere only carries hooks, and this module paints them a few times a second:
//   [data-voice="<player id>"]       gets .talking while that player is heard (the lobby car, a scoreboard row)
//   [data-voice-mute="<player id>"]  a mute button: .on while muted, hidden unless that player's voice reaches this phone
//   .lb-mic, .hud .chip-btn.mic      mic buttons: data-state follows the voice state; in push to talk a hold sends
// The scoreboard's rows get their mute buttons and talking dots here (inside .lb-name), so hud.js only tags each row.
// In a match a short list of who is talking sits under the HUD's corner chips.
import { icon } from './icons.js';
import { esc } from './widgets.js';

const PAINT_MS = 150;

const CSS = `
.vc-dot { display: none; width: 12px; height: 12px; flex: none; color: var(--c-go, #4bd18a); line-height: 0; }
.vc-dot svg { width: 12px; height: 12px; }
.talking .vc-dot { display: inline-block; animation: vc-pulse .5s ease-in-out infinite alternate; }
@keyframes vc-pulse { from { opacity: .55; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .talking .vc-dot { animation: none; } }
.lb-mute { flex: none; width: 20px; height: 18px; margin-left: auto; padding: 0; display: grid; place-items: center; background: rgba(231,234,228,.08); color: var(--c-haze, #9aa6b2); border: 0; border-radius: 3px; pointer-events: auto; line-height: 0; }
.lb-mute svg { width: 12px; height: 12px; }
.lb-mute.on { background: rgba(255,77,61,.25); color: #ff8a7d; }
.vc-talkers { position: absolute; right: calc(var(--sr, 0px) + 8px); top: calc(var(--st, 0px) + 46px); display: flex; flex-direction: column; align-items: flex-end; gap: 3px; pointer-events: none; z-index: 2; }
.hud.lefty .vc-talkers { right: auto; left: calc(var(--sl, 0px) + 8px); align-items: flex-start; }
.vc-talkers span { display: flex; align-items: center; gap: 4px; padding: 2px 7px 2px 5px; background: rgba(16,20,26,.72); color: #e7eae4; font: 400 11px/1.2 var(--f-plate, system-ui); letter-spacing: .04em; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-talkers span .vc-dot { display: inline-block; }
#ui .car-cell { position: relative; display: flex; flex-direction: column; min-width: 0; }
#ui .car-cell > .car { flex: 1; }
#ui .car-cell .vc-dot { width: 13px; height: 13px; }
#ui .car-mute { position: absolute; right: 3px; bottom: 3px; width: 26px; height: 22px; padding: 0; display: grid; place-items: center; background: rgba(16,20,26,.55); color: var(--c-haze); border: 0; line-height: 0; z-index: 1; }
#ui .car-mute .ico, #ui .car-mute svg { width: 14px; height: 14px; }
#ui .car-mute.on { background: rgba(255,77,61,.3); color: #ff8a7d; }
#ui .lb-mic { flex: none; height: 40px; display: flex; align-items: center; gap: 6px; padding: 0 10px; }
#ui .lb-mic .ico { height: 18px; }
#ui .lb-mic b { font: 400 var(--fs-caption, 12px)/1 var(--f-plate); letter-spacing: var(--tr-plate); white-space: nowrap; }
#ui .lb-mic[data-state="on"] { background: var(--c-go); color: var(--c-night); }
#ui .lb-mic[data-state="requesting"] { color: var(--c-sodium); }
#ui .lb-mic[data-state="denied"] b { color: var(--c-red, #ff4d3d); }
.chip-btn.mic[data-state="ptt"] .gl { color: var(--c-sodium, #ffc23d); }
`;

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
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

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
