
// The gunsmith, in two views (V12, the owner's design):
//   pick   weapon classes as big tiles in a horizontal scroller across the top, that class's guns as big cards in a
//          vertical scroller below (picture, name, level, mastery progress). Both scroll natively (.scroll-x/.scroll-y).
//   bench  the picked gun: live preview, stat bars and facts on one side, a panel of tabs on the thumb side
//          (attachments by slot, camo, effects, mastery, prestige).
// Trying something never commits it. The preview and the bars follow the try; a second tap (or the button) fits it.
// The same goes for guns: opening one only changes the bench, and Equip is the one thing that changes the loadout.
// On the bench only the changed parts of the DOM are patched, so the canvas and its WebGL context stay put.
import { WEAPONS } from '../shared/weapons.js';
import { WEAPON_IDS } from '../shared/constants.js';
import { getCamo, TRACERS, KILL_EFFECTS } from '../shared/camos.js';
import { SLOTS, ATTACHMENTS, attachmentsFor, normalizeKit, attachmentDeltas, unlockLabel, LADDER_BASE } from '../shared/attachments.js';
import { MAX_WEAPON_LEVEL, MAX_WEAPON_PRESTIGE, prestigeRewards, camoRequirement, WEAPON_LADDER } from '../shared/progression.js';
import { Progress } from './progress.js';
import { esc, hex, swatchCss, ROMAN, SLOT_LABEL, levelRequirement, weaponLevelHtml } from './widgets.js';
import { compareStats, deltaText, weaponFacts, rangeStrip, RANGE_AXIS } from './gunstats.js';
import { CATEGORIES, categoryOf, gunsIn, slotOf, SLOT_NAME } from './armory.js';
import { prestigeWeaponNow, kindLabel } from './prestige.js';
import { ico, backButton } from './yard.js';
import { flash, pop, stagger } from './motion.js';
import { masteryBadge } from './mastery.js';
import { unlockSheet } from './unlocksheet.js';

const STOCK = 'stock';

// V11: the kind chip on a signature attachment or conversion kit, and what a lock asks for.
const KIND_LABEL = { sig: 'Signature', kit: 'Kit' };
const kindChip = a => (a.kind ? `<span class="kind ${a.kind}">${KIND_LABEL[a.kind]}</span>` : '');
function lockRequirement(level) {
  if (level <= LADDER_BASE) return `reach weapon level ${level}`;
  const tier = level - LADDER_BASE;
  return `mastery tier ${ROMAN[tier]}: ${WEAPON_LADDER[tier - 1]?.label ?? ''}`.replace(/: $/, '');
}
// "+20%", "-3" for whole numbers.
function deltaLabel(d) {
  if (d.whole) { const n = Math.round(d.to) - Math.round(d.from); return `${n > 0 ? '+' : ''}${n}`; }
  return `${d.pct > 0 ? '+' : ''}${Math.round(d.pct * 100)}%`;
}

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
// Class tiles say what the class is, in full.
const CLASS_NAME = { Assault: 'Assault Rifles', SMG: 'SMGs', Shotgun: 'Shotguns', LMG: 'LMGs', Marksman: 'Marksman Rifles', Sniper: 'Sniper Rifles', Pistol: 'Pistols', Launcher: 'Launchers', Melee: 'Melee' };
// A gun's road to mastery: its camo challenges plus the ladder past level 30, as steps done of all.
function masteryOf(id) {
  const chal = Progress.challenges(id), lad = Progress.weaponLadder(id);
  const done = chal.filter(c => c.done).length + lad.tier, of = chal.length + lad.count;
  return { done, of, f: of ? done / of : 0 };
}
// Brings a child of a native scroller into view without scrolling anything else (scrollIntoView can move the page).
function keepInView(sc, el, axis = 'y') {
  if (!sc || !el) return;
  const x = axis === 'x', pos = x ? el.offsetLeft : el.offsetTop, size = x ? el.offsetWidth : el.offsetHeight;
  const view = x ? sc.clientWidth : sc.clientHeight, at = x ? sc.scrollLeft : sc.scrollTop, pad = 8;
  let to = at;
  if (pos - pad < at) to = pos - pad;
  // Sideways the strip snaps to tile starts, so a tile off the right edge is brought to the left edge instead.
  else if (pos + size + pad > at + view) to = x ? pos - 4 : pos + size + pad - view;
  if (to !== at) { if (x) sc.scrollLeft = Math.max(0, to); else sc.scrollTop = Math.max(0, to); }
}
const TABS = [['attach', 'Attach', 'optic'], ['camo', 'Camo', 'camo'], ['fx', 'Effects', 'new'], ['mastery', 'Mastery', 'star'], ['prestige', 'Prestige', 'prestige']];
const REWARD_ICON = { xp: 'star', badge: 'star', card: 'flag', camos: 'camo' };

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
    // Opened on a gun (the loadout's Gunsmith button) it starts on that gun's bench; from the title, on the guns.
    this.view = weapon ? 'bench' : 'pick';
    this.bindActions();
    this.renderShell();
  }

  get loadout() { return Progress.loadouts()[this.index]; }
  get kit() { return Progress.kitFor(this.index, this.weapon); }
  get name() { return WEAPONS[this.weapon]?.name ?? this.weapon; }

  bindActions() {
    this.menu.on({
      gsBack: () => this.onBack(),
      gsPick: () => this.showPick(),
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
    for (const b of this.classTiles ?? []) b.classList.toggle('on', b.dataset.cat === cat);
    const tile = this.classTiles?.find(b => b.dataset.cat === cat);
    if (tile) keepInView(this.classesEl, tile, 'x');
    this.renderGuns();
    if (this.gunsEl) this.gunsEl.scrollTop = 0;
  }

  // Opens a gun's bench. Looking only: what is equipped is untouched until equip().
  selectWeapon(id) {
    if (!Progress.isItemUnlocked('weapon', id)) {
      unlockSheet(this.menu, 'weapon', id);
      return;
    }
    if (id !== this.weapon) {
      this.weapon = id;
      this.tryAtt = this.tryCamo = this.tryFx = null;
      if (!this.available(this.slot).length) this.slot = SLOTS.find(s => this.available(s).length) ?? 'optic';
    }
    this.view = 'bench';
    this.renderView();
  }

  showPick() {
    this.view = 'pick';
    this.cat = categoryOf(this.weapon);
    this.renderView();
  }

  equip() {
    const id = this.weapon;
    if (!Progress.isItemUnlocked('weapon', id) || this.isEquipped) return;
    Progress.updateLoadout(this.index, { [slotOf(id)]: id });
    this.onChange?.();
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
    if (def && !def.unlocked) { unlockSheet(this.menu, 'attachment', def.id, { weapon: this.weapon }); return; }
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
      unlockSheet(this.menu, 'camo', id, { weapon: this.weapon });
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
      unlockSheet(this.menu, t.kind, t.id, { weapon: this.weapon });
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
      },
    });
  }

  // ---- Markup ----
  renderShell() {
    this.menu.el.dataset.screen = 'gunsmith';
    this.renderView();
    this.menu.show();
  }

  renderView() {
    if (this.view === 'pick') this.renderPick();
    else this.renderBench();
  }

  header(back) {
    return `<header class="bar">
        ${back}
        <h2 class="bar-title">Gunsmith</h2>
        <span class="hdr-tag gs-lo">${ico('loadout')}<b class="t-clip">${esc(this.loadout.name)}</b></span>
        ${this.view === 'bench' ? '<button class="btn is-primary gs-done" data-act="gsBack" data-sound="confirm">' + ico('check') + '<b>Done</b></button>' : ''}
      </header>`;
  }

  // ---- Pick: classes across the top, that class's guns below ----
  renderPick() {
    const m = this.menu, lo = this.loadout;
    const held = new Set([lo.primary, lo.secondary]);
    m.el.innerHTML = `
      ${this.header(backButton('gsBack', 'Done'))}
      <div class="gs-pick">
        <nav class="gs-classes scroll-x" aria-label="Weapon classes">${CATEGORIES.map(c => {
          const guns = gunsIn(c), open = guns.filter(id => Progress.isItemUnlocked('weapon', id)).length;
          return `<button class="gs-class${c === this.cat ? ' on' : ''}" data-act="gsCat" data-cat="${c}" data-sound="tab">
            <span class="gs-cico">${ico(`cat:${c}`)}</span>
            <span class="gs-ctx"><b>${esc(CLASS_NAME[c] ?? c)}</b><small>${open === guns.length ? `${guns.length} ${guns.length === 1 ? 'gun' : 'guns'}` : `${open} of ${guns.length} open`}</small></span>
            ${guns.some(id => held.has(id)) ? '<i class="gs-held" title="In this loadout"></i>' : ''}
          </button>`;
        }).join('')}</nav>
        <div class="gs-guns scroll-y"></div>
        <div class="gs-gl" aria-hidden="true"></div>
      </div>`;
    const $ = sel => m.el.querySelector(sel);
    this.classesEl = $('.gs-classes');
    this.classTiles = [...m.el.querySelectorAll('.gs-class')];
    this.gunsEl = $('.gs-guns');
    // Gun pictures borrow the preview's GL context, which needs its canvas on the page: a hidden 2 px mount.
    m.previewMount($('.gs-gl'), this.weapon, Progress.camo(this.weapon), this.kit);
    this.renderGuns();
    const tile = this.classTiles.find(b => b.dataset.cat === this.cat);
    if (tile) keepInView(this.classesEl, tile, 'x');
    stagger(m.el.querySelectorAll('.gs-class'), 'right', { step: 25, max: 9 });
  }

  renderGuns() {
    const lo = this.loadout;
    const list = gunsIn(this.cat);
    this.gunsEl.innerHTML = list.map(id => {
      const open = Progress.isItemUnlocked('weapon', id);
      const slot = id === lo.primary ? 'Primary' : id === lo.secondary ? 'Secondary' : '';
      const ms = masteryOf(id);
      return `<button class="gs-gun${open ? '' : ' locked'}${id === this.weapon ? ' on' : ''}${slot ? ' equipped' : ''}" data-act="gsWeapon" data-id="${esc(id)}" ${open ? '' : 'data-sound="deny"'}>
        <span class="gs-pic"><canvas class="gun-pic" data-gun="${esc(id)}"></canvas>${slot ? `<em class="gs-eq">${slot}</em>` : ''}${open ? '' : `<em class="gs-lk">${ico('lock')}</em>`}</span>
        <span class="gs-gn"><b>${esc(WEAPONS[id].name)}</b></span>
        <span class="gs-gm"><span class="gs-glv">${open ? weaponLevelHtml(Progress.weaponLevel(id), Progress.weaponPrestige(id)) : `Level ${Progress.itemUnlockLevel('weapon', id)}`}</span><small>${open ? 'Mastery' : 'Locked'}</small><i class="m-bar"><i style="transform:scaleX(${open ? ms.f.toFixed(3) : 0})"></i></i><small class="gs-gmn">${open ? (ms.f >= 1 ? 'Done' : `${ms.done}/${ms.of}`) : ''}</small></span>
      </button>`;
    }).join('');
    this.menu.paintGuns(this.gunsEl, this.resolveThumb);
    stagger(this.gunsEl.querySelectorAll('.gs-gun'), 'up', { step: 30, max: 8 });
  }

  resolveThumb = id => ({ camo: Progress.camo(id), kit: Progress.kitFor(this.index, id) });

  // ---- Bench ----
  renderBench() {
    const m = this.menu;
    this.classTiles = null;
    this.gunsEl = this.classesEl = null;
    m.el.innerHTML = `
      ${this.header(backButton('gsPick', 'Guns'))}
      <div class="gs">
        <div class="gs-bench">
          <div class="gs-view">
            <div class="gs-vhead">
              <div class="gs-title"><b></b><small></small></div>
              <button class="btn gs-equip" data-act="gsEquip" data-sound="confirm">${ico('equip')}<b></b></button>
            </div>
            <span class="gs-lvl"><b class="gs-lvn"></b><i class="xp"><i class="gs-xp"></i></i><small class="gs-xpn"></small></span>
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
    this.titleName = $('.gs-title > b');
    this.titleCamo = $('.gs-title > small');
    this.statsEl = $('.gs-stats');
    this.bodyEl = $('.gs-body');
    this.footEl = $('.gs-foot');
    this.lvnEl = $('.gs-lvn');
    this.xpEl = $('.gs-xp');
    this.xpnEl = $('.gs-xpn');
    this.equipBtn = $('.gs-equip');
    this.factsEl = $('.gs-facts');
    this.rangeEl = $('.gs-range');
    this.factsHtml = this.rangeHtml = this.infoHtml = null;
    this.tabs = [...m.el.querySelectorAll('.gs-tab')];
    m.previewMount(this.benchEl, this.weapon, Progress.camo(this.weapon), this.kit);
    this.paintTabs();
    this.renderStats();
    this.renderPanel();
    this.update();
    stagger(m.el.querySelectorAll('.gs-bench, .gs-panel'), 'up', { delay: 40, step: 50 });
  }

  // The bench's one link to the loadout.
  paintEquip() {
    const b = this.equipBtn, on = this.isEquipped;
    b.disabled = on;
    b.classList.toggle('is-go', on);
    b.classList.toggle('is-primary', !on);
    const text = on ? 'Equipped' : `Equip ${SLOT_NAME[slotOf(this.weapon)]}`;
    b.title = `${SLOT_NAME[slotOf(this.weapon)]} in ${this.loadout.name}`;
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
    this.lvnEl.innerHTML = weaponLevelHtml(p.level, p.prestige);
    this.xpEl.style.transform = `scaleX(${(p.maxed ? 1 : p.into / p.span).toFixed(3)})`;
    this.xpnEl.textContent = p.maxed ? 'Max' : `${Math.round(p.into)}/${p.span}`;
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
    // Every tab but Attach scrolls as a whole; Attach scrolls its parts list alone, under fixed slots.
    this.bodyEl.classList.toggle('scroll-y', this.tab !== 'attach');
    this.bodyEl.scrollTop = 0;
    if (this.tab === 'attach') this.renderAttach();
    else if (this.tab === 'camo') this.renderCamos();
    else if (this.tab === 'fx') this.renderFx();
    else if (this.tab === 'mastery') this.renderMastery();
    else this.renderPrestige();
    this.paintPanelState();
  }

  // Slots down the left, that slot's parts in a native scroller beside them, and what the part under the thumb moves.
  renderAttach() {
    const kit = this.kit;
    this.shownOpt = null;
    this.bodyEl.innerHTML = `
      <div class="att-wrap">
        <div class="att-slots">
          ${SLOTS.map(s => {
            const opts = this.available(s);
            const fitted = kit[s] ? ATTACHMENTS[kit[s]].name : opts.length ? 'Stock' : 'None';
            return `<button class="att-slot${s === this.slot ? ' on' : ''}${kit[s] ? ' fitted' : ''}" data-act="gsSlot" data-slot="${s}" data-sound="tab" ${opts.length ? '' : 'disabled'}>${ico(s)}<span><small>${SLOT_LABEL[s]}</small><b>${esc(fitted)}</b></span></button>`;
          }).join('')}
        </div>
        <div class="att-opts scroll-y">
          <button class="att-opt" data-act="gsAtt" data-id="${STOCK}"><b>Stock</b><span class="att-sub"><em class="tag"></em></span></button>
          ${this.available(this.slot).map(a => `
            <button class="att-opt${a.unlocked ? '' : ' locked'}${a.kind ? ` is-${a.kind}` : ''}" data-act="gsAtt" data-id="${a.id}">
              <b>${esc(a.name)}</b>
              <span class="att-sub">${kindChip(a)}<em class="tag">${a.unlocked ? '' : `${ico('lock')}${unlockLabel(a.unlockLevel)}`}</em></span>
            </button>`).join('')}
        </div>
      </div>
      <div class="att-info"></div>`;
    this.infoEl = this.bodyEl.querySelector('.att-info');
    this.infoHtml = null;     // A fresh box: paintInfo must fill (or hide) it whatever the last one held.
    this.optsEl = this.bodyEl.querySelector('.att-opts');
  }

  // V11: what the part under the thumb (tried, else fitted) is for, and every number it moves on this gun.
  paintInfo() {
    if (this.tab !== 'attach' || !this.infoEl) return;
    const id = this.tryAtt === null ? this.kit[this.slot] ?? null : this.tryAtt === STOCK ? null : this.tryAtt;
    const a = id && ATTACHMENTS[id];
    let html = '';
    if (a) {
      const deltas = attachmentDeltas(WEAPONS[this.weapon], id);
      html = `<ul class="att-dl">${a.kind ? `<li class="kd">${kindChip(a)}</li>` : ''}${deltas.map(d => `<li class="${d.key === 'note' ? `note${d.better === true ? ' up' : d.better === false ? ' down' : ''}` : d.better ? 'up' : 'down'}">${esc(d.label)}${d.key === 'note' ? '' : ` <b>${deltaLabel(d)}</b>`}</li>`).join('')}</ul>`;
    }
    if (this.infoHtml !== html) { this.infoEl.innerHTML = this.infoHtml = html; this.infoEl.hidden = !html; }
  }

  renderCamos() {
    const w = this.weapon, chal = Progress.challenges(w);
    const list = Progress.camos(w).slice().sort((a, b) => a.camo.tier - b.camo.tier);
    this.bodyEl.innerHTML = `<div class="camos">${list.map(({ camo, unlocked }) => {
      const c = chal.find(x => x.camo === camo.id);
      const frac = c && !unlocked ? Math.min(1, c.value / c.goal) : 0;
      const tag = camo.prestige ? `<span class="p-tag">${ROMAN[camo.prestige]}</span>` : '';
      const count = c && !unlocked ? `<small class="ct">${c.value}/${c.goal}</small>` : '';
      // A face (the swatch, its lock, prestige tag and progress) over the camo's name, in a grid with real gaps.
      return `<button class="tile${unlocked ? '' : ' locked'}" data-act="gsCamo" data-id="${camo.id}" aria-label="${esc(camo.name)}">
        <span class="tile-face">
          <span class="tile-swatch" style="background:${swatchCss(camo)}"></span>
          ${tag}
          ${unlocked ? '' : `<span class="tile-lk">${ico('lock')}</span>`}
          ${count}
          ${c && !unlocked ? `<i class="tile-bar"><i style="transform:scaleX(${frac.toFixed(3)})"></i></i>` : ''}
        </span>
        <b class="tile-name">${esc(camo.name)}</b>
      </button>`;
    }).join('')}</div>
    <h4 class="chal-h">Camo challenges</h4>
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
        <small><b>${next ? `${next.value}/${next.goal}` : 'Done'}</b><em>${done}/${list.length} camos</em></small>
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

  // The ladder past level 30: five goals in order, what each pays, and the mastery camos at the end of it.
  renderMastery() {
    const st = Progress.weaponLadder(this.weapon), lv = Progress.weaponLevel(this.weapon);
    const chal = Progress.challenges(this.weapon), chalDone = chal.filter(c => c.done).length;
    this.bodyEl.innerHTML = `
      <h4>Mastery ladder <small>${st.open ? `tier ${st.tier} of ${st.count}` : `opens at level ${MAX_WEAPON_LEVEL}`}</small></h4>
      <div class="gs-ladder${st.open ? '' : ' locked'}">
        ${st.tiers.map((c, i) => {
          const parts = Progress.attachments(this.weapon).filter(a => a.unlockLevel === LADDER_BASE + i + 1);
          const state = c.done ? 'done' : st.open && i === st.tier ? 'now' : 'later';
          const f = c.done ? 1 : state === 'now' ? c.value / c.goal : 0;
          return `<div class="gl-row ${state}">
            <span class="gl-n">${ROMAN[i + 1]}</span>
            <span class="gl-goal"><b>${esc(c.label)}${parts.map(a => `<small class="gl-att">+ ${esc(a.name)}</small>`).join('')}</b><i class="m-bar"><i style="transform:scaleX(${f.toFixed(3)})"></i></i></span>
            <span class="gl-rw">${c.rewards.map(r => `<i title="${esc(r.name)}">${r.kind === 'badge' ? masteryBadge(this.weapon, Number(r.id.slice(-1)), { size: 16 }) : ico(REWARD_ICON[r.kind] ?? 'star')}</i>`).join('')}<small>${state === 'now' ? `${c.value}/${c.goal}` : c.done ? 'Done' : c.rewards.find(r => r.xp) ? `+${c.rewards.find(r => r.xp).xp.toLocaleString('en-US')}` : ''}</small></span>
          </div>`;
        }).join('')}
      </div>
      <p class="wp-note">${st.maxed ? (chalDone === chal.length ? 'Ladder done: the mastery camos are yours to earn.' : `Ladder done. Camo challenges ${chalDone}/${chal.length} open the mastery camos.`)
        : st.open ? 'Each tier counts only past level 30. The last one opens the mastery camos.' : `Reach level ${MAX_WEAPON_LEVEL} to start the ladder. Now level ${lv}.`}</p>`;
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
      this.paintInfo();
      for (const b of body.querySelectorAll('.att-opt')) {
        const id = b.dataset.id;
        const fitted = kit[this.slot] === id || (id === STOCK && !kit[this.slot]);
        b.classList.toggle('fitted', fitted);
        b.classList.toggle('trying', this.tryAtt === id);
      }
      // Keep the part under the thumb (tried, else fitted) in view in a list that scrolls.
      const cur = body.querySelector('.att-opt.trying') ?? body.querySelector('.att-opt.fitted');
      if (cur && cur.dataset.id !== this.shownOpt) { this.shownOpt = cur.dataset.id; keepInView(this.optsEl, cur); }
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
    let title = '', desc = '', action = '', enabled = false, locked = false;
    if (this.tab === 'attach') {
      const kit = this.kit, id = this.tryAtt;
      if (id === null) {
        const name = kit[this.slot] ? ATTACHMENTS[kit[this.slot]].name : 'Stock';
        const none = !SLOTS.some(sl => this.available(sl).length);
        title = none ? 'No attachments' : `${SLOT_LABEL[this.slot]}: ${name}`;
        desc = kit[this.slot] ? ATTACHMENTS[kit[this.slot]].for ?? ATTACHMENTS[kit[this.slot]].desc : none ? 'This weapon takes no attachments. Camos, effects and mastery still apply.' : 'Tap an attachment to try it on the bench.';
      } else if (id === STOCK) {
        title = 'Stock';
        desc = `Run without a ${SLOT_LABEL[this.slot].toLowerCase()} attachment.`;
        if (kit[this.slot]) { action = 'Remove'; enabled = true; }
      } else {
        const def = this.available(this.slot).find(a => a.id === id);
        title = def.name;
        desc = def.for ?? def.desc;
        if (!def.unlocked) { action = 'How to unlock'; locked = true; desc = `Locked: ${lockRequirement(def.unlockLevel)}.`; }
        else if (kit[this.slot] === id) { action = 'Remove'; enabled = true; }
        else { action = 'Fit'; enabled = true; }
      }
    } else if (this.tab === 'camo') {
      const id = this.tryCamo;
      if (id === null) {
        const c = getCamo(Progress.camo(this.weapon)), all = Progress.challenges(this.weapon);
        const done = all.filter(x => x.done).length;
        title = c.name;
        const lad = Progress.weaponLadder(this.weapon);
        desc = `Challenges ${done}/${all.length}, mastery ladder ${lad.tier}/${lad.count}. Both open the mastery camos.`;
      } else {
        const c = getCamo(id);
        locked = !Progress.isUnlocked(this.weapon, id);
        title = c.name;
        if (locked) {
          const ch = Progress.challenges(this.weapon).find(x => x.camo === id);
          desc = ch ? `${ch.value}/${ch.goal} ${ch.label}` : camoRequirement(c);
          action = 'How to unlock'; locked = true;
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
        locked = !!(t.kind === 'tracer' ? Progress.tracers(this.weapon) : Progress.killEffects(this.weapon)).find(x => x.item.id === t.id && !x.unlocked);
        if (locked) { desc = `Weapon Prestige ${item.prestige} on this weapon`; action = 'How to unlock'; }
        else if ((t.kind === 'tracer' ? Progress.tracer(this.weapon) : Progress.killFx(this.weapon)) === t.id) desc = 'Equipped on this weapon.';
        else { desc = 'Tap again to apply.'; action = 'Apply'; enabled = true; }
      }
    } else if (this.tab === 'mastery') {
      const st = Progress.weaponLadder(this.weapon);
      title = st.maxed ? 'Mastered' : st.open ? `Tier ${ROMAN[st.tier + 1]}: ${st.next.label}` : 'Mastery ladder';
      desc = st.maxed ? 'Every tier on this weapon is done.' : st.open ? `${st.next.value} of ${st.next.goal}` : `Opens at weapon level ${MAX_WEAPON_LEVEL}`;
    } else {
      const w = this.weapon, cur = Progress.weaponPrestige(w), can = Progress.canPrestigeWeapon(w);
      title = can ? `Rank ${ROMAN[cur + 1]} ready` : cur >= MAX_WEAPON_PRESTIGE ? 'Top rank' : 'Prestige';
      desc = '';
      foot.innerHTML = `<div class="foot-text"><b>${esc(title)}</b></div><button class="btn is-primary" data-act="gsPrestige" data-sound="confirm" ${can ? '' : 'disabled'}>${ico('prestige')}<b>Prestige</b></button>`;
      return;
    }
    foot.innerHTML = `
      <div class="foot-text"><b>${esc(title)}</b><small>${esc(desc)}</small></div>
      ${action ? `<button class="btn ${enabled ? 'is-primary' : ''}" data-act="gsApply" data-sound="${locked ? 'tap' : 'confirm'}" ${enabled || locked ? '' : 'disabled'}>${ico(enabled ? (action === 'Remove' ? 'close' : 'check') : 'lock')}<b>${esc(action)}</b></button>` : ''}`;
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
