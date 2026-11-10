// Quick chat: ten callouts for friends playing without voice.
//
// A Chat chip sits in the HUD's top corner, beside the mic, well clear of both thumbs. Tapping it drops a compact
// 5 x 2 wheel of callouts under it; a tap sends one and closes the wheel (so does the chip again, or a few idle
// seconds). Every element is a [data-tap] HUD tap, which Controls never takes as a stick, and nothing covers the rest of
// the screen, so the sticks keep working with the wheel open.
//
// The message is { c: callout index, x, z } (the sender's position), sent over Net.sendChat to human teammates (everyone
// in free-for-all). It shows as a short line in the kill feed with the sender's name, and as a ping at the sender's
// position on the minimap. Sending is rate limited here; receiving is limited per sender, so a stuck client cannot flood.
// In a solo match, teammate bots now and then answer a few callouts.
//
// HUD hooks used when present (js/ui/hud.js): hud.chatLine({ name, text, team, mine, icon }) for the feed line and
// hud.pingMinimap(x, z, { team, kind:'chat', seconds }) for the ping. Without them this module draws both itself, into
// the HUD's .feed and over its .minimap.
import { icon } from './icons.js';
import { esc } from './widgets.js';
import { TEAMS } from '../shared/constants.js';
import { MAPS } from '../shared/map.js';

export const CALLOUTS = [
  { id: 'enemy', text: 'Enemy spotted', icon: 'ui:eye' },
  { id: 'help', text: 'Need help', icon: 'ui:warning' },
  { id: 'onme', text: 'On me', icon: 'ui:user' },
  { id: 'goA', text: 'Going A', icon: 'ui:flag' },
  { id: 'goB', text: 'Going B', icon: 'ui:flag' },
  { id: 'defend', text: 'Defend', icon: 'medal:defend' },
  { id: 'nice', text: 'Nice shot', icon: 'ui:aim' },
  { id: 'thanks', text: 'Thanks', icon: 'ui:check' },
  { id: 'sorry', text: 'Sorry', icon: 'ui:info' },
  { id: 'gg', text: 'GG', icon: 'ui:cup' },
  // Search and Destroy only. Appended, so the indices on the wire never move.
  { id: 'planting', text: 'Planting', icon: 'ui:timer' },
  { id: 'defusing', text: 'Defusing', icon: 'ui:warning' },
  { id: 'bombdown', text: 'Bomb down', icon: 'ui:skull' },
];
const BASE_WHEEL = ['enemy', 'help', 'onme', 'goA', 'goB', 'defend', 'nice', 'thanks', 'sorry', 'gg'];
// S&D trades On me and Sorry for the bomb calls: seven columns, still two rows, still clear of the buttons.
const SND_WHEEL = ['enemy', 'help', 'goA', 'goB', 'planting', 'defusing', 'bombdown', 'defend', 'onme', 'nice', 'thanks', 'sorry', 'gg'];
const wheelFor = mode => (mode === 'snd' ? SND_WHEEL : BASE_WHEEL).map(id => CALLOUTS.findIndex(c => c.id === id));

const SEND_GAP_MS = 1100;        // Shortest gap between two of your own callouts.
const BURST = 3, BURST_MS = 8000;              // At most this many of your own in this window.
const RECV_BURST = 4;            // Per sender, in the same window; more is dropped.
const LINE_MS = 4200;            // How long a callout stays in the feed.
const LINES = 2;                 // Callout lines in the feed at once; the oldest goes first.
const PING_S = 3;                // How long the minimap ping lasts.
const WHEEL_MS = 5000;           // An untouched wheel closes itself.

// Solo: what a teammate bot may say back, and how often. Only a few callouts get an answer.
// say: the lines one is picked from; as: the callout whose icon the answer wears.
const BOT_REPLIES = {
  help: { say: ['On my way', 'Coming to you'], as: 'onme' }, onme: { say: ['Copy', 'With you'], as: 'onme' },
  goA: { say: ['Copy, A'], as: 'goA' }, goB: { say: ['Copy, B'], as: 'goB' }, defend: { say: ['Holding'], as: 'defend' },
  enemy: { say: ['Copy'], as: 'enemy' }, nice: { say: ['Thanks'], as: 'thanks' }, sorry: { say: ['All good'], as: 'thanks' },
  gg: { say: ['GG'], as: 'gg' }, planting: { say: ['Covering you'], as: 'defend' },
  defusing: { say: ['Covering you'], as: 'defend' }, bombdown: { say: ['On it'], as: 'onme' },
};
const BOT_REPLY_CHANCE = 0.45;

export class QuickChat {
  constructor(hud, { audio = null } = {}) {
    this.hud = hud;
    this.audio = audio;
    this.ctx = null;               // { net, roster, localId, mapId, ffa } while a match runs
    this.sent = [];                // performance.now() of your recent callouts
    this.heard = new Map();        // sender id -> recent receive times
    this.lines = [];
    this.timers = new Set();
    this.#build();
  }

  #build() {
    const hudEl = this.hud.el;
    this.btn = document.createElement('button');
    this.btn.className = 'chip-btn qc-btn';
    this.btn.type = 'button';
    this.btn.hidden = true;
    this.btn.dataset.tap = 'chat';
    this.btn.dataset.sound = 'tab';
    this.btn.setAttribute('aria-label', 'Quick chat');
    this.btn.innerHTML = icon('ui:chat', { size: 19, cls: 'gl' });
    const corner = hudEl.querySelector('.corner');
    if (corner) corner.prepend(this.btn);
    else { this.btn.classList.add('qc-loose'); hudEl.appendChild(this.btn); }

    this.wheel = document.createElement('div');
    this.wheel.className = 'qc-wheel';
    this.wheel.hidden = true;
    this.wheel.setAttribute('role', 'menu');
    this.#fill('tdm');
    hudEl.appendChild(this.wheel);

    this.btn.addEventListener('click', () => this.#open(this.wheel.hidden));
    this.wheel.addEventListener('click', e => {
      const item = e.target.closest?.('.qc-item');
      if (item) this.send(Number(item.dataset.c));
    });
  }

  // The wheel's callouts for a mode, by index into CALLOUTS.
  #fill(mode) {
    const list = wheelFor(mode);
    this.wheel.dataset.mode = mode === 'snd' ? 'snd' : '';
    this.wheel.style.setProperty('--cols', Math.ceil(list.length / 2));
    this.wheel.innerHTML = list.map(i => `<button class="qc-item" type="button" role="menuitem" data-tap="chat" data-c="${i}" data-sound="none">
      <span class="qc-ico">${icon(CALLOUTS[i].icon, { size: 15 })}</span><b>${esc(CALLOUTS[i].text)}</b></button>`).join('');
  }

  // Called as each match begins. net is null in solo; bots may answer then.
  start({ net = null, roster = [], localId, mapId, mode = 'tdm', ffa = false, enabled = true }) {
    this.stop();
    this.#fill(mode);
    this.ctx = { net, roster: new Map(roster.map(r => [r.id, r])), localId, map: MAPS[mapId] ?? null, ffa };
    this.btn.hidden = !enabled;
    net?.onChat((from, d) => this.#receive(from, d));
  }

  stop() {
    this.ctx?.net?.onChat(null);
    this.ctx = null;
    this.btn.hidden = true;
    this.#open(false);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const l of this.lines) l.remove();
    this.lines = [];
    this.heard.clear();
  }

  #later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  #open(on) {
    clearTimeout(this.wheelTimer);
    this.wheel.hidden = !on;
    this.btn.classList.toggle('on', on);
    if (on) {
      this.#paintCooldown();
      this.wheelTimer = setTimeout(() => this.#open(false), WHEEL_MS);
    }
  }

  #canSend(now) {
    this.sent = this.sent.filter(t => now - t < BURST_MS);
    return this.sent.length < BURST && (!this.sent.length || now - this.sent[this.sent.length - 1] >= SEND_GAP_MS);
  }

  #paintCooldown() {
    this.wheel.classList.toggle('cool', !this.#canSend(performance.now()));
  }

  #me() {
    const view = this.hud.view, id = this.ctx?.localId;
    return view?.players?.find(p => p.id === id) ?? null;
  }

  // The human teammates a callout goes to: everyone else in free-for-all.
  #targets() {
    const { roster, localId, ffa } = this.ctx;
    const mine = roster.get(localId)?.team;
    const out = [];
    for (const r of roster.values()) if (!r.isBot && r.id !== localId && (ffa || r.team === mine)) out.push(r.id);
    return out;
  }

  send(i) {
    const c = CALLOUTS[i];
    if (!c || !this.ctx) return;
    const now = performance.now();
    if (!this.#canSend(now)) {
      this.audio?.uiSound?.('deny');
      this.wheel.classList.add('cool');
      return;
    }
    this.sent.push(now);
    this.audio?.uiSound?.('confirm');
    this.#open(false);
    // The ping marks where you are; from the death screen there is nowhere to mark.
    const me = this.#me()?.alive ? this.#me() : null;
    const x = me ? Math.round(me.x * 10) / 10 : null, z = me ? Math.round(me.z * 10) / 10 : null;
    this.ctx.net?.sendChat({ c: i, x, z }, this.#targets());
    this.#show(this.ctx.localId, i, x, z);
    if (!this.ctx.net) this.#botReply(c.id);
  }

  #receive(from, d) {
    const ctx = this.ctx;
    if (!ctx) return;
    const who = ctx.roster.get(from), me = ctx.roster.get(ctx.localId);
    if (!who || who.isBot || !Number.isInteger(d?.c) || !CALLOUTS[d.c]) return;
    if (!ctx.ffa && me && who.team !== me.team) return;
    const now = performance.now();
    const recent = (this.heard.get(from) ?? []).filter(t => now - t < BURST_MS);
    if (recent.length >= RECV_BURST) return;
    recent.push(now);
    this.heard.set(from, recent);
    const x = Number.isFinite(d.x) ? d.x : null, z = Number.isFinite(d.z) ? d.z : null;
    this.#show(from, d.c, x, z);
    this.audio?.uiSound?.('tick');
  }

  // A line in the feed and, when the position is known, a ping on the minimap.
  #show(from, i, x, z, text = CALLOUTS[i].text) {
    const ctx = this.ctx, who = ctx.roster.get(from);
    const mine = from === ctx.localId;
    const team = who?.team ?? 0;
    this.#line({ name: who?.name ?? '?', text, team, mine, icon: CALLOUTS[i].icon });
    if (x !== null && z !== null) this.#ping(x, z, team);
  }

  #line(msg) {
    if (typeof this.hud.chatLine === 'function') { this.hud.chatLine(msg); return; }
    const feed = this.hud.el.querySelector('.feed');
    if (!feed) { this.hud.notify?.(`${msg.name}: ${msg.text}`); return; }
    const myTeam = this.ctx.roster.get(this.ctx.localId)?.team;
    const row = document.createElement('div');
    row.className = `f-row qc-row ${msg.mine ? 'mine' : this.ctx.ffa || msg.team !== myTeam ? 'foe' : 'ally'}`;
    row.innerHTML = `<span class="qc-ico">${icon(msg.icon, { size: 12 })}</span><em style="color:${TEAMS[msg.team]?.css ?? '#fff'}">${esc(msg.name)}</em><span class="qc-say">${esc(msg.text)}</span>`;
    feed.prepend(row);
    this.lines.push(row);
    while (this.lines.length > LINES) this.lines.shift().remove();
    this.#later(() => row.classList.add('out'), LINE_MS);
    this.#later(() => { row.remove(); this.lines = this.lines.filter(r => r !== row); }, LINE_MS + 450);
  }

  #ping(x, z, team) {
    if (typeof this.hud.pingMinimap === 'function') { this.hud.pingMinimap(x, z, { team, kind: 'chat', seconds: PING_S }); return; }
    const mm = this.hud.el.querySelector('.minimap'), map = this.ctx.map;
    if (!mm || !map) return;
    const dot = document.createElement('i');
    dot.className = 'qc-ping';
    dot.style.cssText = `left:${(x / map.width * 100).toFixed(1)}%;top:${(z / map.height * 100).toFixed(1)}%;--c:${TEAMS[team]?.css ?? '#fff'}`;
    mm.appendChild(dot);
    this.#later(() => dot.remove(), PING_S * 1000);
  }

  // Solo only. One bot at most, a moment later, and not every time.
  #botReply(id) {
    const reply = BOT_REPLIES[id];
    if (!reply || Math.random() > BOT_REPLY_CHANCE) return;
    const { roster, localId, ffa } = this.ctx;
    const mine = roster.get(localId)?.team;
    const alive = new Set((this.hud.view?.players ?? []).filter(p => p.alive).map(p => p.id));
    // GG is answered by anyone; the rest by a teammate (in free-for-all, by whoever).
    const pool = [...roster.values()].filter(r => r.isBot && alive.has(r.id) && (ffa || id === 'gg' || r.team === mine));
    if (!pool.length) return;
    const bot = pool[Math.floor(Math.random() * pool.length)];
    const text = reply.say[Math.floor(Math.random() * reply.say.length)];
    const i = CALLOUTS.findIndex(c => c.id === reply.as);
    this.#later(() => {
      if (!this.ctx) return;
      const p = this.hud.view?.players?.find(q => q.id === bot.id);
      if (!p?.alive) return;
      // A bot's position is only pinged for its own side; an enemy's GG gives nothing away.
      const friendly = ffa || bot.team === mine;
      this.#show(bot.id, i, friendly ? p.x : null, friendly ? p.z : null, text);
    }, 700 + Math.random() * 900);
  }
}
