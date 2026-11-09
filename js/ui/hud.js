// In-match overlay. Built once; update() runs every frame and touches the DOM only when a displayed value
// actually changes, and then only with text, a transform or a class flip.
import { TEAMS, MAX_HP, SCORE_LIMIT, PRIMARY_IDS, TIME_LIMIT } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { MAPS, DEFAULT_MAP } from '../shared/map.js';
import { hasLineOfSight } from '../shared/geometry.js';
import { getCamo } from '../shared/camos.js';
import { STREAKS, LETHALS, normalizeLoadout } from '../shared/catalog.js';
import { Progress, matchScore } from './progress.js';
import { LoadoutEditor } from './loadout.js';

const MINIMAP_HZ = 10;
const MM_SCALE = 2;              // Backing-store pixels per CSS pixel; fixed so the canvas is never resized.
const MM_WIDTH = 118;            // CSS pixels; the height follows the map's aspect.
const FEED_ROWS = 4;
const FEED_LIFE = 5.5;
const HIT_LIFE = 0.22;
const DMG_LIFE = 1.3;
const MEDAL_LIFE = 1.6;
const MEDAL_GAP = 0.55;
const LOW_AMMO = 0.25;
const SKULL_LIFE = 0.55;         // A kill marker lingers longer than a hit tick so it registers mid-fight.
const HEAT_WARN = 0.72;          // Heat fraction where the bar starts to pulse.
const FLASH_HOLD = 1.6;          // Seconds of solid white at full flash strength, before the fade.
const FLASH_FADE = 1.8;
const FIRE_REVEAL = 1.5;         // Matches the sim's firingT lifetime; only shapes the minimap ping's fade.
const BOARD_HZ = 4;
const END_BANNER_MIN = 700;

const MEDALS = {
  first_blood: ['First Blood', 'Round opener'], double: ['Double Kill', '2 in quick order'], triple: ['Triple Kill', '3 in quick order'],
  fury: ['Fury Kill', '4 or more'], revenge: ['Revenge', 'Settled the score'], longshot: ['Longshot', 'From across the yard'],
  streak3: ['Three Streak', 'UAV earned'], streak5: ['Five Streak', 'Strike earned'], streak10: ['Ten Streak', 'Unbroken'],
};

const CALLOUT_POP = [
  { opacity: 0, transform: 'translateX(-50%) scale(1.8)' },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.14 },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.7 },
  { opacity: 0, transform: 'translate(-50%,-8px) scale(1)' },
];
const HEAL_PULSE = [{ opacity: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0 }];

const pad2 = n => (n < 10 ? '0' + n : '' + n);
const weaponName = id => WEAPONS[id]?.name ?? (id === 'strike' ? 'Strike' : id ?? '');

// What the feed names for a kill: a gun id alone would credit the gun for a grenade or streak kill.
function killCause(e) {
  if (e.equip) return LETHALS[e.equip]?.name ?? e.equip;
  if (typeof e.streak === 'string') return STREAKS[e.streak]?.name ?? e.streak;
  return weaponName(e.weapon);
}

export class HUD {
  constructor(root) {
    this.root = root;
    this.loadoutCb = null;
    this.micCb = null;
    this.speakerCb = null;
    this.controls = null;
    this.map = MAPS[DEFAULT_MAP];
    this.scoreLimit = SCORE_LIMIT;
    this.timeLimit = TIME_LIMIT;
    this.primary = Progress.primary;
    this.sheetEditor = null;
    this.#seedFallback();
    this.#build();
    this.#drawMapBase();
    this.reset();
  }

  // Controls owns the buttons and streak tiles so there is a single touch surface; the HUD feeds them.
  bindControls(controls) {
    this.controls = controls;
  }

  // Tiles and buttons need something to draw before the first frame that carries real slots.
  #seedFallback() {
    const l = normalizeLoadout(Progress.loadout());
    this.fallbackSlots = l.streaks.map(kind => ({ kind, cost: STREAKS[kind].cost, held: false, blocked: false }));
    this.fallbackEquip = { tactical: l.tactical, lethal: l.lethal };
  }

  // Call before each match.
  prepare({ mapId = DEFAULT_MAP, scoreLimit = SCORE_LIMIT, timeLimit = TIME_LIMIT } = {}) {
    this.map = MAPS[mapId] ?? this.map;
    this.scoreLimit = scoreLimit;
    this.timeLimit = timeLimit;
    this.primary = Progress.primary;
    this.#seedFallback();
    this.#drawMapBase();
    this.reset();
  }

  reset() {
    // Cached display values. NaN and '' can never equal a real value, so the first update writes everything.
    this.cache = {
      myScore: NaN, otherScore: NaN, teamFlip: NaN, time: NaN, phase: '', hp: NaN, hpFrac: NaN, ammo: NaN, reserve: NaN,
      weapon: '', reloadFrac: NaN, reloadOn: null, low: null, hurt: null, vign: NaN, dead: null, respawn: NaN,
      protect: null, picked: '', enemyUav: null, tag: '', heatOn: null, heat: NaN, heatLevel: '', overBanner: null,
      score: NaN, capped: null, swapHint: null,
    };
    this.view = null;
    this.unlocks = [];            // Camos earned this match, drained by the results screen.
    this.mmClock = 0;
    this.hitT = 0;
    this.hitKill = false;
    this.hitHead = false;
    this.hitLife = HIT_LIFE;
    this.flashT = 0;
    this.flashLen = 1;
    this.weaponKills = {};        // Kills per weapon this match, for the results screen.
    this.boardOpen = false;
    this.boardClock = 0;
    this.closeSheet();
    this.boardEl.hidden = true;
    this.flashFadeLen = 1;
    this.flashEl.style.opacity = '0';
    this.feed = [];
    this.medalQueue = [];
    this.medalClock = 0;
    this.killer = null;
    this.endShown = false;
    this.endAt = 0;
    this.feedEl.textContent = '';
    this.medalsEl.textContent = '';
    for (const d of this.dmg) { d.life = 0; d.el.style.opacity = '0'; }
    this.hitEl.style.opacity = '0';
    this.deathEl.classList.remove('show');
    this.endEl.classList.remove('show');
    this.controls?.setDown(false);
    this.setNotice('');
    this.setSpectate(null);
    this.#paintPicker();
  }

  setVisible(on) {
    this.el.classList.toggle('on', on);
  }

  // cb(loadout), the full normalized loadout, whenever the player changes it on the death screen.
  onSetLoadout(cb) { this.loadoutCb = cb; }
  onMic(cb) { this.micCb = cb; }
  onSpeaker(cb) { this.speakerCb = cb; }

  // state: 'off' | 'requesting' | 'on' | 'denied' | 'unavailable' | 'hidden'
  setMic(state, muted = false) {
    this.micBtn.dataset.state = state;
    this.micBtn.hidden = state === 'hidden' || state === 'unavailable';
    this.speakerBtn.hidden = this.micBtn.hidden;
    this.speakerBtn.classList.toggle('muted', muted);
  }

  // Pass null for solo play. Otherwise { rtt: ms|null, status, isHost }.
  setNet(info) {
    const chip = this.netChip;
    if (!info) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    let text, grade;
    if (info.status === 'host-lost') {
      text = 'Lost'; grade = 'bad';
    } else if (info.isHost) {
      text = 'Host'; grade = 'good';
    } else if (info.rtt === null || info.rtt === undefined) {
      text = '--'; grade = 'mid';
    } else {
      const ms = Math.round(info.rtt);
      text = ms + ' ms';
      grade = ms < 70 ? 'good' : ms < 160 ? 'mid' : 'bad';
    }
    if (this.netText.textContent !== text) this.netText.textContent = text;
    chip.dataset.grade = grade;
  }

  // Persistent centre line, e.g. the host-lost countdown; empty string hides it.
  setNotice(text) {
    if (this.noticeEl.textContent !== text) this.noticeEl.textContent = text;
    this.noticeEl.classList.toggle('show', !!text);
  }

  // Short line in the kill feed for things that are not kills.
  notify(text) {
    this.#pushFeed(`<span class="f-note">${esc(text)}</span>`);
  }

  // Name of the player being watched, or null.
  setSpectate(name) {
    this.specEl.hidden = !name;
    if (name) this.specEl.textContent = `Watching ${name}`;
  }

  // Shows the end banner, then calls onDone once the player has had a moment to read it.
  showEnd(results, onDone) {
    this.#showEndBanner(results.winner, results.myTeam);
    const wait = Math.max(0, END_BANNER_MIN - (performance.now() - this.endAt));
    setTimeout(() => {
      this.endEl.classList.remove('show');
      onDone?.();
    }, wait);
  }

  #build() {
    const el = this.el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="vignette"></div>
      <div class="scorebar" data-tap="1">
        <div class="sb-side mine">
          <b class="sb-name"></b><b class="sb-score">0</b>
          <i class="sb-track"><i class="sb-fill"></i></i>
        </div>
        <div class="sb-time"><b>10:00</b></div>
        <div class="sb-side theirs">
          <b class="sb-score">0</b><b class="sb-name"></b>
          <i class="sb-track"><i class="sb-fill"></i></i>
        </div>
      </div>
      <div class="minimap">
        <canvas width="${MM_WIDTH * MM_SCALE}" height="${Math.round(MM_WIDTH * MM_SCALE * 2 / 3)}"></canvas>
        <span class="mm-tag" hidden>Enemy UAV</span>
      </div>
      <div class="feed"></div>
      <div class="medals"></div>
      <div class="hit">
        <svg class="hit-x" viewBox="-20 -20 40 40" aria-hidden="true"><path d="M-14 -14l9 9M14 -14l-9 9M-14 14l9 -9M14 14l-9 -9" /></svg>
        <svg class="hit-skull" viewBox="-20 -20 40 40" aria-hidden="true"><path d="M0 -17C-11 -17 -16 -10 -16 -3C-16 3 -13 6 -10 8L-9 14H-5V10H-2V14H2V10H5V14H9L10 8C13 6 16 3 16 -3C16 -10 11 -17 0 -17ZM-9 -6A4.5 4.5 0 1 1 -9 3A4.5 4.5 0 1 1 -9 -6ZM9 -6A4.5 4.5 0 1 1 9 3A4.5 4.5 0 1 1 9 -6ZM0 2L3 7H-3Z" fill-rule="evenodd"/></svg>
      </div>
      ${[0, 1, 2, 3].map(() => '<svg class="dmg" viewBox="-110 -110 220 220" aria-hidden="true"><path d="M-46 -94 A105 105 0 0 1 46 -94 L39 -80 A90 90 0 0 0 -39 -80 Z" /></svg>').join('')}
      <div class="corner">
        <div class="net-chip" hidden><i class="bars"><i></i><i></i><i></i></i><span>--</span></div>
        <button class="chip-btn speaker" data-tap="1" hidden aria-label="Mute team voice">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM17 8.5a5 5 0 0 1 0 7M20 6a9 9 0 0 1 0 12" /></svg>
        </button>
        <button class="chip-btn mic" data-tap="1" data-state="hidden" hidden aria-label="Team voice">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11v1a6 6 0 0 0 12 0v-1M12 18v3M8.5 21h7" /></svg>
          <span class="mic-tag"></span>
        </button>
      </div>
      <div class="status">
        <div class="vitals">
          <span class="hp-num">100</span>
          <i class="hp-track"><i class="hp-fill"></i></i>
          <span class="protect" hidden>Protected</span>
        </div>
        <div class="arms">
          <i class="heat" hidden><i class="heat-fill"></i></i>
          <div class="arms-name"><span></span></div>
          <div class="arms-count"><b class="ammo">30</b><span class="reserve">/150</span></div>
          <i class="reload-track"><i class="reload-fill"></i></i>
        </div>
      </div>
      <div class="over-banner"><b>Overheated</b><small>Swap to sidearm</small></div>
      <div class="board" hidden><div class="board-grid"></div><small class="board-tip">Tap the score to close</small></div>
      <div class="callout"></div>
      <div class="notice"></div>
      <div class="spectate" hidden></div>
      <div class="death">
        <div class="death-head">
          <div class="death-by"></div>
          <div class="death-count">3</div>
        </div>
        <div class="picker">
          <span class="picker-label">Next life</span>
          ${PRIMARY_IDS.map(id => `
          <button class="pick" data-tap="1" data-weapon="${id}">
            <b>${esc(weaponName(id))}</b><small>${esc(WEAPONS[id]?.role ?? '')}</small>
          </button>`).join('')}
          <button class="pick pick-loadout" data-tap="1"><b>Loadout</b><small>Gear</small></button>
        </div>
      </div>
      <div class="sheet-wrap" data-tap="1" hidden>
        <div class="loadout-sheet">
          <div class="ls-bar"><h2>Loadout</h2><small>Applies when you next spawn</small><button class="back" data-sheet-close="1">Close</button></div>
          <div class="lo-grid"></div>
        </div>
      </div>
      <div class="flashbang"></div>
      <div class="heal-veil"></div>
      <div class="endbanner"><b></b><small></small></div>`;
    this.root.appendChild(el);

    const $ = sel => el.querySelector(sel);
    this.vignette = $('.vignette');
    const sides = el.querySelectorAll('.sb-side');
    this.sbMine = { root: sides[0], score: sides[0].querySelector('.sb-score'), name: sides[0].querySelector('.sb-name'), fill: sides[0].querySelector('.sb-fill') };
    this.sbTheirs = { root: sides[1], score: sides[1].querySelector('.sb-score'), name: sides[1].querySelector('.sb-name'), fill: sides[1].querySelector('.sb-fill') };
    this.timeEl = $('.sb-time b');
    this.mmCanvas = $('.minimap canvas');
    this.mm = this.mmCanvas.getContext('2d');
    this.mmTag = $('.mm-tag');
    this.feedEl = $('.feed');
    this.medalsEl = $('.medals');
    this.hitEl = $('.hit');
    this.dmg = [...el.querySelectorAll('.dmg')].map(node => ({ el: node, life: 0, angle: 0 }));
    this.netChip = $('.net-chip');
    this.netText = $('.net-chip span');
    this.micBtn = $('.chip-btn.mic');
    this.speakerBtn = $('.chip-btn.speaker');
    this.hpNum = $('.hp-num');
    this.hpFill = $('.hp-fill');
    this.protectEl = $('.protect');
    this.vitals = $('.vitals');
    this.heatEl = $('.heat');
    this.heatFill = $('.heat-fill');
    this.overEl = $('.over-banner');
    this.boardEl = $('.board');
    this.boardGrid = $('.board-grid');
    this.calloutEl = $('.callout');
    this.flashEl = $('.flashbang');
    this.healEl = $('.heal-veil');
    this.sheetWrap = $('.sheet-wrap');
    this.loGrid = $('.lo-grid');
    this.hitX = $('.hit-x');
    this.armsName = $('.arms-name span');
    this.ammoEl = $('.ammo');
    this.reserveEl = $('.reserve');
    this.reloadTrack = $('.reload-track');
    this.reloadFill = $('.reload-fill');
    this.arms = $('.arms');
    this.noticeEl = $('.notice');
    this.specEl = $('.spectate');
    this.deathEl = $('.death');
    this.deathBy = $('.death-by');
    this.deathCount = $('.death-count');
    this.picks = [...el.querySelectorAll('.pick')];
    this.endEl = $('.endbanner');

    this.micBtn.addEventListener('click', () => this.micCb?.());
    this.speakerBtn.addEventListener('click', () => this.speakerCb?.());
    for (const pick of this.picks) {
      if (pick.dataset.weapon) pick.addEventListener('click', () => this.#choose(pick.dataset.weapon));
    }
    $('.pick-loadout').addEventListener('click', () => this.openSheet());
    el.addEventListener('click', e => { if (e.target.closest('[data-sheet-close]')) this.closeSheet(); });
    $('.scorebar').addEventListener('click', () => this.toggleBoard());
    this.#buildBoard();
  }

  // Twelve rows made once and only ever retexted, so an open board costs a few text writes a second.
  #buildBoard() {
    this.boardGrid.innerHTML = [0, 1].map(() => `
      <div class="lb-side">
        <div class="lb-head"><b class="lb-team"></b><span>K</span><span>D</span><span>A</span><span>HS</span><span>Score</span></div>
        ${[0, 1, 2, 3, 4, 5].map(() => '<div class="lb-row"><b></b><span></span><span></span><span></span><span></span><span></span></div>').join('')}
      </div>`).join('');
    this.boardSides = [...this.boardGrid.querySelectorAll('.lb-side')].map(node => ({
      team: node.querySelector('.lb-team'),
      rows: [...node.querySelectorAll('.lb-row')],
    }));
  }

  toggleBoard() {
    this.boardOpen = !this.boardOpen;
    this.boardEl.hidden = !this.boardOpen;
    this.boardClock = 0;
    if (this.boardOpen && this.view) this.#paintBoard(this.view);
  }

  #paintBoard(view) {
    const me = this.#findLocal(view);
    if (!me) return;
    [me.team, 1 - me.team].forEach((team, s) => {
      const side = this.boardSides[s];
      side.team.textContent = `${TEAMS[team].name}  ${view.scores[team]}`;
      side.team.style.color = TEAMS[team].css;
      const rows = view.players.filter(p => p.team === team).sort((a, b) => matchScore(b) - matchScore(a) || a.deaths - b.deaths);
      side.rows.forEach((row, i) => {
        const p = rows[i], cells = row.children;
        row.hidden = !p;
        if (!p) return;
        row.classList.toggle('me', p.id === me.id);
        cells[0].textContent = p.name;
        cells[1].textContent = p.kills;
        cells[2].textContent = p.deaths;
        cells[3].textContent = p.assists ?? 0;
        cells[4].textContent = p.head ?? 0;
        cells[5].textContent = matchScore(p);
      });
    });
  }

  openSheet() {
    this.sheetWrap.hidden = false;
    this.sheetEditor?.dispose();
    this.sheetEditor = new LoadoutEditor(this.loGrid, l => this.loadoutCb?.({ ...l, primary: this.primary, camo: Progress.camo(this.primary) }));
  }

  closeSheet() {
    if (!this.sheetWrap) return;
    this.sheetWrap.hidden = true;
    this.sheetEditor?.dispose();
    this.sheetEditor = null;
  }

  #choose(weapon) {
    this.primary = weapon;
    Progress.primary = weapon;
    this.#paintPicker();
    this.loadoutCb?.(Progress.loadout(weapon));
  }

  #paintPicker() {
    if (this.cache.picked === this.primary) return;
    this.cache.picked = this.primary;
    for (const pick of this.picks) pick.classList.toggle('on', pick.dataset.weapon === this.primary);
  }

  // --- Per-frame ---
  update(view, dt) {
    const previousPhase = this.cache.phase;
    this.view = view;
    const me = this.#findLocal(view);
    if (!me) return;
    const c = this.cache;
    const myTeam = me.team, other = 1 - myTeam;

    if (c.teamFlip !== myTeam) {
      c.teamFlip = myTeam;
      this.#paintTeams(myTeam);
    }
    if (c.myScore !== view.scores[myTeam]) {
      c.myScore = view.scores[myTeam];
      this.sbMine.score.textContent = c.myScore;
      this.sbMine.fill.style.transform = `scaleX(${Math.min(1, c.myScore / this.scoreLimit)})`;
    }
    if (c.otherScore !== view.scores[other]) {
      c.otherScore = view.scores[other];
      this.sbTheirs.score.textContent = c.otherScore;
      this.sbTheirs.fill.style.transform = `scaleX(${Math.min(1, c.otherScore / this.scoreLimit)})`;
    }

    const shown = view.phase === 'warmup' ? Math.ceil(view.timeLeft) : Math.max(0, Math.ceil(view.timeLeft));
    if (c.time !== shown) {
      c.time = shown;
      this.timeEl.textContent = `${pad2(Math.floor(shown / 60))}:${pad2(shown % 60)}`;
      this.timeEl.classList.toggle('urgent', view.phase === 'live' && shown <= 30);
    }

    if (view.phase !== previousPhase) {
      c.phase = view.phase;
      if (view.phase === 'ended' && !this.endShown) {
        this.#showEndBanner(view.winner, myTeam);
        if (this.boardOpen) this.toggleBoard();
        this.closeSheet();
      }
    }

    this.#updateVitals(me, c, view);
    this.#updateArms(me, c);
    this.#updateTiles(me, c);
    this.#updateDeath(me, c, view);
    this.#decayEffects(dt);
    this.#tickFeed(dt);
    this.#tickMedals(dt);

    if (this.boardOpen) {
      this.boardClock += dt;
      if (this.boardClock >= 1 / BOARD_HZ) {
        this.boardClock = 0;
        this.#paintBoard(view);
      }
    }

    this.mmClock += dt;
    if (this.mmClock >= 1 / MINIMAP_HZ) {
      this.mmClock = 0;
      this.#drawMinimap(view, me);
    }
  }

  #findLocal(view) {
    for (const p of view.players) if (p.id === view.localId) return p;
    return null;
  }

  #paintTeams(myTeam) {
    const mine = TEAMS[myTeam], theirs = TEAMS[1 - myTeam];
    this.sbMine.name.textContent = mine.name;
    this.sbTheirs.name.textContent = theirs.name;
    this.sbMine.root.style.setProperty('--team', mine.css);
    this.sbTheirs.root.style.setProperty('--team', theirs.css);
    this.el.style.setProperty('--my-team', mine.css);
    this.el.style.setProperty('--enemy-team', theirs.css);
  }

  #updateVitals(me, c, view) {
    const hp = Math.max(0, Math.ceil(me.hp));
    if (hp !== c.hp) {
      c.hp = hp;
      this.hpNum.textContent = hp;
      this.hpFill.style.transform = `scaleX(${hp / MAX_HP})`;
      const hurt = hp > 0 && hp <= MAX_HP * 0.35;
      if (hurt !== c.hurt) {
        c.hurt = hurt;
        this.vitals.classList.toggle('hurt', hurt);
      }
    }
    const veil = me.alive && hp <= MAX_HP * 0.5 ? Math.round((1 - hp / (MAX_HP * 0.5)) * 20) / 20 : 0;
    if (veil !== c.vign) {
      c.vign = veil;
      this.vignette.style.opacity = veil;
    }
    const protect = me.alive && me.spawnProtect && view.phase !== 'warmup';
    if (protect !== c.protect) {
      c.protect = protect;
      this.protectEl.hidden = !protect;
    }
  }

  #updateArms(me, c) {
    if (me.weapon !== c.weapon) {
      c.weapon = me.weapon;
      this.armsName.textContent = weaponName(me.weapon);
      c.magazine = WEAPONS[me.weapon]?.magazine ?? 30;
      c.tag = null;                // The status line may need to return to the weapon's name.
    }
    if (me.ammo !== c.ammo) {
      c.ammo = me.ammo;
      this.ammoEl.textContent = me.ammo;
    }
    if (me.reserve !== c.reserve) {
      c.reserve = me.reserve;
      // Sidearms carry unlimited reserve, reported as a huge number.
      this.reserveEl.textContent = me.reserve > 900 ? '/inf' : `/${me.reserve}`;
    }
    const reloading = me.reloadT > 0 && me.reloadDur > 0;
    if (reloading !== c.reloadOn) {
      c.reloadOn = reloading;
      this.reloadTrack.classList.toggle('on', reloading);
    }
    if (reloading) {
      const frac = Math.round((1 - me.reloadT / me.reloadDur) * 40) / 40;
      if (frac !== c.reloadFrac) {
        c.reloadFrac = frac;
        this.reloadFill.style.transform = `scaleX(${frac})`;
      }
    }
    // There is no reload button, so the ammo readout itself says what is happening.
    const empty = me.ammo <= 0 && me.reserve <= 0;
    const low = !reloading && me.ammo <= Math.ceil((c.magazine ?? 30) * LOW_AMMO);
    const tag = empty ? 'empty' : reloading ? 'reloading' : low ? 'low' : '';
    if (tag !== c.tag) {
      c.tag = tag;
      this.arms.dataset.tag = tag;
      this.armsName.textContent = empty ? 'Out of ammo' : reloading ? 'Reloading' : low ? 'Low ammo' : weaponName(me.weapon);
    }
    if (empty !== c.swapHint) {
      c.swapHint = empty;
      this.controls?.setSwapHint(empty);
    }
    this.#updateHeat(me, c);
  }

  #updateHeat(me, c) {
    const heatGun = !!WEAPONS[me.weapon]?.heat;
    if (heatGun !== c.heatOn) {
      c.heatOn = heatGun;
      this.heatEl.hidden = !heatGun;
    }
    const heat = heatGun ? Math.round((me.heat ?? 0) * 40) / 40 : 0;
    if (heat !== c.heat) {
      c.heat = heat;
      this.heatFill.style.transform = `scaleX(${heat})`;
    }
    const over = heatGun && !!me.overheated;
    const level = over ? 'over' : heat >= HEAT_WARN ? 'warm' : '';
    if (level !== c.heatLevel) {
      c.heatLevel = level;
      this.arms.dataset.heat = level;
    }
    if (over !== c.overBanner) {
      c.overBanner = over;
      this.overEl.classList.toggle('show', over);
    }
  }

  #updateTiles(me, c) {
    const controls = this.controls;
    if (!controls) return;
    const score = me.score ?? 0, capped = !!me.capped;
    if (score !== c.score || capped !== c.capped) {
      c.score = score; c.capped = capped;
      controls.setScore(score, capped);
    }
    const slots = me.slots ?? this.fallbackSlots;
    for (let i = 0; i < 3; i++) {
      const slot = slots[i];
      if (controls.setTile(i, slot, score)) this.medalQueue.push({ title: `${STREAKS[slot.kind]?.name ?? slot.kind} ready`, sub: 'Tap to call it in', big: true });
    }
    controls.setEquip('tactical', me.tactical ?? this.fallbackEquip.tactical, me.tacticalLeft ?? 0);
    controls.setEquip('lethal', me.lethal ?? this.fallbackEquip.lethal, me.lethalLeft ?? 0);
  }

  #updateDeath(me, c, view) {
    const dead = !me.alive && view.phase === 'live';
    if (dead !== c.dead) {
      c.dead = dead;
      this.deathEl.classList.toggle('show', dead);
      this.controls?.setDown(dead);
      if (dead) this.#paintDeathHead();
      else this.closeSheet();
    }
    if (!dead) return;
    const left = Math.max(1, Math.ceil(me.respawnT ?? 0));
    if (left !== c.respawn) {
      c.respawn = left;
      this.deathCount.textContent = left;
    }
    if (this.killer?.name && !this.deathPainted) this.#paintDeathHead();
  }

  #paintDeathHead() {
    const k = this.killer;
    this.deathPainted = !!k?.name;
    this.deathBy.innerHTML = k?.name
      ? `<em style="color:${k.color}">${esc(k.name)}</em><span>got you with the ${esc(k.weapon)}</span>`
      : '<span>Eliminated</span>';
  }

  #decayEffects(dt) {
    if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt);
      const f = this.hitT / this.hitLife;
      this.hitEl.style.opacity = Math.min(1, f * 2);
      this.hitEl.style.transform = `translate3d(-50%,-50%,0) scale(${1 + (1 - f) * 0.35})`;
    }
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.flashEl.style.opacity = Math.min(1, this.flashT / this.flashFadeLen).toFixed(3);
    }
    for (const d of this.dmg) {
      if (d.life <= 0) continue;
      d.life = Math.max(0, d.life - dt);
      d.el.style.opacity = Math.min(1, d.life / DMG_LIFE * 1.6);
    }
  }

  // --- Events ---
  onEvents(events) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'hit': this.#onHit(e); break;
        case 'kill': this.#onKill(e); break;
        case 'medal': if (e.id === this.view?.localId) this.medalQueue.push(e.medal); break;
        case 'spawn': if (e.id === this.view?.localId) { this.killer = null; this.deathPainted = false; } break;
        case 'streak': this.#onStreak(e); break;
        case 'flashed': if (e.id === this.view?.localId) this.#onFlashed(e.amount ?? 1); break;
        case 'heal': if (e.id === this.view?.localId) this.healEl.animate(HEAL_PULSE, { duration: 520 }); break;
        default: break;
      }
    }
  }

  #onHit(e) {
    const localId = this.view?.localId;
    if (e.by === localId) {
      const kill = !!e.killed, head = !!e.head;
      this.hitLife = kill ? SKULL_LIFE : HIT_LIFE;
      this.hitT = this.hitLife;
      if (this.hitKill !== kill) {
        this.hitKill = kill;
        this.hitEl.classList.toggle('kill', kill);
      }
      if (this.hitHead !== head) {
        this.hitHead = head;
        this.hitEl.classList.toggle('head', head);
      }
      if (head) this.#callout(kill ? 'Headshot kill' : 'Headshot');
    }
    if (e.target === localId && e.by !== localId) this.#damageFrom(e);
  }

  #callout(text) {
    const el = this.calloutEl;
    if (el.textContent !== text) el.textContent = text;
    el.animate(CALLOUT_POP, { duration: 900, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  // amount 0..1 sets how long the player stays blind; the screen always starts fully white.
  #onFlashed(amount) {
    const hold = FLASH_HOLD * amount, fade = FLASH_FADE * Math.max(0.3, amount);
    this.flashFadeLen = fade;
    this.flashT = Math.max(this.flashT, hold + fade);
  }

  #damageFrom(e) {
    const view = this.view, me = view && this.#findLocal(view);
    let sx = e.x, sz = e.z;
    const attacker = view?.players.find(p => p.id === e.by);
    if (attacker) { sx = attacker.x; sz = attacker.z; }
    if (!me) return;
    const angle = Math.atan2(sz - me.z, sx - me.x) * 180 / Math.PI + 90;
    let slot = this.dmg[0];
    for (const d of this.dmg) if (d.life < slot.life) slot = d;
    slot.life = DMG_LIFE;
    slot.el.style.transform = `translate3d(-50%,-50%,0) rotate(${angle}deg)`;
    slot.el.style.opacity = '1';
  }

  #onKill(e) {
    const view = this.view;
    if (!view) return;
    const byP = view.players.find(p => p.id === e.by);
    const tgtP = view.players.find(p => p.id === e.target);
    const byName = byP?.name ?? '?';
    const tgtName = tgtP?.name ?? '?';
    const byCss = TEAMS[byP?.team ?? 0].css, tgtCss = TEAMS[tgtP?.team ?? 1].css;
    const mine = e.by === view.localId || e.target === view.localId;
    this.#pushFeed(`<em style="color:${byCss}">${esc(byName)}</em><span class="f-w">${esc(killCause(e))}</span><em style="color:${tgtCss}">${esc(tgtName)}</em>`, mine);

    if (e.target === view.localId) {
      this.killer = { name: byName, color: byCss, weapon: killCause(e) };
      this.deathPainted = false;
    }
    if (e.by === view.localId && e.target !== view.localId && !e.streak && !e.equip && WEAPONS[e.weapon]) {
      this.weaponKills[e.weapon] = (this.weaponKills[e.weapon] ?? 0) + 1;
      for (const camo of Progress.recordKill(e.weapon)) {
        this.unlocks.push({ weapon: e.weapon, camoId: camo.id });
        this.notify(`${weaponName(e.weapon)} camo unlocked: ${getCamo(camo.id).name}`);
      }
    }
  }

  #onStreak(e) {
    const view = this.view;
    if (!view) return;
    const p = view.players.find(q => q.id === e.id);
    const me = this.#findLocal(view);
    if (!p || !me) return;
    const friendly = p.team === me.team;
    const verb = { uav: 'UAV online', strike: 'Strike inbound', turret: 'Turret deployed', gunship: 'Gunship overhead' }[e.kind] ?? `${e.kind} called in`;
    this.notify(`${friendly ? '' : 'Enemy '}${verb}`);
  }

  #pushFeed(html, mine = false) {
    const row = document.createElement('div');
    row.className = mine ? 'f-row mine' : 'f-row';
    row.innerHTML = html;
    this.feedEl.prepend(row);
    this.feed.unshift({ row, life: FEED_LIFE });
    while (this.feed.length > FEED_ROWS) this.feed.pop().row.remove();
  }

  #tickFeed(dt) {
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const item = this.feed[i];
      item.life -= dt;
      if (item.life <= 0) {
        item.row.remove();
        this.feed.splice(i, 1);
      } else if (item.life < 0.5 && !item.fading) {
        item.fading = true;
        item.row.classList.add('out');
      }
    }
  }

  #tickMedals(dt) {
    this.medalClock -= dt;
    if (this.medalClock > 0 || !this.medalQueue.length) return;
    this.medalClock = MEDAL_GAP;
    this.#stamp(this.medalQueue.shift());
  }

  // id is a medal id, or a ready-made { title, sub, big } card such as a streak coming online.
  #stamp(id) {
    const card = typeof id === 'object' ? id : null;
    const [title, sub] = card ? [card.title, card.sub] : MEDALS[id] ?? [String(id).replace(/_/g, ' '), ''];
    const node = document.createElement('div');
    node.className = `medal${card?.big || id === 'first_blood' || id === 'streak5' || id === 'streak10' ? ' big' : ''}`;
    node.innerHTML = `<b>${esc(title)}</b><small>${esc(sub)}</small>`;
    node.style.setProperty('--tilt', `${(Math.random() * 7 - 3.5).toFixed(1)}deg`);
    node.style.animationDuration = `${MEDAL_LIFE}s`;
    node.addEventListener('animationend', () => node.remove(), { once: true });
    while (this.medalsEl.childElementCount >= 3) this.medalsEl.firstElementChild.remove();
    this.medalsEl.appendChild(node);
  }

  #showEndBanner(winner, myTeam) {
    if (this.endShown) return;
    this.endShown = true;
    this.endAt = performance.now();
    this.deathEl.classList.remove('show');
    const won = winner === myTeam, drawn = winner === null || winner === undefined;
    this.endEl.dataset.result = drawn ? 'draw' : won ? 'win' : 'loss';
    this.endEl.querySelector('b').textContent = drawn ? 'Stalemate' : won ? 'Victory' : 'Defeat';
    this.endEl.querySelector('small').textContent = drawn ? 'Neither side broke through' : won ? 'The yard is yours' : 'The yard is lost';
    this.endEl.classList.add('show');
  }

  // --- Minimap ---
  // Walls never move, so they are drawn once into an off-screen layer.
  #drawMapBase() {
    const map = this.map;
    const W = this.mmCanvas.width, H = this.mmCanvas.height;
    const base = this.mmBase ??= document.createElement('canvas');
    base.width = W;
    base.height = H;
    const g = base.getContext('2d');
    this.mmX = W / map.width;
    this.mmZ = H / map.height;
    g.fillStyle = '#2b3540';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#39444f';
    for (const w of map.walls) {
      if (w.kind === 'border') continue;
      g.fillStyle = w.blocksVision ? '#8896a3' : '#566370';
      g.fillRect(w.x * this.mmX, w.z * this.mmZ, Math.max(w.w * this.mmX, 2), Math.max(w.d * this.mmZ, 2));
    }
  }

  #drawMinimap(view, me) {
    const g = this.mm;
    const sx = this.mmX, sz = this.mmZ;
    g.drawImage(this.mmBase, 0, 0);
    const myTeam = me.team;
    const myUav = view.uav[myTeam] > 0;
    const enemyUav = view.uav[1 - myTeam] > 0;
    if (enemyUav !== this.cache.enemyUav) {
      this.cache.enemyUav = enemyUav;
      this.mmTag.hidden = !enemyUav;
    }

    // UAV: a sweep ring expanding from the local player. Drawn before the markers so they stay crisp.
    const clock = performance.now() / 1000;
    let pulse = 0;
    if (myUav) {
      pulse = (clock * 0.7) % 1;
      g.strokeStyle = `rgba(255,214,120,${(1 - pulse) * 0.85})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(me.x * sx, me.z * sz, pulse * this.mmCanvas.width * 0.7, 0, Math.PI * 2);
      g.stroke();
    }

    if (view.smokes?.length) {
      g.fillStyle = 'rgba(201,205,214,.55)';
      for (const s of view.smokes) {
        g.beginPath();
        g.arc(s.x * sx, s.z * sz, s.r * sx, 0, Math.PI * 2);
        g.fill();
      }
    }

    for (const p of view.players) {
      if (!p.alive || p.id === me.id) continue;
      const friendly = p.team === myTeam;
      const seen = friendly || (myUav && !p.ghost) || (me.alive && hasLineOfSight(this.map, me.x, me.z, p.x, p.z, view.smokes));
      const firing = !seen && (p.firingT ?? 0) > 0;
      if (!seen && !firing) continue;
      const x = p.x * sx, y = p.z * sz;
      if (firing) {
        // Gunfire ping: a hollow marker that fades as the reveal runs out, plainly weaker than a sighting.
        const k = Math.min(1, p.firingT / FIRE_REVEAL);
        g.strokeStyle = TEAMS[p.team].css;
        g.globalAlpha = 0.35 + 0.65 * k;
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(x, y, 4 + (1 - k) * 8, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      } else if (friendly) {
        g.fillStyle = TEAMS[p.team].css;
        g.fillRect(x - 3.5, y - 3.5, 7, 7);
      } else {
        const r = myUav ? 5.5 + Math.sin(clock * 8 + x) * 1.3 : 5;
        g.fillStyle = TEAMS[p.team].css;
        g.beginPath();
        g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
        g.closePath();
        g.fill();
      }
    }

    this.#drawDeployables(view, myTeam, sx, sz, g);

    if (me.alive) {
      const x = me.x * sx, y = me.z * sz, a = me.aim;
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
      g.lineTo(x + Math.cos(a + 2.5) * 7, y + Math.sin(a + 2.5) * 7);
      g.lineTo(x + Math.cos(a - 2.5) * 7, y + Math.sin(a - 2.5) * 7);
      g.closePath();
      g.fill();
    }
  }

  #drawDeployables(view, myTeam, sx, sz, g) {
    if (view.turrets) {
      for (const t of view.turrets) {
        const x = t.x * sx, y = t.z * sz;
        g.fillStyle = TEAMS[t.team].css;
        g.fillRect(x - 5, y - 5, 10, 10);
        g.strokeStyle = t.team === myTeam ? '#fff' : '#171c22';
        g.lineWidth = 2;
        g.strokeRect(x - 5, y - 5, 10, 10);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(t.aim) * 11, y + Math.sin(t.aim) * 11);
        g.stroke();
      }
    }
    if (view.gunships) {
      for (const s of view.gunships) {
        const x = s.x * sx, y = s.z * sz, ca = Math.cos(s.aim), sa = Math.sin(s.aim);
        const px = -sa, py = ca;       // Wing direction.
        g.fillStyle = TEAMS[s.team].css;
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x + ca * 12, y + sa * 12);
        g.lineTo(x + px * 11 - ca * 3, y + py * 11 - sa * 3);
        g.lineTo(x - ca * 7, y - sa * 7);
        g.lineTo(x - px * 11 - ca * 3, y - py * 11 - sa * 3);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
