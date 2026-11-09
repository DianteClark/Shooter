// App flow: title, lobby, gunsmith, match, results. Owns the session (Net) and the match lifecycle.
import { Match } from './game/match.js';
import { GameRenderer } from './render/renderer.js';
import { AudioEngine } from './audio/audio.js';
import { buildRoster } from './sim/sim.js';
import { RANGE_MODE, rangeDummies } from './sim/range.js';
import { MAPS, DEFAULT_MAP } from './shared/map.js';
import { MODES } from './shared/modes.js';
import { normalizeLoadout } from './shared/catalog.js';
import { TEAM_SIZE } from './shared/constants.js';
import { MAX_LEVEL, MAX_PRESTIGE } from './shared/progression.js';
import { Controls } from './ui/controls.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Progress, matchScore } from './ui/progress.js';
import { voteOptions, tallyWinner, modeFits } from './ui/vote.js';
import { OPERATOR_IDS, cleanOperator } from './ui/operators.js';
import { Net } from './net/net.js';
import { LocalNet } from './net/local.js';
import { Voice } from './net/voice.js';
import { installTaps } from './ui/tap.js';
import { Options } from './ui/options.js';
import { installViewport, onViewport } from './ui/viewport.js';
import { wakeLock } from './ui/wakelock.js';

const GAME_NAME = 'Switchyard';
const DRAG_SLOP = 12;           // Pixels of travel before a touch stops being a possible tap.
const NET_POLL_MS = 1000;
const REMATCH_SECONDS = 15;
const VOTE_REVEAL_MS = 1700;
const REJOIN_MINUTES = 15;       // How long after dropping the title screen still offers the way back.
const EDIT_SCREENS = ['gunsmith', 'loadouts', 'operators', 'profile', 'save', 'keypad', 'options', 'help'];   // A lobby update must not pull a guest out of these.
const LAST_ROOM = 'switchyard-last-room';
const params = new URLSearchParams(location.search);
const NetImpl = params.get('net') === 'local' ? LocalNet : Net;
// Test hooks: ?limit=N shortens a match, ?vote=N shortens the vote, and ?map=&mode= skip the solo picker.
const LIMIT_OVERRIDE = Number(params.get('limit')) || 0;
const VOTE_SECONDS = Number(params.get('vote')) || 10;

const limitsFor = mode => {
  const m = mode === 'range' ? RANGE_MODE : MODES[mode];
  return { scoreLimit: LIMIT_OVERRIDE || m.scoreLimit, timeLimit: m.timeLimit };
};

document.title = GAME_NAME;

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const controls = new Controls(uiRoot);
const hud = new HUD(uiRoot);
hud.bindControls(controls);
const menu = new Menu(uiRoot);
const audio = new AudioEngine();

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
  matchInfo: null,          // The current match's start message, so a returning player can be sent it again.
  rematch: null,            // Host only: { left, timer } while the auto-start countdown runs.
  countdown: null,          // Seconds left in the rematch countdown as last announced; null when none.
  rematchWait: false,       // Guest pressed Rematch and is waiting for the host to do the same.
  vote: null,               // { key, options, votes (host) or counts (guest), left, winner, mine }
  soloPick: { mapId: DEFAULT_MAP, mode: 'tdm' },
};

// The canvas size, the HUD's numbers and the touch rectangles are all derived from the visible area.
function followViewport() {
  installViewport();
  onViewport(() => {
    app.renderer?.resize();
    controls.remeasure();
    hud.remeasure();
  });
}

function blockIosGestures() {
  const stop = e => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  // Nothing in the app scrolls, so a real drag must never rubber-band Safari's page. A touch only counts as a drag
  // past the tap slop: default-preventing the small moves inside a tap is exactly what makes iOS drop the click.
  // The save code boxes are the exception, because they need to scroll and take selection and paste.
  const startAt = new Map();
  document.addEventListener('touchstart', e => { for (const t of e.changedTouches) startAt.set(t.identifier, [t.clientX, t.clientY]); }, { passive: true, capture: true });
  const forget = e => { for (const t of e.changedTouches) startAt.delete(t.identifier); };
  document.addEventListener('touchend', forget, { passive: true, capture: true });
  document.addEventListener('touchcancel', forget, { passive: true, capture: true });
  document.addEventListener('touchmove', e => {
    if (e.target.tagName === 'TEXTAREA' || !e.cancelable) return;
    for (const t of e.changedTouches) {
      const at = startAt.get(t.identifier);
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
  help: () => openHelp(),
  rejoin: () => { needName(() => startJoining(rejoinOffer()?.code ?? '')); },
  range: () => { needName(startRange); },
  solo: () => { startSolo(); },
  host: () => { needName(startHosting); },
  join: () => { needName(askCode); },
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
  botSkill: ({ skill }) => { app.lobby.botSkill = skill; broadcastLobby(); renderLobby(); },
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
  menu.options({ onBack: afterEditing, onPreviewSound: () => audio.uiClick?.() });
}

function openHelp() {
  menu.help({ onBack: afterEditing });
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
  });
}

function broadcastLobby() {
  if (!app.isHost || !app.net) return;
  app.net.sendLobby({ t: 'state', humans: app.lobby.humans, botSkill: app.lobby.botSkill, countdown: app.rematch?.left ?? null });
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

function teamOpen(team, except = null) {
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
  return !!app.matchInfo?.roster.some(r => r.id === id && !r.isBot);
}

function seatReturningPlayer(id) {
  if (!app.net || !holdsSlot(id)) return false;
  app.dead.delete(id);
  const entry = app.matchInfo.roster.find(r => r.id === id);
  if (!app.lobby.humans.some(h => h.id === id)) {
    app.lobby.humans.push({ id, name: entry.name, team: entry.team, ready: true, primary: entry.primary, camo: entry.camo, loadout: entry.loadout, badge: entry.badge });
  }
  app.match?.humanRejoined?.(id);
  app.net.sendLobby({ ...app.matchInfo, t: 'start', rejoin: true }, id);
  hud.notify(`${entry.name} is back`);
  broadcastLobby();
  return true;
}

function hostLobbyMessage(msg, from) {
  const humans = app.lobby.humans;
  let guest = humans.find(h => h.id === from);
  switch (msg.t) {
    case 'join': {
      if (app.inMatch) {
        if (seatReturningPlayer(from)) return;
        app.net.sendLobby({ t: 'refused', reason: 'That match is already under way. Ask the host to finish first.' }, from);
        return;
      }
      if (!guest) {
        if (humans.length >= TEAM_SIZE * 2) {
          app.net.sendLobby({ t: 'refused', reason: 'That room is full.' }, from);
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
    // Bots walk through the operator list from a seed-chosen start, so a squad is mixed and differs between matches.
    const operator = human ? cleanOperator(human.loadout?.operator) : OPERATOR_IDS[(i + seed) % OPERATOR_IDS.length];
    const badge = r.badge ?? (human ? cleanBadge(human.badge) : { prestige: 0, level: (BOT_LEVEL[r.skill] ?? 12) + (i * 3) % 7 });
    return { ...r, badge, operator, loadout: { ...r.loadout, operator } };
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
    if (h) hud.notify(`${h.name} dropped, a bot took over`);
  } else {
    broadcastLobby();
    if (menuShows('lobby')) renderLobby();
  }
}

function moveTeam(id) {
  const humans = app.lobby.humans, h = humans.find(x => x.id === id);
  if (!h) return;
  const next = 1 - h.team;
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
    net.sendLobby({ t: 'join', name: myName(), ...seatData() });
  });
  net.onJoinFailed(() => {
    teardownNet();
    forgetRoom();
    menu.notFound(code, { retry: () => startJoining(code), back: () => goTitle() });
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
      app.lobby.humans = msg.humans;
      app.lobby.botSkill = msg.botSkill;
      app.countdown = msg.countdown ?? null;
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
    case 'refused':
      forgetRoom();
      goTitle(msg.reason);
      break;
    default:
      break;
  }
}

const HOST_LOST_TEXT = 'Host lost, switching over';

function setHostNotice(on) {
  if (app.inMatch) hud.setNotice(on ? HOST_LOST_TEXT : '');
  else if (menuShows('results')) (on ? menu.resultsNote(HOST_LOST_TEXT) : menu.updateCountdown(app.countdown));
  else if (on) menu.overlay(`<div class="sheet slim"><div class="signal"><i></i><i></i><i></i></div><h2>Host lost</h2><p>Finding a new host. Hang on a moment.</p></div>`);
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
  app.voice.setTeammates(app.lobby.humans.filter(h => h.team === me.team && h.id !== me.id).map(h => h.id));
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
    roster: withBadges(buildRoster(humans, { teamSize: 0 }), humans, seed),
    seed, mapId: 'range', mode: 'range', ...limitsFor('range'),
    hostId: id, isHost: true, localId: id, rangeDummies: rangeDummies(MAPS.range),
  });
}

function renderSoloPick() {
  menu.solo(app.soloPick);
}

function pickSoloMap(mapId) {
  app.soloPick.mapId = mapId;
  if (!modeFits(MAPS[mapId], app.soloPick.mode)) app.soloPick.mode = 'tdm';
  renderSoloPick();
}

function pickSoloMode(mode) {
  if (!modeFits(MAPS[app.soloPick.mapId], mode)) return;
  app.soloPick.mode = mode;
  renderSoloPick();
}

function launchSolo(mapId, mode) {
  const id = 'local', seed = randomSeed();
  const humans = [{ id, name: myName(), team: 0, ...seatData() }];
  beginMatch({
    roster: withBadges(buildRoster(humans, { botSkill: params.get('bots') || 'mixed', teamSize: TEAM_SIZE, mode, mapId }), humans, seed),
    seed, mapId, mode, ...limitsFor(mode),
    hostId: id, isHost: true, localId: id,
  });
}

// --- Map vote: the host owns the timer and the tally, and every message is the whole vote, so it needs no repair ---
function stopVote() {
  clearInterval(app.vote?.timer);
  clearTimeout(app.vote?.reveal);
  app.vote = null;
}

function startVote() {
  if (!app.net || !app.isHost || app.vote) return;
  stopRematch();
  app.vote = {
    key: `${app.code}:${Date.now()}`, options: voteOptions(), votes: new Map(), left: VOTE_SECONDS,
    seconds: VOTE_SECONDS, winner: null, mine: null,
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
  vote.reveal = setTimeout(() => {
    const pick = vote.options[vote.winner];
    launchHostMatch(pick.mapId, pick.mode);
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
  app.net.sendLobby({ t: 'vote', key: vote.key, options: vote.options, counts: voteCounts(vote), left: vote.left, seconds: vote.seconds, winner: vote.winner, total: app.lobby.humans.length });
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
    key: vote.key, options: vote.options, left: vote.left, seconds: vote.seconds, winner: vote.winner, mine: vote.mine,
    counts: app.isHost ? voteCounts(vote) : vote.counts, total: app.isHost ? app.lobby.humans.length : vote.total,
  });
}

function showGuestVote(msg) {
  // Same reasons as the 'start' case: a guest may still be on results or in the end-of-match hold.
  endLocalMatch();
  app.countdown = null;
  app.rematchWait = false;
  app.vote = { ...msg, mine: app.vote?.key === msg.key ? app.vote.mine : null };
  renderVote();
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
    roster: withBadges(buildRoster(clean, { botSkill, teamSize: TEAM_SIZE, mode, mapId }), clean, seed),
  };
  net.sendLobby(payload);
  beginMatch({ ...payload, hostId: net.localId, isHost: true });
}

function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

function beginMatch({ roster, seed, mapId, mode, scoreLimit, timeLimit, hostId, isHost, localId, rejoin = false, rangeDummies: dummies = null }) {
  const net = app.net;
  const id = localId ?? net?.localId;
  app.inMatch = true;
  wakeLock.set(true);
  app.dead.clear();
  app.lastMode = mode ?? 'tdm';
  app.matchInfo = { roster, seed, mapId, mode, scoreLimit, timeLimit };
  if (net) rememberRoom(app.code);
  stopVote();
  net?.resetGameHandlers();

  menu.hide();
  menu.overlay('');
  hud.prepare({ mapId, scoreLimit, timeLimit, roster, mode, localId: id, intro: !rejoin });
  app.badges = new Map(roster.map(r => [r.id, r.badge ?? null]));
  hud.setVisible(true);
  hud.setMic(net?.room ? (app.voice?.state ?? 'off') : 'hidden', app.voice?.muted);
  updateVoiceTeam();
  if (!Progress.flag('aimHint')) {
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
  hud.onSetLoadout(loadout => app.match?.setNextLoadout(loadout));
  // A respawn before the player opens the picker should still use the equipped weapon.
  app.match.setNextLoadout(Progress.loadout());
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
  app.inMatch = false;
  app.matchInfo = null;
  clearInterval(app.netPoll);
  app.renderer?.dispose();
  app.renderer = null;
  hud.setVisible(false);
  controls.setEnabled(false);
}

function onMatchEnd(results) {
  const match = app.match;
  // A guest can be pulled into the vote during this hold, and the old results must not land on top of it.
  hud.showEnd(results, () => { if (app.match === match) showResults(results); });
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
  for (const p of results.players) Object.assign(p, hud.objectiveStats(p.id));
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
  menu.results({
    outcome: drawn ? 'draw' : won ? 'win' : 'loss',
    mode: app.lastMode,
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
    unlocks: results.unlocks ?? [],
    finalKill: lastKill ? { weapon: lastKill.weapon, camo: lastKill.camo, byName: killer?.name ?? '', targetName: victim?.name ?? '' } : null,
    rematchLabel: 'Rematch',
    note: counting ? `Rematch starts in ${app.countdown}` : '',
  }, { rematch: () => afterResults(), menu: () => goTitle() });
}

function afterResults() {
  if (!app.net) return startSolo();
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

followViewport();
blockIosGestures();
installTaps();
hud.onLeaveMatch(leaveMatch);
// The interpolated view does not carry the range tracker, so the readout takes it from the newest snapshot.
hud.rangeSource = () => app.match?.interp.newest?.range ?? null;
hud.onRangeReset(() => app.match?.sim.applyCommand(app.match.localId, { cmd: 'rangeReset' }));
// A touch that lands with the audio engine asleep must wake it even when the action would start sound itself.
Options.subscribe(applyOptions);
showTitle({ arrive: true });
if (params.has('debug')) window.__game = { app, hud, controls, menu, Progress, join: startJoining };
maybeInstallPrompt();


