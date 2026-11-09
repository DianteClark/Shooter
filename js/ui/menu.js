// Every screen outside a match. Templates driven by main.js through this small object; the larger screens
// live in their own modules and share this object's actions, overlay and single gun preview.
import { TEAMS, TEAM_SIZE } from '../shared/constants.js';
import { GunPreview } from '../render/renderer.js';
import { Progress } from './progress.js';
import { LoadoutsScreen } from './loadout.js';
import { Gunsmith } from './gunsmith.js';
import { profileScreen } from './prestige.js';
import { resultsScreen } from './results.js';
import { saveScreen } from './savecode.js';
import { yardBackdrop } from './yard.js';
import { esc, badgeMark, ROMAN } from './widgets.js';

export { esc };

const QWERTY = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM-_.'];
const CODE_CHARS = ['ABCDEFGHJKM', 'NPQRSTUVWX', 'YZ23456789'];


const SKILLS = [['recruit', 'Recruit'], ['regular', 'Regular'], ['veteran', 'Veteran'], ['elite', 'Elite'], ['mixed', 'Mixed']];

export class Menu {
  constructor(root) {
    this.root = root;
    this.el = document.createElement('div');
    this.el.className = 'menu';
    root.appendChild(this.el);
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'overlay';
    root.appendChild(this.overlayEl);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    root.appendChild(this.toastEl);
    this.actions = {};
    this.preview = null;           // One GunPreview for the whole menu layer, so only one WebGL context ever exists here.
    this.previewCanvas = null;
    this.previewRaf = 0;
    this.reel = null;              // The results reel, when one is running.

    this.el.addEventListener('click', e => this.#click(e));
    this.overlayEl.addEventListener('click', e => this.#click(e));
    root.insertAdjacentHTML('beforeend', `
      <div class="rotate">
        <svg viewBox="0 0 120 80" aria-hidden="true">
          <rect x="44" y="10" width="32" height="60" rx="5" />
          <path d="M18 54a30 30 0 0 1 16-30M26 18l9 5-5 9" />
        </svg>
        <b>Turn your phone sideways</b>
        <p>Switchyard plays in landscape.</p>
      </div>`);
  }

  #click(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    this.actions[el.dataset.act]?.(el.dataset, el);
  }

  on(actions) {
    Object.assign(this.actions, actions);
  }

  show() { this.el.classList.add('on'); }
  hide() {
    this.#stopPreview();
    this.#endReel();
    this.el.classList.remove('on');
    this.el.textContent = '';
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;      // Restart the fade; menus only, never during play.
    this.toastEl.classList.add('show');
  }

  // Blocking message on top of whatever is showing. text empty clears it.
  overlay(html) {
    this.overlayEl.innerHTML = html || '';
    this.overlayEl.classList.toggle('show', !!html);
  }

  title({ arrive = false } = {}) {
    this.#stopPreview();
    this.#endReel();
    const lp = Progress.levelProgress();
    const can = Progress.canPrestige();
    const name = Progress.name || 'Rookie';
    this.el.dataset.screen = 'title';
    this.el.innerHTML = `
      ${yardBackdrop()}
      <section class="boxcar${arrive ? ' arrive' : ''}">
        <div class="boxcar-ribs"></div>
        <div class="boxcar-face">
          <h1 class="wordmark">Switchyard</h1>
          <p class="wordmark-sub">6v6 team deathmatch in a freight yard at dusk</p>
          <button class="pcard${can ? ' ready' : ''}" data-act="profile">
            <span class="pc-badge">${badgeMark(lp.prestige, 48)}</span>
            <span class="pc-body">
              <span class="pc-top"><b class="pc-name">${esc(name)}</b><span class="pc-lv">Level ${lp.level}${lp.prestige ? ` <em>${ROMAN[lp.prestige]}</em>` : ''}</span></span>
              <i class="xp"><i style="transform:scaleX(${(lp.maxed ? 1 : lp.into / lp.span).toFixed(3)})"></i></i>
              <small class="pc-sub">${can ? 'Prestige available' : lp.maxed ? 'Maximum level' : `${Math.round(lp.into)} / ${lp.span} XP`}</small>
            </span>
          </button>
        </div>
      </section>
      <nav class="routes">
        <button class="route primary" data-act="solo"><i class="lamp"></i><b>Play vs bots</b></button>
        <button class="route" data-act="host"><i class="lamp"></i><b>Host a match</b></button>
        <button class="route" data-act="join"><i class="lamp"></i><b>Join with a code</b></button>
        <div class="route-pair">
          <button class="route" data-act="loadout"><b>Loadouts</b></button>
          <button class="route" data-act="gunsmith"><b>Gunsmith</b></button>
        </div>
        <button class="route small" data-act="saveCode"><b>Save code</b></button>
      </nav>`;
    this.show();
  }

  // Both the callsign and room code entry use this, so the iOS keyboard never covers the screen.
  keypad({ title, value = '', hint = '', max, kind, onDone, onCancel, doneLabel = 'Done' }) {
    this.#stopPreview();
    let current = value;
    const rows = kind === 'code' ? CODE_CHARS : QWERTY;
    this.el.dataset.screen = 'keypad';
    const paint = () => {
      const slots = kind === 'code'
        ? Array.from({ length: max }, (_, i) => `<span class="slot">${esc(current[i] ?? '')}</span>`).join('')
        : `<span class="slot wide">${esc(current) || '&nbsp;'}<i class="caret"></i></span>`;
      this.el.querySelector('.kp-entry').innerHTML = slots;
      const done = this.el.querySelector('[data-act="kpDone"]');
      done.disabled = kind === 'code' ? current.length !== max : current.trim().length === 0;
    };
    this.el.innerHTML = `
      <header class="bar">
        <button class="back" data-act="kpCancel">Back</button>
        <h2>${esc(title)}</h2>
      </header>
      <div class="kp">
        <div class="kp-entry"></div>
        ${hint ? `<p class="kp-hint">${esc(hint)}</p>` : ''}
        <div class="keys">
          ${rows.map(row => `<div class="key-row">${[...row].map(c => `<button class="key" data-act="kpKey" data-k="${esc(c)}">${esc(c)}</button>`).join('')}</div>`).join('')}
          <div class="key-row keys-actions">
            <button class="key del" data-act="kpDel">Delete</button>
            <button class="key done" data-act="kpDone">${esc(doneLabel)}</button>
          </div>
        </div>
      </div>`;
    this.on({
      kpKey: ({ k }) => {
        if (current.length < max) current += k;
        paint();
      },
      kpDel: () => {
        current = current.slice(0, -1);
        paint();
      },
      kpDone: () => onDone(current.trim()),
      kpCancel: () => onCancel(),
    });
    paint();
    this.show();
  }

  searching(code, onCancel) {
    this.#stopPreview();
    this.el.dataset.screen = 'searching';
    this.el.innerHTML = `
      <div class="waiting">
        <div class="signal"><i></i><i></i><i></i></div>
        <h2>Looking for room <b>${esc(code)}</b></h2>
        <p>Keep the host on their lobby screen. This can take a few seconds.</p>
        <button class="route small" data-act="cancelSearch"><b>Cancel</b></button>
      </div>`;
    this.on({ cancelSearch: onCancel });
    this.show();
  }

  notFound(code, { retry, back }) {
    this.el.dataset.screen = 'searching';
    this.el.innerHTML = `
      <div class="waiting">
        <h2 class="bad">No room at <b>${esc(code)}</b></h2>
        <p>Check the code with the host, and that their lobby is still open.</p>
        <div class="row">
          <button class="route small" data-act="nfBack"><b>Back</b></button>
          <button class="route small primary" data-act="nfRetry"><b>Try again</b></button>
        </div>
      </div>`;
    this.on({ nfBack: back, nfRetry: retry });
    this.show();
  }

  // state: { code, humans:[{id,name,team,ready,primary}], botSkill, isHost, localId, notice }
  lobby(state) {
    this.#stopPreview();
    this.#endReel();
    this.el.dataset.screen = 'lobby';
    const { code, humans, botSkill, isHost, localId, countdown = null, rematchWait = false } = state;
    const counting = countdown !== null;
    const me = humans.find(h => h.id === localId);
    const allReady = humans.every(h => h.ready || h.id === localId);
    const train = team => {
      const cars = humans.filter(h => h.team === team);
      let cells = '';
      for (let i = 0; i < TEAM_SIZE; i++) {
        const h = cars[i];
        if (h) {
          const self = h.id === localId;
          const can = isHost || self;
          cells += `<button class="car human${self ? ' self' : ''}${h.ready ? ' ready' : ''}" ${can ? `data-act="moveTeam" data-id="${esc(h.id)}"` : 'disabled'}>
            <span class="car-id">${h.badge ? badgeMark(h.badge.prestige ?? 0, 20) : ''}<b>${esc(h.name)}</b></span>
            <small>${h.badge ? `Lv ${h.badge.level} / ` : ''}${h.host ? 'Host' : h.ready ? 'Ready' : 'Not ready'}</small>
            <i class="wheels"></i>
          </button>`;
        } else {
          cells += '<div class="car bot"><small>Bot</small><i class="wheels"></i></div>';
        }
      }
      return `<div class="train" style="--team:${TEAMS[team].css}">
        <h3>${esc(TEAMS[team].name)}</h3>
        <div class="consist">${cells}</div>
      </div>`;
    };
    const isReady = me?.ready;
    const start = isHost
      ? `<button class="route primary" data-act="start" ${counting || allReady ? '' : 'disabled'}><i class="lamp"></i><b>${counting ? 'Start now' : allReady ? 'Start match' : 'Waiting for ready'}</b></button>`
      : counting
        ? '<div class="route primary lit static"><i class="lamp"></i><b>Rematch</b></div>'
        : rematchWait
          ? '<div class="route static"><i class="lamp"></i><b>Waiting for host</b></div>'
          : `<button class="route primary${isReady ? ' lit' : ''}" data-act="toggleReady"><i class="lamp"></i><b>${isReady ? 'Ready' : 'Tap when ready'}</b></button>`;
    this.el.innerHTML = `
      <header class="bar">
        <button class="back" data-act="leaveLobby">Leave</button>
        <div class="room">
          <span>Room code</span>
          <b>${esc(code)}</b>
        </div>
        ${counting ? `<div class="auto-start"><span>Starting in</span><b class="auto-n">${countdown}</b></div>` : ''}
        <p class="room-tip">${isHost ? (counting ? 'Tap a player to swap teams.' : 'Read this code to friends. Tap a player to swap teams.') : 'Tap your name to swap teams.'}</p>
      </header>
      <div class="yard-lines">
        ${train(0)}
        ${train(1)}
      </div>
      <footer class="lobby-foot">
        <div class="skills">
          <span>Bots</span>
          ${SKILLS.map(([id, label]) => `<button class="seg${botSkill === id ? ' on' : ''}" ${isHost ? `data-act="botSkill" data-skill="${id}"` : 'disabled'}>${label}</button>`).join('')}
        </div>
        <button class="route small" data-act="gunsmith"><b>Gunsmith</b></button>
        <button class="route small" data-act="loadout"><b>${esc(Progress.loadouts()[Progress.activeLoadout].name)}</b></button>
        ${start}
      </footer>`;
    this.show();
  }

  gunsmith(opts) {
    this.#stopPreview();
    this.screen = new Gunsmith(this, opts);
  }

  loadouts(opts) {
    this.#stopPreview();
    this.screen = new LoadoutsScreen(this, opts);
  }

  profile(opts) {
    this.#stopPreview();
    profileScreen(this, opts);
  }

  saveCode(opts) {
    this.#stopPreview();
    saveScreen(this, opts);
  }

  // Countdown ticks for a guest still reading results; the lobby repaints in full, so it needs no call of its own.
  updateCountdown(left) {
    const n = this.el.querySelector('.auto-n');
    if (n && left !== null) n.textContent = left;
    const note = this.el.querySelector('.res-note');
    if (note) note.textContent = left === null ? '' : `Rematch starts in ${left}`;
  }

  // Note above the choices on the results screen: 'Host lost, waiting', etc.
  resultsNote(text) {
    const note = this.el.querySelector('.res-note');
    if (note) note.textContent = text;
  }

  // Swaps the Rematch button's action after the host is gone: label says what it now does.
  relabelRematch(text) {
    const b = this.el.querySelector('[data-act="resRematch"] b');
    if (b) b.textContent = text;
  }

  // data: outcome, scores, myTeam, localId, roster, badges, mvp, xp, level, weapons, unlocks, finalKill, rematchLabel, note.
  results(data, handlers) {
    this.#stopPreview();
    resultsScreen(this, data, handlers);
  }

  // Shown once to Safari players who have not added the game to their Home Screen.
  installPrompt(onDismiss) {
    this.overlay(`
      <div class="sheet">
        <h2>Add to Home Screen</h2>
        <p>Switchyard is built to run full screen, with no browser bars in the way of your thumbs.</p>
        <ol>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M6 11H4v10h16V11h-2" /></svg>Tap the Share button in Safari</li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM12 8v8M8 12h8" /></svg>Choose Add to Home Screen</li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l6 6L20 6" /></svg>Open Switchyard from its new icon</li>
        </ol>
        <button class="route small primary" data-act="dismissInstall"><b>Keep playing in Safari</b></button>
      </div>`);
    this.on({ dismissInstall: () => { this.overlay(''); onDismiss(); } });
  }

  // Puts the shared preview canvas inside `mount`, created the first time it is needed, and starts it turning.
  previewMount(mount, weaponId, camoId, kit) {
    if (!mount) return;
    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement('canvas');
      this.previewCanvas.className = 'preview-canvas';
    }
    if (this.previewCanvas.parentNode !== mount) mount.prepend(this.previewCanvas);
    if (!this.preview) this.preview = new GunPreview(this.previewCanvas);
    this.preview.tick(0);               // Lets the preview measure the canvas, so the gun is framed for this card's shape.
    this.preview.show(weaponId, camoId, kit);
    if (this.previewRaf) return;
    let last = performance.now();
    const tick = now => {
      this.previewRaf = requestAnimationFrame(tick);
      this.preview.tick(Math.min(0.1, (now - last) / 1000));
      last = now;
    };
    this.previewRaf = requestAnimationFrame(tick);
  }

  previewShow(weaponId, camoId, kit) {
    this.preview?.show(weaponId, camoId, kit);
  }

  // Leaving the results screen mid-reel: a ceremony card must not land on the next screen.
  #endReel() {
    if (this.reel && !this.reel.dead) {
      this.reel.cancel();
      this.overlay('');
    }
    this.reel = null;
  }

  // Stops drawing and takes the canvas off the page. The context is kept for the next screen.
  #stopPreview() {
    cancelAnimationFrame(this.previewRaf);
    this.previewRaf = 0;
    this.previewCanvas?.remove();
  }
}
