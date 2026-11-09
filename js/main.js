// App flow: title, lobby, gunsmith, match, results. Owns the session (Net) and the match lifecycle.
import { Match } from './game/match.js';
import { GameRenderer } from './render/renderer.js';
import { AudioEngine } from './audio/audio.js';
import { buildRoster } from './sim/sim.js';
import { MAPS, DEFAULT_MAP } from './shared/map.js';
import { WEAPONS } from './shared/weapons.js';
import { CAMOS, getCamo } from './shared/camos.js';
import { normalizeLoadout } from './shared/catalog.js';
import { TEAM_SIZE, SCORE_LIMIT, TIME_LIMIT } from './shared/constants.js';
import { Controls } from './ui/controls.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Progress, matchScore } from './ui/progress.js';
import { Net } from './net/net.js';
import { LocalNet } from './net/local.js';
import { Voice } from './net/voice.js';

const GAME_NAME = 'Switchyard';
const NET_POLL_MS = 1000;
const REMATCH_SECONDS = 15;
const XP = { kill: 100, headshot: 25, assist: 50, win: 500, played: 200 };
const params = new URLSearchParams(location.search);
const NetImpl = params.get('net') === 'local' ? LocalNet : Net;
// Test hook: ?limit=N shortens a match. Without the parameter normal rules apply.
const SCORE = Number(params.get('limit')) || SCORE_LIMIT;

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
  dead: new Set(),          // Peers dropped during the current match; they cannot be seated back in.
  rematch: null,            // Host only: { left, timer } while the auto-start countdown runs.
  countdown: null,          // Seconds left in the rematch countdown as last announced; null when none.
  rematchWait: false,       // Guest pressed Rematch and is waiting for the host to do the same.
  soloRematch: false,       // The session is gone, so the results screen's Rematch now starts a solo match.
};

function blockIosGestures() {
  const stop = e => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  // Nothing in the app scrolls, so a stray drag must never rubber-band Safari's page.
  document.addEventListener('touchmove', stop, { passive: false });
  // Safari still offers text selection on long-press through some layered elements.
  document.addEventListener('selectstart', stop);
  document.addEventListener('contextmenu', stop);

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
  return { primary: loadout.primary, camo: loadout.camo, loadout };
}

function goTitle(message) {
  teardownNet();
  stopRematch();
  app.soloRematch = false;
  app.countdown = null;
  app.rematchWait = false;
  app.lobby = { humans: [], botSkill: 'mixed' };
  hud.setVisible(false);
  menu.overlay('');
  menu.title();
  if (message) menu.toast(message);
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
  editName: () => editName(() => menu.title()),
  solo: () => { startSolo(); },
  host: () => { needName(startHosting); },
  join: () => { needName(askCode); },
  gunsmith: () => openGunsmith(),
  loadout: () => openLoadout(),
  leaveLobby: () => goTitle(),
  toggleReady: () => toggleReady(),
  start: () => startHostMatch(),
  botSkill: ({ skill }) => { app.lobby.botSkill = skill; broadcastLobby(); renderLobby(); },
  moveTeam: ({ id }) => moveTeam(id),
});

function needName(next) {
  if (Progress.name) next();
  else editName(next);
}

function editName(next) {
  menu.keypad({
    title: 'Choose a callsign', value: Progress.name, max: 12, kind: 'name', doneLabel: 'Save',
    hint: 'Your squad sees this in the lobby and the kill feed.',
    onDone: value => { Progress.name = value; next(); },
    onCancel: () => menu.title(),
  });
}

function askCode() {
  menu.keypad({
    title: 'Enter room code', max: 4, kind: 'code', doneLabel: 'Join',
    hint: 'Your host can read it to you from their lobby.',
    onDone: code => startJoining(code),
    onCancel: () => menu.title(),
  });
}

function afterEditing() {
  if (app.net && app.lobby.humans.length) renderLobby();
  else menu.title();
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

function openGunsmith() {
  menu.gunsmith({ onBack: afterEditing, onChange: shareLoadout });
}

function openLoadout() {
  menu.loadoutScreen(afterEditing, shareLoadout);
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
      startHostMatch();
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
  // A guest whose slot went to a bot cannot be seated back in, so tell it to stop waiting.
  net.onPeerJoin(id => { if (app.dead.has(id)) net.sendLobby({ t: 'dropped' }, id); }, { persist: true });
  net.onPeerLeave(id => hostSawLeave(id), { persist: true });
  net.onLobby((msg, from) => hostLobbyMessage(msg, from));
  renderLobby();
}

function hostLobbyMessage(msg, from) {
  const humans = app.lobby.humans;
  let guest = humans.find(h => h.id === from);
  switch (msg.t) {
    case 'join': {
      if (app.inMatch) {
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
  const loadout = normalizeLoadout({ ...msg.loadout, primary: msg.primary, camo: msg.camo });
  return { primary: loadout.primary, camo: loadout.camo, loadout };
}

function menuShows(screen) {
  return menu.el.dataset.screen === screen && menu.el.classList.contains('on');
}

function hostSawLeave(id) {
  const h = app.lobby.humans.find(x => x.id === id);
  app.lobby.humans = app.lobby.humans.filter(x => x.id !== id);
  if (app.inMatch) {
    app.dead.add(id);
    if (h) hud.notify(`${h.name} left, a bot took over`);
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
    menu.notFound(code, { retry: () => startJoining(code), back: () => goTitle() });
  });
  net.onLobby(msg => guestLobbyMessage(msg));
  net.onHostLost(left => setHostNotice(left));
  net.onHostTick(left => setHostNotice(left));
  net.onHostBack(() => clearHostNotice());
  net.onHostGone(reason => hostGone(reason));
}

function guestLobbyMessage(msg) {
  switch (msg.t) {
    case 'state':
      app.lobby.humans = msg.humans;
      app.lobby.botSkill = msg.botSkill;
      app.countdown = msg.countdown ?? null;
      if (app.voice) updateVoiceTeam();
      if (menuShows('results')) menu.updateCountdown(app.countdown);
      else if (!app.inMatch && !['gunsmith', 'loadout'].includes(menu.el.dataset.screen)) renderLobby();
      break;
    case 'start':
      // Normally the old match is long over; a guest whose final-kill hold outlasted the countdown is cut short here.
      endLocalMatch();
      app.countdown = null;
      app.rematchWait = false;
      beginMatch({
        roster: msg.roster, seed: msg.seed, mapId: msg.mapId,
        scoreLimit: msg.scoreLimit, timeLimit: msg.timeLimit,
        hostId: app.net.hostId, isHost: false,
      });
      break;
    case 'refused':
      goTitle(msg.reason);
      break;
    case 'dropped':
      endLocalMatch();
      goTitle('The match went on without you after your connection dropped.');
      break;
    default:
      break;
  }
}

function setHostNotice(left) {
  const text = left > 0 ? `Host lost, waiting... ${left}` : '';
  if (app.inMatch) {
    hud.setNotice(text);
  } else if (menuShows('results')) {
    menu.resultsNote(text);
  } else {
    menu.overlay(`<div class="sheet slim"><div class="signal"><i></i><i></i><i></i></div><h2>Host lost, waiting...</h2><p>Returning to the menu in ${left}s if they don't come back.</p></div>`);
  }
}

function clearHostNotice() {
  if (app.inMatch) hud.setNotice('');
  else if (menuShows('results')) menu.updateCountdown(app.countdown);
  else menu.overlay('');
}

function hostGone(reason) {
  const message = reason === 'ended' ? 'The host ended the session.' : 'The host did not come back.';
  // Someone reading their results keeps them; the room is gone, so Rematch becomes a fresh match against bots.
  if (menuShows('results')) {
    teardownNet();
    app.soloRematch = true;
    menu.relabelRematch('Play vs bots');
    menu.resultsNote(message);
    return;
  }
  endLocalMatch();
  goTitle(message);
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
}

function updateVoiceTeam() {
  const me = localHuman();
  if (!app.voice || !me) return;
  app.voice.setTeammates(app.lobby.humans.filter(h => h.team === me.team && h.id !== me.id).map(h => h.id));
}

// --- Matches ---
function startSolo() {
  needName(() => {
    teardownNet();
    stopRematch();
    app.soloRematch = false;
    const id = 'local';
    app.isHost = true;
    app.lobby = { humans: [], botSkill: app.lobby.botSkill || 'mixed' };
    const humans = [{ id, name: myName(), team: 0, ...seatData() }];
    beginMatch({
      roster: buildRoster(humans, { botSkill: params.get('bots') || 'mixed', teamSize: TEAM_SIZE }),
      seed: randomSeed(), mapId: DEFAULT_MAP, scoreLimit: SCORE, timeLimit: TIME_LIMIT,
      hostId: id, isHost: true, localId: id,
    });
  });
}

function startHostMatch() {
  const net = app.net;
  if (!net) return;
  stopRematch();
  const { humans, botSkill } = app.lobby;
  const clean = humans.map(({ id, name, team, primary, camo, loadout }) => ({ id, name, team, primary, camo, loadout }));
  const payload = {
    t: 'start', seed: randomSeed(), mapId: DEFAULT_MAP, scoreLimit: SCORE, timeLimit: TIME_LIMIT,
    roster: buildRoster(clean, { botSkill, teamSize: TEAM_SIZE }),
  };
  net.sendLobby(payload);
  beginMatch({ ...payload, hostId: net.localId, isHost: true });
}

function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

function beginMatch({ roster, seed, mapId, scoreLimit, timeLimit, hostId, isHost, localId }) {
  const net = app.net;
  const id = localId ?? net?.localId;
  app.inMatch = true;
  app.dead.clear();
  net?.resetGameHandlers();

  menu.hide();
  menu.overlay('');
  hud.prepare({ mapId, scoreLimit, timeLimit });
  hud.setVisible(true);
  hud.setMic(net?.room ? (app.voice?.state ?? 'off') : 'hidden', app.voice?.muted);
  updateVoiceTeam();
  if (!Progress.flag('aimHint')) {
    controls.showAimHint(true);
    Progress.setFlag('aimHint');
  }

  const renderer = app.renderer = new GameRenderer(canvas, MAPS[mapId]);
  renderer.resize();
  app.match = new Match({
    canvas, mapId, seed, scoreLimit, timeLimit, roster, localId: id, hostId, isHost,
    net, controls, hud, renderer, audio,
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
  clearInterval(app.netPoll);
  app.renderer?.dispose();
  app.renderer = null;
  hud.setVisible(false);
  controls.setEnabled(false);
}

function onMatchEnd(results) {
  hud.showEnd(results, () => showResults(results));
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

function xpBreakdown(me, won) {
  const kills = me?.kills ?? 0, head = me?.head ?? 0, assists = me?.assists ?? 0;
  const lines = [['Match played', XP.played]];
  if (kills) lines.push([`Kills x${kills}`, kills * XP.kill]);
  if (head) lines.push([`Headshots x${head}`, head * XP.headshot]);
  if (assists) lines.push([`Assists x${assists}`, assists * XP.assist]);
  if (won) lines.push(['Win', XP.win]);
  return { lines, total: lines.reduce((sum, l) => sum + l[1], 0) };
}

function weaponProgress() {
  return Object.entries(hud.weaponKills ?? {}).map(([weapon, gained]) => {
    const total = Progress.kills(weapon);
    const next = CAMOS.find(c => c.unlockKills > total);
    return { name: WEAPONS[weapon]?.name ?? weapon, gained, total, nextName: next?.name ?? '', nextAt: next?.unlockKills ?? 0 };
  });
}

function showResults(results) {
  const unlocks = collectUnlocks();
  const weapons = weaponProgress();
  endLocalMatch();
  app.rematchWait = false;

  const me = results.players.find(p => p.id === results.localId);
  const won = results.winner === results.myTeam;
  const drawn = results.winner === null || results.winner === undefined;
  const { lines, total } = xpBreakdown(me, won);
  const change = Progress.addXp(total);
  const lp = Progress.levelProgress();

  const lastKill = results.lastKill;
  const killer = lastKill && results.players.find(p => p.id === lastKill.by);
  const victim = lastKill && results.players.find(p => p.id === lastKill.target);
  const counting = app.countdown !== null && !!app.net && !app.isHost;
  menu.results({
    outcome: drawn ? 'draw' : won ? 'win' : 'loss',
    scores: results.scores,
    myTeam: results.myTeam,
    localId: results.localId,
    roster: results.players,
    mvp: pickMvp(results.players),
    xp: { total, lines, level: lp.level, into: lp.into, span: lp.span, levelUp: change.after > change.before },
    weapons,
    unlocks,
    finalKill: lastKill ? { weapon: lastKill.weapon, camo: lastKill.camo, byName: killer?.name ?? '', targetName: victim?.name ?? '' } : null,
    rematchLabel: 'Rematch',
    note: counting ? `Rematch starts in ${app.countdown}` : '',
  }, { rematch: () => afterResults(), menu: () => goTitle() });
}

function collectUnlocks() {
  return (hud.unlocks ?? []).splice(0).map(({ weapon, camoId }) => {
    const c = getCamo(camoId);
    return { weaponName: WEAPONS[weapon]?.name ?? weapon, name: c.name, colors: c.colors };
  });
}

function afterResults() {
  if (app.soloRematch || !app.net) return startSolo();
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

// --- Startup ---
function maybeInstallPrompt() {
  const ua = navigator.userAgent;
  const iOSSafari = /iP(hone|od|ad)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!iOSSafari || standalone || Progress.flag('installPrompt')) return;
  Progress.setFlag('installPrompt');
  menu.installPrompt(() => {});
}

blockIosGestures();
menu.title({ arrive: true });
if (params.has('debug')) window.__game = { app, hud, controls, menu, Progress };
maybeInstallPrompt();


