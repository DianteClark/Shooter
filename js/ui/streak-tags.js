// Shooting scorestreaks down, taught on the HUD (roadmap 40). Enemy streaks that can be shot (aircraft: Wingman, Recon
// Drone, Chopper, Gunship, Cruise Missile, swarm drones; machines: Sentry, Rover, Aegis Dome emitter, Airdrop crate) get
// a tag while you aim at them, while they are close, or for a moment after you hit one: a ring round the thing itself,
// a health bar under it, its name and about how many of your hits it still takes. The first time you meet each kind, a
// callout says what brings it down. The hit markers and the shoot-down feed line and medal come from the HUD's own
// event handling (js/ui/hud.js, the sim's streak_hit and air_down events).
// The HUD makes one and calls update() every frame; nothing here allocates once warm, and writes happen on change.
import { STREAKS } from '../shared/catalog.js';
import { WEAPONS } from '../shared/weapons.js';
import { AIR_HP, AIR_Y, MACHINE_HP, hitsToDown } from '../sim/streaks-v9.js';
import { Progress } from './progress.js';

const CSS = `
.stags { position: absolute; inset: 0; pointer-events: none; z-index: var(--z-hud-alert); }
.stag { position: absolute; left: 0; top: 0; width: 0; height: 0; opacity: 0; will-change: transform, opacity; transition: opacity var(--dur-fast); }
.stag.on { opacity: 1; }
.stag .sg-ring { position: absolute; left: -24px; top: -24px; width: 48px; height: 48px; border-radius: 50%;
  box-shadow: inset 0 0 0 2px rgba(255,77,61,.75), 0 0 0 1px rgba(0,0,0,.45); }
.stag.aimed .sg-ring { box-shadow: inset 0 0 0 3px var(--c-red), 0 0 10px var(--c-red-glow), 0 0 0 1px rgba(0,0,0,.5); }
.stag .sg-ring::before, .stag .sg-ring::after { content: ''; position: absolute; left: 50%; top: -5px; width: 2px; height: 58px; margin-left: -1px; background:
  linear-gradient(var(--c-red) 0 8px, transparent 8px calc(100% - 8px), var(--c-red) calc(100% - 8px)); opacity: 0; }
.stag .sg-ring::after { transform: rotate(90deg); }
.stag.aimed .sg-ring::before, .stag.aimed .sg-ring::after { opacity: 1; }
.stag .sg-bar { position: absolute; left: -26px; top: 29px; width: 52px; height: 5px; background: rgba(16,20,26,.8); box-shadow: 0 0 0 1px rgba(0,0,0,.5); }
.stag .sg-bar i { position: absolute; inset: 0; background: var(--c-red); transform-origin: left center; will-change: transform; }
.stag .sg-name { position: absolute; left: -60px; top: 37px; width: 120px; text-align: center; font: 9px/1.15 var(--f-plate); letter-spacing: var(--tr-plate);
  color: #fff; text-shadow: var(--text-lift); text-transform: uppercase; white-space: nowrap; }
.stag .sg-name small { display: block; font-size: 9px; color: var(--c-sodium-hi, #ffd27a); text-transform: none; letter-spacing: 0; }
.stag.hit .sg-ring { animation: sg-hit .18s ease-out; }
@keyframes sg-hit { from { transform: scale(1.25); } to { transform: scale(1); } }
html[data-calm] .stag.hit .sg-ring { animation: none; }
@media (prefers-reduced-motion: reduce) { .stag.hit .sg-ring { animation: none; } }
`;

const TAG_MAX = 3;
const NEAR_M = 18;          // Closer than this an enemy streak is tagged whatever you aim at.
const AIM_M = 36;           // Aiming within AIM_CONE of one this far off tags it, ringed brighter.
const AIM_CONE = 0.32;      // Radians either side of your aim.
const HIT_KEEP_S = 2.5;     // A streak you hit stays tagged this long.
const MACHINE_Y = 0.9;
const HINT_DELAY_S = 0.6;   // A streak tagged this long gets its first-time callout (not one glimpsed in passing).

const nameOf = kind => kind === 'turret' ? 'Sentry' : kind === 'swarm' ? 'Swarm drone' : kind === 'crate' ? 'Airdrop crate'
  : kind === 'dome' ? 'Aegis Dome' : STREAKS[kind]?.name ?? kind;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
// What brings each kind down, for the first-time callout. Big aircraft are launcher work; the rest take a magazine.
const HEAVY = new Set(['gunship', 'chopper']);

export class StreakTags {
  constructor(hud) {
    this.hud = hud;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = this.el = document.createElement('div');
    el.className = 'stags';
    el.innerHTML = Array.from({ length: TAG_MAX }, () => '<div class="stag"><i class="sg-ring"></i><span class="sg-bar"><i></i></span><span class="sg-name"><b></b><small></small></span></div>').join('');
    hud.el.appendChild(el);
    this.tags = [...el.querySelectorAll('.stag')].map(node => ({ node, fill: node.querySelector('.sg-bar i'), name: node.querySelector('.sg-name b'), hits: node.querySelector('.sg-name small'),
      on: false, aimed: false, hpf: NaN, nameText: '', hitsText: '', x: NaN, y: NaN }));
    this.pick = [];
    this.pool = [];
    this.hits = [];          // Recent hits you landed: { kind, x, z, at, hpf }.
    this.seenAt = new Map(); // kind -> time first tagged this match, for the first-time callout.
    this.clock = 0;
    this.P = { x: 0, y: 0 };
  }

  reset() {
    this.hits.length = 0;
    this.seenAt.clear();
    for (const t of this.tags) if (t.on) { t.on = false; t.node.classList.remove('on'); }
  }

  // A streak_hit you landed: keep its target tagged and flash its ring.
  onHit(e) {
    const h = this.hits.find(q => q.kind === e.kind && Math.hypot(q.x - e.x, q.z - e.z) < 6) ?? (this.hits.length < 8 ? this.hits[this.hits.push({}) - 1] : this.hits[0]);
    h.kind = e.kind; h.x = e.x; h.z = e.z; h.at = this.clock; h.hpf = e.hpf; h.flash = true;
  }

  #recent(kind, x, z) {
    for (const h of this.hits) if (h.kind === kind && this.clock - h.at < HIT_KEEP_S && Math.hypot(h.x - x, h.z - z) < 8) return h;
    return null;
  }

  #candidate(kind, x, z, hpf, air, aimed, d) {
    const c = this.pool[this.pick.length] ??= {};
    c.kind = kind; c.x = x; c.z = z; c.hpf = hpf; c.air = air; c.aimed = aimed; c.d = d;
    this.pick.push(c);
  }

  update(view, me, dt) {
    this.clock += dt;
    const cam = this.hud.camera, pick = this.pick;
    pick.length = 0;
    if (cam && me?.alive && view.phase !== 'ended' && !document.body.classList.contains('killcam-on')) {
      const consider = (kind, x, z, hpf, air) => {
        const d = Math.hypot(x - me.x, z - me.z);
        const aimed = d <= AIM_M && Math.abs(wrap(Math.atan2(z - me.z, x - me.x) - (me.aim ?? 0))) <= AIM_CONE + Math.min(0.5, 1.2 / Math.max(1, d));
        const hit = this.#recent(kind, x, z);
        if (hit) hpf = Math.min(hpf, hit.hpf);
        if (d <= NEAR_M || aimed || hit) this.#candidate(kind, x, z, hpf, air, aimed, d);
      };
      const team = me.team;
      for (const g of view.gunships ?? []) if (g.team !== team && g.kind in AIR_HP) consider(g.kind, g.x, g.z, g.hpf ?? 1, true);
      for (const g of view.drones ?? []) if (g.team !== team && g.kind in AIR_HP) consider(g.kind, g.x, g.z, g.hpf ?? 1, true);
      for (const t of view.deploys ?? []) if (t.team !== team && t.kind in MACHINE_HP) consider(t.kind, t.x, t.z, t.maxHp ? t.hp / t.maxHp : 1, false);
      for (const t of view.turrets ?? []) if (t.team !== team) consider('turret', t.x, t.z, Math.min(1, t.hp / (t.maxHp || MACHINE_HP.turret)), false);
      pick.sort((a, b) => (b.aimed - a.aimed) || a.d - b.d);
    }
    const w = WEAPONS[me?.weapon] ?? null;
    const W = this.hud.viewW || innerWidth, H = this.hud.viewH || innerHeight;
    let n = 0;
    for (let i = 0; i < pick.length && n < TAG_MAX; i++) {
      const c = pick[i];
      const p = this.#project(cam, c.x, c.air ? AIR_Y[c.kind] ?? 3 : MACHINE_Y, c.z, W, H);
      if (!p) continue;
      const t = this.tags[n++];
      if (!t.on) { t.on = true; t.node.classList.add('on'); }
      if (!(Math.abs(p.x - t.x) <= 0.3 && Math.abs(p.y - t.y) <= 0.3)) {   // NaN at first: always written.
        t.x = p.x; t.y = p.y;
        t.node.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      }
      if (t.aimed !== c.aimed) { t.aimed = c.aimed; t.node.classList.toggle('aimed', c.aimed); }
      const hpf = Math.round(Math.max(0, Math.min(1, c.hpf)) * 50) / 50;
      if (hpf !== t.hpf) { t.hpf = hpf; t.fill.style.transform = `scaleX(${hpf})`; }
      const name = nameOf(c.kind);
      if (name !== t.nameText) { t.nameText = name; t.name.textContent = name; }
      const hp = (c.air ? AIR_HP[c.kind] : MACHINE_HP[c.kind]) * c.hpf;
      const left = hitsToDown(hp, w, c.air);
      const hitsText = left ? `${w?.explosive ? 'about ' : '~'}${left} hit${left === 1 ? '' : 's'}` : '';
      if (hitsText !== t.hitsText) { t.hitsText = hitsText; t.hits.textContent = hitsText; }
      const h = this.#recent(c.kind, c.x, c.z);
      if (h?.flash) {
        h.flash = false;
        t.node.classList.remove('hit');
        void t.node.offsetWidth;
        t.node.classList.add('hit');
      }
      this.#firstTime(c, w);
    }
    for (; n < TAG_MAX; n++) {
      const t = this.tags[n];
      if (t.on) { t.on = false; t.node.classList.remove('on', 'aimed'); t.aimed = false; }
    }
  }

  // Once per kind per profile: what brings it down, with this gun's numbers.
  #firstTime(c, w) {
    const flag = `shootHint_${c.kind}`;
    if (Progress.flag(flag)) return;
    const since = this.seenAt.get(c.kind);
    if (since === undefined) { this.seenAt.set(c.kind, this.clock); return; }
    if (this.clock - since < HINT_DELAY_S) return;
    Progress.setFlag(flag);
    const name = nameOf(c.kind);
    const full = c.air ? AIR_HP[c.kind] : MACHINE_HP[c.kind];
    const launcher = hitsToDown(full, WEAPONS.launcher, c.air);
    let text;
    if (c.air && HEAVY.has(c.kind)) text = `${name}: shoot it down. Launchers: ${launcher} hits`;
    else if (w && !w.explosive) text = `${name}: shoot it down, ${hitsToDown(full, w, c.air)} hits`;
    else text = `${name}: shoot it down, ${launcher} launcher hit${launcher === 1 ? '' : 's'}`;
    this.hud.callout(text);
  }

  #project(cam, x, y, z, W, H) {
    const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements, P = this.P;
    const vx = v[0] * x + v[4] * y + v[8] * z + v[12], vy = v[1] * x + v[5] * y + v[9] * z + v[13], vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    const ww = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
    if (ww <= 0.01) return null;
    P.x = ((p[0] * vx + p[8] * vz + p[12]) / ww * 0.5 + 0.5) * W;
    P.y = (0.5 - (p[5] * vy + p[9] * vz + p[13]) / ww * 0.5) * H;
    if (P.x < -30 || P.x > W + 30 || P.y < -30 || P.y > H + 30) return null;
    return P;
  }
}
