// How to play, as four tabs so nothing scrolls at 390 px tall. The Training button replays the guided match
// (js/game/tutorial.js) whenever the player wants it. Everything here restates rules that live in the sim;
// the streak section is the one players ask about most.
import { STREAKS, TACTICALS, LETHALS, PERKS } from '../shared/catalog.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';
import { stagger } from './motion.js';

const TABS = [['controls', 'Controls', 'controls'], ['streaks', 'Streaks', 'uav'], ['modes', 'Modes', 'mode:dom'], ['tips', 'Tips', 'info']];

// One help card: an icon, a stencil heading and a sentence or two.
const card = (icon, title, body, wide = false) => `<div class="help-card${wide ? ' wide' : ''}"><h4>${ico(icon)}<span>${esc(title)}</span></h4><p>${body}</p></div>`;

const PANELS = {
  controls: () => `
    <div class="help-grid">
      ${card('marathon', 'Left thumb', 'Drag anywhere on the left half to move. Push all the way to sprint. While firing, a full push keeps you hip-firing at full speed; ease below about 70% to settle into aiming down sights.')}
      ${card('ui:aim', 'Right thumb', 'Touch and hold to aim. Push past the outer ring to fire. Let go and you are back to hip fire.')}
      ${card('slide', 'Slide', 'Tap while moving. You are a smaller target while you slide.')}
      ${card('swap', 'Swap', 'Switches to your sidearm. Reloads are automatic, so swap when you are out.')}
      ${card('frag', 'Tactical and lethal', 'Tap to throw where you are aiming. Hold and drag from the button to set direction and distance: an arc shows where it lands. Drag back onto the button to cancel.', true)}
    </div>`,
  streaks: () => `
    <div class="help-streaks">
      <div class="help-strip">${Object.values(STREAKS).map(s => `<span class="help-chip">${ico(s.id)}<b>${esc(s.name)}</b><em>${s.cost}</em></span>`).join('')}</div>
      <ol class="help-rules">
        <li>Kills score 100, headshots +25, assists 50. <b>Your score carries through death</b>, and streaks you already hold stay. Costs are high, so streaks still take real play.</li>
        <li>You carry three. Each is granted when your score reaches its cost. Hardline makes them 15% cheaper.</li>
        <li>Once nothing left can be earned your score is <b>capped</b>; calling one then resets it and clears blocks. Calling early keeps your score but <b>blocks</b> that streak until the next reset.</li>
        <li><b>Airspace</b> holds a few aircraft at once and one Gunship per team. A refused call keeps the streak and its tile says why: Already up or Airspace full.</li>
      </ol>
    </div>`,
  modes: () => `
    <div class="help-grid">
      ${card('mode:tdm', 'Team Deathmatch', 'First team to the kill limit wins.')}
      ${card('mode:kc', 'Kill Confirmed', 'Collect enemy tags to score. Grab your own team\'s to deny.')}
      ${card('mode:dom', 'Domination', 'Hold the three flags. More flags, faster points.')}
      ${card('mode:hard', 'Hardpoint', 'One zone at a time. Hold it to score, and it moves.')}
      ${card('ui:aim', 'Firing Range', 'Your loadout, stationary and strafing dummies at marked distances, instant reloads and a live damage readout. Open it from the main menu.', true)}
    </div>`,
  tips: () => `
    <div class="help-grid">
      ${card('ui:eye-off', 'Stay off the radar', 'Firing marks you on the enemy minimap for a moment. A suppressor hides it.')}
      ${card('cat:LMG', 'Beat the big guns', 'LMGs turn slowly while firing and overheat. Flank them.')}
      ${card('flash', 'Equipment', `${Object.values({ ...TACTICALS, ...LETHALS }).map(t => esc(t.name)).join(', ')}. Counts refill when you respawn.`)}
      ${card('ui:star', 'Perks', `${Object.values(PERKS).slice(0, 5).map(p => esc(p.name)).join(', ')}. One from each tier.`)}
      ${card('ui:refresh', 'Dropped connection?', 'Open the app and enter the same room code. You get your slot back from the bot holding it, with your score. If the host leaves, the next player takes over and the match carries on.', true)}
    </div>`,
};

export function helpScreen(menu, { onBack, onTutorial }) {
  let tab = 'controls';
  menu.el.dataset.screen = 'help';
  const training = onTutorial ? `<button class="btn is-primary help-tut" data-sound="confirm" data-act="helpTutorial">${ico('play')}<b>Training</b></button>` : '';
  menu.el.innerHTML = `
    ${header({ back: 'helpBack', title: 'How to play', extra: `<nav class="help-tabs">${TABS.map(([id, label, icon]) => `<button class="seg" data-act="helpTab" data-tab="${id}">${ico(icon)}<b>${label}</b></button>`).join('')}</nav>${training}` })}
    <div class="help-body"></div>`;
  const body = menu.el.querySelector('.help-body');
  const tabs = [...menu.el.querySelectorAll('.help-tabs .seg')];
  const paint = () => {
    body.innerHTML = PANELS[tab]();
    stagger(body.querySelectorAll('.help-card, .help-chip, .help-rules li'), 'up', { step: 25, max: 12 });
    for (const t of tabs) t.classList.toggle('on', t.dataset.tab === tab);
  };
  menu.on({
    helpBack: () => onBack(),
    helpTutorial: () => onTutorial?.(),
    helpTab: ({ tab: next }) => { tab = next; paint(); },
  });
  paint();
  menu.show();
}
