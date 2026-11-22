// Conquest and Breakthrough on the HUD (ROADMAP 65, docs/MODES.md "Conquest and Breakthrough"). The mode layer
// (js/ui/mode-hud.js) owns one and paints the status plate itself (ticket bars, the sector); this adds:
//
//   deploy   Conquest's death screen row: Auto (the front), HQ, or any flag your side holds; the pick goes to the host
//            ({cmd:'bf', act:'deploy', at}) and stays for later lives
//   oob      the out-of-bounds plate and its countdown ("Fall back" for defenders behind a fallen line)
//   minimap  the HQs, Breakthrough's front lines and the ground each side has given up, the area's edge; on a part of a
//            battle royale island the minimap frames that part (miniWindow / drawMiniBase, as the campaign's does)
//   events   banners and feed lines for flags, sectors, tickets and overtime
import { BF, bfLayout, lineSegment } from '../shared/bf.js';
import { TEAMS } from '../shared/constants.js';
import { esc } from './widgets.js';

const MAP_PX = 640;
const CSS = `
.bf-tk { position: relative; display: inline-flex; align-items: center; width: 74px; height: 18px; margin-left: 6px; background: rgba(231,234,228,.12); overflow: hidden;
  clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%); }
.bf-tk i { position: absolute; inset: 0; transform-origin: left; transform: scaleX(var(--k, 1)); background: var(--c, var(--c-sodium)); opacity: .85; transition: transform .4s; }
.bf-tk b { position: relative; width: 100%; text-align: center; font: 400 14px/1 var(--f-stencil); color: #fff; text-shadow: 0 1px 2px #000; font-variant-numeric: tabular-nums; }
.bf-tk.mine { --c: var(--my-team, #38b6ff); }
.bf-tk.enemy { --c: var(--enemy-team, #ff4d3d); }
.hud.mh-on.bf-on .obj-strip { display: flex !important; }
.hud.bf-on .o-chip.bf-gone { display: none; }
.bf-oob { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 8px 22px 9px; background: rgba(60,10,8,.82); box-shadow: var(--hud-edge), inset 0 -2px 0 #ff4d3d; pointer-events: none; z-index: var(--z-hud-alert, 30);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); }
.bf-oob[hidden], .bf-deploy[hidden] { display: none; }
.bf-oob b { font: 400 20px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: #fff; }
.bf-oob .n { font: 400 34px/1 var(--f-stencil); color: #ff8a7c; font-variant-numeric: tabular-nums; }
.bf-oob small { font: 11px/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-chalk); }
.bf-deploy { order: -2; display: flex; align-items: center; gap: 5px; pointer-events: auto; padding: 3px 6px; background: rgba(16,20,26,.86); box-shadow: var(--hud-edge);
  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); max-width: 100%; overflow-x: auto; }
.bf-deploy > small { font: 10px/1.1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); text-transform: uppercase; margin-right: 2px; }
.bf-dep { flex: none; min-width: 40px; height: 34px; padding: 0 7px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  border: 0; color: var(--c-chalk); background: rgba(231,234,228,.08); box-shadow: inset 0 -3px 0 var(--c, rgba(231,234,228,.25)); touch-action: manipulation; }
.bf-dep b { font: 400 16px/1 var(--f-stencil); }
.bf-dep small { font: 9px/1 var(--f-plate); letter-spacing: var(--tr-plate); opacity: .8; max-width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bf-dep.mine { --c: var(--my-team, #38b6ff); }
.bf-dep.on { background: color-mix(in srgb, var(--c, var(--c-sodium)) 45%, rgba(16,20,26,.9)); color: #fff; outline: 2px solid var(--c-sodium); outline-offset: -2px; }
.bf-dep:disabled { opacity: .35; }
`;

const clockOf = s => `${Math.max(0, Math.ceil(s))}`;

export class BfHud {
  constructor(mh) {
    this.mh = mh;
    this.hud = mh.hud;
    this.on = false;
    this.layout = null;
    this.choice = 'auto';
    this.cmd = null;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.oob = document.createElement('div');
    this.oob.className = 'bf-oob';
    this.oob.hidden = true;
    this.oob.innerHTML = '<b></b><span class="n"></span><small></small>';
    this.hud.el.appendChild(this.oob);
    this.dep = document.createElement('div');
    this.dep.className = 'bf-deploy';
    this.dep.hidden = true;
    this.dep.setAttribute('role', 'group');
    this.dep.setAttribute('aria-label', 'Deploy at');
    // First in the death column (above the Next life line): the top half, clear of the thumbs.
    const col = this.hud.el.querySelector('.death-col');
    (col ?? this.hud.el).prepend(this.dep);
    this.dep.addEventListener('click', e => {
      const b = e.target.closest('.bf-dep');
      if (!b || b.disabled) return;
      e.stopPropagation();
      this.#pick(b.dataset.at);
    });
    this.cache = {};
    this.base = null;
  }

  onCommand(cb) { this.cmd = cb; }

  prepare(rules, map, seed) {
    this.rules = rules;
    this.on = rules === 'cq' || rules === 'bt';
    this.map = map;
    this.layout = this.on && map ? bfLayout(map, rules === 'cq' ? 'conquest' : 'breakthrough', seed) : null;
    this.base = null;
    this.cache = {};
    this.wasAlive = true;
    this.choice = 'auto';
    this.oob.hidden = true;
    this.dep.hidden = true;
    if (this.rules === 'cq' && this.layout) {
      const flags = this.layout.flags.map(f => `<button class="bf-dep" type="button" data-tap="1" data-sound="tab" data-at="${esc(f.id)}"><b>${esc(f.id)}</b>${f.name ? `<small>${esc(f.name)}</small>` : ''}</button>`).join('');
      this.dep.innerHTML = `<small>Deploy</small><button class="bf-dep on" type="button" data-tap="1" data-sound="tab" data-at="auto"><b>Auto</b><small>The front</small></button>`
        + `<button class="bf-dep mine" type="button" data-tap="1" data-sound="tab" data-at="hq"><b>HQ</b><small>Safe</small></button>${flags}`;
      this.btns = [...this.dep.querySelectorAll('.bf-dep')];
    } else {
      this.dep.innerHTML = '';
      this.btns = [];
    }
  }

  chips() { return this.rules === 'cq' ? this.layout?.flags.length ?? 5 : 2; }

  idle() {
    if (!this.oob.hidden) this.oob.hidden = true;
    if (!this.dep.hidden) this.dep.hidden = true;
  }

  #pick(at) {
    this.choice = at;
    this.cache.dep = null;
    this.cmd?.('deploy', { at: at === 'auto' ? null : at });
  }

  // The scoreLimit is a percentage of the layout's pools (js/shared/modes.js), the timeLimit Breakthrough's sector clock.
  rulesLine(minutes) {
    const l = this.layout, k = (this.hud.scoreLimit ?? 100) / 100;
    if (!l) return null;
    if (this.rules === 'cq') return `${Math.max(20, Math.round(l.tickets * k))} tickets<i></i>${l.flags.length} flags<i></i>${minutes} min`;
    const clock = Math.round((l.clock ?? 300) * (this.hud.timeLimit ?? 300) / 300);
    void minutes;
    return `${l.sectors.length} sectors<i></i>${Math.max(10, Math.round(l.tickets * k))} attacker tickets<i></i>${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')} a sector`;
  }

  update(view, me, o) {
    // Out of bounds: the countdown over everything.
    const out = me.alive && me.oob != null && view.phase === 'live';
    const fall = out && this.rules === 'bt' && me.team !== o.att && me.oob > BF.oob + 0.05;
    const key = out ? `${fall}|${clockOf(me.oob)}` : '';
    if (key !== this.cache.oob) {
      this.cache.oob = key;
      this.oob.hidden = !out;
      if (out) {
        this.oob.querySelector('b').textContent = fall ? 'Fall back' : 'Return to the battle';
        this.oob.querySelector('.n').textContent = clockOf(me.oob);
        this.oob.querySelector('small').textContent = fall ? 'The sector has fallen' : 'Out of bounds';
      }
    }
    // Conquest's deploy row while dead. The pick goes again with each death, in case a new host took over.
    if (this.rules !== 'cq') return;
    const dead = !me.alive && view.phase === 'live';
    if (dead && this.wasAlive && this.choice !== 'auto') this.cmd?.('deploy', { at: this.choice });
    this.wasAlive = !dead;
    if (this.dep.hidden !== !dead) this.dep.hidden = !dead;
    if (!dead) return;
    const pts = view.points ?? [];
    let k = this.choice;
    for (const pt of pts) k += `${pt.owner}${pt.contested ? 1 : 0}${Math.abs(pt.capture) >= 0.99 ? 1 : 0}`;
    if (k === this.cache.dep) return;
    this.cache.dep = k;
    for (const b of this.btns) {
      const at = b.dataset.at, pt = pts.find(q => q.id === at);
      const ok = at === 'auto' || at === 'hq' || (pt && pt.owner === me.team && !pt.contested && Math.abs(pt.capture) >= 0.99);
      b.disabled = !ok;
      if (pt) b.className = `bf-dep${pt.owner === me.team ? ' mine' : ''}${at === this.choice ? ' on' : ''}`;
      else b.classList.toggle('on', at === this.choice);
      b.style.setProperty('--c', pt && pt.owner >= 0 && pt.owner !== me.team ? TEAMS[pt.owner]?.css ?? '' : '');
    }
    // A pick that is no longer held falls back to Auto on the host; say so here too.
    if (this.choice !== 'auto' && this.choice !== 'hq') {
      const pt = pts.find(q => q.id === this.choice);
      if (!pt || pt.owner !== me.team) this.btns.find(b => b.dataset.at === 'auto')?.classList.add('on');
    }
  }

  onEvent(e, view, me) {
    const hud = this.hud, ours = t => t === me.team;
    const name = id => this.layout?.flags?.find(f => f.id === id)?.name ?? null;
    const flag = id => (name(id) ? `${id} · ${name(id)}` : `Flag ${id}`);
    if (e.t === 'cq') {
      if (e.kind === 'capture') {
        hud.banner(ours(e.team) ? `${flag(e.id)} Captured` : `${flag(e.id)} Lost`, ours(e.team) ? 'Your side can spawn there' : 'Take it back', 1300, ours(e.team) ? 'mine' : 'enemy');
        hud.pushFeed(`<span class="f-note">${ours(e.team) ? 'captured' : 'lost'}</span><em>${esc(flag(e.id))}</em>`, false, ours(e.team) ? 'ally' : 'foe');
      } else if (e.kind === 'neutral') hud.pushFeed(`<em>${esc(flag(e.id))}</em><span class="f-note">neutralised</span>`, false, ours(e.team) ? 'ally' : 'foe');
      else if (e.kind === 'low') hud.banner(ours(e.team) ? 'Tickets Low' : 'Enemy Tickets Low', ours(e.team) ? 'Take flags or lose the match' : 'Finish them', 1800, ours(e.team) ? 'enemy' : 'mine');
      else if (e.kind === 'all') hud.banner(ours(e.team) ? 'All Flags Held' : 'They Hold Every Flag', ours(e.team) ? 'Their tickets are draining fast' : 'Your tickets are draining fast', 1600, ours(e.team) ? 'mine' : 'enemy');
      else if (e.kind === 'deploy' && e.who === me.id) hud.notify(`Deployed at ${flag(e.id)}`);
      return;
    }
    const att = this.layout && view.obj ? view.obj.att === me.team : false;
    const sectors = this.layout?.sectors ?? [];
    switch (e.kind) {
      case 'capture': hud.banner(`${e.id} Taken`, att ? 'Hold it and take the rest' : 'Take it back', 1300, att ? 'mine' : 'enemy'); break;
      case 'retake': hud.banner(`${e.id} Retaken`, att ? 'They took it back' : 'Hold the line', 1200, att ? 'enemy' : 'mine'); break;
      case 'neutral': hud.pushFeed(`<em>Objective ${esc(e.id)}</em><span class="f-note">neutralised</span>`, false, ours(e.team) ? 'ally' : 'foe'); break;
      case 'sector': {
        const next = sectors[e.sector]?.name ?? `Sector ${e.sector + 1}`;
        hud.banner(att ? 'Sector Taken' : 'Fall Back', att ? `On to ${next} · +${this.layout?.refill ?? ''} tickets` : `Regroup at ${next}`, 2000, att ? 'mine' : 'enemy');
        break;
      }
      case 'overtime': hud.banner('Overtime', att ? 'Stay on the objective' : 'Clear them off it', 1300, 'alert'); break;
      case 'low': hud.banner(att ? 'Tickets Low' : 'Their Tickets Are Low', att ? `${e.n} left. Make the push count` : 'Hold on', 1600, att ? 'enemy' : 'mine'); break;
      default: break;
    }
  }

  // ---- Minimap ----
  miniWindow(W, H) {
    const l = this.layout;
    if (!l?.sub || !this.map) return null;
    const a = l.area, span = Math.max(a.w, a.h * W / H) + 8, k = W / span, spanZ = H / k;
    return { k, ox: a.x + a.w / 2 - span / 2, oz: a.z + a.h / 2 - spanZ / 2, span, spanZ, W, H };
  }

  drawMiniBase(g, z) {
    const base = this.#mapBase(), s = MAP_PX / Math.max(this.map.width, this.map.height);
    g.fillStyle = '#1d242c'; g.fillRect(0, 0, z.W, z.H);
    g.drawImage(base, z.ox * s, z.oz * s, z.span * s, z.spanZ * s, 0, 0, z.W, z.H);
    g.fillStyle = 'rgba(10,13,17,.25)'; g.fillRect(0, 0, z.W, z.H);
  }

  #mapBase() {
    if (this.base) return this.base;
    const map = this.map, c = document.createElement('canvas');
    c.width = c.height = MAP_PX;
    const g = c.getContext('2d'), s = MAP_PX / Math.max(map.width, map.height);
    g.fillStyle = '#33402f'; g.fillRect(0, 0, MAP_PX, MAP_PX);
    for (const w of map.walls) {
      if (w.kind === 'border') continue;
      g.fillStyle = w.kind === 'water' ? '#2c4a54' : w.blocksVision ? '#b9b19a' : '#6f7660';
      g.fillRect(w.x * s, w.z * s, Math.max(1, w.w * s), Math.max(1, w.d * s));
    }
    const img = new Image();
    img.onload = () => { g.drawImage(img, 0, 0, MAP_PX, MAP_PX); g.fillStyle = 'rgba(10,13,17,.18)'; g.fillRect(0, 0, MAP_PX, MAP_PX); };
    img.onerror = () => {};
    if (!map.devMap) img.src = `assets/maps/${map.id}-overview.jpg`;
    return (this.base = c);
  }

  drawMini(g, view, me, sx, sz, t, o) {
    const l = this.layout;
    if (!l) return;
    const a = l.area;
    // Outside the area: dimmed, edged in red.
    if (l.sub) {
      g.save();
      g.fillStyle = 'rgba(8,10,14,.55)';
      g.beginPath();
      g.rect(-1e4, -1e4, 2e4, 2e4);
      g.rect(a.x * sx, a.z * sz, a.w * sx, a.h * sz);
      g.fill('evenodd');
      g.strokeStyle = 'rgba(255,90,70,.8)';
      g.lineWidth = 1.5;
      g.strokeRect(a.x * sx, a.z * sz, a.w * sx, a.h * sz);
      g.restore();
    }
    if (this.rules === 'bt') this.#drawLines(g, me, sx, sz, t, o);
    // HQs: a square with HQ in it, in the owning side's colour (Breakthrough: the attackers' start and the last stand).
    g.font = '400 9px "Railyard Stencil", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    l.hq.forEach((h, i) => {
      const team = this.rules === 'cq' ? i : i === 0 ? o.att : 1 - o.att;
      const x = h.x * sx, y = h.z * sz;
      g.fillStyle = 'rgba(16,20,26,.8)'; g.fillRect(x - 8, y - 6, 16, 12);
      g.strokeStyle = TEAMS[team]?.css ?? '#fff'; g.lineWidth = 1.5; g.strokeRect(x - 8, y - 6, 16, 12);
      g.fillStyle = '#fff'; g.fillText('HQ', x, y + 0.5);
    });
  }

  // Breakthrough: the line ahead of the attackers in the defenders' colour, the one behind in the attackers'; the
  // fallen ground and the ground not yet open washed in their colours, so each side sees where it may not go.
  #drawLines(g, me, sx, sz, t, o) {
    const l = this.layout, n = l.lines.length, i = Math.min(o.sector, l.sectors.length - 1);
    const att = TEAMS[o.att]?.css ?? '#38b6ff', def = TEAMS[1 - o.att]?.css ?? '#ff4d3d';
    // The strip of the area between two distances along the axis (null: on to the area's end), washed in a colour.
    const wash = (from, to, css) => {
      const { ox, oz, dx, dz } = l.axis, a = l.area, L = 1000, s0 = from ?? -L, s1 = to ?? L;
      const P = (s, k) => [(ox + dx * s - dz * k) * sx, (oz + dz * s + dx * k) * sz];
      g.save();
      g.beginPath(); g.rect(a.x * sx, a.z * sz, a.w * sx, a.h * sz); g.clip();
      g.fillStyle = css; g.globalAlpha = 0.16;
      g.beginPath();
      for (const [s, k] of [[s0, -L], [s0, L], [s1, L], [s1, -L]]) { const [x, y] = P(s, k); g.lineTo(x, y); }
      g.closePath(); g.fill();
      g.restore();
    };
    if (i > 0) wash(null, l.lines[i - 1], att);
    if (i < n) wash(l.lines[i], null, def);
    const line = (s, css, dash) => {
      const seg = lineSegment(l, s);
      if (!seg) return;
      g.strokeStyle = css; g.lineWidth = 2.5; g.setLineDash(dash);
      g.lineDashOffset = -t * 8;
      g.beginPath(); g.moveTo(seg[0] * sx, seg[1] * sz); g.lineTo(seg[2] * sx, seg[3] * sz); g.stroke();
      g.setLineDash([]);
    };
    if (i > 0) line(l.lines[i - 1], att, [6, 4]);
    if (i < n) line(l.lines[i], def, [6, 4]);
    void me;
  }
}
