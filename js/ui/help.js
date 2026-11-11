// How to play, as four tabs so nothing scrolls at 390 px tall. The Training button replays the guided match
// (js/game/tutorial.js) whenever the player wants it. Everything here restates rules that live in the sim;
// the streak section is the one players ask about most.
import { STREAKS, TACTICALS, LETHALS, PERKS } from '../shared/catalog.js';
import { esc } from './widgets.js';
import { ico, header } from './yard.js';
import { stagger } from './motion.js';

const TABS = [['controls', 'Controls', 'controls'], ['weapons', 'Weapons', 'cat:Assault'], ['streaks', 'Streaks', 'uav'], ['modes', 'Modes', 'mode:dom'], ['tips', 'Tips', 'info']];

// One help card: an icon, a stencil heading and a sentence or two.
const card = (icon, title, body, wide = false) => `<div class="help-card${wide ? ' wide' : ''}"><h4>${ico(icon)}<span>${esc(title)}</span></h4><p>${body}</p></div>`;

// One weapon stat: what the bar in the Gunsmith measures and what it means in a fight.
const stat = (name, body) => `<div class="help-stat"><dt>${esc(name)}</dt><dd>${body}</dd></div>`;

const PANELS = {
  weapons: () => `
    <dl class="help-stats scroll-y">
      ${stat('Damage', 'Damage of one shot at close range. Shotguns show all pellets together: inside the first range number a pump or double-barrel kills in one shell if most of the fan lands, so put the middle of it on the body. Everyone has 100 health, which comes back on its own a few seconds after you stop taking hits.')}
      ${stat('Headshots', 'The head is a small zone at the centre of a player. <b>Aimed in</b>, a headshot kills in one hit with any gun. <b>From the hip</b> it does 1.6&times; damage instead. Marksman rifles and snipers kill with a headshot either way. Explosives have no headshots.')}
      ${stat('Fire rate', 'Shots per minute (RPM). Every gun fires while you hold the trigger, semi-autos and snipers included, at their own pace.')}
      ${stat('Range', 'Shown as three numbers: full damage out to the first, fading to its lowest by the second, and nothing at all past the third. Bullets simply stop at the last one, so shots beyond it miss.')}
      ${stat('Pierce', 'How much damage a round keeps after passing through <b>waist-high cover</b> such as crates and barriers. 70% means a 30 damage shot still does 21. It goes through at most two pieces. Most SMGs, pistols and shotguns have no pierce, nor do crossbow bolts: crates stop them. The Ballast SMG and the Railspike slug gun are the exceptions. Buildings, containers and walls stop every gun. Your own cover never counts: you can always fire over a crate you are crouched behind.')}
      ${stat('Aimed fire', 'Spread while aimed in. Lower is tighter. You aim in by holding the right stick with the move stick below about 70%; at a full push you hip-fire instead.')}
      ${stat('Hip fire', 'Spread when firing without aiming, including at a full sprint push. Moving widens it by up to half, and each shot adds bloom, which settles back when you stop. The Skitter, Rasp, Shunter, Prospector, Squall, Flicker and Gnat shoot straight out of a slide; every other gun sprays wider in one.')}
      ${stat('Aim assist', 'While your aim is on or just beside an enemy you can see, within 30 m, part of your thumb\'s wobble is cancelled and your aim follows part of the target\'s sideways movement, a little more when aimed in. It never turns onto a target for you and lets go when you pull away. Strength is in Options.')}
      ${stat('Recoil', 'How far the gun pulls and sways while you hold the trigger. Grips and compensators tame it.')}
      ${stat('Aim speed', 'Time to get fully aimed in. Until then the gun fires as hip fire, and a headshot is not yet a one-hit kill.')}
      ${stat('Handling', 'Sprint-to-fire delay and swap time together: how quickly you can shoot after sprinting or switching guns. A slide pays off most of the sprint delay.')}
      ${stat('Mobility', 'Move speed with the gun out, and how much aiming slows you.')}
      ${stat('Magazine and reload', 'Rounds before a reload, and its time. Reloads are automatic when empty, and top up after a short pause if you are low. Firing cancels a top-up.')}
      ${stat('Swing speed', 'Heavy guns turn slowly while aiming or firing: a flanker can get round you. Light guns have no limit.')}
      ${stat('Heat (LMGs)', 'Rounds in a long burst before the barrel overheats and locks for about two seconds. Fire in bursts to let it cool. You can still swap to your sidearm.')}
      ${stat('Blast radius (launchers)', 'Metres an explosion reaches. Damage is highest at the centre and falls off to the edge. Walls block it.')}
      ${stat('Charge shot (Lodestone)', 'Hold the trigger: the bar fills for about half a second and the round then leaves by itself. Let go early and the charge drains away. Keep the sights on the target while it fills.')}
      ${stat('Settling (Stanchion)', 'Its first rounds scatter and every round after lands tighter, until a long burst is the most accurate automatic fire there is. Stop firing and it has to settle again. The Flywheel does the same with fire rate: it starts slow and winds up.')}
      ${stat('Heat rifle (Kiln)', 'Works like an LMG heat bar on a rifle: no bloom at all and a 75-round magazine, but hold it down and it locks. Short strings.')}
      ${stat('Melee (Gaff, Maul)', 'Sidearm-slot weapons with no ammunition and no sound. A swing reaches about three metres along your aim and throws you a step forward. The Gaff kills in two quick swings, the Maul in one slow one.')}
    </dl>`,
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
        <li><b>Cruise Missile</b>: it flies where your aim stick points for a few seconds and goes off near an enemy or on a building. <b>Drone Swarm</b>: three drones dive on enemies your team can see; break their sight to lose them. <b>Juggernaut</b>: 300 armour over your health until you die; explosives cut through it.</li>
      </ol>
    </div>`,
  modes: () => `
    <div class="help-grid scroll-y">
      ${card('mode:tdm', 'Team Deathmatch', 'First team to the kill limit wins.')}
      ${card('mode:kc', 'Kill Confirmed', 'Collect enemy tags to score. Grab your own team\'s to deny.')}
      ${card('mode:dom', 'Domination', 'Hold the three flags. More flags, faster points.')}
      ${card('mode:hard', 'Hardpoint', 'One zone at a time. Hold it to score, and it moves.')}
      ${card('mode:snd', 'Search and Destroy', 'One life per round, first to 4 rounds. Attackers plant the bomb at A or B; defenders stop them or defuse it. Out? You spectate your team.')}
      ${card('mode:ctf', 'Capture the Flag', 'Take the enemy flag home to score, first to 3. Your own flag must be home. Touch a dropped flag of yours to return it.')}
      ${card('mode:ffa', 'Free-for-All', 'Everyone for themselves. Most kills wins.')}
      ${card('mode:gun', 'Gun Game', 'Every kill moves you to the next gun. A kill with the last one wins. A thrown kill knocks the victim back a gun.')}
      ${card('mode:gwtdm', 'Ground War', '16 v 16 on the large map, as Team Deathmatch or five-flag Domination.')}
      ${card('ui:aim', 'Firing Range', 'Your loadout, dummies at marked distances, instant reloads and a live damage readout. Open it from the main menu.', true)}
    </div>`,
  tips: () => `
    <div class="help-grid scroll-y">
      ${card('ui:eye-off', 'Stay off the radar', 'Firing marks you on the enemy minimap for a moment. A suppressor hides it.')}
      ${card('cat:LMG', 'Beat the big guns', 'LMGs turn slowly while firing and overheat. Flank them.')}
      ${card('flash', 'Equipment', `${Object.values({ ...TACTICALS, ...LETHALS }).map(t => esc(t.name)).join(', ')}. Counts refill when you respawn.`)}
      ${card('stun', 'Stun, Gas, Shock', '<b>Stun</b> slows you and drags your aim for a few seconds. <b>Gas</b> lingers, chips health and slows anyone inside; walk out. <b>Shock</b> sticks and arcs three times, jolting players and frying mines, Claymores, Trophies, Sensors and Decoys. Tac Mask shortens stuns and ignores gas.', true)}
      ${card('claymore', 'Impact, Claymore, Drill', '<b>Impact</b> goes off the moment it touches anything, a player included. <b>Claymore</b> faces the way you throw it and fires a cone at enemies who walk in front; its lasers give it away. <b>Drill</b> bores through thin cover and goes off on the far side: its landing ring shows where.', true)}
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
