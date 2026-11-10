// The Loadouts screen, laid out like a Call of Duty create-a-class: the five sets across the top, the primary as a large
// hero with its camo and attachments, and everything else in dense rows beside it. Guns open the Armory, a full panel with
// a category rail, a card with a real picture of every gun and a live preview; nothing changes until Equip.
import { TACTICALS, LETHALS, PERKS, PERK_TIERS, PRO, STREAKS, streakCost } from '../shared/catalog.js';
import { WEAPONS } from '../shared/weapons.js';
import { getCamo } from '../shared/camos.js';
import { SLOTS, ATTACHMENTS, attachmentsFor } from '../shared/attachments.js';
import { LOADOUT_COUNT } from '../shared/progression.js';
import { Progress } from './progress.js';
import { getOperator } from './operators.js';
import { esc, swatchCss, levelRequirement, SLOT_LABEL, itemMark, weaponLevelHtml } from './widgets.js';
import { statBars, weaponFacts } from './gunstats.js';
import { CATEGORIES, categoryOf, gunsIn, slotOf, SLOT_NAME } from './armory.js';
import { GOLDEN_ID, WEAPON_IDS } from '../shared/constants.js';
import { playUi } from '../audio/audio.js';
import { ico, backButton } from './yard.js';
import { stagger, flash, sweep, pop } from './motion.js';
import { cardHtml, cardsSheet } from './cards.js';

const HERO_STATS = ['damage', 'rate', 'range', 'aimed', 'recoil', 'move', 'reload'];

const GEAR = {
  tactical: { kind: 'tactical', title: 'Equipment', table: TACTICALS },
  lethal: { kind: 'lethal', title: 'Equipment', table: LETHALS },
  perks: { kind: 'perk', title: 'Perks', table: PERKS },
  streaks: { kind: 'streak', title: 'Scorestreaks', table: STREAKS, count: 3 },
};

const gunName = id => WEAPONS[id]?.name ?? id;
// A weapon's level with its prestige rank as a separate plate (widgets.weaponLevelHtml), so "Lv 14" and "I" never
// read as "Lv 141" or overlap.
const levelHtml = id => weaponLevelHtml(Progress.weaponLevel(id), Progress.weaponPrestige(id));
const owned = id => Progress.isItemUnlocked('weapon', id);
// What a locked gun asks for. The Golden Gun has no level: it asks for everything.
const lockText = id => (id === GOLDEN_ID ? 'Max everything to earn it' : levelRequirement(Progress.itemUnlockLevel('weapon', id)));
const GOLD = '#ffcf40';
// The Golden Gun's card in the armory grid: a gold edge and glow over the usual plate, locked or not.
const GOLD_CARD = `box-shadow:inset 0 0 0 2px ${GOLD},inset 0 -18px 30px -18px rgba(255,207,64,.55);`;

export class LoadoutsScreen {
  constructor(menu, { onBack, onChange, onGunsmith, onRename, onOperators }) {
    this.menu = menu;
    this.onChange = onChange;
    this.onGunsmith = onGunsmith;
    this.onRename = onRename;
    this.onOperators = onOperators;
    this.selected = menu.lastLoadoutIndex ?? Progress.activeLoadout;
    this.panel = null;        // { type:'armory', cat, browse } | { type:'gear', key, idx }
    this.entered = false;
    menu.on({
      loBack: () => { menu.lastLoadoutIndex = null; onBack(); },
      loPick: ({ i }) => { this.selected = Number(i); menu.lastLoadoutIndex = this.selected; this.render(); },
      loEquip: () => this.equip(),
      loGunsmith: () => this.onGunsmith(this.selected, this.loadout.primary),
      loOperators: () => this.onOperators(this.selected),
      loCards: () => cardsSheet(menu, { onChange: () => this.onChange?.(), onClose: () => this.render() }),
      loWeapon: ({ key }) => this.openArmory(key),
      loRename: () => this.onRename(this.selected),
      loSlot: ({ key, idx }) => this.openGear(key, Number(idx)),
      loChoose: ({ id, key }) => this.choose(key, id),
      loClose: () => this.closePanel(),
      goldEquip: () => this.#closeGolden(true),
      goldLater: () => this.#closeGolden(false),
      arCat: ({ cat }) => this.setCategory(cat),
      arBrowse: ({ id }) => this.browse(id),
      arEquip: () => this.equipBrowsed(),
      arGunsmith: () => this.onGunsmith(this.selected, this.panel.browse),
    });
    this.render();
    menu.show();
    // Earned since the armory last opened: the reveal plays once, over the screen it is being earned for.
    if (Progress.goldenPending()) setTimeout(() => this.#revealGolden(), 260);
  }

  /* ---------- The Golden Gun reveal ---------- */
  #revealGolden() {
    if (!Progress.goldenPending() || !this.menu.el.isConnected) return;
    Progress.markGoldenCelebrated();
    const w = WEAPONS[GOLDEN_ID];
    this.menu.overlay(`
      <div class="sheet slim gold-reveal" role="dialog" aria-label="Golden Gun unlocked" style="width:min(460px,100%);gap:10px;background:linear-gradient(170deg,#3a2f12,#17140c 70%);box-shadow:inset 0 0 0 2px ${GOLD},0 0 40px rgba(255,207,64,.35)">
        <small style="font:var(--fs-caption)/1 var(--f-plate);letter-spacing:var(--tr-plate);color:${GOLD}">Everything maxed</small>
        <h2 style="color:#fff4bf;text-shadow:0 0 18px rgba(255,207,64,.8)">${esc(w.name)} unlocked</h2>
        <div class="gold-view" style="position:relative;width:100%;height:140px;overflow:hidden"></div>
        <p style="font-size:var(--fs-body)">One round. Any body hit inside ${w.range} m is a kill. Long reload, no attachments, and cover stops it like any sidearm.</p>
        <div class="sheet-row" style="justify-content:center;width:100%">
          <button class="btn" data-act="goldLater">${ico('close')}<b>Later</b></button>
          <button class="btn is-primary" data-act="goldEquip" data-sound="confirm" style="background:linear-gradient(172deg,#fff4bf,${GOLD} 45%,#b27616);color:#2a1a06">${ico('equip')}<b>Equip secondary</b></button>
        </div>
      </div>`);
    const sheet = this.menu.overlayEl?.querySelector('.gold-reveal');
    const view = sheet?.querySelector('.gold-view');
    if (view) this.menu.previewMount(view, GOLDEN_ID, 'none');
    playUi('unlock');
    if (sheet) { flash(sheet, { color: 'rgba(255,207,64,.9)' }); pop(sheet.querySelector('h2')); }
  }

  #closeGolden(equip) {
    this.menu.overlay('');
    if (equip && owned(GOLDEN_ID)) {
      Progress.updateLoadout(this.selected, { secondary: GOLDEN_ID });
      this.onChange?.();
      this.menu.toast(`${gunName(GOLDEN_ID)} equipped`);
    }
    this.render();
  }

  get loadout() { return Progress.loadouts()[this.selected]; }
  kitOf(id) { return attachmentsFor(this.loadout, id); }
  resolve = id => ({ camo: Progress.camo(id), kit: this.kitOf(id) });

  equip() {
    Progress.activeLoadout = this.selected;
    this.onChange?.();
    this.render();
    sweep(this.menu.el.querySelector('.ld-hero'));
    this.menu.toast(`${this.loadout.name} equipped`);
  }

  closePanel() {
    this.panel = null;
    this.render();
  }

  /* ---------- Main view ---------- */
  render() {
    const m = this.menu, all = Progress.loadouts(), active = Progress.activeLoadout, l = all[this.selected];
    const camo = getCamo(l.camo), kit = this.kitOf(l.primary), isActive = this.selected === active;
    m.el.dataset.screen = 'loadouts';
    const prog = Progress.weaponProgress(l.primary);
    m.el.innerHTML = `
      <header class="bar ld-bar">
        ${backButton('loBack', 'Done')}
        <h2 class="bar-title">Loadouts</h2>
        <nav class="ld-tabs">${all.slice(0, LOADOUT_COUNT).map((x, i) => `
          <button class="ld-tab${i === this.selected ? ' on' : ''}${i === active ? ' active' : ''}" data-act="loPick" data-i="${i}">
            <i class="lamp"></i><b>${esc(x.name)}</b><small>${esc(gunName(x.primary))}</small>
          </button>`).join('')}</nav>
        <button class="btn ld-equip ${isActive ? 'is-go' : 'is-primary'}" data-act="loEquip" data-sound="confirm" ${isActive ? 'disabled' : ''}>${ico(isActive ? 'ready' : 'equip')}<b>${isActive ? 'Equipped' : 'Equip'}</b></button>
      </header>
      <div class="ld${this.entered ? '' : ' enter'}">
        <section class="ld-left">
          <button class="ld-hero" data-act="loWeapon" data-key="primary" style="--cat:'${esc(categoryOf(l.primary)).toUpperCase()}'">
            <span class="ld-hero-view"></span>
            <span class="ld-hero-tag">
              <em>Primary</em>
              <b>${esc(gunName(l.primary))}</b>
              <small>${esc(categoryOf(l.primary))}${WEAPONS[l.primary]?.role ? ` / ${esc(WEAPONS[l.primary].role)}` : ''}</small>
              <span class="ld-camo"><i class="sw" style="background:${swatchCss(camo)}"></i>${esc(camo.name)}</span>
            </span>
            <span class="ld-hero-lv"><b>${levelHtml(l.primary)}</b><i class="xp"><i style="transform:scaleX(${(prog.maxed ? 1 : prog.into / prog.span).toFixed(3)})"></i></i></span>
            <span class="ld-cardpin" data-act="loCards" role="button" aria-label="Calling card">${cardHtml(Progress.card, { size: 150, sub: 'Calling card' })}</span>
            <em class="ld-swap">${ico('swap')}Change weapon</em>
            <span class="ld-kit">${SLOTS.map(s => `<i class="${kit[s] ? 'has' : ''}">
              <span class="ld-kit-ico">${itemMark(s, SLOT_LABEL[s])}</span>
              <span><small>${SLOT_LABEL[s]}</small><b>${kit[s] ? esc(ATTACHMENTS[kit[s]].name) : 'Stock'}</b></span>
            </i>`).join('')}</span>
          </button>
          <div class="ld-sub">
            <button class="ld-side" data-act="loWeapon" data-key="secondary">
              <span class="ld-side-pic"><canvas class="gun-pic" data-gun="${esc(l.secondary)}"></canvas></span>
              <span class="ld-tx"><small>Secondary / ${esc(categoryOf(l.secondary))}</small><b>${esc(gunName(l.secondary))}</b><small>${levelHtml(l.secondary)}</small></span>
            </button>
            <button class="ld-act" data-act="loGunsmith">${ico('gunsmith')}<b>Gunsmith</b><small>Camo, parts, prestige</small></button>
            <button class="ld-act" data-act="loRename">${ico('edit')}<b>Rename</b><small>${esc(l.name)}</small></button>
          </div>
        </section>
        <section class="ld-right">
          ${this.statBlock(l.primary, kit)}
          <div class="ld-row"><h4>Perks</h4><div class="ld-cells c3">${l.perks.map((id, i) => this.tile('perks', i, id, PERK_TIERS?.[PERKS[id]?.tier ?? i] ?? `Perk ${i + 1}`)).join('')}</div></div>
          <div class="ld-row"><h4>Equipment and operator</h4><div class="ld-cells c3">
            ${this.tile('tactical', 0, l.tactical, 'Tactical')}
            ${this.tile('lethal', 0, l.lethal, 'Lethal')}
            ${this.operatorTile(l)}
          </div></div>
          <div class="ld-row"><h4>Scorestreaks</h4><div class="ld-cells c3">${l.streaks.map((id, i) => this.tile('streaks', i, id, streakCost(id, l.perks))).join('')}</div></div>
        </section>
        <div class="ld-panel"></div>
      </div>`;
    if (!this.entered) stagger(m.el.querySelectorAll('.ld-hero, .ld-sub > *, .ld-stats, .ld-row'), 'up', { delay: 60, step: 30 });
    this.entered = true;
    this.panelEl = m.el.querySelector('.ld-panel');
    if (this.panel) this.paintPanel(true);
    else m.previewMount(m.el.querySelector('.ld-hero-view'), l.primary, l.camo, kit);
    m.paintGuns(m.el, this.resolve);
    m.warmGuns(WEAPON_IDS, this.resolve);
  }

  statBlock(id, kit) {
    const bars = statBars(id, kit).filter(b => HERO_STATS.includes(b.id));
    return `<div class="ld-stats">
      <div class="ld-bars">${bars.map(b => `<div class="ld-bar-row"><span>${esc(b.label)}</span><i class="sb"><i class="sb-base" style="transform:scaleX(${b.score.toFixed(3)})"></i></i></div>`).join('')}</div>
      <div class="ld-facts">${weaponFacts(id, kit).map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>
    </div>`;
  }

  tile(key, idx, id, head) {
    const item = GEAR[key].table[id];
    if (!item) return '';
    const pro = key === 'perks' && Progress.isPro(id);
    return `<button class="ld-tile${pro ? ' is-pro' : ''}" data-act="loSlot" data-key="${key}" data-idx="${idx}">
      <span class="ld-ico">${itemMark(id, item.name)}</span>
      <span class="ld-tx"><small>${esc(head)}${pro ? '<i class="pro-chip">Pro</i>' : ''}</small><b>${esc(item.name)}</b></span>
      ${item.count ? `<em>x${item.count}</em>` : ''}
    </button>`;
  }

  operatorTile(l) {
    const op = getOperator(l.operator);
    return `<button class="ld-tile ld-op" data-act="loOperators">
      <span class="ld-ico">${ico('operator')}</span>
      <span class="ld-tx"><small>Operator</small><b>${esc(op.name)}</b></span>
    </button>`;
  }

  /* ---------- Panels ---------- */
  paintPanel(instant) {
    const p = this.panel, el = this.panelEl;
    if (p.type === 'armory') this.paintArmory();
    else this.paintGear();
    if (instant) el.classList.add('open');
    else requestAnimationFrame(() => el.classList.add('open'));
  }

  openArmory(key) {
    const id = this.loadout[key];
    this.panel = { type: 'armory', cat: categoryOf(id), browse: id };
    this.paintPanel();
  }

  /* ---------- Armory ---------- */
  paintArmory() {
    const p = this.panel;
    this.panelEl.innerHTML = `
      <div class="ar">
        <nav class="ar-rail">
          ${backButton('loClose')}
          ${CATEGORIES.map(c => `<button class="ar-cat" data-act="arCat" data-cat="${c}">${ico(`cat:${c}`)}<b>${c}</b><small></small></button>`).join('')}
        </nav>
        <div class="ar-grid"></div>
        <aside class="ar-spec">
          <div class="ar-view">
            <div class="ar-title"><em></em><b></b><small></small></div>
          </div>
          <div class="ar-bars"></div>
          <div class="ar-facts"></div>
          <div class="ar-cta">
            <button class="btn" data-act="arGunsmith">${ico('gunsmith')}<b>Gunsmith</b></button>
            <button class="btn is-primary ar-equip" data-act="arEquip" data-sound="confirm">${ico('equip')}<b></b></button>
          </div>
        </aside>
      </div>`;
    const $ = sel => this.panelEl.querySelector(sel);
    this.ar = { grid: $('.ar-grid'), view: $('.ar-view'), kicker: $('.ar-title em'), name: $('.ar-title b'), sub: $('.ar-title small'), bars: $('.ar-bars'), facts: $('.ar-facts'), equip: $('.ar-equip'), gs: $('[data-act="arGunsmith"]') };
    this.paintCategories();
    this.paintGrid();
    this.menu.previewMount(this.ar.view, p.browse, Progress.camo(p.browse), this.kitOf(p.browse));
    this.paintBrowse();
  }

  paintCategories() {
    for (const b of this.panelEl.querySelectorAll('.ar-cat')) {
      const c = b.dataset.cat, list = gunsIn(c), have = list.filter(owned).length;
      b.classList.toggle('on', c === this.panel.cat);
      b.querySelector('small').textContent = `${have}/${list.length}`;
    }
  }

  paintGrid() {
    const p = this.panel, list = gunsIn(p.cat), l = this.loadout;
    // Three guns or fewer get a full-width row each, so the picture can be wide; four sit two by two.
    const cols = list.length <= 3 ? 1 : 2, wide = cols === 1;
    this.ar.grid.style.setProperty('--cols', cols);
    this.ar.grid.style.setProperty('--rows', Math.ceil(list.length / cols));
    this.ar.grid.innerHTML = list.map(id => {
      const open = owned(id), w = WEAPONS[id];
      const where = id === l.primary || id === l.secondary;
      const gold = id === GOLDEN_ID;
      return `<button class="ar-card${open ? '' : ' locked'}${where ? ' equipped' : ''}${gold ? ' gold' : ''}" ${wide ? 'data-wide' : ''} data-act="arBrowse" data-id="${esc(id)}"${gold ? ` style="${GOLD_CARD}"` : ''}>
        <span class="ar-pic"><canvas class="gun-pic" data-gun="${esc(id)}"></canvas></span>
        <span class="ar-info"><b${gold ? ` style="color:${GOLD}"` : ''}>${esc(w.name)}</b><small>${open ? esc(w.role ?? categoryOf(id)) : esc(lockText(id))}</small></span>
        ${open ? `<em>${levelHtml(id)}</em>` : `<em class="lock">${ico('lock')}</em>`}
        ${where ? '<u>Equipped</u>' : ''}
      </button>`;
    }).join('');
    this.menu.paintGuns(this.ar.grid, this.resolve);
    this.markBrowsed();
  }

  markBrowsed() {
    for (const c of this.ar.grid.querySelectorAll('.ar-card')) c.classList.toggle('on', c.dataset.id === this.panel.browse);
  }

  setCategory(cat) {
    if (cat === this.panel.cat) return;
    const l = this.loadout, list = gunsIn(cat);
    this.panel.cat = cat;
    this.panel.browse = list.find(id => id === l.primary || id === l.secondary) ?? list.find(owned) ?? list[0];
    this.paintCategories();
    this.paintGrid();
    this.showBrowsed();
  }

  // Looking at a gun changes the preview and the comparison, and nothing else.
  browse(id) {
    if (id === this.panel.browse) return;
    this.panel.browse = id;
    this.markBrowsed();
    this.showBrowsed();
  }

  showBrowsed() {
    const id = this.panel.browse;
    this.menu.previewShow(id, Progress.camo(id), this.kitOf(id));
    this.paintBrowse();
  }

  paintBrowse() {
    const id = this.panel.browse, a = this.ar, l = this.loadout, slot = slotOf(id), open = owned(id);
    const kit = this.kitOf(id), current = l[slot];
    const on = id === current;
    const camo = getCamo(Progress.camo(id));
    a.kicker.innerHTML = open ? `<span>${esc(categoryOf(id))} /</span>${levelHtml(id)}` : esc(lockText(id));
    a.name.textContent = gunName(id);
    a.sub.textContent = `${SLOT_NAME[slot]} / ${camo.name}`;
    const mine = Object.fromEntries(statBars(current, this.kitOf(current)).map(b => [b.id, b.score]));
    a.bars.innerHTML = statBars(id, kit).filter(b => HERO_STATS.includes(b.id)).map(b => {
      const was = mine[b.id] ?? b.score, dir = on || Math.abs(b.score - was) < 0.01 ? '' : b.score > was ? 'up' : 'down';
      return `<div class="ld-bar-row" data-dir="${dir}"><span>${esc(b.label)}</span><i class="sb"><i class="sb-base" style="transform:scaleX(${b.score.toFixed(3)})"></i>${on ? '' : `<u style="left:${(was * 100).toFixed(1)}%"></u>`}</i></div>`;
    }).join('');
    a.facts.innerHTML = weaponFacts(id, kit).map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
    // A locked Golden Gun shows how far along the player is on each requirement instead of the bare lock.
    if (id === GOLDEN_ID && !open) {
      a.facts.innerHTML = Progress.goldenStatus().steps.map(st => `<div${st.done ? ` style="color:${GOLD}"` : ''}><small>${esc(st.label)}</small><b>${st.value}/${st.goal}</b></div>`).join('');
    }
    a.equip.disabled = !open || on;
    a.equip.classList.toggle('is-go', on);
    a.equip.classList.toggle('is-primary', !on);
    a.equip.querySelector('b').textContent = !open ? (id === GOLDEN_ID ? 'Locked' : `Level ${Progress.itemUnlockLevel('weapon', id)}`) : on ? 'Equipped' : `Equip ${SLOT_NAME[slot]}`;
    a.gs.disabled = !open;
  }

  equipBrowsed() {
    const id = this.panel.browse;
    if (!owned(id)) {
      this.menu.toast(`${gunName(id)}: ${lockText(id)}`);
      return;
    }
    Progress.updateLoadout(this.selected, { [slotOf(id)]: id });
    this.onChange?.();
    this.panel = null;
    this.render();
    this.menu.toast(`${gunName(id)} equipped`);
  }

  /* ---------- Perks, equipment, streaks ---------- */
  openGear(key, idx) {
    this.panel = { type: 'gear', key, idx };
    this.paintPanel();
  }

  paintGear() {
    const { key } = this.panel, l = this.loadout;
    const column = (title, k, items, isOn, note) => `
      <div class="pk-col">
        ${title ? `<h4>${esc(title)}</h4>` : ''}
        <div class="pk-list">${items.map(item => this.option(k, item, isOn(item.id), note?.(item))).join('')}</div>
      </div>`;
    let body = '', title = GEAR[key].title, hint = '', cls = '';
    if (key === 'perks') {
      hint = 'One from each tier';
      cls = 'tiers';
      this.panel.focus ??= l.perks[0];
      body = PERK_TIERS.map((name, tier) => column(name, 'perks', Object.values(PERKS).filter(p => p.tier === tier), id => l.perks[tier] === id)).join('');
    } else if (key === 'streaks') {
      hint = 'Pick three. Earn them by scoring without dying';
      cls = 'wide';
      const sorted = Object.values(STREAKS).sort((a, b) => a.cost - b.cost);
      body = column('', 'streaks', sorted, id => l.streaks.includes(id), item => `${streakCost(item.id, l.perks)}`);
    } else {
      hint = 'One of each. Counts refill on respawn';
      cls = 'tiers two';
      body = column('Tactical', 'tactical', Object.values(TACTICALS), id => l.tactical === id, item => `x${item.count}`)
        + column('Lethal', 'lethal', Object.values(LETHALS), id => l.lethal === id, item => `x${item.count}`);
    }
    this.panelEl.innerHTML = `
      <div class="ld-sheet">
        <div class="ld-sheet-head"><b>${esc(title)}</b>${key === 'perks' ? this.proDetail(this.panel.focus) : `<small>${esc(hint)}</small>`}<button class="btn is-primary" data-act="loClose" data-sound="confirm">${ico('check')}<b>Done</b></button></div>
        <div class="pk-cols ${cls}">${body}</div>
      </div>`;
  }

  option(key, item, on, tag) {
    const sec = GEAR[key], open = Progress.isItemUnlocked(sec.kind, item.id);
    const perk = key === 'perks', pro = perk && Progress.isPro(item.id);
    return `<button class="pk-card${on ? ' on' : ''}${open ? '' : ' locked'}${pro ? ' is-pro' : ''}${perk && this.panel?.focus === item.id ? ' focus' : ''}" data-act="loChoose" data-key="${key}" data-id="${item.id}">
      <span class="ld-ico">${itemMark(item.id, item.name)}</span>
      <span class="ld-tx"><b>${esc(item.name)}${pro ? '<i class="pro-chip">Pro</i>' : ''}</b><small>${open ? esc(item.desc) : esc(levelRequirement(Progress.itemUnlockLevel(sec.kind, item.id)))}</small></span>
      ${open ? (tag ? `<em>${tag}</em>` : '') : `<em class="lock">${ico('lock')}</em>`}
      ${perk && open ? this.proStrip(item.id) : ''}
    </button>`;
  }

  // Pro progress along a perk card's bottom edge: one segment per challenge step, gold once Pro.
  proStrip(id) {
    const st = Progress.proStatus(id);
    return `<span class="pro-strip${st.done ? ' done' : ''}">${st.steps.map(c => `<i style="--f:${(c.value / c.goal).toFixed(3)}"></i>`).join('')}</span>`;
  }

  // The focused perk's Pro: what it adds and how far along each step is. Lives in the sheet head.
  proDetail(id) {
    const st = Progress.proStatus(id), perk = PERKS[id];
    const fmt = n => Math.floor(n).toLocaleString('en-US');
    return `<div class="pk-pro${st.done ? ' done' : ''}">
      <div class="pk-pro-top"><i class="pro-chip">${st.done ? 'Pro' : 'Pro locked'}</i><b>${esc(perk.name)}: ${esc(PRO[id].name)}</b></div>
      <small class="pk-pro-desc">${esc(PRO[id].desc)}</small>
      ${st.done ? '' : `<div class="pk-pro-steps">${st.steps.map(c => `<span class="${c.done ? 'ok' : ''}"><small>${esc(c.label)}</small><u>${fmt(c.value)}/${fmt(c.goal)}</u><i style="--f:${(c.value / c.goal).toFixed(3)}"></i></span>`).join('')}</div>`}
    </div>`;
  }

  // Perks and equipment stay open so a whole set can be picked in one visit.
  choose(key, id) {
    const sec = GEAR[key], l = this.loadout;
    if (!Progress.isItemUnlocked(sec.kind, id)) {
      this.menu.toast(`${sec.table[id].name}: ${levelRequirement(Progress.itemUnlockLevel(sec.kind, id))}`);
      return;
    }
    if (key === 'perks') {
      const list = [...l.perks];
      list[PERKS[id].tier] = id;
      this.panel.focus = id;
      Progress.updateLoadout(this.selected, { perks: list });
    } else if (key === 'streaks') {
      // The tile that opened this is the one being replaced; tapping a held streak moves that aim to it instead.
      const list = [...l.streaks];
      if (list.includes(id)) {
        this.panel.idx = list.indexOf(id);
        return;
      }
      list[this.panel.idx] = id;
      list.sort((a, b) => STREAKS[a].cost - STREAKS[b].cost);
      this.panel.idx = list.indexOf(id);
      Progress.updateLoadout(this.selected, { streaks: list });
    } else {
      Progress.updateLoadout(this.selected, { [key]: id });
    }
    this.onChange?.();
    this.paintGear();
  }
}
