// In-match overlay. Built once; update() runs every frame and touches the DOM only when a displayed value
// actually changes, and then only with text, a transform or a class flip.
import { TEAMS, MAX_HP, SCORE_LIMIT, PRIMARY_IDS, TIME_LIMIT } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { MAPS, DEFAULT_MAP } from '../shared/map.js';
import { hasLineOfSight } from '../shared/geometry.js';
import { getCamo } from '../shared/camos.js';
import { Progress } from './progress.js';

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
const UAV_KILLS = 3, STRIKE_KILLS = 5;
const END_BANNER_MIN = 700;

const MEDALS = {
  first_blood: ['First Blood', 'Round opener'], double: ['Double Kill', '2 in quick order'], triple: ['Triple Kill', '3 in quick order'],
  fury: ['Fury Kill', '4 or more'], revenge: ['Revenge', 'Settled the score'], longshot: ['Longshot', 'From across the yard'],
  streak3: ['Three Streak', 'UAV earned'], streak5: ['Five Streak', 'Strike earned'], streak10: ['Ten Streak', 'Unbroken'],
};

const pad2 = n => (n < 10 ? '0' + n : '' + n);
const weaponName = id => WEAPONS[id]?.name ?? (id === 'strike' ? 'Strike' : id ?? '');

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
    this.#build();
    this.#drawMapBase();
    this.reset();
  }

  // Controls paints the streak and reload buttons so there is a single touch surface.
  bindControls(controls) {
    this.controls = controls;
  }

  // Call before each match.
  prepare({ mapId = DEFAULT_MAP, scoreLimit = SCORE_LIMIT, timeLimit = TIME_LIMIT } = {}) {
    this.map = MAPS[mapId] ?? this.map;
    this.scoreLimit = scoreLimit;
    this.timeLimit = timeLimit;
    this.primary = Progress.primary;
    this.#drawMapBase();
    this.reset();
  }

  reset() {
    // Cached display values. NaN and '' can never equal a real value, so the first update writes everything.
    this.cache = {
      myScore: NaN, otherScore: NaN, teamFlip: NaN, time: NaN, phase: '', hp: NaN, hpFrac: NaN, ammo: NaN, reserve: NaN,
      weapon: '', reloadFrac: NaN, reloadOn: null, low: null, hurt: null, vign: NaN, dead: null, respawn: NaN,
      streakKey: '', urgent: null, protect: null, picked: '', enemyUav: null,
    };
    this.view = null;
    this.unlocks = [];            // Camos earned this match, drained by the results screen.
    this.mmClock = 0;
    this.hitT = 0;
    this.hitKill = false;
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
    this.setNotice('');
    this.setSpectate(null);
    this.#paintPicker();
  }

  setVisible(on) {
    this.el.classList.toggle('on', on);
  }

  // cb({ primary, camo }) when the player picks a different weapon on the death screen.
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
      <div class="scorebar">
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
      <div class="hit"><svg viewBox="-20 -20 40 40" aria-hidden="true"><path d="M-14 -14l9 9M14 -14l-9 9M-14 14l9 -9M14 14l-9 -9" /></svg></div>
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
          <div class="arms-name"><span></span></div>
          <div class="arms-count"><b class="ammo">30</b><span class="reserve">/150</span></div>
          <i class="reload-track"><i class="reload-fill"></i></i>
        </div>
      </div>
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
        </div>
      </div>
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
      pick.addEventListener('click', () => this.#choose(pick.dataset.weapon));
    }
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
      if (view.phase === 'ended' && !this.endShown) this.#showEndBanner(view.winner, myTeam);
    }

    this.#updateVitals(me, c, view);
    this.#updateArms(me, c);
    this.#updateStreak(me, c);
    this.#updateDeath(me, c, view);
    this.#decayEffects(dt);
    this.#tickFeed(dt);
    this.#tickMedals(dt);

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
    const low = !reloading && me.ammo <= Math.ceil((c.magazine ?? 30) * LOW_AMMO);
    if (low !== c.low) {
      c.low = low;
      this.arms.classList.toggle('low', low);
      this.controls?.setReloadUrgent(low);
    }
  }

  #updateStreak(me, c) {
    const key = me.streakReady ?? `n${me.streak >= UAV_KILLS ? me.streak % STRIKE_KILLS : me.streak}`;
    if (key === c.streakKey) return;
    c.streakKey = key;
    if (me.streakReady) {
      this.controls?.setStreak(me.streakReady);
      return;
    }
    const kills = me.streak ?? 0;
    const need = kills < UAV_KILLS ? UAV_KILLS : STRIKE_KILLS;
    this.controls?.setStreak(null, `${Math.min(kills, need)}/${need}`);
  }

  #updateDeath(me, c, view) {
    const dead = !me.alive && view.phase === 'live';
    if (dead !== c.dead) {
      c.dead = dead;
      this.deathEl.classList.toggle('show', dead);
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
      const f = this.hitT / HIT_LIFE;
      this.hitEl.style.opacity = f;
      this.hitEl.style.transform = `translate3d(-50%,-50%,0) scale(${1 + (1 - f) * 0.35})`;
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
        default: break;
      }
    }
  }

  #onHit(e) {
    const localId = this.view?.localId;
    if (e.by === localId) {
      this.hitT = HIT_LIFE;
      if (this.hitKill !== e.killed) {
        this.hitKill = !!e.killed;
        this.hitEl.classList.toggle('kill', this.hitKill);
      }
    }
    if (e.target === localId && e.by !== localId) this.#damageFrom(e);
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
    this.#pushFeed(`<em style="color:${byCss}">${esc(byName)}</em><span class="f-w">${esc(weaponName(e.weapon))}</span><em style="color:${tgtCss}">${esc(tgtName)}</em>`, mine);

    if (e.target === view.localId) {
      this.killer = { name: byName, color: byCss, weapon: weaponName(e.weapon) };
      this.deathPainted = false;
    }
    if (e.by === view.localId && e.target !== view.localId && !e.streak && WEAPONS[e.weapon]) {
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
    const verb = e.kind === 'uav' ? 'UAV online' : 'Strike inbound';
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

  #stamp(id) {
    const [title, sub] = MEDALS[id] ?? [String(id).replace(/_/g, ' '), ''];
    const node = document.createElement('div');
    node.className = `medal${id === 'first_blood' || id === 'streak5' || id === 'streak10' ? ' big' : ''}`;
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

    for (const p of view.players) {
      if (!p.alive || p.id === me.id) continue;
      const friendly = p.team === myTeam;
      if (!friendly && !myUav && !(me.alive && hasLineOfSight(this.map, me.x, me.z, p.x, p.z))) continue;
      const x = p.x * sx, y = p.z * sz;
      if (friendly) {
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
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
