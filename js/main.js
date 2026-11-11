// App flow: title, lobby, gunsmith, match, results. Owns the session (Net) and the match lifecycle.
import { Match } from './game/match.js';
import { GameRenderer } from './render/renderer.js';
import { AudioEngine } from './audio/audio.js';
import { buildRoster } from './sim/sim.js';
import { RANGE_MODE, rangeDummies } from './sim/range.js';
import { MAPS, DEFAULT_MAP } from './shared/map.js';
import { MODES, firstModeFor, isBr, isFfa, playersFor } from './shared/modes.js';
const BR_HUMANS = 8;           // Battle royale: up to eight people in a room, bots fill the rest of the 32 (docs/BR.md).
import { normalizeLoadout } from './shared/catalog.js';
import { TEAM_SIZE } from './shared/constants.js';
import { MAX_LEVEL, MAX_PRESTIGE } from './shared/progression.js';
import { Controls } from './ui/controls.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Progress, matchScore } from './ui/progress.js';
import { voteOptions, tallyWinner, modeFits, resolvePick, RANDOM } from './ui/vote.js';
import { brMode, cleanSquad } from './ui/br-squad.js';
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
import { installViewport, onViewport } from './ui/viewport.js';
import { wakeLock } from './ui/wakelock.js';
import { PerfOverlay } from './ui/perf.js';
import { TouchDebug } from './ui/touchdebug.js';
import { statsScreen } from './ui/stats.js';
import { installFrameClock } from './render/quality.js';
import { Tutorial, tutorialRoster, TUTORIAL_MAP, TUTORIAL_MODE, TUTORIAL_LIMITS } from './game/tutorial.js';
import { challengeUnlock } from './ui/challenges.js';
import { ico } from './ui/yard.js';
import { BotMatch, botMatchSheet } from './ui/botsettings.js';
import { QuickChat } from './ui/quickchat.js';
import { MenuBackdrop } from './ui/backdrop.js';
import { Updater, BUILD } from './ui/updater.js';

const GAME_NAME = 'Switchyard';
const DRAG_SLOP = 12;           // Pixels of travel before a touch stops being a possible tap.
const NET_POLL_MS = 1000;
const REMATCH_SECONDS = 15;
const VOTE_REVEAL_MS = 1700;
const RESULTS_MIN_MS = 6000;     // A guest's results stay up at least this long before a vote the host started takes over.
const REJOIN_MINUTES = 15;       // How long after dropping the title screen still offers the way back.
const EDIT_SCREENS = ['gunsmith', 'loadouts', 'operators', 'profile', 'save', 'keypad', 'options', 'help', 'stats', 'challenges', 'history'];   // A lobby update must not pull a guest out of these.
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

const limitsFor = mode => {
  const m = mode === 'range' ? RANGE_MODE : MODES[mode];
  return { scoreLimit: LIMIT_OVERRIDE || m.scoreLimit, timeLimit: TIME_OVERRIDE || m.timeLimit };
};

document.title = GAME_NAME;

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const controls = new Controls(uiRoot);
const hud = new HUD(uiRoot);
hud.bindControls(controls);
const menu = new Menu(uiRoot);
// "Update ready" on the title screen when the site has a newer build than this (often stale Home Screen) copy.
const updater = new Updater({ canShow: () => !app.inMatch && menu.el.dataset.screen === 'title' });
new MutationObserver(() => updater.paint()).observe(menu.el, { attributes: true, attributeFilter: ['data-screen'] });
wireInvite(menu, () => app.code);
const audio = new AudioEngine();
const quickChat = new QuickChat(hud, { audio });
const backdrop = new MenuBackdrop(canvas);

// Screens with a turntable of their own run a second WebGL context, so the yard holds still behind them; the rest
// keep it moving. Nothing of the backdrop exists while a match owns the canvas.
const STILL_SCREENS = new Set(['loadouts', 'gunsmith', 'operators', 'results']);
menu.onScreen = screen => {
  uiRoot.dataset.menu = screen;
  if (app.inMatch) return;
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
  soloPick: { mapId: DEFAULT_MAP, mode: 'tdm' },
  // The map and mode the last match was played on, as rolled. Rematch replays the halves that were chosen, and the
  // room's next vote offers it as a Rematch card unless the winning card was Random.
  lastPlayed: null,
  // The pick as chosen, before rolling. A Random half stays Random on Rematch, so each rematch rolls again.
  lastPick: null,
};
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
  const unlessField = e => { if (e.target.tagName !== 'TEXTAREA') e.preventDefault(); };
  document.addEventListener('selectstart', unlessField);
  document.addEventListener('contextmenu', unlessField);

  // Audio must start from a user gesture, and iOS can suspend it again after backgrounding.
  const unlock = () => audio.unlock();
  document.addEventListener('touchend', unlock, { passive: true });
  document.addEventListener('click', unlock, { passive: true });
}

function myName() {
  return Progress.name || 'Rookie';
}

function myLoadout() {
  return Progress.loadout();
}

// What every human carries in the lobby and into the roster.
function seatData() {
  const loadout = myLoadout();
  return { primary: loadout.primary, camo: loadout.camo, loadout, badge: Progress.badge() };
}

function goTitle(message) {
  wakeLock.set(false);
  teardownNet();
  stopRematch();
  stopVote();
  app.countdown = null;
  app.rematchWait = false;
  app.lobby = { humans: [], botSkill: 'mixed' };
  app.lastPlayed = null;
  app.lastPick = null;
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
  net?.leave();
}

// --- Title actions ---
menu.on({
  profile: () => openProfile(),
  saveCode: () => openSave(),
  options: () => openOptions(),
  stats: () => openStats(),
  help: () => openHelp(),
  challenges: () => menu.challenges({ onBack: afterEditing }),
  history: () => openHistory(),
  rejoin: () => { needName(() => startJoining(rejoinOffer()?.code ?? '')); },
  range: () => { needName(startRange); },
  solo: () => { startSolo(); },
  quickPlay: () => { needName(quickPlay); },
  host: () => { needName(startHosting); },
  join: () => { needName(askCode); },
  browse: () => openBrowse(),
  lobbyPublic: () => setPublic(!app.public),
  gunsmith: () => openGunsmith(),
  loadout: () => openLoadout(),
  operators: () => openOperators(),
  leaveLobby: () => goTitle(),
  toggleReady: () => toggleReady(),
  start: () => startVote(),
  voteCast: ({ i }) => castVote(Number(i)),
  voteLeave: () => goTitle(),
  soloBack: () => showTitle(),
  soloMap: ({ id }) => pickSoloMap(id),
  soloMode: ({ id }) => pickSoloMode(id),
  soloStart: () => launchSolo(app.soloPick.mapId, app.soloPick.mode),
  soloBots: () => botMatchSheet(menu, app.soloPick, { onChange: renderSoloPick }),
  botSkill: ({ skill }) => { app.lobby.botSkill = skill; broadcastLobby(); renderLobby(); },
  brSquad: ({ n }) => setBrSquad(n),
  moveTeam: ({ id }) => moveTeam(id),
});

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
  menu.gunsmith({ loadoutIndex, weapon, onBack, onChange: shareLoadout });
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

function openStats(back = afterEditing) {
  statsScreen(menu, { onBack: back });
}

function openHistory() {
  menu.history({ onBack: afterEditing, onStats: () => openStats(openHistory) });
}

function openHelp() {
  // Training is solo; from a lobby it would walk out of the room, so it is only offered from the title.
  menu.help({ onBack: afterEditing, onTutorial: app.net ? null : () => startTutorial() });
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
  menu.lobby({
    code: app.code, humans: app.lobby.humans, botSkill: app.lobby.botSkill, isHost: app.isHost,
    localId: app.net.localId, hostId: app.net.hostId,
    countdown: app.isHost ? (app.rematch?.left ?? null) : app.countdown,
    rematchWait: app.rematchWait,
    ffa: ffaRoom(),
    public: app.public,
    br: isBr(roomMode()), brSquad: app.lobby.brSquad ?? 4,
  });
}

// Battle royale squad size for the room (js/ui/br-squad.js): the host's call, shown on the lobby and the vote.
function setBrSquad(n) {
  if (!app.isHost || !app.net || app.vote?.winner != null) return;
  app.lobby.brSquad = cleanSquad(Number(n));
  broadcastLobby();
  if (app.vote) { broadcastVote(); renderVote(); } else if (menuShows('lobby')) renderLobby();
}

function broadcastLobby() {
  if (!app.isHost || !app.net) return;
  app.net.sendLobby({ t: 'state', humans: app.lobby.humans, botSkill: app.lobby.botSkill, brSquad: app.lobby.brSquad ?? 4, countdown: app.rematch?.left ?? null, public: app.public, build: BUILD });
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
  if (isBr(roomMode())) return BR_HUMANS;
  if (!ffaRoom()) return TEAM_SIZE * 2;
  const mapId = app.matchInfo?.mapId ?? app.lastPlayed?.mapId;
  return playersFor(roomMode(), MAPS[mapId] ?? null);
}

function teamOpen(team, except = null) {
  // A free-for-all has no sides (buildRoster deals everyone their own); only the room's size matters.
  if (ffaRoom()) return app.lobby.humans.filter(h => h.id !== except).length < roomCap();
  return app.lobby.humans.filter(h => h.team === team && h.id !== except).length < TEAM_SIZE;
}

function startHosting() {
  wakeLock.set(true);           // A host reading out the code should not watch the phone dim.
  const code = NetImpl.makeCode();
  const net = NetImpl.host(code, myName());
  app.net = net;
  app.code = code;
  app.isHost = true;
  app.lobby = {
    humans: [{ id: net.localId, name: myName(), team: 0, ready: true, host: true, ...seatData() }],
    botSkill: 'mixed',
  };
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
  const name = String(msg.name ?? '').slice(0, 12) || 'Player';
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
        guest = { id: from, name: String(msg.name).slice(0, 12), team: teamOpen(0) ? 0 : 1, ready: false, ...seatFrom(msg) };
        humans.push(guest);
      }
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
    case 'ready': if (guest) guest.ready = !!msg.ready; break;
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
  return { prestige: n(b?.prestige, MAX_PRESTIGE, 0), level: n(b?.level, MAX_LEVEL, 1) };
}

// Bots have no save to read, so their rank follows their skill; a little variety by seat keeps tables believable.
const BOT_LEVEL = { recruit: 4, regular: 14, veteran: 27, elite: 42 };
function withBadges(roster, humans, seed = 0) {
  return roster.map((r, i) => {
    const human = humans.find(h => h.id === r.id);
    // Bots take the whole roster in a seeded order that alternates women and men, so a squad is mixed and differs
    // between matches (js/ui/operators.js botOrder).
    const operator = human ? cleanOperator(human.loadout?.operator) : botOperator(seed, i);
    const badge = r.badge ?? (human ? cleanBadge(human.badge) : { prestige: 0, level: (BOT_LEVEL[r.skill] ?? 12) + (i * 3) % 7 });
    // The sim's loadout cleaning drops cosmetics it does not use; carry the player's skin and emblem across it.
    const looks = human ? { skin: human.loadout?.skin ?? null, emblem: human.loadout?.emblem ?? null } : {};
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
    net.sendLobby({ t: 'join', name: myName(), build: BUILD, ...seatData() });
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
      app.lobby.brSquad = cleanSquad(msg.brSquad);
      app.countdown = msg.countdown ?? null;
      app.public = !!msg.public;
      if (app.voice) updateVoiceTeam();
      if (menuShows('results')) menu.updateCountdown(app.countdown);
      else if (!app.inMatch && !app.vote && !EDIT_SCREENS.includes(menu.el.dataset.screen)) renderLobby();
      break;
    case 'vote':
      showGuestVote(msg);
      break;
    case 'start':
      // A guest that never left this match hears its own rejoin announcement after a brief drop.
      if (msg.rejoin && app.inMatch && app.matchInfo?.seed === msg.seed) break;
      // Normally the old match is long over; a guest whose final-kill hold outlasted the countdown is cut short here.
      endLocalMatch();
      app.countdown = null;
      app.rematchWait = false;
      beginMatch({
        roster: msg.roster, seed: msg.seed, mapId: msg.mapId, mode: msg.mode,
        scoreLimit: msg.scoreLimit, timeLimit: msg.timeLimit,
        hostId: app.net.hostId, isHost: false, rejoin: !!msg.rejoin,
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
}

function updateVoiceTeam() {
  const me = localHuman();
  if (!app.voice || !me) return;
  // A free-for-all has no squad: voice goes to every human in the room.
  const ffa = ffaRoom();
  app.voice.setTeammates(app.lobby.humans.filter(h => h.id !== me.id && (ffa || h.team === me.team)).map(h => h.id));
}

// --- Solo: a direct pick of map and mode ---
function startSolo() {
  needName(() => {
    resetToSolo();
    if (params.has('map') || params.has('mode')) launchSolo(params.get('map') || DEFAULT_MAP, params.get('mode') || 'tdm');
    else renderSoloPick();
  });
}

function resetToSolo() {
  teardownNet();
  stopRematch();
  stopVote();
  app.isHost = true;
  app.lobby = { humans: [], botSkill: app.lobby.botSkill || 'mixed' };
}

function startRange() {
  resetToSolo();
  launchRange();
}

// The sim adds the dummies itself; the renderer still needs them on its roster to name and draw them.
function launchRange() {
  const id = 'local', seed = randomSeed();
  const humans = [{ id, name: myName(), team: 0, ...seatData() }];
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
  const human = { id, name: myName(), team: 0, ...seatData() };
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
          <button class="btn is-primary" data-sound="confirm" data-act="tutPlay">${ico('bots')}<b>Play vs bots</b></button>
        </div>
      </div>
    </div>`);
  menu.on({ tutMenu: () => menu.overlay(''), tutPlay: () => { menu.overlay(''); startSolo(); } });
}

// First run only, and never for anyone who has already played: a returning player is never held up by it.
function maybeOfferTutorial() {
  if (Progress.flag('tutorialOffered') || Progress.flag('tutorialDone') || Progress.totalXp > 0) return false;
  Progress.setFlag('tutorialOffered');
  menu.tutorialOffer({ onStart: () => startTutorial(), onSkip: () => menu.toast('Training is in How to play any time') });
  return true;
}

function renderSoloPick() {
  menu.solo(app.soloPick);
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
function rematchSolo() {
  if (app.lastMode === 'range') return startRange();
  const pick = app.lastPick, last = app.lastPlayed;
  if (!pick && !last) return startSolo();
  // A Random half rolls fresh; a chosen half is replayed as chosen.
  const mapId = pick?.mapId === RANDOM ? RANDOM : last?.mapId ?? pick.mapId;
  const mode = pick?.mode === RANDOM ? RANDOM : last?.mode ?? pick.mode;
  needName(() => {
    resetToSolo();
    launchSolo(mapId, mode);
  });
}

// Quick play: one tap from the title or the picker, a random map and a random mode it can host.
function quickPlay() {
  resetToSolo();
  launchSolo(RANDOM, RANDOM);
}

// The room's last winning card was Random: its next vote offers no fixed Rematch card, only fresh options and Random.
function isRandomPick(pick) {
  return !!pick && (pick.mapId === RANDOM || pick.mode === RANDOM);
}

// Either half may be RANDOM; this device is the host, so it rolls here.
function launchSolo(pickMap, pickMode) {
  app.lastPick = { mapId: pickMap, mode: pickMode };
  // Dev only: ?debug=1&map=<giant map>&mode=tdm plays a battle royale map under a team mode it does not list, to look
  // round it and test it before (or beside) its own mode.
  const devGiant = params.has('debug') && MAPS[pickMap]?.size === 'giant' && MODES[pickMode];
  const { mapId, mode } = devGiant ? { mapId: pickMap, mode: pickMode } : resolvePick({ mapId: pickMap, mode: pickMode });
  const id = 'local', seed = randomSeed();
  const humans = [{ id, name: myName(), team: 0, ...seatData() }];
  // The picker's bot match settings (js/ui/botsettings.js); ?bots= and the limit test hooks still win.
  const set = BotMatch.resolve(mode, MAPS[mapId]);
  const botSkill = params.get('bots') || set.skill;
  // Teams: `bots` on the enemy side, and your side fills around you to the same size. Free-for-all counts seats.
  const roster = buildRoster(humans, { botSkill, mode, mapId, seed, teamSize: isFfa(mode) ? set.players : set.bots });
  beginMatch({
    roster: withBadges(roster, humans, seed),
    seed, mapId, mode,
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
  app.vote = {
    key: `${app.code}:${Date.now()}`, options: voteOptions(Math.random, isRandomPick(app.lastPick) ? null : app.lastPlayed), votes: new Map(), left: VOTE_SECONDS,
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
  if (app.isHost) {
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
    counts: app.isHost ? voteCounts(vote) : vote.counts, total: app.isHost ? app.lobby.humans.length : vote.total,
    brSquad: app.isHost ? app.lobby.brSquad ?? 4 : vote.brSquad ?? 4, isHost: app.isHost,
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

function launchHostMatch(mapId, mode) {
  const net = app.net;
  if (!net) return;
  stopVote();
  const { humans, botSkill } = app.lobby;
  const clean = humans.map(({ id, name, team, primary, camo, loadout, badge }) => ({ id, name, team, primary, camo, loadout, badge }));
  const seed = randomSeed();
  const payload = {
    t: 'start', seed, mapId, mode, ...limitsFor(mode),
    roster: withBadges(buildRoster(clean, { botSkill, mode, mapId, seed }), clean, seed),
  };
  net.sendLobby(payload);
  beginMatch({ ...payload, hostId: net.localId, isHost: true });
}

function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

function beginMatch({ roster, seed, mapId, mode, scoreLimit, timeLimit, hostId, isHost, localId, rejoin = false, rangeDummies: dummies = null, intro = !rejoin, tutorial = false }) {
  const net = app.net;
  const id = localId ?? net?.localId;
  app.inMatch = true;
  wakeLock.set(true);
  updater.paint();
  app.dead.clear();
  app.lastMode = mode ?? 'tdm';
  app.lastPlayed = mode === 'range' ? null : { mapId, mode };
  app.matchInfo = { roster, seed, mapId, mode, scoreLimit, timeLimit };
  if (net) rememberRoom(app.code);
  stopVote();
  net?.resetGameHandlers();

  backdrop.stop();
  menu.hide();
  menu.overlay('');
  hud.prepare({ mapId, scoreLimit, timeLimit, roster, mode, localId: id, intro });
  app.badges = new Map(roster.map(r => [r.id, r.badge ?? null]));
  hud.setVisible(true);
  hud.setMic(net?.room ? (app.voice?.state ?? 'off') : 'hidden', app.voice?.muted);
  updateVoiceTeam();
  // Callouts need someone to hear them: friends, or bots on your side. Not in training or on the range.
  quickChat.start({ net, roster, localId: id, mapId, mode, ffa: isFfa(mode), enabled: !tutorial && mode !== 'range' });
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
    canvas, mapId, mode, seed, scoreLimit, timeLimit, roster, localId: id, hostId, isHost,
    net, controls, hud, renderer, audio, rejoin,
    onEnd: results => onMatchEnd(results),
  });
  // The interpolated view does not carry the map id; history and gun stats need it.
  app.match.awards.mapId = mapId;
  app.match.telemetry.mapId = mapId;
  hud.onSetLoadout(loadout => app.match?.setNextLoadout(loadout));
  hud.onRespawn(msg => app.match?.requestRespawn(msg));
  hud.onBrCommand((act, extra) => app.match?.brCommand(act, extra));
  // A respawn before the player opens the picker should still use the equipped weapon (training keeps its own kit).
  app.match.setNextLoadout(tutorial ? roster.find(r => r.id === id).loadout : Progress.loadout());
  if (tutorial) {
    app.tutorial = new Tutorial({ match: app.match, root: uiRoot, audio, onFinish: done => finishTutorial(done) });
    app.tutorial.start();
  }
  app.match.start();

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
  app.inMatch = false;
  app.matchInfo = null;
  clearInterval(app.netPoll);
  app.renderer?.dispose();
  app.renderer = null;
  quickChat.stop();
  hud.setVisible(false);
  controls.setEnabled(false);
}

function onMatchEnd(results) {
  const match = app.match;
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

// The player chose to walk away from a running match from the scoreboard.
function leaveMatch() {
  endLocalMatch();
  forgetRoom();
  goTitle();
}

function showResults(results) {
  try {
    for (const p of results.players) Object.assign(p, hud.objectiveStats(p.id));
  } catch (err) { console.error('objective stats', err); }
  endLocalMatch();
  if (!app.net) wakeLock.set(false);
  forgetRoom();
  app.rematchWait = false;

  const won = results.winner === results.myTeam;
  const drawn = results.winner === null || results.winner === undefined;
  const lastKill = results.lastKill;
  const killer = lastKill && results.players.find(p => p.id === lastKill.by);
  const victim = lastKill && results.players.find(p => p.id === lastKill.target);
  const counting = app.countdown !== null && !!app.net && !app.isHost;
  try {
    menu.results({
      outcome: drawn ? 'draw' : won ? 'win' : 'loss',
      mode: app.lastMode,
      modeId: results.modeId,
      scores: results.scores,
      myTeam: results.myTeam,
      localId: results.localId,
      roster: results.players,
      badges: app.badges,
      mvp: pickMvp(results.players),
      // XP, level changes and unlocks were already applied to the save by MatchAwards.finish.
      xp: results.xp,
      level: results.level,
      weapons: results.weapons ?? [],
      // Finished challenges get their stamp in the reel first; `challenges` is everything that moved (js/ui/challenges.js).
      unlocks: [...(results.challenges ?? []).filter(c => c.fresh).map(challengeUnlock), ...(results.unlocks ?? [])],
      challenges: results.challenges ?? [],
      proProgress: results.proProgress ?? [],
      finalKill: lastKill ? { weapon: lastKill.weapon, camo: lastKill.camo, byName: killer?.name ?? '', targetName: victim?.name ?? '' } : null,
      rematchLabel: 'Rematch',
      snd: results.snd,
      br: results.br,
      mastery: results.mastery,
      note: counting ? `Rematch starts in ${app.countdown}` : '',
    }, { rematch: () => afterResults(), menu: () => goTitle() });
  } catch (err) {
    // Whatever broke, the screen with Rematch and Menu still comes up.
    console.error('results screen', err);
    menu.show();
  }
  app.resultsAt = performance.now();
  voteBehindResults();
}

function afterResults() {
  if (!app.net) return rematchSolo();
  if (app.vote && !app.isHost) return renderVote();   // The host has already opened the next vote.
  const me = localHuman();
  if (app.isHost) {
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
  controls.applyOptions({ sensitivity: v.sensitivity, lefty: v.lefty });
  hud.setLefty(v.lefty);
  controls.aimAssist = v.aimAssist;
  if (!changed || changed === 'sound') audio.setVolume?.(v.sound);
  if (!changed || changed === 'music') audio.setMusicVolume?.(v.music);
  if (!changed || changed === 'voice') app.voice?.setVolume(v.voice);
  if (changed === 'quality') app.renderer?.setQuality?.(v.quality);
  backdrop.quality = v.quality;
  if (!changed || changed === 'fps') perf.setVisible(v.fps || FPS_PARAM);
  if (!changed || changed === 'touchDebug') touchDebug.setEnabled(v.touchDebug || TOUCHDEBUG_PARAM);
}

// --- Startup ---
function maybeInstallPrompt() {
  const ua = navigator.userAgent;
  const iOSSafari = /iP(hone|od|ad)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!iOSSafari || standalone || Progress.flag('installPrompt')) return;
  Progress.setFlag('installPrompt');
  menu.installPrompt(() => {});
}

// Times every frame's script work for the Auto quality governor and the performance overlay.
installFrameClock();
const FPS_PARAM = params.get('fps') === '1';
const perf = new PerfOverlay(document.body, () => app.renderer?.getStats() ?? null);
const TOUCHDEBUG_PARAM = params.get('touchdebug') === '1';
const touchDebug = new TouchDebug(controls);
followViewport();
blockIosGestures();
installScrolling();
installTaps();
// One sound per tap, chosen by tap.js from the element (data-sound, back-ish actions, disabled controls).
setTapSound(kind => audio.uiSound?.(kind));
hud.onLeaveMatch(leaveMatch);
// The interpolated view does not carry the range tracker, so the readout takes it from the newest snapshot.
hud.rangeSource = () => app.match?.interp.newest?.range ?? null;
hud.onRangeReset(() => app.match?.sim.applyCommand(app.match.localId, { cmd: 'rangeReset' }));
// A touch that lands with the audio engine asleep must wake it even when the action would start sound itself.
Options.subscribe(applyOptions);
showTitle({ arrive: true });
// Arriving by an invite link goes straight to the join; the training offer waits for the next visit to the title.
const offeredTutorial = !invite && maybeOfferTutorial();
if (params.has('debug')) window.__game = { app, updater, hud, controls, menu, Progress, backdrop, quickChat, join: startJoining, tutorial: startTutorial };
if (invite) joinFromInvite(invite, { menu, needName, join: startJoining, enterCode: askCode });
else if (!offeredTutorial) maybeInstallPrompt();


