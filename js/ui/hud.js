// In-match overlay. Built once; update() runs every frame and touches the DOM only when a displayed value
// actually changes, and then only with text, a transform or a class flip.
import { TEAMS, MAX_HP, SCORE_LIMIT, TIME_LIMIT } from '../shared/constants.js';
import { WEAPONS, effectiveWeapon } from '../shared/weapons.js';
import { MAPS, DEFAULT_MAP } from '../shared/map.js';
import { hasLineOfSight } from '../shared/geometry.js';
import { STREAKS, STREAK_DENY_TEXT, LETHALS, SCORE, PRO, normalizeLoadout } from '../shared/catalog.js';
import { GUN_LADDER, isFfa, MODES, modeRules } from '../shared/modes.js';
import { Progress, matchScore } from './progress.js';
import { badgeMark } from './widgets.js';
import { LOADOUT_COUNT } from '../shared/progression.js';
import { safeInsets } from './viewport.js';
import { icon, resolveIcon } from './icons.js';
import { cardHtml, identityOf, setRosterIdentity, vetOf, vetTag } from './cards.js';
import { Footprints, heardEnemies, HEAR_RANGE } from '../sim/player.js';
import { effectRadius } from '../sim/equipment.js';

// One icon from the shared set at a given height (weapons come out 2.5x as wide), or '' when the set has no drawing
// for that id, so callers can fall back to words.
export function glyph(id, size = 20, cls = 'gl') {
  if (id == null || resolveIcon(id) === 'unknown') return '';
  return icon(id, { size, cls });
}

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
const OBJ_RING = 2 * Math.PI * 14;
const DEATH_RING = 2 * Math.PI * 26;  // Circumference of the capture rings' r=14 circle, for stroke dashes.
// Objective markers ride inside the safe area plus these margins, and walk inward off anything in markObstacles.
const MARK_PAD_X = 34;
const MARK_PAD_T = 56;
const MARK_PAD_B = 100;
const MARK_CLEAR = 30;           // A marker's radius plus its arrow: how far a marker keeps from what it must not cover.
const MARK_WALK = 0.05;          // Fraction of the way in per step when walking a marker clear.
const MARK_Y = { dom: 4.3, hard: 3.6 };   // Metres above the ground to pin a marker: flag tip or zone wall.
const HARD_WARN = 5;             // Seconds of warning before a hardpoint moves.
const DPS_WINDOW = 2.4;
const INCOMING_WARN_M = 9;       // An enemy shell landing this close gets a callout.
const INCOMING_GAP_MS = 1500;    // A five-shell barrage is one warning, not five.
const STATIC_FRAMES = 3;         // Pre-drawn noise frames the jammed minimap cycles through.
// Feed wording per streak, after its name: "Enemy Airstrike inbound".
const STREAK_VERB = {
  uav: 'online', jammer: 'jamming radar', resupply: 'dropped', turret: 'deployed', mortar: 'firing',
  strike: 'inbound', overwatch: 'online', chopper: 'overhead', emp: 'detonated', gunship: 'overhead',
};
// Enemy streaks the local player should react to right now.
const STREAK_WARN = { jammer: 'Radar jammed', strike: 'Airstrike inbound', mortar: 'Mortars incoming', overwatch: 'Enemy Overwatch: Ghost is off', chopper: 'Enemy chopper', gunship: 'Enemy gunship', emp: 'EMP!' };          // Seconds of hits averaged into the live damage readout.
const RANGE_HZ = 6;              // The readout repaints this often; it would be unreadable any faster.
// Pro senses drawn by the HUD (js/shared/catalog.js PRO): footprints, the Fastball blast ring, enemy equipment.
const PRINT_HZ = 12;             // Footprint line-of-sight checks per second; drawing still follows the camera every frame.
const SEEN_GEAR = new Set(['mine', 'trophy', 'sensor', 'decoy', 'sticky']);   // What Hijacker sees through walls.
const NO_PRO = Object.freeze([]);
const FFA_FOE = '#ff6a4d';        // Free-for-all: "an enemy" when it is not one particular player (footprints, edge tints).
const ORDINAL = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
// Free-for-all standings: score, then fewer deaths, then more kills (the sim's own order for the winner).
const ffaRank = (view, list = view.players) => list.filter(p => !p.dummy).sort((a, b) =>
  ((view.scores[b.team] ?? 0) - (view.scores[a.team] ?? 0)) || (a.deaths - b.deaths) || (b.kills - a.kills));
const PRO_LINE = { scavenger: '+1 equipment', bandolier: 'Equipment restocked', adrenaline: '25% less damage', engineer: 'The Sentry is yours' };
const TIPS = [
  'Slide through a doorway to shrink as a target.',
  'Firing reveals you on the enemy minimap. Suppressors hide it.',
  'Hold a grenade button and drag to place the throw.',
  'A capped score resets when you call a streak, so call them.',
  'Swap instead of reloading when someone is on you.',
];

// [title, line under it, tier]. Tier sets the plate: 1 steel, 2 sodium, 3 sodium with hazard stripes.
const MEDALS = {
  confirm: ['Kill Confirmed', `+${SCORE.confirm}`, 1], deny: ['Tag Denied', `+${SCORE.deny}`, 1],
  capture: ['Captured', `+${SCORE.capture}`, 1], defend: ['Defended', `+${SCORE.defend}`, 1],
  headshot: ['Headshot', `+${SCORE.headshot}`, 1],
  first_blood: ['First Blood', 'Round opener', 2], double: ['Double Kill', '2 in quick order', 2], triple: ['Triple Kill', '3 in quick order', 2],
  fury: ['Fury Kill', '4 or more', 3], revenge: ['Revenge', 'Settled the score', 1], longshot: ['Longshot', 'From across the yard', 1],
  streak3: ['Three Streak', 'On a run', 2], streak5: ['Five Streak', 'Unstoppable', 3], streak10: ['Ten Streak', 'Unbroken', 3],
};
const SCORE_POP_LIFE = 1.4;      // Seconds the "+100" under the crosshair holds before it fades; kills inside it add up.
const INTRO_GO_MS = 900;

const CALLOUT_POP = [
  { opacity: 0, transform: 'translateX(-50%) scale(1.8)' },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.14 },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.7 },
  { opacity: 0, transform: 'translate(-50%,-8px) scale(1)' },
];
const HEAL_PULSE = [{ opacity: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0 }];
const SCORE_POP = [{ transform: 'scale(1.5)', color: '#fff' }, { transform: 'scale(1)' }];
const COUNT_POP = [{ transform: 'scale(1.35)', opacity: 0.5 }, { transform: 'scale(1)', opacity: 1 }];
const GO_FLASH = [
  { opacity: 0, transform: 'translate(-50%,-50%) scale(2.2)' },
  { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.18 },
  { opacity: 1, transform: 'translate(-50%,-50%) scale(1.04)', offset: 0.6 },
  { opacity: 0, transform: 'translate(-50%,-50%) scale(1.25)' },
];
const HP_KNOCK = [{ transform: 'translateX(-3px)' }, { transform: 'translateX(2px)', offset: 0.4 }, { transform: 'none' }];
const ARMS_SWAP = [{ opacity: 0.2, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];
const SCORE_POP_IN = [
  { opacity: 0, transform: 'translateY(6px) scale(.6)' },
  { opacity: 1, transform: 'translateY(0) scale(1.18)', offset: 0.06 },
  { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.14 },
  { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.8 },
  { opacity: 0, transform: 'translateY(-10px) scale(1)' },
];
const SCORE_POP_BUMP = [
  { opacity: 1, transform: 'scale(1.35)' },
  { opacity: 1, transform: 'scale(1)', offset: 0.1 },
  { opacity: 1, transform: 'scale(1)', offset: 0.8 },
  { opacity: 0, transform: 'translateY(-10px) scale(1)' },
];
const HIT_PUNCH = [{ rotate: '14deg' }, { rotate: '0deg' }];
const RESPAWN_FLASH = [{ opacity: 0.75 }, { opacity: 0 }];
const STREAK_HIT = [
  { opacity: 0, transform: 'translate(-50%,0) scale(1.9)', filter: 'brightness(2.4)' },
  { opacity: 1, transform: 'translate(-50%,0) scale(.97)', filter: 'brightness(1)', offset: 0.13 },
  { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: 0.8 },
  { opacity: 0, transform: 'translate(-50%,-14px) scale(1)' },
];

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
  #range;

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
    this.markObstacles = [];
    addEventListener('resize', () => this.remeasure());
    this.#seedFallback();
    this.#build();
    this.#drawMapBase();
    this.reset();
  }

  // Rotation, toolbars, or a new match: layout-derived numbers are refreshed here and only ever read per frame.
  remeasure() {
    this.viewW = this.root.clientWidth;
    this.viewH = this.root.clientHeight;
    this.safe = safeInsets();
    this.markObstacles = [];
    const add = r => this.markObstacles.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    for (const r of Object.values(this.controls?.rects ?? {})) this.markObstacles.push(r);
    add(this.el.querySelector('.minimap').getBoundingClientRect());
    add(this.el.querySelector('.corner').getBoundingClientRect());
    // The Pro layer is drawn at CSS pixels: a few thin shapes do not need the phone's full pixel ratio.
    this.proCanvas.width = Math.max(1, Math.round(this.viewW));
    this.proCanvas.height = Math.max(1, Math.round(this.viewH));
    this.proDrawn = true;
  }

  #markBlocked(x, y) {
    for (const r of this.markObstacles) {
      if (x + MARK_CLEAR > r.x0 && x - MARK_CLEAR < r.x1 && y + MARK_CLEAR > r.y0 && y - MARK_CLEAR < r.y1) return true;
    }
    return false;
  }

  // Controls owns the buttons and streak tiles so there is a single touch surface; the HUD feeds them.
  bindControls(controls) {
    this.controls = controls;
    this.#seedFallback();
  }

  // The scoreboard's Leave button; the session flow belongs to main.js.
  onLeaveMatch(cb) { this.leaveCb = cb; }

  setLefty(on) {
    this.el.classList.toggle('lefty', on);
  }

  // Tiles and buttons need something to draw before the first frame that carries real slots.
  #seedFallback() {
    const l = normalizeLoadout(Progress.loadout());
    this.fallbackSlots = l.streaks.map(kind => ({ kind, cost: STREAKS[kind].cost, held: false, blocked: false }));
    this.fallbackEquip = { tactical: l.tactical, lethal: l.lethal };
    this.#syncThrowReach();
  }

  // Reach is a property of the loadout the player is carrying, which can change on the death screen between lives.
  #syncThrowReach() {
    this.controls?.setThrowReach((Progress.loadout().perks ?? []).includes('strongarm'));
  }

  // Call before each match.
  prepare({ mapId = DEFAULT_MAP, scoreLimit = SCORE_LIMIT, timeLimit = TIME_LIMIT, roster = [], mode = 'tdm', localId = null, intro = true } = {}) {
    this.map = MAPS[mapId] ?? this.map;
    this.scoreLimit = scoreLimit;
    this.timeLimit = timeLimit;
    this.modeId = mode;                 // As picked, e.g. 'gwdom'.
    this.mode = modeRules(mode);        // The rule set it plays by, e.g. 'dom'.
    this.ffa = isFfa(mode);             // Every player for themselves: scorebar, board and banners rank players.
    this.gun = this.mode === 'gun';
    this.badges = new Map(roster.map(r => [r.id, r.badge ?? null]));
    setRosterIdentity(roster);
    this.prints.reset();
    this.#seedFallback();
    this.#drawMapBase();
    this.#buildObjectiveHud();
    this.sbGoal.textContent = this.gun ? `${scoreLimit} guns` : `to ${scoreLimit}`;
    this.boardMode.textContent = MODES[mode]?.name ?? '';
    this.boardGoal.textContent = `${this.map?.name ?? ''}, ${this.gun ? `${scoreLimit} guns to win` : `first to ${scoreLimit}`}`;
    this.el.classList.toggle('ffa-on', this.ffa);
    this.gunEl.hidden = !this.gun;
    this.#oneGunControls(this.gun);
    this.reset();
    this.#range.prepare(mode === 'range');
    this.el.classList.toggle('range-on', mode === 'range');
    this.#hideIntro();
    this.remeasured = false;
    this.pendingIntro = intro && mode !== 'range' ? { mapId, mode, roster, localId } : null;
  }

  // Gun Game: no scorestreaks and nothing to swap to, so their buttons go; the death screen has no loadouts to offer.
  #oneGunControls(on) {
    const c = this.controls;
    for (const t of c?.tiles ?? []) if (t?.node) t.node.style.display = on ? 'none' : '';
    if (c?.buttons?.swap) c.buttons.swap.style.display = on ? 'none' : '';
    if (c?.scoreBox) c.scoreBox.style.display = on ? 'none' : '';
    this.el.querySelector('.picker').style.display = on ? 'none' : '';
  }

  // The Gun Game strip under the scorebar: the gun in hand, how far up the ladder, and what the next kill brings.
  #updateGun(view, me, c) {
    if (!this.gun) return;
    const level = Math.max(0, Math.min(GUN_LADDER.length - 1, view.scores[me.team] ?? 0));
    if (level === c.gunLevel) return;
    const up = level > c.gunLevel;
    const first = Number.isNaN(c.gunLevel);
    c.gunLevel = level;
    const gun = GUN_LADDER[level], next = GUN_LADDER[level + 1];
    this.gunEl.querySelector('.gr-icon').innerHTML = glyph(gun, 18);
    this.gunEl.querySelector('.gr-n').textContent = `${level + 1}/${GUN_LADDER.length}`;
    this.gunEl.querySelector('.gr-name').textContent = weaponName(gun);
    this.gunEl.querySelector('.gr-next').innerHTML = next
      ? `<small>Next</small>${glyph(next, 12)}<span>${esc(weaponName(next))}</span>`
      : '<small class="gr-final">Final gun: one kill wins</small>';
    const pips = this.gunEl.querySelector('.gr-pips');
    pips.innerHTML = GUN_LADDER.map((_, i) => `<i style="flex:1;height:3px;background:${i < level ? 'var(--c-sodium)' : i === level ? '#fff' : 'rgba(231,234,228,.18)'}"></i>`).join('');
    if (!first) this.gunEl.animate(up ? SCORE_POP_IN : HP_KNOCK, { duration: up ? 520 : 300, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  // A Gun Game rung change for the local player: the gun is already in hand; this says why.
  #onArm(e) {
    if (e.id !== this.view?.localId || !this.gun) return;
    const name = weaponName(e.weapon);
    if (e.by) {
      const by = this.view.players.find(p => p.id === e.by);
      this.#banner('Set back', `${by?.name ?? 'Someone'} knocked you down to the ${name}`, 1600, 'enemy');
    } else if (e.level === GUN_LADDER.length - 1) {
      this.#banner('Final gun', `${name}: one kill wins it`, 1600, 'mine');
    } else {
      this.#callout(`${name}  ${e.level + 1}/${GUN_LADDER.length}`);
    }
  }

  // onSetLoadout's sibling for the firing range's Reset.
  onRangeReset(cb) { this.#range.onReset = cb; }

  // Team roster and map name over the warmup; decorative, so it never takes a touch. The countdown under the map card
  // is driven from update() so it stays true to the sim's warmup whatever speed this phone runs at.
  #showIntro(mapId, mode, roster, localId) {
    const map = MAPS[mapId] ?? this.map;
    const row = (p, i) => `<div class="in-row${p.id === localId ? ' me' : ''}" style="--i:${i}">${p.badge ? `<i class="f-bdg">${badgeMark(p.badge.prestige ?? 0, 15)}</i><u>${p.badge.level ?? ''}</u>` : ''}<b>${esc(p.name)}</b>${vetTag(vetOf(p), { short: true })}${p.isBot ? '<small>Bot</small>' : ''}</div>`;
    const team = (t, side) => {
      const list = roster.filter(p => p.team === t);
      return `<div class="in-team ${side}" style="--team:${TEAMS[t].css}"><h3><i></i>${esc(TEAMS[t].name)}</h3>${list.map(row).join('')}</div>`;
    };
    const myTeam = roster.find(p => p.id === localId)?.team ?? 0;
    const m = MODES[mode];
    const minutes = Math.round(this.timeLimit / 60);
    // Free-for-all: everyone in their own colour, split across both sides of the card. Nobody is on your side.
    const field = (list, side, title) => `<div class="in-team ${side}" style="--team:var(--c-sodium)"><h3><i></i>${esc(title)}</h3>${list.map((p, i) =>
      `<div style="--team:${TEAMS[p.team]?.css ?? '#fff'}">${row(p, i)}</div>`).join('')}</div>`;
    const half = Math.ceil(roster.length / 2);
    const rules = this.gun ? `${GUN_LADDER.length} guns<i></i>${minutes} min` : `First to ${this.scoreLimit}<i></i>${minutes} min`;
    this.introEl.innerHTML = `
      ${this.ffa ? field(roster.slice(0, half), 'ours', 'Every player') : team(myTeam, 'ours')}
      <div class="in-mid">
        <div class="in-card">
          <div class="in-pic" style="background-image:url(assets/maps/${esc(map?.id ?? mapId)}.jpg)"></div>
          <div class="in-mode">${glyph(`mode:${mode}`, 15, 'gl in-mode-icon')}<span>${esc(m?.name ?? '')}</span></div>
          <h2>${esc(map?.name ?? '')}</h2>
          <p class="in-rules">${rules}</p>
        </div>
        <div class="in-count"><b>3</b></div>
        <p class="in-tip">${esc(m?.desc ?? TIPS[Math.floor(Math.random() * TIPS.length)])}</p>
      </div>
      ${this.ffa ? field(roster.slice(half), 'theirs', 'for themselves') : team(1 - myTeam, 'theirs')}`;
    this.introCount = this.introEl.querySelector('.in-count b');
    this.introShown = 3;
    this.introEl.classList.add('show');
    this.introOn = true;
    this.controls?.el.classList.add('intro-on');
    this.modeBannerShown = true;      // The card already says what the mode is.
  }

  // 3, 2, 1 under the map card; each new number lands with a stamp.
  #tickIntro(view) {
    if (!this.introOn || !this.introCount) return;
    const left = Math.max(1, Math.ceil(3 - (view.t ?? 0)));
    if (left === this.introShown) return;
    this.introShown = left;
    this.introCount.textContent = left;
    this.introCount.animate(COUNT_POP, { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  #hideIntro(go = false) {
    if (!this.introOn) return;
    this.introOn = false;
    this.introEl.classList.remove('show');
    this.controls?.el.classList.remove('intro-on');
    if (go) this.goEl.animate(GO_FLASH, { duration: INTRO_GO_MS, easing: 'cubic-bezier(.2,.9,.3,1)' });
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
      gunLevel: NaN, rival: null, place: '',
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
    this.leaveArmed = false;
    this.leaveBtn.textContent = 'Leave match';
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
  // A Pro ability just fired for the local player: a short gold plate under the score bar.
  #onPro(perk) {
    const p = PRO[perk];
    if (!p) return;
    this.proToast.querySelector('b').textContent = p.name;
    this.proToast.querySelector('small').textContent = PRO_LINE[perk] ?? '';
    this.proToast.getAnimations().forEach(a => a.cancel());
    this.proToast.animate([
      { opacity: 0, transform: 'translate(-50%, 6px) scale(.92)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.12 },
      { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -4px) scale(1)' },
    ], { duration: 1700, easing: 'ease-out' });
  }

  #onHijack(e) {
    const view = this.view;
    if (!view) return;
    const p = view.players.find(q => q.id === e.by);
    const mine = e.by === view.localId;
    this.#pushFeed(`<em style="color:${TEAMS[p?.team ?? e.team].css}">${esc(p?.name ?? '?')}</em><span class="f-note">hijacked a Sentry</span>`, mine, p?.team === this.#findLocal(view)?.team ? 'ally' : 'foe');
  }

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
    this.#showEndBanner(results.winner, results.myTeam, results.players ? { ...this.view, players: results.players, scores: results.scores } : this.view);
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
      <canvas class="pro-layer"></canvas>
      <div class="pro-toast"><b></b><small></small></div>
      <div class="vignette"><i class="vg-pulse"></i></div>
      <div class="scorebar" data-tap="1">
        <div class="sb-side mine">
          <i class="sb-lamp"></i><b class="sb-name"></b><b class="sb-score">0</b>
          <i class="sb-track"><i class="sb-fill"></i></i>
        </div>
        <div class="sb-time"><b>10:00</b><small class="sb-goal"></small></div>
        <div class="sb-side theirs">
          <b class="sb-score">0</b><b class="sb-name"></b><i class="sb-lamp"></i>
          <i class="sb-track"><i class="sb-fill"></i></i>
        </div>
      </div>
      <div class="minimap">
        <canvas width="${MM_WIDTH * MM_SCALE}" height="${Math.round(MM_WIDTH * MM_SCALE * 2 / 3)}"></canvas>
        <i class="mm-corner tl"></i><i class="mm-corner br"></i>
        <span class="mm-tag" hidden>Enemy UAV</span>
      </div>
      <div class="feed"></div>
      <div class="medals"></div>
      <div class="hit">
        <svg class="hit-x" viewBox="-20 -20 40 40" aria-hidden="true"><path d="M-15 -15l8 8M15 -15l-8 8M-15 15l8 -8M15 15l-8 -8" /></svg>
        <svg class="hit-skull" viewBox="-20 -20 40 40" aria-hidden="true"><path d="M0 -17C-11 -17 -16 -10 -16 -3C-16 3 -13 6 -10 8L-9 14H-5V10H-2V14H2V10H5V14H9L10 8C13 6 16 3 16 -3C16 -10 11 -17 0 -17ZM-9 -6A4.5 4.5 0 1 1 -9 3A4.5 4.5 0 1 1 -9 -6ZM9 -6A4.5 4.5 0 1 1 9 3A4.5 4.5 0 1 1 9 -6ZM0 2L3 7H-3Z" fill-rule="evenodd"/></svg>
      </div>
      <div class="score-pop"><b>+100</b><small></small></div>
      ${[0, 1, 2, 3].map(() => '<svg class="dmg" viewBox="-110 -110 220 220" aria-hidden="true"><path class="dmg-arc" d="M-50 -96 A108 108 0 0 1 50 -96 L40 -78 A88 88 0 0 0 -40 -78 Z" /><path class="dmg-tip" d="M-9 -100 L0 -110 L9 -100 Z" /></svg>').join('')}
      <div class="corner">
        <div class="net-chip" hidden><i class="bars"><i></i><i></i><i></i></i><span>--</span></div>
        <button class="chip-btn speaker" data-tap="1" hidden aria-label="Mute team voice">
          ${glyph('ui:volume', 19)}
        </button>
        <button class="chip-btn mic" data-tap="1" data-state="hidden" hidden aria-label="Team voice">
          ${glyph('ui:mic', 19)}
          <span class="mic-tag"></span>
        </button>
      </div>
      <div class="status">
        <div class="vitals">
          <div class="hp-line"><span class="protect" hidden>Spawn shield</span><span class="hp-num">100</span></div>
          <i class="hp-track"><i class="hp-loss"></i><i class="hp-fill"></i><i class="hp-ticks"></i></i>
        </div>
        <div class="arms">
          <i class="heat" hidden><i class="heat-fill"></i></i>
          <div class="arms-top"><span class="arms-icon"></span><span class="arms-name"><span></span></span></div>
          <div class="arms-count"><b class="ammo">30</b><span class="reserve">150</span></div>
          <i class="mag"><i class="mag-fill"></i></i>
          <i class="reload-track"><i class="reload-fill"></i></i>
        </div>
      </div>
      <div class="over-banner"><b>Overheated</b><small>Swap to sidearm</small></div>
      <div class="board" hidden>
        <div class="board-top"><b class="board-mode"></b><span class="board-goal"></span></div>
        <div class="board-grid"></div>
        <div class="board-foot"><small class="board-tip">Tap the score to close</small><button class="board-leave" data-tap="1">Leave match</button></div>
      </div>
      <div class="range-panel" hidden>
        <div class="rp-head">Firing Range</div>
        <div class="rp-grid">
          <div class="rp-big"><span>DPS</span><b class="rp-dps">0</b></div>
          <div><span>Peak</span><b class="rp-peak">0</b></div>
          <div><span>Accuracy</span><b class="rp-acc">--</b></div>
          <div><span>Last TTK</span><b class="rp-ttk">--</b></div>
          <div><span>Best TTK</span><b class="rp-best">--</b></div>
          <div class="rp-wide"><span>Last hit</span><b class="rp-last">--</b></div>
          <small class="rp-model"></small>
        </div>
        <button class="rp-reset" data-tap="1">Reset</button>
      </div>
      <button class="range-leave" data-tap="1" hidden>Leave range</button>
      <div class="intro"></div>
      <div class="go-flash"><b>Go</b></div>
      <div class="streak-hit"><span class="sh-icon"></span><span class="sh-text"><b></b><small></small></span></div>
      <div class="respawn-flash"></div>
      <div class="streak-edge"></div>
      <div class="obj-marks"></div>
      <div class="obj-strip" hidden>
        <div class="obj-chips"></div>
        <div class="obj-timer" hidden><small>Moves in</small><b>0:30</b></div>
      </div>
      <div class="gun-rung" hidden style="position:absolute;left:50%;top:calc(var(--st) + 50px);transform:translateX(-50%);min-width:210px;padding:5px 12px 6px;background:var(--hud-glass);box-shadow:var(--hud-edge);clip-path:polygon(8px 0,calc(100% - 8px) 0,100% 8px,100% 100%,0 100%,0 8px);pointer-events:none;display:flex;flex-direction:column;gap:3px">
        <div style="display:flex;align-items:center;gap:7px;color:var(--c-chalk)"><span class="gr-icon" style="color:#fff"></span><b class="gr-name" style="font:400 15px/1 var(--f-stencil);letter-spacing:var(--tr-stencil)"></b><b class="gr-n" style="margin-left:auto;font:400 15px/1 var(--f-stencil);color:var(--c-sodium);font-variant-numeric:tabular-nums"></b></div>
        <div class="gr-pips" style="display:flex;gap:2px"></div>
        <div class="gr-next" style="display:flex;align-items:center;gap:5px;font:400 var(--fs-caption)/1 var(--f-plate);letter-spacing:var(--tr-plate);color:rgba(231,234,228,.75)"></div>
      </div>
      <div class="obj-meter" hidden><i class="obj-meter-fill"></i><b></b></div>
      <div class="obj-banner"><b></b><small></small></div>
      <div class="callout"></div>
      <div class="notice"></div>
      <div class="spectate" hidden></div>
      <div class="death">
        <div class="death-top">
        <div class="death-card">
          <div class="dc-kick">Killed by</div>
          <div class="death-by"></div>
          <div class="dc-weapon"><span class="dc-icon"></span><b class="dc-wname"></b><small class="dc-tags"></small></div>
          <div class="dc-left" hidden></div>
        </div>
        <div class="death-timer">
          <svg viewBox="-30 -30 60 60" aria-hidden="true"><circle class="dt-track" r="26"/><circle class="dt-arc" r="26" transform="rotate(-90)"/></svg>
          <b class="death-count">3</b><small>Respawn</small>
        </div>
        </div>
        <div class="picker">
          <span class="picker-label">Next life</span>
          ${Array.from({ length: LOADOUT_COUNT }, (_, i) => `
          <button class="pick" data-tap="1" data-i="${i}"><span class="pk-icon"></span><span class="pk-text"><b></b><small></small></span></button>`).join('')}
        </div>
      </div>
      <div class="flashbang"></div>
      <div class="heal-veil"></div>
      <div class="endbanner"><i class="eb-band"></i><b></b><small></small></div>`;
    this.root.appendChild(el);

    const $ = sel => el.querySelector(sel);
    this.vignette = $('.vignette');
    this.proCanvas = $('.pro-layer');
    this.proCtx = this.proCanvas.getContext('2d');
    this.proToast = $('.pro-toast');
    this.prints = new Footprints();
    this.printList = [];
    this.printClock = 0;
    this.proDrawn = false;
    this.heard = [];
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
    this.gunEl = $('.gun-rung');
    this.objMeterFill = $('.obj-meter-fill');
    this.objMeterText = $('.obj-meter b');
    this.objBanner = $('.obj-banner');
    this.objNodes = [];           // One entry per objective point: chip and in-world marker.
    this.flashEl = $('.flashbang');
    this.healEl = $('.heal-veil');
    this.hitX = $('.hit-x');
    this.armsName = $('.arms-name span');
    this.armsIcon = $('.arms-icon');
    this.magFill = $('.mag-fill');
    this.hpLoss = $('.hp-loss');
    this.scorePop = $('.score-pop');
    this.scorePopNum = $('.score-pop b');
    this.scorePopWhy = $('.score-pop small');
    this.goEl = $('.go-flash');
    this.sbGoal = $('.sb-goal');
    this.boardMode = $('.board-mode');
    this.boardGoal = $('.board-goal');
    this.dcIcon = $('.dc-icon');
    this.dcName = $('.dc-wname');
    this.dcTags = $('.dc-tags');
    this.dcLeft = $('.dc-left');
    this.dtArc = $('.dt-arc');
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
    this.introEl = $('.intro');
    this.streakEdge = $('.streak-edge');
    this.leaveBtn = $('.board-leave');
    this.streakHitEl = $('.streak-hit');
    this.respawnEl = $('.respawn-flash');
    this.#range = new RangeReadout(el);
    $('.range-leave').addEventListener('click', () => this.leaveCb?.());
    this.leaveBtn.addEventListener('click', () => this.#tapLeave());

    this.micBtn.addEventListener('click', () => this.micCb?.());
    this.speakerBtn.addEventListener('click', () => this.speakerCb?.());
    for (const pick of this.picks) pick.addEventListener('click', () => this.#choose(Number(pick.dataset.i)));
    $('.scorebar').addEventListener('click', () => this.toggleBoard());
    this.#buildBoard();
  }

  // Two taps on purpose: a stray thumb on the open scoreboard must not end the match.
  #tapLeave() {
    if (!this.leaveArmed) {
      this.leaveArmed = true;
      this.leaveBtn.textContent = 'Tap again to leave';
      return;
    }
    this.toggleBoard();
    this.leaveCb?.();
  }

  // Twelve rows made once and only ever retexted, so an open board costs a few text writes a second.
  #buildBoard() {
    this.boardGrid.innerHTML = [0, 1].map(() => `
      <div class="lb-side">
        <div class="lb-head"><b class="lb-team"></b><span>K</span><span>D</span><span>A</span><span class="lb-mode">HS</span><span>Score</span></div>
        ${[0, 1, 2, 3, 4, 5].map(() => '<div class="lb-row"><span class="lb-name"><i class="lb-bdg"></i><u class="lb-lv"></u><b></b><i class="lb-vet"></i></span><span></span><span></span><span></span><span></span><span></span></div>').join('')}
      </div>`).join('');
    this.boardSides = [...this.boardGrid.querySelectorAll('.lb-side')].map(node => ({
      team: node.querySelector('.lb-team'),
      modeHead: node.querySelector('.lb-mode'),
      rows: [...node.querySelectorAll('.lb-row')].map(row => ({
        row, cells: row.children, name: row.querySelector('.lb-name b'), bdg: row.querySelector('.lb-bdg'), lv: row.querySelector('.lb-lv'), rank: -1,
        vet: row.querySelector('.lb-vet'), vetOn: null,
      })),
    }));
  }

  toggleBoard() {
    this.boardOpen = !this.boardOpen;
    this.boardEl.hidden = !this.boardOpen;
    this.boardClock = 0;
    this.leaveArmed = false;
    this.leaveBtn.textContent = 'Leave match';
    if (this.boardOpen && this.view) this.#paintBoard(this.view);
  }

  #paintBoard(view) {
    const me = this.#findLocal(view);
    if (!me) return;
    if (this.ffa) { this.#paintFfaBoard(view, me); return; }
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
        slot.name.style.color = '';
        const badge = this.badges.get(p.id);
        const rank = badge?.prestige ?? -1;
        if (rank !== slot.rank) {
          slot.rank = rank;
          slot.bdg.innerHTML = badge ? badgeMark(rank, 15) : '';
        }
        slot.lv.textContent = badge?.level ?? '';
        const vet = !!identityOf(p.id)?.vet;
        if (vet !== slot.vetOn) { slot.vetOn = vet; slot.vet.innerHTML = vetTag(vet, { short: true }); }
        cells[1].textContent = p.kills;
        cells[2].textContent = p.deaths;
        cells[3].textContent = p.assists ?? 0;
        cells[4].textContent = this.#objectiveStat(p);
        cells[5].textContent = matchScore(p);
      });
    });
  }

  // Free-for-all: one ranked list over both halves (12 rows, the largest field), each row in that player's colour.
  #paintFfaBoard(view, me) {
    const ranked = ffaRank(view);
    const per = this.boardSides[0].rows.length;
    this.boardSides.forEach((side, s) => {
      side.team.textContent = s === 0 ? `Standings  ${ORDINAL(ranked.indexOf(me) + 1)}` : '';
      side.team.style.color = s === 0 ? TEAMS[me.team].css : '';
      side.modeHead.textContent = this.gun ? 'Gun' : 'HS';
      side.rows.forEach((slot, i) => {
        const at = s * per + i, p = ranked[at], { row, cells } = slot;
        row.hidden = !p;
        if (!p) return;
        row.classList.toggle('me', p.id === me.id);
        slot.name.textContent = `${at + 1}. ${p.name}`;
        slot.name.style.color = TEAMS[p.team]?.css ?? '';
        const badge = this.badges.get(p.id);
        const rank = badge?.prestige ?? -1;
        if (rank !== slot.rank) { slot.rank = rank; slot.bdg.innerHTML = badge ? badgeMark(rank, 15) : ''; }
        slot.lv.textContent = badge?.level ?? '';
        const vet = !!identityOf(p.id)?.vet;
        if (vet !== slot.vetOn) { slot.vetOn = vet; slot.vet.innerHTML = vetTag(vet, { short: true }); }
        cells[1].textContent = p.kills;
        cells[2].textContent = p.deaths;
        cells[3].textContent = p.assists ?? 0;
        cells[4].textContent = this.gun ? `${Math.min(GUN_LADDER.length, (view.scores[p.team] ?? 0) + 1)}` : p.head ?? 0;
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
        pick.querySelector('.pk-icon').innerHTML = glyph(all[i].primary, 16);
      });
    }
    const active = Progress.activeLoadout;
    if (this.cache.picked === active) return;
    this.cache.picked = active;
    this.picks.forEach((pick, i) => pick.classList.toggle('on', i === active));
  }

  // --- Per-frame ---
  update(view, dt) {
    // Scheduled from the first real frame: a phone can spend a second building the renderer before that.
    if (this.pendingIntro) {
      const { mapId, mode, roster, localId } = this.pendingIntro;
      this.pendingIntro = null;
      this.#showIntro(mapId, mode, roster, localId);
    }
    if (view.phase !== 'warmup') this.#hideIntro(view.phase === 'live');  // The reveal rides the warmup.
    else this.#tickIntro(view);
    if (!this.remeasured) { this.remeasured = true; this.remeasure(); }
    const previousPhase = this.cache.phase;
    this.view = view;
    const me = this.#findLocal(view);
    if (!me) return;
    const c = this.cache;
    const myTeam = me.team;
    // Free-for-all: the other half of the scorebar is whoever you are chasing, the leader, or second place while you lead.
    let other = 1 - myTeam;
    if (this.ffa) {
      const ranked = ffaRank(view);
      const rival = ranked[0] === me ? ranked[1] : ranked[0];
      other = rival?.team ?? myTeam;
      if (c.rival !== (rival?.id ?? null) || c.teamFlip !== myTeam) {
        c.rival = rival?.id ?? null;
        c.teamFlip = myTeam;
        c.otherScore = NaN;
        this.#paintFfaBar(me, rival, ranked[0] === me);
      }
      const place = ORDINAL(ranked.indexOf(me) + 1);
      if (place !== c.place) { c.place = place; this.sbMine.name.textContent = place; }
    } else if (c.teamFlip !== myTeam) {
      c.teamFlip = myTeam;
      this.#paintTeams(myTeam);
    }
    if (c.myScore !== view.scores[myTeam]) {
      if (c.myScore < view.scores[myTeam]) this.sbMine.score.animate(SCORE_POP, { duration: 280 });
      c.myScore = view.scores[myTeam];
      this.sbMine.score.textContent = c.myScore;
      this.sbMine.fill.style.transform = `scaleX(${Math.min(1, c.myScore / this.scoreLimit)})`;
    }
    if (c.otherScore !== view.scores[other]) {
      if (c.otherScore < view.scores[other]) this.sbTheirs.score.animate(SCORE_POP, { duration: 280 });
      c.otherScore = view.scores[other];
      this.sbTheirs.score.textContent = c.otherScore;
      this.sbTheirs.fill.style.transform = `scaleX(${Math.min(1, c.otherScore / this.scoreLimit)})`;
    }

    const lead = c.myScore > c.otherScore ? 'mine' : c.otherScore > c.myScore ? 'theirs' : '';
    if (lead !== c.lead) {
      c.lead = lead;
      this.sbMine.root.classList.toggle('lead', lead === 'mine');
      this.sbTheirs.root.classList.toggle('lead', lead === 'theirs');
    }

    const shown = view.phase === 'warmup' ? Math.ceil(view.timeLeft) : Math.max(0, Math.ceil(view.timeLeft));
    if (c.time !== shown) {
      c.time = shown;
      this.timeEl.textContent = `${pad2(Math.floor(shown / 60))}:${pad2(shown % 60)}`;
      this.timeEl.classList.toggle('urgent', view.phase === 'live' && shown <= 30);
      if (view.phase === 'live' && shown <= 10 && shown > 0) this.timeEl.animate(COUNT_POP, { duration: 300, easing: 'ease-out' });
    }

    if (view.phase !== previousPhase) {
      c.phase = view.phase;
      if (view.phase === 'ended' && !this.endShown) {
        this.#showEndBanner(view.winner, myTeam, view);
        if (this.boardOpen) this.toggleBoard();
      }
    }

    if (view.phase === 'warmup' && !this.modeBannerShown && view.mode === this.mode) {
      this.modeBannerShown = true;
      this.#banner(MODES[this.modeId]?.name ?? '', MODES[this.modeId]?.desc ?? '', 3200);
    }
    this.#updateObjectives(view, me, c);
    this.#updateGun(view, me, c);

    this.#updateVitals(me, c, view);
    this.#updateArms(me, c);
    this.controls?.notePlayerAim(me.aim);
    this.#updateTiles(me, c);
    this.#updateDeath(me, c, view);
    this.#decayEffects(dt);
    this.#tickFeed(dt);
    this.#tickMedals(dt);
    this.#range.update(view.range ?? this.rangeSource?.() ?? null, dt);

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
    this.#updateProLayer(view, me, dt);
  }

  // ---- Pro senses over the world ----
  // Footprints (Tracker Pro), the Fastball blast ring (Strong Arm Pro) and enemy equipment through walls (Hijacker,
  // Engineer Pro). One canvas at CSS pixels; cleared only when something was drawn, so it costs nothing otherwise.
  #updateProLayer(view, me, dt) {
    const pro = me.pro ?? NO_PRO;
    const g = this.proCtx, cam = this.camera;
    if (this.proDrawn) { g.clearRect(0, 0, this.proCanvas.width, this.proCanvas.height); this.proDrawn = false; }
    if (!cam || !me.alive || view.phase === 'ended' || pro.length === 0) return;
    const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements, W = this.viewW, H = this.viewH;
    const P = this.projected ??= { x: 0, y: 0 };
    const project = (x, y, z) => {
      const vx = v[0] * x + v[4] * y + v[8] * z + v[12], vy = v[1] * x + v[5] * y + v[9] * z + v[13], vz = v[2] * x + v[6] * y + v[10] * z + v[14];
      const w = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
      if (w <= 0.01) return null;
      P.x = ((p[0] * vx + p[8] * vz + p[12]) / w * 0.5 + 0.5) * W;
      P.y = (0.5 - (p[5] * vy + p[9] * vz + p[13]) / w * 0.5) * H;
      return P;
    };
    if (pro.includes('tracker')) {
      this.prints.update(view, me, view.t);
      this.printClock += dt;
      if (this.printClock >= 1 / PRINT_HZ) { this.printClock = 0; this.printList = this.prints.visible(this.map, me, view.t, view.smokes).slice(); }
      const enemy = this.ffa ? FFA_FOE : TEAMS[1 - me.team].css;
      for (const f of this.printList) {
        const a = project(f.x, 0.03, f.z);
        if (!a) continue;
        const x0 = a.x, y0 = a.y;
        const b = project(f.x + Math.cos(f.a) * 0.3, 0.03, f.z + Math.sin(f.a) * 0.3);
        if (!b) continue;
        const ang = Math.atan2(b.y - y0, b.x - x0), len = Math.hypot(b.x - x0, b.y - y0);
        g.globalAlpha = 0.85 * (1 - (1 - f.k) * (1 - f.k));
        g.fillStyle = enemy;
        g.beginPath();
        g.ellipse(x0, y0, Math.max(4.5, len * 0.9), Math.max(2.4, len * 0.5), ang, 0, Math.PI * 2);
        g.fill();
        this.proDrawn = true;
      }
      g.globalAlpha = 1;
    }
    // The preview reports the radius when given the Pro list; the HUD knows it either way.
    const land = view.throwPreview?.landing;
    const radius = land ? land.radius || (pro.includes('strongarm') ? effectRadius(land.kind) : 0) : 0;
    if (radius > 0) {
      g.beginPath();
      for (let i = 0; i <= 32; i++) {
        const t = i / 32 * Math.PI * 2, q = project(land.x + Math.cos(t) * radius, 0.05, land.z + Math.sin(t) * radius);
        if (!q) continue;
        if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y);
      }
      g.fillStyle = 'rgba(255,215,94,.13)';
      g.fill();
      g.setLineDash([7, 5]);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,215,94,.9)';
      g.stroke();
      g.setLineDash([]);
      this.proDrawn = true;
    }
    if (pro.includes('engineer') && view.projectiles?.length) {
      const pulse = 0.65 + 0.35 * Math.sin(view.t * 6);
      for (const q of view.projectiles) {
        if (!SEEN_GEAR.has(q.kind) || !q.stuck) continue;
        const owner = view.players.find(o => o.id === q.owner);
        if (!owner || owner.team === me.team) continue;
        const a = project(q.x, 0.4, q.z);
        if (!a) continue;
        const r = 7;
        g.globalAlpha = pulse;
        g.strokeStyle = TEAMS[owner.team].css;
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(a.x, a.y - r); g.lineTo(a.x + r, a.y); g.lineTo(a.x, a.y + r); g.lineTo(a.x - r, a.y);
        g.closePath();
        g.stroke();
        g.fillStyle = '#fff';
        g.fillRect(a.x - 1.5, a.y - 1.5, 3, 3);
        this.proDrawn = true;
      }
      g.globalAlpha = 1;
    }
  }

  #findLocal(view) {
    for (const p of view.players) if (p.id === view.localId) return p;
    return null;
  }

  // Your own colour on the left; the rival's name and colour on the right, marked as the leader when they are.
  #paintFfaBar(me, rival, leading) {
    const mine = TEAMS[me.team]?.css ?? '#fff', theirs = rival ? TEAMS[rival.team]?.css ?? FFA_FOE : FFA_FOE;
    this.sbTheirs.name.textContent = rival ? `${leading ? '2nd ' : 'Lead '}${rival.name}` : '';
    this.sbMine.root.style.setProperty('--team', mine);
    this.sbTheirs.root.style.setProperty('--team', theirs);
    this.el.style.setProperty('--my-team', mine);
    this.el.style.setProperty('--enemy-team', FFA_FOE);
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
      const was = Number.isNaN(c.hp) ? hp : c.hp;
      c.hp = hp;
      this.hpNum.textContent = hp;
      this.hpFill.style.transform = `scaleX(${hp / MAX_HP})`;
      // The chunk just lost hangs for a beat as a pale trail, then drains: damage reads as an amount, not a flicker.
      this.hpLossAnim?.cancel();
      if (hp < was && me.alive) {
        this.hpLossAnim = this.hpLoss.animate([{ transform: `scaleX(${was / MAX_HP})` }, { transform: `scaleX(${hp / MAX_HP})` }],
          { duration: 420, delay: 260, easing: 'ease-in', fill: 'both' });
        this.vitals.animate(HP_KNOCK, { duration: 220, easing: 'ease-out' });
      } else {
        this.hpLoss.style.transform = `scaleX(${hp / MAX_HP})`;
      }
      const hurt = hp > 0 && hp <= MAX_HP * 0.35;
      if (hurt !== c.hurt) {
        c.hurt = hurt;
        this.vitals.classList.toggle('hurt', hurt);
        this.vignette.classList.toggle('critical', hurt && me.alive);
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
      this.armsIcon.innerHTML = glyph(me.weapon, 15);
      // Rounds as notches when they can be counted at a glance; a belt-fed gun gets a plain gauge.
      this.arms.style.setProperty('--mag', c.magazine <= 40 ? c.magazine : 1);
      if (c.weaponSeen) this.arms.animate(ARMS_SWAP, { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1)' });
      c.weaponSeen = true;
      c.ammo = NaN;
    }
    if (me.ammo !== c.ammo) {
      c.ammo = me.ammo;
      this.ammoEl.textContent = me.ammo;
      this.magFill.style.transform = `scaleX(${Math.min(1, me.ammo / (c.magazine || 1))})`;
    }
    if (me.reserve !== c.reserve) {
      c.reserve = me.reserve;
      // Sidearms carry unlimited reserve, reported as a huge number.
      this.reserveEl.textContent = me.reserve > 900 ? '\u221e' : `${me.reserve}`;
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
      if (controls.setTile(i, slot, score)) this.#streakReady(slot.kind);
    }
    controls.setEquip('tactical', me.tactical ?? this.fallbackEquip.tactical, me.tacticalLeft ?? 0);
    controls.setEquip('lethal', me.lethal ?? this.fallbackEquip.lethal, me.lethalLeft ?? 0);
  }

  // The moment a streak comes online: a full-size card, a bright edge flash and a pulse from the tile.
  #streakReady(kind) {
    const name = STREAKS[kind]?.name ?? kind;
    const el = this.streakHitEl;
    el.querySelector('.sh-icon').innerHTML = glyph(kind, 34);
    el.querySelector('b').textContent = `${name} ready`;
    el.querySelector('small').textContent = STREAKS[kind]?.desc ?? 'Tap its tile to call it in';
    el.animate(STREAK_HIT, { duration: 1300, easing: 'cubic-bezier(.2,.9,.3,1)' });
    this.streakEdge.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
  }

  #updateDeath(me, c, view) {
    const dead = !me.alive && view.phase === 'live';
    if (dead !== c.dead) {
      c.dead = dead;
      this.deathEl.classList.toggle('show', dead);
      this.controls?.setDown(dead);
      this.respawnTotal = Math.max(1, me.respawnT ?? 3);
      c.ring = NaN;
      if (dead) this.#paintDeathHead(view);
    }
    if (!dead) return;
    const left = Math.max(1, Math.ceil(me.respawnT ?? 0));
    if (left !== c.respawn) {
      c.respawn = left;
      this.deathCount.textContent = left;
      this.deathCount.animate(COUNT_POP, { duration: 320, easing: 'ease-out' });
    }
    // The ring empties toward the respawn, in 1/40 steps so it repaints a few dozen times rather than every frame.
    const ring = Math.round(Math.max(0, Math.min(1, (me.respawnT ?? 0) / this.respawnTotal)) * 40) / 40;
    if (ring !== c.ring) {
      c.ring = ring;
      this.dtArc.style.strokeDashoffset = ((1 - ring) * DEATH_RING).toFixed(1);
    }
    if (this.killer?.name && !this.deathPainted) this.#paintDeathHead(view);
  }

  // The killer card: who, with what, from how far, and how much fight they had left.
  #paintDeathHead(view) {
    const k = this.killer;
    this.deathPainted = !!k?.name;
    const card = this.deathEl.querySelector('.death-card');
    card.style.setProperty('--team', k?.color ?? 'var(--haze)');
    // The killer's calling card carries their name; badge, level and the Veteran tag ride under it.
    const who = k?.name ? identityOf(k.id) : null;
    this.deathBy.innerHTML = k?.name
      ? `${cardHtml(who?.card ?? 'yard', { size: 236, title: k.name, sub: '' })}
         <span class="dc-vet">${k.badge ? `<i class="f-bdg">${badgeMark(k.badge.prestige ?? 0, 16)}</i><u>Lv ${k.badge.level ?? ''}</u>` : ''}${vetTag(!!who?.vet)}</span>`
      : '<em>Eliminated</em>';
    this.deathEl.querySelector('.dc-kick').textContent = k?.name ? (k.self ? 'Your own blast' : 'Killed by') : 'Down';
    this.dcIcon.innerHTML = k ? glyph(k.icon, 20) : '';
    this.dcName.textContent = k?.weapon ?? '';
    const tags = [];
    if (k?.head) tags.push('Headshot');
    if (k?.dist) tags.push(`${Math.round(k.dist)} m`);
    this.dcTags.textContent = tags.join('   ');
    this.dcTags.classList.toggle('head', !!k?.head);
    const killer = k && view?.players.find(p => p.id === k.id);
    const hp = killer?.alive ? Math.ceil(killer.hp) : null;
    this.dcLeft.hidden = hp === null || k.self;
    if (hp !== null) this.dcLeft.innerHTML = `<i style="transform:scaleX(${(hp / MAX_HP).toFixed(2)})"></i><span>Left on ${hp} HP</span>`;
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
        case 'spawn':
          if (e.id === this.view?.localId) {
            this.killer = null;
            this.deathPainted = false;
            this.#syncThrowReach();
            this.respawnEl.animate(RESPAWN_FLASH, { duration: 420, easing: 'ease-out' });
          }
          break;
        case 'streak': this.#onStreak(e); break;
        case 'streak_denied': this.#onDenied(e); break;
        case 'incoming': this.#onIncoming(e); break;
        case 'emp': this.#onEmp(e); break;
        case 'pulse': this.#onPulse(e); break;
        case 'zap': if (e.by === this.view?.localId) this.notify('Trophy stopped a grenade'); break;
        case 'decoy': if (e.by === this.view?.localId) this.notify('Decoy firing'); break;
        case 'flashed': if (e.id === this.view?.localId) this.#onFlashed(e.amount ?? 1); break;
        case 'heal': if (e.id === this.view?.localId) this.healEl.animate(HEAL_PULSE, { duration: 520 }); break;
        case 'capture': this.#onCapture(e); break;
        case 'hard_move': this.#onHardMove(e); break;
        case 'pro': if (e.id === this.view?.localId) this.#onPro(e.perk); break;
        case 'hijack': this.#onHijack(e); break;
        case 'arm': this.#onArm(e); break;
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
      if (head || kill) this.hitEl.animate(HIT_PUNCH, { duration: 160, easing: 'ease-out' });
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
    const causeId = e.equip ?? (typeof e.streak === 'string' ? e.streak : e.weapon);
    const art = glyph(causeId, 13, 'gl f-gun');
    const cause = art ? `<span class="f-w" title="${esc(killCause(e))}">${art}</span>` : `<span class="f-w f-text">${esc(killCause(e))}</span>`;
    const head = e.head ? `<span class="f-hs">${glyph('medal:headshot', 14)}</span>` : '';
    const side = byP?.team === view.players.find(p => p.id === view.localId)?.team ? 'ally' : 'foe';
    this.#pushFeed(`${this.#feedBadge(e.by)}<em style="color:${byCss}">${esc(byName)}</em>${cause}${head}${this.#feedBadge(e.target)}<em style="color:${tgtCss}">${esc(tgtName)}</em>`, mine, side);
    if (e.by === view.localId && e.target !== view.localId) this.#scorePop(SCORE.kill + (e.head ? SCORE.headshot : 0), e.head ? 'Headshot' : 'Kill');
    else if (e.assist === view.localId) this.#scorePop(SCORE.assist, 'Assist');

    if (e.target === view.localId) {
      this.killer = {
        id: e.by, name: byName, color: byCss, weapon: killCause(e), icon: e.equip ?? (typeof e.streak === 'string' ? e.streak : e.weapon),
        head: !!e.head, dist: e.streak || e.equip ? 0 : e.dist, badge: this.badges.get(e.by) ?? null, self: e.by === e.target,
      };
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
    const name = STREAKS[e.kind]?.name ?? e.kind;
    const verb = STREAK_VERB[e.kind] ?? 'called in';
    this.notify(`${friendly ? '' : 'Enemy '}${name} ${verb}`);
    // The ones that change what this player can see or do get a callout as well as a feed line.
    if (!friendly && STREAK_WARN[e.kind]) this.#callout(STREAK_WARN[e.kind]);
    else if (p.id === me.id) this.#callout(`${name} ${verb}`);
  }

  // The tile already says why; this makes the refusal felt at the moment of the tap.
  #onDenied(e) {
    if (e.id !== this.view?.localId) return;
    const name = STREAKS[e.kind]?.name ?? e.kind;
    this.#callout(`${name}: ${STREAK_DENY_TEXT[e.reason] ?? 'Unavailable'}`);
  }

  // Mortar shells are announced before they land; only enemy shells near this player are worth a shout.
  #onIncoming(e) {
    const me = this.view && this.#findLocal(this.view);
    if (!me?.alive || e.team === me.team) return;
    if (Math.hypot(e.x - me.x, e.z - me.z) > INCOMING_WARN_M) return;
    const now = performance.now();
    if (now - (this.incomingAt ?? -1e9) < INCOMING_GAP_MS) return;
    this.incomingAt = now;
    this.#callout('Incoming! Move');
  }

  #onEmp(e) {
    const me = this.view && this.#findLocal(this.view);
    if (!me || e.team !== me.team) return;
    this.#banner('EMP', 'Your air, sentries and radar are down', 2000, 'enemy');
  }

  #onPulse(e) {
    const me = this.view && this.#findLocal(this.view);
    if (!me?.alive || e.by === me.id) return;
    const owner = this.view.players.find(p => p.id === e.by);
    if (!owner || owner.team === me.team) return;
    if (Math.hypot(e.x - me.x, e.z - me.z) <= (e.r ?? 0)) this.#callout('Sensor: you are marked');
  }

  // "+100" under the crosshair, off to one side so it never sits on the target. Kills close together add up.
  #scorePop(points, why) {
    const now = performance.now();
    const fresh = now - (this.popAt ?? -1e9) > SCORE_POP_LIFE * 1000;
    this.popAt = now;
    this.popSum = fresh ? points : (this.popSum ?? 0) + points;
    this.scorePopNum.textContent = `+${this.popSum}`;
    this.scorePopWhy.textContent = why;
    this.scorePopAnim?.cancel();
    this.scorePopAnim = this.scorePop.animate(fresh ? SCORE_POP_IN : SCORE_POP_BUMP, { duration: SCORE_POP_LIFE * 1000 + 300, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  #pushFeed(html, mine = false, side = '') {
    const row = document.createElement('div');
    row.className = `f-row${mine ? ' mine' : ''}${side ? ' ' + side : ''}`;
    row.innerHTML = html;
    row.animate([{ transform: 'translateX(-18px)', opacity: 0, filter: 'brightness(2)' }, { transform: 'none', opacity: 1, filter: 'brightness(1)' }], { duration: 240, easing: 'cubic-bezier(.2,.9,.3,1)' });
    this.feedEl.prepend(row);
    this.feed.unshift({ row, life: FEED_LIFE });
    while (this.feed.length > FEED_ROWS) this.feed.pop().row.remove();
  }

  // A few seconds on the host's notice line, then the feed keeps a record of it.
  announceHost(name, isMe) {
    this.setNotice(isMe ? 'You are now the host' : `${name} is now hosting`);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.setNotice(''), 2600);
    this.notify(isMe ? 'You took over as host' : `${name} took over as host`);
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
    const [title, sub, tier] = card ? [card.title, card.sub, card.big ? 3 : 2] : MEDALS[id] ?? [String(id).replace(/_/g, ' '), '', 1];
    const art = card ? '' : glyph(`medal:${id}`, 32);
    const node = document.createElement('div');
    node.className = `medal t${tier}`;
    node.innerHTML = `${art ? `<span class="md-icon">${art}</span>` : ''}<span class="md-text"><b>${esc(title)}</b><small>${esc(sub)}</small></span><i class="md-sweep"></i>`;
    node.style.setProperty('--tilt', `${(Math.random() * 5 - 2.5).toFixed(1)}deg`);
    node.style.animationDuration = `${MEDAL_LIFE}s`;
    node.addEventListener('animationend', e => { if (e.target === node) node.remove(); });
    while (this.medalsEl.childElementCount >= 2) this.medalsEl.firstElementChild.remove();
    this.medalsEl.appendChild(node);
  }

  #showEndBanner(winner, myTeam, view = this.view) {
    if (this.endShown) return;
    this.endShown = true;
    this.endAt = performance.now();
    this.deathEl.classList.remove('show');
    if (this.ffa && view) {
      // Placement, not sides: first is a win, the podium is a good day, the rest is a loss.
      const ranked = ffaRank(view), at = ranked.findIndex(p => p.team === myTeam) + 1;
      const won = winner === myTeam, leader = ranked[0];
      this.endEl.dataset.result = won ? 'win' : winner === null || winner === undefined ? 'draw' : at <= 3 ? 'draw' : 'loss';
      this.endEl.querySelector('b').textContent = won ? '1st place' : at ? `${ORDINAL(at)} place` : 'Match over';
      this.endEl.querySelector('small').textContent = won ? (this.gun ? 'Through every gun' : 'Last one standing') : `${leader?.name ?? 'Someone'} took the yard`;
      this.endEl.classList.add('show');
      return;
    }
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
    this.staticSet = null;           // Jammed snow is drawn over this map's walls.
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
    const enemyUav = this.ffa ? view.uav.some((v, t) => t !== myTeam && v > 0) : view.uav[1 - myTeam] > 0;
    const jammed = !!view.jammed;
    const tag = jammed ? 'Jammed' : enemyUav ? 'Enemy UAV' : '';
    if (tag !== this.cache.mmTag) {
      this.cache.mmTag = tag;
      this.mmTag.hidden = !tag;
      this.mmTag.textContent = tag;
      this.mmCanvas.parentNode.classList.toggle('jammed', jammed);
    }
    // Jammed: the radar shows snow and nothing on it can be trusted, so only the local player's own arrow stays.
    if (jammed) {
      const frames = this.#staticFrames();
      g.drawImage(frames[(this.staticTick = ((this.staticTick ?? 0) + 1) % STATIC_FRAMES)], 0, 0);
      this.#drawSelf(g, me, sx, sz);
      return;
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
    this.#drawProMini(view, me, sx, sz, g, clock);

    this.#drawSelf(g, me, sx, sz);
  }

  // Keen Ears (Dead Silence Pro): a sprinting enemy in earshot is a sound ring, not a position. Hijacker (Engineer Pro):
  // enemy equipment as small hollow diamonds.
  #drawProMini(view, me, sx, sz, g, clock) {
    const pro = me.pro ?? NO_PRO;
    if (pro.includes('deadsilence') && me.alive) {
      const heard = heardEnemies(view, me, this.heard);
      g.lineWidth = 1.6;
      for (const p of heard) {
        const k = (clock * 1.6 + p.x * 0.07) % 1;
        g.strokeStyle = TEAMS[p.team].css;
        g.globalAlpha = 0.9 * (1 - k);
        g.beginPath();
        g.arc(p.x * sx, p.z * sz, 3 + k * 9, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      if (heard.length) {
        // The edge of earshot, faintly, so the player learns what the ring means.
        g.strokeStyle = 'rgba(231,234,228,.18)';
        g.setLineDash([3, 4]);
        g.beginPath();
        g.arc(me.x * sx, me.z * sz, HEAR_RANGE * sx, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    }
    if (pro.includes('engineer') && view.projectiles?.length) {
      for (const q of view.projectiles) {
        if (!SEEN_GEAR.has(q.kind) || !q.stuck) continue;
        const owner = view.players.find(o => o.id === q.owner);
        if (!owner || owner.team === me.team) continue;
        const x = q.x * sx, y = q.z * sz;
        g.strokeStyle = TEAMS[owner.team].css;
        g.lineWidth = 1.8;
        g.beginPath();
        g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y);
        g.closePath();
        g.stroke();
      }
    }
  }

  // Built on first use per map size; afterwards a jammed frame is a single drawImage.
  #staticFrames() {
    const W = this.mmCanvas.width, H = this.mmCanvas.height;
    if (this.staticSet?.w === W && this.staticSet.h === H) return this.staticSet.frames;
    const frames = [];
    for (let f = 0; f < STATIC_FRAMES; f++) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.globalAlpha = 0.55;
      g.drawImage(this.mmBase, 0, 0);
      g.globalAlpha = 1;
      const img = g.getImageData(0, 0, W, H), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.random() < 0.5) continue;
        const v = 60 + Math.random() * 170;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      g.putImageData(img, 0, 0);
      g.fillStyle = 'rgba(29,35,43,.35)';
      for (let y = f; y < H; y += 6) g.fillRect(0, y, W, 2);
      frames.push(c);
    }
    this.staticSet = { w: W, h: H, frames };
    return frames;
  }

  #drawSelf(g, me, sx, sz) {
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
      const sx = (nx * 0.5 + 0.5) * W, sy = (0.5 - ny * 0.5) * H;
      const dx = sx - W / 2, dy = sy - H / 2;
      const s = this.safe;
      const minX = (s?.left ?? 0) + MARK_PAD_X, maxX = W - (s?.right ?? 0) - MARK_PAD_X;
      const minY = (s?.top ?? 0) + MARK_PAD_T, maxY = H - (s?.bottom ?? 0) - MARK_PAD_B;
      let off = sx < minX || sx > maxX || sy < minY || sy > maxY;
      let edge = 1;
      if (off) {
        const kx = dx > 0 ? (maxX - W / 2) / dx : dx < 0 ? (minX - W / 2) / dx : Infinity;
        const ky = dy > 0 ? (maxY - H / 2) / dy : dy < 0 ? (minY - H / 2) / dy : Infinity;
        edge = Math.min(kx, ky);
      }
      // Walk toward the centre along the same line until clear of the buttons, the minimap and the corner chips,
      // so the marker still points the right way.
      for (let step = 0; step < 18 && edge > 0.1 && this.#markBlocked(W / 2 + dx * edge, H / 2 + dy * edge); step++) {
        edge -= MARK_WALK;
        off = true;
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

// The firing range's live numbers, read from the sim's own tracker (view.range).
class RangeReadout {
  constructor(root) {
    this.panel = root.querySelector('.range-panel');
    this.leave = root.querySelector('.range-leave');
    this.nodes = Object.fromEntries(['dps', 'peak', 'ttk', 'best', 'acc', 'last', 'model'].map(k => [k, root.querySelector(`.rp-${k}`)]));
    root.querySelector('.rp-reset').addEventListener('click', () => this.onReset?.());
    this.clock = 0;
    this.active = false;
  }

  prepare(active) {
    this.active = active;
    this.panel.hidden = !active;
    this.leave.hidden = !active;
    this.clock = Infinity;           // First frame paints at once.
  }

  update(r, dt) {
    if (!this.active || !r) return;
    this.clock += dt;
    if (this.clock < 1 / RANGE_HZ) return;
    this.clock = 0;
    const n = this.nodes;
    const set = (el, text) => { if (el.textContent !== text) el.textContent = text; };
    const secs = t => (t === null || t === undefined ? '--' : `${t.toFixed(2)}s`);
    set(n.dps, String(Math.round(r.dps)));
    set(n.peak, String(Math.round(r.peakDps)));
    set(n.ttk, secs(r.lastTtk));
    set(n.best, secs(r.bestTtk));
    set(n.acc, r.shots ? `${Math.round(r.accuracy * 100)}%` : '--');
    set(n.last, r.lastDamage ? `${Math.round(r.lastDamage)}${r.lastHead ? ' HS' : ''} @ ${Math.round(r.lastDist)}m` : '--');
    set(n.model, r.model ? `${Math.round(r.model.dps)} DPS / ${r.model.ttk.toFixed(2)}s on paper` : '');
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
