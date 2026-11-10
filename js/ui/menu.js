// Every screen outside a match. Templates driven by main.js through this small object; the larger screens
// live in their own modules and share this object's actions, overlay and single gun preview.
//
// Transitions: a screen change fades the layer in and walks every element marked data-in="<pose>" onto the screen in
// document order (motion.js stagger). Repaints of the same screen never replay it.
import { TEAMS, TEAM_SIZE } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { GunPreview } from '../render/renderer.js';
import { OperatorPreview } from '../render/characters.js';
import { Progress } from './progress.js';
import { LoadoutsScreen } from './loadout.js';
import { OperatorsScreen } from './operatorscreen.js';
import { voteMarkup, paintVote, soloMarkup, paintSolo } from './vote.js';
import { botMatchSummary } from './botsettings.js';
import { followMapArt } from './mapthumb.js';
import { Gunsmith } from './gunsmith.js';
import { profileScreen } from './prestige.js';
import { resultsScreen } from './results.js';
import { saveScreen } from './savecode.js';
import { inviteControls } from './invite.js';
import { optionsScreen } from './optionsscreen.js';
import { helpScreen } from './help.js';
import { challengesScreen, titleChallenges } from './challenges.js';
import { historyScreen } from './history.js';
import { fingerDown } from './tap.js';
import { scrolling } from './scroll.js';
import { yardBackdrop, ico, backButton, header } from './yard.js';
import { GunThumbs } from './gunthumbs.js';
import { esc, badgeMark, ROMAN } from './widgets.js';
import { vetOf, vetTag } from './cards.js';
import { play, enter, sweep, shake, reducedMotion, DUR } from './motion.js';

export { esc };

const QWERTY = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM-_.'];
const CODE_CHARS = ['ABCDEFGHJKM', 'NPQRSTUVWX', 'YZ23456789'];

const PREVIEW_MS = 30;          // Turntable frames are spaced this far apart at least.
const SWEEP_EVERY_MS = 6500;    // The title's primary button and wordmark catch the lamp this often.

const SKILLS = [['recruit', 'Recruit'], ['regular', 'Regular'], ['veteran', 'Veteran'], ['elite', 'Elite'], ['mixed', 'Mixed']];

// How deep each screen sits, so a move toward the title plays as "back".
const DEPTH = { title: 0, keypad: 1, solo: 1, searching: 1, lobby: 1, loadouts: 1, profile: 1, options: 1, help: 1, stats: 1, challenges: 1, history: 1, operators: 2, gunsmith: 2, save: 2, vote: 2, results: 3 };

// Tap the wordmark: the yard's PA has opinions.
const YARD_PA = [
  'Train 44 on track 9, stand clear.', 'Attention: someone left a turret running on platform 2.',
  'The 18:05 to Harbor is delayed by gunfire.', 'Reminder: grenades are not luggage.',
  'Would the owner of the red boxcar please move it.', 'Track inspection cancelled due to enemy UAV.',
];

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
    this.opPreview = null;         // The operator turntable; shares that context and canvas.
    this.ticking = null;           // Whichever of the two the render loop is driving right now.
    this.previewCanvas = null;
    this.previewRaf = 0;
    this.reel = null;              // The results reel, when one is running.
    this.lastScreen = null;        // For the transition: repaints of one screen must not replay it.
    this.onScreen = null;          // main.js: called with the screen name whenever a different screen comes up.
    this.sweepTimer = 0;

    this.on({ yardPa: () => this.toast(YARD_PA[(this.paCount = (this.paCount ?? -1) + 1) % YARD_PA.length]) });
    this.el.addEventListener('click', e => this.#click(e));
    this.overlayEl.addEventListener('click', e => this.#click(e));
    root.insertAdjacentHTML('beforeend', `
      <div class="rotate">
        <div class="rotate-phone" aria-hidden="true">${ico('phone')}</div>
        <b>Turn your phone sideways</b>
        <p>Switchyard plays in landscape.</p>
      </div>`);
  }

  #click(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.disabled) return;
    this.actions[el.dataset.act]?.(el.dataset, el);
  }

  on(actions) {
    Object.assign(this.actions, actions);
  }

  show() {
    this.el.classList.add('on');
    this.#playEnter();
  }

  hide() {
    this.#stopPreview();
    this.#endReel();
    clearInterval(this.sweepTimer);
    this.el.classList.remove('on');
    this.el.textContent = '';
    this.lastScreen = null;
  }

  // Transforms and opacity only; a tap is resolved at touchstart, so nothing moving here can make it miss.
  #playEnter() {
    const screen = this.el.dataset.screen;
    if (screen === this.lastScreen) return;
    const prev = this.lastScreen;
    this.lastScreen = screen;
    clearInterval(this.sweepTimer);
    this.onScreen?.(screen);
    const back = prev !== null && (DEPTH[screen] ?? 1) < (DEPTH[prev] ?? 1);
    this.el.dataset.dir = back ? 'back' : 'forward';
    play(this.el, [{ opacity: prev === null ? 0 : 0.4 }, { opacity: 1 }], { duration: DUR.fast, fill: 'none' });
    this.stagger(this.el, back ? 60 : 40);
  }

  // Walks every [data-in] element under root onto the screen, in document order.
  stagger(root, delay = 0) {
    const items = [...root.querySelectorAll('[data-in]')];
    items.forEach((el, i) => enter(el, el.dataset.in || 'up', { delay: delay + Math.min(i, 12) * DUR.stagger, duration: DUR.base + 40 }));
  }

  toast(text, tone = '') {
    this.toastEl.textContent = text;
    this.toastEl.dataset.tone = tone;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;      // Restart the fade; menus only, never during play.
    this.toastEl.classList.add('show');
  }

  // A refused tap: the element shakes and the toast says why. (tap.js has already played the tap's sound.)
  deny(el, text) {
    if (el) shake(el, { strength: 5, duration: 260 });
    if (text) this.toast(text, 'warn');
  }

  // Blocking message on top of whatever is showing. text empty clears it.
  overlay(html) {
    this.overlayEl.innerHTML = html || '';
    this.overlayEl.classList.toggle('show', !!html);
    if (html) {
      const sheet = this.overlayEl.firstElementChild;
      if (sheet && !sheet.classList.contains('cer')) enter(sheet, 'scale', { duration: DUR.base });
    }
  }

  // rejoin: { code } when this device has a match it may still get back into.
  title({ arrive = false, rejoin = null } = {}) {
    this.#stopPreview();
    this.#endReel();
    const lp = Progress.levelProgress();
    const can = Progress.canPrestige();
    const name = Progress.name || 'Rookie';
    const lo = Progress.loadouts()[Progress.activeLoadout];
    const gun = WEAPONS[lo?.primary]?.name ?? '';
    const frac = lp.maxed ? 1 : lp.into / lp.span;
    this.el.dataset.screen = 'title';
    this.el.innerHTML = `
      ${yardBackdrop()}
      <div class="ttl-shade" aria-hidden="true"></div>
      <section class="ttl-left${rejoin ? ' has-rejoin' : ''}${arrive ? ' arrive' : ''}">
        <div class="brand" data-in="left">
          <h1 class="wordmark" data-act="yardPa"><span>Switchyard</span><i class="wm-shine" aria-hidden="true">Switchyard</i></h1>
          <p class="wm-sub"><i class="wm-bar" aria-hidden="true"></i>Six a side, with friends or bots</p>
        </div>
        <nav class="ttl-nav">
          ${rejoin ? `<button class="tl-rejoin" data-act="rejoin" data-in="rail">${ico('rejoin')}<span><b>Rejoin ${esc(rejoin.code)}</b><small>Your last match may still be running</small></span></button>` : ''}
          <button class="tl-hero is-primary" data-sound="confirm" data-act="solo" data-in="rail">
            <span class="tl-hero-ico">${ico('bots')}</span>
            <span class="tl-hero-tx"><b>Play vs bots</b><small>Choose a map and a mode</small></span>
            ${ico('play', 'tl-go')}
          </button>
          <div class="tl-grid">
            <button class="tl-btn" data-act="quickPlay" data-in="rail">${ico('quick')}<b>Quick play</b></button>
            <button class="tl-btn" data-act="range" data-in="rail">${ico('range')}<b>Firing range</b></button>
            <button class="tl-btn" data-act="host" data-in="rail">${ico('host')}<b>Host</b></button>
            <button class="tl-btn" data-act="join" data-in="rail">${ico('join')}<b>Join</b></button>
          </div>
          <button class="tl-btn tl-loadout" data-act="loadout" data-in="rail">${ico('loadout')}<span><b>Loadouts</b><small>${esc(lo?.name ?? '')}${gun ? `: ${esc(gun)}` : ''}</small></span></button>
        </nav>
      </section>
      <button class="pcard${can ? ' ready' : ''}" data-act="profile" data-in="right">
        <span class="pc-badge">${badgeMark(lp.prestige, 46)}</span>
        <span class="pc-body">
          <span class="pc-top"><b class="pc-name">${esc(name)}</b>${lp.prestige ? `<em class="pc-pr">${ROMAN[lp.prestige]}</em>` : ''}</span>
          <span class="pc-lv"><b>Level <u class="pc-lvn">${lp.level}</u></b><small>${can ? 'Prestige ready' : lp.maxed ? 'Max level' : `${Math.round(lp.into).toLocaleString('en-US')} / ${lp.span.toLocaleString('en-US')} XP`}</small></span>
          <i class="xp"><i style="transform:scaleX(${frac.toFixed(3)})"></i></i>
        </span>
      </button>
      ${titleChallenges()}
      <nav class="ttl-sec">
        ${[['gunsmith', 'gunsmith', 'Gunsmith'], ['operators', 'operator', 'Operators'], ['history', 'ui:clock', 'History'], ['options', 'options', 'Options'], ['help', 'help', 'How to play'], ['saveCode', 'save', 'Save code']]
          .map(([act, icon, label]) => `<button class="chip" data-act="${act}" data-in="up">${ico(icon)}<b>${label}</b></button>`).join('')}
      </nav>`;
    this.show();
    const hero = this.el.querySelector('.tl-hero'), mark = this.el.querySelector('.wordmark');
    sweep(mark, { delay: arrive ? 700 : 350, duration: DUR.epic + 300 });
    sweep(hero, { delay: arrive ? 1100 : 600 });
    this.sweepTimer = setInterval(() => {
      if (!hero.isConnected) return clearInterval(this.sweepTimer);
      sweep(hero);
      setTimeout(() => mark.isConnected && sweep(mark, { duration: DUR.epic + 300 }), 900);
    }, SWEEP_EVERY_MS);
  }

  // Both the callsign and room code entry use this, so the iOS keyboard never covers the screen.
  keypad({ title, value = '', hint = '', max, kind, onDone, onCancel, doneLabel = 'Done' }) {
    this.#stopPreview();
    let current = value;
    const rows = kind === 'code' ? CODE_CHARS : QWERTY;
    this.el.dataset.screen = 'keypad';
    this.el.dataset.kind = kind;
    const paint = () => {
      const entry = this.el.querySelector('.kp-entry');
      entry.innerHTML = kind === 'code'
        ? Array.from({ length: max }, (_, i) => `<span class="slot${i === current.length ? ' next' : ''}${current[i] ? ' full' : ''}">${esc(current[i] ?? '')}</span>`).join('')
        : `<span class="slot wide"><b>${esc(current)}</b><i class="caret"></i></span><small class="kp-count${current.length >= max ? ' max' : ''}">${current.length}/${max}</small>`;
      const done = this.el.querySelector('[data-act="kpDone"]');
      done.disabled = kind === 'code' ? current.length !== max : current.trim().length === 0;
      this.el.querySelector('[data-act="kpDel"]').disabled = !current.length;
    };
    this.el.innerHTML = `
      ${header({ back: 'kpCancel', title })}
      <div class="kp">
        <div class="kp-entry" data-in="scale"></div>
        ${hint ? `<p class="kp-hint" data-in="fade">${esc(hint)}</p>` : ''}
        <div class="keys">
          ${rows.map(row => `<div class="key-row" data-in="up">${[...row].map(c => `<button class="key" data-act="kpKey" data-k="${esc(c)}">${esc(c)}</button>`).join('')}</div>`).join('')}
          <div class="key-row keys-actions" data-in="up">
            <button class="key del" data-act="kpDel">${ico('back')}<b>Delete</b></button>
            <button class="key done is-primary" data-sound="confirm" data-act="kpDone">${ico('check')}<b>${esc(doneLabel)}</b></button>
          </div>
        </div>
      </div>`;
    this.on({
      kpKey: (_, el) => {
        if (current.length >= max) { this.deny(this.el.querySelector('.kp-entry')); return; }
        current += _.k;
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
      ${header({ back: 'cancelSearch', label: 'Cancel', title: 'Join a match' })}
      <div class="waiting">
        <div class="radar" data-in="scale" aria-hidden="true"><i></i><i></i><i></i>${ico('signal')}</div>
        <h2 data-in="up">Looking for room</h2>
        <div class="code-tiles" data-in="up">${[...code].map(c => `<b>${esc(c)}</b>`).join('')}</div>
        <p data-in="fade">Keep the host on their lobby screen. This can take a few seconds.</p>
      </div>`;
    this.on({ cancelSearch: onCancel });
    this.show();
  }

  notFound(code, { retry, back }) {
    this.el.dataset.screen = 'searching';
    this.lastScreen = null;           // Same screen name, new state: let it enter.
    this.el.innerHTML = `
      ${header({ back: 'nfBack', title: 'Join a match' })}
      <div class="waiting is-error">
        <div class="err-mark" data-in="stamp">${ico('warn')}</div>
        <h2 data-in="up">No room at</h2>
        <div class="code-tiles bad" data-in="up">${[...code].map(c => `<b>${esc(c)}</b>`).join('')}</div>
        <p data-in="fade">Check the code with the host, and that their lobby is still open.</p>
        <div class="row" data-in="up">
          <button class="btn" data-act="nfBack">${ico('back')}<b>Back</b></button>
          <button class="btn is-primary" data-sound="confirm" data-act="nfRetry">${ico('rejoin')}<b>Try again</b></button>
        </div>
      </div>`;
    this.on({ nfBack: back, nfRetry: retry });
    this.show();
  }

  // state: { code, humans:[{id,name,team,ready,primary,badge,host}], botSkill, isHost, localId, countdown, rematchWait, ffa }
  // ffa: the room is playing a free-for-all, so there are no teams to swap between.
  lobby(state) {
    this.#stopPreview();
    this.#endReel();
    this.el.dataset.screen = 'lobby';
    const { code, humans, botSkill, isHost, localId, countdown = null, rematchWait = false, ffa = false } = state;
    const counting = countdown !== null;
    const me = humans.find(h => h.id === localId);
    const allReady = humans.every(h => h.ready || h.id === localId);
    const skillName = (SKILLS.find(([id]) => id === botSkill) ?? SKILLS[4])[1];
    const train = team => {
      const cars = humans.filter(h => h.team === team);
      let cells = '';
      for (let i = 0; i < TEAM_SIZE; i++) {
        const h = cars[i];
        if (h) {
          const self = h.id === localId;
          const can = !ffa && (isHost || self);
          const status = h.host ? 'Host' : h.ready ? 'Ready' : 'Not ready';
          cells += `<button class="car human${self ? ' self' : ''}${h.ready || h.host ? ' ready' : ''}" ${can ? `data-act="moveTeam" data-id="${esc(h.id)}"` : 'disabled'}>
            <span class="car-id">${h.badge ? badgeMark(h.badge.prestige ?? 0, 22) : ''}<b>${esc(h.name)}</b></span>
            <span class="car-st"><i class="lamp"></i>${h.host ? ico('crown', 'car-crown') : ''}${vetTag(vetOf(h), { short: true, level: h.badge?.level })}<small>${self ? 'You, ' : ''}${status}</small></span>
            ${can && humans.length > 1 ? ico('swapteam', 'car-swap') : ''}
          </button>`;
        } else {
          cells += `<div class="car bot">${ico('bots')}<small>Bot<br><em>${esc(skillName)}</em></small></div>`;
        }
      }
      return `<div class="train" style="--team:${TEAMS[team].css}" data-in="rail">
        <h3><i class="lamp"></i>${esc(TEAMS[team].name)}<small>${cars.length}/${TEAM_SIZE}</small></h3>
        <div class="consist">${cells}</div>
      </div>`;
    };
    const isReady = me?.ready;
    const start = isHost
      ? `<button class="btn is-primary lb-go" data-sound="confirm" data-act="start" ${counting || allReady ? '' : 'disabled'}>${ico(counting || allReady ? 'play' : 'wait')}<b>${counting ? 'Start now' : allReady ? 'Start match' : 'Waiting for ready'}</b></button>`
      : counting
        ? `<div class="btn is-primary lb-go static">${ico('play')}<b>Rematch soon</b></div>`
        : rematchWait
          ? `<div class="btn lb-go static">${ico('wait')}<b>Waiting for host</b></div>`
          : `<button class="btn lb-go ${isReady ? 'is-go' : 'is-primary'}" data-act="toggleReady">${ico(isReady ? 'ready' : 'check')}<b>${isReady ? 'Ready' : 'Tap when ready'}</b></button>`;
    this.el.innerHTML = `
      <header class="bar lb-bar" data-in="down">
        ${backButton('leaveLobby', 'Leave')}
        <div class="room">
          <span>Room code</span>
          <div class="code-tiles">${[...code].map(c => `<b>${esc(c)}</b>`).join('')}</div>
        </div>
        ${isHost ? inviteControls() : ''}
        <p class="room-tip">${ffa ? (isHost && !counting ? 'Invite friends, or read them this code. Free-for-All: everyone for themselves.' : 'Free-for-All: everyone for themselves.') : isHost ? (counting ? 'Tap a player to swap teams.' : 'Invite friends, or read them this code. Tap a player to swap their team.') : 'Tap your name to swap teams.'}</p>
        ${counting ? `<div class="auto-start"><span>Starting in</span><b class="auto-n">${countdown}</b></div>` : ''}
      </header>
      <div class="yard-lines">
        ${train(0)}
        ${train(1)}
      </div>
      <footer class="lobby-foot" data-in="up">
        <div class="skills${isHost ? '' : ' fixed'}">
          <span>${ico('bots')}Bots</span>
          ${isHost
            ? SKILLS.map(([id, label]) => `<button class="seg${botSkill === id ? ' on' : ''}" data-act="botSkill" data-skill="${id}">${label}</button>`).join('')
            : `<b class="seg on">${esc(skillName)}</b>`}
        </div>
        <button class="chip" data-act="loadout">${ico('loadout')}<b>${esc(Progress.loadouts()[Progress.activeLoadout].name)}</b></button>
        <button class="chip" data-act="gunsmith">${ico('gunsmith')}<b>Gunsmith</b></button>
        <button class="chip" data-act="operators">${ico('operator')}<b>Operators</b></button>
        ${start}
      </footer>`;
    this.show();
  }

  // The first call for a vote builds the screen, later calls for the same vote patch it.
  vote(state) {
    if (this.el.dataset.screen !== 'vote' || this.voteKey !== state.key) {
      this.#stopPreview();
      this.#endReel();
      this.overlay('');
      this.voteKey = state.key;
      this.el.dataset.screen = 'vote';
      this.el.innerHTML = voteMarkup(state);
      followMapArt(this.el);
    }
    paintVote(this.el, state);
    this.show();
  }

  // Solo picks: built once when the screen opens, then only the selection marks change.
  solo(state) {
    if (this.el.dataset.screen === 'solo' && this.el.classList.contains('on') && this.el.querySelector('.solo')) {
      paintSolo(this.el, state);
      this.#paintBotMatch(state);
      return;
    }
    this.#stopPreview();
    this.#endReel();
    this.el.dataset.screen = 'solo';
    this.el.innerHTML = soloMarkup(state);
    // The mode strip scrolls natively; the bot match settings sit between it and Start.
    this.el.querySelector('.solo-modes')?.classList.add('scroll-x');
    this.el.querySelector('.solo-start')?.insertAdjacentHTML('beforebegin', `<button class="btn solo-bots" data-act="soloBots" aria-label="Bot match settings">${ico('bot')}<span><b></b><small></small></span></button>`);
    this.#paintBotMatch(state);
    paintSolo(this.el, state);
    followMapArt(this.el);
    this.show();
  }

  // The settings button's two lines: difficulty, then sides and limits for the picked mode.
  #paintBotMatch(state) {
    const btn = this.el.querySelector('.solo-bots');
    if (!btn) return;
    const s = botMatchSummary(state);
    btn.querySelector('b').textContent = s.top;
    btn.querySelector('small').textContent = s.sub;
    btn.classList.toggle('custom', !!s.custom);
  }

  operators(opts) {
    this.#stopPreview();
    this.screen = new OperatorsScreen(this, opts);
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

  options(opts) {
    this.#stopPreview();
    optionsScreen(this, opts);
  }

  help(opts) {
    this.#stopPreview();
    helpScreen(this, opts);
  }

  challenges(opts) {
    this.#stopPreview();
    challengesScreen(this, opts);
  }

  history(opts) {
    this.#stopPreview();
    historyScreen(this, opts);
  }

  // First run only: a sheet over the title offering the guided match. Either answer closes it for good (main.js
  // records that); How to play keeps the way back in.
  tutorialOffer({ onStart, onSkip }) {
    this.overlay(`
      <div class="sheet tut-offer">
        <div class="tut-offer-mark" aria-hidden="true">${ico('ui:aim')}</div>
        <div class="tut-offer-body">
          <span class="tut-offer-kick">New to the yard?</span>
          <h2>Take a two-minute training run</h2>
          <p>Move, aim and fire, slide, throw and call in a streak, against targets first and then bots that shoot back. Skip it any time.</p>
          <div class="sheet-row">
            <button class="btn" data-act="tutSkip">${ico('close')}<b>Not now</b></button>
            <button class="btn is-primary" data-sound="confirm" data-act="tutStart">${ico('play')}<b>Start training</b></button>
          </div>
          <small class="tut-offer-note">${ico('info')}It stays in How to play.</small>
        </div>
      </div>`);
    this.on({ tutStart: () => { this.overlay(''); onStart(); }, tutSkip: () => { this.overlay(''); onSkip(); } });
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

  // data: outcome, scores, myTeam, localId, roster, badges, mvp, xp, level, weapons, unlocks, finalKill, rematchLabel, note.
  results(data, handlers) {
    this.#stopPreview();
    resultsScreen(this, data, handlers);
  }

  // Shown once to Safari players who have not added the game to their Home Screen.
  installPrompt(onDismiss) {
    this.overlay(`
      <div class="sheet install">
        <div class="sheet-head">${ico('phone')}<h2>Add to Home Screen</h2></div>
        <p>Switchyard runs full screen from your Home Screen, with no browser bars in the way of your thumbs.</p>
        <ol class="steps">
          <li><span class="step-n">1</span>${ico('share')}<span>Tap <b>Share</b> in Safari</span></li>
          <li><span class="step-n">2</span>${ico('plus')}<span>Choose <b>Add to Home Screen</b></span></li>
          <li><span class="step-n">3</span>${ico('play')}<span>Open Switchyard from its new icon</span></li>
        </ol>
        <div class="sheet-row"><button class="btn is-primary" data-sound="confirm" data-act="dismissInstall">${ico('check')}<b>Got it</b></button></div>
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
    this.preview.w = 0;                 // The operator turntable may have resized the shared buffer since the gun last drew.
    this.preview.tick(0);               // Lets the preview measure the canvas, so the gun is framed for this card's shape.
    this.preview.show(weaponId, camoId, kit);
    this.ticking = this.preview;
    this.#runPreview();
  }

  // The operator turntable, on the same canvas and context as the guns.
  operatorMount(mount, operator, weaponId, camoId, kit) {
    if (!mount) return;
    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement('canvas');
      this.previewCanvas.className = 'preview-canvas';
    }
    if (this.previewCanvas.parentNode !== mount) mount.prepend(this.previewCanvas);
    if (!this.preview) this.preview = new GunPreview(this.previewCanvas);
    this.opPreview ??= new OperatorPreview(this.preview.webgl, this.previewCanvas);
    this.opPreview.show(operator, weaponId, camoId, 0, kit);
    this.ticking = this.opPreview;
    this.#runPreview();
  }

  // Capped well under the display rate, and skipped entirely while a finger is on a button or a list is moving: on a
  // phone the WebGL frame is the heaviest work on the main thread, and touch events and scroll events wait behind it.
  #runPreview() {
    if (this.previewRaf) return;
    let last = performance.now(), drawn = 0;
    const tick = now => {
      this.previewRaf = requestAnimationFrame(tick);
      if (fingerDown() || scrolling() || now - drawn < PREVIEW_MS) return;
      drawn = now;
      this.ticking.tick(Math.min(0.1, (now - last) / 1000));
      last = now;
    };
    this.previewRaf = requestAnimationFrame(tick);
  }

  previewShow(weaponId, camoId, kit) {
    this.preview?.show(weaponId, camoId, kit);
  }

  // Redraws whichever turntable is showing, after something else has borrowed the shared buffer.
  redrawPreview() {
    if (this.previewCanvas?.isConnected) this.ticking?.tick(0);
  }

  // Fills every canvas[data-gun] under root with its cached picture. The preview must already be mounted.
  paintGuns(root, resolve) {
    (this.thumbs ??= new GunThumbs(this)).fill(root, resolve);
  }

  warmGuns(ids, resolve) {
    (this.thumbs ??= new GunThumbs(this)).warm(ids, resolve);
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
