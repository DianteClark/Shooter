// In-match overlay. Built once; update() runs every frame and touches the DOM only when a displayed value
// actually changes, and then only with text, a transform or a class flip.
import { TEAMS, MAX_HP, SCORE_LIMIT, TIME_LIMIT } from '../shared/constants.js';
import { WEAPONS, effectiveWeapon } from '../shared/weapons.js';
import { MAPS, DEFAULT_MAP } from '../shared/map.js';
import { hasLineOfSight } from '../shared/geometry.js';
import { STREAKS, LETHALS, SCORE, normalizeLoadout } from '../shared/catalog.js';
import { MODES } from '../shared/modes.js';
import { Progress, matchScore } from './progress.js';
import { badgeMark } from './widgets.js';
import { LOADOUT_COUNT } from '../shared/progression.js';

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
const OBJ_RING = 2 * Math.PI * 14;  // Circumference of the capture rings' r=14 circle, for stroke dashes.
// Objective markers ride inside these margins, so they never sit under the score bar, the buttons or the status row.
const MARK_PAD_L = 34;
const MARK_PAD_R = 110;
const MARK_PAD_T = 56;
const MARK_PAD_B = 100;
const MARK_Y = { dom: 4.3, hard: 3.6 };   // Metres above the ground to pin a marker: flag tip or zone wall.
const HARD_WARN = 5;             // Seconds of warning before a hardpoint moves.

const MEDALS = {
  confirm: ['Kill Confirmed', `+${SCORE.confirm}`], deny: ['Tag Denied', `+${SCORE.deny}`],
  capture: ['Captured', `+${SCORE.capture}`], defend: ['Defended', `+${SCORE.defend}`],
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

const BANNER_POP = [
  { opacity: 0, transform: 'translateX(-50%) scale(1.5)' },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.1 },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.82 },
  { opacity: 0, transform: 'translate(-50%,-6px) scale(1)' },
];

// A point's letter: its id when that is already a single letter, otherwise its place in the list.
const pointLabel = (pt, i) => (typeof pt.id === 'string' && pt.id.length === 1 ? pt.id.toUpperCase() : 'ABCDEFG'[i] ?? '?');
const ringMarkup = '<svg class="o-ring" viewBox="-17 -17 34 34" aria-hidden="true"><circle class="o-track" r="14"/><circle class="o-arc" r="14" transform="rotate(-90)"/></svg><b></b>';

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
    this.badges = new Map();      // Player id -> { prestige, level }, from the match roster.
    this.mode = 'tdm';
    this.camera = null;           // World markers project through this; handed over once per match.
    this.viewW = root.clientWidth || innerWidth;
    this.viewH = root.clientHeight || innerHeight;
    addEventListener('resize', () => { this.viewW = root.clientWidth; this.viewH = root.clientHeight; });
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
  prepare({ mapId = DEFAULT_MAP, scoreLimit = SCORE_LIMIT, timeLimit = TIME_LIMIT, roster = [], mode = 'tdm' } = {}) {
    this.map = MAPS[mapId] ?? this.map;
    this.scoreLimit = scoreLimit;
    this.timeLimit = timeLimit;
    this.mode = mode;
    this.badges = new Map(roster.map(r => [r.id, r.badge ?? null]));
    this.#seedFallback();
    this.#drawMapBase();
    this.#buildObjectiveHud();
    this.reset();
  }

  // The match renderer's camera. Markers need a world-to-screen transform and nothing else from it.
  setCamera(camera) { this.camera = camera; }

  reset() {
    // Cached display values. NaN and '' can never equal a real value, so the first update writes everything.
    this.cache = {
      myScore: NaN, otherScore: NaN, teamFlip: NaN, time: NaN, phase: '', hp: NaN, hpFrac: NaN, ammo: NaN, reserve: NaN,
      weapon: '', reloadFrac: NaN, reloadOn: null, low: null, hurt: null, vign: NaN, dead: null, respawn: NaN,
      protect: null, picked: -1, enemyUav: null, tag: '', heatOn: null, heat: NaN, heatLevel: '', overBanner: null,
      score: NaN, capped: null, swapHint: null, objState: null, objFrac: NaN, hardShown: NaN,
    };
    this.view = null;
    this.modeBannerShown = false;
    this.hardWarned = false;
    this.objTally = new Map();
    this.hardMoves = 0;
    this.mmClock = 0;
    this.hitT = 0;
    this.hitKill = false;
    this.hitHead = false;
    this.hitLife = HIT_LIFE;
    this.flashT = 0;
    this.flashLen = 1;
    this.boardOpen = false;
    this.boardClock = 0;
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
    this.#paintPicker(true);
  }

  setVisible(on) {
    this.el.classList.toggle('on', on);
  }

  // cb(loadout), the full match loadout, whenever the player picks another one on the death screen.
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
      <div class="obj-marks"></div>
      <div class="obj-strip" hidden>
        <div class="obj-chips"></div>
        <div class="obj-timer" hidden><small>Moves in</small><b>0:30</b></div>
      </div>
      <div class="obj-meter" hidden><i class="obj-meter-fill"></i><b></b></div>
      <div class="obj-banner"><b></b><small></small></div>
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
          ${Array.from({ length: LOADOUT_COUNT }, (_, i) => `
          <button class="pick" data-tap="1" data-i="${i}"><b></b><small></small></button>`).join('')}
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
    this.objMarks = $('.obj-marks');
    this.objStrip = $('.obj-strip');
    this.objChips = $('.obj-chips');
    this.objTimer = $('.obj-timer');
    this.objTimerNum = $('.obj-timer b');
    this.objMeter = $('.obj-meter');
    this.objMeterFill = $('.obj-meter-fill');
    this.objMeterText = $('.obj-meter b');
    this.objBanner = $('.obj-banner');
    this.objNodes = [];           // One entry per objective point: chip and in-world marker.
    this.flashEl = $('.flashbang');
    this.healEl = $('.heal-veil');
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
    for (const pick of this.picks) pick.addEventListener('click', () => this.#choose(Number(pick.dataset.i)));
    $('.scorebar').addEventListener('click', () => this.toggleBoard());
    this.#buildBoard();
  }

  // Twelve rows made once and only ever retexted, so an open board costs a few text writes a second.
  #buildBoard() {
    this.boardGrid.innerHTML = [0, 1].map(() => `
      <div class="lb-side">
        <div class="lb-head"><b class="lb-team"></b><span>K</span><span>D</span><span>A</span><span class="lb-mode">HS</span><span>Score</span></div>
        ${[0, 1, 2, 3, 4, 5].map(() => '<div class="lb-row"><span class="lb-name"><i class="lb-bdg"></i><u class="lb-lv"></u><b></b></span><span></span><span></span><span></span><span></span><span></span></div>').join('')}
      </div>`).join('');
    this.boardSides = [...this.boardGrid.querySelectorAll('.lb-side')].map(node => ({
      team: node.querySelector('.lb-team'),
      modeHead: node.querySelector('.lb-mode'),
      rows: [...node.querySelectorAll('.lb-row')].map(row => ({
        row, cells: row.children, name: row.querySelector('.lb-name b'), bdg: row.querySelector('.lb-bdg'), lv: row.querySelector('.lb-lv'), rank: -1,
      })),
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
      const rows = view.players.filter(p => p.team === team);
      for (const p of rows) Object.assign(p, this.objectiveStats(p.id));
      rows.sort((a, b) => matchScore(b) - matchScore(a) || a.deaths - b.deaths);
      side.rows.forEach((slot, i) => {
        const p = rows[i], { row, cells } = slot;
        row.hidden = !p;
        if (!p) return;
        row.classList.toggle('me', p.id === me.id);
        slot.name.textContent = p.name;
        const badge = this.badges.get(p.id);
        const rank = badge?.prestige ?? -1;
        if (rank !== slot.rank) {
          slot.rank = rank;
          slot.bdg.innerHTML = badge ? badgeMark(rank, 15) : '';
        }
        slot.lv.textContent = badge?.level ?? '';
        cells[1].textContent = p.kills;
        cells[2].textContent = p.deaths;
        cells[3].textContent = p.assists ?? 0;
        cells[4].textContent = this.#objectiveStat(p);
        cells[5].textContent = matchScore(p);
      });
    });
  }

  // Fourth score column: the mode's own number where it has one, headshots otherwise.
  #objectiveStat(p) {
    if (this.mode === 'kc') return p.confirms ?? 0;
    if (this.mode === 'dom' || this.mode === 'hard') return p.captures ?? 0;
    return p.head ?? 0;
  }

  #choose(index) {
    Progress.activeLoadout = index;
    this.#paintPicker();
    this.loadoutCb?.(Progress.loadout());
  }

  #paintPicker(relabel = false) {
    if (relabel) {
      const all = Progress.loadouts();
      this.picks.forEach((pick, i) => {
        pick.querySelector('b').textContent = all[i].name;
        pick.querySelector('small').textContent = weaponName(all[i].primary);
      });
    }
    const active = Progress.activeLoadout;
    if (this.cache.picked === active) return;
    this.cache.picked = active;
    this.picks.forEach((pick, i) => pick.classList.toggle('on', i === active));
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
      }
    }

    if (view.phase === 'warmup' && !this.modeBannerShown && view.mode === this.mode) {
      this.modeBannerShown = true;
      this.#banner(MODES[this.mode]?.name ?? '', MODES[this.mode]?.desc ?? '', 3200);
    }
    this.#updateObjectives(view, me, c);

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
    if (me.weapon !== c.weapon || me.attachments !== c.kit) {
      c.weapon = me.weapon;
      c.kit = me.attachments;
      this.armsName.textContent = weaponName(me.weapon);
      c.magazine = effectiveWeapon(me.weapon, me.attachments)?.magazine ?? 30;
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
        case 'medal': this.#onMedal(e); break;
        case 'spawn': if (e.id === this.view?.localId) { this.killer = null; this.deathPainted = false; } break;
        case 'streak': this.#onStreak(e); break;
        case 'flashed': if (e.id === this.view?.localId) this.#onFlashed(e.amount ?? 1); break;
        case 'heal': if (e.id === this.view?.localId) this.healEl.animate(HEAL_PULSE, { duration: 520 }); break;
        case 'capture': this.#onCapture(e); break;
        case 'hard_move': this.#onHardMove(e); break;
        default: break;
      }
    }
  }

  // Every player's medals arrive, and the objective ones double as the per-player capture and confirm counts.
  #onMedal(e) {
    if (e.medal === 'confirm' || e.medal === 'capture') {
      const key = e.medal === 'confirm' ? 'confirms' : 'captures';
      const t = this.objTally.get(e.id) ?? { confirms: 0, captures: 0 };
      t[key]++;
      this.objTally.set(e.id, t);
    }
    if (e.id === this.view?.localId) this.medalQueue.push(e.medal);
  }

  // Captures and confirmations per player, tallied from medals, for the live board and the results screen.
  objectiveStats(id) {
    return this.objTally.get(id) ?? { confirms: 0, captures: 0 };
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

  #onCapture(e) {
    const view = this.view, me = view && this.#findLocal(view);
    if (!me) return;
    const pts = view.points ?? [];
    const idx = pts.findIndex(p => p.id === e.point);
    const label = idx >= 0 ? pointLabel(pts[idx], idx) : String(e.point ?? '').toUpperCase();
    const ours = e.team === me.team;
    if (this.mode === 'hard') return;
    this.#banner(ours ? `${label} Captured` : `${label} Lost`, ours ? 'Hold it for points' : 'Take it back', 1500, ours ? 'mine' : 'enemy');
    this.notify(`${ours ? '' : 'Enemy '}${TEAMS[e.team]?.name ?? 'Team'} took ${label}`);
  }

  // The sim also emits this when the match goes live; that first zone is not a move worth announcing.
  #onHardMove() {
    if (this.hardMoves++ === 0) return;
    this.#banner('Hardpoint Moved', 'Find the new zone', 1500);
    this.hardWarned = false;
  }

  // Large centred announcement for mode events. `side` tints it for the local team, the enemy or neither.
  #banner(title, sub, duration = 1400, side = '') {
    const el = this.objBanner;
    el.querySelector('b').textContent = title;
    el.querySelector('small').textContent = sub;
    el.dataset.side = side;
    el.animate(BANNER_POP, { duration, easing: 'ease-out' });
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
    this.#pushFeed(`${this.#feedBadge(e.by)}<em style="color:${byCss}">${esc(byName)}</em><span class="f-w">${esc(killCause(e))}</span>${this.#feedBadge(e.target)}<em style="color:${tgtCss}">${esc(tgtName)}</em>`, mine);

    if (e.target === view.localId) {
      this.killer = { name: byName, color: byCss, weapon: killCause(e) };
      this.deathPainted = false;
    }
  }

  #feedBadge(id) {
    const badge = this.badges.get(id);
    return badge ? `<i class="f-bdg">${badgeMark(badge.prestige ?? 0, 13)}</i>` : '';
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
    // The canvas follows the map's shape, so a square map is not squashed. It only changes between matches.
    const shape = Math.round(MM_WIDTH * MM_SCALE * (map.height / map.width));
    if (this.mmCanvas.height !== shape) {
      this.mmCanvas.height = shape;
      this.mmCanvas.style.height = this.mmCanvas.parentNode.style.height = `${(shape / MM_SCALE).toFixed(1)}px`;
    }
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

    this.#drawObjectivesMini(view, me, sx, sz, g, clock);

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

  #drawObjectivesMini(view, me, sx, sz, g, clock) {
    if (view.tags?.length) {
      for (const t of view.tags) {
        const friendly = t.team === me.team;
        const x = t.x * sx, y = t.z * sz, r = friendly ? 3 : 4;
        g.fillStyle = TEAMS[t.team]?.css ?? '#fff';
        g.strokeStyle = friendly ? 'rgba(255,255,255,.5)' : '#fff';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    const points = view.points;
    if (!points?.length) return;
    const myTeam = me.team, hard = this.mode === 'hard';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '400 13px "Railyard Stencil", sans-serif';
    points.forEach((pt, i) => {
      const x = pt.x * sx, y = pt.z * sz, r = Math.max(5, (pt.r ?? 4) * sx);
      const css = pt.owner === myTeam ? TEAMS[myTeam].css : pt.owner === 0 || pt.owner === 1 ? TEAMS[pt.owner].css : '#d5dade';
      g.fillStyle = 'rgba(29,35,43,.72)';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = pt.contested ? (Math.floor(clock * 6) % 2 ? '#ffd24a' : '#fff') : css;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
      const cap = Math.abs(pt.capture ?? 0);
      if (cap > 0.01) {
        g.strokeStyle = TEAMS[(pt.capture ?? 0) > 0 ? 1 : 0].css;
        g.lineWidth = 3.5;
        g.beginPath();
        g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + cap * Math.PI * 2);
        g.stroke();
      }
      if (hard) {
        // Pulse so the single live zone is findable at a glance.
        g.strokeStyle = 'rgba(255,255,255,.65)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, r + (clock * 1.4 % 1) * 8, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#fff';
      g.fillText(hard ? 'H' : pointLabel(pt, i), x, y + 0.5);
    });
  }

  // --- Mode objectives ---
  #buildObjectiveHud() {
    this.objChips.textContent = '';
    this.objMarks.textContent = '';
    this.objNodes = [];
    const mode = this.mode;
    const uses = mode === 'dom' || mode === 'hard';
    this.objStrip.hidden = !uses;
    this.objTimer.hidden = mode !== 'hard';
    this.el.dataset.mode = mode;
    this.objMeter.hidden = true;
    for (const side of this.boardSides) {
      side.modeHead.textContent = mode === 'kc' ? 'Conf' : uses ? 'Cap' : 'HS';
    }
    if (!uses) return;
    const count = mode === 'dom' ? (this.map.points?.dom?.length ?? 3) : 1;
    for (let i = 0; i < count; i++) {
      const chip = document.createElement('span');
      chip.className = 'o-chip';
      chip.innerHTML = ringMarkup;
      this.objChips.appendChild(chip);
      const mark = document.createElement('span');
      mark.className = 'o-mark';
      mark.innerHTML = `${ringMarkup}<i class="o-arrow"></i>`;
      this.objMarks.appendChild(mark);
      this.objNodes.push({
        chip: this.#pointNode(chip),
        mark: { ...this.#pointNode(mark), arrow: mark.querySelector('.o-arrow'), x: NaN, y: NaN, a: NaN, off: null, shown: null },
      });
    }
  }

  #pointNode(root) {
    return { root, arc: root.querySelector('.o-arc'), label: root.querySelector('b'), owner: '', cap: '', dash: NaN, contested: null, text: null };
  }

  #updateObjectives(view, me, c) {
    const points = view.points;
    if (this.objNodes.length && points) {
      this.#updateMarks(view, me, points);
      const n = Math.min(points.length, this.objNodes.length);
      for (let i = 0; i < n; i++) this.#paintPoint(this.objNodes[i].chip, points[i], i, me.team);
    }
    this.#updateMeter(view, me, c, points);
    this.#updateHardTimer(view, c);
  }

  // Touches only the attributes that changed, since this runs for every chip and marker every frame.
  #paintPoint(n, pt, i, myTeam) {
    const owner = pt.owner === 0 || pt.owner === 1 ? (pt.owner === myTeam ? 'mine' : 'enemy') : 'none';
    if (owner !== n.owner) { n.owner = owner; n.root.dataset.owner = owner; }
    const capVal = pt.capture ?? 0;
    const capSide = capVal === 0 ? '' : ((capVal > 0 ? 1 : 0) === myTeam ? 'mine' : 'enemy');
    if (capSide !== n.cap) { n.cap = capSide; n.root.dataset.cap = capSide; }
    const dash = Math.round((1 - Math.min(1, Math.abs(capVal))) * 40) / 40;
    if (dash !== n.dash) { n.dash = dash; n.arc.style.strokeDashoffset = (dash * OBJ_RING).toFixed(2); }
    const contested = !!pt.contested;
    if (contested !== n.contested) { n.contested = contested; n.root.classList.toggle('contested', contested); }
    const text = this.mode === 'hard' ? '' : pointLabel(pt, i);
    if (text !== n.text) { n.text = text; n.label.textContent = text; }
  }

  // World-to-screen for the pinned objective markers; off-screen ones ride the edge and point at their target.
  #updateMarks(view, me, points) {
    const cam = this.camera;
    if (!cam) return;
    const W = this.viewW, H = this.viewH;
    const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
    const y = MARK_Y[this.mode] ?? 3;
    const n = Math.min(points.length, this.objNodes.length);
    for (let i = 0; i < n; i++) {
      const pt = points[i], m = this.objNodes[i].mark;
      this.#paintPoint(m, pt, i, me.team);
      // Standing on it, the ring around your feet says everything a marker would.
      const near = me.alive && Math.hypot(pt.x - me.x, pt.z - me.z) <= (pt.r ?? 4);
      if (near !== m.shown) { m.shown = near; m.root.style.opacity = near ? '0' : '1'; }
      if (near) continue;
      const vx = v[0] * pt.x + v[4] * y + v[8] * pt.z + v[12], vy = v[1] * pt.x + v[5] * y + v[9] * pt.z + v[13], vz = v[2] * pt.x + v[6] * y + v[10] * pt.z + v[14];
      const w = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
      if (w <= 0.01) continue;
      const nx = (p[0] * vx + p[8] * vz + p[12]) / w, ny = (p[5] * vy + p[9] * vz + p[13]) / w;
      let sx = (nx * 0.5 + 0.5) * W, sy = (0.5 - ny * 0.5) * H;
      const dx = sx - W / 2, dy = sy - H / 2;
      const off = sx < MARK_PAD_L || sx > W - MARK_PAD_R || sy < MARK_PAD_T || sy > H - MARK_PAD_B;
      let edge = 1;
      if (off) {
        const kx = dx > 0 ? (W - MARK_PAD_R - W / 2) / dx : dx < 0 ? (MARK_PAD_L - W / 2) / dx : Infinity;
        const ky = dy > 0 ? (H - MARK_PAD_B - H / 2) / dy : dy < 0 ? (MARK_PAD_T - H / 2) / dy : Infinity;
        edge = Math.min(kx, ky);
      }
      const px = Math.round(W / 2 + dx * edge), py = Math.round(H / 2 + dy * edge);
      if (px !== m.x || py !== m.y) {
        m.x = px; m.y = py;
        m.root.style.transform = `translate3d(${px}px,${py}px,0)`;
      }
      if (off !== m.off) { m.off = off; m.root.classList.toggle('off', off); }
      if (off) {
        const a = Math.round(Math.atan2(dy, dx) * 12) / 12;
        if (a !== m.a) { m.a = a; m.arrow.style.transform = `rotate(${a}rad) translateX(23px)`; }
      }
    }
  }

  // The bar under the chips: what is happening on the point the local player is standing on.
  #updateMeter(view, me, c, points) {
    let state = '', frac = 0, side = '';
    if (points && me.alive) {
      const hard = this.mode === 'hard';
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (Math.hypot(pt.x - me.x, pt.z - me.z) > (pt.r ?? 4)) continue;
        const label = hard ? 'Zone' : pointLabel(pt, i);
        const capVal = pt.capture ?? 0;
        const mine = (capVal > 0 ? 1 : 0) === me.team;
        if (pt.contested) { state = hard ? 'Contested' : `${label} Contested`; side = 'contest'; frac = Math.abs(capVal) || 1; }
        else if (hard) { state = pt.owner === me.team ? 'Holding Zone' : 'Taking Zone'; side = 'mine'; frac = Math.abs(capVal) || (pt.owner === me.team ? 1 : 0); }
        else if (Math.abs(capVal) > 0.005) { state = mine ? `Capturing ${label}` : `Losing ${label}`; side = mine ? 'mine' : 'enemy'; frac = Math.abs(capVal); }
        else if (pt.owner !== me.team) { state = `Capturing ${label}`; side = 'mine'; frac = 0; }
        break;
      }
    }
    if (state !== c.objState) {
      c.objState = state;
      this.objMeter.hidden = !state;
      this.objMeterText.textContent = state;
      this.objMeter.dataset.side = side;
    }
    const shown = Math.round(frac * 40) / 40;
    if (shown !== c.objFrac) {
      c.objFrac = shown;
      this.objMeterFill.style.transform = `scaleX(${shown})`;
    }
  }

  #updateHardTimer(view, c) {
    if (this.mode !== 'hard') return;
    const shown = Math.max(0, Math.ceil(view.hardT ?? 0));
    if (shown !== c.hardShown) {
      c.hardShown = shown;
      this.objTimerNum.textContent = `${Math.floor(shown / 60)}:${pad2(shown % 60)}`;
      const warn = shown <= HARD_WARN;
      this.objTimer.classList.toggle('warn', warn);
      if (warn && shown > 0 && !this.hardWarned && view.phase === 'live') {
        this.hardWarned = true;
        this.#banner('Hardpoint Moving', `${shown} seconds`, 1400);
      }
      if (!warn) this.hardWarned = false;
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
