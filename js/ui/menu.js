// Every screen outside a match. Stateless templates driven by main.js through this small object.
import { TEAMS, TEAM_SIZE, PRIMARY_IDS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { CAMOS, getCamo } from '../shared/camos.js';
import { GunPreview } from '../render/renderer.js';
import { Progress } from './progress.js';
import { yardBackdrop } from './yard.js';

const QWERTY = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM-_.'];
const CODE_CHARS = ['ABCDEFGHJKM', 'NPQRSTUVWX', 'YZ23456789'];

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = n => '#' + n.toString(16).padStart(6, '0');

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
    this.preview = null;
    this.previewRaf = 0;

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
    const { level, into, span } = Progress.levelProgress();
    const name = Progress.name || 'Rookie';
    this.el.dataset.screen = 'title';
    this.el.innerHTML = `
      ${yardBackdrop()}
      <section class="boxcar${arrive ? ' arrive' : ''}">
        <div class="boxcar-ribs"></div>
        <div class="boxcar-face">
          <h1 class="wordmark">Switchyard</h1>
          <p class="wordmark-sub">6v6 team deathmatch in a freight yard at dusk</p>
          <button class="callsign" data-act="editName">
            <span class="cs-label">Callsign</span>
            <b class="cs-name">${esc(name)}</b>
            <span class="cs-rank">Level ${level}<i class="xp"><i style="transform:scaleX(${(into / span).toFixed(3)})"></i></i></span>
          </button>
        </div>
      </section>
      <nav class="routes">
        <button class="route primary" data-act="solo"><i class="lamp"></i><b>Play vs bots</b></button>
        <button class="route" data-act="host"><i class="lamp"></i><b>Host a match</b></button>
        <button class="route" data-act="join"><i class="lamp"></i><b>Join with a code</b></button>
        <button class="route" data-act="gunsmith"><i class="lamp"></i><b>Gunsmith</b></button>
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
    this.el.dataset.screen = 'lobby';
    const { code, humans, botSkill, isHost, localId, net } = state;
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
            <b>${esc(h.name)}</b>
            <small>${h.host ? 'Host' : h.ready ? 'Ready' : 'Not ready'}</small>
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
      ? `<button class="route primary" data-act="start" ${allReady ? '' : 'disabled'}><i class="lamp"></i><b>${allReady ? 'Start match' : 'Waiting for ready'}</b></button>`
      : `<button class="route primary${isReady ? ' lit' : ''}" data-act="toggleReady"><i class="lamp"></i><b>${isReady ? 'Ready' : 'Tap when ready'}</b></button>`;
    this.el.innerHTML = `
      <header class="bar">
        <button class="back" data-act="leaveLobby">Leave</button>
        <div class="room">
          <span>Room code</span>
          <b>${esc(code)}</b>
        </div>
        <p class="room-tip">${isHost ? 'Read this code to friends. Tap a player to swap teams.' : 'Tap your name to swap teams.'}</p>
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
        <button class="route small" data-act="gunsmith"><b>${esc(WEAPONS[Progress.primary]?.name ?? '')}</b></button>
        ${start}
      </footer>`;
    this.show();
  }

  gunsmith({ onBack, onChange }) {
    let weapon = Progress.primary;
    const render = () => {
      this.el.dataset.screen = 'gunsmith';
      const equipped = Progress.camo(weapon);
      const w = WEAPONS[weapon];
      const kills = Progress.kills(weapon);
      this.el.innerHTML = `
        <header class="bar">
          <button class="back" data-act="gsBack">Done</button>
          <h2>Gunsmith</h2>
          <p class="kills-note"><b>${kills}</b> kills with the ${esc(w.name)}</p>
        </header>
        <div class="gs">
          <div class="gs-weapons">
            ${PRIMARY_IDS.map(id => `<button class="gs-w${id === weapon ? ' on' : ''}" data-act="gsWeapon" data-id="${id}"><b>${esc(WEAPONS[id].name)}</b><small>${esc(WEAPONS[id].role ?? '')}</small></button>`).join('')}
          </div>
          <div class="gs-bench">
            <canvas class="gs-canvas"></canvas>
            <div class="gs-title"><b>${esc(w.name)}</b><small>${esc(getCamo(equipped).name)}</small></div>
            <div class="gs-stats">
              ${stat('Damage', w.damage * (w.pellets ?? 1), 150)}
              ${stat('Rate', w.rpm, 1000)}
              ${stat('Range', w.range, 80)}
            </div>
          </div>
          <div class="gs-camos">
            ${CAMOS.map(c => camoTile(c, weapon, equipped)).join('')}
          </div>
        </div>`;
      this.#startPreview(this.el.querySelector('.gs-canvas'), weapon, equipped);
    };
    this.on({
      gsBack: () => onBack(),
      gsWeapon: ({ id }) => {
        weapon = id;
        Progress.primary = id;
        onChange?.();
        render();
      },
      gsCamo: ({ id }) => {
        if (!Progress.isUnlocked(weapon, id)) {
          const c = getCamo(id);
          this.toast(`${c.name}: ${Progress.kills(weapon)}/${c.unlockKills} kills with the ${WEAPONS[weapon].name}`);
          return;
        }
        Progress.setCamo(weapon, id);
        onChange?.();
        render();
      },
    });
    render();
    this.show();
  }

  // data: { results, title, mine, xpGained, levelInfo, unlocks, mvp, finalKill, finalKillBy, teams, next:'lobby'|'menu' }
  results(data, onContinue) {
    this.#stopPreview();
    this.el.dataset.screen = 'results';
    const { outcome, scores, myTeam, roster, mvp, xpGained, level, unlocks, finalKill } = data;
    const board = team => {
      const rows = roster.filter(p => p.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      return `<div class="board" style="--team:${TEAMS[team].css}">
        <h3>${esc(TEAMS[team].name)}<b>${scores[team]}</b></h3>
        ${rows.map(p => `<div class="brow${p.id === data.localId ? ' me' : ''}"><span>${esc(p.name)}</span><b>${p.kills}</b><em>${p.deaths}</em></div>`).join('')}
      </div>`;
    };
    const fk = finalKill;
    this.el.innerHTML = `
      <div class="res-head" data-outcome="${outcome}">
        <h2>${outcome === 'win' ? 'Victory' : outcome === 'loss' ? 'Defeat' : 'Stalemate'}</h2>
      </div>
      <div class="res-main">
        <div class="boards">${board(myTeam)}${board(1 - myTeam)}</div>
        <aside class="res-side">
          ${mvp ? `<div class="mvp" style="--team:${TEAMS[mvp.team].css}"><span>Most valuable</span><b>${esc(mvp.name)}</b><small>${mvp.kills} ${mvp.kills === 1 ? 'kill' : 'kills'}, ${mvp.deaths} ${mvp.deaths === 1 ? 'death' : 'deaths'}</small></div>` : ''}
          <div class="finalcard">
            <canvas class="fk-canvas"></canvas>
            <div class="fk-cap">${fk ? `Final kill by <b>${esc(fk.byName)}</b> with the ${esc(WEAPONS[fk.weapon]?.name ?? fk.weapon)}` : 'No final kill'}</div>
          </div>
        </aside>
      </div>
      <footer class="res-foot">
        <div class="xpbar">
          <div class="xp-line"><b>+${xpGained} XP</b><span>Level ${level.level}${level.levelUp ? ', level up' : ''}</span></div>
          <i class="xp big"><i class="xp-fill" style="transform:scaleX(${(level.into / level.span).toFixed(3)})"></i></i>
          ${unlocks.length ? `<div class="unlocks">${unlocks.map(u => `<span><i style="background:${hex(u.colors[0])}"></i>${esc(u.weaponName)}: ${esc(u.name)}</span>`).join('')}</div>` : ''}
        </div>
        <button class="route primary" data-act="resContinue"><i class="lamp"></i><b>${data.continueLabel}</b></button>
      </footer>`;
    this.on({ resContinue: onContinue });
    if (fk) this.#startPreview(this.el.querySelector('.fk-canvas'), fk.weapon, fk.camo);
    this.show();
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

  #startPreview(canvas, weaponId, camoId) {
    this.#stopPreview();
    if (!canvas) return;
    this.preview = new GunPreview(canvas);
    this.preview.tick(0);               // Lets the preview measure the canvas, so the gun is framed for this card's shape.
    this.preview.show(weaponId, camoId);
    let last = performance.now();
    const tick = now => {
      this.previewRaf = requestAnimationFrame(tick);
      this.preview.tick(Math.min(0.1, (now - last) / 1000));
      last = now;
    };
    this.previewRaf = requestAnimationFrame(tick);
  }

  #stopPreview() {
    cancelAnimationFrame(this.previewRaf);
    this.preview?.dispose();
    this.preview = null;
  }
}

// A swatch hints at the pattern family with CSS only; the real thing is on the gun in the preview.
function swatchCss(c) {
  const [a, b = a, d = b, e = d] = c.colors.map(hex);
  switch (c.pattern) {
    case 'digital': return `conic-gradient(${a} 25%, ${b} 25% 50%, ${d} 50% 75%, ${e} 75%) 0 0 / 14px 14px`;
    case 'tiger': return `repeating-linear-gradient(112deg, ${a} 0 9px, ${b} 9px 15px, ${d} 15px 19px, ${b} 19px 25px)`;
    case 'splinter': return `linear-gradient(127deg, ${a} 34%, transparent 34.5%), linear-gradient(58deg, ${b} 46%, ${d} 46.5% 72%, ${e} 72.5%)`;
    case 'hex': return `radial-gradient(circle at 50% 50%, ${b} 34%, ${a} 36%) 0 0 / 12px 11px`;
    case 'solid': return a;
    default: return `linear-gradient(118deg, ${a}, ${b} 55%, ${d})`;
  }
}

function stat(label, value, full) {
  return `<div class="stat"><span>${label}</span><i><i style="transform:scaleX(${Math.min(1, value / full).toFixed(3)})"></i></i></div>`;
}

function camoTile(c, weapon, equipped) {
  const unlocked = Progress.isUnlocked(weapon, c.id);
  const kills = Progress.kills(weapon);
  const swatch = swatchCss(c);
  const progress = unlocked ? '' : `<i class="tile-bar"><i style="transform:scaleX(${Math.min(1, kills / c.unlockKills).toFixed(3)})"></i></i><small>${kills}/${c.unlockKills}</small>`;
  return `<button class="tile${c.id === equipped ? ' on' : ''}${unlocked ? '' : ' locked'}" data-act="gsCamo" data-id="${c.id}" aria-label="${esc(c.name)}">
    <span class="tile-swatch" style="background:${swatch}"></span>
    <b>${esc(c.name)}</b>
    ${progress}
  </button>`;
}
