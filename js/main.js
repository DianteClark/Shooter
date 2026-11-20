// App flow: title, lobby, gunsmith, match, results. Owns the session (Net) and the match lifecycle.
// First: the progress reset's wipe (docs/RESET.md) runs before any module below reads the save or the stats.
import { WIPE } from './ui/wipe.js';
import { Match } from './game/match.js';
import { GameRenderer } from './render/renderer.js';
import { AudioEngine } from './audio/audio.js';
import { music } from './audio/music.js';
import { buildRoster } from './sim/sim.js';
import { RANGE_MODE, rangeDummies } from './sim/range.js';
import { MAPS, DEFAULT_MAP } from './shared/map.js';
import { MODES, firstModeFor, isBr, isEx, isFfa, isZm, isCp, playersFor } from './shared/modes.js';
import { MISSIONS, CP, cpCode, cpDecode, missionOpen, campaignCleared } from './shared/campaign.js';     // The co-op campaign (docs/CAMPAIGN.md).
import { ZM_SQUAD } from './shared/zombies.js';     // Graveyard Shift seats four (docs/ZOMBIES.md).
const BR_HUMANS = 8;           // Battle royale: up to eight people in a room, bots fill the rest of the 32 (docs/BR.md).
import { normalizeLoadout } from './shared/catalog.js';
import { TEAM_SIZE } from './shared/constants.js';
import { MAX_LEVEL, MAX_PRESTIGE, MASTER_MAX } from './shared/progression.js';
import { Controls } from './ui/controls.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Progress, matchScore, MatchHistory, Friends, Clan } from './ui/progress.js';
import { taggedName, tagOk } from './shared/clans.js';     // Player clans: "[TAG] Name" on the roster.
import { cleanCard, poolSr } from './shared/boards.js';
import { boardsScreen } from './ui/boards.js';
import { humanRating } from './shared/botpool.js';
import { voteOptions, tallyWinner, modeFits, resolvePick, RANDOM } from './ui/vote.js';
import { brMode, cleanSquad as cleanBrSquad } from './ui/br-squad.js';
import { cleanOperator, botOperator } from './ui/operators.js';
import { Net, joinDiagnosis } from './net/net.js';
import { LocalNet } from './net/local.js';
import { Voice } from './net/voice.js';
import { playerId } from './net/star.js';
import { LobbyAnnouncer, LobbyBrowser, cleanSquad } from './net/lobbies.js';
import { browseScreen } from './ui/browse.js';
import { takeInvite, wireInvite, joinFromInvite, inviteJoinFailed, inviteSettled, refusal, refusalKind, showJoinProblem } from './ui/invite.js';
import { installTaps, setTapSound } from './ui/tap.js';
import { installScrolling, scrollerOf, canScroll } from './ui/scroll.js';
import { Options } from './ui/options.js';
import { applyPalette } from './shared/palette.js';     // Colour modes (docs/ACCESSIBILITY.md).
import { setCalm } from './render/feel.js';
import { setReducedMotion } from './ui/motion.js';
import { scaleOf } from './ui/layout.js';
import { installViewport, onViewport } from './ui/viewport.js';
import { wakeLock } from './ui/wakelock.js';
import { installed as runningInstalled, platformKey, requestPersist, browserName } from './ui/platform.js';     // Phones (docs/DEVICES.md).
import { installAndroid } from './ui/android.js';
import { installSheet } from './ui/installguide.js';
import { PerfOverlay } from './ui/perf.js';
import { TouchDebug } from './ui/touchdebug.js';
import { TouchRecorder, ReportSheet } from './ui/touchrec.js';
import { statsScreen } from './ui/stats.js';
import { installFrameClock } from './render/quality.js';
import { Tutorial, tutorialRoster, TUTORIAL_MAP, TUTORIAL_MODE, TUTORIAL_LIMITS } from './game/tutorial.js';
import { challengeUnlock } from './ui/challenges.js';
import { ico } from './ui/yard.js';
import { BotMatch, botMatchSheet } from './ui/botsettings.js';
import { modsSheet, soloMods } from './ui/modifiers.js';     // Modes overhaul: modifiers and the featured playlist.
import { cleanMods, withHardcore } from './shared/playlist.js';
// Seasons and ranked (docs/SEASONS.md).
import { seasonUnlocks } from './ui/season.js';
// Weekend tournaments (docs/TOURNAMENTS.md).
import { tourneyUnlocks, tourneySpot } from './ui/tourney.js';
import { matchSides, roundTitle } from './shared/tournaments.js';
import { tourneyAt } from './shared/tourney-items.js';
import { rankedTarget, RANKED_SPREAD, RANKED_RULES, RANKED_PARTY, ratingToSr, codeSr, cleanCode, rankedBots } from './shared/ranked.js';
import { TITLE_IDS } from './shared/seasons.js';     // Ranked titles on badges (docs/RANKED.md).
import { QuickChat } from './ui/quickchat.js';
import { GamepadInput } from './ui/gamepad.js';     // Controllers (docs/CONTROLLER.md).
import { ReplayPlayer } from './game/replay-player.js';
import { VIDEOS, VIDEO_BY_ID } from './shared/help-videos.js';
import { ModeTips } from './ui/modetips.js';
import { watchLabels } from './ui/aria.js';
import { SpectatorMatch } from './game/spectator.js';      // A friend room's spectator seat (docs/RANKED.md).      // Watch replay and saved clips (docs/REPLAYS.md).
import { saveClip, loadClip, deleteClip, listClips } from './ui/clips.js';
import { VoiceUI } from './ui/voice-ui.js';            // Speaking marks, mutes, push to talk.
// Multiplayer and Custom (docs/ROADMAP.md item 14): playlists, the pre-match vote, the bot seam, Training.
import { MP_TAB_IDS, playlistsFor, defaultSelection, resolveSelection, mpVoteOptions, lobbySize, pickBotsForMatch, MP_BOT_SKILL } from './ui/matchmaking.js';
import { loadTraining, saveTraining, TRAIN_MAX_BOTS } from './ui/playscreens.js';
import { MenuBackdrop } from './ui/backdrop.js';
import { Recall } from './ui/recall.js';     // Remembered menu choices (QoL).
import { NewDots } from './ui/newdots.js';    // QoL: dots on unlocks not yet seen.
import { Updater, BUILD } from './ui/updater.js';
import { maybeShowWhatsNew } from './ui/whatsnew.js';
import { maybeEventBanner } from './ui/eventbanner.js';
import { maybeResetNotice } from './ui/resetnotice.js';     // The progress reset's one-time notice (docs/RESET.md).
import { weeklyEventAt } from './shared/events.js';     // Weekly events: the banner on the week's first visit.
import { unlockSheet, setPlayNow } from './ui/unlocksheet.js';

const GAME_NAME = 'Switchyard';
const DRAG_SLOP = 12;           // Pixels of travel before a touch stops being a possible tap.
const NET_POLL_MS = 1000;
const REMATCH_SECONDS = 15;
const VOTE_REVEAL_MS = 1700;
const RESULTS_MIN_MS = 6000;     // A guest's results stay up at least this long before a vote the host started takes over.
const REJOIN_MINUTES = 15;       // How long after dropping the title screen still offers the way back.
const EDIT_SCREENS = ['tourney', 'clan', 'gunsmith', 'loadouts', 'operators', 'profile', 'save', 'keypad', 'options', 'help', 'stats', 'challenges', 'history'];   // A lobby update must not pull a guest out of these.
const LAST_ROOM = 'switchyard-last-room';
const invite = takeInvite();     // Reads and strips ?join=CODE before anything else looks at the URL.
const params = new URLSearchParams(location.search);
const NetImpl = params.get('net') === 'local' ? LocalNet : Net;
// The id this device plays under, as the session will report it: Browse hides our own room and spots our held slot by it.
const selfId = () => playerId(NetImpl === LocalNet ? sessionStorage : localStorage);
// Test hooks: ?limit=N lowers the score limit, ?time=S the time limit, ?vote=N shortens the vote, and ?map=&mode= skip
// the solo picker (either may be 'random').
const LIMIT_OVERRIDE = Number(params.get('limit')) || 0;
const TIME_OVERRIDE = Number(params.get('time')) || 0;
const VOTE_SECONDS = Number(params.get('vote')) || 10;
const MP_VOTE_SECONDS = Number(params.get('vote')) || 8;     // Multiplayer's pre-match vote.
const SEARCH_MS = Number(params.get('search')) || 1800;     // Multiplayer's matchmaking moment.

const limitsFor = mode => {
  const m = mode === 'range' ? RANGE_MODE : MODES[mode];
  return { scoreLimit: LIMIT_OVERRIDE || m.scoreLimit, timeLimit: TIME_OVERRIDE || m.timeLimit };
};

document.title = GAME_NAME;

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
// First-time mode tips (docs/TUTORIAL.md). Test pages (?debug=1) keep them off unless they ask with &tips=1, so a
// fresh profile's first match in every other test looks as it always did.
const modeTips = new ModeTips(uiRoot);
const controls = new Controls(uiRoot);
const hud = new HUD(uiRoot);
hud.bindControls(controls);
const menu = new Menu(uiRoot);
// Screen-reader names on every menu control (js/ui/aria.js): the menu and overlay layers only, never the HUD.
watchLabels(menu.el, menu.overlayEl);
// "Update ready" on the title screen when the site has a newer build than this (often stale Home Screen) copy.
const updater = new Updater({ canShow: () => !app.inMatch && menu.el.dataset.screen === 'title' });
new MutationObserver(() => updater.paint()).observe(menu.el, { attributes: true, attributeFilter: ['data-screen'] });
wireInvite(menu, () => app.code);
const audio = new AudioEngine();
const quickChat = new QuickChat(hud, { audio });
const backdrop = new MenuBackdrop(canvas);
// Created at the end of this file's setup, once app exists; see wireExtras.
let gamepad = null, voiceUi = null;
let replayView = null;             // The replay player while one is open (openReplay).

// Screens with a turntable of their own run a second WebGL context, so the yard holds still behind them; the rest
// keep it moving. Nothing of the backdrop exists while a match owns the canvas.
const STILL_SCREENS = new Set(['loadouts', 'gunsmith', 'operators', 'results']);
const DOT_SCREENS = new Set(['title', 'loadouts', 'gunsmith', 'operators', 'profile']);
menu.onScreen = screen => {
  uiRoot.dataset.menu = screen;
  if (DOT_SCREENS.has(screen)) NewDots.refresh();     // Unlocks can land between visits (a prestige, a season claim).
  music.screen(screen, app.inMatch);
  if (app.inMatch || replayView) return;       // A replay playing over the menus owns the canvas until it closes.
  if (screen === 'results') return;            // The match renderer has only just let go; the next screen builds it.
  if (STILL_SCREENS.has(screen)) backdrop.still();
  else {
    backdrop.setLoadout(myLoadout());
    backdrop.live();
  }
};
backdrop.onReady = ready => uiRoot.classList.toggle('yard-live', ready);

const app = {
  net: null,
  voice: null,
  code: '',
  isHost: false,
  match: null,
  renderer: null,
  netPoll: 0,
  lobby: { humans: [], botSkill: 'mixed' },
  inMatch: false,
  dead: new Set(),          // Peers dropped during the current match; the same player id gets its slot back.
  public: false,            // The room is listed in Browse games (js/net/lobbies.js). Guests track it for a promotion.
  announcer: null,          // Host of a public room: the LobbyAnnouncer.
  browser: null,            // The Browse games screen's LobbyBrowser while it is open.
  matchInfo: null,          // The current match's start message, so a returning player can be sent it again.
  rematch: null,            // Host only: { left, timer } while the auto-start countdown runs.
  countdown: null,          // Seconds left in the rematch countdown as last announced; null when none.
  rematchWait: false,       // Guest pressed Rematch and is waiting for the host to do the same.
  vote: null,               // { key, options, votes (host) or counts (guest), left, winner, resolved, mine }
  resultsAt: 0,             // When the results screen last appeared.
  voteTakeover: 0,          // Guest: timer that moves results on to a vote that opened while they were showing.
  soloPick: recalledSoloPick(),         // Custom's map and mode, as last picked on this phone.
  // The map and mode the last match was played on, as rolled. Rematch replays the halves that were chosen, and the
  // room's next vote offers it as a Rematch card unless the winning card was Random.
  lastPlayed: null,
  // The pick as chosen, before rolling. A Random half stays Random on Rematch, so each rematch rolls again.
  // Multiplayer: { mp: {tab, sel} }, so the next match searches the same playlist; Training: { training: true }.
  lastPick: null,
  mp: Recall.mp(MP_TAB_IDS),           // Multiplayer: the open tab and each tab's pick ({playlist, modes}), as last left.
  mpSearch: null,                      // The matchmaking moment's timers.
  customTab: 'match',                  // Custom: 'match' or 'training'.
  customFrom: null,                    // 'lobby' while a host edits the friend lobby's custom settings.
  training: loadTraining(),            // Custom > Training's settings (js/ui/playscreens.js).
  cp: null,                            // The Campaign tab's pick {k, diff} (cpPickNow), as last left.
};
// Custom's last pick, if its map still exists and still hosts its mode; else the default.
function recalledSoloPick() {
  const p = Recall.get('soloPick');
  const mapOk = p?.mapId === RANDOM || !!MAPS[p?.mapId];
  const modeOk = p?.mode === RANDOM || (!!MODES[p?.mode] && (p.mapId === RANDOM || modeFits(MAPS[p.mapId], p.mode)));
  return mapOk && modeOk ? { mapId: p.mapId, mode: p.mode } : { mapId: DEFAULT_MAP, mode: 'tdm' };
}
const RESULTS_FALLBACK_MS = 2500;  // Results come up by this long after a match ends even if the end banner failed.

// The canvas size, the HUD's numbers and the touch rectangles are all derived from the visible area.
function followViewport() {
  installViewport();
  onViewport(() => {
    app.renderer?.resize();
    backdrop.resize();
    controls.remeasure();
    hud.remeasure();
  });
}

function blockIosGestures() {
  const stop = e => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  // A real drag must never rubber-band Safari's page. A touch only counts as a drag past the tap slop:
  // default-preventing the small moves inside a tap is exactly what makes iOS drop the click.
  // Two exceptions scroll natively: the save code boxes (they also take selection and paste), and any touch that began
  // in a list (scroll.js) with something to scroll. Those lists contain their own overscroll, so the page stays put.
  const startAt = new Map();
  document.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      const list = scrollerOf(t.target);
      startAt.set(t.identifier, [t.clientX, t.clientY, canScroll(list)]);
    }
  }, { passive: true, capture: true });
  const forget = e => { for (const t of e.changedTouches) startAt.delete(t.identifier); };
  document.addEventListener('touchend', forget, { passive: true, capture: true });
  document.addEventListener('touchcancel', forget, { passive: true, capture: true });
  document.addEventListener('touchmove', e => {
    if (e.target.tagName === 'TEXTAREA' || !e.cancelable) return;
    for (const t of e.changedTouches) {
      const at = startAt.get(t.identifier);
      if (at?.[2]) continue;
      if (at && Math.hypot(t.clientX - at[0], t.clientY - at[1]) > DRAG_SLOP) { e.preventDefault(); return; }
    }
  }, { passive: false });
  // Safari still offers text selection on long-press through some layered elements.
  const unlessField = e => { if (e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') e.preventDefault(); };     // INPUT: the settings search.
  document.addEventListener('selectstart', unlessField);
  document.addEventListener('contextmenu', unlessField);

  // Audio must start from a user gesture, and iOS can suspend it again after backgrounding.
  const unlock = () => audio.unlock();
  document.addEventListener('touchend', e => { if (!e.touches?.length) unlock(); }, { passive: true });     // Not with a thumb still down (wakelock.js).
  document.addEventListener('click', unlock, { passive: true });
}

function myName() {
  return Progress.name || 'Rookie';
}
// The name this player plays under: "[TAG] Name" in a clan (js/shared/clans.js), like a pool bot in one.
function myTagName() {
  return taggedName(myName(), Clan.tag());
}
// A guest's name as the host seats it: their callsign (12 at most) behind their clan tag, if it is a good one.
function guestName(msg) {
  const name = String(msg.name ?? '').slice(0, 12) || 'Player';
  return typeof msg.clan === 'string' && tagOk(msg.clan) ? taggedName(name, msg.clan) : name;
}

function myLoadout() {
  return Progress.loadout();
}

// What every human carries in the lobby and into the roster.
function seatData() {
  const loadout = myLoadout();
  return { primary: loadout.primary, camo: loadout.camo, loadout, badge: { ...Progress.badge(), rk: Progress.rankCode(), ...(Progress.title() ? { tl: Progress.title().id } : {}) } };
}

function goTitle(message) {
  if (app.match?.headless) endLocalMatch();      // A host who left a battle royale early: the room's match goes with them.
  wakeLock.set(false);
  teardownNet();
  stopRematch();
  stopVote();
  app.countdown = null;
  app.rematchWait = false;
  app.lobby = { humans: [], botSkill: 'mixed' };
  app.lastPlayed = null;
  app.lastPick = null;
  app.customFrom = null;
  stopSearch();
  hud.setVisible(false);
  menu.overlay('');
  showTitle();
  if (message) menu.toast(message);
}

// A match this device left without finishing, recent enough that its room may still be alive.
function rejoinOffer() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_ROOM) || 'null');
    if (saved?.code && Date.now() - saved.at < REJOIN_MINUTES * 60000) return { code: saved.code };
  } catch { /* unreadable offer: nothing to show */ }
  return null;
}

function rememberRoom(code) {
  try { localStorage.setItem(LAST_ROOM, JSON.stringify({ code, at: Date.now() })); } catch { /* optional convenience */ }
}

function forgetRoom() {
  try { localStorage.removeItem(LAST_ROOM); } catch { /* optional convenience */ }
}

function showTitle(opts = {}) {
  menu.title({ ...opts, rejoin: rejoinOffer() });
}

function teardownNet() {
  stopAnnouncing();
  closeBrowse();
  app.public = false;
  clearInterval(app.netPoll);
  app.voice?.dispose();
  app.voice = null;
  const net = app.net;
  app.net = null;
  app.careers = null;
  net?.leave();
}

// --- Career cards for the leaderboards (js/shared/boards.js) ---
// Every phone in a lobby sends its career summary (Progress.careerCard: totals, name, level, operator, card, emblem;
// nothing else from the save) when it joins and after each match. Guests send theirs to the host, which keeps one per
// player and relays them all; each phone stores the others' as friends (Friends.see), dated now.
function shareCareer() {
  if (!app.net) return;
  let card;
  try { card = Progress.careerCard(); } catch (err) { console.error('career card', err); return; }
  if (app.isHost) {
    (app.careers ??= new Map()).set(app.net.localId, card);
    broadcastCareers();
  } else app.net.sendLobby({ t: 'career', c: card });
}

function broadcastCareers() {
  if (!app.isHost || !app.net || !app.careers?.size) return;
  app.net.sendLobby({ t: 'careers', list: [...app.careers].map(([id, c]) => ({ id, c })) });
}

function storeCareer(id, raw) {
  const card = cleanCard(raw);
  if (!card || !app.net || id === app.net.localId) return null;
  Friends.see(id, card, Date.now(), app.net.localId);
  if (Clan.sawCard(card)) menu.toast(`Your clan is now [${Clan.tag()}] ${Clan.get().name}`);
  return card;
}

// --- Title actions ---
menu.on({
  profile: () => openProfile(),
  saveCode: () => openSave(),
  options: () => openOptions(),
  stats: () => openStats(),
  boards: () => openBoards(),
  season: () => openSeason(),
  lobbyRanked: () => setLobbyRanked(!app.lobby.ranked),
  lobbyTourney: () => openPartyTourney(),
  help: () => openHelp(),
  challenges: () => openChallenges(),
  history: () => openHistory(),
  rejoin: () => { needName(() => startJoining(rejoinOffer()?.code ?? '')); },
  range: () => { needName(startRange); },
  multiplayer: () => { needName(openMultiplayer); },
  custom: () => { startSolo(); },
  solo: () => { startSolo(); },
  quickPlay: () => { needName(quickPlay); },
  featured: () => { needName(playFeatured); },
  // The weekly event's banner on the title: Multiplayer on the event's playlist.
  eventBanner: () => { if (shortcutOk()) playShortcut({ tab: 'standard', sel: { playlist: 'wkevent', modes: [] }, name: weeklyEventAt().name }); },
  // Multiplayer (js/ui/playscreens.js): a playlist, or one or more ticked modes, then Find match.
  mpBack: () => showTitle(),
  mpTab: ({ tab }) => { if (MP_TAB_IDS.includes(tab)) { app.mp.tab = tab; renderMp(); } },
  mpPlaylist: ({ id }) => { const sel = mpSel(); sel.playlist = id; sel.modes = []; renderMp(); },
  mpMode: ({ id }) => {
    const sel = mpSel();
    if (sel.playlist) { sel.playlist = null; sel.modes = []; }
    sel.modes = sel.modes.includes(id) ? sel.modes.filter(m => m !== id) : [...sel.modes, id];
    renderMp();
  },
  mpFind: () => findMatch(app.mp.tab, mpSel()),
  mpTourney: () => needName(openTourney),
  // The co-op campaign (js/ui/campaign.js): a mission on the map, its difficulty, the briefing, then solo or a room.
  cpPick: ({ k }) => { const n = Number(k); if (MISSIONS[n]) { if (!missionOpen(Progress.campaign(), n)) menu.toast(`Clear ${MISSIONS[n - 1]?.name ?? 'the mission before'} first`); setCpPick({ k: n }); } },
  cpDiff: ({ d }) => setCpPick({ diff: Number(d) }),
  cpBrief: () => { if (missionOpen(Progress.campaign(), cpPickNow().k)) menu.campaignBrief(cpPickNow()); },
  cpBriefBack: () => renderMp(),
  cpSolo: () => needName(() => launchCampaign(cpPickNow().k, cpPickNow().diff)),
  cpFriends: () => needName(() => hostCampaign(cpPickNow().k, cpPickNow().diff)),
  // The Hardcore switch: saved on this device, on top of every pick it fits (and a room this phone hosts).
  mpHardcore: () => { Options.set('hardcore', !Options.get('hardcore')); renderMp(); },
  mpCancel: () => { stopSearch(); renderMp(); },
  // Custom: Match (the picker) and Training.
  customTab: ({ tab }) => { if (tab === 'match' || tab === 'training') { app.customTab = tab; renderCustom(); } },
  customBack: () => leaveCustom(),
  customHost: () => { needName(() => startHosting({ custom: currentCustom() })); },
  customVote: () => setLobbyCustom(null),
  lobbyCustom: () => editLobbyCustom(),
  trMap: ({ id }) => { if (id === 'range' || MAPS[id]) setTraining({ map: id }); },
  trStep: ({ dir }) => setTraining({ bots: Math.max(1, Math.min(TRAIN_MAX_BOTS, app.training.bots + Number(dir))) }),
  trSkill: ({ id }) => setTraining({ skill: id }),
  trDrill: ({ id }) => setTraining({ behaviour: id }),
  trToggle: ({ key }) => { if (key === 'ammo' || key === 'noDeath') setTraining({ [key]: !app.training[key] }); },
  trStart: () => { needName(startTraining); },
  lobbyMods: () => {
    if (!app.isHost) return;
    modsSheet(menu, { mods: app.lobby.mods ?? [], onChange: list => {
      // Hardcore in a room is the same switch as on the Multiplayer screen: flipping it here flips that too.
      if (list.includes('hardcore') !== (app.lobby.mods ?? []).includes('hardcore')) Options.set('hardcore', list.includes('hardcore'));
      app.lobby.mods = list; broadcastLobby(); renderLobby();
    } });
  },
  host: () => { needName(startHosting); },
  join: () => { needName(askCode); },
  browse: () => openBrowse(),
  lobbyPublic: () => setPublic(!app.public),
  gunsmith: () => openGunsmith(),
  loadout: () => openLoadout(),
  operators: () => openOperators(),
  // The title's emote row: the operator in the yard plays it (docs/FINISHERS.md).
  titleEmote: () => { const row = menu.el.querySelector('.ttl-emotes'); if (row) row.hidden = !row.hidden; },
  titleEmotePlay: ({ i }) => {
    const e = Progress.emotes()[Number(i)];
    if (!e) return;
    if (!e.unlocked) { unlockSheet(menu, 'emote', e.id); return; }
    const row = menu.el.querySelector('.ttl-emotes');
    if (row) row.hidden = true;
    if (!backdrop.emote(Number(i))) menu.toast(e.name);
  },
  leaveLobby: () => leaveRoom(),
  copyCode: () => copyRoomCode(),
  lobbyClanJoin: () => joinOfferedClan(),
  toggleReady: () => toggleReady(),
  start: () => startVote(),
  voteCast: ({ i }) => castVote(Number(i)),
  voteLeave: () => { if (app.vote?.solo) { stopVote(); renderMp(); } else leaveRoom(); },
  soloBack: () => leaveCustom(),
  soloMap: ({ id }) => pickSoloMap(id),
  soloMode: ({ id }) => pickSoloMode(id),
  soloStart: () => (app.customFrom === 'lobby' ? setLobbyCustom(currentCustom()) : launchSolo(app.soloPick.mapId, app.soloPick.mode)),
  soloBots: () => botMatchSheet(menu, app.soloPick, { onChange: renderSoloPick }),
  botSkill: ({ skill }) => { app.lobby.botSkill = skill; broadcastLobby(); renderLobby(); },
  brSquad: ({ n }) => setBrSquad(n),
  moveTeam: ({ id }) => moveTeam(id),
  toggleWatch: () => toggleWatch(),
  lobbyMic: () => app.voice?.toggleMic(),
  voiceMute: ({ id }) => voiceUi?.toggleMute(id),
});

// A short question over the menu: Stay (or B) closes it, the red button does the thing (QoL).
function confirmSheet({ title, body, yes = 'Leave', no = 'Stay', onYes }) {
  menu.overlay(`
    <div class="sheet slim qol-confirm" role="alertdialog" aria-label="${title.replace(/"/g, '')}">
      <h2>${title}</h2>
      <p>${body}</p>
      <div class="sheet-row">
        <button class="btn" data-act="qolNo" data-sound="back">${no}</button>
        <button class="btn is-danger" data-act="qolYes" data-sound="confirm">${yes}</button>
      </div>
    </div>`);
  menu.on({ qolNo: () => menu.overlay(''), qolYes: () => { menu.overlay(''); onYes(); } });
}

// Tap to copy the room code (QoL). A browser that refuses the clipboard still shows the code to read out.
function copyRoomCode() {
  const code = app.code;
  if (!code) return;
  const said = () => menu.toast(`Room code ${code} copied`);
  try {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(said, () => menu.toast(`Room code: ${code}`));
    else menu.toast(`Room code: ${code}`);
  } catch { menu.toast(`Room code: ${code}`); }
}

// Leaving a friend room: a host with friends in it is asked first, since the room passes to one of them.
function leaveRoom() {
  const others = app.net && app.isHost ? app.lobby.humans.filter(h => h.id !== app.net.localId).length : 0;
  if (!others) { goTitle(); return; }
  confirmSheet({
    title: 'Leave your room?',
    body: `You are hosting ${others} other player${others === 1 ? '' : 's'}. One of them becomes host and the room stays open without you.`,
    yes: 'Leave room', onYes: () => goTitle(),
  });
}

function needName(next) {
  if (Progress.name) next();
  else editName(next);
}

function editName(next, back = () => showTitle()) {
  menu.keypad({
    title: 'Choose a callsign', value: Progress.name, max: 12, kind: 'name', doneLabel: 'Save',
    hint: 'Your squad sees this in the lobby and the kill feed.',
    onDone: value => { Progress.name = value; next(); },
    onCancel: back,
  });
}

function askCode() {
  menu.keypad({
    title: 'Enter room code', max: 4, kind: 'code', doneLabel: 'Join',
    hint: 'Your host can read it to you from their lobby.',
    onDone: code => startJoining(code),
    onCancel: () => showTitle(),
  });
}

function afterEditing() {
  if (app.net && app.lobby.humans.length) renderLobby();
  else showTitle();
}

// Keeps the host's seat record in step with what this player just changed.
function shareLoadout() {
  if (!app.net) return;
  const me = localHuman();
  if (!me) return;
  Object.assign(me, seatData());
  if (app.isHost) broadcastLobby();
  else app.net.sendLobby({ t: 'loadout', ...seatData() });
}

function openGunsmith(loadoutIndex, onBack = afterEditing, weapon) {
  menu.gunsmith({ loadoutIndex, weapon, onBack, onChange: shareLoadout, onPlay: shortcutOk() ? () => playShortcut({ tab: 'standard', sel: { playlist: 'qp', modes: [] }, name: 'Quick Play' }) : null });
}

function openOperators(loadoutIndex, onBack = afterEditing) {
  menu.operators({ loadoutIndex, onBack, onChange: shareLoadout });
}

function openLoadout() {
  menu.loadouts({
    onBack: afterEditing,
    onChange: shareLoadout,
    onGunsmith: (i, weapon) => openGunsmith(i, openLoadout, weapon),
    onOperators: i => openOperators(i, openLoadout),
    onRename: i => menu.keypad({
      title: 'Name this loadout', value: Progress.loadouts()[i].name, max: 16, kind: 'name', doneLabel: 'Save',
      onDone: value => { Progress.renameLoadout(i, value); shareLoadout(); openLoadout(); },
      onCancel: openLoadout,
    }),
  });
}

function openProfile() {
  menu.profile({
    onBack: afterEditing,
    onChange: shareLoadout,
    onRename: () => editName(() => { shareLoadout(); openProfile(); }, openProfile),
    onSave: () => openSave(openProfile),
  });
}

function openOptions() {
  menu.options({ onBack: afterEditing, onPreviewSound: () => audio.uiClick?.(), onSquad: editSquad });
}

// The squad tag: rooms announced with one are listed only to phones with the same tag (js/net/lobbies.js).
function editSquad() {
  menu.keypad({
    title: 'Squad tag', value: Options.get('squad'), max: 10, kind: 'name', doneLabel: 'Save',
    hint: 'Public rooms with this tag show only to phones with the same tag. Letters and numbers.',
    onDone: value => {
      Options.set('squad', cleanSquad(value));
      if (app.announcer) { stopAnnouncing(); startAnnouncing(); }
      openOptions();
    },
    onCancel: openOptions,
  });
}

// Challenge shortcuts (QoL): Multiplayer opens on the tab with the pick where the challenge counts; Find match is the
// player's tap. Not from inside a friend room, which plays what its host picks.
function playShortcut(where) {
  if (!where || !MP_TAB_IDS.includes(where.tab)) return;
  needName(() => {
    resetToSolo();
    app.customFrom = null;
    app.mp.tab = where.tab;
    app.mp.sels[where.tab] = { playlist: where.sel.playlist ?? null, modes: [...(where.sel.modes ?? [])] };
    renderMp();
    menu.toast(`Counts in ${where.name}`);
  });
}
const shortcutOk = () => !app.net;

function openChallenges(back = afterEditing) {
  menu.challenges({ onBack: back, onPlay: shortcutOk() ? playShortcut : null });
}

function openStats(back = afterEditing) {
  statsScreen(menu, { onBack: back, onBoards: () => openBoards(() => openStats(back)) });
}

// The Season screen (js/ui/season.js): the track, the weekly sets and ranked; Play Ranked searches the Ranked playlist.
function openSeason(back = afterEditing) {
  menu.season({ onBack: back, onPlayRanked: () => needName(() => findMatch('standard', { playlist: 'ranked', modes: [] })), onPlay: shortcutOk() ? playShortcut : null });
}

function openBoards(back = afterEditing) {
  boardsScreen(menu, { onBack: back, myId: app.net?.localId ?? selfId() });
}

function openHistory(tab = 'matches') {
  menu.history({ onBack: afterEditing, onStats: () => openStats(openHistory), tab, onWatch: watchClip, onWatchCode: watchShared });
}

// History > Clips > Replay code: a friend's shared replay (js/game/replay-code.js), back to the Clips tab when it closes.
// Save keeps it as a clip here like any other.
function watchShared(clip) {
  const back = () => {
    if (app.inMatch) return;
    openHistory('clips');
    backdrop.setLoadout(myLoadout());
    backdrop.live();
  };
  if (!openReplay(clip, { onClose: back, title: clip.title ? `Shared · ${clip.title}` : 'Shared replay' })) back();
}

// The match replay player (js/game/replay-player.js) on the game canvas, over whatever menu screen is up (hidden by
// body.replay-on while it plays). Returns false when nothing could be played. Never during a match.
function openReplay(clip, { onClose = null, saved = false, title = '' } = {}) {
  if (!clip || replayView || app.inMatch) return false;
  backdrop.stop();
  menu.pausePreview();
  try {
    replayView = new ReplayPlayer({
      canvas, root: uiRoot, clip, saved, title, quality: Options.get('quality'),
      onSave: saved ? null : c => saveClip(c),
      onClose: () => {
        replayView = null;
        app.renderer = null;
        menu.resumePreview();
        onClose?.();
      },
    });
  } catch (err) {
    console.error('replay', err);
    replayView = null;
    menu.resumePreview();
    onClose?.();
    return false;
  }
  app.renderer = replayView.renderer;     // Resizes, the quality option and the perf overlay follow it.
  return true;
}

// History > Clips: a saved clip, back to the Clips tab (and the yard behind it) when it closes.
async function watchClip(id) {
  const clip = await loadClip(id);
  const back = () => {
    if (app.inMatch) return;
    openHistory('clips');
    backdrop.setLoadout(myLoadout());
    backdrop.live();
  };
  if (!clip || !openReplay(clip, { saved: true, onClose: back })) back();
}

function openHelp(tab) {
  // Training is solo; from a lobby it would walk out of the room, so it is only offered from the title. The help videos
  // take the canvas, so they are offered wherever the menu owns it (not in a match).
  menu.help({ onBack: afterEditing, onTutorial: app.net ? null : () => startTutorial(), onVideo: id => openHelpVideo(id), tab });
}

// A help video (js/game/help-video.js, docs/TUTORIAL.md) on the game canvas over the Help screen, which stays mounted
// under it. The player and the renderer are loaded only now, on the first tap of a Watch chip.
let helpVideo = null;
async function openHelpVideo(id) {
  const video = VIDEO_BY_ID[id];
  if (!video || helpVideo || replayView || app.inMatch) return;
  helpVideo = 'loading';
  let Player;
  try { ({ HelpVideoPlayer: Player } = await import('./game/help-video.js')); } catch (err) { console.error('help video load', err); helpVideo = null; menu.toast('Could not load the video'); return; }
  if (app.inMatch || replayView) { helpVideo = null; return; }
  backdrop.stop();
  menu.pausePreview();
  const back = () => {
    helpVideo = null;
    app.renderer = null;
    menu.resumePreview();
    if (!app.inMatch) { backdrop.setLoadout(myLoadout()); backdrop.live(); }
  };
  const k = VIDEOS.indexOf(video), next = VIDEOS[k + 1];
  try {
    helpVideo = new Player({ canvas, root: uiRoot, video, quality: Options.get('quality'), onClose: back, onNext: next ? () => openHelpVideo(next.id) : null });
  } catch (err) {
    console.error('help video', err);
    back();
    menu.toast('Could not play the video');
    return;
  }
  app.renderer = helpVideo.renderer;
}

function openSave(back = afterEditing) {
  menu.saveCode({
    onBack: back,
    onImported: () => { shareLoadout(); menu.toast('Save loaded'); back(); },
  });
}

// --- Lobby ---
function localHuman() {
  return app.lobby.humans.find(h => h.id === app.net?.localId);
}

function renderLobby() {
  if (!app.net) return;
  if (app.isHost && app.customFrom === 'lobby') return;     // The host is in the custom picker; Back repaints.
  if (app.tnView) return;                                    // On the weekend cup's bracket; Back repaints.
  updateVoiceTeam();
  menu.lobby({
    voice: !!app.voice && app.voice.state !== 'unavailable',
    code: app.code, humans: app.lobby.humans, botSkill: app.lobby.botSkill, isHost: app.isHost,
    localId: app.net.localId, hostId: app.net.hostId,
    countdown: app.isHost ? (app.rematch?.left ?? null) : app.countdown,
    rematchWait: app.rematchWait,
    ffa: ffaRoom(),
    public: app.public,
    mods: app.lobby.mods ?? [],
    custom: app.lobby.custom ?? null,
    br: isBr(roomMode()), brSquad: app.lobby.brSquad ?? 4,
    ranked: rankedRoom(), rankedOn: !!app.lobby.ranked, rankedFull: (app.lobby.humans ?? []).length >= RANKED_PARTY,
    cup: lobbyCup(),
    clanOffer: clanOffer(),
  });
}

// "Join [TAG]": a clan on the card of someone in this lobby (their career card, stored with the friends), when this
// phone is not in it. The first such player in the room's order offers theirs.
function clanOffer() {
  if (!app.net) return null;
  const mine = Clan.get(), cards = new Map(Friends.list(app.net.localId).map(f => [f.id, f.card]));
  for (const h of app.lobby.humans ?? []) {
    const cl = h.id !== app.net.localId ? cards.get(h.id)?.cl : null;
    if (cl && cl.id !== mine?.id) return { tag: cl.tag, name: cl.name, from: h.id, switching: !!mine };
  }
  return null;
}
function joinOfferedClan() {
  const offer = clanOffer();
  const cl = offer ? Friends.list(app.net?.localId).find(f => f.id === offer.from)?.card.cl : null;
  if (!cl) return;
  const r = Clan.join(cl);
  if (r.error) { menu.toast(r.error, 'warn'); return; }
  menu.toast(`Joined [${r.clan.tag}] ${r.clan.name}`);
  renderLobby();
}
// Whenever this phone's clan changes (founded, joined, edited, left, a clanmate's rename): in a lobby the seat takes the
// new tag (guests send their join again; the host keeps the seat and takes the new name) and the card goes round again.
Clan.onChange(() => {
  if (!app.net || app.inMatch) return;
  if (app.isHost) { const me = localHuman(); if (me) me.name = myTagName(); broadcastLobby(); }
  else app.net.sendLobby({ t: 'join', name: myName(), clan: Clan.tag() ?? undefined, build: BUILD, ...seatData() });
  shareCareer();
});

// Battle royale squad size for the room (js/ui/br-squad.js): the host's call, shown on the lobby and the vote.
function setBrSquad(n) {
  if (!app.isHost || !app.net || app.vote?.winner != null) return;
  app.lobby.brSquad = cleanBrSquad(Number(n));
  Recall.set('brSquad', app.lobby.brSquad);
  broadcastLobby();
  if (app.vote) { broadcastVote(); renderVote(); } else if (menuShows('lobby')) renderLobby();
}

function broadcastLobby() {
  if (!app.isHost || !app.net) return;
  app.net.sendLobby({ t: 'state', humans: app.lobby.humans, botSkill: app.lobby.botSkill, mods: app.lobby.mods ?? [], custom: app.lobby.custom ?? null, brSquad: app.lobby.brSquad ?? 4, countdown: app.rematch?.left ?? null, public: app.public, build: BUILD, ...(app.lobby.ranked ? { ranked: true } : {}), ...hostTourney() });
}

// --- Public rooms: announced to Browse games while public, in the lobby and in a match with a seat to offer ---
function setPublic(on) {
  if (!app.isHost || !app.net) return;
  app.public = !!on;
  if (app.public) startAnnouncing(); else stopAnnouncing();
  broadcastLobby();
  if (menuShows('lobby')) renderLobby();
  menu.toast(app.public ? 'Room is public: listed in Browse games' : 'Room is private: code and invites only');
}

function startAnnouncing() {
  if (app.announcer || !app.public || !app.isHost || !app.net) return;
  app.announcer = new LobbyAnnouncer({ squad: Options.get('squad'), getInfo: lobbyAnnouncement });
}

function stopAnnouncing() {
  app.announcer?.stop();
  app.announcer = null;
}

// What Browse games shows for this room (fields: js/net/lobbies.js cleanLobby), or null to stay off the list: a match
// in progress is listed only while it holds a slot for someone who dropped or has one open.
function lobbyAnnouncement() {
  const net = app.net;
  if (!net || !app.isHost || !app.public) return null;
  const base = { code: app.code, host: myName(), pid: net.localId };
  if (app.inMatch && app.matchInfo) {
    const view = app.match?.interp.newest;
    const players = (view?.players ?? []).filter(p => !p.dummy);
    const held = players.filter(p => p.away && !p.open).map(p => p.id);
    const open = players.filter(p => p.away && p.open).length;
    if (!held.length && !open) return null;
    return {
      ...base, map: app.matchInfo.mapId, mode: app.matchInfo.mode, phase: 'match',
      humans: players.filter(p => !p.isBot && !p.away).length, slots: players.length,
      left: Math.round(view?.timeLeft ?? 0), open, held,
    };
  }
  return {
    ...base, map: app.vote ? null : app.lastPlayed?.mapId ?? null, mode: app.vote ? null : app.lastPlayed?.mode ?? null,
    phase: app.vote ? 'voting' : 'lobby', humans: app.lobby.humans.length, slots: roomCap(), left: 0, open: 0, held: [],
  };
}

// --- Browse games ---
function openBrowse() {
  closeBrowse();
  const browser = app.browser = new LobbyBrowser({ squad: Options.get('squad'), selfId: selfId() });
  browseScreen(menu, {
    browser,
    squad: Options.get('squad'),
    selfId: selfId(),
    onJoin: code => needName(() => { closeBrowse(); startJoining(code); }),
    onCode: () => { closeBrowse(); needName(askCode); },
    onHost: () => { closeBrowse(); needName(startHosting); },
    onBack: () => { closeBrowse(); showTitle(); },
  });
}

function closeBrowse() {
  app.browser?.close();
  app.browser = null;
}

// --- Rematch: same room and code, players land in the lobby and the host's countdown launches the next match. ---
function startRematchCountdown() {
  stopRematch();
  const rematch = app.rematch = { left: REMATCH_SECONDS, timer: 0 };
  rematch.timer = setInterval(() => {
    rematch.left--;
    if (rematch.left <= 0) {
      stopRematch();
      startVote();
      return;
    }
    broadcastLobby();
    if (menuShows('lobby')) renderLobby();
  }, 1000);
  broadcastLobby();
  renderLobby();
}

function stopRematch() {
  clearInterval(app.rematch?.timer);
  app.rematch = null;
}

// The mode the room is playing, or played last: what the lobby's seats and voice follow until the next vote picks.
const roomMode = () => app.matchInfo?.mode ?? app.lastPlayed?.mode ?? null;
const ffaRoom = () => isFfa(roomMode());

// Humans the room can seat: both teams in full, or a free-for-all's whole field on its map.
function roomCap() {
  if (isBr(roomMode()) || isEx(roomMode())) return BR_HUMANS;     // Extraction: eight people at most, in squads.
  if (isZm(roomMode()) || isZm(app.lobby?.custom?.mode)) return ZM_SQUAD;     // Graveyard Shift: four players, all on one side.
  if (isCp(roomMode()) || isCp(app.lobby?.custom?.mode)) return CP.squad;     // The campaign: a squad of four.
  if (!ffaRoom()) return TEAM_SIZE * 2;
  const mapId = app.matchInfo?.mapId ?? app.lastPlayed?.mapId;
  return playersFor(roomMode(), MAPS[mapId] ?? null);
}

function teamOpen(team, except = null) {
  // A free-for-all has no sides (buildRoster deals everyone their own); only the room's size matters.
  if (ffaRoom() || isCp(app.lobby?.custom?.mode)) return app.lobby.humans.filter(h => h.id !== except && !h.spec).length < roomCap();
  return app.lobby.humans.filter(h => h.team === team && h.id !== except && !h.spec).length < TEAM_SIZE;
}

// `custom`: Custom > Host room hosts with the picker's settings (see currentCustom); otherwise the room plays the map vote.
function startHosting({ custom = null } = {}) {
  wakeLock.set(true);           // A host reading out the code should not watch the phone dim.
  const code = NetImpl.makeCode();
  const net = NetImpl.host(code, myName());
  app.net = net;
  app.code = code;
  app.isHost = true;
  app.lobby = {
    humans: [{ id: net.localId, name: myTagName(), team: 0, ready: true, host: true, ...seatData() }],
    botSkill: custom?.skill ?? MP_BOT_SKILL,
    mods: custom?.mods ?? withHardcore([], Options.get('hardcore')),     // A map-vote room starts with the Hardcore switch.
    custom,
    brSquad: cleanBrSquad(Recall.get('brSquad', 4)),     // The squad size this phone last hosted with.
  };
  app.customFrom = null;
  wireSharedNet(net);
  wireHostNet(net);
  renderLobby();
}

// The host's half of the session, done once at the start or at the moment of promotion.
function wireHostNet(net) {
  // A returning player, on the same device, gets the slot its bot is holding.
  net.onPeerJoin(id => { if (app.inMatch && app.dead.has(id)) seatReturningPlayer(id); }, { persist: true });
  net.onPeerLeave(id => hostSawLeave(id), { persist: true });
  net.onLobby((msg, from) => hostLobbyMessage(msg, from));
}

// True if the match roster holds this player, which is what makes a mid-match join a rejoin.
function holdsSlot(id) {
  if (app.match?.isHost) return app.match.holdsHuman(id);
  return !!app.matchInfo?.roster.some(r => r.id === id && !r.isBot);
}

// A newcomer joining a match in progress takes a slot nobody reclaimed in time (Sim.claimOpenSlot): fresh stats, no bot.
function seatOpenSlot(id, msg) {
  if (!app.net || !app.match?.isHost) return false;
  const seat = seatFrom(msg);
  const name = guestName(msg);
  const operator = cleanOperator(seat.loadout?.operator);
  const info = { badge: seat.badge, operator, skin: seat.loadout?.skin ?? null, emblem: seat.loadout?.emblem ?? null };
  const entry = app.match.claimOpenSlot(id, name, { ...seat.loadout, operator }, info);
  if (!entry) return false;
  app.dead.delete(id);
  if (!app.lobby.humans.some(h => h.id === id)) app.lobby.humans.push({ id, name, team: entry.team, ready: true, ...seat });
  app.badges?.set(id, seat.badge);
  app.net.sendLobby({ ...app.matchInfo, t: 'start', rejoin: true }, id);
  hud.notify(`${name} took an open slot`);
  broadcastLobby();
  app.announcer?.poke();
  return true;
}

function seatReturningPlayer(id) {
  if (!app.net || !holdsSlot(id)) return false;
  const entry = app.matchInfo.roster.find(r => r.id === id);
  if (!entry) return false;
  app.dead.delete(id);
  if (!app.lobby.humans.some(h => h.id === id)) {
    app.lobby.humans.push({ id, name: entry.name, team: entry.team, ready: true, primary: entry.primary, camo: entry.camo, loadout: entry.loadout, badge: entry.badge });
  }
  app.match?.humanRejoined?.(id);
  app.net.sendLobby({ ...app.matchInfo, t: 'start', rejoin: true }, id);
  hud.notify(`${entry.name} is back`);
  broadcastLobby();
  app.announcer?.poke();
  return true;
}

function hostLobbyMessage(msg, from) {
  const humans = app.lobby.humans;
  let guest = humans.find(h => h.id === from);
  switch (msg.t) {
    case 'join': {
      if (msg.build !== BUILD) menu.toast(`${String(msg.name ?? 'A player').slice(0, 12)} is on a different version. Both reopen the game to match.`, 'warn');
      if (app.inMatch) {
        if (seatReturningPlayer(from) || seatOpenSlot(from, msg)) return;
        app.net.sendLobby(refusal('started'), from);
        return;
      }
      if (!guest) {
        if (humans.length >= roomCap()) {
          app.net.sendLobby(refusal('full'), from);
          return;
        }
        // Friends default to the same side; overflow goes to the other team.
        guest = { id: from, name: guestName(msg), team: teamOpen(0) ? 0 : 1, ready: false, ...seatFrom(msg) };
        humans.push(guest);
      } else guest.name = guestName(msg);      // A guest who joined a clan in the lobby sends its join again.
      break;
    }
    case 'cast': {
      const vote = app.vote;
      if (vote && vote.winner === null && guest && vote.options[msg.i]) {
        vote.votes.set(from, msg.i);
        broadcastVote();
        renderVote();
      }
      return;
    }
    case 'career': {
      const card = guest ? storeCareer(from, msg.c) : null;
      if (!card) return;
      (app.careers ??= new Map()).set(from, card);
      if (!app.careers.has(app.net.localId)) try { app.careers.set(app.net.localId, Progress.careerCard()); } catch (err) { console.error('career card', err); }
      broadcastCareers();
      if (menuShows('lobby')) renderLobby();      // A clanmate's card can offer "Join [TAG]".
      return;
    }
    case 'ready': if (guest) guest.ready = !!msg.ready; break;
    case 'spec': if (guest) guest.spec = !!msg.on; break;     // Watch: a spectator seat (docs/RANKED.md).
    case 'loadout': if (guest) Object.assign(guest, seatFrom(msg)); break;
    case 'team': {
      if (guest && teamOpen(msg.team, guest.id)) guest.team = msg.team;
      break;
    }
    default: return;
  }
  broadcastLobby();
  if (menuShows('lobby')) renderLobby();
}

// A peer on another version may send a partial or stale loadout; normalizing here protects the match.
function seatFrom(msg) {
  const loadout = { ...msg.loadout, ...normalizeLoadout({ ...msg.loadout, primary: msg.primary, camo: msg.camo }) };
  return { primary: loadout.primary, camo: loadout.camo, loadout, badge: cleanBadge(msg.badge) };
}

function cleanBadge(b) {
  const n = (v, max, min) => Math.min(max, Math.max(min, Math.floor(Number(v)) || min));
  const prestige = n(b?.prestige, MAX_PRESTIGE, 0), level = n(b?.level, MAX_LEVEL, 1);
  // Master Prestige (docs/PRESTIGE.md): only at Prestige X level 50; older builds send none.
  const master = prestige >= MAX_PRESTIGE && level >= MAX_LEVEL ? n(b?.master, MASTER_MAX, 0) : 0;
  // Ranked seasons (docs/RANKED.md): the title worn, when it is one this build knows.
  return { prestige, level, master, rk: cleanCode(b?.rk), ...(TITLE_IDS.has(b?.tl) ? { tl: b.tl } : {}) };
}

// Matchmaking for the bot player pool (js/shared/botpool.js): where the humans in this match sit, so the bots drawn
// are players of about their level and skill. This phone's player is rated from their recent results; anyone else
// from the level on their badge.
function poolFor(humans) {
  const me = app.net?.localId ?? 'local';
  const recent = MatchHistory.list().slice(0, 10);
  const ratings = humans.map(h => {
    const b = cleanBadge(h.badge);
    if (h.id !== me && h.id !== 'local') return humanRating(b);
    const k = recent.reduce((a, e) => a + (e.kills || 0), 0), d = recent.reduce((a, e) => a + (e.deaths || 0), 0);
    return humanRating({ ...b, kd: recent.length ? k / Math.max(1, d) : null, matches: recent.length });
  });
  const n = Math.max(1, humans.length), mean = f => humans.reduce((a, h) => a + f(cleanBadge(h.badge)), 0) / n;
  return {
    target: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : undefined,
    level: { prestige: Math.round(mean(b => b.prestige)), level: Math.round(mean(b => b.level)) },
  };
}

// Bots have no save to read, so their rank follows their skill; a little variety by seat keeps tables believable.
// Pool bots (js/shared/botpool.js) bring their own level, operator, skin and emblem from their profile.
const BOT_LEVEL = { recruit: 4, regular: 14, veteran: 27, elite: 42 };
function withBadges(roster, humans, seed = 0) {
  return roster.map((r, i) => {
    const human = humans.find(h => h.id === r.id);
    // Dealt bots take the whole roster in a seeded order that alternates women and men, so a squad is mixed and
    // differs between matches (js/ui/operators.js botOrder).
    const operator = human ? cleanOperator(human.loadout?.operator) : r.operator ? cleanOperator(r.operator) : botOperator(seed, i);
    const badge = r.badge ?? (human ? cleanBadge(human.badge) : { prestige: 0, level: (BOT_LEVEL[r.skill] ?? 12) + (i * 3) % 7 });
    // The sim's loadout cleaning drops cosmetics it does not use; carry the player's skin and emblem across it.
    const looks = human ? { skin: human.loadout?.skin ?? null, emblem: human.loadout?.emblem ?? null, finisher: human.loadout?.finisher ?? null }
      : r.pool ? { skin: r.skin ?? r.loadout?.skin ?? null, emblem: r.loadout?.emblem ?? null } : {};
    return { ...r, badge, operator, loadout: { ...r.loadout, operator, ...looks } };
  });
}

function menuShows(screen) {
  return menu.el.dataset.screen === screen && menu.el.classList.contains('on');
}

function hostSawLeave(id) {
  const h = app.lobby.humans.find(x => x.id === id);
  app.lobby.humans = app.lobby.humans.filter(x => x.id !== id);
  if (app.vote?.votes?.delete(id)) { broadcastVote(); renderVote(); }
  if (app.inMatch) {
    if (holdsSlot(id)) app.dead.add(id);
    if (h) hud.notify(`${h.name} dropped, slot held`);
    app.announcer?.poke();
  } else {
    broadcastLobby();
    if (menuShows('lobby')) renderLobby();
  }
}

function moveTeam(id) {
  const humans = app.lobby.humans, h = humans.find(x => x.id === id);
  if (!h) return;
  const next = 1 - h.team;
  if (ffaRoom()) return;               // Everyone for themselves: there is no other team to move to.
  if (app.isHost) {
    if (!teamOpen(next, id)) return menu.toast(`${h.name} can't move: that team is full.`);
    h.team = next;
    broadcastLobby();
    renderLobby();
  } else if (id === app.net.localId) {
    app.net.sendLobby({ t: 'team', team: next });
  }
}

// Watch: a guest takes a spectator seat for the room's next matches (or back to playing). docs/RANKED.md.
function toggleWatch() {
  const me = localHuman();
  if (!me || app.isHost || !app.net) return;
  me.spec = !me.spec;
  app.net.sendLobby({ t: 'spec', on: me.spec });
  menu.toast(me.spec ? 'You will watch the next match with the caster camera' : 'You will play the next match');
  renderLobby();
}

// The spectator seat's match: the caster camera over the host's snapshots. Back to the room when it ends or on Leave.
function beginSpectating(msg) {
  const net = app.net;
  if (!net || !MAPS[msg.mapId]) return;
  replayView?.close();
  app.inMatch = true;
  wakeLock.set(true);
  app.matchInfo = { roster: msg.roster, seed: msg.seed, mapId: msg.mapId, mode: msg.mode, mods: cleanMods(msg.mods, msg.mode), scoreLimit: msg.scoreLimit, timeLimit: msg.timeLimit, spectating: true };
  stopVote();
  net.resetGameHandlers();
  backdrop.stop();
  menu.hide();
  menu.overlay('');
  hud.setVisible(false);
  controls.setEnabled(false);
  const renderer = app.renderer = new GameRenderer(canvas, MAPS[msg.mapId]);
  renderer.resize();
  renderer.setQuality?.(Options.get('quality'));
  renderer.chars.setRoster(msg.roster);
  const back = () => {
    if (!(app.match instanceof SpectatorMatch)) return;
    endLocalMatch();
    // Ready for the room's next match (a spectator has no results to read).
    const me = localHuman();
    if (me && app.net) { me.ready = true; app.net.sendLobby({ t: 'ready', ready: true }); }
    renderLobby();
  };
  app.match = new SpectatorMatch({
    mapId: msg.mapId, mode: msg.mode, mods: cleanMods(msg.mods, msg.mode), seed: msg.seed, roster: msg.roster,
    scoreLimit: msg.scoreLimit, timeLimit: msg.timeLimit, net, renderer, audio,
    title: `${MAPS[msg.mapId]?.name ?? ''} · ${MODES[msg.mode]?.name ?? ''}`, onExit: back, onEnd: back,
  });
  app.match.start();
}

function toggleReady() {
  const me = localHuman();
  if (!me) return;
  me.ready = !me.ready;
  app.net.sendLobby({ t: 'ready', ready: me.ready });
  renderLobby();
}

function startJoining(code) {
  wakeLock.set(true);
  const net = NetImpl.join(code, myName());
  app.net = net;
  app.code = code;
  app.isHost = false;
  menu.searching(code, () => goTitle());
  wireSharedNet(net);
  net.onConnected(() => {
    net.sendLobby({ t: 'join', name: myName(), clan: Clan.tag() ?? undefined, build: BUILD, ...seatData() });
    shareCareer();
  });
  net.onJoinFailed(() => {
    teardownNet();
    forgetRoom();
    if (inviteJoinFailed(menu, code, { retry: () => startJoining(code), enterCode: askCode })) showTitle();
    else menu.notFound(code, { retry: () => startJoining(code), back: () => goTitle(), ...(NetImpl === Net ? (({ kind, detail }) => ({ reason: kind, detail }))(joinDiagnosis()) : {}) });
  });
  net.onLobby(msg => guestLobbyMessage(msg));
  net.onHostLost(() => setHostNotice(true));
  net.onHostBack(() => setHostNotice(false));
  net.onHostChanged((id, name) => hostChanged(id, name));
  net.onPromoted(oldHostId => becomeHost(oldHostId));
  net.onDemoted(() => demotedHost());
}

function guestLobbyMessage(msg) {
  switch (msg.t) {
    case 'state':
      if (msg.build !== BUILD && app.buildWarned !== app.code) { app.buildWarned = app.code; menu.toast('The host is on a different version. Both reopen the game to match.', 'warn'); }
      inviteSettled();
      app.lobby.humans = msg.humans;
      app.lobby.botSkill = msg.botSkill;
      app.lobby.mods = cleanMods(msg.mods);
      app.lobby.custom = msg.custom && typeof msg.custom === 'object' ? msg.custom : null;
      app.lobby.brSquad = cleanBrSquad(msg.brSquad);
      app.lobby.ranked = msg.ranked === true;
      app.lobby.tn = cleanHostRun(msg.tn);
      app.countdown = msg.countdown ?? null;
      app.public = !!msg.public;
      if (app.voice) updateVoiceTeam();
      if (menuShows('results')) menu.updateCountdown(app.countdown);
      else if (!app.inMatch && !app.vote && !EDIT_SCREENS.includes(menu.el.dataset.screen)) renderLobby();
      break;
    case 'vote':
      showGuestVote(msg);
      break;
    case 'careers':
      for (const r of Array.isArray(msg.list) ? msg.list.slice(0, 16) : []) if (typeof r?.id === 'string') storeCareer(r.id, r.c);
      if (menuShows('lobby')) renderLobby();
      break;
    case 'start':
      // A guest that never left this match hears its own rejoin announcement after a brief drop.
      if (msg.rejoin && app.inMatch && app.matchInfo?.seed === msg.seed) break;
      // Normally the old match is long over; a guest whose final-kill hold outlasted the countdown is cut short here.
      endLocalMatch();
      app.countdown = null;
      app.rematchWait = false;
      // A spectator (Watch in the lobby) is not in the roster: it watches the match instead (docs/RANKED.md).
      if (Array.isArray(msg.roster) && !msg.roster.some(r => r.id === app.net.localId)) {
        if (localHuman()?.spec) beginSpectating(msg);
        break;
      }
      beginMatch({
        roster: msg.roster, seed: msg.seed, mapId: msg.mapId, mode: msg.mode, mods: cleanMods(msg.mods, msg.mode),
        scoreLimit: msg.scoreLimit, timeLimit: msg.timeLimit,
        hostId: app.net.hostId, isHost: false, rejoin: !!msg.rejoin, ranked: msg.ranked === true && !msg.rejoin ? {} : null,
        tourney: guestTourney(msg),
      });
      break;
    case 'refused': {
      const code = app.code;
      forgetRoom();
      goTitle();
      showJoinProblem(menu, { why: refusalKind(msg), reason: msg.reason, code, retry: () => startJoining(code), enterCode: askCode });
      break;
    }
    default:
      break;
  }
}

const HOST_LOST_TEXT = 'Host lost, switching over';

function setHostNotice(on) {
  if (app.inMatch) hud.setNotice(on ? HOST_LOST_TEXT : '');
  else if (menuShows('results')) (on ? menu.resultsNote(HOST_LOST_TEXT) : menu.updateCountdown(app.countdown));
  else if (on) menu.overlay(`<div class="sheet slim"><div class="radar small" aria-hidden="true"><i></i><i></i><i></i></div><h2>Host lost</h2><p>Finding a new host for the room. Hang on a moment.</p></div>`);
  else menu.overlay('');
}

function hostChanged(id, name) {
  setHostNotice(false);
  stopVote();      // A vote run by the old host can never finish.
  const n = name || 'A new player';
  if (app.inMatch) hud.announceHost(n, false);
  else menu.toast(`${n} is now hosting`);
  if (!app.inMatch && !app.vote && !EDIT_SCREENS.includes(menu.el.dataset.screen) && !menuShows('results')) renderLobby();
}

// Promotion: this phone is now the room. The match continues from the last snapshot; the lobby carries over as it is.
function becomeHost(oldHostId) {
  const net = app.net;
  if (!net) return;
  setHostNotice(false);
  app.isHost = true;
  app.countdown = null;
  app.rematchWait = false;
  stopVote();
  app.lobby.humans = app.lobby.humans.filter(h => h.id !== oldHostId);
  const me = localHuman();
  if (me) { me.host = true; me.ready = true; }
  wireHostNet(net);
  broadcastLobby();
  startAnnouncing();               // A public room stays listed under its new host.
  if (app.inMatch) {
    app.match?.promoteToHost?.({ goneIds: oldHostId ? [oldHostId] : [] });
    hud.announceHost(myName(), true);
  } else if (menuShows('results')) {
    menu.resultsNote('You are now hosting this room');
  } else {
    menu.toast('The host left. You are now hosting.');
    if (!EDIT_SCREENS.includes(menu.el.dataset.screen)) renderLobby();
  }
}

// This phone went quiet long enough for the room to move on, and has come back to find a new host.
function demotedHost() {
  const code = app.code;
  endLocalMatch();
  goTitle(`Reconnected too late to keep hosting. Rejoin ${code} to get back in.`);
}

// Handlers needed on both sides of a session.
function wireSharedNet(net) {
  net.onPeerBackground?.((id, hidden) => {
    const h = app.lobby.humans.find(x => x.id === id);
    if (h && app.inMatch && hidden) hud.notify(`${h.name} stepped away`);
  });
  app.voice = new Voice({
    net, audio,
    onState: (state, muted) => hud.setMic(state, muted),
  });
  hud.onMic(() => app.voice?.toggleMic());
  hud.onSpeaker(() => { if (app.voice) app.voice.setMuted(!app.voice.muted); });
  app.voice?.setVolume(Options.get('voice'));
  app.voice?.setMode(Options.get('voiceMode'));
}

function updateVoiceTeam() {
  const me = localHuman();
  if (!app.voice || !me) return;
  // Before and between matches the friend lobby is one party: everyone hears everyone.
  if (!app.inMatch) { app.voice.setTeammates(app.lobby.humans.filter(h => h.id !== me.id).map(h => h.id)); return; }
  // A free-for-all has no squad: voice goes to every human in the room.
  const ffa = ffaRoom() || isZm(roomMode()) || isCp(roomMode());     // Graveyard Shift and the campaign: every human is on the one side.
  app.voice.setTeammates(app.lobby.humans.filter(h => h.id !== me.id && (ffa || h.team === me.team)).map(h => h.id));
}

// --- Custom: Match is a direct pick of map, mode, bots and limits; Training the range or a map with practice bots ---
// The ?map=&mode= test hook still launches a custom match straight from the Custom button.
function startSolo() {
  needName(() => {
    resetToSolo();
    if (params.has('map') || params.has('mode')) launchSolo(params.get('map') || DEFAULT_MAP, params.get('mode') || 'tdm');
    else renderCustom();
  });
}

function renderCustom() {
  if (app.customTab === 'training' && app.customFrom !== 'lobby') menu.custom({ tab: 'training', training: app.training });
  else renderSoloPick();
}

function leaveCustom() {
  if (app.customFrom === 'lobby') { app.customFrom = null; renderLobby(); return; }
  showTitle();
}

// What the picker would launch, as a friend lobby carries it: the pick (halves may be Random), modifiers, difficulty,
// and the bot match settings for a picked mode (a Random mode plays with the rolled mode's defaults).
function currentCustom() {
  const { mapId, mode } = app.soloPick;
  const set = MODES[mode] ? BotMatch.resolve(mode, MAPS[mapId] ?? null) : null;
  return {
    mapId, mode, mods: cleanMods(soloMods(), MODES[mode] ? mode : null), skill: BotMatch.skill,
    bots: set?.bots ?? null, players: set?.players ?? null, scoreLimit: set?.scoreLimit ?? null, timeLimit: set?.timeLimit ?? null,
  };
}

// --- Friend lobby: the host may swap the map vote for custom settings, which every guest sees on the lobby ---
function editLobbyCustom() {
  if (!app.isHost || !app.net) return;
  const c = app.lobby.custom;
  if (c) app.soloPick = { mapId: c.mapId, mode: c.mode };
  app.customFrom = 'lobby';
  renderSoloPick();
}

function setLobbyCustom(custom) {
  app.customFrom = null;
  if (!app.isHost || !app.net) return renderLobby();
  if (isZm(custom?.mode) && app.lobby.humans.length > ZM_SQUAD) { menu.toast(`Graveyard Shift seats ${ZM_SQUAD} players`, 'warn'); return renderLobby(); }
  if (isCp(custom?.mode) && app.lobby.humans.length > CP.squad) { menu.toast(`A campaign squad is ${CP.squad} players`, 'warn'); return renderLobby(); }
  app.lobby.custom = custom;
  app.lobby.botSkill = custom?.skill ?? MP_BOT_SKILL;
  app.lobby.mods = custom ? custom.mods : withHardcore([], Options.get('hardcore'));
  broadcastLobby();
  renderLobby();
}

// A custom room's Start: its pick (a Random half rolled here), difficulty, bots per side and limits.
function launchCustomRoom() {
  const c = app.lobby.custom;
  const { mapId, mode } = isCp(c.mode) ? { mapId: c.mapId, mode: c.mode } : resolvePick({ mapId: c.mapId, mode: c.mode });
  app.lastPick = { mapId: c.mapId, mode: c.mode, custom: true };
  const set = c.mode === mode && c.bots !== null ? c : null;
  launchHostMatch(mapId, mode, {
    botSkill: c.skill, teamSize: set ? (isFfa(mode) ? set.players : set.bots) : null,
    scoreLimit: set?.scoreLimit ?? null, timeLimit: set?.timeLimit ?? null,
  });
}

// --- Training: the firing range, or any map with N bots and practice switches. Pays and records nothing. ---
function setTraining(part) {
  app.training = { ...app.training, ...part };
  saveTraining(app.training);
  renderCustom();
}

function startTraining() {
  const t = app.training;
  resetToSolo();
  if (t.map === 'range' || !MAPS[t.map]) return launchRange();
  const id = 'local', seed = randomSeed();
  const humans = [{ id, name: myTagName(), team: 0, ...seatData() }];
  // Every bot on the other side: buildRoster fills both sides to `bots`, and training keeps the enemy half.
  const roster = buildRoster(humans, { botSkill: t.skill, mode: 'tdm', mapId: t.map, seed, teamSize: t.bots }).filter(r => !r.isBot || r.team === 1);
  app.lastPick = { training: true };
  beginMatch({
    roster: withBadges(roster, humans, seed), seed, mapId: t.map, mode: 'tdm', scoreLimit: 9999, timeLimit: 5999,
    hostId: id, isHost: true, localId: id, intro: false,
    training: { ammo: t.ammo, noDeath: t.noDeath, behaviour: t.behaviour },
  });
}

// --- Multiplayer: pick a playlist or modes, a short search, a pre-match vote of 2-3 maps, then the match ---
function openMultiplayer() {
  resetToSolo();
  app.customFrom = null;
  renderMp();
}

// An unlock sheet's Play now (js/ui/unlocksheet.js): Multiplayer opened on the playlist or mode where that unlock counts.
setPlayNow(({ tab, playlist = null, modes = [] } = {}) => {
  if (!MP_TAB_IDS.includes(tab)) return;
  menu.overlay('');
  if (!shortcutOk()) { menu.toast('Leave the room to start a match from here'); return; }
  const name = (playlist ? playlistsFor(tab).find(p => p.id === playlist)?.name : MODES[modes[0]]?.name) ?? 'Multiplayer';
  playShortcut({ tab, sel: { playlist, modes }, name });
});

function mpSel(tab = app.mp.tab) {
  return (app.mp.sels[tab] ??= defaultSelection(tab));
}

function renderMp() {
  Recall.saveMp(app.mp);
  menu.multiplayer({ tab: app.mp.tab, sel: mpSel(), hardcore: !!Options.get('hardcore'), cpPick: cpPickNow() });
}

function stopSearch() {
  clearTimeout(app.mpSearch?.timer);
  clearInterval(app.mpSearch?.tick);
  app.mpSearch = null;
}

function findMatch(tab, sel) {
  const r = resolveSelection(tab, sel, { hardcore: !!Options.get('hardcore') });
  if (!r.modes.length) return;
  // Graveyard Shift with friends: a friend room set to the mode on any of its maps (friends take the bots' seats).
  if (r.friends) {
    resetToSolo();
    app.mp.tab = tab;
    app.mp.sels[tab] = { playlist: sel.playlist ?? null, modes: [] };
    needName(() => startHosting({ custom: { mapId: RANDOM, mode: r.modes[0], mods: [], skill: MP_BOT_SKILL, bots: null, players: null, scoreLimit: null, timeLimit: null } }));
    return;
  }
  resetToSolo();
  app.mp.tab = tab;
  app.mp.sels[tab] = { playlist: sel.playlist ?? null, modes: [...(sel.modes ?? [])] };
  app.lastPick = { mp: { tab, sel: app.mp.sels[tab] } };
  Recall.saveMp(app.mp);
  // A weekly event's playlist sits on Standard but plays where its mode lives (r.tab): the lobby and the maps from there.
  const playTab = r.tab ?? tab;
  const size = lobbySize(playTab, r.modes);
  const ui = menu.matchSearch({ name: r.name, tab: playTab, size });
  const t0 = performance.now();
  app.mpSearch = {
    tick: setInterval(() => ui.found(Math.min(size, 1 + Math.floor((performance.now() - t0) / SEARCH_MS * size))), 90),
    timer: setTimeout(() => { stopSearch(); startMpVote(playTab, r, size); }, SEARCH_MS),
  };
}

// --- Weekend tournaments (docs/TOURNAMENTS.md): the bracket screen, then each round straight into its match ---
const squadName = () => `${myName()}'s squad`;
function openTourney() {
  resetToSolo();
  menu.tourney({
    onBack: () => renderMp(), onPlay: playTourneyRound, owner: selfId(), name: squadName(), clan: Clan.get(),
    onReward: (kind, id) => unlockSheet(menu, kind, id),
  });
}

// A round of the player's run: their squad (pool teammates) against the clan in the bracket, on the round's mode and
// map, no vote. Starting it marks the round as being played, so leaving it counts as a loss.
function playTourneyRound({ key, round, plan, opponent, bracket }) {
  resetToSolo();
  const id = 'local', seed = randomSeed();
  const humans = [{ id, name: myTagName(), team: 0, ...seatData() }];
  const pool = poolFor(humans);
  const sides = matchSides(bracket, round, opponent, { humans: humans.length, target: pool.target ?? undefined, seed });
  const roster = pickBotsForMatch({ humans, mode: plan.mode, mapId: plan.mapId, seed, pool: { ...pool, sides } });
  app.lastPick = { tourney: true };
  if (!Progress.startTourneyRound(key, round)) { menu.toast('That round is not open', 'warn'); openTourney(); return; }
  beginMatch({
    roster: withBadges(roster, humans, seed), seed, mapId: plan.mapId, mode: plan.mode, mods: [],
    scoreLimit: LIMIT_OVERRIDE || plan.scoreLimit, timeLimit: TIME_OVERRIDE || plan.timeLimit,
    hostId: id, isHost: true, localId: id,
    tourney: { key, round, title: roundTitle(round, opponent), cup: bracket.cup.name, opponent: opponent.tag ? `[${opponent.tag}] ${opponent.name}` : opponent.name },
  });
}

// A friend room in the weekend cup: the host's bracket (owner: the host's id), the room's players as the squad (bots take
// the seats left), every phone's run following the host's. Guests can look at the bracket; the host plays the rounds.
function lobbyCup() {
  const info = tourneyAt();
  if (!info.live || !app.net || app.lobby.custom) return null;
  return { name: info.cup.name, size: info.cup.size, fits: (app.lobby.humans ?? []).length <= info.cup.size };
}
// The host's run, for the guests' view of the bracket: in the room's state messages while a cup is live.
function hostTourney() {
  if (!tourneyAt().live) return {};
  try { const t = Progress.tourney(); return { tn: { ...t.run, owner: t.owner || app.net.localId } }; } catch { return {}; }
}
function cleanHostRun(tn) {
  if (!tn || typeof tn !== 'object' || typeof tn.owner !== 'string') return null;
  const n = v => (Number.isFinite(v) ? Math.max(0, Math.min(3, v | 0)) : 0);
  return { entered: !!tn.entered, out: !!tn.out, champion: !!tn.champion, canReenter: !!tn.canReenter, roundsWon: n(tn.roundsWon), entriesLeft: n(tn.entriesLeft), best: n(tn.best), round: tn.round === null ? null : n(tn.round), owner: tn.owner.slice(0, 24) };
}
// A guest's tournament round from the host's start message: this phone's run follows the host's bracket.
function guestTourney(msg) {
  const t = msg.tourney;
  if (!t || msg.rejoin || typeof t.owner !== 'string' || !Number.isInteger(t.key) || !Number.isInteger(t.round) || t.round < 0 || t.round > 2) return null;
  try { Progress.joinTourney(t.key, t.owner, t.round); } catch (err) { console.error('tourney', err); return null; }
  return { key: t.key, round: t.round, title: String(t.title ?? '').slice(0, 60), cup: String(t.cup ?? '').slice(0, 30), opponent: String(t.opponent ?? '').slice(0, 40) };
}
function openPartyTourney() {
  if (!app.net) return;
  const hostId = app.net.hostId ?? app.net.localId;
  const hostName = app.lobby.humans.find(h => h.id === hostId)?.name ?? 'Host';
  app.tnView = true;
  menu.tourney({
    onBack: () => { app.tnView = false; renderLobby(); }, onPlay: playTourneyParty, party: true,
    owner: app.isHost ? app.net.localId : app.lobby.tn?.owner ?? hostId, name: `${hostName}'s squad`,
    // The host's clan names the squad: this phone's own, or the one on the host's career card.
    clan: app.isHost ? Clan.get() : Friends.list(app.net.localId).find(f => f.id === hostId)?.card.cl ?? null,
    hostRun: app.isHost ? null : app.lobby.tn ?? { entered: false, out: false, champion: false, canReenter: false, roundsWon: 0, entriesLeft: 2, best: 0, round: null },
    hostName: app.isHost ? null : hostName,
    onReward: (kind, id) => unlockSheet(menu, kind, id),
  });
}
function playTourneyParty({ key, round, plan, opponent, bracket }) {
  const net = app.net;
  if (!net || !app.isHost) return;
  const size = bracket.cup.size;
  if (app.lobby.humans.length > size) { menu.toast(`The ${bracket.cup.name} seats ${size} a squad`, 'warn'); return; }
  app.tnView = false;
  stopRematch();
  stopVote();
  const clean = app.lobby.humans.map(({ id, name, primary, camo, loadout, badge }) => ({ id, name, team: 0, primary, camo, loadout, badge }));
  const seed = randomSeed();
  const pool = poolFor(clean);
  const sides = matchSides(bracket, round, opponent, { humans: clean.length, target: pool.target ?? undefined, seed });
  const roster = pickBotsForMatch({ humans: clean, mode: plan.mode, mapId: plan.mapId, seed, pool: { ...pool, sides } });
  if (!Progress.startTourneyRound(key, round)) { menu.toast('That round is not open', 'warn'); return; }
  app.lastPick = { tourney: true, party: true };
  const tourney = { key, round, owner: net.localId, title: roundTitle(round, opponent), cup: bracket.cup.name, opponent: opponent.tag ? `[${opponent.tag}] ${opponent.name}` : opponent.name };
  const payload = {
    t: 'start', seed, mapId: plan.mapId, mode: plan.mode, mods: [],
    scoreLimit: LIMIT_OVERRIDE || plan.scoreLimit, timeLimit: TIME_OVERRIDE || plan.timeLimit,
    roster: withBadges(roster, clean, seed), tourney,
  };
  net.sendLobby(payload);
  beginMatch({ ...payload, hostId: net.localId, isHost: true });
}

// The pre-match lobby: the same vote screen a friend room uses, with the other players' ballots coming in as it runs.
function startMpVote(tab, r, size) {
  const options = mpVoteOptions(tab, r.modes, Math.random, { ranked: !!r.ranked });
  if (!options.length) { renderMp(); menu.toast('No map hosts that pick', 'warn'); return; }
  app.vote = {
    solo: true, key: `mp:${Date.now()}`, options, votes: new Map(), left: MP_VOTE_SECONDS, seconds: MP_VOTE_SECONDS,
    winner: null, resolved: null, mine: null, total: size, mods: r.mods, name: r.name, ranked: !!r.ranked, event: r.event ?? null,
    timer: setInterval(mpVoteTick, 1000),
  };
  // Graveyard Shift: the map this phone last played it on starts with this player's ballot, if it is on offer.
  const zmLast = tab === 'zombies' ? options.findIndex(o => o.mapId === Recall.get('zmMap')) : -1;
  if (zmLast >= 0) { app.vote.mine = zmLast; app.vote.votes.set('local', zmLast); }
  renderVote();
}

function mpVoteTick() {
  const vote = app.vote;
  if (!vote?.solo) return;
  vote.left--;
  const others = vote.total - 1, cast = vote.votes.size - (vote.mine !== null ? 1 : 0);
  const want = Math.round(others * Math.min(1, (vote.seconds - vote.left) / Math.max(1, vote.seconds - 2)));
  for (let k = cast; k < want; k++) vote.votes.set(`p${k}`, Math.floor(Math.random() * vote.options.length));
  if (vote.left > 0) { renderVote(); return; }
  clearInterval(vote.timer);
  vote.winner = tallyWinner(voteCounts(vote));
  vote.resolved = { mapId: vote.options[vote.winner].mapId, mode: vote.options[vote.winner].mode };
  vote.reveal = setTimeout(() => launchMp(vote.resolved.mapId, vote.resolved.mode, vote.mods, vote.ranked, vote.event), VOTE_REVEAL_MS);
  renderVote();
}

function launchMp(mapId, mode, mods = [], ranked = false, event = null) {
  stopVote();
  const id = 'local', seed = randomSeed();
  const humans = [{ id, name: myTagName(), team: 0, ...seatData() }];
  // Ranked looks for players near this player's rating (their SR once placed), in a narrower band, with no modifiers.
  const pool = poolFor(humans), rating = pool.target;
  if (ranked) Object.assign(pool, { target: rankedTarget(Progress.ranked(), rating), spread: RANKED_SPREAD });
  // ?bots= is a test hook; players always get the seam's default.
  const drawn = pickBotsForMatch({ humans, mode, mapId, seed, botSkill: params.get('bots') || MP_BOT_SKILL, pool });
  // Ranked: each pool bot wears the division of its SR on the Ranked board (docs/RANKED.md).
  const roster = ranked ? rankedBots(drawn, id => poolSr(id)) : drawn;
  beginMatch({
    roster: withBadges(roster, humans, seed), seed, mapId, mode, mods: ranked ? [] : cleanMods(mods, mode), ...limitsFor(mode),
    hostId: id, isHost: true, localId: id, ranked: ranked ? { rating } : null, event,
  });
}

// Ranked context for MatchAwards: the opposing side's average SR (bots by this match's rating, humans by the middle
// of their division) and this player's rating for placements.
function rankedContext(roster, localId, ctx) {
  const me = roster.find(r => r.id === localId);
  const them = roster.filter(r => r.team !== me?.team);
  const srs = them.map(r => (r.isBot || r.pool ? (r.rankSr >= 0 ? r.rankSr : ratingToSr(r.rating ?? 0.3)) : codeSr(cleanCode(r.badge?.rk)))).filter(v => Number.isFinite(v));
  return { lobby: srs.length ? Math.round(srs.reduce((a, b) => a + b, 0) / srs.length) : null, rating: ctx?.rating ?? poolFor([{ id: localId, badge: Progress.badge() }]).target };
}

// A friend room plays Ranked only when the host opts in and every seat is a human (RANKED_PARTY): no bots, a fixed
// ruleset, no custom settings or modifiers. Each phone moves its own player's rating.
function rankedRoom() {
  const hs = (app.lobby.humans ?? []).filter(h => !h.spec);
  return !!app.lobby.ranked && !app.lobby.custom && hs.length >= RANKED_PARTY && [0, 1].every(t => hs.filter(h => h.team === t).length === RANKED_PARTY / 2);
}
function setLobbyRanked(on) {
  if (!app.isHost || !app.net) return;
  app.lobby.ranked = !!on;
  broadcastLobby();
  renderLobby();
  if (on && !rankedRoom()) menu.toast(`Ranked rooms need all ${RANKED_PARTY} seats filled by players, ${RANKED_PARTY / 2} a side`, 'warn');
}

function resetToSolo() {
  teardownNet();
  stopRematch();
  stopVote();
  app.isHost = true;
  app.lobby = { humans: [], botSkill: app.lobby.botSkill || 'mixed', mods: [] };
  stopSearch();
}

function startRange() {
  resetToSolo();
  launchRange();
}

// The sim adds the dummies itself; the renderer still needs them on its roster to name and draw them.
function launchRange() {
  const id = 'local', seed = randomSeed();
  const humans = [{ id, name: myTagName(), team: 0, ...seatData() }];
  beginMatch({
    roster: withBadges(buildRoster(humans, { teamSize: 0, seed }), humans, seed),
    seed, mapId: 'range', mode: 'range', ...limitsFor('range'),
    hostId: id, isHost: true, localId: id, rangeDummies: rangeDummies(MAPS.range),
  });
}

// --- Tutorial: a guided practice match on Railyard (js/game/tutorial.js). Pays and records nothing. ---
function startTutorial() {
  Progress.setFlag('tutorialOffered');
  resetToSolo();
  const id = 'local', seed = randomSeed();
  const human = { id, name: myTagName(), team: 0, ...seatData() };
  const roster = withBadges(tutorialRoster(human), [human], seed);
  beginMatch({
    roster, seed, mapId: TUTORIAL_MAP, mode: TUTORIAL_MODE, ...TUTORIAL_LIMITS,
    hostId: id, isHost: true, localId: id, intro: false, tutorial: true,
  });
}

function finishTutorial(completed) {
  if (completed) Progress.setFlag('tutorialDone');
  endLocalMatch();
  goTitle();
  if (!completed) { menu.toast('Training is in How to play any time'); return; }
  menu.overlay(`
    <div class="sheet tut-offer tut-after">
      <div class="tut-offer-mark" aria-hidden="true">${ico('check')}</div>
      <div class="tut-offer-body">
        <span class="tut-offer-kick">Training complete</span>
        <h2>You are ready for the yard</h2>
        <p>Bots come in four skills. Daily challenges on the title pay extra XP for every match you play.</p>
        <div class="sheet-row">
          <button class="btn" data-act="tutMenu">${ico('ui:home')}<b>Menu</b></button>
          <button class="btn is-primary" data-sound="confirm" data-act="tutPlay">${ico('party')}<b>Multiplayer</b></button>
        </div>
      </div>
    </div>`);
  menu.on({ tutMenu: () => menu.overlay(''), tutPlay: () => { menu.overlay(''); needName(openMultiplayer); } });
}

// First run only, and never for anyone who has already played: a returning player is never held up by it.
function maybeOfferTutorial() {
  if (Progress.flag('tutorialOffered') || Progress.flag('tutorialDone') || Progress.totalXp > 0) return false;
  Progress.setFlag('tutorialOffered');
  menu.tutorialOffer({ onStart: () => startTutorial(), onSkip: () => menu.toast('Training is in How to play any time') });
  return true;
}

function renderSoloPick() {
  Recall.set('soloPick', { ...app.soloPick });
  menu.custom({ tab: 'match', pick: app.soloPick, lobby: app.customFrom === 'lobby' });
}

function pickSoloMap(mapId) {
  if (mapId !== RANDOM && !MAPS[mapId]) return;
  app.soloPick.mapId = mapId;
  if (!modeFits(MAPS[mapId], app.soloPick.mode)) app.soloPick.mode = mapId === RANDOM ? RANDOM : firstModeFor(MAPS[mapId]);
  renderSoloPick();
}

function pickSoloMode(mode) {
  if (!modeFits(MAPS[app.soloPick.mapId], mode)) return;
  app.soloPick.mode = mode;
  renderSoloPick();
}

// Rematch in solo: the same map and mode again at once; a half that was picked as Random rolls again.
// --- The co-op campaign (docs/CAMPAIGN.md): the Campaign tab's pick, solo with bots, or a friend room ---
// The pick: the last one this phone made, else the first mission not yet cleared.
function cpPickNow() {
  if (!app.cp) {
    const cp = Progress.campaign(), was = Recall.get('cpPick');
    const first = Math.max(0, MISSIONS.findIndex(m => !campaignCleared(cp, m.id)));
    app.cp = was && MISSIONS[was.k] ? { k: was.k | 0, diff: Math.max(0, Math.min(2, was.diff | 0)) } : { k: first, diff: 1 };
  }
  return app.cp;
}
function setCpPick(part, paint = true) {
  app.cp = { ...cpPickNow(), ...part };
  Recall.set('cpPick', app.cp);
  if (!paint) return;
  if (menu.el.dataset.screen === 'cpbrief') menu.campaignBrief(app.cp); else renderMp();
}
// After a mission: the next one once this one is cleared (and the next is open), else this one again.
function cpNext({ k, diff }) {
  const cp = Progress.campaign();
  return campaignCleared(cp, MISSIONS[k].id) && MISSIONS[k + 1] && missionOpen(cp, k + 1) ? { k: k + 1, diff } : { k, diff };
}

function launchCampaign(k, diff) {
  const m = MISSIONS[k];
  if (!m || !missionOpen(Progress.campaign(), k)) return;
  resetToSolo();
  app.lastPick = { cp: { k, diff } };
  const id = 'local', seed = randomSeed();
  const humans = [{ id, name: myTagName(), team: 0, ...seatData() }];
  const roster = buildRoster(humans, { botSkill: params.get('bots') || 'veteran', mode: 'cp', mapId: m.map, seed, pool: poolFor(humans) });
  beginMatch({
    roster: withBadges(roster, humans, seed), seed, mapId: m.map, mode: 'cp', mods: [],
    scoreLimit: cpCode(k, diff), timeLimit: MODES.cp.timeLimit, hostId: id, isHost: true, localId: id,
  });
}

// A friend room set to the mission: friends take the bots' seats (four at most).
function hostCampaign(k, diff) {
  const m = MISSIONS[k];
  if (!m || !missionOpen(Progress.campaign(), k)) return;
  resetToSolo();
  app.lastPick = { cp: { k, diff }, custom: true };
  startHosting({ custom: { mapId: m.map, mode: 'cp', mods: [], skill: 'veteran', bots: 0, players: null, scoreLimit: cpCode(k, diff), timeLimit: MODES.cp.timeLimit } });
}

function rematchSolo() {
  if (app.lastMode === 'range') return startRange();
  if (app.lastPick?.training) return needName(startTraining);
  if (app.lastPick?.tourney) return needName(openTourney);
  if (app.lastPick?.cp) { const n = cpNext(app.lastPick.cp); return needName(() => { setCpPick(n, false); menu.campaignBrief(cpPickNow()); }); }
  if (app.lastPick?.mp) return needName(() => findMatch(app.lastPick.mp.tab, app.lastPick.mp.sel));
  const pick = app.lastPick, last = app.lastPlayed;
  if (!pick && !last) return startSolo();
  // A Random half rolls fresh; a chosen half is replayed as chosen.
  const mapId = pick?.mapId === RANDOM ? RANDOM : last?.mapId ?? pick.mapId;
  const mode = pick?.mode === RANDOM ? RANDOM : last?.mode ?? pick.mode;
  needName(() => {
    resetToSolo();
    launchSolo(mapId, mode, pick?.mods ?? soloMods());
  });
}

// Today's featured playlist (js/shared/playlist.js), from the title: Multiplayer's featured playlist, matchmade.
function playFeatured() {
  findMatch('standard', { playlist: 'featured', modes: [] });
}

// Quick play: one tap from the title into Multiplayer, Standard, Quick Play.
function quickPlay() {
  findMatch('standard', { playlist: 'qp', modes: [] });
}

// The room's last winning card was Random: its next vote offers no fixed Rematch card, only fresh options and Random.
function isRandomPick(pick) {
  return !!pick && (pick.mapId === RANDOM || pick.mode === RANDOM);
}

// Either half may be RANDOM; this device is the host, so it rolls here.
// `mods` are the modifiers to play with: the picker's own unless a featured playlist brings its own.
function launchSolo(pickMap, pickMode, mods = soloMods()) {
  app.lastPick = { mapId: pickMap, mode: pickMode, mods };
  // Dev only: ?debug=1&map=<giant map>&mode=tdm plays a battle royale map under a team mode it does not list, to look
  // round it and test it before (or beside) its own mode.
  const devGiant = params.has('debug') && MAPS[pickMap]?.size === 'giant' && MODES[pickMode];
  const { mapId, mode } = devGiant ? { mapId: pickMap, mode: pickMode } : resolvePick({ mapId: pickMap, mode: pickMode });
  const id = 'local', seed = randomSeed();
  const humans = [{ id, name: myTagName(), team: 0, ...seatData() }];
  // The picker's bot match settings (js/ui/botsettings.js); ?bots= and the limit test hooks still win.
  const set = BotMatch.resolve(mode, MAPS[mapId]);
  const botSkill = params.get('bots') || set.skill;
  // Teams: `bots` on the enemy side, and your side fills around you to the same size. Free-for-all counts seats.
  // Bots come from the player pool; a difficulty other than Mixed holds every one of them at that tier.
  const roster = buildRoster(humans, { botSkill, mode, mapId, seed, teamSize: isFfa(mode) ? set.players : set.bots, pool: poolFor(humans) });
  beginMatch({
    roster: withBadges(roster, humans, seed),
    seed, mapId, mode, mods: cleanMods(mods, mode),
    scoreLimit: LIMIT_OVERRIDE || set.scoreLimit, timeLimit: TIME_OVERRIDE || set.timeLimit,
    hostId: id, isHost: true, localId: id,
  });
}

// --- Map vote: the host owns the timer and the tally, and every message is the whole vote, so it needs no repair ---
function stopVote() {
  clearInterval(app.vote?.timer);
  clearTimeout(app.vote?.reveal);
  clearTimeout(app.voteTakeover);
  app.vote = null;
}

function startVote() {
  if (!app.net || !app.isHost || app.vote) return;
  stopRematch();
  if (app.lobby.custom) return launchCustomRoom();
  const ranked = rankedRoom();
  app.vote = {
    key: `${app.code}:${Date.now()}`, options: ranked ? mpVoteOptions('standard', RANKED_RULES.modes, Math.random, { ranked: true }) : voteOptions(Math.random, isRandomPick(app.lastPick) ? null : app.lastPlayed), votes: new Map(), left: VOTE_SECONDS,
    seconds: VOTE_SECONDS, winner: null, resolved: null, mine: null,
    timer: setInterval(voteTick, 1000),
  };
  broadcastVote();
  renderVote();
}

function voteTick() {
  const vote = app.vote;
  if (!vote) return;
  vote.left--;
  if (vote.left > 0) {
    broadcastVote();
    renderVote();
    return;
  }
  clearInterval(vote.timer);
  vote.winner = tallyWinner(voteCounts(vote));
  // A Random winner is rolled once, here on the host, and the result is what everyone is shown and sent.
  app.lastPick = { ...vote.options[vote.winner] };
  vote.resolved = resolvePick(vote.options[vote.winner]);
  vote.resolved = { ...vote.resolved, mode: brMode(vote.resolved.mode, app.lobby.brSquad) };   // Quads, duos or solos.
  vote.reveal = setTimeout(() => {
    launchHostMatch(vote.resolved.mapId, vote.resolved.mode);
  }, VOTE_REVEAL_MS);
  broadcastVote();
  renderVote();
}

// One count per option, from the ballots still seated in the room.
function voteCounts(vote) {
  const counts = vote.options.map(() => 0);
  if (vote.solo) { for (const i of vote.votes.values()) counts[i]++; return counts; }
  for (const [id, i] of vote.votes) if (app.lobby.humans.some(h => h.id === id)) counts[i]++;
  return counts;
}

function broadcastVote() {
  const vote = app.vote;
  if (!vote || !app.net) return;
  app.net.sendLobby({ t: 'vote', key: vote.key, options: vote.options, counts: voteCounts(vote), left: vote.left, seconds: vote.seconds, winner: vote.winner, resolved: vote.resolved, total: app.lobby.humans.length, brSquad: app.lobby.brSquad ?? 4 });
}

function castVote(i) {
  const vote = app.vote;
  if (!vote || vote.winner !== null || !vote.options[i]) return;
  vote.mine = i;
  if (vote.solo) vote.votes.set('local', i);
  else if (app.isHost) {
    vote.votes.set(app.net.localId, i);
    broadcastVote();
  } else {
    app.net.sendLobby({ t: 'cast', i });
  }
  renderVote();
}

function renderVote() {
  const vote = app.vote;
  if (!vote) return;
  menu.vote({
    key: vote.key, options: vote.options, left: vote.left, seconds: vote.seconds, winner: vote.winner, resolved: vote.resolved ?? null, mine: vote.mine,
    counts: app.isHost ? voteCounts(vote) : vote.counts, total: vote.solo ? vote.total : app.isHost ? app.lobby.humans.length : vote.total,
    lobby: vote.solo ? { name: vote.name, size: vote.total } : null,
    // Multiplayer's own vote: the squad size is the playlist's (Quads, Duos, Solos), shown and fixed.
    brSquad: vote.solo ? MODES[vote.options[0]?.mode]?.squad ?? 4 : app.isHost ? app.lobby.brSquad ?? 4 : vote.brSquad ?? 4, isHost: app.isHost && !vote.solo,
  });
}

function showGuestVote(msg) {
  app.countdown = null;
  app.rematchWait = false;
  app.vote = { ...msg, mine: app.vote?.key === msg.key ? app.vote.mine : null };
  if (resultsFirst()) return;
  endLocalMatch();
  renderVote();
}

// A host can be back in the lobby and start the next vote while a guest is still in the end-of-match hold: the host
// skipped its own final kill, or its hold ran shorter. The vote used to end the guest's match on the spot, so that guest
// never saw results (and never banked the match's XP). Now the hold is cut short instead, results come up, and the vote
// takes over once they have had RESULTS_MIN_MS; the results screen's main button opens the vote before then.
// Returns true while the vote has to wait.
function resultsFirst() {
  const match = app.match;
  if (app.inMatch && match && match.endTimer >= 0) {
    match.endNow();   // Match ends a hold with a skipped final replay on its next frame.
    return true;
  }
  if (app.inMatch && match && match.interp.newest?.phase === 'ended') return true;   // Its hold begins this frame.
  if (menuShows('results') && performance.now() - app.resultsAt < RESULTS_MIN_MS) {
    voteBehindResults();
    return true;
  }
  return false;
}

function voteBehindResults() {
  if (!app.vote || app.isHost) return;
  menu.resultsNote(app.vote.winner === null ? 'The next vote is open' : 'Next match starting');
  clearTimeout(app.voteTakeover);
  app.voteTakeover = setTimeout(() => {
    if (app.vote && !app.isHost && menuShows('results')) renderVote();
  }, Math.max(0, RESULTS_MIN_MS - (performance.now() - app.resultsAt)));
}

// `custom` (a custom room): { botSkill, teamSize, scoreLimit, timeLimit } instead of the map vote's defaults.
function launchHostMatch(mapId, mode, custom = null) {
  const net = app.net;
  if (!net) return;
  stopVote();
  const { humans } = app.lobby;
  // Spectators (Watch) are left out of the roster; the start message reaches them all the same and they watch.
  const clean = humans.filter(h => !h.spec).map(({ id, name, team, primary, camo, loadout, badge }) => ({ id, name, team, primary, camo, loadout, badge }));
  const seed = randomSeed();
  const limits = limitsFor(mode);
  if (custom?.scoreLimit && !LIMIT_OVERRIDE) limits.scoreLimit = custom.scoreLimit;
  if (custom?.timeLimit && !TIME_OVERRIDE) limits.timeLimit = custom.timeLimit;
  const roster = custom
    ? buildRoster(clean, { botSkill: custom.botSkill, mode, mapId, seed, teamSize: custom.teamSize ?? null, pool: poolFor(clean) })
    : pickBotsForMatch({ humans: clean, mode, mapId, seed, pool: poolFor(clean) });
  const ranked = !custom && rankedRoom() && RANKED_RULES.modes.includes(mode);
  const payload = {
    t: 'start', seed, mapId, mode, mods: ranked ? [] : cleanMods(app.lobby.mods, mode), ...limits,
    roster: withBadges(roster, clean, seed), ...(ranked ? { ranked: true } : {}),
  };
  net.sendLobby(payload);
  beginMatch({ ...payload, hostId: net.localId, isHost: true, ranked: ranked ? {} : null });
}

function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

function beginMatch({ roster, seed, mapId, mode, mods = [], scoreLimit, timeLimit, hostId, isHost, localId, rejoin = false, rangeDummies: dummies = null, intro = !rejoin, tutorial = false, training = null, ranked = null, event = null, tourney = null }) {
  const net = app.net;
  const id = localId ?? net?.localId;
  replayView?.close();             // A rematch or a host's start can come while a replay plays: the match takes the canvas.
  if (helpVideo && helpVideo !== 'loading') helpVideo.close();
  app.inMatch = true;
  wakeLock.set(true);
  updater.paint();
  // Ask the browser to keep this site's storage (the save) from the first match on. Firefox would ask the player with a
  // dialog, so there it waits for the install guide. Answered once per session.
  if (browserName() !== 'firefox') requestPersist();
  app.dead.clear();
  app.lastMode = mode ?? 'tdm';
  app.lastPlayed = mode === 'range' ? null : { mapId, mode };
  if (isZm(mode) && !training) Recall.set('zmMap', mapId);
  app.matchInfo = { roster, seed, mapId, mode, mods, scoreLimit, timeLimit, training };
  if (net) rememberRoom(app.code);
  stopVote();
  net?.resetGameHandlers();

  backdrop.stop();
  menu.hide();
  menu.overlay('');
  hud.prepare({ mapId, scoreLimit, timeLimit, roster, mode, mods, localId: id, intro, training, title: tourney?.title ?? null });
  app.badges = new Map(roster.map(r => [r.id, r.badge ?? null]));
  hud.setVisible(true);
  hud.setMic(net?.room ? (app.voice?.shownState ?? 'off') : 'hidden', app.voice?.muted);
  updateVoiceTeam();
  // Callouts need someone to hear them: friends, or bots on your side. Not in training or on the range.
  quickChat.start({ net, roster, localId: id, mapId, mode, ffa: isFfa(mode), enabled: !tutorial && !training && mode !== 'range' });
  hud.finHud.prepare({ enabled: !tutorial, emotes: Progress.emotesOpen(), localId: id });     // Emote wheel, Finish button.
  if (!Progress.flag('aimHint') && !tutorial) {
    controls.showAimHint(true);
    Progress.setFlag('aimHint');
  }

  const renderer = app.renderer = new GameRenderer(canvas, MAPS[mapId]);
  renderer.resize();
  renderer.setQuality?.(Options.get('quality'));
  renderer.chars.setRoster(dummies ? [...roster, ...dummies] : roster);
  hud.setCamera(renderer.camera);
  app.match = new Match({
    canvas, mapId, mode, mods, seed, scoreLimit, timeLimit, roster, localId: id, hostId, isHost,
    net, controls, hud, renderer, audio, rejoin, training,
    onEnd: results => onMatchEnd(results),
  });
  // The interpolated view does not carry the map id; history and gun stats need it.
  app.match.awards.mapId = mapId;
  if (tutorial) app.match.chatter = null;      // The tutorial's bots keep quiet (js/sim/chatter.js).
  // Ranked (the Ranked playlist, or a full friend room the host made ranked): the rating moves at the end.
  if (ranked && !training && !tutorial) { try { app.match.awards.ranked = rankedContext(roster, id, ranked); } catch (err) { console.error('ranked', err); } }
  app.matchInfo.ranked = !!ranked;
  // The caster camera (docs/RANKED.md): out-of-play players may watch with it, except where seeing everyone would be
  // unfair (Ranked) or makes no sense (Training, the tutorial, the range).
  if (app.match.caster) {
    app.match.caster.canOpen = !ranked && !training && !tutorial && mode !== 'range';
    app.match.caster.title = `${MAPS[mapId]?.name ?? ''} · ${MODES[mode]?.name ?? ''}`;
  }
  // A weekend tournament round: the result moves this phone's run (js/game/awards.js).
  if (tourney && !training && !tutorial) app.match.awards.tourney = { key: tourney.key, round: tourney.round, cup: tourney.cup, opponent: tourney.opponent };
  app.matchInfo.tourney = tourney;
  // A weekly event's playlist (js/shared/events.js): its challenges and the small XP bonus at the end.
  if (event && !training && !tutorial) app.match.awards.event = event;
  app.match.telemetry.mapId = mapId;
  hud.onSetLoadout(loadout => app.match?.setNextLoadout(loadout));
  hud.onRespawn(msg => app.match?.requestRespawn(msg));
  hud.onBrCommand((act, extra) => app.match?.brCommand(act, extra));
  hud.onExCommand((act, extra) => app.match?.exCommand(act, extra));
  hud.onZmCommand((act, extra) => app.match?.zmCommand(act, extra));
  hud.onCpCommand((act, extra) => app.match?.cpCommand(act, extra));
  hud.onFinCommand((act, e) => (act === 'finish' ? app.match?.finish() : app.match?.emote(e)));
  hud.zmHud.guns = () => (app.match ? [app.match.ps.primary, app.match.ps.secondary] : []);
  hud.zmHud.hands = () => app.match?.ps ?? null;
  // A respawn before the player opens the picker should still use the equipped weapon (training keeps its own kit).
  app.match.setNextLoadout(tutorial ? roster.find(r => r.id === id).loadout : Progress.loadout());
  if (tutorial) {
    app.tutorial = new Tutorial({ match: app.match, root: uiRoot, audio, onFinish: done => finishTutorial(done) });
    app.tutorial.start();
  }
  app.match.start();
  modeTips.showWhen(() => app.match?.interp.newest?.phase === 'live' && !uiRoot.querySelector('.hud .intro.show'), mode, { enabled: !tutorial && !training && !rejoin && mode !== 'range' && (!params.has('debug') || params.get('tips') === '1') });

  clearInterval(app.netPoll);
  if (net) {
    const poll = () => hud.setNet({ rtt: net.rtt, status: net.status, isHost: net.isHost });
    poll();
    app.netPoll = setInterval(poll, NET_POLL_MS);
  } else {
    hud.setNet(null);
  }
}

function endLocalMatch() {
  if (!app.inMatch) return;
  app.match?.stop();
  app.match = null;
  app.tutorial?.dispose();
  app.tutorial = null;
  modeTips.hide();
  app.inMatch = false;
  app.matchInfo = null;
  clearInterval(app.netPoll);
  app.renderer?.dispose();
  app.renderer = null;
  quickChat.stop();
  hud.finHud.stop();
  hud.setVisible(false);
  controls.setEnabled(false);
  updateVoiceTeam();               // Back to party voice with the whole lobby.
}

function onMatchEnd(results) {
  const match = app.match;
  if (results.early) { showResults(results); return; }     // Left a battle royale early: no end banner, straight to results.
  // Training ran out of clock before it was done: it ends as a skip, with no results screen.
  if (app.tutorial) { finishTutorial(false); return; }
  // A guest can be pulled into the vote during this hold, and the old results must not land on top of it.
  let done = false;
  const show = () => {
    if (done || app.match !== match) return;
    done = true;
    showResults(results);
  };
  try { hud.showEnd(results, show); } catch (err) { console.error('end banner', err); show(); }
  // The banner's timer is the normal way in; this one makes sure no failure on the way can leave a finished match
  // frozen on screen with no results.
  setTimeout(show, RESULTS_FALLBACK_MS);
}

// Sorts by match score, and breaks ties in favour of kills, then fewer deaths.
function pickMvp(players) {
  let mvp = null;
  for (const p of players) {
    if (!mvp) { mvp = p; continue; }
    const diff = matchScore(p) - matchScore(mvp);
    if (diff > 0 || (diff === 0 && (p.kills > mvp.kills || (p.kills === mvp.kills && p.deaths < mvp.deaths)))) mvp = p;
  }
  return mvp;
}

// Battle royale, out of the match: Leave shows this phone's results now (js/ui/br-hud.js). Nobody else's match ends: a
// guest's phone just stops following it; a host with other people in the room keeps simulating it, drawing nothing,
// behind the results screen until it ends for them (Match.leaveNow headless), then lets it go.
function leaveBrEarly() {
  const m = app.match;
  if (!m || !app.inMatch || m.ended) return;
  const others = !!app.net && app.isHost && (app.lobby.humans?.length ?? 0) > 1;
  if (others) m.onLateEnd = () => { if (app.match === m) endLocalMatch(); };
  m.leaveNow({ headless: others });
}

// The player chose to walk away from a running match from the scoreboard.
function leaveMatch() {
  const practice = !!app.matchInfo?.training || app.lastMode === 'range';
  endLocalMatch();
  forgetRoom();
  goTitle();
  if (practice) { app.customTab = 'training'; renderCustom(); }     // Training and the range go back to Training.
}

function showResults(results) {
  try {
    for (const p of results.players) Object.assign(p, hud.objectiveStats(p.id));
  } catch (err) { console.error('objective stats', err); }
  if (app.match?.headless) { hud.setVisible(false); controls.setEnabled(false); }    // Still running for the room.
  else endLocalMatch();
  if (!app.net) wakeLock.set(false);
  forgetRoom();
  app.rematchWait = false;

  // Extraction: getting out is the win, whoever banked most.
  const won = results.ex ? !!results.ex.extracted : results.winner === results.myTeam;
  const drawn = !results.ex && !results.early && (results.winner === null || results.winner === undefined);    // Left early: a loss.
  const lastKill = results.lastKill;
  const killer = lastKill && results.players.find(p => p.id === lastKill.by);
  const victim = lastKill && results.players.find(p => p.id === lastKill.target);
  const counting = app.countdown !== null && !!app.net && !app.isHost;
  music.results(drawn ? 'draw' : won ? 'win' : 'loss');
  try {
    menu.results({
      outcome: drawn ? 'draw' : won ? 'win' : 'loss',
      mode: app.lastMode,
      modeId: results.modeId,
      mods: results.mods ?? [],
      scores: results.scores,
      myTeam: results.myTeam,
      localId: results.localId,
      roster: results.players,
      badges: app.badges,
      mvp: pickMvp(results.players.filter(p => !p.ai)),      // Extraction's AI patrols are no MVPs.
      // XP, level changes and unlocks were already applied to the save by MatchAwards.finish.
      xp: results.xp,
      level: results.level,
      weapons: results.weapons ?? [],
      // Finished challenges get their stamp in the reel first; `challenges` is everything that moved (js/ui/challenges.js).
      unlocks: [...tourneyUnlocks(results.tourney), ...seasonUnlocks(results.season, results.ranked), ...(results.challenges ?? []).filter(c => c.fresh).map(challengeUnlock), ...(results.unlocks ?? [])],
      challenges: results.challenges ?? [],
      proProgress: results.proProgress ?? [],
      finalKill: lastKill && !results.zm?.escaped ? { weapon: lastKill.weapon, camo: lastKill.camo, byName: killer?.name ?? '', targetName: victim?.name ?? '' } : null,
      ...rematchChoice(),
      snd: results.snd,
      br: results.br,
      ex: results.ex ?? null, exView: results.exView ?? null,
      zm: results.zm ?? null, zmView: results.zmView ?? null,
      cp: results.cp ?? null, cpView: results.cpView ?? null,
      early: !!results.early,
      practice: !!results.practice,
      mastery: results.mastery,
      season: results.season ?? null,
      ranked: results.ranked ?? null,
      note: counting ? `Rematch starts in ${app.countdown}` : '',
      replay: !!results.replay,
    }, { rematch: () => afterResults(), menu: () => goTitle(), replay: () => openReplay(results.replay) });
  } catch (err) {
    // Whatever broke, the screen with Rematch and Menu still comes up.
    console.error('results screen', err);
    menu.show();
  }
  app.resultsAt = performance.now();
  NewDots.refresh();               // The match may have unlocked something: the next screen scans again.
  shareCareer();
  voteBehindResults();
}

// Quick rematch: what the results screen's main button says, and under it what one tap queues. Solo Multiplayer searches
// the same playlist (the squad size is the playlist's); Custom replays its map and mode; in a friend room it is the
// host's call, so a guest's button readies them for it.
function rematchChoice() {
  const pick = app.lastPick, last = app.lastPlayed;
  const place = (mapId, mode) => [mapId === RANDOM ? 'Random map' : MAPS[mapId]?.name, mode === RANDOM ? 'Random mode' : MODES[mode]?.name].filter(Boolean).join(' · ');
  if (app.match?.headless) return { rematchLabel: 'Rematch', rematchSub: 'When your room\'s match ends' };
  if (app.net) {
    if (!app.isHost) return { rematchLabel: 'Ready', rematchSub: 'The host starts the next match' };
    if (pick?.tourney && pick.party) return { rematchLabel: 'Bracket', rematchSub: 'The weekend cup, with your room' };
    const n = app.lobby.humans.length;
    if (isCp(app.lobby.custom?.mode)) { const c = cpDecode(app.lobby.custom.scoreLimit), nx = cpNext(c); return { rematchLabel: nx.k !== c.k ? 'Next mission' : 'Retry mission', rematchSub: `${MISSIONS[nx.k].n}. ${MISSIONS[nx.k].name} · same room` }; }
    return { rematchLabel: 'Rematch', rematchSub: app.lobby.custom ? place(app.lobby.custom.mapId, app.lobby.custom.mode) || 'Same room' : `Same room · ${n} player${n === 1 ? '' : 's'} · map vote` };
  }
  if (app.lastMode === 'range') return { rematchLabel: 'Again', rematchSub: 'Firing range' };
  if (pick?.training) return { rematchLabel: 'Train again', rematchSub: MAPS[app.training.map]?.name ?? 'Training' };
  if (pick?.tourney) { let sub = ''; try { sub = tourneySpot().sub; } catch { /* the label alone */ } return { rematchLabel: 'Bracket', rematchSub: sub }; }
  if (pick?.cp) {
    const next = cpNext(pick.cp);
    return next.k !== pick.cp.k ? { rematchLabel: 'Next mission', rematchSub: `${MISSIONS[next.k].n}. ${MISSIONS[next.k].name}` } : { rematchLabel: 'Retry mission', rematchSub: `${MISSIONS[next.k].n}. ${MISSIONS[next.k].name}` };
  }
  if (pick?.mp) {
    let name = '';
    try { name = resolveSelection(pick.mp.tab, pick.mp.sel, { hardcore: !!Options.get('hardcore') }).name; } catch { /* the label alone */ }
    return { rematchLabel: 'Next match', rematchSub: name };
  }
  const mapId = pick?.mapId === RANDOM ? RANDOM : last?.mapId ?? pick?.mapId, mode = pick?.mode === RANDOM ? RANDOM : last?.mode ?? pick?.mode;
  return { rematchLabel: 'Rematch', rematchSub: place(mapId, mode) };
}

function afterResults() {
  if (app.match?.headless) { menu.toast('Your room is still playing. The next match comes when theirs ends.'); return; }
  if (!app.net) return rematchSolo();
  if (app.vote && !app.isHost) return renderVote();   // The host has already opened the next vote.
  const me = localHuman();
  if (app.isHost && app.lastPick?.tourney && app.lastPick.party) return openPartyTourney();
  if (app.isHost) {
    // A campaign room moves on to the next mission once this one is cleared (the host's progress decides).
    if (isCp(app.lobby.custom?.mode)) {
      const n = cpNext(cpDecode(app.lobby.custom.scoreLimit));
      app.lobby.custom = { ...app.lobby.custom, mapId: MISSIONS[n.k].map, scoreLimit: cpCode(n.k, n.diff) };
      broadcastLobby();
    }
    for (const h of app.lobby.humans) h.ready = !!h.host;
    startRematchCountdown();
    return;
  }
  // Guests who are not in the host's roster can't be seated; send them home rather than leave them waiting.
  if (!me) return goTitle('That room no longer has a seat for you.');
  me.ready = true;
  app.net.sendLobby({ t: 'ready', ready: true });
  app.rematchWait = true;
  renderLobby();
}

function applyOptions(v, changed) {
  if (changed === 'recall') return;     // Remembered menu picks: nothing to apply.
  controls.applyOptions({ sensitivity: v.sensitivity, lefty: v.lefty, autoSprint: v.autoSprint !== false });
  hud.setLefty(v.lefty);
  if (!changed || changed === 'hudSize') hud.setHudSize(v.hudSize);
  // Accessibility (docs/ACCESSIBILITY.md).
  if (!changed || changed === 'colorMode') applyPalette(v.colorMode);
  if (!changed || changed === 'calm') {
    setCalm(v.calm);
    setReducedMotion(v.calm ? true : null);
    document.documentElement.toggleAttribute('data-calm', v.calm);
  }
  if (!changed || changed === 'textSize') document.documentElement.dataset.text = v.textSize;
  if (!changed || changed === 'cues') hud.setCues(v.cues);
  if (!changed || changed === 'shotCues' || changed === 'captions') hud.setSoundAids({ shots: v.shotCues === true, captions: v.captions === true });
  if (!changed || changed === 'hudContrast') document.documentElement.toggleAttribute('data-hc', v.hudContrast === true);
  if (!changed || changed === 'layout' || changed === 'lefty' || changed === 'sensitivity') {
    controls.applyLayout(v.layout);
    hud.setChipScale(scaleOf(v.layout, 'chips'));
  }
  controls.aimAssist = v.aimAssist;
  if (!changed || changed === 'sound') audio.setVolume?.(v.sound);
  if (!changed || changed === 'music') audio.setMusicVolume?.(v.music);
  if (!changed || changed === 'matchMusic') music.setMatchMusic(v.matchMusic);
  if (!changed || changed === 'voice') app.voice?.setVolume(v.voice);
  if (!changed || changed === 'voiceMode') app.voice?.setMode(v.voiceMode);
  if (changed === 'quality') app.renderer?.setQuality?.(v.quality);
  backdrop.quality = v.quality;
  if (!changed || changed === 'fps') { perf.setVisible(v.fps || FPS_PARAM); hud.layout(); }
  if (!changed || changed === 'touchDebug') touchDebug.setEnabled(v.touchDebug || TOUCHDEBUG_PARAM);
  if (!changed || changed === 'touchRec') { touchRec.setEnabled(v.touchRec || TOUCHREC_PARAM); touchReport.sync(); }
}

// --- Startup ---
// Offered once to a phone player in a browser tab (any iPhone browser, Android Chrome, Samsung Internet and others):
// how to add the game for this browser, and where progress lives. The guide stays in How to play, Install tab.
function maybeInstallPrompt() {
  if (runningInstalled()) { requestPersist(); return; }
  if (platformKey() === 'desktop' || Progress.flag('installPrompt')) return;
  Progress.setFlag('installPrompt');
  installSheet(menu, { onMore: () => openHelp('install') });
}

// Controllers and the voice overlay need app, the HUD, the menu and quick chat.
gamepad = new GamepadInput({
  controls, hud, menu, quickChat,
  voice: () => app.voice,
  inMatch: () => !!app.inMatch && !!app.match,
  toast: text => (app.inMatch ? hud.notify(text) : menu.toast(text)),
});
voiceUi = new VoiceUI({ hud, voice: () => app.voice, nameOf: id => app.lobby.humans.find(h => h.id === id)?.name ?? app.matchInfo?.roster?.find(r => r.id === id)?.name ?? '' });

// Times every frame's script work for the Auto quality governor and the performance overlay.
installFrameClock();
const FPS_PARAM = params.get('fps') === '1';
const perf = new PerfOverlay(document.body, () => app.renderer?.getStats() ?? null);
const TOUCHDEBUG_PARAM = params.get('touchdebug') === '1';
const touchDebug = new TouchDebug(controls);
// Options > Controls > Record touches: the last 20 s of touches, frozen into a report code by Stick died? (js/ui/touchrec.js).
const TOUCHREC_PARAM = params.get('touchrec') === '1';
const touchRec = new TouchRecorder(controls, { build: BUILD });
const touchReport = new ReportSheet(touchRec);
touchReport.attachBoard(document.querySelector('.board-foot'));
followViewport();
blockIosGestures();
// Android: full screen and landscape lock in a tab, the back gesture walks the menus, the install worker.
installAndroid({
  menu,
  inMatch: () => !!app.inMatch,
  onMatchBack: () => hud.notify?.('Use the menu to leave the match'),
  onTitleBack: () => menu.toast('Back again to close Switchyard'),
});
installScrolling();
installTaps();
// One sound per tap, chosen by tap.js from the element (data-sound, back-ish actions, disabled controls).
setTapSound(kind => audio.uiSound?.(kind));
hud.onLeaveMatch(leaveMatch);
// What leaving the running match costs, for the scoreboard's Leave question (QoL).
hud.leaveText = () => {
  if (app.matchInfo?.training || app.lastMode === 'range') return 'Leave training? Nothing is lost: it pays and records nothing.';
  const lost = 'XP, challenge and weapon progress from this match are lost.';
  if (!app.net) return `Leave this match? ${lost}`;
  const others = app.lobby.humans.filter(h => h.id !== app.net.localId).length;
  if (app.isHost && others) return `Leave and hand over the room? Another player becomes host and the match goes on without you. ${lost}`;
  if (app.isHost) return `Leave this match? The room closes. ${lost}`;
  return `Leave the room? Your slot is held for a few minutes if you rejoin with code ${app.code}. ${lost}`;
};
hud.onBrLeave(leaveBrEarly);
// The interpolated view does not carry the range tracker, so the readout takes it from the newest snapshot.
hud.rangeSource = () => app.match?.interp.newest?.range ?? null;
hud.onRangeReset(() => app.match?.sim.applyCommand(app.match.localId, { cmd: 'rangeReset' }));
// Training and the range: a gun from the armory goes on at once (the sim respawns the player where they stand).
hud.onArmory?.(loadout => {
  const m = app.match;
  if (!m?.isPractice()) return;
  m.setNextLoadout(loadout);
  m.sim.applyCommand(m.localId, { cmd: 'trainSwap' });
});
// A touch that lands with the audio engine asleep must wake it even when the action would start sound itself.
Options.subscribe(applyOptions);
showTitle({ arrive: true });
NewDots.install(menu);
// Arriving by an invite link goes straight to the join; the training offer waits for the next visit to the title.
// Just after the progress reset's wipe, its notice comes first and the training offer follows it.
const offeredTutorial = !invite && (maybeResetNotice(menu, { then: maybeOfferTutorial }) || maybeOfferTutorial());
if (params.has('debug')) window.__game = { app, replay: () => replayView, clips: { listClips, loadClip, deleteClip, saveClip }, watchShared, wipe: WIPE, NewDots, updater, hud, controls, touchRec, touchReport, menu, Progress, Options, backdrop, quickChat, join: startJoining, tutorial: startTutorial, helpVideo: () => helpVideo, openHelpVideo, openHelp, modeTips, training: () => needName(startTraining), range: () => needName(startRange), gamepad, voiceUi };
if (invite) joinFromInvite(invite, { menu, needName, join: startJoining, enterCode: askCode });
else {
  if (!offeredTutorial) maybeEventBanner(menu, { fresh: Progress.totalXp === 0 });
  if (!offeredTutorial && !maybeShowWhatsNew(menu, { fresh: Progress.totalXp === 0 })) maybeInstallPrompt();
}


