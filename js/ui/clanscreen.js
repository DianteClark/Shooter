// The Clan screen (Profile > Clan): found a clan, join one with a code, show and copy yours, edit it, leave it.
// Clans have no server (js/shared/clans.js): yours lives on this phone (Clan in js/ui/progress.js) and travels on your
// career card, so a friend in your lobby is offered "Join [TAG]"; the join code carries the whole clan for anyone else.
//
//   clanScreen(menu, { onBack, onChange })   onChange: the clan was founded, joined, edited or left (the lobby seat and
//                                            career card are re-sent by the caller)
import { Clan } from './progress.js';
import { CLAN_COLORS, CLAN_MARKS, clanCode, tagProblem, normTag, normName, NAME_MAX, TAG_MAX } from '../shared/clans.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';

// The keypad has no space bar: an underscore stands for one in clan names.
const fromKeys = v => normName(String(v).replace(/_/g, ' '));
const toKeys = v => String(v).replace(/ /g, '_');

export function clanPlate(clan, size = 'big') {
  if (!clan) return '';
  const color = CLAN_COLORS[clan.c] ?? CLAN_COLORS[0];
  return `<span class="cl-plate ${size}" style="--cl:${color}">${ico(CLAN_MARKS[clan.mk] ?? CLAN_MARKS[0], '', size === 'big' ? 26 : 14)}<b>${esc(clan.tag || '----')}</b></span>`;
}

export function clanScreen(menu, { onBack, onChange = null }) {
  // draft: the editor's fields while founding or editing; null shows the clan (or the way in).
  let draft = null, leaving = false;
  const changed = () => onChange?.();

  const keypadTag = () => menu.keypad({
    title: 'Clan tag', value: draft.tag, max: TAG_MAX, kind: 'name', doneLabel: 'Use tag',
    hint: '2 to 4 letters or numbers. Shown before every member\'s name.',
    onDone: v => {
      const t = normTag(v), problem = tagProblem(t);
      if (problem) menu.toast(problem, 'warn');
      else draft.tag = t;
      render();
    },
    onCancel: render,
  });
  const keypadName = () => menu.keypad({
    title: 'Clan name', value: toKeys(draft.name), max: NAME_MAX, kind: 'name', doneLabel: 'Use name',
    hint: 'Up to 16 letters and numbers. _ makes a space.',
    onDone: v => { const n = fromKeys(v); if (n) draft.name = n; else menu.toast('Give the clan a name', 'warn'); render(); },
    onCancel: render,
  });
  const keypadCode = () => menu.keypad({
    title: 'Clan join code', max: 36, kind: 'name', doneLabel: 'Join',
    hint: 'Your clanmate finds it in Profile > Clan. Dashes are optional.',
    onDone: v => {
      const r = Clan.join(v);
      if (r.error) menu.toast(r.error, 'warn');
      else { menu.toast(`Joined [${r.clan.tag}] ${r.clan.name}`); changed(); }
      render();
    },
    onCancel: render,
  });

  const editor = () => {
    const editing = !!Clan.get();
    const ready = draft.tag && !tagProblem(draft.tag) && draft.name;
    return `
      <div class="cl-edit" data-in="up">
        <div class="cl-preview">${clanPlate(draft)}<b>${esc(draft.name || 'Clan name')}</b></div>
        <div class="cl-fields">
          <button class="btn cl-field" data-act="clTag"><small>Tag</small><b>${esc(draft.tag || 'Pick a tag')}</b>${ico('edit')}</button>
          <button class="btn cl-field" data-act="clName"><small>Name</small><b>${esc(draft.name || 'Pick a name')}</b>${ico('edit')}</button>
        </div>
        <div class="cl-swatches" role="radiogroup" aria-label="Colour">${CLAN_COLORS.map((c, i) => `<button class="cl-sw${draft.c === i ? ' on' : ''}" data-act="clColor" data-i="${i}" style="--cl:${c}" aria-label="Colour ${i + 1}"></button>`).join('')}</div>
        <div class="cl-marks" role="radiogroup" aria-label="Mark">${CLAN_MARKS.map((m, i) => `<button class="cl-mk${draft.mk === i ? ' on' : ''}" data-act="clMark" data-i="${i}" aria-label="Mark ${i + 1}">${ico(m, '', 18)}</button>`).join('')}</div>
        <div class="row cl-go">
          <button class="btn" data-act="clCancel">${ico('back')}<b>Cancel</b></button>
          <button class="btn is-primary" data-act="clSave" data-sound="confirm" ${ready ? '' : 'disabled'}>${ico('check')}<b>${editing ? 'Save changes' : 'Found clan'}</b></button>
        </div>
      </div>`;
  };

  const mine = clan => {
    const code = clanCode(clan);
    return `
      <div class="cl-mine" data-in="up">
        <div class="cl-head">${clanPlate(clan)}<span><b>${esc(clan.name)}</b><small>${clan.own ? 'Founded on this phone' : 'Member'}</small></span></div>
        <div class="cl-code">
          <small>Join code</small>
          <button class="cl-codebtn" data-act="clCopy" data-sound="confirm" aria-label="Copy the join code"><b class="t-num">${esc(code)}</b>${ico('ui:copy', '', 16)}</button>
          <p>Friends type this in Profile > Clan > Join with a code. In a lobby with you, they can tap Join [${esc(clan.tag)}].</p>
        </div>
        <div class="row cl-acts">
          ${clan.own ? `<button class="btn" data-act="clEdit">${ico('edit')}<b>Edit clan</b></button>` : `<span class="cl-note">${ico('ui:info', '', 14)}Only the founder can rename it.</span>`}
          <button class="btn${leaving ? ' is-danger' : ''}" data-act="clLeave">${ico('ui:exit')}<b>${leaving ? 'Tap again to leave' : 'Leave clan'}</b></button>
        </div>
      </div>`;
  };

  const none = () => `
    <div class="cl-none" data-in="up">
      <button class="cl-card" data-act="clFound">${ico('ui:flag', '', 30)}<b>Found a clan</b><small>Pick a tag, a name, a colour and a mark. Your tag shows before your name in every match.</small></button>
      <button class="cl-card" data-act="clCode">${ico('ui:join', '', 30)}<b>Join with a code</b><small>A clanmate's join code, from their Clan screen.</small></button>
      <p class="cl-note">${ico('ui:party', '', 14)}In a friend lobby, a clanmate's card offers Join [TAG] on the lobby screen.</p>
    </div>`;

  const render = () => {
    menu.el.dataset.screen = 'clan';
    const clan = Clan.get();
    menu.el.innerHTML = `
      ${header({ back: 'clBack', label: 'Done', title: 'Clan' })}
      <div class="cl">${draft ? editor() : clan ? mine(clan) : none()}</div>`;
    menu.on({
      clBack: () => { if (draft) { draft = null; render(); } else onBack(); },
      clFound: () => { draft = { tag: '', name: '', c: 0, mk: 0 }; render(); },
      clCode: keypadCode,
      clEdit: () => { const c = Clan.get(); draft = { tag: c.tag, name: c.name, c: c.c, mk: c.mk }; render(); },
      clTag: keypadTag,
      clName: keypadName,
      clColor: ({ i }) => { draft.c = Number(i); render(); },
      clMark: ({ i }) => { draft.mk = Number(i); render(); },
      clCancel: () => { draft = null; render(); },
      clSave: () => {
        const r = Clan.get() ? Clan.rename(draft) : Clan.create(draft);
        if (r.error) { menu.toast(r.error, 'warn'); return; }
        menu.toast(`[${r.clan.tag}] ${r.clan.name}`);
        draft = null;
        changed();
        render();
      },
      clCopy: () => {
        const code = clanCode(Clan.get());
        try { navigator.clipboard?.writeText(code).then(() => menu.toast('Join code copied'), () => menu.toast(code)); } catch { menu.toast(code); }
      },
      clLeave: () => {
        if (!leaving) { leaving = true; render(); return; }
        const c = Clan.get();
        leaving = false;
        Clan.leave();
        menu.toast(`Left [${c?.tag}]`);
        changed();
        render();
      },
    });
  };
  render();
  menu.show();
}
