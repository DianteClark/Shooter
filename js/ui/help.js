// How to play, as four tabs so nothing scrolls at 390 px tall. Everything here restates rules that live in the sim;
// the streak section is the one players ask about most.
import { STREAKS, TACTICALS, LETHALS, PERKS } from '../shared/catalog.js';
import { ITEM_ICONS } from './icons.js';
import { esc } from './widgets.js';

const TABS = [['controls', 'Controls'], ['streaks', 'Streaks'], ['modes', 'Modes'], ['tips', 'Tips']];

const glyph = id => (ITEM_ICONS[id] ? `<svg class="item-svg" viewBox="0 0 32 32" aria-hidden="true">${ITEM_ICONS[id]}</svg>` : '');

const PANELS = {
  controls: () => `
    <div class="help-grid">
      <div class="help-card"><h4>Left thumb</h4><p>Drag anywhere on the left half to move. Push all the way to sprint.</p></div>
      <div class="help-card"><h4>Right thumb</h4><p>Touch and hold to aim. Push past the outer ring to fire. Let go and you are back to hip fire.</p></div>
      <div class="help-card"><h4>Slide</h4><p>Tap while moving. You are a smaller target while you slide.</p></div>
      <div class="help-card"><h4>Swap</h4><p>Switches to your sidearm. Reloads are automatic, so swap when you are out.</p></div>
      <div class="help-card wide"><h4>Tactical and Lethal</h4><p>Tap to throw where you are aiming. Hold and drag from the button to set direction and distance: an arc shows where it lands. Drag back onto the button to cancel.</p></div>
    </div>`,
  streaks: () => `
    <div class="help-streaks">
      <div class="help-strip">${Object.values(STREAKS).map(s => `<span class="help-chip">${glyph(s.id)}<b>${esc(s.name)}</b><em>${s.cost}</em></span>`).join('')}</div>
      <ol class="help-rules">
        <li>Kills score 100, headshots +25, assists 50. <b>Dying resets your score to 0</b>, but streaks you already hold stay.</li>
        <li>You carry three. Each is granted when your score reaches its cost. Hardline makes them 15% cheaper.</li>
        <li>Once nothing left can be earned your score is <b>capped</b>; calling one then resets it and clears blocks. Calling early keeps your score but <b>blocks</b> that streak until the next reset.</li>
        <li><b>Airspace</b> holds a few aircraft at once and one Gunship per team. A refused call keeps the streak and its tile says why: Already up or Airspace full.</li>
      </ol>
    </div>`,
  modes: () => `
    <div class="help-grid">
      <div class="help-card"><h4>Team Deathmatch</h4><p>First team to the kill limit wins.</p></div>
      <div class="help-card"><h4>Kill Confirmed</h4><p>Collect enemy tags to score. Grab your own team's to deny.</p></div>
      <div class="help-card"><h4>Domination</h4><p>Hold the three flags. More flags, faster points.</p></div>
      <div class="help-card"><h4>Hardpoint</h4><p>One zone at a time. Hold it to score, and it moves.</p></div>
      <div class="help-card wide"><h4>Firing Range</h4><p>Your loadout, stationary and strafing dummies at marked distances, instant reloads and a live damage readout. Open it from the main menu.</p></div>
    </div>`,
  tips: () => `
    <div class="help-grid">
      <div class="help-card"><h4>Stay off the radar</h4><p>Firing marks you on the enemy minimap for a moment. A suppressor hides it.</p></div>
      <div class="help-card"><h4>Beat the big guns</h4><p>LMGs turn slowly while firing and overheat. Flank them.</p></div>
      <div class="help-card"><h4>Equipment</h4><p>${Object.values({ ...TACTICALS, ...LETHALS }).map(t => esc(t.name)).join(', ')}. Counts refill when you respawn.</p></div>
      <div class="help-card"><h4>Perks</h4><p>${Object.values(PERKS).slice(0, 5).map(p => esc(p.name)).join(', ')}. One from each tier.</p></div>
      <div class="help-card wide"><h4>Dropped connection?</h4><p>Open the app and enter the same room code. You get your slot back from the bot holding it, with your score. If the host leaves, the next player takes over and the match carries on.</p></div>
    </div>`,
};

export function helpScreen(menu, { onBack }) {
  let tab = 'controls';
  menu.el.dataset.screen = 'help';
  menu.el.innerHTML = `
    <header class="bar">
      <button class="back" data-act="helpBack">Back</button>
      <h2>How to play</h2>
      <nav class="help-tabs">${TABS.map(([id, label]) => `<button class="seg" data-act="helpTab" data-tab="${id}">${label}</button>`).join('')}</nav>
    </header>
    <div class="help-body"></div>`;
  const body = menu.el.querySelector('.help-body');
  const tabs = [...menu.el.querySelectorAll('.help-tabs .seg')];
  const paint = () => {
    body.innerHTML = PANELS[tab]();
    body.firstElementChild.classList.add('enter');
    for (const t of tabs) t.classList.toggle('on', t.dataset.tab === tab);
  };
  menu.on({
    helpBack: () => onBack(),
    helpTab: ({ tab: next }) => { tab = next; paint(); },
  });
  paint();
  menu.show();
}
