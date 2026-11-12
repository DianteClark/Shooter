// In-match overlay. Built once; update() runs every frame and touches the DOM only when a displayed value
// actually changes, and then only with text, a transform or a class flip.
import { TEAMS, MAX_HP, SCORE_LIMIT, TIME_LIMIT, GOLDEN_ID, RESPAWN_TIME } from '../shared/constants.js';
import { WEAPONS, effectiveWeapon } from '../shared/weapons.js';
import { MAPS, DEFAULT_MAP } from '../shared/map.js';
import { hasLineOfSight } from '../shared/geometry.js';
import { STREAKS, STREAK_DENY_TEXT, LETHALS, SCORE, PRO, normalizeLoadout } from '../shared/catalog.js';
import { GUN_LADDER, isBr, isEx, isFfa, MODES, modeRules, SND, CTF } from '../shared/modes.js';
import { BrHud } from './br-hud.js';    // Battle royale layer (docs/BR.md).
import { ExHud, AI_CSS } from './ex-hud.js';    // Extraction layer (docs/EXTRACT.md).
import { ZmHud } from './zm-hud.js';            // Graveyard Shift layer (docs/ZOMBIES.md).
import { ModeHud } from './mode-hud.js';    // The modes overhaul's layer (docs/MODES.md).
import { playlistName } from '../shared/playlist.js';
import { Progress, matchScore } from './progress.js';
import { badgeMark, nameHtml, weaponLevelHtml } from './widgets.js';
import { LOADOUT_COUNT } from '../shared/progression.js';
import { safeInsets } from './viewport.js';
import { Options } from './options.js';
import { icon, resolveIcon } from './icons.js';
import { ArmorySheet } from './trainarmory.js';
import { cardHtml, identityOf, setRosterIdentity, vetOf, vetTag } from './cards.js';
import { Footprints, heardEnemies, HEAR_RANGE, RESPAWN_IDLE } from '../sim/player.js';
import { effectRadius } from '../sim/equipment.js';
import { sndOf, spectate } from '../sim/snd.js';
import { ctfOf } from '../sim/ctf.js';

// One icon from the shared set at a given height (weapons come out 2.5x as wide), or '' when the set has no drawing
// for that id, so callers can fall back to words.
export function glyph(id, size = 20, cls = 'gl') {
  if (id == null || resolveIcon(id) === 'unknown') return '';
  return icon(id, { size, cls });
}

const MINIMAP_HZ = 10;
const MM_SCALE = 2;              // Backing-store pixels per CSS pixel; fixed so the canvas is never resized.
const MM_WIDTH = 118;            // CSS pixels; the height follows the map's aspect.
const FEED_ROWS = 3;              // Short and quick: the feed never reaches down to the move stick.
const FEED_LIFE = 4;
const FEED_ROW_H = 22;            // A feed row and its gap.
const HUD_SCALE = { small: 0.88, normal: 1, large: 1.14 };   // Options: HUD size.
const DOCK_BOTTOM = 6;           // Health and the tiles sit this far off the bottom edge.
const DOCK_GAP = 4;
const LANE_H = 46;               // The prompt lane over the dock.
const LANE_MAX = 300;
const OUT_H = 46;                // The battle royale's out plate while watching.
const ARMS_EDGE = 8;             // The weapon panel's inset from the side.
const STRIP_ROW_H = [36, 30, 24];   // Least height kept for each objective strip row (content comes and goes).
const HIT_LIFE = 0.22;
const DMG_LIFE = 1.3;
const MEDAL_LIFE = 1.6;
const MEDAL_GAP = 0.55;
const LOW_AMMO = 0.25;
const SKULL_LIFE = 0.55;         // A kill marker lingers longer than a hit tick so it registers mid-fight.
const HEAT_WARN = 0.72;          // Heat fraction where the bar starts to pulse.
const FLASH_HOLD = 1.6;          // Seconds of solid white at full flash strength, before the fade.
const FLASH_FADE = 1.8;
const FIRE_REVEAL = 1.5;         // Matches the sim's firingT lifetime; only shapes the minimap ping's fade.
const BOARD_HZ = 4;
const END_BANNER_MIN = 700;
const OBJ_RING = 2 * Math.PI * 14;
const DEATH_RING = 2 * Math.PI * 26;
// Respawn: while dead, a respawn request (the tap, or the one sent at death with auto-respawn on) is sent again this
// often until the spawn arrives. It is idempotent on the host, and resending covers a host migration.
const RESPAWN_RESEND = 1;
const GOLD_CSS = '#ffcf40';  // Circumference of the capture rings' r=14 circle, for stroke dashes.
// Objective markers ride inside the safe area plus these margins, and walk inward off anything in markObstacles.
const MARK_PAD_X = 34;
const MARK_PAD_T = 56;
const MARK_PAD_B = 100;
const MARK_CLEAR = 30;           // A marker's radius plus its arrow: how far a marker keeps from what it must not cover.
const MARK_WALK = 0.05;          // Fraction of the way in per step when walking a marker clear.
const MARK_Y = { dom: 4.3, hard: 3.6 };   // Metres above the ground to pin a marker: flag tip or zone wall.
const HARD_WARN = 5;             // Seconds of warning before a hardpoint moves.
const DPS_WINDOW = 2.4;
const INCOMING_WARN_M = 9;       // An enemy shell landing this close gets a callout.
const INCOMING_GAP_MS = 1500;    // A five-shell barrage is one warning, not five.
const STATIC_FRAMES = 3;         // Pre-drawn noise frames the jammed minimap cycles through.
// Feed wording per streak, after its name: "Enemy Airstrike inbound".
const STREAK_VERB = {
  uav: 'online', jammer: 'jamming radar', resupply: 'dropped', turret: 'deployed', mortar: 'firing',
  strike: 'inbound', overwatch: 'online', chopper: 'overhead', emp: 'detonated', gunship: 'overhead',
  missile: 'launched', swarm: 'launched', juggernaut: 'suited up',
  sweep: 'pinging', recon: 'launched', airdrop: 'inbound', plates: 'dropped', hound: 'deployed', dome: 'raised', bombrun: 'inbound', rover: 'deployed',
};
// Enemy streaks the local player should react to right now.
const STREAK_WARN = { jammer: 'Radar jammed', strike: 'Airstrike inbound', mortar: 'Mortars incoming', overwatch: 'Enemy Overwatch: Ghost is off', chopper: 'Enemy chopper', gunship: 'Enemy gunship', emp: 'EMP: streaks offline', missile: 'Cruise missile inbound', swarm: 'Drone swarm: break line of sight', juggernaut: 'Enemy Juggernaut: use explosives',
  sweep: 'Sonar sweep: you may be on their map', recon: 'Enemy recon drone: shoot it down', hound: 'Enemy Wingman drone', dome: 'Aegis Dome: fight inside it',
  bombrun: 'Carpet Line: get off the red line', rover: 'Enemy Rover: shoot it' };
// V9: what a piloted streak tells its own pilot, and how a shoot-down reads.
const PILOT_HINT = { missile: 'Steer it with the aim stick', recon: 'Hold the aim stick to fly it', bombrun: 'Drag the aim stick, let go to drop' };          // Seconds of hits averaged into the live damage readout.
const RANGE_HZ = 6;              // The readout repaints this often; it would be unreadable any faster.
// Pro senses drawn by the HUD (js/shared/catalog.js PRO): footprints, the Fastball blast ring, enemy equipment.
const PRINT_HZ = 12;             // Footprint line-of-sight checks per second; drawing still follows the camera every frame.
const SEEN_GEAR = new Set(['mine', 'trophy', 'sensor', 'decoy', 'sticky', 'claymore', 'drill', 'shock', 'charge', 'tripwire', 'crawler', 'medpack', 'bulwark', 'thermite']);   // What Hijacker sees through walls.
const NO_PRO = Object.freeze([]);
const NO_STATS = Object.freeze({});
const FFA_FOE = '#ff6a4d';        // Free-for-all: "an enemy" when it is not one particular player (footprints, edge tints).
const ORDINAL = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
// Free-for-all standings: score, then fewer deaths, then more kills (the sim's own order for the winner).
const ffaRank = (view, list = view.players) => list.filter(p => !p.dummy && !p.ai).sort((a, b) =>
  ((view.scores[b.team] ?? 0) - (view.scores[a.team] ?? 0)) || (a.deaths - b.deaths) || (b.kills - a.kills));
const PRO_LINE = { scavenger: '+1 equipment', bandolier: 'Equipment restocked', adrenaline: '25% less damage', engineer: 'The Sentry is yours' };
const TIPS = [
  'Slide through a doorway to shrink as a target.',
  'Firing reveals you on the enemy minimap. Suppressors hide it.',
  'Hold a grenade button and drag to place the throw.',
  'A capped score resets when you call a streak, so call them.',
  'Swap instead of reloading when someone is on you.',
];

// [title, line under it, tier]. Tier sets the plate: 1 steel, 2 sodium, 3 sodium with hazard stripes.
const MEDALS = {
  confirm: ['Tag Confirmed', `+${SCORE.confirm}`, 1], deny: ['Tag Denied', `+${SCORE.deny}`, 1],
  capture: ['Captured', `+${SCORE.capture}`, 1], defend: ['Defended', `+${SCORE.defend}`, 1],
  headshot: ['Headshot', `+${SCORE.headshot}`, 1],
  first_blood: ['First Blood', 'Round opener', 2], double: ['Double Kill', '2 in quick order', 2], triple: ['Triple Kill', '3 in quick order', 2],
  fury: ['Fury Kill', '4 or more', 3], revenge: ['Revenge', 'Settled the score', 1], longshot: ['Longshot', 'From across the yard', 1],
  streak3: ['Three Streak', 'On a run', 2], streak5: ['Five Streak', 'Unstoppable', 3], streak10: ['Ten Streak', 'Unbroken', 3],
  golden: ['Golden Kill', 'One round, one kill', 3],
  shootdown: ['Shot Down', 'Enemy streak destroyed', 2], destroyed: ['Destroyed', 'Enemy machine wrecked', 1],
  plant: ['Bomb Planted', 'Now hold it', 2], defuse: ['Bomb Defused', 'Saved the site', 3], clutch: ['Clutch', 'Won it alone', 3],
  flag_take: ['Flag Taken', `+${CTF.score.take}`, 2], flag_capture: ['Flag Captured', `+${CTF.score.capture}`, 3],
  flag_return: ['Flag Returned', `+${CTF.score.ret}`, 1], carrier_kill: ['Carrier Killed', `+${CTF.score.carrierKill}`, 2],
  flag_defend: ['Flag Defense', `+${CTF.score.defend}`, 1],
  // Modes overhaul (docs/MODES.md).
  hq_capture: ['HQ Captured', `+${SCORE.capture}`, 2], hq_destroy: ['HQ Destroyed', '+150', 3],
  vip_kill: ['VIP Killed', '+300', 3], bodyguard: ['Bodyguard', 'Saved your VIP', 1],
  infect: ['Infection', '+100', 1], first_infected: ['Patient Zero', 'Spread it', 2], last_stand: ['Last Stand', 'Outlasted them all', 3],
  survivor: ['Survivor', 'Made it to the end', 2], oic_last: ['Last Gun Standing', 'One round to spare', 3],
  ctl_capture: ['Zone Taken', `+${SCORE.capture}`, 2], ctl_hold: ['Held the Line', '+150', 2], grind_bank: ['Tags Banked', 'Points on the board', 2],
};

// Search and Destroy wording. Why a round ended, from the winner's side and the loser's.
const SND_WHY = {
  elim: ['Enemy team eliminated', 'Your team was eliminated'],
  bomb: ['The bomb detonated', 'The bomb detonated'],
  defuse: ['The bomb was defused', 'The bomb was defused'],
  time: ['Time ran out before a plant', 'Time ran out before a plant'],
};
const SND_RING = 2 * Math.PI * 26;
// The S&D layer's own rules. Values come from the shared tokens; it lives here because it is part of the HUD's markup.
const SND_CSS = `
.hud .snd-ui { display: none; }
.hud.snd-on .snd-ui:not([hidden]) { display: flex; }
.hud.snd-on .sb-track { display: none; }
.snd-pips { position: absolute; left: 18px; right: 18px; bottom: 1px; height: 4px; gap: 3px; }
.hud.snd-on .snd-pips { display: flex; }
.theirs .snd-pips { flex-direction: row-reverse; }
.snd-pips i { flex: 1; background: rgba(231,234,228,.3); transform: skewX(-24deg); }
.snd-pips i.on { background: var(--team); box-shadow: 0 0 6px var(--team); }
.snd-alive { align-items: center; gap: 8px;
  padding: 3px 8px; pointer-events: none; background: var(--hud-glass-lo); box-shadow: var(--hud-edge); }
.sa-side { display: flex; gap: 2px; }
.sa-side.theirs { flex-direction: row-reverse; }
.sa-p { position: relative; width: 14px; height: 16px; display: grid; place-items: center; color: var(--team); line-height: 0; transition: opacity var(--dur-fast); }
.sa-p.dead { opacity: .22; color: var(--c-haze); }
.sa-p.me::after { content: ''; position: absolute; left: 2px; right: 2px; bottom: -2px; height: 2px; background: var(--c-chalk); }
.sa-p .sa-bomb { position: absolute; right: -5px; top: -5px; color: var(--c-sodium); filter: drop-shadow(0 0 3px rgba(242,166,59,.8)); }
.sa-mid { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 52px; }
.sa-mid b { font: 400 13px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); }
.sa-mid small { font: var(--fs-micro)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-sodium); }
.sa-mid small[data-role="defend"] { color: var(--c-blue, #38b6ff); }
.death.snd-life-buy, .death.snd-life-spec { background: none; pointer-events: none; }
.death.snd-life-buy .death-top, .death.snd-life-spec .death-top, .death.snd-life-buy .death-go, .death.snd-life-spec .death-go { display: none !important; }
/* During a death replay the Next round line drops below the killcam banner and the alive strip. */
.killcam-on .hud.snd-on .death-col { top: calc(var(--st) + 96px); }
.snd-marks { position: absolute; inset: 0; pointer-events: none; }
.snd-mark { position: absolute; left: 0; top: 0; width: 0; height: 0; display: block; }
.snd-mark[hidden] { display: none; }
.sm-plate { position: absolute; left: -15px; top: -15px; width: 30px; height: 30px; display: grid; place-items: center;
  font: 400 17px/1 var(--f-stencil); color: var(--c-sodium-ink, #2a1a06); background: var(--c-sodium); transform: rotate(45deg);
  box-shadow: 0 0 0 2px rgba(16,20,26,.75), 0 0 12px rgba(242,166,59,.55); }
.sm-plate > * { transform: rotate(-45deg); line-height: 0; }
.snd-mark small { position: absolute; left: -40px; width: 80px; top: 19px; text-align: center; font: 400 12px/1 var(--f-stencil);
  letter-spacing: var(--tr-stencil); color: var(--c-chalk); text-shadow: 0 1px 2px rgba(0,0,0,.9); white-space: nowrap; }
.snd-mark[data-state="dim"] { opacity: .55; }
.snd-mark[data-state="dim"] .sm-plate { background: var(--c-plate, #3a434d); color: var(--c-chalk); box-shadow: 0 0 0 2px rgba(16,20,26,.75); }
.snd-mark[data-state="planted"] .sm-plate { background: var(--c-red, #ff4d3d); color: #fff; animation: snd-blink .5s steps(2, jump-none) infinite alternate; box-shadow: 0 0 0 2px rgba(16,20,26,.75), 0 0 16px rgba(255,77,61,.8); }
.snd-mark[data-state="planted"] small { color: #ffb3a8; font-size: 15px; }
.snd-mark.bomb .sm-plate { background: rgba(16,20,26,.85); color: var(--c-sodium); box-shadow: 0 0 0 2px var(--c-sodium), 0 0 10px rgba(242,166,59,.5); }
.sm-arrow { position: absolute; left: -6px; top: -6px; width: 12px; height: 12px; display: none; }
.sm-arrow::before { content: ''; position: absolute; inset: 0; background: var(--c-chalk); clip-path: polygon(0 0, 100% 50%, 0 100%, 30% 50%); }
.snd-mark.off .sm-arrow { display: block; }
@keyframes snd-blink { to { filter: brightness(1.5); } }
.snd-ring { position: absolute; left: 50%; top: 69%; transform: translate(-50%, -50%); flex-direction: column; align-items: center; gap: 4px; pointer-events: none; }
.snd-ring svg { width: 52px; height: 52px; overflow: visible; }
.sr-track { fill: rgba(16,20,26,.8); stroke: rgba(231,234,228,.18); stroke-width: 5; }
.sr-arc { fill: none; stroke: var(--rc, var(--c-sodium)); stroke-width: 5; stroke-dasharray: 163.4; stroke-dashoffset: 163.4; }
.sr-ico { position: absolute; top: 15px; color: var(--rc, var(--c-sodium)); line-height: 0; }
.snd-ring b { font: 400 18px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); text-shadow: 0 1px 3px rgba(0,0,0,.9); }
.snd-ring small { font: var(--fs-micro)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); text-shadow: var(--text-lift); }
.snd-ring[data-kind="defuse"] { --rc: var(--c-blue, #38b6ff); }
.snd-ring[data-kind="enemy"] { --rc: var(--c-red, #ff4d3d); }
.snd-carry, .snd-spec { position: absolute; left: var(--lane-x, 50%); bottom: var(--lane-b, 60px); transform: translateX(-50%); max-width: var(--lane-w, 300px); align-items: center; gap: 10px;
  padding: 6px 14px 7px 12px; background: var(--hud-glass); box-shadow: var(--hud-edge), inset 0 -2px 0 var(--c-sodium);
  --cut: var(--cut-sm); clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
.snd-carry { pointer-events: none; color: var(--c-sodium); }
.snd-carry span, .snd-spec span { display: flex; flex-direction: column; gap: 3px; }
.snd-carry b, .snd-spec b { font: 400 16px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); white-space: nowrap; }
.snd-carry small, .snd-spec small { font: var(--fs-micro)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); white-space: nowrap; }
.snd-spec { pointer-events: auto; touch-action: manipulation; min-height: 44px; min-width: 220px; justify-content: space-between; box-shadow: var(--hud-edge), inset 0 -2px 0 var(--my-team); }
.snd-spec .ss-arrow { flex: none; color: var(--c-chalk); font: 400 22px/1 var(--f-stencil); padding: 0 4px; }
.snd-spec b { color: var(--my-team); }
.snd-spec:active { filter: brightness(1.3); }
.snd-big { position: absolute; left: 0; right: 0; top: 33%; flex-direction: column; align-items: center; pointer-events: none; z-index: var(--z-hud-alert);
  padding: 8px 0 10px; background: linear-gradient(90deg, transparent, rgba(16,20,26,.86) 22%, rgba(16,20,26,.86) 78%, transparent); }
.snd-big .sbg-kick { font: var(--fs-caption)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-sodium); }
.snd-big b { font: 400 46px/1 var(--f-stencil); letter-spacing: .05em; color: var(--sb-c, var(--c-chalk)); margin-top: 3px;
  text-shadow: 0 0 22px color-mix(in srgb, var(--sb-c, #fff) 40%, transparent), 0 3px 0 rgba(0,0,0,.5); }
.snd-big .sbg-sub { font: var(--fs-body)/1.15 var(--f-body); color: var(--c-haze); margin-top: 4px; }
.snd-big .sbg-count { margin-top: 6px; font: 400 26px/1 var(--f-stencil); color: var(--c-chalk); }
.snd-big[data-side="mine"] { --sb-c: var(--my-team); }
.snd-big[data-side="enemy"] { --sb-c: var(--enemy-team); }
.snd-big[data-side="gold"] { --sb-c: var(--c-gold, #ffcf40); }
.hud.snd-out .status { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .snd-mark[data-state="planted"] .sm-plate { animation: none; } }
`;
// V8 equipment: being stunned, gassed or shocked. An edge veil in the effect's colour that fades with the effect, a
// motion of its own (stun sways, gas breathes, shock flickers) and a stencil tag, so the slowed stick is explained.
// Transform and opacity only; the veil never takes a touch (.hud has pointer-events: none).
const DAZE_CSS = `
.daze-veil { position: absolute; inset: -4%; opacity: 0; pointer-events: none; will-change: opacity, transform; z-index: var(--z-overlay); }
.daze-veil[data-kind="stun"] { background: radial-gradient(ellipse at center, transparent 30%, rgba(255,246,214,.3) 55%, rgba(255,236,190,.82)); animation: daze-sway 1.1s var(--ease-inout) infinite alternate; }
.daze-veil[data-kind="gas"] { background: radial-gradient(ellipse at center, transparent 30%, rgba(120,190,40,.28) 55%, rgba(70,120,20,.72)); animation: daze-breathe 1.6s var(--ease-inout) infinite alternate; }
.daze-veil[data-kind="shock"] { background: radial-gradient(ellipse at center, transparent 42%, rgba(80,200,255,.2) 62%, rgba(150,230,255,.7)); animation: daze-flicker .23s steps(2, end) infinite; }
.daze-veil b { position: absolute; left: 50%; top: 63%; transform: translateX(-50%); padding: 3px 10px 2px; font: 13px/1 var(--f-stencil); letter-spacing: .14em; color: var(--c-night); background: var(--c-chalk); clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); }
.daze-veil[data-kind="gas"] b { background: #b8f05a; }
.daze-veil[data-kind="shock"] b { background: #9ce6ff; }
@keyframes daze-sway { from { transform: rotate(-1.2deg) scale(1.02); } to { transform: rotate(1.2deg) scale(1.05); } }
@keyframes daze-breathe { from { transform: scale(1); } to { transform: scale(1.06); } }
@keyframes daze-flicker { 0% { transform: scale(1.01); } 100% { transform: scale(1.04) translateX(3px); } }
@media (prefers-reduced-motion: reduce) { .daze-veil { animation: none !important; } }
`;
const DAZE_TAG = { stun: 'STUNNED', gas: 'GAS', shock: 'SHOCKED' };

// The Capture the Flag layer: both flags' status under the scorebar, a marker over each flag (or its carrier) with the
// distance to it, and the carrier's own strip. Team colour says whose flag; the plate's state says what is happening.
const CTF_CSS = `
.hud .ctf-ui { display: none; }
.hud.ctf-on .ctf-ui:not([hidden]) { display: flex; }
.hud.ctf-on .sb-track { display: none; }
.hud.ctf-on .snd-pips { display: flex; }
.ctf-status { gap: 4px; pointer-events: none; }
.cf-side { display: flex; align-items: center; gap: 6px; width: 148px; height: 24px; padding: 0 8px; background: var(--hud-glass-lo);
  box-shadow: var(--hud-edge), inset 0 -2px 0 var(--team); --cut: var(--cut-xs);
  clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
.cf-side.theirs { flex-direction: row-reverse; text-align: right; }
.cf-ico { flex: none; color: var(--team); line-height: 0; --icon-accent: currentColor; }
.cf-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.cf-txt b { font: 400 12px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); white-space: nowrap; }
.cf-txt small { font: var(--fs-micro)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 112px; }
.cf-side[data-state="carried"] { background: color-mix(in srgb, var(--team) 34%, rgba(16,20,26,.82)); }
.cf-side[data-state="carried"] .cf-txt small { color: #fff; }
.cf-side[data-state="carried"] .cf-ico { animation: ctf-blink .6s steps(2, jump-none) infinite alternate; }
.cf-side[data-state="dropped"] .cf-txt b { color: var(--c-sodium); }
.ctf-marks { position: absolute; inset: 0; pointer-events: none; }
.ctf-mark { position: absolute; left: 0; top: 0; width: 0; height: 0; display: block; }
.ctf-mark[hidden] { display: none; }
.ctf-mark .cm-plate { position: absolute; left: -15px; top: -15px; width: 30px; height: 30px; display: grid; place-items: center; color: #fff; line-height: 0;
  --icon-accent: currentColor; background: var(--team); box-shadow: 0 0 0 2px rgba(16,20,26,.8), 0 0 12px color-mix(in srgb, var(--team) 60%, transparent);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); }
.ctf-mark small { position: absolute; left: -50px; width: 100px; top: 18px; text-align: center; font: 400 12px/1.1 var(--f-stencil);
  letter-spacing: var(--tr-stencil); color: var(--c-chalk); text-shadow: 0 1px 2px rgba(0,0,0,.95); white-space: nowrap; }
.ctf-mark small u { display: block; text-decoration: none; font: var(--fs-micro)/1.2 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); }
.ctf-mark[data-state="carried"] .cm-plate { animation: ctf-blink .6s steps(2, jump-none) infinite alternate; }
.ctf-mark[data-state="carried"] small { color: #fff; }
.ctf-mark[data-state="dropped"] .cm-plate { background: rgba(16,20,26,.88); color: var(--team); box-shadow: 0 0 0 2px var(--team), 0 0 12px color-mix(in srgb, var(--team) 60%, transparent); }
.ctf-mark[data-state="dropped"] small { color: var(--c-sodium); }
.ctf-mark .sm-arrow { display: none; }
.ctf-mark.off .sm-arrow { display: block; }
.ctf-carry { position: absolute; left: var(--lane-x, 50%); bottom: var(--lane-b, 92px); transform: translateX(-50%); align-items: center; gap: 10px; pointer-events: none;
  padding: 6px 14px 7px 12px; color: var(--enemy-team); --icon-accent: currentColor; background: var(--hud-glass);
  box-shadow: var(--hud-edge), inset 0 -2px 0 var(--enemy-team); --cut: var(--cut-sm);
  clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
.ctf-carry span { display: flex; flex-direction: column; gap: 3px; }
.ctf-carry b { font: 400 15px/1 var(--f-stencil); letter-spacing: var(--tr-stencil); color: var(--c-chalk); white-space: nowrap; }
.ctf-carry small { font: var(--fs-micro)/1 var(--f-plate); letter-spacing: var(--tr-plate); color: var(--c-haze); white-space: nowrap; }
.ctf-carry[data-wait="1"] small { color: var(--c-sodium); }
@keyframes ctf-blink { to { filter: brightness(1.6); } }
@media (prefers-reduced-motion: reduce) { .cf-side[data-state="carried"] .cf-ico, .ctf-mark[data-state="carried"] .cm-plate { animation: none; } }
/* Scoreboard: a held slot (Sim.humanLeft). */
.lb-row.away b, .lb-row.away span:not(.lb-name) { color: var(--c-haze); }
.lb-row.away .lb-bdg, .lb-row.away .lb-lv { display: none; }
.lb-away { display: inline-block; font: 400 9px/1 var(--f-plate); font-style: normal; letter-spacing: .04em; text-transform: uppercase;
  color: var(--c-sodium); padding: 2px 4px; box-shadow: inset 0 0 0 1px rgba(242,166,59,.55); animation: lb-away 1.6s var(--ease-inout) infinite alternate; }
.lb-away.open { color: var(--c-go); box-shadow: inset 0 0 0 1px rgba(89,214,145,.55); animation: none; }
@keyframes lb-away { to { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { .lb-away { animation: none; } }
`;
const SCORE_POP_LIFE = 1.4;      // Seconds the "+100" under the crosshair holds before it fades; kills inside it add up.
const INTRO_GO_MS = 900;

const CALLOUT_POP = [
  { opacity: 0, transform: 'translateX(-50%) scale(1.8)' },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.14 },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.7 },
  { opacity: 0, transform: 'translate(-50%,-8px) scale(1)' },
];
const HEAL_PULSE = [{ opacity: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0 }];
const SCORE_POP = [{ transform: 'scale(1.5)', color: '#fff' }, { transform: 'scale(1)' }];
const COUNT_POP = [{ transform: 'scale(1.35)', opacity: 0.5 }, { transform: 'scale(1)', opacity: 1 }];
const GO_FLASH = [
  { opacity: 0, transform: 'translate(-50%,-50%) scale(2.2)' },
  { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.18 },
  { opacity: 1, transform: 'translate(-50%,-50%) scale(1.04)', offset: 0.6 },
  { opacity: 0, transform: 'translate(-50%,-50%) scale(1.25)' },
];
const HP_KNOCK = [{ transform: 'translateX(-3px)' }, { transform: 'translateX(2px)', offset: 0.4 }, { transform: 'none' }];
const ARMS_SWAP = [{ opacity: 0.2, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];
const SCORE_POP_IN = [
  { opacity: 0, transform: 'translateY(6px) scale(.6)' },
  { opacity: 1, transform: 'translateY(0) scale(1.18)', offset: 0.06 },
  { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.14 },
  { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.8 },
  { opacity: 0, transform: 'translateY(-10px) scale(1)' },
];
const SCORE_POP_BUMP = [
  { opacity: 1, transform: 'scale(1.35)' },
  { opacity: 1, transform: 'scale(1)', offset: 0.1 },
  { opacity: 1, transform: 'scale(1)', offset: 0.8 },
  { opacity: 0, transform: 'translateY(-10px) scale(1)' },
];
const HIT_PUNCH = [{ rotate: '14deg' }, { rotate: '0deg' }];
// Hitmarker variants, on top of the base marker in game.css (white X; gold for a head; skull for a kill):
//   .armor  the round went into Juggernaut armour: sodium brackets closing in instead of an X
//   .weak   the round lost damage going through cover first: a thinner, greyer, smaller X
// Their size also follows the damage of the hit (see #onHit), so a sniper round lands harder than an SMG's.
const HIT_CSS = `
.hit-armor { display: none; }
.hit-armor path { fill: none; stroke: var(--c-sodium, #f2a63b); stroke-width: 3.2; stroke-linecap: square; stroke-linejoin: miter; }
.hit.armor:not(.kill) .hit-x { display: none; }
.hit.armor:not(.kill) .hit-armor { display: block; }
.hit.weak:not(.kill):not(.head) .hit-x path { stroke: #b9c0c8; stroke-width: 2.2; stroke-dasharray: 5 3; }
`;
const REDUCED_MOTION = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const COVER_HIT_WINDOW = 0.3;    // Seconds after one of your rounds passed through cover that a hit counts as reduced.
const RESPAWN_FLASH = [{ opacity: 0.75 }, { opacity: 0 }];
const STREAK_HIT = [
  { opacity: 0, transform: 'translate(-50%,0) scale(1.9)', filter: 'brightness(2.4)' },
  { opacity: 1, transform: 'translate(-50%,0) scale(.97)', filter: 'brightness(1)', offset: 0.13 },
  { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: 0.8 },
  { opacity: 0, transform: 'translate(-50%,-14px) scale(1)' },
];

const BANNER_POP = [
  { opacity: 0, transform: 'translateX(-50%) scale(1.5)' },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.1 },
  { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.82 },
  { opacity: 0, transform: 'translate(-50%,-6px) scale(1)' },
];

// A point's letter: its id when that is already a single letter, otherwise its place in the list.
const pointLabel = (pt, i) => (typeof pt.id === 'string' && pt.id.length === 1 ? pt.id.toUpperCase() : 'ABCDEFG'[i] ?? '?');
const ringMarkup = '<svg class="o-ring" viewBox="-17 -17 34 34" aria-hidden="true"><circle class="o-track" r="14"/><circle class="o-arc" r="14" transform="rotate(-90)"/></svg><b></b>';

const pad2 = n => (n < 10 ? '0' + n : '' + n);
const weaponName = id => WEAPONS[id]?.name ?? (id === 'strike' ? 'Strike' : id ?? '');

// What the feed names for a kill: a gun id alone would credit the gun for a grenade or streak kill.
function killCause(e) {
  if (e.equip === 'bomb') return 'Bomb';
  if (e.equip) return LETHALS[e.equip]?.name ?? e.equip;
  if (typeof e.streak === 'string') return STREAKS[e.streak]?.name ?? e.streak;
  return weaponName(e.weapon);
}

// The objective strip: up to three centred rows under the score bar (at the top edge where a mode has no score bar)
// that every mode's state renders into, instead of each mode placing its own plates. A layer mounts its element into a
// row once (`hud.strip.mount(node, { row, order })`) and keeps updating it as before; the HUD's layout pass places the
// rows clear of the minimap, the squad panel, the corner and the weapon panel, and narrows them to fit.
//   row 0  the mode's state: flags, the hardpoint clock, alive counts, the circle, extraction's clock and lives
//   row 1  its detail: the mode's status plate, the extraction contract
//   row 2  live progress while it lasts: the zone meter, exfil hold, reviving
export class ObjStrip {
  constructor(hudEl, after) {
    this.el = document.createElement('div');
    this.el.className = 'ostrip';
    this.rows = [0, 1, 2].map(n => {
      const r = document.createElement('div');
      r.className = 'os-row';
      r.dataset.row = n;
      this.el.appendChild(r);
      return r;
    });
    if (after) after.after(this.el);
    else hudEl.appendChild(this.el);
  }

  mount(node, { row = 0, order = 0 } = {}) {
    if (!node) return null;
    node.classList.add('os-item');
    node.style.order = order;
    this.rows[row].appendChild(node);
    return node;
  }
}

export class HUD {
  #range;

  constructor(root) {
    this.root = root;
    this.loadoutCb = null;
    this.respawnCb = null;
    this.micCb = null;
    this.speakerCb = null;
    this.controls = null;
    this.map = MAPS[DEFAULT_MAP];
    this.scoreLimit = SCORE_LIMIT;
    this.timeLimit = TIME_LIMIT;
    this.badges = new Map();      // Player id -> { prestige, level }, from the match roster.
    this.mode = 'tdm';
    this.camera = null;           // World markers project through this; handed over once per match.
    this.hudK = 1;
    this.viewW = root.clientWidth || innerWidth;
    this.viewH = root.clientHeight || innerHeight;
    this.markObstacles = [];
    addEventListener('resize', () => this.remeasure());
    this.#seedFallback();
    this.#build();
    this.brHud = new BrHud(this);
    this.exHud = new ExHud(this);
    this.zmHud = new ZmHud(this);
    this.modeHud = new ModeHud(this);
    this.#drawMapBase();
    this.reset();
  }

  // Battle royale buttons (jump, take, plate, med, self-revive) reach the match through this.
  onBrCommand(cb) { this.brHud.onCommand(cb); }
  // Extraction buttons (call exfil, take a contract at a phone).
  onExCommand(cb) { this.exHud.onCommand(cb); }
  // Graveyard Shift's use button (a gate, a wall-buy, the crate, a perk machine).
  onZmCommand(cb) { this.zmHud.onCommand(cb); }

  // A mode banner, for the modes' own layers (js/ui/mode-hud.js).
  banner(title, sub, duration, side) { this.#banner(title, sub, duration, side); }

  // A row in the kill feed, for the modes' own layers (js/ui/br-hud.js).
  pushFeed(html, mine = false, side = '') { this.#pushFeed(html, mine, side); }

  // Rotation, toolbars, or a new match: layout-derived numbers are refreshed here and only ever read per frame.
  remeasure() {
    this.viewW = this.root.clientWidth;
    this.viewH = this.root.clientHeight;
    this.safe = safeInsets();
    this.layout();
    this.markObstacles = [];
    const add = r => { if (r.width > 0) this.markObstacles.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }); };
    for (const r of Object.values(this.controls?.rects ?? {})) this.markObstacles.push(r);
    for (const sel of ['.minimap', '.corner', '.arms', '.vitals', '.feed', '.br-squad', '.ex-squad', '.zm-crew', '.os-row[data-row="0"]', '.os-row[data-row="1"]']) add(this.el.querySelector(sel).getBoundingClientRect());
    // The Pro layer is drawn at CSS pixels: a few thin shapes do not need the phone's full pixel ratio.
    this.proCanvas.width = Math.max(1, Math.round(this.viewW));
    this.proCanvas.height = Math.max(1, Math.round(this.viewH));
    this.proDrawn = true;
  }

  // Options: HUD size (Small, Normal, Large) scales the panels; the layout pass keeps them clear of the thumbs.
  setHudSize(size) {
    this.hudK = HUD_SCALE[size] ?? 1;
    this.root.style.setProperty('--hud-k', this.hudK);
    this.layout();
  }

  // The layout pass: where the dock (health, streak tiles or the battle royale's kit), the prompt lane over it, the
  // weapon panel and the objective strip's rows go, from the measured stick zones and buttons (js/ui/controls.js
  // geometry: they move with the move stick size, the fire ring and the sensitivity) and the panels' own sizes. The
  // results are CSS custom properties on the shared root, so the HUD and the controls read the same numbers. Runs on a
  // new match, rotation, and a change of HUD size or hand; never per frame.
  layout() {
    const ctl = this.controls;
    if (!ctl?.enabled || !this.el.classList.contains('on')) return;
    const W = this.root.clientWidth, H = this.root.clientHeight;
    if (!W || !H) return;
    const k = this.hudK ?? 1, lefty = this.el.classList.contains('lefty');
    const st = this.root.style, px = v => `${Math.round(v)}px`;
    const { zones, rects } = ctl.geometry();
    if (!zones) return;
    const ins = safeInsets(), safe = { t: ins.top, r: ins.right, b: ins.bottom, l: ins.left };
    const box = el => (el && el.getClientRects().length ? el.getBoundingClientRect() : null);
    const buttons = ['slide', 'swap', 'tactical', 'lethal'].filter(b => ctl.buttons[b].style.display !== 'none').map(b => rects[b]).filter(r => r && r.x1 > r.x0);
    const circles = [zones.move, zones.aim];
    // The performance overlay's one line in the bottom corner (css/hud.css) is kept clear like a button.
    const perf = box(document.querySelector('.perf:not([hidden])'));
    if (perf && perf.width) buttons.push({ x0: perf.left, y0: perf.top, x1: perf.right, y1: perf.bottom });

    // Free stretches of a horizontal band [y0, y1] once the stick circles and the buttons are taken out.
    const free = (y0, y1, lo = safe.l + 6, hi = W - safe.r - 6) => {
      const cut = [];
      for (const c of circles) {
        const dy = c.y < y0 ? y0 - c.y : c.y > y1 ? c.y - y1 : 0;
        if (dy < c.r) { const dx = Math.sqrt(c.r * c.r - dy * dy); cut.push([c.x - dx, c.x + dx]); }
      }
      for (const r of buttons) if (r.y1 > y0 && r.y0 < y1) cut.push([r.x0, r.x1]);
      cut.sort((a, b) => a[0] - b[0]);
      const out = [];
      let x = lo;
      for (const [a, b] of cut) { if (a - DOCK_GAP > x) out.push([x, a - DOCK_GAP]); x = Math.max(x, b + DOCK_GAP); }
      if (hi > x) out.push([x, hi]);
      return out;
    };
    // The stretch nearest the middle of the screen that is at least `need` wide (else the widest).
    const pick = (spans, need, mid = W / 2) => {
      let best = null, bestD = Infinity;
      for (const s of spans) {
        const d = s[1] - s[0] >= need ? Math.max(0, s[0] - mid, mid - s[1]) : 1e6 - (s[1] - s[0]);
        if (d < bestD) { bestD = d; best = s; }
      }
      return best ?? [W / 2 - need / 2, W / 2 + need / 2];
    };

    // Dock: health beside the streak tiles (or the battle royale's plate and medkit buttons), along the bottom edge
    // between the sticks. The tiles go on the aim thumb's side, as the buttons do.
    const vit = this.vitals, tiles = ctl.el.querySelector('.streaks'), inv = this.el.querySelector('.br-inv');
    const right = this.br ? inv : tiles?.style.display !== 'none' && [...ctl.tiles].some(t => t.node.style.display !== 'none') ? tiles : null;
    // The first sizing that fits a free stretch: as chosen, then the tiles at their touch size, then health smaller.
    const tryK = [[k, this.tileK()], [k, 1], [Math.min(k, 1), 1], [HUD_SCALE.small, 1]];
    let fit = null;
    for (const [vk, tk] of tryK) {
      const rk = right === tiles ? tk : vk;
      const vw = vit.offsetWidth * vk, rw = right ? right.offsetWidth * rk : 0;
      const dockH = Math.max(vit.offsetHeight * vk, right ? right.offsetHeight * rk : 0);
      const y1 = H - safe.b - DOCK_BOTTOM, y0 = y1 - dockH;
      const total = vw + (right ? DOCK_GAP * 2 + rw : 0);
      const span = pick(free(y0, y1), total);
      fit = { vk, tk, vw, rw, y0, total, span };
      if (span[1] - span[0] >= total) break;
    }
    const { vk, tk, vw, rw, y0, total, span } = fit;
    st.setProperty('--vit-k', vk);
    st.setProperty('--tile-k', tk);
    const cx = Math.max(span[0] + total / 2, Math.min(span[1] - total / 2, W / 2));
    const left = cx - total / 2;
    const vitX = right && !lefty ? left : right ? left + rw + DOCK_GAP * 2 : left;
    const rpX = right && !lefty ? left + vw + DOCK_GAP * 2 : left;
    st.setProperty('--vit-x', px(vitX));
    st.setProperty('--rp-x', px(rpX));
    st.setProperty('--dock-top', px(y0));

    // Prompt lane: just over the dock, between the sticks (take a gun, call exfil, the bomb, a flag, reviving).
    const ly1 = y0 - DOCK_GAP * 2, ly0 = ly1 - LANE_H * k;
    const lane = pick(free(ly0, ly1), 140 * k, cx);
    st.setProperty('--lane-x', px((lane[0] + lane[1]) / 2));
    st.setProperty('--lane-w', px(Math.min(LANE_MAX * k, lane[1] - lane[0])));
    st.setProperty('--lane-b', px(H - ly1));

    // Weapon panel: under the corner chips, on the aim thumb's side, above the button cluster. It keeps its size
    // unless the buttons under it would be covered (a short screen at Large).
    const corner = box(this.el.querySelector('.corner'));
    const top = Math.max(corner && corner.height ? corner.bottom : 0, safe.t + 44 * Math.max(1, k)) + 6;
    const arms = this.arms, aw = arms.offsetWidth * k, ah = arms.offsetHeight;
    const ax0 = lefty ? safe.l + ARMS_EDGE : W - safe.r - ARMS_EDGE - aw, ax1 = ax0 + aw;
    let floor = H;
    for (const r of buttons) if (r.x1 > ax0 && r.x0 < ax1) floor = Math.min(floor, r.y0);
    for (const c of circles) if (c.x + c.r > ax0 && c.x - c.r < ax1) floor = Math.min(floor, c.y - c.r);
    const armsK = Math.max(0.7, Math.min(k, (floor - DOCK_GAP - top) / Math.max(1, ah)));
    st.setProperty('--arms-y', px(top));
    st.setProperty('--arms-k', armsK.toFixed(3));

    // Kill feed: under the minimap (square and zoomed in battle royale and extraction), as many rows as fit above the
    // move stick, two or three.
    const mm = box(this.el.querySelector('.minimap'));
    const fx0 = lefty ? W - safe.r - 8 - 210 * k : safe.l + 8, fx1 = fx0 + 210 * k;
    // The squad panels beside the minimap fill in after the layout: take them at their full size (three teammates in
    // battle royale and extraction, a crew of four in Graveyard Shift). The feed also clears them.
    const squads = [];
    for (const [sel, rows, rowH] of [['.br-squad', 3, 31], ['.ex-squad', 3, 31], ['.zm-crew', 4, 26]]) {
      const r = box(this.el.querySelector(sel));
      if (r && r.width) squads.push({ left: r.left, right: r.right, top: r.top, bottom: r.top + rows * rowH * k });
    }
    let feedTop = mm && mm.height ? mm.bottom + 8 : safe.t + 50;
    for (const r of squads) if (r.right > fx0 && r.left < fx1) feedTop = Math.max(feedTop, r.bottom + 6);
    let feedFloor = H;
    for (const c of circles) if (c.x + c.r > fx0 && c.x - c.r < fx1) feedFloor = Math.min(feedFloor, c.y - c.r);
    for (const r of buttons) if (r.x1 > fx0 && r.x0 < fx1) feedFloor = Math.min(feedFloor, r.y0);
    this.feedRows = Math.max(2, Math.min(FEED_ROWS, Math.floor((feedFloor - DOCK_GAP - feedTop) / (FEED_ROW_H * k))));
    st.setProperty('--feed-y', px(feedTop));
    while (this.feed.length > this.feedRows) this.feed.pop().row.remove();

    // Objective strip rows: centred under the score bar where there is one (else in the free stretch of the top edge),
    // clear of the minimap, the squad panel, the feed, the corner and the weapon panel.
    const bar = box(this.el.querySelector('.scorebar'));
    const base = bar && bar.height ? bar.bottom + 4 : safe.t + 6;
    const armsBox = box(this.arms);
    const obstacles = ['.minimap', '.corner', '.range-leave', '.mh-mods']
      .map(sel => box(this.el.querySelector(sel))).filter(r => r && r.width > 0);
    if (armsBox?.width) obstacles.push(armsBox);
    // The squad panels and the feed fill in after the layout: take their full size now.
    const feed = this.feedEl.getBoundingClientRect();
    obstacles.push({ left: feed.left, right: feed.left + this.feedEl.offsetWidth * k, top: feed.top, bottom: feed.top + this.feedRows * FEED_ROW_H * k });
    obstacles.push(...squads);
    let y = base;
    const tops = [];
    this.strip.rows.forEach((row, n) => {
      tops.push(y);
      const h = Math.max(row.offsetHeight, STRIP_ROW_H[n]) * k;
      let lo = safe.l + 6, hi = W - safe.r - 6;
      for (const r of obstacles) {
        if (r.bottom <= y + 2 || r.top >= y + h - 2) continue;
        if ((r.left + r.right) / 2 < W / 2) lo = Math.max(lo, r.right + DOCK_GAP * 2);
        else hi = Math.min(hi, r.left - DOCK_GAP * 2);
      }
      const centred = bar && bar.height;
      const x = centred ? W / 2 : (lo + hi) / 2;
      const max = centred ? 2 * Math.min(x - lo, hi - x) : hi - lo;
      st.setProperty(`--os-x${n}`, px(x));
      st.setProperty(`--os-y${n}`, px(y));
      st.setProperty(`--os-w${n}`, px(Math.max(80, max) / k));
      y += h + 4;
    });
    // Out and watching (battle royale, extraction): the out plate goes under the strip's state row, in the widest free
    // stretch there (the weapon panel is hidden while you are out), clear of both sticks.
    {
      const oy = tops[1], oh = OUT_H * k;
      let lo = safe.l + 6, hi = W - safe.r - 6;
      for (const r of obstacles) {
        if (r === armsBox || r.bottom <= oy + 2 || r.top >= oy + oh - 2) continue;
        if ((r.left + r.right) / 2 < W / 2) lo = Math.max(lo, r.right + DOCK_GAP * 2);
        else hi = Math.min(hi, r.left - DOCK_GAP * 2);
      }
      st.setProperty('--out-x', px((lo + hi) / 2));
      st.setProperty('--out-y', px(oy));
      st.setProperty('--out-w', px(hi - lo));
    }
    // The death screen's column starts under the strip's state row (and extraction's contract), which stay readable.
    st.setProperty('--death-y', px(this.ex ? tops[2] : tops[1]));
    ctl.remeasure();
  }

  // Streak tiles grow with Large but never shrink below their touch size.
  tileK() { return Math.max(1, this.hudK ?? 1); }

  #markBlocked(x, y) {
    for (const r of this.markObstacles) {
      if (x + MARK_CLEAR > r.x0 && x - MARK_CLEAR < r.x1 && y + MARK_CLEAR > r.y0 && y - MARK_CLEAR < r.y1) return true;
    }
    return false;
  }

  // Controls owns the buttons and streak tiles so there is a single touch surface; the HUD feeds them.
  bindControls(controls) {
    this.controls = controls;
    this.#seedFallback();
  }

  // The scoreboard's Leave button; the session flow belongs to main.js.
  onLeaveMatch(cb) { this.leaveCb = cb; }
  // Battle royale, out of the match: Leave goes to the results now (js/ui/br-hud.js); main.js decides what that means.
  onBrLeave(cb) { this.brLeaveCb = cb; }

  // Options: left-handed mirrors the sticks and buttons (js/ui/controls.js) and with them every panel.
  setLefty(on) {
    this.el.classList.toggle('lefty', on);
    this.root.classList.toggle('hud-lefty', on);
    this.layout();
  }

  // Tiles and buttons need something to draw before the first frame that carries real slots.
  #seedFallback() {
    const l = normalizeLoadout(Progress.loadout());
    this.fallbackSlots = l.streaks.map(kind => ({ kind, cost: STREAKS[kind].cost, held: false, blocked: false }));
    this.fallbackEquip = { tactical: l.tactical, lethal: l.lethal };
    this.#syncThrowReach();
  }

  // Reach is a property of the loadout the player is carrying, which can change on the death screen between lives.
  #syncThrowReach() {
    this.controls?.setThrowReach((Progress.loadout().perks ?? []).includes('strongarm'));
  }

  // Call before each match.
  // `training` (Custom > Training): the firing range's readout and armory on an ordinary map.
  prepare({ mapId = DEFAULT_MAP, scoreLimit = SCORE_LIMIT, timeLimit = TIME_LIMIT, roster = [], mode = 'tdm', localId = null, intro = true, mods = [], training = null } = {}) {
    this.map = MAPS[mapId] ?? this.map;
    this.scoreLimit = scoreLimit;
    this.timeLimit = timeLimit;
    this.modeId = mode;                 // As picked, e.g. 'gwdom'.
    this.armsPair = null;
    // The rule set it plays by, e.g. 'dom'; a modes-overhaul mode is drawn as the rule set it looks like (its `look`),
    // and its own layer (this.modeHud) says the rest.
    this.mode = MODES[mode]?.look ?? modeRules(mode);
    this.modeHud.prepare(mode, mods);
    this.ffa = isFfa(mode);             // Every player for themselves: scorebar, board and banners rank players.
    this.gun = this.mode === 'gun';
    this.snd = this.mode === 'snd';           // Search and Destroy: rounds, the bomb, spectating instead of respawns.
    this.ctf = this.mode === 'ctf';           // Capture the Flag: both flags' status, markers and the carrier's strip.
    this.br = isBr(mode);                     // Battle royale: its own layer replaces the scorebar and death screen.
    this.ex = isEx(mode);                     // Extraction: its own layer replaces the scorebar; respawns go on until the lives do.
    this.zm = MODES[mode]?.rules === 'zm';    // Graveyard Shift: its own layer replaces the scorebar and death screen.
    this.badges = new Map(roster.map(r => [r.id, r.badge ?? null]));
    setRosterIdentity(roster);
    this.prints.reset();
    this.#seedFallback();
    this.#drawMapBase();
    this.#buildObjectiveHud();
    this.sbGoal.textContent = this.gun ? `${scoreLimit} guns` : this.modeHud.goal(scoreLimit) ?? `to ${scoreLimit}`;
    this.el.classList.toggle('snd-on', this.snd);
    this.el.classList.toggle('ctf-on', this.ctf);
    for (const pips of this.sndEl.pips) pips.innerHTML = this.snd || this.ctf ? '<i></i>'.repeat(scoreLimit) : '';
    spectate.reset();
    this.boardMode.textContent = playlistName(mode, mods);
    this.boardGoal.textContent = `${this.map?.name ?? ''}, ${this.gun ? `${scoreLimit} guns to win` : this.snd ? `first to ${scoreLimit} rounds` : this.ctf ? `first to ${scoreLimit} captures` : `first to ${scoreLimit}`}`;
    this.el.classList.toggle('ffa-on', this.ffa);
    this.gunEl.hidden = !this.gun;
    this.#oneGunControls(this.gun);
    this.#sndControls(this.snd || this.br || this.ex || this.zm);   // Battle royale and extraction have no scorestreaks either.
    this.reset();
    const practice = mode === 'range' || !!training;
    this.#range.prepare(practice, { training: !!training });
    this.el.classList.toggle('range-on', practice);
    this.el.classList.toggle('training-on', !!training);
    this.#hideIntro();
    this.remeasured = false;
    // Battle royale opens on its drop map instead of the team card.
    this.pendingIntro = intro && mode !== 'range' && !this.br && !this.ex && !this.zm ? { mapId, mode, roster, localId } : null;
    this.brHud.prepare(this.br, { map: this.map, roster, localId, mode });
    this.exHud.prepare(this.ex, { map: this.map, roster, localId, mode });
    this.zmHud.prepare(this.zm, { map: this.map, roster, localId, mode });
    if (this.br || this.ex) {
      const mine = TEAMS[roster.find(r => r.id === localId)?.team ?? 2]?.css ?? '#38b6ff';
      this.el.style.setProperty('--my-team', mine);
      this.el.style.setProperty('--enemy-team', TEAMS[1].css);
    }
  }

  // Gun Game: no scorestreaks and nothing to swap to, so their buttons go; the death screen has no loadouts to offer.
  #oneGunControls(on) {
    const c = this.controls;
    for (const t of c?.tiles ?? []) if (t?.node) t.node.style.display = on ? 'none' : '';
    if (c?.buttons?.swap) c.buttons.swap.style.display = on ? 'none' : '';
    if (c?.scoreBox) c.scoreBox.style.display = on ? 'none' : '';
    this.el.querySelector('.death-next').style.display = on ? 'none' : '';
  }

  // Search and Destroy has no scorestreaks, so their tiles and the score counter go; everything else stays.
  #sndControls(on) {
    const c = this.controls;
    if (!on || !c) return;
    for (const t of c.tiles ?? []) if (t?.node) t.node.style.display = 'none';
    if (c.scoreBox) c.scoreBox.style.display = 'none';
  }

  // The Gun Game strip under the scorebar: the gun in hand, how far up the ladder, and what the next kill brings.
  #updateGun(view, me, c) {
    if (!this.gun) return;
    const level = Math.max(0, Math.min(GUN_LADDER.length - 1, view.scores[me.team] ?? 0));
    if (level === c.gunLevel) return;
    const up = level > c.gunLevel;
    const first = Number.isNaN(c.gunLevel);
    c.gunLevel = level;
    const gun = GUN_LADDER[level], next = GUN_LADDER[level + 1];
    this.gunEl.querySelector('.gr-icon').innerHTML = glyph(gun, 18);
    this.gunEl.querySelector('.gr-n').textContent = `${level + 1}/${GUN_LADDER.length}`;
    this.gunEl.querySelector('.gr-name').textContent = weaponName(gun);
    this.gunEl.querySelector('.gr-next').innerHTML = next
      ? `<small>Next</small>${glyph(next, 12)}<span>${esc(weaponName(next))}</span>`
      : '<small class="gr-final">Final gun: one kill wins</small>';
    const pips = this.gunEl.querySelector('.gr-pips');
    pips.innerHTML = GUN_LADDER.map((_, i) => `<i style="flex:1;height:3px;background:${i < level ? 'var(--c-sodium)' : i === level ? '#fff' : 'rgba(231,234,228,.18)'}"></i>`).join('');
    if (!first) this.gunEl.animate(up ? SCORE_POP_IN : HP_KNOCK, { duration: up ? 520 : 300, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  // A Gun Game rung change for the local player: the gun is already in hand; this says why.
  #onArm(e) {
    if (e.id !== this.view?.localId || !this.gun) return;
    const name = weaponName(e.weapon);
    if (e.by) {
      const by = this.view.players.find(p => p.id === e.by);
      this.#banner('Set back', `${by?.name ?? 'Someone'} knocked you down to the ${name}`, 1600, 'enemy');
    } else if (e.level === GUN_LADDER.length - 1) {
      this.#banner('Final gun', `${name}: one kill wins it`, 1600, 'mine');
    } else {
      this.#callout(`${name}  ${e.level + 1}/${GUN_LADDER.length}`);
    }
  }

  // onSetLoadout's sibling for the firing range's Reset.
  onRangeReset(cb) { this.#range.onReset = cb; }
  // Training and the range: a gun picked in the armory, as a whole loadout (js/ui/trainarmory.js).
  onArmory(cb) { this.#range.onArmory = cb; }

  // Team roster and map name over the warmup; decorative, so it never takes a touch. The countdown under the map card
  // is driven from update() so it stays true to the sim's warmup whatever speed this phone runs at.
  #showIntro(mapId, mode, roster, localId) {
    const map = MAPS[mapId] ?? this.map;
    const row = (p, i) => `<div class="in-row${p.id === localId ? ' me' : ''}" style="--i:${i}">${p.badge ? `<i class="f-bdg">${badgeMark(p.badge.prestige ?? 0, 15)}</i><u>${p.badge.level ?? ''}</u>` : ''}<b>${nameHtml(p.name)}</b>${vetTag(vetOf(p), { short: true })}${p.isBot && !p.pool ? '<small>Bot</small>' : ''}</div>`;
    const team = (t, side) => {
      const list = roster.filter(p => p.team === t);
      return `<div class="in-team ${side}" style="--team:${TEAMS[t].css}"><h3><i></i>${esc(TEAMS[t].name)}</h3>${list.map(row).join('')}</div>`;
    };
    const myTeam = roster.find(p => p.id === localId)?.team ?? 0;
    const m = MODES[mode];
    const minutes = Math.round(this.timeLimit / 60);
    // Free-for-all: everyone in their own colour, split across both sides of the card. Nobody is on your side.
    const field = (list, side, title) => `<div class="in-team ${side}" style="--team:var(--c-sodium)"><h3><i></i>${esc(title)}</h3>${list.map((p, i) =>
      `<div style="--team:${TEAMS[p.team]?.css ?? '#fff'}">${row(p, i)}</div>`).join('')}</div>`;
    const half = Math.ceil(roster.length / 2);
    const roundTime = `${Math.floor(this.timeLimit / 60)}:${pad2(this.timeLimit % 60)}`;
    const rules = this.gun ? `${GUN_LADDER.length} guns<i></i>${minutes} min`
      : this.snd ? `First to ${this.scoreLimit} rounds<i></i>${roundTime} a round`
      : this.ctf ? `First to ${this.scoreLimit} captures<i></i>${minutes} min` : `First to ${this.scoreLimit}<i></i>${minutes} min`;
    this.introEl.innerHTML = `
      ${this.ffa ? field(roster.slice(0, half), 'ours', 'Every player') : team(myTeam, 'ours')}
      <div class="in-mid">
        <div class="in-card">
          <div class="in-pic" style="background-image:url(assets/maps/${esc(map?.id ?? mapId)}.jpg)"></div>
          <div class="in-mode">${glyph(`mode:${mode}`, 15, 'gl in-mode-icon')}<span>${esc(m?.name ?? '')}</span></div>
          <h2>${esc(map?.name ?? '')}</h2>
          <p class="in-rules">${rules}</p>
        </div>
        <div class="in-count"><b>3</b></div>
        <p class="in-tip">${esc(m?.desc ?? TIPS[Math.floor(Math.random() * TIPS.length)])}</p>
      </div>
      ${this.ffa ? field(roster.slice(half), 'theirs', 'for themselves') : team(1 - myTeam, 'theirs')}`;
    this.introCount = this.introEl.querySelector('.in-count b');
    this.introShown = 3;
    this.introEl.classList.add('show');
    this.introOn = true;
    this.controls?.el.classList.add('intro-on');
    this.modeBannerShown = true;      // The card already says what the mode is.
  }

  // 3, 2, 1 under the map card; each new number lands with a stamp.
  #tickIntro(view) {
    if (!this.introOn || !this.introCount) return;
    const left = Math.max(1, Math.ceil(3 - (view.t ?? 0)));
    if (left === this.introShown) return;
    this.introShown = left;
    this.introCount.textContent = left;
    this.introCount.animate(COUNT_POP, { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  #hideIntro(go = false) {
    if (!this.introOn) return;
    this.introOn = false;
    this.introEl.classList.remove('show');
    this.controls?.el.classList.remove('intro-on');
    if (go) this.goEl.animate(GO_FLASH, { duration: INTRO_GO_MS, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  // The match renderer's camera. Markers need a world-to-screen transform and nothing else from it.
  setCamera(camera) { this.camera = camera; }

  reset() {
    // Cached display values. NaN and '' can never equal a real value, so the first update writes everything.
    this.cache = {
      myScore: NaN, otherScore: NaN, teamFlip: NaN, time: NaN, phase: '', hp: NaN, hpFrac: NaN, ammo: NaN, reserve: NaN,
      weapon: '', reloadFrac: NaN, reloadOn: null, low: null, hurt: null, vign: NaN, dead: null, respawn: NaN,
      protect: null, picked: -1, enemyUav: null, tag: '', heatOn: null, heat: NaN, heatLevel: '', overBanner: null,
      score: NaN, capped: null, swapHint: null, objState: null, objFrac: NaN, hardShown: NaN,
      gunLevel: NaN, rival: null, place: '',
      sndAlive: '', sndRole: '', sndBig: '', sndCount: NaN, sndRing: '', sndRingFrac: NaN, sndCarry: null, sndSpec: null, sndLife: '', sndPips: '',
      ctfCarry: '', ctfShown: null,
    };
    this.sndLast = null;
    this.view = null;
    this.modeBannerShown = false;
    this.hardWarned = false;
    this.objTally = new Map();
    this.hardMoves = 0;
    this.mmClock = 0;
    this.hitT = 0;
    this.hitKill = false;
    this.hitHead = false;
    this.hitArmor = false; this.hitWeak = false; this.hitScale = 1;
    this.coverShotT = -9; this.clockT = 0;
    this.hitLife = HIT_LIFE;
    this.flashT = 0;
    this.flashLen = 1;
    this.boardOpen = false;
    this.boardClock = 0;
    this.boardEl.hidden = true;
    this.flashFadeLen = 1;
    this.flashEl.style.opacity = '0';
    this.dazeT = 0;
    this.dazeEl.style.opacity = '0';
    this.leaveArmed = false;
    this.leaveBtn.textContent = 'Leave match';
    this.feed = [];
    this.medalQueue = [];
    this.medalClock = 0;
    this.killer = null;
    this.endShown = false;
    this.endAt = 0;
    this.feedEl.textContent = '';
    this.medalsEl.textContent = '';
    for (const d of this.dmg) { d.life = 0; d.el.style.opacity = '0'; }
    this.hitEl.style.opacity = '0';
    this.deathEl.classList.remove('show', 'picking', 'snd-life-buy', 'snd-life-spec');
    this.nextEl.querySelector('.dn-now > small').textContent = 'Next life';
    this.pickerEl.querySelector('.pk-head b').textContent = 'Next life';
    this.pickerEl.querySelector('.pk-head small').textContent = 'Spawns with the one you pick. Take your time: you respawn when you tap Respawn.';
    this.wasOut = false;
    for (const m of this.sndEl.marks) { m.shown = false; m.root.hidden = true; m.state = ''; m.text = null; }
    for (const k of ['ring', 'carry', 'spec', 'big']) this.sndEl[k].hidden = true;
    for (const m of this.ctfEl.marks) { m.shown = false; m.root.hidden = true; m.state = ''; m.text = null; }
    for (const sd of this.ctfEl.sides) sd.key = '';
    this.ctfEl.carry.hidden = true;
    this.endEl.classList.remove('show');
    this.controls?.setDown(false);
    this.setNotice('');
    this.setSpectate(null);
    this.#paintPicker(true);
  }

  setVisible(on) {
    this.el.classList.toggle('on', on);
  }

  // cb(loadout), the full match loadout, whenever the player picks another one on the death screen.
  onSetLoadout(cb) { this.loadoutCb = cb; }
  // cb(msg) sends the host a respawn command ({}): the Respawn tap, or with Options autoRespawn on the request made at
  // the moment of death, which the host honours as soon as the minimum respawn time is up.
  // match: #command({ ...msg, cmd: 'respawn' }).
  onRespawn(cb) { this.respawnCb = cb; }
  onMic(cb) { this.micCb = cb; }
  onSpeaker(cb) { this.speakerCb = cb; }

  // state: 'off' | 'requesting' | 'on' | 'denied' | 'unavailable' | 'hidden'
  setMic(state, muted = false) {
    this.micBtn.dataset.state = state;
    this.micBtn.hidden = state === 'hidden' || state === 'unavailable';
    this.speakerBtn.hidden = this.micBtn.hidden;
    this.speakerBtn.classList.toggle('muted', muted);
  }

  // Pass null for solo play. Otherwise { rtt: ms|null, status, isHost }.
  setNet(info) {
    const chip = this.netChip;
    if (!info) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    let text, grade;
    if (info.status === 'host-lost') {
      text = 'Lost'; grade = 'bad';
    } else if (info.isHost) {
      text = 'Host'; grade = 'good';
    } else if (info.rtt === null || info.rtt === undefined) {
      text = '--'; grade = 'mid';
    } else {
      const ms = Math.round(info.rtt);
      text = ms + ' ms';
      grade = ms < 70 ? 'good' : ms < 160 ? 'mid' : 'bad';
    }
    if (this.netText.textContent !== text) this.netText.textContent = text;
    chip.dataset.grade = grade;
  }

  // Persistent centre line, e.g. the host-lost countdown; empty string hides it.
  setNotice(text) {
    if (this.noticeEl.textContent !== text) this.noticeEl.textContent = text;
    this.noticeEl.classList.toggle('show', !!text);
  }

  // Short line in the kill feed for things that are not kills.
  // A Pro ability just fired for the local player: a short gold plate under the score bar.
  #onPro(perk) {
    const p = PRO[perk];
    if (!p) return;
    this.proToast.querySelector('b').textContent = p.name;
    this.proToast.querySelector('small').textContent = PRO_LINE[perk] ?? '';
    this.proToast.getAnimations().forEach(a => a.cancel());
    this.proToast.animate([
      { opacity: 0, transform: 'translate(-50%, 6px) scale(.92)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.12 },
      { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -4px) scale(1)' },
    ], { duration: 1700, easing: 'ease-out' });
  }

  #onHijack(e) {
    const view = this.view;
    if (!view) return;
    const p = view.players.find(q => q.id === e.by);
    const mine = e.by === view.localId;
    this.#pushFeed(`<em style="color:${TEAMS[p?.team ?? e.team].css}">${esc(p?.name ?? '?')}</em><span class="f-note">hijacked a Sentry</span>`, mine, p?.team === this.#findLocal(view)?.team ? 'ally' : 'foe');
  }

  notify(text) {
    this.#pushFeed(`<span class="f-note">${esc(text)}</span>`);
  }

  // Name of the player being watched, or null.
  setSpectate(name) {
    this.specEl.hidden = !name;
    if (name) this.specEl.textContent = `Watching ${name}`;
  }

  // Shows the end banner, then calls onDone once the player has had a moment to read it.
  showEnd(results, onDone) {
    this.#showEndBanner(results.winner, results.myTeam, results.players ? { ...this.view, players: results.players, scores: results.scores } : this.view);
    const wait = Math.max(0, END_BANNER_MIN - (performance.now() - this.endAt));
    setTimeout(() => {
      this.endEl.classList.remove('show');
      onDone?.();
    }, wait);
  }

  #build() {
    const el = this.el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <canvas class="pro-layer"></canvas>
      <div class="pro-toast"><b></b><small></small></div>
      <div class="vignette"><i class="vg-pulse"></i></div>
      <div class="scorebar" data-tap="1">
        <div class="sb-side mine">
          <i class="sb-lamp"></i><b class="sb-name"></b><b class="sb-score">0</b>
          <i class="sb-track"><i class="sb-fill"></i></i><i class="snd-pips"></i>
        </div>
        <div class="sb-time"><b>10:00</b><small class="sb-goal"></small></div>
        <div class="sb-side theirs">
          <b class="sb-score">0</b><b class="sb-name"></b><i class="sb-lamp"></i>
          <i class="sb-track"><i class="sb-fill"></i></i><i class="snd-pips"></i>
        </div>
      </div>
      <div class="minimap">
        <canvas width="${MM_WIDTH * MM_SCALE}" height="${Math.round(MM_WIDTH * MM_SCALE * 2 / 3)}"></canvas>
        <i class="mm-corner tl"></i><i class="mm-corner br"></i>
        <span class="mm-tag" hidden>Enemy UAV</span>
      </div>
      <div class="feed"></div>
      <div class="medals"></div>
      <div class="hit">
        <svg class="hit-x" viewBox="-20 -20 40 40" aria-hidden="true"><path d="M-15 -15l8 8M15 -15l-8 8M-15 15l8 -8M15 15l-8 -8" /></svg>
        <svg class="hit-armor" viewBox="-20 -20 40 40" aria-hidden="true"><path d="M-16 -8V-16H-8M8 -16H16V-8M16 8V16H8M-8 16H-16V8M-5 0H5M0 -5V5" /></svg>
        <svg class="hit-skull" viewBox="-20 -20 40 40" aria-hidden="true"><path d="M0 -17C-11 -17 -16 -10 -16 -3C-16 3 -13 6 -10 8L-9 14H-5V10H-2V14H2V10H5V14H9L10 8C13 6 16 3 16 -3C16 -10 11 -17 0 -17ZM-9 -6A4.5 4.5 0 1 1 -9 3A4.5 4.5 0 1 1 -9 -6ZM9 -6A4.5 4.5 0 1 1 9 3A4.5 4.5 0 1 1 9 -6ZM0 2L3 7H-3Z" fill-rule="evenodd"/></svg>
      </div>
      <div class="score-pop"><b>+100</b><small></small></div>
      ${[0, 1, 2, 3].map(() => '<svg class="dmg" viewBox="-110 -110 220 220" aria-hidden="true"><path class="dmg-arc" d="M-50 -96 A108 108 0 0 1 50 -96 L40 -78 A88 88 0 0 0 -40 -78 Z" /><path class="dmg-tip" d="M-9 -100 L0 -110 L9 -100 Z" /></svg>').join('')}
      <div class="corner">
        <div class="net-chip" hidden><i class="bars"><i></i><i></i><i></i></i><span>--</span></div>
        <button class="chip-btn speaker" data-tap="1" hidden aria-label="Mute team voice">
          ${glyph('ui:volume', 19)}
        </button>
        <button class="chip-btn mic" data-tap="1" data-state="hidden" hidden aria-label="Team voice">
          ${glyph('ui:mic', 19)}
          <span class="mic-tag"></span>
        </button>
      </div>
      <div class="status">
        <div class="vitals">
          <span class="hp-tags"><span class="protect" hidden>Spawn shield</span><span class="hp-armor-num" hidden></span></span>
          <span class="hp-num">100</span>
          <span class="hp-bars"><i class="hp-track"><i class="hp-loss"></i><i class="hp-fill"></i><i class="hp-ticks"></i><i class="hp-armor"></i></i></span>
        </div>
        <div class="arms">
          <div class="arms-main">
            <div class="arms-top"><div class="arms-count"><b class="ammo">30</b><span class="reserve">150</span></div><span class="arms-icon"></span></div>
            <div class="arms-sub"><span class="arms-name"><span></span></span><span class="arms-alt" hidden>${icon('swap', { size: 11, accent: 'currentColor' })}<span></span></span></div>
            <i class="mag"><i class="mag-fill"></i></i>
            <i class="reload-track"><i class="reload-fill"></i></i>
            <i class="heat" hidden><i class="heat-fill"></i></i>
          </div>
        </div>
      </div>
      <div class="over-banner"><b>Overheated</b><small>Swap to sidearm</small></div>
      <div class="board" hidden>
        <div class="board-top"><b class="board-mode"></b><span class="board-goal"></span></div>
        <div class="board-grid"></div>
        <div class="board-foot"><small class="board-tip">Tap the score to close</small><button class="board-leave" data-tap="1">Leave match</button></div>
      </div>
      <div class="range-panel" hidden>
        <div class="rp-head">Firing Range</div>
        <div class="rp-grid">
          <div class="rp-big"><span>DPS</span><b class="rp-dps">0</b></div>
          <div><span>Peak</span><b class="rp-peak">0</b></div>
          <div><span>Accuracy</span><b class="rp-acc">--</b></div>
          <div><span>Last TTK</span><b class="rp-ttk">--</b></div>
          <div><span>Best TTK</span><b class="rp-best">--</b></div>
          <div class="rp-wide"><span>Last hit</span><b class="rp-last">--</b></div>
          <small class="rp-model"></small>
        </div>
        <button class="rp-reset" data-tap="1">Reset</button>
        <button class="rp-armory" data-tap="1">Armory</button>
      </div>
      <button class="range-leave" data-tap="1" hidden>Leave range</button>
      <div class="intro"></div>
      <div class="go-flash"><b>Go</b></div>
      <div class="streak-hit"><span class="sh-icon"></span><span class="sh-text"><b></b><small></small></span></div>
      <div class="respawn-flash"></div>
      <div class="streak-edge"></div>
      <div class="obj-marks"></div>
      <div class="obj-strip" hidden>
        <div class="obj-chips"></div>
        <div class="obj-timer" hidden><small>Moves in</small><b>0:30</b></div>
      </div>
      <div class="gun-rung" hidden style="min-width:210px;padding:5px 12px 6px;background:var(--hud-glass);box-shadow:var(--hud-edge);clip-path:polygon(8px 0,calc(100% - 8px) 0,100% 8px,100% 100%,0 100%,0 8px);pointer-events:none;display:flex;flex-direction:column;gap:3px">
        <div style="display:flex;align-items:center;gap:7px;color:var(--c-chalk)"><span class="gr-icon" style="color:#fff"></span><b class="gr-name" style="font:400 15px/1 var(--f-stencil);letter-spacing:var(--tr-stencil)"></b><b class="gr-n" style="margin-left:auto;font:400 15px/1 var(--f-stencil);color:var(--c-sodium);font-variant-numeric:tabular-nums"></b></div>
        <div class="gr-pips" style="display:flex;gap:2px"></div>
        <div class="gr-next" style="display:flex;align-items:center;gap:5px;font:400 var(--fs-caption)/1 var(--f-plate);letter-spacing:var(--tr-plate);color:rgba(231,234,228,.75)"></div>
      </div>
      <div class="obj-meter" hidden><i class="obj-meter-fill"></i><b></b></div>
      <div class="obj-banner"><b></b><small></small></div>
      <div class="callout"></div>
      <div class="notice"></div>
      <div class="spectate" hidden></div>
      <div class="snd-alive snd-ui"><div class="sa-side mine"></div><div class="sa-mid"><b class="sa-round"></b><small class="sa-role"></small></div><div class="sa-side theirs"></div></div>
      <div class="snd-marks snd-ui">${['A', 'B', 'bomb'].map(k => `<span class="snd-mark${k === 'bomb' ? ' bomb' : ''}" hidden><span class="sm-plate"><span>${k === 'bomb' ? icon('bomb', { size: 18, accent: 'currentColor' }) : k}</span></span><i class="sm-arrow"></i><small></small></span>`).join('')}</div>
      <div class="snd-ring snd-ui" hidden><svg viewBox="-32 -32 64 64" aria-hidden="true"><circle class="sr-track" r="26"/><circle class="sr-arc" r="26" transform="rotate(-90)"/></svg><span class="sr-ico">${icon('bomb', { size: 18, accent: 'currentColor' })}</span><b></b><small></small></div>
      <div class="snd-carry snd-ui" hidden>${icon('bomb', { size: 26, accent: 'currentColor' })}<span><b>You have the bomb</b><small>Stand still on A or B to plant</small></span></div>
      <button class="snd-spec snd-ui" type="button" data-tap="1" data-sound="tab" hidden><i class="ss-arrow">&lsaquo;</i><span><small class="ss-kick">Spectating</small><b class="ss-name"></b><small class="ss-left"></small></span><i class="ss-arrow">&rsaquo;</i></button>
      <div class="ctf-status ctf-ui">${['mine', 'theirs'].map(k => `<div class="cf-side ${k}"><i class="cf-ico">${icon('ui:flag', { size: 16 })}</i><span class="cf-txt"><b></b><small></small></span></div>`).join('')}</div>
      <div class="ctf-marks ctf-ui">${['mine', 'theirs'].map(k => `<span class="ctf-mark ${k}" hidden><span class="cm-plate">${icon('ui:flag', { size: 18 })}</span><i class="sm-arrow"></i><small></small></span>`).join('')}</div>
      <div class="ctf-carry ctf-ui" hidden>${icon('ui:flag', { size: 26 })}<span><b>You have their flag</b><small></small></span></div>
      <div class="snd-big snd-ui" hidden><small class="sbg-kick"></small><b></b><small class="sbg-sub"></small><span class="sbg-count"></span></div>
      <div class="death">
        <div class="death-col">
        <div class="death-top">
        <div class="death-card">
          <div class="dc-kick">Killed by</div>
          <div class="death-by"></div>
          <div class="dc-weapon"><span class="dc-icon"></span><b class="dc-wname"></b><small class="dc-tags"></small></div>
          <div class="dc-left" hidden></div>
        </div>
        <div class="death-timer">
          <svg viewBox="-30 -30 60 60" aria-hidden="true"><circle class="dt-track" r="26"/><circle class="dt-arc" r="26" transform="rotate(-90)"/></svg>
          <b class="death-count">3</b><small>Respawn</small>
        </div>
        </div>
        <div class="death-act" style="order:-1;display:flex;align-items:stretch;justify-content:center;gap:8px;max-width:100%;pointer-events:none">
        <div class="death-next" style="min-width:0">
          <span class="dn-now"><small>Next life</small><span class="dn-icon"></span><span class="dn-text"><b></b><small></small></span></span>
          <button class="dn-change" type="button" data-tap="1" data-sound="tab">${icon('swap', { size: 14, accent: 'currentColor' })}<b>Change</b></button>
        </div>
        <button class="btn death-go" type="button" data-tap="respawn" data-sound="confirm" aria-label="Respawn" style="flex:none;min-width:136px;height:44px;min-height:44px;padding:0 14px 0 11px;gap:9px;justify-content:flex-start;pointer-events:auto;touch-action:manipulation;animation:pick-in .3s .16s var(--ease-out) both;--cut:var(--cut-sm);clip-path:polygon(var(--cut) 0,100% 0,100% calc(100% - var(--cut)),calc(100% - var(--cut)) 100%,0 100%,0 var(--cut))">
          <span class="dg-ico" style="line-height:0">${icon('ui:play', { size: 16, accent: 'currentColor' })}</span>
          <span style="display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0"><b style="font:400 16px/1 var(--f-stencil);letter-spacing:var(--tr-stencil)">Respawn</b><small class="dg-sub" style="font:var(--fs-micro)/1 var(--f-plate);letter-spacing:var(--tr-plate);white-space:nowrap;opacity:.8"></small></span>
        </button>
        </div>
        </div>
        <div class="picker" role="dialog" aria-label="Loadout for the next life">
          <div class="pk-head"><b>Next life</b><small>Spawns with the one you pick. Take your time: you respawn when you tap Respawn.</small>
            <button class="pk-close" type="button" data-tap="1" data-sound="back" aria-label="Close">${icon('ui:close', { size: 16 })}</button></div>
          <div class="pk-row">${Array.from({ length: LOADOUT_COUNT }, (_, i) => `
          <button class="pick" type="button" data-tap="1" data-i="${i}"><b></b><span class="pk-line"><span class="pk-icon"></span><small class="pk-gun"></small></span><small class="pk-lv"></small></button>`).join('')}</div>
        </div>
      </div>
      <div class="flashbang"></div>
      <div class="daze-veil"><b></b></div>
      <div class="heal-veil"></div>
      <div class="endbanner"><i class="eb-band"></i><b></b><small></small></div>`;
    this.root.appendChild(el);

    const $ = sel => el.querySelector(sel);
    // Every mode's state in one place: the objective strip under the score bar (see ObjStrip and layout()).
    this.strip = new ObjStrip(el, $('.scorebar'));
    this.strip.mount($('.obj-strip'), { order: 1 });
    this.strip.mount($('.snd-alive'), { order: 1 });
    this.strip.mount($('.ctf-status'), { order: 1 });
    this.strip.mount($('.gun-rung'), { order: 1 });
    this.strip.mount($('.range-panel'), { order: 1 });
    this.strip.mount($('.obj-meter'), { row: 2 });
    this.vignette = $('.vignette');
    this.proCanvas = $('.pro-layer');
    this.proCtx = this.proCanvas.getContext('2d');
    this.proToast = $('.pro-toast');
    this.prints = new Footprints();
    this.printList = [];
    this.printClock = 0;
    this.proDrawn = false;
    this.heard = [];
    const sides = el.querySelectorAll('.sb-side');
    this.sbMine = { root: sides[0], score: sides[0].querySelector('.sb-score'), name: sides[0].querySelector('.sb-name'), fill: sides[0].querySelector('.sb-fill') };
    this.sbTheirs = { root: sides[1], score: sides[1].querySelector('.sb-score'), name: sides[1].querySelector('.sb-name'), fill: sides[1].querySelector('.sb-fill') };
    this.timeEl = $('.sb-time b');
    this.mmCanvas = $('.minimap canvas');
    this.mm = this.mmCanvas.getContext('2d');
    this.mmTag = $('.mm-tag');
    this.feedEl = $('.feed');
    this.medalsEl = $('.medals');
    this.hitEl = $('.hit');
    this.dmg = [...el.querySelectorAll('.dmg')].map(node => ({ el: node, life: 0, angle: 0 }));
    this.netChip = $('.net-chip');
    this.netText = $('.net-chip span');
    this.micBtn = $('.chip-btn.mic');
    this.speakerBtn = $('.chip-btn.speaker');
    this.hpNum = $('.hp-num');
    this.hpFill = $('.hp-fill');
    this.armorFill = $('.hp-armor');
    this.armorNum = $('.hp-armor-num');     // V8 Juggernaut: a sodium band over the health bar, scaled to the armour left.
    this.protectEl = $('.protect');
    this.vitals = $('.vitals');
    this.heatEl = $('.heat');
    this.heatFill = $('.heat-fill');
    this.overEl = $('.over-banner');
    this.boardEl = $('.board');
    this.boardGrid = $('.board-grid');
    this.calloutEl = $('.callout');
    this.objMarks = $('.obj-marks');
    this.objStrip = $('.obj-strip');
    this.objChips = $('.obj-chips');
    this.objTimer = $('.obj-timer');
    this.objTimerNum = $('.obj-timer b');
    this.objMeter = $('.obj-meter');
    this.gunEl = $('.gun-rung');
    this.objMeterFill = $('.obj-meter-fill');
    this.objMeterText = $('.obj-meter b');
    this.objBanner = $('.obj-banner');
    this.objNodes = [];           // One entry per objective point: chip and in-world marker.
    this.flashEl = $('.flashbang');
    this.dazeEl = $('.daze-veil');
    this.dazeTag = this.dazeEl.querySelector('b');
    this.dazeT = 0; this.dazeLen = 1; this.dazeAmt = 1;
    this.healEl = $('.heal-veil');
    this.hitX = $('.hit-x');
    this.armsName = $('.arms-name span');
    this.armsIcon = $('.arms-icon');
    this.armsAlt = $('.arms-alt');
    this.armsAltName = $('.arms-alt span');
    this.magFill = $('.mag-fill');
    this.hpLoss = $('.hp-loss');
    this.scorePop = $('.score-pop');
    this.scorePopNum = $('.score-pop b');
    this.scorePopWhy = $('.score-pop small');
    this.goEl = $('.go-flash');
    this.sbGoal = $('.sb-goal');
    this.boardMode = $('.board-mode');
    this.boardGoal = $('.board-goal');
    this.dcIcon = $('.dc-icon');
    this.dcName = $('.dc-wname');
    this.dcTags = $('.dc-tags');
    this.dcLeft = $('.dc-left');
    this.dtArc = $('.dt-arc');
    this.ammoEl = $('.ammo');
    this.reserveEl = $('.reserve');
    this.reloadTrack = $('.reload-track');
    this.reloadFill = $('.reload-fill');
    this.arms = $('.arms');
    this.noticeEl = $('.notice');
    this.specEl = $('.spectate');
    this.deathEl = $('.death');
    this.deathBy = $('.death-by');
    this.deathCount = $('.death-count');
    this.deathTimer = $('.death-timer');
    this.picks = [...el.querySelectorAll('.pick')];
    this.pickerEl = $('.picker');
    this.nextEl = $('.death-next');
    this.goBtn = $('.death-go');
    this.goSub = $('.dg-sub');
    // Respawn is the killer card's footer, full card width: not beside Change, where two sodium buttons read as one,
    // and kept over the card so it stays clear of where the aim thumb rests.
    this.deathEl.querySelector('.death-card')?.append(this.goBtn);
    Object.assign(this.goBtn.style, { gridColumn: '1 / -1', marginTop: '8px', width: '100%', height: '44px', justifyContent: 'center' });
    this.goBtn.addEventListener('click', () => this.#tapRespawn());
    this.nextIcon = $('.dn-icon');
    this.nextName = $('.dn-text b');
    this.nextGun = $('.dn-text small');
    this.pickDown = new Map();     // pointerId -> the card that pointer went down on; see #wirePicker.
    this.endEl = $('.endbanner');
    this.introEl = $('.intro');
    this.streakEdge = $('.streak-edge');
    this.leaveBtn = $('.board-leave');
    this.streakHitEl = $('.streak-hit');
    this.respawnEl = $('.respawn-flash');
    this.#range = new RangeReadout(el);
    if (!document.getElementById('snd-hud-style')) {
      const st = document.createElement('style');
      st.id = 'snd-hud-style';
      st.textContent = SND_CSS + CTF_CSS + DAZE_CSS + HIT_CSS;
      document.head.appendChild(st);
    }
    const ctfSide = k => { const root = $(`.cf-side.${k}`); return { root, word: root.querySelector('b'), sub: root.querySelector('small'), key: '' }; };
    this.ctfEl = {
      status: $('.ctf-status'),
      sides: [ctfSide('mine'), ctfSide('theirs')],
      marks: ['mine', 'theirs'].map(k => { const root = $(`.ctf-mark.${k}`); return { root, label: root.querySelector('small'), arrow: root.querySelector('.sm-arrow'), x: NaN, y: NaN, a: NaN, off: null, state: '', text: null, shown: false }; }),
      carry: $('.ctf-carry'), carryWord: $('.ctf-carry b'), carrySub: $('.ctf-carry small'),
    };
    this.sndEl = {
      alive: $('.snd-alive'), mine: $('.sa-side.mine'), theirs: $('.sa-side.theirs'), round: $('.sa-round'), role: $('.sa-role'),
      marks: [...el.querySelectorAll('.snd-mark')].map(root => ({ root, label: root.querySelector('small'), arrow: root.querySelector('.sm-arrow'), x: NaN, y: NaN, a: NaN, off: null, state: '', text: null, shown: false })),
      ring: $('.snd-ring'), ringArc: $('.sr-arc'), ringText: $('.snd-ring b'), ringSub: $('.snd-ring small'),
      carry: $('.snd-carry'), spec: $('.snd-spec'), specName: $('.ss-name'), specLeft: $('.ss-left'),
      big: $('.snd-big'), bigKick: $('.sbg-kick'), bigTitle: $('.snd-big b'), bigSub: $('.sbg-sub'), bigCount: $('.sbg-count'),
      pips: [sides[0].querySelector('.snd-pips'), sides[1].querySelector('.snd-pips')],
    };
    this.sndEl.spec.addEventListener('click', () => {
      if (!this.view) return;
      spectate.cycle(this.view, this.view.localId, 1);
      this.cache.sndSpec = null;
    });
    $('.range-leave').addEventListener('click', () => this.leaveCb?.());
    this.leaveBtn.addEventListener('click', () => this.#tapLeave());

    this.micBtn.addEventListener('click', () => this.micCb?.());
    this.speakerBtn.addEventListener('click', () => this.speakerCb?.());
    this.#wirePicker($('.dn-change'), $('.pk-close'));
    $('.scorebar').addEventListener('click', () => this.toggleBoard());
    this.#buildBoard();
  }

  // Two taps on purpose: a stray thumb on the open scoreboard must not end the match.
  #tapLeave() {
    if (!this.leaveArmed) {
      this.leaveArmed = true;
      this.leaveBtn.textContent = 'Tap again to leave';
      return;
    }
    this.toggleBoard();
    this.leaveCb?.();
  }

  // Twelve rows made once and only ever retexted, so an open board costs a few text writes a second.
  #buildBoard() {
    this.boardGrid.innerHTML = [0, 1].map(() => `
      <div class="lb-side">
        <div class="lb-head"><b class="lb-team"></b><span>K</span><span>D</span><span>A</span><span class="lb-mode">HS</span><span>Score</span></div>
        ${[0, 1, 2, 3, 4, 5].map(() => '<div class="lb-row"><span class="lb-name"><i class="lb-bdg"></i><u class="lb-lv"></u><b></b><i class="lb-vet"></i></span><span></span><span></span><span></span><span></span><span></span></div>').join('')}
      </div>`).join('');
    this.boardSides = [...this.boardGrid.querySelectorAll('.lb-side')].map(node => ({
      team: node.querySelector('.lb-team'),
      modeHead: node.querySelector('.lb-mode'),
      rows: [...node.querySelectorAll('.lb-row')].map(row => ({
        row, cells: row.children, name: row.querySelector('.lb-name b'), bdg: row.querySelector('.lb-bdg'), lv: row.querySelector('.lb-lv'), rank: -1,
        vet: row.querySelector('.lb-vet'), vetOn: null,
      })),
    }));
  }

  toggleBoard() {
    this.boardOpen = !this.boardOpen;
    this.boardEl.hidden = !this.boardOpen;
    this.boardClock = 0;
    this.leaveArmed = false;
    this.leaveBtn.textContent = 'Leave match';
    if (this.boardOpen && this.view) this.#paintBoard(this.view);
  }

  #paintBoard(view) {
    const me = this.#findLocal(view);
    if (!me) return;
    if (this.ffa || this.br || this.ex) { this.#paintFfaBoard(view, me); return; }
    [me.team, 1 - me.team].forEach((team, s) => {
      const side = this.boardSides[s];
      side.team.textContent = `${TEAMS[team].name}  ${view.scores[team]}`;
      side.team.style.color = TEAMS[team].css;
      const rows = view.players.filter(p => p.team === team);
      for (const p of rows) Object.assign(p, this.objectiveStats(p.id));
      rows.sort((a, b) => matchScore(b) - matchScore(a) || a.deaths - b.deaths);
      side.rows.forEach((slot, i) => {
        const p = rows[i], { row, cells } = slot;
        row.hidden = !p;
        if (!p) return;
        row.classList.toggle('me', p.id === me.id);
        if (row.dataset.voice !== p.id) row.dataset.voice = p.id;    // js/ui/voice-ui.js: talking mark and mute
        if (slot.nameKey !== p.name) { slot.nameKey = p.name; slot.name.innerHTML = nameHtml(p.name); }
        slot.name.style.color = '';
        const badge = this.badges.get(p.id);
        const rank = badge?.prestige ?? -1;
        if (rank !== slot.rank) {
          slot.rank = rank;
          slot.bdg.innerHTML = badge ? badgeMark(rank, 15) : '';
        }
        slot.lv.textContent = badge?.level ?? '';
        this.#paintAway(slot, p);
        cells[1].textContent = p.kills;
        cells[2].textContent = p.deaths;
        cells[3].textContent = p.assists ?? 0;
        cells[4].textContent = this.#objectiveStat(p);
        cells[5].textContent = matchScore(p);
      });
    });
  }

  // Free-for-all: one ranked list over both halves (12 rows, the largest field), each row in that player's colour.
  #paintFfaBoard(view, me) {
    const ranked = ffaRank(view);
    const per = this.boardSides[0].rows.length;
    this.boardSides.forEach((side, s) => {
      side.team.textContent = s === 0 ? `Standings  ${ORDINAL(ranked.indexOf(me) + 1)}` : '';
      side.team.style.color = s === 0 ? TEAMS[me.team].css : '';
      side.modeHead.textContent = this.gun ? 'Gun' : 'HS';
      side.rows.forEach((slot, i) => {
        const at = s * per + i, p = ranked[at], { row, cells } = slot;
        row.hidden = !p;
        if (!p) return;
        row.classList.toggle('me', p.id === me.id);
        if (row.dataset.voice !== p.id) row.dataset.voice = p.id;    // js/ui/voice-ui.js: talking mark and mute
        const nk = `${at + 1}|${p.name}`;
        if (slot.nameKey !== nk) { slot.nameKey = nk; slot.name.innerHTML = `${at + 1}. ${nameHtml(p.name)}`; }
        slot.name.style.color = TEAMS[p.team]?.css ?? '';
        const badge = this.badges.get(p.id);
        const rank = badge?.prestige ?? -1;
        if (rank !== slot.rank) { slot.rank = rank; slot.bdg.innerHTML = badge ? badgeMark(rank, 15) : ''; }
        slot.lv.textContent = badge?.level ?? '';
        this.#paintAway(slot, p);
        cells[1].textContent = p.kills;
        cells[2].textContent = p.deaths;
        cells[3].textContent = p.assists ?? 0;
        cells[4].textContent = this.gun ? `${Math.min(GUN_LADDER.length, (view.scores[p.team] ?? 0) + 1)}` : p.head ?? 0;
        cells[5].textContent = matchScore(p);
      });
    });
  }

  // The name's tag: a held slot (the player dropped; see Sim.humanLeft) says Reconnecting, or Open slot once anyone may
  // take it; everyone else shows their Veteran mark. Rewritten only when it changes.
  #paintAway(slot, p) {
    const id = identityOf(p.id), vet = !!id?.vet;
    const mark = p.away ? (p.open ? 'open' : 'away') : `${vet}:${id?.emblem ?? ''}`;
    slot.row.classList.toggle('away', !!p.away);
    if (mark === slot.vetOn) return;
    slot.vetOn = mark;
    slot.vet.innerHTML = p.away ? `<em class="lb-away${p.open ? ' open' : ''}">${p.open ? 'Open slot' : 'Reconnecting'}</em>` : vetTag(vet, { short: true, emblem: id?.emblem });
  }

  // Fourth score column: the mode's own number where it has one, headshots otherwise.
  #objectiveStat(p) {
    if (this.modeHud.on) return this.modeHud.stat(p);
    if (this.snd) return `${p.plants ?? 0}/${p.defuses ?? 0}`;
    if (this.ctf) return `${p.captures ?? 0}/${p.returns ?? 0}/${p.carrierKills ?? 0}`;
    if (this.mode === 'kc') return p.confirms ?? 0;
    if (this.mode === 'dom' || this.mode === 'hard') return p.captures ?? 0;
    return p.head ?? 0;
  }

  // The death screen's loadout choice is two deliberate taps in the top half of the screen: Change, then a card. Nothing
  // selectable sits where the thumbs rest (both bottom quadrants and the button cluster), so a thumb put down to move
  // or aim after the respawn can never switch loadouts. A card only counts a tap whose finger went down on that same
  // card while the picker was open: a stick touch that slides onto a card, or a press that began before the picker
  // opened, selects nothing. Respawn never waits on the picker; it closes when the player is back.
  #wirePicker(changeBtn, closeBtn) {
    changeBtn.addEventListener('click', () => this.#openPicker(!this.deathEl.classList.contains('picking')));
    closeBtn.addEventListener('click', () => this.#openPicker(false));
    for (const pick of this.picks) {
      pick.addEventListener('pointerdown', e => {
        if (this.deathEl.classList.contains('picking') && performance.now() - this.pickerOpenedAt > 120) this.pickDown.set(e.pointerId, pick);
      });
      pick.addEventListener('click', () => {
        // A click carries no pointerId in every engine, so the press is matched by card: any pointer that went down
        // on this card while the picker was open.
        let ok = false;
        for (const [id, el] of this.pickDown) if (el === pick) { ok = true; this.pickDown.delete(id); }
        if (ok) this.#choose(Number(pick.dataset.i));
      });
    }
    this.deathEl.addEventListener('pointercancel', e => this.pickDown.delete(e.pointerId));
  }

  #openPicker(on) {
    if (on && (!this.deathEl.classList.contains('show') || this.gun)) return;
    this.deathEl.classList.toggle('picking', on);
    this.pickDown.clear();
    if (on) {
      this.pickerOpenedAt = performance.now();
      this.#paintPicker(true);
    }
  }

  #choose(index) {
    const changed = index !== Progress.activeLoadout;
    Progress.activeLoadout = index;
    this.#paintPicker();
    if (changed) this.loadoutCb?.(Progress.loadout());
    // The choice shows on the picked card, then the picker folds back into the Next life line, which flashes once.
    clearTimeout(this.pickTimer);
    this.pickTimer = setTimeout(() => {
      this.#openPicker(false);
      this.nextEl.animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], { duration: 380, easing: 'ease-out' });
    }, 220);
  }

  #paintPicker(relabel = false) {
    const all = Progress.loadouts();
    if (relabel) {
      this.picks.forEach((pick, i) => {
        const l = all[i];
        pick.querySelector('b').textContent = l.name;
        pick.querySelector('.pk-gun').textContent = weaponName(l.primary);
        pick.querySelector('.pk-lv').innerHTML = weaponLevelHtml(Progress.weaponLevel(l.primary), Progress.weaponPrestige(l.primary));
        pick.querySelector('.pk-icon').innerHTML = glyph(l.primary, 14);
      });
      this.cache.picked = null;
    }
    const active = Progress.activeLoadout;
    if (this.cache.picked === active) return;
    this.cache.picked = active;
    this.picks.forEach((pick, i) => pick.classList.toggle('on', i === active));
    const l = all[active] ?? Progress.loadout();
    this.nextName.textContent = l.name;
    this.nextGun.innerHTML = gunLine(l.primary);
    this.nextIcon.innerHTML = glyph(l.primary, 18);
  }

  // --- Per-frame ---
  update(view, dt) {
    // Scheduled from the first real frame: a phone can spend a second building the renderer before that.
    if (this.pendingIntro) {
      const { mapId, mode, roster, localId } = this.pendingIntro;
      this.pendingIntro = null;
      this.#showIntro(mapId, mode, roster, localId);
    }
    if (view.phase !== 'warmup') this.#hideIntro(view.phase === 'live');  // The reveal rides the warmup.
    else this.#tickIntro(view);
    if (!this.remeasured) { this.remeasured = true; this.remeasure(); }
    const previousPhase = this.cache.phase;
    this.view = view;
    const me = this.#findLocal(view);
    if (!me) return;
    const c = this.cache;
    const myTeam = me.team;
    // Free-for-all: the other half of the scorebar is whoever you are chasing, the leader, or second place while you lead.
    let other = 1 - myTeam;
    if (this.ffa) {
      const ranked = ffaRank(view);
      const rival = ranked[0] === me ? ranked[1] : ranked[0];
      other = rival?.team ?? myTeam;
      if (c.rival !== (rival?.id ?? null) || c.teamFlip !== myTeam) {
        c.rival = rival?.id ?? null;
        c.teamFlip = myTeam;
        c.otherScore = NaN;
        this.#paintFfaBar(me, rival, ranked[0] === me);
      }
      const place = ORDINAL(ranked.indexOf(me) + 1);
      if (place !== c.place) { c.place = place; this.sbMine.name.textContent = place; }
    } else if (!this.br && !this.ex && c.teamFlip !== myTeam) {
      c.teamFlip = myTeam;
      this.#paintTeams(myTeam);
    }
    if (c.myScore !== view.scores[myTeam]) {
      if (c.myScore < view.scores[myTeam]) this.sbMine.score.animate(SCORE_POP, { duration: 280 });
      c.myScore = view.scores[myTeam];
      this.sbMine.score.textContent = c.myScore;
      this.sbMine.fill.style.transform = `scaleX(${Math.min(1, c.myScore / this.scoreLimit)})`;
    }
    if (this.snd || this.ctf) this.#sndPips(myTeam, view, c);
    if (c.otherScore !== view.scores[other]) {
      if (c.otherScore < view.scores[other]) this.sbTheirs.score.animate(SCORE_POP, { duration: 280 });
      c.otherScore = view.scores[other];
      this.sbTheirs.score.textContent = c.otherScore;
      this.sbTheirs.fill.style.transform = `scaleX(${Math.min(1, c.otherScore / this.scoreLimit)})`;
    }

    const lead = c.myScore > c.otherScore ? 'mine' : c.otherScore > c.myScore ? 'theirs' : '';
    if (lead !== c.lead) {
      c.lead = lead;
      this.sbMine.root.classList.toggle('lead', lead === 'mine');
      this.sbTheirs.root.classList.toggle('lead', lead === 'theirs');
    }

    const snd = this.snd ? sndOf(view) : null;
    // A planted bomb's fuse replaces the round clock.
    const planted = snd?.bomb.state === 'planted';
    const shown = planted ? Math.ceil(snd.fuse) : view.phase === 'warmup' ? Math.ceil(view.timeLeft) : Math.max(0, Math.ceil(view.timeLeft));
    if (this.snd && c.sndGoal !== (planted ? 'Bomb' : `Round ${snd?.round ?? 1}`)) {
      c.sndGoal = planted ? 'Bomb' : `Round ${snd?.round ?? 1}`;
      this.sbGoal.textContent = c.sndGoal;
      this.sbGoal.style.color = planted ? 'var(--c-red, #ff4d3d)' : '';
      c.time = NaN;
    }
    if (c.time !== shown) {
      c.time = shown;
      this.timeEl.textContent = `${pad2(Math.floor(shown / 60))}:${pad2(shown % 60)}`;
      this.timeEl.classList.toggle('urgent', (view.phase === 'live' && shown <= 30 && snd?.state !== 'post') || planted);
      if ((view.phase === 'live' && shown <= 10 && shown > 0 && snd?.state !== 'post') || planted) this.timeEl.animate(COUNT_POP, { duration: 300, easing: 'ease-out' });
    }

    if (view.phase !== previousPhase) {
      c.phase = view.phase;
      if (view.phase === 'ended' && !this.endShown) {
        this.#showEndBanner(view.winner, myTeam, view);
        if (this.boardOpen) this.toggleBoard();
      }
    }

    if (view.phase === 'warmup' && !this.modeBannerShown && view.mode === this.mode && !this.snd) {
      this.modeBannerShown = true;
      this.#banner(MODES[this.modeId]?.name ?? '', MODES[this.modeId]?.desc ?? '', 3200);
    }
    this.#updateObjectives(view, me, c);
    this.#updateGun(view, me, c);

    // Out of play (dead, spectating, out of a battle royale): the weapon panel and health step back.
    const down = !me.alive;
    if (down !== c.meDown) { c.meDown = down; this.el.classList.toggle('me-down', down); }
    this.#updateVitals(me, c, view);
    this.#updateArms(me, c);
    this.controls?.notePlayerAim(me.aim);
    this.#updateTiles(me, c);
    if (this.snd) this.#updateSnd(view, me, c, snd);
    else if (this.br) this.brHud.update(view, me, dt);
    else {
      if (this.ex) this.exHud.update(view, me, dt);
      if (this.zm) this.zmHud.update(view, me, dt);
      this.#updateDeath(me, c, view);
    }
    if (this.ctf) this.#updateCtf(view, me, c);
    this.modeHud.update(view, me);
    this.#decayEffects(dt);
    this.#tickFeed(dt);
    this.#tickMedals(dt);
    this.#range.update(view.range ?? this.rangeSource?.() ?? null, dt);

    if (this.boardOpen) {
      this.boardClock += dt;
      if (this.boardClock >= 1 / BOARD_HZ) {
        this.boardClock = 0;
        this.#paintBoard(view);
      }
    }

    this.mmClock += dt;
    if (this.mmClock >= 1 / MINIMAP_HZ) {
      this.mmClock = 0;
      this.#drawMinimap(view, me);
    }
    this.#updateProLayer(view, me, dt);
  }

  // ---- Search and Destroy ----
  // Rounds instead of a kill count: the pips under each side of the scorebar fill one per round won.
  #sndPips(myTeam, view, c) {
    const key = `${myTeam}:${view.scores[myTeam]}:${view.scores[1 - myTeam]}`;
    if (key === c.sndPips) return;
    c.sndPips = key;
    [view.scores[myTeam], view.scores[1 - myTeam]].forEach((won, s) => {
      const pips = this.sndEl.pips[s].children;
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < won);
    });
  }

  // Everything the mode adds, once a frame. Each part writes the DOM only when what it shows has changed.
  #updateSnd(view, me, c, snd) {
    if (!snd) return;
    const attacking = me.team === snd.attackers;
    this.#sndAlive(view, me, c, snd, attacking);
    this.#sndBig(view, me, c, snd, attacking);
    this.#sndLife(view, me, c, snd);
    this.#sndRing(view, me, c, snd);
    const carry = me.alive && snd.carrier === me.id && snd.state !== 'post' && view.phase !== 'ended';
    if (carry !== c.sndCarry) { c.sndCarry = carry; this.sndEl.carry.hidden = !carry; }
    this.#sndMarks(view, me, snd, attacking);
  }

  // The strip under the scorebar: a figure per player, dimmed when out; the bomb on whoever carries it, for the
  // attackers only (defenders never learn who has it). In the middle, this side's job this round.
  #sndAlive(view, me, c, snd, attacking) {
    const mine = [], theirs = [];
    for (const p of view.players) (p.team === me.team ? mine : theirs).push(p);
    const sig = list => list.map(p => `${p.alive ? 1 : 0}${attacking && snd.carrier === p.id ? 'b' : ''}${p.id === me.id ? 'm' : ''}`).join('');
    const key = `${me.team}|${sig(mine)}|${sig(theirs)}|${snd.round}|${attacking}`;
    if (key === c.sndAlive) return;
    c.sndAlive = key;
    const row = (list, team) => list.map(p => `<i class="sa-p${p.alive ? '' : ' dead'}${p.id === me.id ? ' me' : ''}" style="--team:${TEAMS[team].css}">${icon('ui:user', { size: 14 })}${attacking && team === me.team && snd.carrier === p.id ? `<span class="sa-bomb">${icon('bomb', { size: 10, accent: 'currentColor' })}</span>` : ''}</i>`).join('');
    this.sndEl.mine.innerHTML = row(mine, me.team);
    this.sndEl.theirs.innerHTML = row(theirs, 1 - me.team);
    const alive = list => list.filter(p => p.alive).length;
    this.sndEl.round.textContent = `${alive(mine)} v ${alive(theirs)}`;
    this.sndEl.role.textContent = attacking ? 'Attack' : 'Defend';
    this.sndEl.role.dataset.role = attacking ? 'attack' : 'defend';
  }

  // The centre plate between rounds. Freeze: the round, this side's job and the countdown (with halftime and match
  // point called out). Post: who took the round and why. Hidden while the round is being played.
  #sndBig(view, me, c, snd, attacking) {
    let key = '';
    let kick = '', title = '', sub = '', side = '';
    const need = (view.scoreLimit ?? 4) - 1;
    if (snd.state === 'freeze' && !this.introOn && view.phase !== 'ended') {
      const point = view.scores[0] === need || view.scores[1] === need;
      kick = snd.round === SND.halftime + 1 ? 'Halftime: sides switched' : point ? `Round ${snd.round}  /  Match point` : `Round ${snd.round}`;
      title = attacking ? 'Attack' : 'Defend';
      sub = attacking ? 'Plant the bomb at A or B' : 'Stop the bomb: defend A and B';
      side = point ? 'gold' : 'mine';
      key = `f${snd.round}`;
    } else if (snd.state === 'post' && view.phase !== 'ended') {
      const last = snd.history.at(-1);
      if (last) {
        const won = last.winner === me.team;
        kick = `Round ${snd.round}`;
        title = won ? 'Round won' : 'Round lost';
        sub = SND_WHY[last.reason]?.[won ? 0 : 1] ?? '';
        side = won ? 'mine' : 'enemy';
        key = `p${snd.round}`;
      }
    }
    const big = this.sndEl;
    if (key !== c.sndBig) {
      c.sndBig = key;
      big.big.hidden = !key;
      if (key) {
        big.bigKick.textContent = kick;
        big.bigTitle.textContent = title;
        big.bigSub.textContent = sub;
        big.big.dataset.side = side;
        big.big.animate([{ opacity: 0, transform: 'scale(1.18)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)' });
      }
      c.sndCount = NaN;
    }
    const count = key && snd.state === 'freeze' ? Math.max(1, Math.ceil(snd.clock)) : 0;
    if (count !== c.sndCount) {
      c.sndCount = count;
      big.bigCount.textContent = count ? String(count) : '';
      if (count) big.bigCount.animate(COUNT_POP, { duration: 320, easing: 'ease-out' });
    }
  }

  // Alive: nothing here. Out for the round: the Spectating plate (tap to switch teammate) and the next round's loadout
  // line. Freeze, from the second round on: the loadout line alone, the buy-in moment (a pick applies at once).
  #sndLife(view, me, c, snd) {
    const out = !me.alive && view.phase !== 'ended' && snd.state !== 'freeze';
    const buy = me.alive && snd.state === 'freeze' && snd.round > 1 && view.phase === 'warmup';
    const life = out ? 'spec' : buy ? 'buy' : '';
    if (life !== c.sndLife) {
      c.sndLife = life;
      const d = this.deathEl;
      d.classList.toggle('show', !!life);
      // Not 'snd-spec': that is the Spectating button's class, and the death screen would take its layout.
      d.classList.toggle('snd-life-buy', life === 'buy');
      d.classList.toggle('snd-life-spec', life === 'spec');
      if (!life) this.#openPicker(false);
      else this.#paintPicker(true);
      this.nextEl.querySelector('.dn-now > small').textContent = life === 'buy' ? 'This round' : 'Next round';
      this.pickerEl.querySelector('.pk-head b').textContent = life === 'buy' ? 'This round' : 'Next round';
      this.pickerEl.querySelector('.pk-head small').textContent = life === 'buy'
        ? 'Changes your kit now, until the round starts.' : 'You carry it from the next round.';
      this.controls?.setDown(out);
      this.el.classList.toggle('snd-out', out);
      if (out && !this.wasOut) spectate.reset();
      this.wasOut = out;
    }
    const watch = out ? spectate.target(view, me.id) : null;
    const left = out ? view.players.filter(p => p.team === me.team && p.alive).length : 0;
    const key = out ? `${watch}|${left}` : '';
    if (key !== c.sndSpec) {
      c.sndSpec = key;
      this.sndEl.spec.hidden = !out;
      if (out) {
        const p = watch && view.players.find(q => q.id === watch);
        this.sndEl.specName.textContent = p ? p.name : 'Team eliminated';
        this.sndEl.specLeft.textContent = left ? `${left} teammate${left === 1 ? '' : 's'} left${left > 1 ? '  /  tap to switch' : ''}` : 'Waiting for the next round';
      }
    }
  }

  // The plant or defuse ring, for whoever is doing it when that is you or the teammate you watch; an enemy defusing
  // your bomb shows too, if you can see them.
  #sndRing(view, me, c, snd) {
    const eye = me.alive ? me.id : spectate.target(view, me.id);
    const act = snd.plant ? { ...snd.plant, kind: 'plant' } : snd.defuse ? { ...snd.defuse, kind: 'defuse' } : null;
    let kind = '', text = '', sub = '';
    if (act && act.id === eye) {
      kind = act.kind;
      const who = act.id === me.id ? '' : `${view.players.find(p => p.id === act.id)?.name ?? ''}: `;
      text = `${who}${act.kind === 'plant' ? `Planting ${act.site ?? ''}` : 'Defusing'}`;
      sub = 'Hold still. Moving or a hit starts over';
    }
    const key = `${kind}|${text}`;
    if (key !== c.sndRing) {
      c.sndRing = key;
      this.sndEl.ring.hidden = !kind;
      this.sndEl.ring.dataset.kind = kind;
      this.sndEl.ringText.textContent = text;
      this.sndEl.ringSub.textContent = sub;
      c.sndRingFrac = NaN;
    }
    if (!kind) return;
    const frac = Math.round(act.t * 60) / 60;
    if (frac !== c.sndRingFrac) {
      c.sndRingFrac = frac;
      this.sndEl.ringArc.style.strokeDashoffset = ((1 - frac) * SND_RING).toFixed(1);
    }
  }

  // Site letters and the bomb, pinned over the world. A planted site turns red and counts its fuse down; the bomb shows
  // where both sides know it is (dropped), and over the carrier for the attackers.
  #sndMarks(view, me, snd, attacking) {
    const cam = this.camera, marks = this.sndEl.marks, b = snd.bomb;
    const sites = view.points ?? [];
    const ended = view.phase === 'ended' || this.introOn;     // Nothing pinned over the intro card.
    for (let i = 0; i < 2; i++) {
      const m = marks[i], pt = sites[i];
      if (!pt || ended) { this.#sndMark(m, false); continue; }
      const planted = b.state === 'planted' && b.site === pt.id;
      const other = b.state === 'planted' && !planted;
      const state = planted ? 'planted' : other ? 'dim' : 'site';
      const text = planted ? `0:${pad2(Math.max(0, Math.ceil(snd.fuse)))}` : other ? '' : attacking ? 'Plant' : 'Defend';
      if (state !== m.state) { m.state = state; m.root.dataset.state = state; }
      if (text !== m.text) { m.text = text; m.label.textContent = text; }
      // Standing on it, the ring at your feet says everything a marker would (the fuse is on the scorebar too).
      const near = me.alive && Math.hypot(pt.x - me.x, pt.z - me.z) <= pt.r;
      this.#sndMark(m, !near && !!cam, pt.x, 3.2, pt.z);
    }
    const m = marks[2];
    let bx = null, bz = null, text = '';
    if (!ended && b.state === 'dropped') { bx = b.x; bz = b.z; text = attacking ? 'Pick up' : 'Bomb'; }
    else if (!ended && b.state === 'carried' && attacking && snd.carrier !== me.id) {
      const p = view.players.find(q => q.id === snd.carrier);
      if (p?.alive) { bx = p.x; bz = p.z; text = p.name; }
    }
    if (text !== m.text) { m.text = text; m.label.textContent = text; }
    this.#sndMark(m, bx !== null && !!cam, bx, 2.7, bz);
  }

  // Projects one marker; off-screen it rides the edge of the safe area and points at its target, walking inward
  // until clear of the buttons and minimap like the objective markers do.
  #sndMark(m, show, x, y, z) {
    if (show !== m.shown) { m.shown = show; m.root.hidden = !show; }
    if (!show) return;
    const cam = this.camera, W = this.viewW, H = this.viewH;
    const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
    const vx = v[0] * x + v[4] * y + v[8] * z + v[12], vy = v[1] * x + v[5] * y + v[9] * z + v[13], vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    const w = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
    if (w <= 0.01) return;
    const sx = ((p[0] * vx + p[8] * vz + p[12]) / w * 0.5 + 0.5) * W, sy = (0.5 - (p[5] * vy + p[9] * vz + p[13]) / w * 0.5) * H;
    const dx = sx - W / 2, dy = sy - H / 2, s = this.safe;
    const minX = (s?.left ?? 0) + MARK_PAD_X, maxX = W - (s?.right ?? 0) - MARK_PAD_X;
    const minY = (s?.top ?? 0) + MARK_PAD_T + 36, maxY = H - (s?.bottom ?? 0) - MARK_PAD_B;
    let off = sx < minX || sx > maxX || sy < minY || sy > maxY, edge = 1;
    if (off) {
      const kx = dx > 0 ? (maxX - W / 2) / dx : dx < 0 ? (minX - W / 2) / dx : Infinity;
      const ky = dy > 0 ? (maxY - H / 2) / dy : dy < 0 ? (minY - H / 2) / dy : Infinity;
      edge = Math.min(kx, ky);
    }
    for (let step = 0; step < 18 && edge > 0.1 && this.#markBlocked(W / 2 + dx * edge, H / 2 + dy * edge); step++) { edge -= MARK_WALK; off = true; }
    const px = Math.round(W / 2 + dx * edge), py = Math.round(H / 2 + dy * edge);
    if (px !== m.x || py !== m.y) { m.x = px; m.y = py; m.root.style.transform = `translate3d(${px}px,${py}px,0)`; }
    if (off !== m.off) { m.off = off; m.root.classList.toggle('off', off); }
    if (off) {
      const a = Math.round(Math.atan2(dy, dx) * 12) / 12;
      if (a !== m.a) { m.a = a; m.arrow.style.transform = `rotate(${a}rad) translateX(24px)`; }
    }
  }

  // Round events: the feed and callouts. The big plate and the strip follow the state on their own.
  #onSnd(e) {
    const view = this.view, me = view && this.#findLocal(view);
    if (!me) return;
    const snd = sndOf(view);
    const attackers = snd?.attackers ?? 0;
    const name = id => view.players.find(p => p.id === id)?.name ?? '?';
    const css = id => TEAMS[view.players.find(p => p.id === id)?.team ?? 0]?.css ?? '#fff';
    const ally = id => view.players.find(p => p.id === id)?.team === me.team;
    const who = id => `<em style="color:${css(id)}">${esc(name(id))}</em>`;
    switch (e.kind) {
      case 'pickup':
        if (e.id === me.id) this.#callout('You have the bomb');
        else if (me.team === attackers) this.#pushFeed(`${who(e.id)}<span class="f-note">has the bomb</span>`, false, 'ally');
        break;
      case 'drop':
        if (me.team === attackers) this.#callout('Bomb dropped: pick it up');
        else this.#callout('They dropped the bomb');
        break;
      case 'planted':
        this.#pushFeed(`${who(e.id)}<span class="f-note">planted the bomb at ${esc(e.site)}</span>`, e.id === me.id, ally(e.id) ? 'ally' : 'foe');
        this.#banner(`Bomb planted at ${e.site}`, me.team === attackers ? 'Defend it until it goes off' : `Defuse it: ${SND.fuse} seconds`, 1800, me.team === attackers ? 'mine' : 'enemy');
        break;
      case 'defused':
        this.#pushFeed(`${who(e.id)}<span class="f-note">defused the bomb</span>`, e.id === me.id, ally(e.id) ? 'ally' : 'foe');
        break;
      case 'end':
        if (e.clutch) this.#pushFeed(`${who(e.clutch)}<span class="f-note">clutched the round</span>`, e.clutch === me.id, ally(e.clutch) ? 'ally' : 'foe');
        break;
      case 'round':
        spectate.reset();
        break;
      default: break;
    }
  }

  // Minimap: the two sites (red when the bomb is on one) and the bomb wherever this player is allowed to know it is.
  #drawSndMini(view, me, sx, sz, g, clock) {
    const snd = sndOf(view);
    if (!snd) return;
    const b = snd.bomb;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '400 13px "Railyard Stencil", sans-serif';
    for (const pt of view.points ?? []) {
      const x = pt.x * sx, y = pt.z * sz, r = Math.max(6, pt.r * sx);
      const planted = b.state === 'planted' && b.site === pt.id;
      g.fillStyle = planted ? `rgba(255,77,61,${0.35 + 0.3 * (Math.floor(clock * 4) % 2)})` : 'rgba(29,35,43,.72)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = planted ? '#ff4d3d' : '#f2a63b';
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#fff';
      g.fillText(pt.id, x, y + 0.5);
    }
    let bx = null, bz = null;
    if (b.state === 'dropped' || b.state === 'planted') { bx = b.x; bz = b.z; }
    else if (b.state === 'carried' && me.team === snd.attackers) {
      const p = view.players.find(q => q.id === snd.carrier);
      if (p) { bx = p.x; bz = p.z; }
    }
    if (bx === null) return;
    const x = bx * sx, y = bz * sz;
    g.fillStyle = b.state === 'planted' ? '#ff4d3d' : '#f2a63b';
    g.strokeStyle = '#101418';
    g.lineWidth = 2;
    g.fillRect(x - 4.5, y - 3.5, 9, 7);
    g.strokeRect(x - 4.5, y - 3.5, 9, 7);
  }

  // ---- Capture the Flag ----
  // Both flags' status under the scorebar (yours on the left), a marker over each flag or its carrier with the distance
  // to it, and the strip that tells a carrier what to do.
  #updateCtf(view, me, c) {
    const ctf = ctfOf(view);
    if (!ctf) return;
    const ended = view.phase === 'ended' || this.introOn;
    const name = id => view.players.find(p => p.id === id)?.name ?? '?';
    // Nothing of this layer over the intro card.
    if (c.ctfShown !== !this.introOn) { c.ctfShown = !this.introOn; this.ctfEl.status.hidden = this.introOn; }
    for (let k = 0; k < 2; k++) {
      const t = k === 0 ? me.team : 1 - me.team, f = ctf.flags[t], side = this.ctfEl.sides[k];
      const secs = Math.ceil(f.returnT ?? 0);
      const ownHome = ctf.flags[me.team].state === 'home';
      const key = `${t}|${f.state}|${f.carrier}|${f.state === 'dropped' ? secs : ''}|${ownHome}`;
      if (key === side.key) continue;
      side.key = key;
      side.root.style.setProperty('--team', TEAMS[t].css);
      side.root.dataset.state = f.state;
      const mine = t === me.team;
      side.word.textContent = f.state === 'home' ? (mine ? 'Your flag' : 'Their flag')
        : f.state === 'carried' ? (mine ? 'Flag taken' : f.carrier === me.id ? 'You have it' : 'Flag taken') : 'Dropped';
      side.sub.textContent = f.state === 'home' ? 'At base'
        : f.state === 'carried' ? (f.carrier === me.id ? (ownHome ? 'Run it home' : 'Hold it, yours is out') : `by ${name(f.carrier)}`) : `Returns in ${secs}s`;
    }
    this.#ctfMarks(view, me, ctf, ended, name);
    // The carrier's strip: where to take it, or that it has to wait for the own flag to come home.
    const carrying = !ended && me.alive && ctf.flags[1 - me.team].carrier === me.id;
    const own = ctf.flags[me.team];
    const carry = carrying ? (own.state === 'home' ? 'run' : 'wait') : '';
    if (carry !== c.ctfCarry) {
      c.ctfCarry = carry;
      this.ctfEl.carry.hidden = !carry;
      this.ctfEl.carry.dataset.wait = carry === 'wait' ? '1' : '';
      this.ctfEl.carrySub.textContent = carry === 'wait' ? 'Your flag is gone: it has to be home to score' : 'Take it to your flag. No sliding with it';
    }
  }

  // One marker per flag. On its stand it reads Defend or Take; carried, it rides over the carrier (Kill for the enemy who
  // has yours, Escort for a teammate with theirs, hidden over yourself, when your own flag's marker says Capture
  // instead); dropped, it shows Return or Take and the seconds left before it goes home.
  #ctfMarks(view, me, ctf, ended, name) {
    for (let k = 0; k < 2; k++) {
      const t = k === 0 ? me.team : 1 - me.team, f = ctf.flags[t], m = this.ctfEl.marks[k], mine = t === me.team;
      // Pinned over the pennant, not on it, so the flag itself stays in view under its marker.
      let x = f.x, z = f.z, show = !ended && !!this.camera, word = '', y = f.state === 'home' ? 5 : 3.4;
      if (f.state === 'carried') {
        const p = view.players.find(q => q.id === f.carrier);
        if (p) { x = p.x; z = p.z; }
        y = 3.8;
        if (f.carrier === me.id) show = false;
        word = mine ? `Kill ${name(f.carrier)}` : `Escort ${name(f.carrier)}`;
      } else if (f.state === 'dropped') {
        word = `${mine ? 'Return' : 'Take'} ${Math.ceil(f.returnT ?? 0)}s`;
      } else {
        const carrying = ctf.flags[1 - me.team].carrier === me.id;
        word = mine ? (carrying ? 'Capture' : 'Defend') : 'Take';
      }
      const d = Math.hypot(x - me.x, z - me.z);
      // Standing on it, the flag itself is the marker.
      if (me.alive && f.state !== 'carried' && d <= CTF.reach + 1.5) show = false;
      const text = `${word}|${Math.round(d)}`;
      if (text !== m.text) {
        m.text = text;
        m.label.innerHTML = `${esc(word)}<u>${Math.round(d)} m</u>`;
      }
      const state = f.state;
      if (state !== m.state || m.team !== t) {
        m.state = state; m.team = t;
        m.root.dataset.state = state;
        m.root.style.setProperty('--team', TEAMS[t].css);
      }
      this.#sndMark(m, show, x, y, z);
    }
  }

  // Feed, banners and callouts for the flag moments, worded from the local player's side.
  #onCtf(e) {
    const view = this.view, me = view && this.#findLocal(view);
    if (!me) return;
    const p = e.id ? view.players.find(q => q.id === e.id) : null;
    const who = p ? `<em style="color:${TEAMS[p.team]?.css ?? '#fff'}">${esc(p.name)}</em>` : '';
    const ours = e.team === me.team;                  // Whose flag it is.
    const self = e.id === me.id;
    switch (e.kind) {
      case 'take':
        this.#pushFeed(`${who}<span class="f-note">${e.from === 'field' ? 'picked up' : 'took'} ${ours ? 'your' : 'the enemy'} flag</span>`, self, ours ? 'foe' : 'ally');
        // Your own take, capture or return already has its medal (and the carrier strip): no banner on top of it.
        if (self) break;
        if (ours) this.#banner('Your flag is taken', `${p?.name ?? 'They'} has it: stop them`, 1700, 'enemy');
        else this.#banner('Flag taken', `${p?.name ?? 'A teammate'} has their flag`, 1500, 'mine');
        break;
      case 'drop':
        this.#callout(ours ? 'Your flag is down: touch it to return it' : 'Their flag is down: pick it up');
        break;
      case 'return':
        if (e.id) this.#pushFeed(`${who}<span class="f-note">returned ${ours ? 'your' : 'their'} flag</span>`, self, ours ? 'ally' : 'foe');
        if (self) break;
        this.#banner('Flag returned', ours ? (e.auto ? 'Your flag is back at base' : `${p?.name ?? 'A teammate'} brought it home`) : 'Their flag is back at base', 1400, ours ? 'mine' : 'enemy');
        break;
      case 'capture': {
        this.#pushFeed(`${who}<span class="f-note">captured ${ours ? 'your' : 'the enemy'} flag</span>`, self, ours ? 'foe' : 'ally');
        // The event carries the score after this capture; the view may be a snapshot behind it.
        const sc = e.score ?? view.scores ?? [0, 0];
        const mineN = sc[me.team] ?? 0, theirN = sc[1 - me.team] ?? 0;
        this.#banner(ours ? 'Flag lost' : self ? `${mineN} to ${theirN}` : 'Flag captured', ours ? `They scored. ${theirN} to ${mineN}` : self ? 'You scored' : `${p?.name ?? 'Your team'} scored. ${mineN} to ${theirN}`, 2000, ours ? 'enemy' : 'mine');
        break;
      }
      default: break;
    }
  }

  // Minimap: each flag in its team's colour on its stand (a hollow stand when it is away), a dropped flag with its
  // return clock as a shrinking ring, and both carriers ringed.
  #drawCtfMini(view, me, sx, sz, g, clock) {
    const ctf = ctfOf(view);
    if (!ctf) return;
    for (const f of ctf.flags) {
      const css = TEAMS[f.team].css;
      const bx = f.baseX * sx, by = f.baseZ * sz;
      // The stand: a ring, filled while the flag is on it.
      g.strokeStyle = css; g.lineWidth = 2;
      g.fillStyle = f.state === 'home' ? css : 'rgba(16,20,26,.75)';
      g.beginPath(); g.arc(bx, by, 6, 0, Math.PI * 2); g.fill(); g.stroke();
      let x = f.x, z = f.z;
      if (f.state === 'carried') {
        const p = view.players.find(q => q.id === f.carrier);
        if (p) { x = p.x; z = p.z; }
        const pulse = (clock * 1.5) % 1;
        g.strokeStyle = css; g.lineWidth = 2; g.globalAlpha = 1 - pulse;
        g.beginPath(); g.arc(x * sx, z * sz, 6 + pulse * 9, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      } else if (f.state === 'dropped') {
        const k = Math.max(0, Math.min(1, (f.returnT ?? 0) / CTF.returnTime));
        g.strokeStyle = '#f2a63b'; g.lineWidth = 2.5;
        g.beginPath(); g.arc(x * sx, z * sz, 8, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke();
      }
      this.#flagGlyph(g, x * sx, z * sz, css);
    }
  }

  // A small pennant on a pole, centred on (x, y).
  #flagGlyph(g, x, y, css) {
    g.fillStyle = '#e7eae4';
    g.fillRect(x - 3, y - 8, 1.6, 13);
    g.fillStyle = css; g.strokeStyle = '#101418'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x - 1.5, y - 8); g.lineTo(x + 7, y - 5); g.lineTo(x - 1.5, y - 1.5); g.closePath(); g.fill(); g.stroke();
  }

  // ---- Pro senses over the world ----
  // Footprints (Tracker Pro), the Fastball blast ring (Strong Arm Pro) and enemy equipment through walls (Hijacker,
  // Engineer Pro). One canvas at CSS pixels; cleared only when something was drawn, so it costs nothing otherwise.
  #updateProLayer(view, me, dt) {
    const pro = me.pro ?? NO_PRO;
    const g = this.proCtx, cam = this.camera;
    if (this.proDrawn) { g.clearRect(0, 0, this.proCanvas.width, this.proCanvas.height); this.proDrawn = false; }
    if (!cam || !me.alive || view.phase === 'ended' || pro.length === 0) return;
    const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements, W = this.viewW, H = this.viewH;
    const P = this.projected ??= { x: 0, y: 0 };
    const project = (x, y, z) => {
      const vx = v[0] * x + v[4] * y + v[8] * z + v[12], vy = v[1] * x + v[5] * y + v[9] * z + v[13], vz = v[2] * x + v[6] * y + v[10] * z + v[14];
      const w = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
      if (w <= 0.01) return null;
      P.x = ((p[0] * vx + p[8] * vz + p[12]) / w * 0.5 + 0.5) * W;
      P.y = (0.5 - (p[5] * vy + p[9] * vz + p[13]) / w * 0.5) * H;
      return P;
    };
    if (pro.includes('tracker')) {
      this.prints.update(view, me, view.t);
      this.printClock += dt;
      if (this.printClock >= 1 / PRINT_HZ) { this.printClock = 0; this.printList = this.prints.visible(this.map, me, view.t, view.smokes).slice(); }
      const enemy = this.ffa || this.ex ? FFA_FOE : TEAMS[1 - me.team].css;
      for (const f of this.printList) {
        const a = project(f.x, 0.03, f.z);
        if (!a) continue;
        const x0 = a.x, y0 = a.y;
        const b = project(f.x + Math.cos(f.a) * 0.3, 0.03, f.z + Math.sin(f.a) * 0.3);
        if (!b) continue;
        const ang = Math.atan2(b.y - y0, b.x - x0), len = Math.hypot(b.x - x0, b.y - y0);
        g.globalAlpha = 0.85 * (1 - (1 - f.k) * (1 - f.k));
        g.fillStyle = enemy;
        g.beginPath();
        g.ellipse(x0, y0, Math.max(4.5, len * 0.9), Math.max(2.4, len * 0.5), ang, 0, Math.PI * 2);
        g.fill();
        this.proDrawn = true;
      }
      g.globalAlpha = 1;
    }
    // The preview reports the radius when given the Pro list; the HUD knows it either way.
    const land = view.throwPreview?.landing;
    const radius = land ? land.radius || (pro.includes('strongarm') ? effectRadius(land.kind) : 0) : 0;
    if (radius > 0) {
      g.beginPath();
      for (let i = 0; i <= 32; i++) {
        const t = i / 32 * Math.PI * 2, q = project(land.x + Math.cos(t) * radius, 0.05, land.z + Math.sin(t) * radius);
        if (!q) continue;
        if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y);
      }
      g.fillStyle = 'rgba(255,215,94,.13)';
      g.fill();
      g.setLineDash([7, 5]);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,215,94,.9)';
      g.stroke();
      g.setLineDash([]);
      this.proDrawn = true;
    }
    if (pro.includes('engineer') && view.projectiles?.length) {
      const pulse = 0.65 + 0.35 * Math.sin(view.t * 6);
      for (const q of view.projectiles) {
        if (!SEEN_GEAR.has(q.kind) || !q.stuck) continue;
        const owner = view.players.find(o => o.id === q.owner);
        if (!owner || owner.team === me.team) continue;
        const a = project(q.x, 0.4, q.z);
        if (!a) continue;
        const r = 7;
        g.globalAlpha = pulse;
        g.strokeStyle = TEAMS[owner.team].css;
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(a.x, a.y - r); g.lineTo(a.x + r, a.y); g.lineTo(a.x, a.y + r); g.lineTo(a.x - r, a.y);
        g.closePath();
        g.stroke();
        g.fillStyle = '#fff';
        g.fillRect(a.x - 1.5, a.y - 1.5, 3, 3);
        this.proDrawn = true;
      }
      g.globalAlpha = 1;
    }
  }

  #findLocal(view) {
    for (const p of view.players) if (p.id === view.localId) return p;
    return null;
  }

  // Your own colour on the left; the rival's name and colour on the right, marked as the leader when they are.
  #paintFfaBar(me, rival, leading) {
    const mine = TEAMS[me.team]?.css ?? '#fff', theirs = rival ? TEAMS[rival.team]?.css ?? FFA_FOE : FFA_FOE;
    this.sbTheirs.name.textContent = rival ? `${leading ? '2nd ' : 'Lead '}${rival.name}` : '';
    this.sbMine.root.style.setProperty('--team', mine);
    this.sbTheirs.root.style.setProperty('--team', theirs);
    this.el.style.setProperty('--my-team', mine);
    this.el.style.setProperty('--enemy-team', FFA_FOE);
  }

  #paintTeams(myTeam) {
    const mine = TEAMS[myTeam], theirs = TEAMS[1 - myTeam];
    this.sbMine.name.textContent = mine.name;
    this.sbTheirs.name.textContent = theirs.name;
    this.sbMine.root.style.setProperty('--team', mine.css);
    this.sbTheirs.root.style.setProperty('--team', theirs.css);
    this.el.style.setProperty('--my-team', mine.css);
    this.el.style.setProperty('--enemy-team', theirs.css);
  }

  #updateVitals(me, c, view) {
    const hp = Math.max(0, Math.ceil(me.hp));
    if (hp !== c.hp) {
      const was = Number.isNaN(c.hp) ? hp : c.hp;
      c.hp = hp;
      this.hpNum.textContent = hp;
      this.hpFill.style.transform = `scaleX(${hp / MAX_HP})`;
      // The chunk just lost hangs for a beat as a pale trail, then drains: damage reads as an amount, not a flicker.
      this.hpLossAnim?.cancel();
      if (hp < was && me.alive) {
        this.hpLossAnim = this.hpLoss.animate([{ transform: `scaleX(${was / MAX_HP})` }, { transform: `scaleX(${hp / MAX_HP})` }],
          { duration: 420, delay: 260, easing: 'ease-in', fill: 'both' });
        this.vitals.animate(HP_KNOCK, { duration: 220, easing: 'ease-out' });
      } else {
        this.hpLoss.style.transform = `scaleX(${hp / MAX_HP})`;
      }
      const hurt = hp > 0 && hp <= MAX_HP * 0.35;
      if (hurt !== c.hurt) {
        c.hurt = hurt;
        this.vitals.classList.toggle('hurt', hurt);
        this.vignette.classList.toggle('critical', hurt && me.alive);
      }
    }
    const veil = me.alive && hp <= MAX_HP * 0.5 ? Math.round((1 - hp / (MAX_HP * 0.5)) * 20) / 20 : 0;
    if (veil !== c.vign) {
      c.vign = veil;
      this.vignette.style.opacity = veil;
    }
    // Juggernaut armour and Plate Drop plates share the band; plates alone fill it against their own 100.
    const armor = me.alive ? Math.max(0, Math.ceil((me.armor ?? 0) + (me.plates ?? 0))) : 0;
    if (armor !== c.armor) {
      c.armor = armor;
      this.armorFill.style.transform = `scaleX(${Math.min(1, armor / ((me.armor ?? 0) > 0 ? STREAKS.juggernaut.armor : STREAKS.plates.armor))})`;
      this.armorNum.hidden = armor <= 0;
      this.armorNum.textContent = `+${armor}`;
    }
    const protect = me.alive && me.spawnProtect && view.phase !== 'warmup';
    if (protect !== c.protect) {
      c.protect = protect;
      this.protectEl.hidden = !protect;
    }
  }

  #updateArms(me, c) {
    if (me.weapon !== c.weapon || me.attachments !== c.kit) {
      c.weapon = me.weapon;
      c.kit = me.attachments;
      this.armsName.textContent = weaponName(me.weapon);
      c.magazine = effectiveWeapon(me.weapon, me.attachments)?.magazine ?? 30;
      c.tag = null;                // The status line may need to return to the weapon's name.
      this.armsIcon.innerHTML = glyph(me.weapon, 15);
      this.#otherGun(me.weapon, c);
      // Rounds as notches when they can be counted at a glance; a belt-fed gun gets a plain gauge.
      this.arms.style.setProperty('--mag', c.magazine <= 40 ? c.magazine : 1);
      if (c.weaponSeen) this.arms.animate(ARMS_SWAP, { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1)' });
      c.weaponSeen = true;
      c.ammo = NaN;
    }
    if (me.ammo !== c.ammo) {
      c.ammo = me.ammo;
      const blade = !!WEAPONS[me.weapon]?.melee;   // V10: a blade has no rounds to count.
      this.ammoEl.textContent = blade ? '\u221e' : me.ammo;
      this.reserveEl.style.display = blade ? 'none' : '';
      this.magFill.style.transform = `scaleX(${Math.min(1, me.ammo / (c.magazine || 1))})`;
    }
    if (me.reserve !== c.reserve) {
      c.reserve = me.reserve;
      // Sidearms carry unlimited reserve, reported as a huge number.
      this.reserveEl.textContent = me.reserve > 900 ? '\u221e' : `${me.reserve}`;
    }
    const reloading = me.reloadT > 0 && me.reloadDur > 0;
    if (reloading !== c.reloadOn) {
      c.reloadOn = reloading;
      this.reloadTrack.classList.toggle('on', reloading);
    }
    if (reloading) {
      const frac = Math.round((1 - me.reloadT / me.reloadDur) * 40) / 40;
      if (frac !== c.reloadFrac) {
        c.reloadFrac = frac;
        this.reloadFill.style.transform = `scaleX(${frac})`;
      }
    }
    // There is no reload button, so the ammo readout itself says what is happening.
    const empty = me.ammo <= 0 && me.reserve <= 0;
    const low = !reloading && !WEAPONS[me.weapon]?.melee && me.ammo <= Math.ceil((c.magazine ?? 30) * LOW_AMMO);   // A blade is never low.
    const tag = empty ? 'empty' : reloading ? 'reloading' : low ? 'low' : '';
    if (tag !== c.tag) {
      c.tag = tag;
      this.arms.dataset.tag = tag;
      this.armsName.textContent = empty ? 'Out of ammo' : reloading ? 'Reloading' : low ? 'Low ammo' : weaponName(me.weapon);
    }
    if (empty !== c.swapHint) {
      c.swapHint = empty;
      this.controls?.setSwapHint(empty);
    }
    this.#updateHeat(me, c);
  }

  // The gun Swap brings out, under the one in hand. Known from the loadout the player spawned with; a gun from
  // anywhere else (the Armory, a pickup) pairs with the one it replaced. Modes that deal one gun show none.
  #otherGun(weapon, c) {
    const lo = Progress.loadout();
    let pair = this.armsPair;
    if (!pair || !pair.includes(weapon)) {
      pair = [lo.primary, lo.secondary].includes(weapon) ? [lo.primary, lo.secondary] : [weapon, c.lastWeapon ?? ''];
    }
    this.armsPair = pair;
    c.lastWeapon = weapon;
    const other = this.gun || this.br || this.modeHud.dealt || this.el.classList.contains('range-on') && !pair[1] ? '' : pair[0] === weapon ? pair[1] : pair[0];
    const name = other && other !== weapon ? weaponName(other) : '';
    if (name !== c.altName) {
      c.altName = name;
      this.armsAlt.hidden = !name;
      this.armsAltName.textContent = name;
    }
  }

  #updateHeat(me, c) {
    const heatGun = !!(WEAPONS[me.weapon]?.heat || WEAPONS[me.weapon]?.charge);   // A charge gun shows its charge on the same bar.
    if (heatGun !== c.heatOn) {
      c.heatOn = heatGun;
      this.heatEl.hidden = !heatGun;
    }
    const heat = heatGun ? Math.round((me.heat ?? 0) * 40) / 40 : 0;
    if (heat !== c.heat) {
      c.heat = heat;
      this.heatFill.style.transform = `scaleX(${heat})`;
    }
    const over = heatGun && !!me.overheated;
    const level = over ? 'over' : heat >= HEAT_WARN ? 'warm' : '';
    if (level !== c.heatLevel) {
      c.heatLevel = level;
      this.arms.dataset.heat = level;
    }
    if (over !== c.overBanner) {
      c.overBanner = over;
      this.overEl.classList.toggle('show', over);
    }
  }

  #updateTiles(me, c) {
    const controls = this.controls;
    if (!controls) return;
    const score = me.score ?? 0, capped = !!me.capped;
    if (score !== c.score || capped !== c.capped) {
      c.score = score; c.capped = capped;
      controls.setScore(score, capped);
    }
    const slots = me.slots ?? this.fallbackSlots;
    for (let i = 0; i < 3; i++) {
      const slot = slots[i];
      if (controls.setTile(i, slot, score)) this.#streakReady(slot.kind);
    }
    controls.setEquip('tactical', me.tactical ?? this.fallbackEquip.tactical, me.tacticalLeft ?? 0);
    controls.setEquip('lethal', me.lethal ?? this.fallbackEquip.lethal, me.lethalLeft ?? 0);
    controls.setJammed?.(!!me.jammedSelf);
    controls.setDetonate?.(me.lethal === 'charge' && me.alive && !!this.view?.projectiles?.some(q => q.kind === 'charge' && q.owner === me.id && q.stuck));
  }

  // The moment a streak comes online: a full-size card, a bright edge flash and a pulse from the tile.
  #streakReady(kind) {
    const name = STREAKS[kind]?.name ?? kind;
    const el = this.streakHitEl;
    el.querySelector('.sh-icon').innerHTML = glyph(kind, 34);
    el.querySelector('b').textContent = `${name} ready`;
    el.querySelector('small').textContent = STREAKS[kind]?.desc ?? 'Tap its tile to call it in';
    el.animate(STREAK_HIT, { duration: 1300, easing: 'cubic-bezier(.2,.9,.3,1)' });
    this.streakEdge.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
  }

  #updateDeath(me, c, view) {
    const dead = !me.alive && view.phase === 'live';
    if (dead !== c.dead) {
      c.dead = dead;
      this.#resetRespawn(dead, view.t);
      c.timerOn = null;
      this.deathEl.classList.toggle('show', dead);
      if (dead) this.#paintPicker(true);
      else this.#openPicker(false);
      this.controls?.setDown(dead);
      this.respawnTotal = RESPAWN_TIME;
      c.ring = NaN;
      if (dead) this.#paintDeathHead(view);
    }
    if (!dead) return;
    // Once the wait is over the ring has said all it can; the Respawn button carries the rest.
    const wait = this.#respawnWait(me);
    const waiting = wait > 0.05;
    if (waiting !== c.timerOn) {
      c.timerOn = waiting;
      this.deathTimer.style.visibility = waiting ? '' : 'hidden';
    }
    const left = Math.max(1, Math.ceil(wait));
    if (left !== c.respawn) {
      c.respawn = left;
      this.deathCount.textContent = left;
      this.deathCount.animate(COUNT_POP, { duration: 320, easing: 'ease-out' });
    }
    // The ring empties toward the respawn, in 1/40 steps so it repaints a few dozen times rather than every frame.
    const ring = Math.round(Math.max(0, Math.min(1, wait / this.respawnTotal)) * 40) / 40;
    if (ring !== c.ring) {
      c.ring = ring;
      this.dtArc.style.strokeDashoffset = ((1 - ring) * DEATH_RING).toFixed(1);
    }
    if (this.killer?.name && !this.deathPainted) this.#paintDeathHead(view);
    this.#updateRespawn(me, c);
  }

  // A death starts a fresh wait. With auto-respawn on, the request goes to the host at once, so the player is back the
  // moment the minimum respawn time ends; with it off they tap (or the host's idle fallback brings them back). The
  // countdowns run on match time (view.t), the clock the host runs on, so a slow phone cannot run ahead of it.
  #resetRespawn(dead, t = 0) {
    const r = this.respawn ??= { asked: false, diedAt: 0, sentAt: -99, auto: false };
    r.asked = false;
    r.queued = false;              // Tapped before the wait was over: asked for the moment it is.
    r.diedAt = t;
    r.sentAt = -99;
    r.deathAt = performance.now() / 1000;
    r.sawKillcam = false;
    r.readyAt = null;              // Local clock: when the respawn wait ends. Set once the death replay is over.
    r.auto = Options.get('autoRespawn') === true;
    this.cache.goState = '';
    this.cache.goSub = '';
    if (!dead) this.goBtn.classList.remove('pressed');
    // Auto-respawn brings you back by itself: the ring counts it down, so there is nothing to tap.
    this.goBtn.style.display = r.auto ? 'none' : '';
    this.deathEl.classList.toggle('tap-mode', !r.auto);
  }

  // Seconds left before this player may respawn. The wait starts when the death replay ends (or right away when
  // there is none), so nobody loses respawn time to watching the killcam. Never shorter than the host's own timer.
  #respawnWait(me) {
    const r = this.respawn;
    if (!r) return Math.max(0, me?.respawnT ?? 0);
    const now = performance.now() / 1000;
    const replaying = document.body.classList.contains('killcam-on');
    if (replaying) r.sawKillcam = true;
    if (r.readyAt === null) {
      // A replay starts about half a second after the death; give it a moment to begin before assuming there is none.
      if (r.sawKillcam && !replaying) r.readyAt = now + RESPAWN_TIME;
      else if (!r.sawKillcam && now - r.deathAt > 0.8) r.readyAt = r.deathAt + RESPAWN_TIME;
    }
    const local = r.readyAt === null ? RESPAWN_TIME : Math.max(0, r.readyAt - now);
    return Math.max(local, me?.respawnT ?? 0);
  }

  #askRespawn() {
    const r = this.respawn;
    r.asked = true;
    r.sentAt = performance.now() / 1000;
    this.respawnCb?.({});
  }

  #tapRespawn() {
    const r = this.respawn;
    if (!r || !this.deathEl.classList.contains('show') || r.asked) return;
    this.#openPicker(false);
    // Before the wait is over the tap is kept and sent the moment it ends (see #updateRespawn).
    if (this.#respawnWait(this.view && this.#findLocal(this.view)) > 0.05) r.queued = true;
    else this.#askRespawn();
    this.#updateRespawn(this.view && this.#findLocal(this.view), this.cache);
  }

  // The Respawn button: what it will do, and the seconds before it can (or before the respawn happens by itself).
  // Repeats any request the host may not have acted on; the host ignores duplicates.
  #updateRespawn(me, c) {
    const r = this.respawn;
    if (!r || !me || me.alive) return;
    const now = performance.now() / 1000;
    if (r.asked && now - r.sentAt >= RESPAWN_RESEND) { r.sentAt = now; this.respawnCb?.({}); }
    const wait = this.#respawnWait(me);
    const ready = wait <= 0.05;
    // Auto-respawn, or a tap made during the wait: ask the host the moment the wait is over.
    if (ready && !r.asked && !this.snd && (r.auto || r.queued)) this.#askRespawn();
    const queued = r.asked || r.queued || r.auto;
    const state = queued ? 'asked' : ready ? 'ready' : 'wait';
    let sub;
    if (document.body.classList.contains('killcam-on')) sub = 'After the replay';
    else if (queued) sub = r.asked ? 'Deploying' : `Respawning in ${Math.ceil(wait)}`;
    else if (!ready) sub = `Ready in ${Math.ceil(wait)}`;
    else sub = `Tap now / auto ${Math.max(1, Math.ceil(RESPAWN_IDLE - ((this.view?.t ?? r.diedAt) - r.diedAt)))}`;
    if (sub !== c.goSub) { c.goSub = sub; this.goSub.textContent = sub; }
    if (state !== c.goState) {
      c.goState = state;
      const b = this.goBtn;
      // Waiting: a steel plate (still tappable: the tap is kept until the wait is over). Ready: the sodium plate.
      b.classList.toggle('is-primary', state !== 'wait');
      b.setAttribute('aria-pressed', r.asked ? 'true' : 'false');
      if (state === 'ready') b.animate([{ filter: 'brightness(1.9)' }, { filter: 'none' }], { duration: 420, easing: 'ease-out' });
    }
  }

  // The killer card: who, with what, from how far, and how much fight they had left.
  #paintDeathHead(view) {
    const k = this.killer;
    this.deathPainted = !!k?.name;
    const card = this.deathEl.querySelector('.death-card');
    card.style.setProperty('--team', k?.color ?? 'var(--haze)');
    // The killer's calling card carries their name; badge, level and the Veteran tag ride under it.
    const who = k?.name ? identityOf(k.id) : null;
    this.deathBy.innerHTML = k?.name
      ? `${cardHtml(who?.card ?? 'yard', { size: 236, title: k.name, sub: '' })}
         <span class="dc-vet">${k.badge ? `<i class="f-bdg">${badgeMark(k.badge.prestige ?? 0, 16)}</i><u>Lv ${k.badge.level ?? ''}</u>` : ''}${vetTag(!!who?.vet, { emblem: who?.emblem })}</span>`
      : '<em>Eliminated</em>';
    this.deathEl.querySelector('.dc-kick').textContent = k?.name ? (k.self ? 'Your own blast' : 'Killed by') : 'Down';
    this.dcIcon.innerHTML = k ? glyph(k.icon, 20) : '';
    this.dcName.textContent = k?.weapon ?? '';
    const tags = [];
    if (k?.head) tags.push('Headshot');
    if (k?.dist) tags.push(`${Math.round(k.dist)} m`);
    this.dcTags.textContent = tags.join('   ');
    this.dcTags.classList.toggle('head', !!k?.head);
    const killer = k && view?.players.find(p => p.id === k.id);
    const hp = killer?.alive ? Math.ceil(killer.hp) : null;
    this.dcLeft.hidden = hp === null || k.self;
    if (hp !== null) this.dcLeft.innerHTML = `<i style="transform:scaleX(${(hp / MAX_HP).toFixed(2)})"></i><span>Left on ${hp} HP</span>`;
  }

  #decayEffects(dt) {
    this.clockT += dt;
    if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt);
      const f = this.hitT / this.hitLife;
      this.hitEl.style.opacity = Math.min(1, f * 2);
      this.hitEl.style.transform = `translate3d(-50%,-50%,0) scale(${(this.hitScale * (1 + (1 - f) * 0.35)).toFixed(3)})`;
    }
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.flashEl.style.opacity = Math.min(1, this.flashT / this.flashFadeLen).toFixed(3);
    }
    if (this.dazeT > 0) {
      this.dazeT = Math.max(0, this.dazeT - dt);
      this.dazeEl.style.opacity = Math.min(1, this.dazeT / Math.min(0.6, this.dazeLen) * this.dazeAmt).toFixed(3);
    }
    for (const d of this.dmg) {
      if (d.life <= 0) continue;
      d.life = Math.max(0, d.life - dt);
      d.el.style.opacity = Math.min(1, d.life / DMG_LIFE * 1.6);
    }
  }

  // --- Events ---
  onEvents(events) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (this.br) this.brHud.onEvent(e, this.view);
      if (this.ex) this.exHud.onEvent(e, this.view);
      if (this.zm) this.zmHud.onEvent(e, this.view);
      this.modeHud.onEvent(e, this.view);
      switch (e.t) {
        case 'shot': if (e.by === this.view?.localId && e.rays) this.#onOwnShot(e); break;
        case 'hit': this.#onHit(e); break;
        case 'kill': this.#onKill(e); break;
        case 'medal': this.#onMedal(e); break;
        case 'spawn':
          if (e.id === this.view?.localId) {
            this.killer = null;
            this.deathPainted = false;
            this.#syncThrowReach();
            this.respawnEl.animate(RESPAWN_FLASH, { duration: 420, easing: 'ease-out' });
          }
          break;
        case 'streak': this.#onStreak(e); break;
        case 'streak_denied': this.#onDenied(e); break;
        case 'incoming': this.#onIncoming(e); break;
        case 'emp': this.#onEmp(e); break;
        case 'pulse': this.#onPulse(e); break;
        case 'zap': if (e.by === this.view?.localId) this.notify(e.kind === 'dome' ? 'Aegis Dome stopped a throw' : 'Trophy stopped a grenade'); break;
        case 'streak_aim': case 'air_down': case 'crate_open': case 'crate': case 'plates': case 'plates_break': this.#onV9(e); break;
        case 'decoy': if (e.by === this.view?.localId) this.notify('Decoy firing'); else this.#fakePing(e); break;
        case 'stuck': if (e.id === this.view?.localId) this.#banner(e.kind === 'tagger' ? 'Tagged' : 'Stuck!', e.kind === 'tagger' ? 'The enemy can see you for 8 s' : 'Get it away from your team', 1100, 'enemy'); break;
        case 'jammed': if (e.id === this.view?.localId) this.notify('Blackout: equipment and radar down'); break;
        case 'pickup': if (e.id === this.view?.localId) this.notify('Shiv recovered'); break;
        case 'flashed': if (e.id === this.view?.localId) this.#onFlashed(e.amount ?? 1); break;
        case 'dazed': if (e.id === this.view?.localId) this.#onDazed(e); break;
        case 'heal': if (e.id === this.view?.localId) this.healEl.animate(HEAL_PULSE, { duration: 520 }); break;
        case 'capture': this.#onCapture(e); break;
        case 'hard_move': this.#onHardMove(e); break;
        case 'pro': if (e.id === this.view?.localId) this.#onPro(e.perk); break;
        case 'hijack': this.#onHijack(e); break;
        case 'armor_break': if (e.id === this.view?.localId) this.#callout('Armour broken'); break;
        case 'arm': this.#onArm(e); break;
        case 'snd': this.#onSnd(e); break;
        case 'ctf': this.#onCtf(e); break;
        default: break;
      }
    }
  }

  // Every player's medals arrive, and the objective ones double as the per-player capture and confirm counts.
  #onMedal(e) {
    if (e.medal === 'confirm' || e.medal === 'capture') {
      const key = e.medal === 'confirm' ? 'confirms' : 'captures';
      const t = this.objTally.get(e.id) ?? { confirms: 0, captures: 0 };
      t[key]++;
      this.objTally.set(e.id, t);
    }
    if (e.id === this.view?.localId) this.medalQueue.push(e.medal);
  }

  // Captures and confirmations per player, tallied from medals, for the live board and the results screen. Capture the
  // Flag's own counts (captures, returns, carrier kills) come with the view from the host, so nothing overrides them.
  objectiveStats(id) {
    if (this.ctf) return NO_STATS;
    return this.objTally.get(id) ?? { confirms: 0, captures: 0 };
  }

  // One of the local player's rounds reached a player through cover (the ray carries `pen` below 1): the hit
  // event that follows within a moment is marked as reduced.
  #onOwnShot(e) {
    for (let i = 0; i < e.rays.length; i++) {
      const r = e.rays[i];
      if (r.hit === 'player' && r.pen < 1) { this.coverShotT = this.clockT; return; }
    }
  }

  #onHit(e) {
    const localId = this.view?.localId;
    if (e.by === localId) {
      const kill = !!e.killed, head = !!e.head;
      this.hitLife = kill ? SKULL_LIFE : HIT_LIFE;
      this.hitT = this.hitLife;
      if (this.hitKill !== kill) {
        this.hitKill = kill;
        this.hitEl.classList.toggle('kill', kill);
      }
      if (this.hitHead !== head) {
        this.hitHead = head;
        this.hitEl.classList.toggle('head', head);
      }
      // Armour soaked it, or cover took some of it off first: the marker says so (see HIT_CSS).
      const armor = !!e.armor || !!e.plate, weak = !armor && this.clockT - this.coverShotT < COVER_HIT_WINDOW;
      if (this.hitArmor !== armor) { this.hitArmor = armor; this.hitEl.classList.toggle('armor', armor); }
      if (this.hitWeak !== weak) { this.hitWeak = weak; this.hitEl.classList.toggle('weak', weak); }
      // A heavy round lands a bigger marker than a light one: 0.85x for a graze up to 1.25x for a sniper hit.
      this.hitScale = kill ? 1 : Math.max(0.85, Math.min(1.25, 0.8 + (e.dmg || 25) / 110)) * (weak ? 0.85 : 1);
      if ((head || kill || armor) && !REDUCED_MOTION.matches) this.hitEl.animate(HIT_PUNCH, { duration: 160, easing: 'ease-out' });
    }
    if (e.target === localId && e.by !== localId) this.#damageFrom(e);
  }

  #onCapture(e) {
    const view = this.view, me = view && this.#findLocal(view);
    if (!me) return;
    const pts = view.points ?? [];
    const idx = pts.findIndex(p => p.id === e.point);
    const label = idx >= 0 ? pointLabel(pts[idx], idx) : String(e.point ?? '').toUpperCase();
    const ours = e.team === me.team;
    if (this.mode === 'hard') return;
    this.#banner(ours ? `${label} Captured` : `${label} Lost`, ours ? 'Hold it for points' : 'Take it back', 1500, ours ? 'mine' : 'enemy');
    this.notify(`${ours ? '' : 'Enemy '}${TEAMS[e.team]?.name ?? 'Team'} took ${label}`);
  }

  // The sim also emits this when the match goes live; that first zone is not a move worth announcing.
  #onHardMove() {
    if (this.hardMoves++ === 0) return;
    this.#banner('Hardpoint Moved', 'Find the new zone', 1500);
    this.hardWarned = false;
  }

  // Large centred announcement for mode events. `side` tints it for the local team, the enemy or neither.
  #banner(title, sub, duration = 1400, side = '') {
    const el = this.objBanner;
    el.querySelector('b').textContent = title;
    el.querySelector('small').textContent = sub;
    el.dataset.side = side;
    el.animate(BANNER_POP, { duration, easing: 'ease-out' });
  }

  #callout(text) {
    const el = this.calloutEl;
    if (el.textContent !== text) el.textContent = text;
    el.animate(CALLOUT_POP, { duration: 900, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  // amount 0..1 sets how long the player stays blind; the screen always starts fully white.
  #onFlashed(amount) {
    const hold = FLASH_HOLD * amount, fade = FLASH_FADE * Math.max(0.3, amount);
    this.flashFadeLen = fade;
    this.flashT = Math.max(this.flashT, hold + fade);
  }

  // Decoy: an enemy decoy's fake shot shows on this minimap as a gunfire ping, the same as a real one.
  #fakePing(e) {
    const me = this.view && this.#findLocal(this.view);
    if (!me || e.team === me.team) return;
    const list = this.fakePings ??= [];
    const old = list.find(f => Math.hypot(f.x - e.x, f.z - e.z) < 1);
    if (old) { old.t = performance.now(); return; }
    if (list.length >= 6) list.shift();
    list.push({ x: e.x, z: e.z, team: e.team ?? 0, t: performance.now() });
  }

  // Stun, Gas, Shock on the local player. The phone's own movement is slowed by match.js (player.js applyDaze).
  #onDazed(e) {
    const kind = DAZE_TAG[e.kind] ? e.kind : 'stun';
    if (this.dazeEl.dataset.kind !== kind) { this.dazeEl.dataset.kind = kind; this.dazeTag.textContent = DAZE_TAG[kind]; }
    this.dazeLen = Math.max(0.3, e.dur ?? 1);
    this.dazeT = Math.max(this.dazeT, this.dazeLen);
    this.dazeAmt = Math.max(0.45, Math.min(1, e.amount ?? 1));
  }

  #damageFrom(e) {
    const view = this.view, me = view && this.#findLocal(view);
    let sx = e.x, sz = e.z;
    const attacker = view?.players.find(p => p.id === e.by);
    if (attacker) { sx = attacker.x; sz = attacker.z; }
    if (!me) return;
    const angle = Math.atan2(sz - me.z, sx - me.x) * 180 / Math.PI + 90;
    let slot = this.dmg[0];
    for (const d of this.dmg) if (d.life < slot.life) slot = d;
    slot.life = DMG_LIFE;
    slot.el.style.transform = `translate3d(-50%,-50%,0) rotate(${angle}deg)`;
    slot.el.style.opacity = '1';
  }

  #onKill(e) {
    const view = this.view;
    if (!view) return;
    if (this.zm && this.zmHud.quietKill(e, view)) return;     // Graveyard Shift: the horde's deaths stay off the feed.
    const byP = view.players.find(p => p.id === e.by);
    const tgtP = view.players.find(p => p.id === e.target);
    const byName = byP?.name ?? '?';
    const tgtName = tgtP?.name ?? '?';
    const byCss = TEAMS[byP?.team ?? 0].css, tgtCss = TEAMS[tgtP?.team ?? 1].css;
    const mine = e.by === view.localId || e.target === view.localId;
    const causeId = e.equip ?? (typeof e.streak === 'string' ? e.streak : e.weapon);
    const art = glyph(causeId, 13, 'gl f-gun');
    // The Golden Gun's own feed mark: its silhouette in gold with a glint, so the whole lobby sees what happened.
    const gold = causeId === GOLDEN_ID && !e.equip && !e.streak;
    const goldStyle = gold ? ` style="color:${GOLD_CSS};filter:drop-shadow(0 0 4px rgba(255,207,64,.75))"` : '';
    const cause = art ? `<span class="f-w${gold ? ' f-gold' : ''}"${goldStyle} title="${esc(killCause(e))}">${art}</span>` : `<span class="f-w f-text">${esc(killCause(e))}</span>`;
    const head = e.head ? `<span class="f-hs">${glyph('medal:headshot', 14)}</span>` : '';
    const side = byP?.team === view.players.find(p => p.id === view.localId)?.team ? 'ally' : 'foe';
    this.#pushFeed(`${this.#feedBadge(e.by)}<em style="color:${byCss}">${nameHtml(byName)}</em>${cause}${head}${this.#feedBadge(e.target)}<em style="color:${tgtCss}">${nameHtml(tgtName)}</em>`, mine, side);
    if (e.by === view.localId && e.target !== view.localId) this.#scorePop(SCORE.kill + (e.head ? SCORE.headshot : 0), e.head ? 'Headshot' : 'Kill');
    else if (e.assist === view.localId) this.#scorePop(SCORE.assist, 'Assist');

    if (e.target === view.localId) {
      this.killer = {
        id: e.by, name: byName, color: byCss, weapon: killCause(e), icon: e.equip ?? (typeof e.streak === 'string' ? e.streak : e.weapon),
        head: !!e.head, dist: e.streak || e.equip ? 0 : e.dist, badge: this.badges.get(e.by) ?? null, self: e.by === e.target,
      };
      this.deathPainted = false;
    }
  }

  #feedBadge(id) {
    const badge = this.badges.get(id);
    return badge ? `<i class="f-bdg">${badgeMark(badge.prestige ?? 0, 13)}</i>` : '';
  }

  #onStreak(e) {
    const view = this.view;
    if (!view) return;
    const p = view.players.find(q => q.id === e.id);
    const me = this.#findLocal(view);
    if (!p || !me) return;
    const friendly = p.team === me.team;
    const name = STREAKS[e.kind]?.name ?? e.kind;
    const verb = STREAK_VERB[e.kind] ?? 'called in';
    this.notify(`${friendly ? '' : 'Enemy '}${name} ${verb}`);
    // The ones that change what this player can see or do get a callout as well as a feed line.
    if (!friendly && STREAK_WARN[e.kind]) this.#callout(STREAK_WARN[e.kind]);
    else if (p.id === me.id) this.#callout(PILOT_HINT[e.kind] && e.kind !== 'bombrun' ? `${name}: ${PILOT_HINT[e.kind]}` : `${name} ${verb}`);
  }

  // V9 scorestreak events: drawing a Carpet Line, shoot-downs, Airdrops and plates.
  #onV9(e) {
    const view = this.view, me = view && this.#findLocal(view);
    if (!me) return;
    const nameOf = id => view.players.find(q => q.id === id)?.name ?? '';
    const streak = k => STREAKS[k]?.name ?? (k === 'reticle' ? 'Carpet Line' : k);
    switch (e.t) {
      case 'streak_aim': if (e.id === me.id) this.#callout(PILOT_HINT[e.kind] ?? 'Aim it'); break;
      case 'air_down': {
        if (e.kind === 'reticle') break;
        const ours = e.team === me.team;
        if (e.emp) { if (ours && e.owner === me.id) this.notify(`Your ${streak(e.kind)} was knocked out by an EMP`); break; }
        if (e.by === me.id) this.notify(`You shot down an enemy ${streak(e.kind)}`);
        else if (ours) { this.notify(`${nameOf(e.by) || 'The enemy'} shot down your team's ${streak(e.kind)}`); if (e.owner === me.id) this.#callout(`${streak(e.kind)} shot down`); }
        else this.notify(`${nameOf(e.by)} shot down an enemy ${streak(e.kind)}`);
        break;
      }
      case 'crate':
        if (e.team === me.team) this.notify('Airdrop landed: stand on it to open');
        break;
      case 'crate_open': {
        const who = e.id === me.id ? 'You' : nameOf(e.id);
        if (e.stolen && e.team !== me.team && e.owner === me.id) this.#callout(`${who} stole your Airdrop`);
        else if (e.id === me.id) this.#callout(`Airdrop: ${streak(e.kind)}${e.stolen ? ' (stolen)' : ''}`);
        else this.notify(`${who} ${e.stolen ? 'stole an Airdrop' : 'opened an Airdrop'}: ${streak(e.kind)}`);
        break;
      }
      case 'plates': if (e.id === me.id && e.by !== me.id) this.notify(`${nameOf(e.by)} gave you armour plates`); break;
      case 'plates_break': if (e.id === me.id) this.#callout('Plates broken'); break;
    }
  }

  // The tile already says why; this makes the refusal felt at the moment of the tap.
  #onDenied(e) {
    if (e.id !== this.view?.localId) return;
    const name = STREAKS[e.kind]?.name ?? e.kind;
    this.#callout(`${name}: ${STREAK_DENY_TEXT[e.reason] ?? 'Unavailable'}`);
  }

  // Mortar shells are announced before they land; only enemy shells near this player are worth a shout.
  #onIncoming(e) {
    const me = this.view && this.#findLocal(this.view);
    if (!me?.alive || e.team === me.team) return;
    if (Math.hypot(e.x - me.x, e.z - me.z) > INCOMING_WARN_M) return;
    const now = performance.now();
    if (now - (this.incomingAt ?? -1e9) < INCOMING_GAP_MS) return;
    this.incomingAt = now;
    this.#callout('Incoming! Move');
  }

  #onEmp(e) {
    const me = this.view && this.#findLocal(this.view);
    if (!me || e.team !== me.team) return;
    this.#banner('EMP', 'Air, machines and radar down. Streaks offline 12 s', 2000, 'enemy');
  }

  #onPulse(e) {
    const me = this.view && this.#findLocal(this.view);
    if (!me?.alive || e.by === me.id) return;
    const owner = this.view.players.find(p => p.id === e.by);
    if (!owner || owner.team === me.team) return;
    if (Math.hypot(e.x - me.x, e.z - me.z) <= (e.r ?? 0)) this.#callout('Sensor: you are marked');
  }

  // "+100" under the crosshair, off to one side so it never sits on the target. Kills close together add up.
  #scorePop(points, why) {
    const now = performance.now();
    const fresh = now - (this.popAt ?? -1e9) > SCORE_POP_LIFE * 1000;
    this.popAt = now;
    this.popSum = fresh ? points : (this.popSum ?? 0) + points;
    this.scorePopNum.textContent = `+${this.popSum}`;
    this.scorePopWhy.textContent = why;
    this.scorePopAnim?.cancel();
    this.scorePopAnim = this.scorePop.animate(fresh ? SCORE_POP_IN : SCORE_POP_BUMP, { duration: SCORE_POP_LIFE * 1000 + 300, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  #pushFeed(html, mine = false, side = '') {
    const row = document.createElement('div');
    row.className = `f-row${mine ? ' mine' : ''}${side ? ' ' + side : ''}`;
    row.innerHTML = html;
    row.animate([{ transform: 'translateX(-18px)', opacity: 0, filter: 'brightness(2)' }, { transform: 'none', opacity: 1, filter: 'brightness(1)' }], { duration: 240, easing: 'cubic-bezier(.2,.9,.3,1)' });
    this.feedEl.prepend(row);
    this.feed.unshift({ row, life: FEED_LIFE });
    while (this.feed.length > (this.feedRows ?? FEED_ROWS)) this.feed.pop().row.remove();
  }

  // A few seconds on the host's notice line, then the feed keeps a record of it.
  announceHost(name, isMe) {
    this.setNotice(isMe ? 'You are now the host' : `${name} is now hosting`);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.setNotice(''), 2600);
    this.notify(isMe ? 'You took over as host' : `${name} took over as host`);
  }

  #tickFeed(dt) {
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const item = this.feed[i];
      item.life -= dt;
      if (item.life <= 0) {
        item.row.remove();
        this.feed.splice(i, 1);
      } else if (item.life < 0.5 && !item.fading) {
        item.fading = true;
        item.row.classList.add('out');
      }
    }
  }

  #tickMedals(dt) {
    this.medalClock -= dt;
    if (this.medalClock > 0 || !this.medalQueue.length) return;
    this.medalClock = MEDAL_GAP;
    this.#stamp(this.medalQueue.shift());
  }

  // id is a medal id, or a ready-made { title, sub, big } card such as a streak coming online.
  #stamp(id) {
    const card = typeof id === 'object' ? id : null;
    const [title, sub, tier] = card ? [card.title, card.sub, card.big ? 3 : 2] : MEDALS[id] ?? [String(id).replace(/_/g, ' '), '', 1];
    const art = card ? '' : glyph(`medal:${id}`, 32);
    const node = document.createElement('div');
    node.className = `medal t${tier}`;
    node.innerHTML = `${art ? `<span class="md-icon">${art}</span>` : ''}<span class="md-text"><b>${esc(title)}</b><small>${esc(sub)}</small></span><i class="md-sweep"></i>`;
    node.style.setProperty('--tilt', `${(Math.random() * 5 - 2.5).toFixed(1)}deg`);
    node.style.animationDuration = `${MEDAL_LIFE}s`;
    node.addEventListener('animationend', e => { if (e.target === node) node.remove(); });
    while (this.medalsEl.childElementCount >= 2) this.medalsEl.firstElementChild.remove();
    this.medalsEl.appendChild(node);
  }

  #showEndBanner(winner, myTeam, view = this.view) {
    if (this.endShown) return;
    this.endShown = true;
    this.endAt = performance.now();
    this.deathEl.classList.remove('show', 'picking');
    if (this.br) {
      this.brHud.endBanner(this.endEl, winner, myTeam, view);
      this.endEl.classList.add('show');
      return;
    }
    if (this.ex) {
      this.exHud.endBanner(this.endEl, winner, myTeam, view);
      this.endEl.classList.add('show');
      return;
    }
    if (this.zm) {
      this.zmHud.endBanner(this.endEl, winner, myTeam, view);
      this.endEl.classList.add('show');
      return;
    }
    if (this.ffa && view) {
      // Placement, not sides: first is a win, the podium is a good day, the rest is a loss.
      const ranked = ffaRank(view), at = ranked.findIndex(p => p.team === myTeam) + 1;
      const won = winner === myTeam, leader = ranked[0];
      this.endEl.dataset.result = won ? 'win' : winner === null || winner === undefined ? 'draw' : at <= 3 ? 'draw' : 'loss';
      this.endEl.querySelector('b').textContent = won ? '1st place' : at ? `${ORDINAL(at)} place` : 'Match over';
      this.endEl.querySelector('small').textContent = won ? (this.gun ? 'Through every gun' : 'Last one standing') : `${leader?.name ?? 'Someone'} took the yard`;
      this.endEl.classList.add('show');
      return;
    }
    const won = winner === myTeam, drawn = winner === null || winner === undefined;
    this.endEl.dataset.result = drawn ? 'draw' : won ? 'win' : 'loss';
    this.endEl.querySelector('b').textContent = drawn ? 'Stalemate' : won ? 'Victory' : 'Defeat';
    // Search and Destroy: the score in rounds and how the last one went.
    const last = this.snd ? sndOf(view)?.history?.at(-1) : null;
    const tally = this.snd && view?.scores ? `${view.scores[myTeam]} rounds to ${view.scores[1 - myTeam]}` : '';
    const caps = this.ctf && view?.scores ? `${view.scores[myTeam]} ${view.scores[myTeam] === 1 ? 'capture' : 'captures'} to ${view.scores[1 - myTeam]}` : '';
    this.endEl.querySelector('small').textContent = last ? `${tally}. ${SND_WHY[last.reason]?.[last.winner === myTeam ? 0 : 1] ?? ''}`
      : caps ? (drawn ? `Level at ${caps}` : caps)
      : drawn ? 'Neither side broke through' : won ? 'The yard is yours' : 'The yard is lost';
    this.ctfEl.carry.hidden = true;
    this.sndEl.big.hidden = true;
    this.endEl.classList.add('show');
  }

  // --- Minimap ---
  // Walls never move, so they are drawn once into an off-screen layer.
  #drawMapBase() {
    const map = this.map;
    // The canvas follows the map's shape, so a square map is not squashed. It only changes between matches.
    const shape = Math.round(MM_WIDTH * MM_SCALE * (map.height / map.width));
    if (this.mmCanvas.height !== shape) {
      this.mmCanvas.height = shape;
      this.mmCanvas.style.height = this.mmCanvas.parentNode.style.height = `${(shape / MM_SCALE).toFixed(1)}px`;
    }
    const W = this.mmCanvas.width, H = this.mmCanvas.height;
    this.staticSet = null;           // Jammed snow is drawn over this map's walls.
    const base = this.mmBase ??= document.createElement('canvas');
    base.width = W;
    base.height = H;
    const g = base.getContext('2d');
    this.mmX = W / map.width;
    this.mmZ = H / map.height;
    g.fillStyle = '#2b3540';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#39444f';
    for (const w of map.walls) {
      if (w.kind === 'border') continue;
      g.fillStyle = w.blocksVision ? '#8896a3' : '#566370';
      g.fillRect(w.x * this.mmX, w.z * this.mmZ, Math.max(w.w * this.mmX, 2), Math.max(w.d * this.mmZ, 2));
    }
  }

  #drawMinimap(view, me) {
    const g = this.mm;
    let sx = this.mmX, sz = this.mmZ;
    // Battle royale: the minimap shows your surroundings, not the whole 400 m map (js/ui/br-hud.js); everything below
    // draws in map metres times sx, so a translate and a bigger scale are all it takes.
    const zoomer = this.br && this.brHud.on ? this.brHud : this.ex && this.exHud.on ? this.exHud : null;
    const zoom = zoomer ? zoomer.miniWindow(view, me, this.mmCanvas.width, this.mmCanvas.height) : null;
    if (zoom) { zoomer.drawMiniBase(g, zoom); g.save(); g.translate(-zoom.ox * zoom.k, -zoom.oz * zoom.k); sx = sz = zoom.k; }
    else g.drawImage(this.mmBase, 0, 0);
    try { this.#drawMinimapLayers(view, me, g, sx, sz); } finally { if (zoom) g.restore(); }
  }

  #drawMinimapLayers(view, me, g, sx, sz) {
    const myTeam = me.team;
    const myUav = view.uav[myTeam] > 0;
    const enemyUav = this.ffa ? view.uav.some((v, t) => t !== myTeam && v > 0) : view.uav[1 - myTeam] > 0;
    const jammed = !!view.jammed;
    const tag = jammed ? 'Jammed' : enemyUav ? 'Enemy UAV' : '';
    if (tag !== this.cache.mmTag) {
      this.cache.mmTag = tag;
      this.mmTag.hidden = !tag;
      this.mmTag.textContent = tag;
      this.mmCanvas.parentNode.classList.toggle('jammed', jammed);
    }
    // Jammed: the radar shows snow and nothing on it can be trusted, so only the local player's own arrow stays.
    if (jammed) {
      const frames = this.#staticFrames();
      g.drawImage(frames[(this.staticTick = ((this.staticTick ?? 0) + 1) % STATIC_FRAMES)], 0, 0);
      this.#drawSelf(g, me, sx, sz);
      return;
    }

    // UAV: a sweep ring expanding from the local player. Drawn before the markers so they stay crisp.
    const clock = performance.now() / 1000;
    let pulse = 0;
    if (myUav) {
      pulse = (clock * 0.7) % 1;
      g.strokeStyle = `rgba(255,214,120,${(1 - pulse) * 0.85})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(me.x * sx, me.z * sz, pulse * this.mmCanvas.width * 0.7, 0, Math.PI * 2);
      g.stroke();
    }

    if (view.smokes?.length) {
      g.fillStyle = 'rgba(201,205,214,.55)';
      for (const s of view.smokes) {
        g.beginPath();
        g.arc(s.x * sx, s.z * sz, s.r * sx, 0, Math.PI * 2);
        g.fill();
      }
    }

    if (this.snd) this.#drawSndMini(view, me, sx, sz, g, clock);
    else if (this.ctf) this.#drawCtfMini(view, me, sx, sz, g, clock);
    else this.#drawObjectivesMini(view, me, sx, sz, g, clock);
    // A flag carrier shows on the enemy minimap wherever they are (the price of carrying it).
    const ctf = this.ctf ? ctfOf(view) : null;
    // Out for the round, you see what the teammate you watch sees.
    const eyeId = (this.snd || this.br || this.ex) && !me.alive ? spectate.target(view, me.id) : null;
    const eye = eyeId ? view.players.find(p => p.id === eyeId) ?? me : me;

    for (const p of view.players) {
      if (!p.alive || p.id === me.id) continue;
      const friendly = p.team === myTeam;
      const seen = friendly || (myUav && !p.ghost) || (ctf && (ctf.flags[0].carrier === p.id || ctf.flags[1].carrier === p.id))
        || (eye.alive && hasLineOfSight(this.map, eye.x, eye.z, p.x, p.z, view.smokes));
      const firing = !seen && (p.firingT ?? 0) > 0;
      if (!seen && !firing) continue;
      const x = p.x * sx, y = p.z * sz;
      if (firing) {
        // Gunfire ping: a hollow marker that fades as the reveal runs out, plainly weaker than a sighting.
        const k = Math.min(1, p.firingT / FIRE_REVEAL);
        g.strokeStyle = TEAMS[p.team].css;
        g.globalAlpha = 0.35 + 0.65 * k;
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(x, y, 4 + (1 - k) * 8, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      } else if (friendly) {
        g.fillStyle = TEAMS[p.team].css;
        g.fillRect(x - 3.5, y - 3.5, 7, 7);
      } else {
        const r = myUav ? 5.5 + Math.sin(clock * 8 + x) * 1.3 : 5;
        g.fillStyle = p.ai ? AI_CSS : TEAMS[p.team].css;      // Extraction's AI patrols: one colour, apart from the squads.
        g.beginPath();
        g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
        g.closePath();
        g.fill();
      }
    }

    // Decoy pings: drawn exactly like a gunfire ping, which is the point.
    if (this.fakePings?.length) {
      const now = performance.now();
      this.fakePings = this.fakePings.filter(f => now - f.t < FIRE_REVEAL * 1000);
      for (const f of this.fakePings) {
        const k = 1 - (now - f.t) / (FIRE_REVEAL * 1000);
        g.strokeStyle = TEAMS[f.team]?.css ?? TEAMS[0].css;
        g.globalAlpha = 0.35 + 0.65 * k;
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(f.x * sx, f.z * sz, 4 + (1 - k) * 8, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    this.#drawDeployables(view, myTeam, sx, sz, g);
    this.#drawProMini(view, me, sx, sz, g, clock);
    if (this.br) this.brHud.drawMini(g, view, me, sx, sz);
    if (this.ex) this.exHud.drawMini(g, view, me, sx, sz);
    this.modeHud.drawMini(g, view, me, sx, sz, clock);

    this.#drawSelf(g, me, sx, sz);
  }

  // Keen Ears (Dead Silence Pro): a sprinting enemy in earshot is a sound ring, not a position. Hijacker (Engineer Pro):
  // enemy equipment as small hollow diamonds.
  #drawProMini(view, me, sx, sz, g, clock) {
    const pro = me.pro ?? NO_PRO;
    if (pro.includes('deadsilence') && me.alive) {
      const heard = heardEnemies(view, me, this.heard);
      g.lineWidth = 1.6;
      for (const p of heard) {
        const k = (clock * 1.6 + p.x * 0.07) % 1;
        g.strokeStyle = TEAMS[p.team].css;
        g.globalAlpha = 0.9 * (1 - k);
        g.beginPath();
        g.arc(p.x * sx, p.z * sz, 3 + k * 9, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      if (heard.length) {
        // The edge of earshot, faintly, so the player learns what the ring means.
        g.strokeStyle = 'rgba(231,234,228,.18)';
        g.setLineDash([3, 4]);
        g.beginPath();
        g.arc(me.x * sx, me.z * sz, HEAR_RANGE * sx, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    }
    if (pro.includes('engineer') && view.projectiles?.length) {
      for (const q of view.projectiles) {
        if (!SEEN_GEAR.has(q.kind) || !q.stuck) continue;
        const owner = view.players.find(o => o.id === q.owner);
        if (!owner || owner.team === me.team) continue;
        const x = q.x * sx, y = q.z * sz;
        g.strokeStyle = TEAMS[owner.team].css;
        g.lineWidth = 1.8;
        g.beginPath();
        g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y);
        g.closePath();
        g.stroke();
      }
    }
  }

  // Built on first use per map size; afterwards a jammed frame is a single drawImage.
  #staticFrames() {
    const W = this.mmCanvas.width, H = this.mmCanvas.height;
    if (this.staticSet?.w === W && this.staticSet.h === H) return this.staticSet.frames;
    const frames = [];
    for (let f = 0; f < STATIC_FRAMES; f++) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.globalAlpha = 0.55;
      g.drawImage(this.mmBase, 0, 0);
      g.globalAlpha = 1;
      const img = g.getImageData(0, 0, W, H), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.random() < 0.5) continue;
        const v = 60 + Math.random() * 170;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      g.putImageData(img, 0, 0);
      g.fillStyle = 'rgba(29,35,43,.35)';
      for (let y = f; y < H; y += 6) g.fillRect(0, y, W, 2);
      frames.push(c);
    }
    this.staticSet = { w: W, h: H, frames };
    return frames;
  }

  #drawSelf(g, me, sx, sz) {
    if (me.alive) {
      const x = me.x * sx, y = me.z * sz, a = me.aim;
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
      g.lineTo(x + Math.cos(a + 2.5) * 7, y + Math.sin(a + 2.5) * 7);
      g.lineTo(x + Math.cos(a - 2.5) * 7, y + Math.sin(a - 2.5) * 7);
      g.closePath();
      g.fill();
    }
  }

  #drawObjectivesMini(view, me, sx, sz, g, clock) {
    if (view.tags?.length) {
      for (const t of view.tags) {
        const friendly = t.team === me.team;
        const x = t.x * sx, y = t.z * sz, r = friendly ? 3 : 4;
        g.fillStyle = TEAMS[t.team]?.css ?? '#fff';
        g.strokeStyle = friendly ? 'rgba(255,255,255,.5)' : '#fff';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    const points = view.points;
    if (!points?.length) return;
    const myTeam = me.team, hard = this.mode === 'hard';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '400 13px "Railyard Stencil", sans-serif';
    points.forEach((pt, i) => {
      const x = pt.x * sx, y = pt.z * sz, r = Math.max(5, (pt.r ?? 4) * sx);
      const css = pt.owner === myTeam ? TEAMS[myTeam].css : pt.owner === 0 || pt.owner === 1 ? TEAMS[pt.owner].css : '#d5dade';
      g.fillStyle = 'rgba(29,35,43,.72)';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = pt.contested ? (Math.floor(clock * 6) % 2 ? '#ffd24a' : '#fff') : css;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
      const cap = Math.abs(pt.capture ?? 0);
      if (cap > 0.01) {
        g.strokeStyle = TEAMS[(pt.capture ?? 0) > 0 ? 1 : 0].css;
        g.lineWidth = 3.5;
        g.beginPath();
        g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + cap * Math.PI * 2);
        g.stroke();
      }
      if (hard) {
        // Pulse so the single live zone is findable at a glance.
        g.strokeStyle = 'rgba(255,255,255,.65)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, r + (clock * 1.4 % 1) * 8, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#fff';
      g.fillText(hard ? 'H' : pointLabel(pt, i), x, y + 0.5);
    });
  }

  // --- Mode objectives ---
  #buildObjectiveHud() {
    this.objChips.textContent = '';
    this.objMarks.textContent = '';
    this.objNodes = [];
    const mode = this.mode;
    const uses = mode === 'dom' || mode === 'hard';
    this.objStrip.hidden = !uses;
    this.objTimer.hidden = mode !== 'hard' || this.modeHud.on;     // Headquarters keeps its clock on its own plate.
    this.el.dataset.mode = mode;
    this.objMeter.hidden = true;
    for (const side of this.boardSides) {
      side.modeHead.textContent = this.modeHud.on ? this.modeHud.head() : mode === 'kc' ? 'Conf' : uses ? 'Cap' : mode === 'snd' ? 'P/D' : mode === 'ctf' ? 'C/R/K' : 'HS';
    }
    if (!uses) return;
    // Control's zones and Grind's banks are two; Domination has the map's flags.
    const count = this.modeHud.on && mode === 'dom' ? 2 : mode === 'dom' ? (this.map.points?.dom?.length ?? 3) : 1;
    for (let i = 0; i < count; i++) {
      const chip = document.createElement('span');
      chip.className = 'o-chip';
      chip.innerHTML = ringMarkup;
      this.objChips.appendChild(chip);
      const mark = document.createElement('span');
      mark.className = 'o-mark';
      mark.innerHTML = `${ringMarkup}<i class="o-arrow"></i>`;
      this.objMarks.appendChild(mark);
      this.objNodes.push({
        chip: this.#pointNode(chip),
        mark: { ...this.#pointNode(mark), arrow: mark.querySelector('.o-arrow'), x: NaN, y: NaN, a: NaN, off: null, shown: null },
      });
    }
  }

  #pointNode(root) {
    return { root, arc: root.querySelector('.o-arc'), label: root.querySelector('b'), owner: '', cap: '', dash: NaN, contested: null, text: null };
  }

  #updateObjectives(view, me, c) {
    const points = view.points;
    if (this.objNodes.length && points) {
      this.#updateMarks(view, me, points);
      const n = Math.min(points.length, this.objNodes.length);
      for (let i = 0; i < n; i++) this.#paintPoint(this.objNodes[i].chip, points[i], i, me.team);
    }
    this.#updateMeter(view, me, c, points);
    this.#updateHardTimer(view, c);
  }

  // Touches only the attributes that changed, since this runs for every chip and marker every frame.
  #paintPoint(n, pt, i, myTeam) {
    const owner = pt.owner === 0 || pt.owner === 1 ? (pt.owner === myTeam ? 'mine' : 'enemy') : 'none';
    if (owner !== n.owner) { n.owner = owner; n.root.dataset.owner = owner; }
    const capVal = pt.capture ?? 0;
    const capSide = capVal === 0 ? '' : ((capVal > 0 ? 1 : 0) === myTeam ? 'mine' : 'enemy');
    if (capSide !== n.cap) { n.cap = capSide; n.root.dataset.cap = capSide; }
    const dash = Math.round((1 - Math.min(1, Math.abs(capVal))) * 40) / 40;
    if (dash !== n.dash) { n.dash = dash; n.arc.style.strokeDashoffset = (dash * OBJ_RING).toFixed(2); }
    const contested = !!pt.contested;
    if (contested !== n.contested) { n.contested = contested; n.root.classList.toggle('contested', contested); }
    const text = this.mode === 'hard' ? '' : pointLabel(pt, i);
    if (text !== n.text) { n.text = text; n.label.textContent = text; }
  }

  // World-to-screen for the pinned objective markers; off-screen ones ride the edge and point at their target.
  #updateMarks(view, me, points) {
    const cam = this.camera;
    if (!cam) return;
    const W = this.viewW, H = this.viewH;
    const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
    const y = MARK_Y[this.mode] ?? 3;
    const n = Math.min(points.length, this.objNodes.length);
    for (let i = 0; i < n; i++) {
      const pt = points[i], m = this.objNodes[i].mark;
      this.#paintPoint(m, pt, i, me.team);
      // Standing on it, the ring around your feet says everything a marker would.
      const near = me.alive && Math.hypot(pt.x - me.x, pt.z - me.z) <= (pt.r ?? 4);
      if (near !== m.shown) { m.shown = near; m.root.style.opacity = near ? '0' : '1'; }
      if (near) continue;
      const vx = v[0] * pt.x + v[4] * y + v[8] * pt.z + v[12], vy = v[1] * pt.x + v[5] * y + v[9] * pt.z + v[13], vz = v[2] * pt.x + v[6] * y + v[10] * pt.z + v[14];
      const w = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
      if (w <= 0.01) continue;
      const nx = (p[0] * vx + p[8] * vz + p[12]) / w, ny = (p[5] * vy + p[9] * vz + p[13]) / w;
      const sx = (nx * 0.5 + 0.5) * W, sy = (0.5 - ny * 0.5) * H;
      const dx = sx - W / 2, dy = sy - H / 2;
      const s = this.safe;
      const minX = (s?.left ?? 0) + MARK_PAD_X, maxX = W - (s?.right ?? 0) - MARK_PAD_X;
      const minY = (s?.top ?? 0) + MARK_PAD_T, maxY = H - (s?.bottom ?? 0) - MARK_PAD_B;
      let off = sx < minX || sx > maxX || sy < minY || sy > maxY;
      let edge = 1;
      if (off) {
        const kx = dx > 0 ? (maxX - W / 2) / dx : dx < 0 ? (minX - W / 2) / dx : Infinity;
        const ky = dy > 0 ? (maxY - H / 2) / dy : dy < 0 ? (minY - H / 2) / dy : Infinity;
        edge = Math.min(kx, ky);
      }
      // Walk toward the centre along the same line until clear of the buttons, the minimap and the corner chips,
      // so the marker still points the right way.
      for (let step = 0; step < 18 && edge > 0.1 && this.#markBlocked(W / 2 + dx * edge, H / 2 + dy * edge); step++) {
        edge -= MARK_WALK;
        off = true;
      }
      const px = Math.round(W / 2 + dx * edge), py = Math.round(H / 2 + dy * edge);
      if (px !== m.x || py !== m.y) {
        m.x = px; m.y = py;
        m.root.style.transform = `translate3d(${px}px,${py}px,0)`;
      }
      if (off !== m.off) { m.off = off; m.root.classList.toggle('off', off); }
      if (off) {
        const a = Math.round(Math.atan2(dy, dx) * 12) / 12;
        if (a !== m.a) { m.a = a; m.arrow.style.transform = `rotate(${a}rad) translateX(23px)`; }
      }
    }
  }

  // The bar under the chips: what is happening on the point the local player is standing on.
  #updateMeter(view, me, c, points) {
    let state = '', frac = 0, side = '';
    if (points && me.alive && !this.snd) {
      const hard = this.mode === 'hard';
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (Math.hypot(pt.x - me.x, pt.z - me.z) > (pt.r ?? 4)) continue;
        const label = hard ? 'Zone' : pointLabel(pt, i);
        const capVal = pt.capture ?? 0;
        const mine = (capVal > 0 ? 1 : 0) === me.team;
        if (pt.contested) { state = hard ? 'Contested' : `${label} Contested`; side = 'contest'; frac = Math.abs(capVal) || 1; }
        else if (hard) { state = pt.owner === me.team ? 'Holding Zone' : 'Taking Zone'; side = 'mine'; frac = Math.abs(capVal) || (pt.owner === me.team ? 1 : 0); }
        else if (Math.abs(capVal) > 0.005) { state = mine ? `Capturing ${label}` : `Losing ${label}`; side = mine ? 'mine' : 'enemy'; frac = Math.abs(capVal); }
        else if (pt.owner !== me.team) { state = `Capturing ${label}`; side = 'mine'; frac = 0; }
        const own = this.modeHud.meter(view, me, pt);
        if (own) [state, frac, side] = own;
        break;
      }
    }
    if (state !== c.objState) {
      c.objState = state;
      this.objMeter.hidden = !state;
      this.objMeterText.textContent = state;
      this.objMeter.dataset.side = side;
    }
    const shown = Math.round(frac * 40) / 40;
    if (shown !== c.objFrac) {
      c.objFrac = shown;
      this.objMeterFill.style.transform = `scaleX(${shown})`;
    }
  }

  #updateHardTimer(view, c) {
    if (this.mode !== 'hard' || this.modeHud.on) return;
    const shown = Math.max(0, Math.ceil(view.hardT ?? 0));
    if (shown !== c.hardShown) {
      c.hardShown = shown;
      this.objTimerNum.textContent = `${Math.floor(shown / 60)}:${pad2(shown % 60)}`;
      const warn = shown <= HARD_WARN;
      this.objTimer.classList.toggle('warn', warn);
      if (warn && shown > 0 && !this.hardWarned && view.phase === 'live') {
        this.hardWarned = true;
        this.#banner('Hardpoint Moving', `${shown} seconds`, 1400);
      }
      if (!warn) this.hardWarned = false;
    }
  }

  #drawDeployables(view, myTeam, sx, sz, g) {
    if (view.turrets) {
      for (const t of view.turrets) {
        const x = t.x * sx, y = t.z * sz;
        g.fillStyle = TEAMS[t.team].css;
        g.fillRect(x - 5, y - 5, 10, 10);
        g.strokeStyle = t.team === myTeam ? '#fff' : '#171c22';
        g.lineWidth = 2;
        g.strokeRect(x - 5, y - 5, 10, 10);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(t.aim) * 11, y + Math.sin(t.aim) * 11);
        g.stroke();
      }
    }
    if (view.gunships) {
      for (const s of view.gunships) {
        const x = s.x * sx, y = s.z * sz, ca = Math.cos(s.aim), sa = Math.sin(s.aim);
        const px = -sa, py = ca;       // Wing direction.
        g.fillStyle = TEAMS[s.team].css;
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x + ca * 12, y + sa * 12);
        g.lineTo(x + px * 11 - ca * 3, y + py * 11 - sa * 3);
        g.lineTo(x - ca * 7, y - sa * 7);
        g.lineTo(x - px * 11 - ca * 3, y - py * 11 - sa * 3);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    // V9: Rovers (a sentry square that moves), Domes (their bubble), Airdrop crates, and the small drones.
    if (view.deploys) {
      for (const t of view.deploys) {
        const x = t.x * sx, y = t.z * sz;
        g.fillStyle = TEAMS[t.team].css;
        g.strokeStyle = t.team === myTeam ? '#fff' : '#171c22';
        g.lineWidth = 2;
        if (t.kind === 'dome') {
          g.globalAlpha = 0.28;
          g.beginPath(); g.arc(x, y, 6 * sx, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
          g.beginPath(); g.arc(x, y, 6 * sx, 0, Math.PI * 2); g.stroke();
        } else if (t.kind === 'crate') {
          g.fillRect(x - 4, y - 4, 8, 8); g.strokeRect(x - 4, y - 4, 8, 8);
        } else {
          g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(t.aim) * 10, y + Math.sin(t.aim) * 10); g.stroke();
        }
      }
    }
    if (view.drones) {
      for (const d of view.drones) {
        if (d.kind === 'reticle' && d.team !== myTeam) continue;
        const x = d.x * sx, y = d.z * sz;
        g.strokeStyle = d.kind === 'reticle' ? '#ff4a3a' : '#fff';
        g.fillStyle = TEAMS[d.team].css;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, d.kind === 'reticle' ? 5 : 4, 0, Math.PI * 2);
        if (d.kind !== 'reticle') g.fill();
        g.stroke();
      }
    }
  }
}

// The firing range's live numbers, read from the sim's own tracker (view.range).
class RangeReadout {
  constructor(root) {
    this.panel = root.querySelector('.range-panel');
    this.leave = root.querySelector('.range-leave');
    this.nodes = Object.fromEntries(['dps', 'peak', 'ttk', 'best', 'acc', 'last', 'model'].map(k => [k, root.querySelector(`.rp-${k}`)]));
    root.querySelector('.rp-reset').addEventListener('click', () => this.onReset?.());
    this.armory = new ArmorySheet(root, loadout => this.onArmory?.(loadout));
    root.querySelector('.rp-armory').addEventListener('click', () => (this.armory.isOpen ? this.armory.close() : this.armory.open(Progress.loadout())));
    this.clock = 0;
    this.active = false;
  }

  prepare(active, { training = false } = {}) {
    this.active = active;
    this.panel.hidden = !active;
    this.leave.hidden = !active;
    this.armory.close();
    this.panel.querySelector('.rp-head').textContent = training ? 'Training' : 'Firing Range';
    this.leave.textContent = training ? 'Leave training' : 'Leave range';
    this.clock = Infinity;           // First frame paints at once.
  }

  update(r, dt) {
    if (!this.active || !r) return;
    this.clock += dt;
    if (this.clock < 1 / RANGE_HZ) return;
    this.clock = 0;
    const n = this.nodes;
    const set = (el, text) => { if (el.textContent !== text) el.textContent = text; };
    const secs = t => (t === null || t === undefined ? '--' : `${t.toFixed(2)}s`);
    set(n.dps, String(Math.round(r.dps)));
    set(n.peak, String(Math.round(r.peakDps)));
    set(n.ttk, secs(r.lastTtk));
    set(n.best, secs(r.bestTtk));
    set(n.acc, r.shots ? `${Math.round(r.accuracy * 100)}%` : '--');
    set(n.last, r.lastDamage ? `${Math.round(r.lastDamage)}${r.lastHead ? ' HS' : ''} @ ${Math.round(r.lastDist)}m` : '--');
    set(n.model, r.model ? `${Math.round(r.model.dps)} DPS / ${r.model.ttk.toFixed(2)}s on paper` : '');
  }
}

// A loadout's primary on one line: its name (clipped if it must be) and its level and prestige, which never clip.
const gunLine = id => `<span class="pk-gun">${esc(weaponName(id))}</span>${weaponLevelHtml(Progress.weaponLevel(id), Progress.weaponPrestige(id))}`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
