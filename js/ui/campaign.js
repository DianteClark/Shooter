// The co-op campaign's menus (docs/CAMPAIGN.md): the Campaign tab on the Multiplayer screen (an operation's mission map,
// a station a mission along a rail line, the two operations to switch between, and the picked mission's plate with
// its difficulty and best stars) and the briefing screen (the briefing cards, the objectives, the stars and what it
// pays). Markup and in-place paints only; js/main.js owns the pick and the actions:
//   cpPick {k}  cpOp {o}  cpDiff {d}  cpBrief  cpBriefBack  cpSolo  cpFriends
import { MAPS } from '../shared/map.js';
import { MISSIONS, OPERATIONS, CP_DIFFS, CP_STAR_XP, CP_FIRST_XP, missionOpen, campaignCleared, campaignStars, campaignVetAll, CP_OP_REWARDS, CP_CARDS, opOf } from '../shared/campaign.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';
import { mapImage } from './mapthumb.js';

// Stations along the rail line, in a 100 x 56 box (left to right, up and down like a route map): one line an
// operation.
const STATIONS = [[[7, 40], [19, 18], [31, 38], [43, 16], [56, 36], [68, 14], [80, 34], [93, 15]], [[10, 38], [36, 16], [62, 38], [90, 16]]];
const TYPE_ICON = { goto: 'map', hack: 'ex:hack', defend: 'mode:hard', escort: 'ui:user', plant: 'ex:cache', kill: 'ex:hvt', chase: 'ui:timer', boss: 'ui:skull', extract: 'mode:ex', pursue: 'ex:hvt' };
const opIndex = k => OPERATIONS.indexOf(opOf(k));
const SKIN_OF = ['Marshal', 'Sparrow'];
const time = s => (s ? `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}` : '--');
const stars = (n, of = 3) => Array.from({ length: of }, (_, i) => `<i class="cps${i < n ? ' on' : ''}">${ico('star')}</i>`).join('');

// The tab's body and foot (inside .mp, under the Multiplayer header and tabs). `cp` is the save block.
export function campaignTabMarkup({ k, diff, cp }) {
  const o = opIndex(k), op = OPERATIONS[o], ms = MISSIONS.slice(op.from, op.to), st = STATIONS[o] ?? STATIONS[0];
  const total = campaignStars(cp, o), vet = campaignVetAll(cp, o);
  const line = st.slice(0, ms.length).map(([x, y]) => `${x},${y}`).join(' ');
  const R = CP_OP_REWARDS[o] ?? CP_OP_REWARDS[0];
  return `
      <div class="mp-body cpm cpm-o${o}" data-in="up">
        <div class="cpm-map">
          <div class="cpm-head"><b>${esc(op.name)}</b><small>${total} of ${ms.length * 3} stars${vet ? ' · Veteran clear' : ''}</small>
            <span class="cpm-ops" role="group" aria-label="Operation">${OPERATIONS.map((x, i) => `<button class="bm-seg${i === o ? ' on' : ''}${missionOpen(cp, x.from) ? '' : ' locked'}" data-act="cpOp" data-o="${i}" data-sound="tab">${missionOpen(cp, x.from) ? '' : ico('ui:lock')}${esc(x.short)}</button>`).join('')}</span></div>
          <div class="cpm-rail">
            <svg viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">
              <polyline class="cpm-bed" points="${line}"/>
              <polyline class="cpm-ties" points="${line}"/>
              <polyline class="cpm-done" points="${line}" style="--n:${ms.length}"/>
            </svg>
            ${ms.map((m, j) => {
              const i = op.from + j, open = missionOpen(cp, i), done = campaignCleared(cp, m.id), [x, y] = st[j];
              return `<button class="cpm-st${open ? '' : ' locked'}${done ? ' done' : ''}" data-act="cpPick" data-k="${i}" style="left:${x}%;top:${(y / 56) * 100}%" aria-label="Mission ${m.n}: ${esc(m.name)}${open ? '' : ' (locked)'}">
                <span class="cpm-dot">${open ? `<b>${m.n}</b>` : ico('ui:lock')}</span>
                <span class="cpm-lb"><b>${esc(m.name)}</b><small>${done ? stars(cp[m.id]?.[1] ?? 0) : open ? esc(m.tag) : 'Locked'}</small></span>
              </button>`;
            }).join('')}
          </div>
        </div>
        <div class="cpm-side"></div>
      </div>
      <footer class="mp-foot cpm-foot" data-in="up">
        <p class="mp-note">${ico('mode:cp')}<span>Co-op for 1-4: bots fill the squad. Clear a mission to open the next; every ${esc(op.short)} mission on Veteran earns ${SKIN_OF[o] ?? ''}'s ${esc(R.skin.name)} skin and the ${esc(R.emblem.name)} emblem.</span></p>
        <button class="btn cpm-friends" data-act="cpFriends" data-sound="confirm">${ico('host')}<span><b>With friends</b><small>Host a room</small></span></button>
        <button class="btn is-primary mp-find cpm-go" data-act="cpBrief" data-sound="confirm">${ico('play')}<span><b>Briefing</b><small class="cpm-pick"></small></span></button>
      </footer>`;
}

// The picked mission's plate, and the station marks.
export function paintCampaignTab(root, { k, diff, cp }) {
  // Another operation's mission picked: its own map, stations and note (the whole tab body again).
  const box = root.querySelector('.mp-cpg');
  if (box && !box.querySelector(`.cpm-o${opIndex(k)}`)) box.innerHTML = campaignTabMarkup({ k, diff, cp });
  const m = MISSIONS[k], open = missionOpen(cp, k), rec = cp[m.id] ?? [0, 0, 0];
  for (const b of root.querySelectorAll('.cpm-st')) b.classList.toggle('on', Number(b.dataset.k) === k);
  const side = root.querySelector('.cpm-side');
  if (side) side.innerHTML = `
          <div class="cpm-art" style="background-image:url(${mapImage(MAPS[m.map])})"><span class="cpm-n">${m.n}</span></div>
          <small class="cpm-brow">Mission ${m.n} · ${esc(m.tag)} · ${esc(MAPS[m.map]?.name ?? '')}</small>
          <h3>${esc(m.name)}</h3>
          <p>${esc(m.brief[0][1])}</p>
          <div class="cpm-rec"><span>${stars(rec[1])}</span><small>Best ${time(rec[2])} · par ${time(m.par)}</small></div>
          <div class="cpm-diff" role="group" aria-label="Difficulty">${CP_DIFFS.map((d, i) => `<button class="bm-seg${i === diff ? ' on' : ''}${rec[0] & (1 << i) ? ' clr' : ''}" data-act="cpDiff" data-d="${i}" data-sound="tab">${esc(d.name)}${rec[0] & (1 << i) ? ico('check') : ''}</button>`).join('')}</div>
          <small class="cpm-dnote">${esc(CP_DIFFS[diff].blurb)}</small>`;
  const go = root.querySelector('.cpm-go'), fr = root.querySelector('.cpm-friends');
  if (go) go.disabled = !open;
  if (fr) fr.disabled = !open;
  const pick = root.querySelector('.cpm-pick');
  if (pick) pick.textContent = open ? `${m.n}. ${m.name} · ${CP_DIFFS[diff].name}` : 'Clear the mission before it';
}

// The briefing: the cards, the objectives in order, the stars and the pay; Deploy (solo) or With friends.
export function briefingMarkup({ k, diff, cp }) {
  const m = MISSIONS[k], d = CP_DIFFS[diff], rec = cp[m.id] ?? [0, 0, 0], first = !campaignCleared(cp, m.id);
  const card = CP_CARDS[k], op = opOf(k), R = CP_OP_REWARDS[opIndex(k)] ?? CP_OP_REWARDS[0];
  return `
    ${header({ back: 'cpBriefBack', label: 'Campaign', title: 'Briefing', cls: 'mp-bar' })}
    <div class="cpb">
      <div class="cpb-main scroll-y">
        <div class="cpb-title" data-in="up">
          <span class="cpb-n">${m.n}</span>
          <span><small>${esc(op.name)} · ${esc(MAPS[m.map]?.name ?? '')}</small><b>${esc(m.name)}</b><em>${esc(m.tag)} · ${esc(d.name)}</em></span>
        </div>
        <div class="cpb-cards">${m.brief.map(([t, text], i) => `
          <section class="cpb-card" data-in="up" style="--i:${i}"><h4>${esc(t)}</h4><p>${esc(text)}</p></section>`).join('')}
        </div>
        <section class="cpb-obj" data-in="up"><h4>${ico('mode:cp')}Objectives</h4>
          <ol>${m.steps.map(s => `<li>${ico(TYPE_ICON[s.type] ?? 'map')}<span>${esc(s.label)}</span></li>`).join('')}</ol>
        </section>
      </div>
      <aside class="cpb-side" data-in="left">
        <div class="cpb-art" style="background-image:url(${mapImage(MAPS[m.map])})"></div>
        <h4>Stars</h4>
        <ul class="cpb-stars">
          <li>${stars(1, 1)}<span>${esc(m.bonus.label)}</span></li>
          <li>${stars(1, 1)}<span>Under ${time(m.par)}</span></li>
          <li>${stars(1, 1)}<span>Nobody in the squad dies, no retries</span></li>
        </ul>
        <p class="cpb-best">Best: ${stars(rec[1])} · ${time(rec[2])}</p>
        <h4>Pays</h4>
        <p class="cpb-pay">${d.xp.toLocaleString('en-US')} XP, +${CP_STAR_XP} a star${first ? `, +${CP_FIRST_XP.toLocaleString('en-US')} first clear` : ''}${first && card ? `. Calling card: ${esc(card[1])}` : ''}${diff === 2 ? `. Every ${esc(op.short)} mission on Veteran: ${esc(R.skin.name)} skin, ${esc(R.emblem.name)} emblem` : ''}</p>
        <div class="cpm-diff" role="group" aria-label="Difficulty">${CP_DIFFS.map((x, i) => `<button class="bm-seg${i === diff ? ' on' : ''}" data-act="cpDiff" data-d="${i}" data-sound="tab">${esc(x.name)}</button>`).join('')}</div>
        <div class="cpb-acts">
          <button class="btn cpm-friends" data-act="cpFriends" data-sound="confirm">${ico('host')}<span><b>With friends</b></span></button>
          <button class="btn is-primary cpb-go" data-act="cpSolo" data-sound="confirm">${ico('play')}<span><b>Deploy</b><small>You and 3 bots</small></span></button>
        </div>
      </aside>
    </div>`;
}

// The friend lobby's line for a campaign room.
export function campaignLobbyLine(k, diff) {
  const m = MISSIONS[k];
  return m ? `${opOf(k).short} ${m.n}: ${m.name} · ${CP_DIFFS[diff]?.name ?? ''}` : OPERATIONS[0].name;
}
