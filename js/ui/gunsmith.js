// The gunsmith: one bench with the live gun and its stat bars, and a panel of tabs on the thumb side.
// Trying something never commits it. The preview and the bars follow the try; a second tap (or the button) fits it.
// The same goes for guns: browsing the rail only changes the bench, and Equip is the one thing that changes the loadout.
// Only the changed parts of the DOM are patched, so the canvas and its WebGL context stay put.
import { WEAPONS } from '../shared/weapons.js';
import { WEAPON_IDS } from '../shared/constants.js';
import { getCamo, TRACERS, KILL_EFFECTS } from '../shared/camos.js';
import { SLOTS, ATTACHMENTS, attachmentsFor, normalizeKit } from '../shared/attachments.js';
import { MAX_WEAPON_LEVEL, MAX_WEAPON_PRESTIGE, prestigeRewards, camoRequirement } from '../shared/progression.js';
import { Progress } from './progress.js';
import { esc, hex, swatchCss, ROMAN, SLOT_LABEL, levelRequirement } from './widgets.js';
import { compareStats, deltaText, weaponFacts, rangeStrip, RANGE_AXIS } from './gunstats.js';
import { CATEGORIES, categoryOf, gunsIn, slotOf, SLOT_NAME } from './armory.js';
import { prestigeWeaponNow, kindLabel } from './prestige.js';
import { ico, backButton } from './yard.js';
import { flash, pop, stagger } from './motion.js';

const STOCK = 'stock';

// The range strip under the facts: inline styles, so the bench needs no stylesheet change to carry it.
const RANGE_BOX = 'flex:none;padding:3px 8px 5px;background:rgba(29,35,43,.42)';
const pct = f => `${(f * 100).toFixed(1)}%`;
// Full damage solid, the fade as a gradient down to the floor's brightness, the floor dimmer out to the hard range,
// and empty track past it. Ticks every 10 m on a fixed axis so guns compare at a glance.
function rangeStripHtml(r) {
  const floor = 0.25 + 0.6 * r.minPct / 100;
  const hi = 'rgba(255,214,90,.95)', lo = `rgba(255,214,90,${floor.toFixed(2)})`;
  const seg = (a, b, bg) => b > a ? `<i style="position:absolute;top:0;bottom:0;left:${pct(a)};width:${pct(b - a)};background:${bg}"></i>` : '';
  let ticks = '';
  for (let m = 10; m < RANGE_AXIS; m += 10) ticks += `<i style="position:absolute;top:0;bottom:0;left:${pct(m / RANGE_AXIS)};width:1px;background:rgba(0,0,0,.35)"></i>`;
  const label = r.explosive
    ? `Full blast anywhere to ${Math.round(r.max)}m`
    : `100% to ${Math.round(r.full)}m, ${r.minPct}% by ${Math.round(r.fade)}m, ends ${Math.round(r.max)}m`;
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px"><small style="font-size:8px;color:var(--haze)">Damage by range</small><small style="font-size:9px;white-space:nowrap">${label}</small></div>`
    + `<div style="position:relative;height:6px;margin-top:2px;background:rgba(255,255,255,.08);border-radius:1px;overflow:hidden">`
    + seg(0, r.fullF, hi) + seg(r.fullF, r.fadeF, `linear-gradient(90deg,${hi},${lo})`) + seg(r.fadeF, r.maxF, lo)
    + `<i style="position:absolute;top:0;bottom:0;left:${pct(r.maxF)};width:2px;margin-left:-1px;background:#fff"></i>` + ticks + `</div>`;
}
const TABS = [['attach', 'Attach', 'optic'], ['camo', 'Camo', 'camo'], ['fx', 'Effects', 'new'], ['prestige', 'Prestige', 'prestige']];

export class Gunsmith {
  constructor(menu, { loadoutIndex = Progress.activeLoadout, weapon, onBack, onChange, onRename }) {
    this.menu = menu;
    this.index = loadoutIndex;
    this.onChange = onChange;
    this.onBack = onBack;
    this.onRename = onRename;
    this.weapon = weapon && Progress.isItemUnlocked('weapon', weapon) ? weapon : Progress.loadouts()[this.index].primary;
    this.cat = categoryOf(this.weapon);
    this.tab = 'attach';
    this.slot = 'optic';
    this.tryAtt = null;      // Attachment id or STOCK.
    this.tryCamo = null;
    this.tryFx = null;       // { kind:'tracer'|'killFx', id }
    this.bindActions();
    this.renderShell();
  }

  get loadout() { return Progress.loadouts()[this.index]; }
  get kit() { return attachmentsFor(this.loadout, this.weapon); }
  get name() { return WEAPONS[this.weapon]?.name ?? this.weapon; }

  bindActions() {
    this.menu.on({
      gsBack: () => this.onBack(),
      gsWeapon: ({ id }) => this.selectWeapon(id),
      gsCat: ({ cat }) => this.selectCategory(cat),
      gsEquip: () => this.equip(),
      gsTab: ({ tab }) => this.selectTab(tab),
      gsSlot: ({ slot }) => { this.slot = slot; this.tryAtt = null; this.renderPanel(); this.update(); },
      gsAtt: ({ id }) => this.tapAttachment(id),
      gsCamo: ({ id }) => this.tapCamo(id),
      gsFx: ({ kind, id }) => this.tapFx(kind, id),
      gsApply: () => this.apply(),
      gsPrestige: () => this.prestige(),
    });
  }

  selectCategory(cat) {
    if (cat === this.cat) return;
    this.cat = cat;
    this.renderRail();
    this.paintRail();
  }

  // Looking only: what is equipped is untouched until equip().
  selectWeapon(id) {
    if (id === this.weapon) return;
    if (!Progress.isItemUnlocked('weapon', id)) {
      this.menu.toast(`${WEAPONS[id]?.name ?? id}: ${levelRequirement(Progress.itemUnlockLevel('weapon', id))}`);
      return;
    }
    this.weapon = id;
    this.tryAtt = this.tryCamo = this.tryFx = null;
    if (!this.available(this.slot).length) this.slot = SLOTS.find(s => this.available(s).length) ?? 'optic';
    this.paintRail();
    this.renderStats();
    this.renderPanel();
    this.update();
  }

  equip() {
    const id = this.weapon;
    if (!Progress.isItemUnlocked('weapon', id) || this.isEquipped) return;
    Progress.updateLoadout(this.index, { [slotOf(id)]: id });
    this.onChange?.();
    this.paintRail();
    this.paintEquip();
    this.menu.toast(`${this.name} equipped`);
  }

  get isEquipped() { return this.loadout[slotOf(this.weapon)] === this.weapon; }

  selectTab(tab) {
    this.tab = tab;
    this.tryAtt = this.tryCamo = this.tryFx = null;
    this.paintTabs();
    this.renderPanel();
    this.update();
  }

  available(slot) {
    return Progress.attachments(this.weapon).filter(a => a.slot === slot);
  }

  tapAttachment(id) {
    if (this.tryAtt === id) { this.apply(); return; }
    this.tryAtt = id;
    this.paintPanelState();
    this.update();
  }

  tapCamo(id) {
    if (this.tryCamo === id) { this.apply(); return; }
    this.tryCamo = id;
    this.paintPanelState();
    this.update();
  }

  tapFx(kind, id) {
    if (this.tryFx?.kind === kind && this.tryFx.id === id) { this.apply(); return; }
    this.tryFx = { kind, id };
    this.paintPanelState();
    this.shootBenchEffect(kind, id);
    this.update();
  }

  // What's on the gun right now plus the part being tried, for the preview and comparison bars.
  // A locked part is shown too: seeing it is what makes it worth earning.
  previewKit() {
    if (this.tab !== 'attach' || this.tryAtt === null) return this.kit;
    const next = { ...this.kit };
    if (this.tryAtt === STOCK) delete next[this.slot];
    else next[this.slot] = this.tryAtt;
    return normalizeKit(this.weapon, next);
  }

  previewCamo() {
    return this.tab === 'camo' && this.tryCamo ? this.tryCamo : Progress.camo(this.weapon);
  }

  // Refreshes everything that follows from the current try.
  update() {
    const kit = this.previewKit(), camo = this.previewCamo();
    this.menu.previewShow(this.weapon, camo, kit);
    const c = getCamo(camo);
    this.titleName.textContent = this.name;
    this.titleCamo.textContent = c.name;
    this.paintEquip();
    this.paintFacts(kit);
    this.paintStats(kit);
    this.paintFoot();
    this.paintHead();
  }

  // ---- Applying tries ----
  apply() {
    if (this.tab === 'attach') this.applyAttachment();
    else if (this.tab === 'camo') this.applyCamo();
    else if (this.tab === 'fx') this.applyFx();
  }

  applyAttachment() {
    const id = this.tryAtt;
    if (id === null) return;
    const def = id === STOCK ? null : this.available(this.slot).find(a => a.id === id);
    if (def && !def.unlocked) { this.menu.toast(`${def.name}: reach weapon level ${def.unlockLevel}`); return; }
    const fitted = this.kit[this.slot];
    const target = def ? (fitted === id ? null : id) : null;
    if (!Progress.setAttachment(this.index, this.slot, target, this.weapon)) return;
    this.onChange?.();
    flash(this.benchEl, { color: 'var(--c-sodium-hi)', peak: 0.18 });
    this.tryAtt = null;
    this.paintPanelState();
    this.update();
  }

  applyCamo() {
    const id = this.tryCamo;
    if (id === null) return;
    if (!Progress.isUnlocked(this.weapon, id)) {
      this.menu.toast(`${getCamo(id).name}: ${camoRequirement(getCamo(id))}`);
      return;
    }
    Progress.setCamo(this.weapon, id);
    this.onChange?.();
    flash(this.benchEl, { color: 'var(--c-sodium-hi)', peak: 0.22 });
    this.tryCamo = null;
    this.paintPanelState();
    this.update();
  }

  applyFx() {
    const t = this.tryFx;
    if (!t) return;
    const ok = t.kind === 'tracer' ? Progress.setTracer(this.weapon, t.id) : Progress.setKillFx(this.weapon, t.id);
    if (!ok) {
      this.menu.toast('Locked: prestige this weapon to earn it');
      return;
    }
    this.onChange?.();
    this.tryFx = null;
    this.paintPanelState();
    this.update();
  }

  prestige() {
    if (!Progress.canPrestigeWeapon(this.weapon)) return;
    prestigeWeaponNow(this.menu, this.weapon, this.name, {
      mountGun: (node, weaponId) => this.menu.previewMount(node, weaponId, Progress.camo(weaponId), this.kit),
      onDone: () => {
        this.menu.previewMount(this.benchEl, this.weapon, Progress.camo(this.weapon), this.kit);
        this.renderPanel();
        this.update();
        this.paintRail();
      },
    });
  }

  // ---- Markup ----
  renderShell() {
    const m = this.menu;
    m.el.dataset.screen = 'gunsmith';
    m.el.innerHTML = `
      <header class="bar">
        ${backButton('gsBack', 'Done')}
        <h2 class="bar-title">Gunsmith</h2>
        <span class="hdr-tag gs-lo">${ico('loadout')}${esc(this.loadout.name)}</span>
        <div class="gs-lvl">
          <span class="gs-pchip"></span>
          <b class="gs-lvn"></b>
          <i class="xp"><i class="gs-xp"></i></i>
          <small class="gs-xpn"></small>
        </div>
      </header>
      <div class="gs enter">
        <div class="gs-weapons">
          <nav class="gs-cats">${CATEGORIES.map(c => `<button class="gs-cat" data-act="gsCat" data-cat="${c}">${ico(`cat:${c}`)}<b>${c}</b></button>`).join('')}</nav>
          <div class="gs-list"></div>
        </div>
        <div class="gs-bench">
          <div class="gs-view">
            <div class="gs-title"><b></b><small></small></div>
            <button class="btn gs-equip" data-act="gsEquip" data-sound="confirm">${ico('equip')}<b></b></button>
          </div>
          <div class="gs-stats"></div>
          <div class="gs-facts"></div>
          <div class="gs-range" style="${RANGE_BOX}"></div>
        </div>
        <div class="gs-panel">
          <nav class="gs-tabs">${TABS.map(([id, label, icon]) => `<button class="gs-tab" data-act="gsTab" data-tab="${id}" data-sound="tab">${ico(icon)}<b>${label}</b></button>`).join('')}</nav>
          <div class="gs-body"></div>
          <div class="gs-foot"></div>
        </div>
      </div>`;
    const $ = sel => m.el.querySelector(sel);
    this.benchEl = $('.gs-view');
    this.titleName = $('.gs-title b');
    this.titleCamo = $('.gs-title small');
    this.statsEl = $('.gs-stats');
    this.bodyEl = $('.gs-body');
    this.footEl = $('.gs-foot');
    this.lvnEl = $('.gs-lvn');
    this.xpEl = $('.gs-xp');
    this.xpnEl = $('.gs-xpn');
    this.pchip = $('.gs-pchip');
    this.listEl = $('.gs-list');
    this.catBtns = [...m.el.querySelectorAll('.gs-cat')];
    this.equipBtn = $('.gs-equip');
    this.factsEl = $('.gs-facts');
    this.rangeEl = $('.gs-range');
    this.tabs = [...m.el.querySelectorAll('.gs-tab')];
    m.previewMount(this.benchEl, this.weapon, Progress.camo(this.weapon), this.kit);
    this.renderRail();
    this.paintRail();
    this.paintTabs();
    this.renderStats();
    this.renderPanel();
    this.update();
    m.show();
    stagger(m.el.querySelectorAll('.gs-weapons, .gs-bench, .gs-panel'), 'up', { delay: 60, step: 50 });
  }

  // The guns of one category, each with its picture.
  renderRail() {
    const list = gunsIn(this.cat);
    this.listEl.style.setProperty('--rows', Math.max(3, list.length));
    this.listEl.innerHTML = list.map(id => {
      const open = Progress.isItemUnlocked('weapon', id);
      return `<button class="gs-w${open ? '' : ' locked'}" data-act="gsWeapon" data-id="${esc(id)}">
        <span class="gs-pic"><canvas class="gun-pic" data-gun="${esc(id)}"></canvas></span>
        <span class="gs-wt"><b>${esc(WEAPONS[id].name)}</b><small></small></span>
        ${open ? '' : `<em class="lock">${ico('lock')}</em>`}
      </button>`;
    }).join('');
    this.rail = [...this.listEl.querySelectorAll('.gs-w')];
    this.menu.paintGuns(this.listEl, this.resolveThumb);
    for (const b of this.catBtns) b.classList.toggle('on', b.dataset.cat === this.cat);
  }

  resolveThumb = id => ({ camo: Progress.camo(id), kit: attachmentsFor(this.loadout, id) });

  paintRail() {
    const primary = this.loadout.primary, secondary = this.loadout.secondary;
    for (const btn of this.rail) {
      const id = btn.dataset.id, open = Progress.isItemUnlocked('weapon', id);
      btn.classList.toggle('on', id === this.weapon);
      btn.classList.toggle('equipped', id === primary || id === secondary);
      btn.querySelector('small').textContent = open
        ? `Lv ${Progress.weaponLevel(id)}${Progress.weaponPrestige(id) ? ` (${ROMAN[Progress.weaponPrestige(id)]})` : ''}`
        : `Level ${Progress.itemUnlockLevel('weapon', id)}`;
    }
  }

  // The bench's one link to the loadout.
  paintEquip() {
    const b = this.equipBtn, on = this.isEquipped;
    b.disabled = on;
    b.classList.toggle('is-go', on);
    b.classList.toggle('is-primary', !on);
    const text = on ? `${SLOT_NAME[slotOf(this.weapon)]}: equipped` : `Equip ${SLOT_NAME[slotOf(this.weapon)]}`;
    if (b.querySelector('b').textContent !== text) b.querySelector('b').textContent = text;
  }

  paintFacts(kit) {
    const html = weaponFacts(this.weapon, kit).map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
    if (this.factsHtml !== html) this.factsEl.innerHTML = this.factsHtml = html;
    const strip = rangeStripHtml(rangeStrip(this.weapon, kit));
    if (this.rangeHtml !== strip) this.rangeEl.innerHTML = this.rangeHtml = strip;
  }

  paintTabs() {
    for (const t of this.tabs) t.classList.toggle('on', t.dataset.tab === this.tab);
  }

  paintHead() {
    const p = Progress.weaponProgress(this.weapon);
    this.lvnEl.textContent = `Lv ${p.level}`;
    this.xpEl.style.transform = `scaleX(${(p.maxed ? 1 : p.into / p.span).toFixed(3)})`;
    this.xpnEl.textContent = p.maxed ? 'Max' : `${Math.round(p.into)}/${p.span}`;
    this.pchip.textContent = p.prestige ? `Rank ${ROMAN[p.prestige]}` : '';
    this.pchip.hidden = !p.prestige;
  }

  // A fresh set of rows for this weapon; afterwards only their transforms and delta text change.
  renderStats() {
    const rows = compareStats(this.weapon, this.kit, this.kit);
    this.statsEl.innerHTML = rows.map(r => `
      <div class="stat" data-stat="${r.id}">
        <span>${esc(r.label)}</span>
        <i class="sb"><i class="sb-delta"></i><i class="sb-base"></i></i>
        <em></em>
      </div>`).join('');
    this.statNodes = rows.map(r => {
      const el = this.statsEl.querySelector(`[data-stat="${r.id}"]`);
      return { root: el, base: el.querySelector('.sb-base'), delta: el.querySelector('.sb-delta'), tag: el.querySelector('em') };
    });
  }

  paintStats(kit) {
    const rows = compareStats(this.weapon, this.kit, kit);
    rows.forEach((r, i) => {
      const n = this.statNodes[i];
      if (!n) return;
      const low = Math.min(r.base, r.next), high = Math.max(r.base, r.next);
      n.base.style.transform = `scaleX(${low.toFixed(3)})`;
      n.delta.style.transform = `scaleX(${high.toFixed(3)})`;
      const state = !r.changed ? '' : r.better ? 'up' : 'down';
      if (n.root.dataset.dir !== state) n.root.dataset.dir = state;
      const text = r.changed ? deltaText(r) : '';
      if (n.tag.textContent !== text) n.tag.textContent = text;
    });
  }

  renderPanel() {
    if (this.tab === 'attach') this.renderAttach();
    else if (this.tab === 'camo') this.renderCamos();
    else if (this.tab === 'fx') this.renderFx();
    else this.renderPrestige();
    this.paintPanelState();
  }

  renderAttach() {
    const kit = this.kit;
    this.bodyEl.innerHTML = `
      <div class="att-slots">
        ${SLOTS.map(s => {
          const opts = this.available(s);
          const fitted = kit[s] ? ATTACHMENTS[kit[s]].name : opts.length ? 'Stock' : 'None';
          return `<button class="att-slot${s === this.slot ? ' on' : ''}${kit[s] ? ' fitted' : ''}" data-act="gsSlot" data-slot="${s}" data-sound="tab" ${opts.length ? '' : 'disabled'}>${ico(s)}<span><small>${SLOT_LABEL[s]}</small><b>${esc(fitted)}</b></span></button>`;
        }).join('')}
      </div>
      <div class="att-opts">
        <button class="att-opt" data-act="gsAtt" data-id="${STOCK}"><b>Stock</b><em class="tag"></em></button>
        ${this.available(this.slot).map(a => `
          <button class="att-opt${a.unlocked ? '' : ' locked'}" data-act="gsAtt" data-id="${a.id}">
            <b>${esc(a.name)}</b>
            <em class="tag">${a.unlocked ? '' : `${ico('lock')}Level ${a.unlockLevel}`}</em>
          </button>`).join('')}
      </div>`;
  }

  renderCamos() {
    const w = this.weapon, chal = Progress.challenges(w);
    const list = Progress.camos(w).slice().sort((a, b) => a.camo.tier - b.camo.tier);
    this.bodyEl.innerHTML = `<div class="camos">${list.map(({ camo, unlocked }) => {
      const c = chal.find(x => x.camo === camo.id);
      const frac = c && !unlocked ? Math.min(1, c.value / c.goal) : 0;
      const tag = camo.prestige ? `<span class="p-tag">${ROMAN[camo.prestige]}</span>` : '';
      const count = c && !unlocked ? `<small class="ct">${c.value}/${c.goal}</small>` : '';
      return `<button class="tile${unlocked ? '' : ' locked'}" data-act="gsCamo" data-id="${camo.id}" aria-label="${esc(camo.name)}">
        <span class="tile-swatch" style="background:${swatchCss(camo)}"></span>
        ${tag}
        ${unlocked ? '' : `<span class="tile-lk">${ico('lock')}</span>`}
        ${count}
        ${c && !unlocked ? `<i class="tile-bar"><i style="transform:scaleX(${frac.toFixed(3)})"></i></i>` : ''}
      </button>`;
    }).join('')}</div>
    <div class="chal-strip">${this.challengeTracks(chal)}</div>`;
  }

  // One cell per challenge track: progress toward the next goal not yet met.
  challengeTracks(chal) {
    const tracks = [...new Set(chal.map(c => c.track))];
    return tracks.map(track => {
      const list = chal.filter(c => c.track === track);
      const next = list.find(c => !c.done);
      const done = list.filter(c => c.done).length;
      const frac = next ? next.value / next.goal : 1;
      return `<div class="chal">
        <span>${esc(list[0].label.replace('Equipment-free kills', 'Clean'))}</span>
        <i class="xp"><i style="transform:scaleX(${frac.toFixed(3)})"></i></i>
        <small>${next ? `${next.value}/${next.goal}` : 'Done'}<em>${done}/${list.length}</em></small>
      </div>`;
    }).join('');
  }

  renderFx() {
    const w = this.weapon;
    const grid = (kind, items) => `<div class="fx-grid">${items.map(({ item, unlocked }) => `
      <button class="fx${unlocked ? '' : ' locked'}" data-act="gsFx" data-kind="${kind}" data-id="${item.id}">
        <i class="fx-mark" style="${item.color !== undefined ? `--c:${hex(item.color)}` : ''}${item.cycle ? ';--spec:1' : ''}"></i>
        <b>${esc(item.name)}</b>
        ${item.prestige ? `<span class="p-tag">${ROMAN[item.prestige]}</span>` : ''}
      </button>`).join('')}</div>`;
    this.bodyEl.innerHTML = `
      <h4>Tracer</h4>${grid('tracer', Progress.tracers(w))}
      <h4>Kill effect</h4>${grid('killFx', Progress.killEffects(w))}`;
  }

  renderPrestige() {
    const w = this.weapon, cur = Progress.weaponPrestige(w), p = Progress.weaponProgress(w);
    const rows = Array.from({ length: MAX_WEAPON_PRESTIGE }, (_, i) => {
      const rank = i + 1, rewards = prestigeRewards(rank), got = cur >= rank;
      return `<div class="wp-rank${got ? ' got' : ''}${rank === cur + 1 ? ' next' : ''}">
        <span class="wp-num">${ROMAN[rank]}</span>
        <div class="wp-rewards">${rewards.map(r => {
          const camo = r.kind === 'camo' ? getCamo(r.id) : null;
          return `<span class="wp-rw" ${camo ? `style="--sw:${swatchCss(camo)}"` : ''}><small>${esc(kindLabel(r.kind))}</small>${esc(r.name)}</span>`;
        }).join('')}</div>
      </div>`;
    }).join('');
    const can = Progress.canPrestigeWeapon(w);
    this.bodyEl.innerHTML = `
      <h4>Cosmetic rewards <small>rank ${cur} of ${MAX_WEAPON_PRESTIGE}</small></h4>
      <div class="wp-ranks">${rows}</div>
      <p class="wp-note">${cur >= MAX_WEAPON_PRESTIGE ? 'This weapon has reached the top rank.' : can ? 'Reset this weapon to level 1 and earn the next rewards.' : `Reach weapon level ${MAX_WEAPON_LEVEL} to prestige. Now level ${p.level}.`}</p>`;
  }

  // Marks which option is fitted and which is being tried, without rebuilding the list.
  paintPanelState() {
    const body = this.bodyEl;
    if (this.tab === 'attach') {
      const kit = this.kit;
      for (const b of body.querySelectorAll('.att-opt')) {
        const id = b.dataset.id;
        const fitted = kit[this.slot] === id || (id === STOCK && !kit[this.slot]);
        b.classList.toggle('fitted', fitted);
        b.classList.toggle('trying', this.tryAtt === id);
      }
      for (const b of body.querySelectorAll('.att-slot')) {
        const s = b.dataset.slot;
        b.classList.toggle('on', s === this.slot);
        const name = kit[s] ? ATTACHMENTS[kit[s]].name : this.available(s).length ? 'Stock' : 'None';
        b.querySelector('b').textContent = name;
        b.classList.toggle('fitted', !!kit[s]);
      }
    } else if (this.tab === 'camo') {
      const fitted = Progress.camo(this.weapon);
      for (const b of body.querySelectorAll('.tile')) {
        b.classList.toggle('on', b.dataset.id === fitted);
        b.classList.toggle('trying', this.tryCamo === b.dataset.id);
      }
    } else if (this.tab === 'fx') {
      for (const b of body.querySelectorAll('.fx')) {
        const { kind, id } = b.dataset;
        const fitted = kind === 'tracer' ? Progress.tracer(this.weapon) : Progress.killFx(this.weapon);
        b.classList.toggle('on', id === fitted);
        b.classList.toggle('trying', this.tryFx?.kind === kind && this.tryFx.id === id);
      }
    }
  }

  // The panel's bottom strip: names the thing under the thumb and how to act on it.
  paintFoot() {
    const foot = this.footEl;
    let title = '', desc = '', action = '', enabled = false;
    if (this.tab === 'attach') {
      const kit = this.kit, id = this.tryAtt;
      if (id === null) {
        const name = kit[this.slot] ? ATTACHMENTS[kit[this.slot]].name : 'Stock';
        title = `${SLOT_LABEL[this.slot]}: ${name}`;
        desc = kit[this.slot] ? ATTACHMENTS[kit[this.slot]].desc : 'Tap an attachment to try it on the bench.';
      } else if (id === STOCK) {
        title = 'Stock';
        desc = `Run without a ${SLOT_LABEL[this.slot].toLowerCase()} attachment.`;
        if (kit[this.slot]) { action = 'Remove'; enabled = true; }
      } else {
        const def = this.available(this.slot).find(a => a.id === id);
        title = def.name;
        desc = def.desc;
        if (!def.unlocked) { action = `Level ${def.unlockLevel}`; enabled = false; }
        else if (kit[this.slot] === id) { action = 'Remove'; enabled = true; }
        else { action = 'Fit'; enabled = true; }
      }
    } else if (this.tab === 'camo') {
      const id = this.tryCamo;
      if (id === null) {
        const c = getCamo(Progress.camo(this.weapon)), all = Progress.challenges(this.weapon);
        const done = all.filter(x => x.done).length;
        title = c.name;
        desc = `Challenges ${done}/${all.length}. Finish them all for mastery camos.`;
      } else {
        const c = getCamo(id), locked = !Progress.isUnlocked(this.weapon, id);
        title = c.name;
        if (locked) {
          const ch = Progress.challenges(this.weapon).find(x => x.camo === id);
          desc = ch ? `${ch.value}/${ch.goal} ${ch.label}` : camoRequirement(c);
          action = 'Locked';
        } else if (Progress.camo(this.weapon) === id) {
          desc = 'Equipped on this weapon.';
        } else {
          desc = 'Tap again to apply.';
          action = 'Apply'; enabled = true;
        }
      }
    } else if (this.tab === 'fx') {
      const t = this.tryFx;
      if (!t) {
        title = 'Cosmetics';
        desc = 'Tracer and kill effect apply to this weapon only.';
      } else {
        const item = (t.kind === 'tracer' ? TRACERS : KILL_EFFECTS).find(i => i.id === t.id);
        title = item.name;
        const locked = (t.kind === 'tracer' ? Progress.tracers(this.weapon) : Progress.killEffects(this.weapon)).find(x => x.item.id === t.id && !x.unlocked);
        if (locked) { desc = `Weapon Prestige ${item.prestige} on this weapon`; action = 'Locked'; }
        else if ((t.kind === 'tracer' ? Progress.tracer(this.weapon) : Progress.killFx(this.weapon)) === t.id) desc = 'Equipped on this weapon.';
        else { desc = 'Tap again to apply.'; action = 'Apply'; enabled = true; }
      }
    } else {
      const w = this.weapon, cur = Progress.weaponPrestige(w), can = Progress.canPrestigeWeapon(w);
      title = can ? `Rank ${ROMAN[cur + 1]} ready` : cur >= MAX_WEAPON_PRESTIGE ? 'Top rank' : 'Prestige';
      desc = '';
      foot.innerHTML = `<div class="foot-text"><b>${esc(title)}</b></div><button class="btn is-primary" data-act="gsPrestige" data-sound="confirm" ${can ? '' : 'disabled'}>${ico('prestige')}<b>Prestige</b></button>`;
      return;
    }
    foot.innerHTML = `
      <div class="foot-text"><b>${esc(title)}</b><small>${esc(desc)}</small></div>
      ${action ? `<button class="btn ${enabled ? 'is-primary' : ''}" data-act="gsApply" data-sound="confirm" ${enabled ? '' : 'disabled'}>${ico(enabled ? (action === 'Remove' ? 'close' : 'check') : 'lock')}<b>${esc(action)}</b></button>` : ''}`;
  }

  // Bench effect: a streak of the tried tracer colour, or a ring for a kill effect, on transforms only.
  shootBenchEffect(kind, id) {
    const item = (kind === 'tracer' ? TRACERS : KILL_EFFECTS).find(i => i.id === id);
    const el = document.createElement('i');
    el.className = kind === 'tracer' ? 'bench-tracer' : 'bench-ring';
    if (item?.color !== undefined) el.style.setProperty('--c', hex(item.color));
    this.benchEl.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}
