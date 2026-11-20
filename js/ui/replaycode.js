// The replay code sheets (docs/REPLAYS.md, ROADMAP item 60): Share in the replay player (a highlight or the whole clip
// as an SYR1 code, copied or sent with the system share sheet) and Paste code in History > Clips.
//
//   shareSheet(clip, { title })              resolves when closed
//   pasteSheet({ onWatch })                  onWatch(clip) with a decoded clip; refusals are shown in the sheet
// Both are plain DOM on <body> (they open over the replay player and over the menus alike).
import { encodeReplay, decodeReplay, highlightRange, canShare, CODE_ERRORS } from '../game/replay-code.js';
import { MAPS } from '../shared/map.js';
import { esc } from './widgets.js';

const kb = n => (n < 1000 ? `${n} characters` : `${(n / 1000).toFixed(1)}k characters`);

function sheet(html) {
  const el = document.createElement('div');
  el.className = 'rc-sheet';
  el.innerHTML = `<div class="rc-box" role="dialog" aria-modal="true">${html}</div>`;
  (document.getElementById('ui') ?? document.body).appendChild(el);
  // Taps and keys stay in the sheet (the replay player and the menus underneath must not see them).
  for (const t of ['pointerdown', 'click', 'keydown']) el.addEventListener(t, e => e.stopPropagation());
  return el;
}

async function copyText(text, area) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back to a selection */ }
  try { area.focus(); area.select(); return document.execCommand?.('copy') ?? false; } catch { return false; }
}

export function shareSheet(clip, { title = '' } = {}) {
  return new Promise(resolve => {
    if (!canShare()) {
      const el = sheet(`<b>Share replay</b><p class="rc-err">${esc(CODE_ERRORS.unsupported)}</p><div class="rc-row"><button class="btn rc-close"><b>Close</b></button></div>`);
      el.querySelector('.rc-close').addEventListener('click', () => { el.remove(); resolve(); });
      return;
    }
    const hl = highlightRange(clip);
    const el = sheet(`
      <b>Share replay</b>
      <p>Anyone with the game can paste this code in History, Clips, to watch it. No account, no upload: the code is the replay.</p>
      <div class="rc-pick">
        <button class="on" data-what="hl"><b>Highlight</b><small>${Math.round(hl.to - hl.from)} s around the final kill</small></button>
        <button data-what="all"><b>Whole clip</b><small>${Math.round(clip.dur)} s, a longer code</small></button>
      </div>
      <textarea class="rc-code" readonly rows="3" aria-label="Replay code">Making the code...</textarea>
      <small class="rc-size"></small>
      <div class="rc-row">
        <button class="btn rc-close" data-sound="back"><b>Close</b></button>
        ${navigator.share ? '<button class="btn rc-send"><b>Send</b></button>' : ''}
        <button class="btn is-primary rc-copy" data-sound="confirm"><b>Copy code</b></button>
      </div>`);
    const area = el.querySelector('.rc-code'), size = el.querySelector('.rc-size'), copy = el.querySelector('.rc-copy');
    let code = '', seq = 0;
    const make = async what => {
      const my = ++seq;
      area.value = 'Making the code...'; size.textContent = ''; copy.disabled = true;
      const range = what === 'all' ? { from: 0, to: clip.dur } : hl;
      let r;
      try { r = await encodeReplay(clip, { ...range, title }); } catch (err) { console.error('replay code', err); r = { ok: false, error: 'big' }; }
      if (my !== seq || !el.isConnected) return;
      if (!r.ok) { code = ''; area.value = ''; size.textContent = CODE_ERRORS[r.error] ?? CODE_ERRORS.data; size.classList.add('rc-err'); return; }
      code = r.code; area.value = code; copy.disabled = false;
      size.classList.remove('rc-err');
      size.textContent = `${kb(code.length)} · ${Math.round(r.seconds)} s`;
    };
    for (const b of el.querySelectorAll('.rc-pick button')) b.addEventListener('click', () => {
      for (const x of el.querySelectorAll('.rc-pick button')) x.classList.toggle('on', x === b);
      make(b.dataset.what);
    });
    copy.addEventListener('click', async () => {
      if (!code) return;
      const ok = await copyText(code, area);
      copy.querySelector('b').textContent = ok ? 'Copied' : 'Select and copy';
      setTimeout(() => { if (copy.isConnected) copy.querySelector('b').textContent = 'Copy code'; }, 1800);
    });
    el.querySelector('.rc-send')?.addEventListener('click', () => { if (code) navigator.share({ text: code }).catch(() => {}); });
    el.querySelector('.rc-close').addEventListener('click', () => { el.remove(); resolve(); });
    make('hl');
  });
}

export function pasteSheet({ onWatch }) {
  const el = sheet(`
    <b>Watch a replay code</b>
    <p>Paste a replay code a friend shared (it starts with SYR1).</p>
    <textarea class="rc-in" rows="4" placeholder="SYR1..." aria-label="Replay code" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
    <small class="rc-msg"></small>
    <div class="rc-row">
      <button class="btn rc-close" data-sound="back"><b>Cancel</b></button>
      ${navigator.clipboard?.readText ? '<button class="btn rc-paste"><b>Paste</b></button>' : ''}
      <button class="btn is-primary rc-watch" data-sound="confirm"><b>Watch</b></button>
    </div>`);
  const input = el.querySelector('.rc-in'), msg = el.querySelector('.rc-msg'), watch = el.querySelector('.rc-watch');
  const close = () => el.remove();
  el.querySelector('.rc-close').addEventListener('click', close);
  el.querySelector('.rc-paste')?.addEventListener('click', async () => {
    try { input.value = await navigator.clipboard.readText(); } catch { msg.textContent = 'Long-press the box and paste.'; }
  });
  watch.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) { msg.textContent = 'Paste a code first.'; msg.classList.add('rc-err'); return; }
    watch.disabled = true; msg.classList.remove('rc-err'); msg.textContent = 'Reading the code...';
    const r = await decodeReplay(text, { maps: MAPS });
    watch.disabled = false;
    if (!r.ok) { msg.textContent = CODE_ERRORS[r.error] ?? CODE_ERRORS.data; msg.classList.add('rc-err'); return; }
    close();
    onWatch(r.clip);
  });
  setTimeout(() => input.focus(), 50);
  return el;
}
