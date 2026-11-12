// Team voice over the Trystero mesh. The microphone is only requested when the player taps the HUD mic.
// In the friend lobby the same object carries party voice to every human in the room (main.js updateVoiceTeam).
//
// Modes (Options voiceMode): 'open' toggles the mic on a tap and sends while it is on; 'ptt' (push to talk) sends only
// while the mic button, the lobby mic or the controller's Talk is held: the capture is kept between presses and its
// track is enabled for the hold. Per-player mute silences one peer's <audio> element on this phone only.
// Speaking: speaking() reads each incoming track's RTP audio level (RTCRtpReceiver.getSynchronizationSources), so the
// game never routes remote voice through Web Audio; the local player counts as speaking while sending above a floor.
//
// Incoming voice plays through plain <audio> elements and never touches Web Audio. On iOS, routing a remote WebRTC stream
// through createMediaStreamSource resamples it inside the game's AudioContext, and that is the crackle.
import { tuneAudioSender } from './opus.js';

const SPEAK_LEVEL = 0.03;      // RTP audio level (0..1) that counts as talking.
const SPEAK_HOLD_MS = 450;      // A talker's mark stays this long after the level drops, so it does not flicker.

// Muted players outlive a Voice object (one per room session), so a rematch or a host change keeps them muted.
const peerMutes = new Set();

const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false };

// iOS makes HTMLMediaElement.volume read-only, so a level slider can only ever mean on or off there.
export const VOICE_LEVELS_WORK = (() => {
  const probe = document.createElement('audio');
  probe.volume = 0.5;
  return probe.volume === 0.5;
})();

export class Voice {
  // net may be a LocalNet or null; then voice reports 'unavailable'.
  constructor({ net, audio, onState }) {
    this.net = net;
    this.room = net?.room ?? null;
    this.audio = audio;
    this.onState = onState;
    this.stream = null;
    this.state = this.room ? 'off' : 'unavailable';    // off | requesting | on | denied | unavailable
    this.muted = false;
    this.teammates = new Set();
    this.sendingTo = new Set();
    this.players = new Map();              // player id -> { el, stream }
    this.wantsResume = false;
    this.mode = 'open';                    // 'open' | 'ptt'
    this.talking = false;                  // Push to talk: held right now.
    this.heardAt = new Map();              // player id -> performance.now() it was last heard above SPEAK_LEVEL
    this.localLevelAt = 0;
    this.localId = net?.localId ?? null;

    if (this.room) {
      this.room.onPeerStream = (stream, tid) => this.#addRemote(stream, net.playerIdOf(tid));
      this.net.onPeerLeave(id => this.#removeRemote(id), { persist: true });
      this.net.onPeerJoin(id => this.#syncSending(id), { persist: true });
    }

    // iOS refuses to start media without a gesture and pauses it on backgrounding: every later touch retries.
    this.resume = () => this.#resumePlayback();
    document.addEventListener('touchend', this.resume, { passive: true });
    document.addEventListener('click', this.resume, { passive: true });
    this.onVisible = () => { if (!document.hidden) this.#resumePlayback(); };
    document.addEventListener('visibilitychange', this.onVisible);
    this.#emit();
  }

  // What the mic button shows: in push to talk, 'on' only while a press is sending, else 'ptt'.
  get shownState() {
    if (this.mode !== 'ptt' || this.state === 'unavailable' || this.state === 'denied' || this.state === 'requesting') return this.state;
    return this.talking && this.state === 'on' ? 'on' : 'ptt';
  }

  #emit() { this.onState?.(this.shownState, this.muted); }

  setMode(mode) {
    mode = mode === 'ptt' ? 'ptt' : 'open';
    if (mode === this.mode) return;
    this.mode = mode;
    this.talking = false;
    // Either way the mic starts quiet: open mic waits for a tap, push to talk for a hold.
    if (this.stream) this.#stopMic();
    this.#emit();
  }

  // Push to talk: on while held. The first press asks for the microphone; it starts sending once granted, if still held.
  async talk(on) {
    if (this.mode !== 'ptt' || this.state === 'unavailable') return;
    on = !!on;
    if (this.talking === on) return;
    this.talking = on;
    if (on && !this.stream && this.state !== 'requesting') await this.#startMic();
    this.#applyTalk();
    this.#emit();
  }

  #applyTalk() {
    if (!this.stream) return;
    const live = this.mode === 'open' || this.talking;
    for (const t of this.stream.getAudioTracks()) t.enabled = live;
  }

  isPeerMuted(id) { return peerMutes.has(id); }

  setPeerMuted(id, on) {
    if (on) peerMutes.add(id); else peerMutes.delete(id);
    const p = this.players.get(id);
    if (p) this.#applyOutput(p, id);
    if (!on) this.#resumePlayback();
  }

  // Ids of players talking right now (heard within SPEAK_HOLD_MS), the local player included while sending.
  speaking(now = performance.now()) {
    const out = new Set();
    for (const [id, p] of this.players) {
      if (peerMutes.has(id)) continue;
      const level = this.#remoteLevel(id, p);
      if (level >= SPEAK_LEVEL) this.heardAt.set(id, now);
      if (now - (this.heardAt.get(id) ?? -1e9) < SPEAK_HOLD_MS) out.add(id);
    }
    if (this.stream && this.state === 'on' && (this.mode === 'open' ? true : this.talking)) {
      this.#pollLocalLevel(now);
      // Push to talk marks you for the whole hold; open mic only when the mic hears you (or no level is reported).
      if (this.mode === 'ptt' || this.localLevel === undefined || this.localLevel >= SPEAK_LEVEL) this.localLevelAt = now;
      if (now - this.localLevelAt < SPEAK_HOLD_MS && this.localId) out.add(this.localId);
    }
    return out;
  }

  #remoteLevel(id, p) {
    try {
      const pc = this.room?.getPeers?.()[this.net.transportIdOf(id)];
      if (!pc?.getReceivers) return 0;
      const tracks = new Set(p.stream.getAudioTracks());
      for (const r of pc.getReceivers()) {
        if (!tracks.has(r.track) || typeof r.getSynchronizationSources !== 'function') continue;
        let best = 0;
        for (const s of r.getSynchronizationSources()) if ((s.audioLevel ?? 0) > best) best = s.audioLevel;
        return best;
      }
    } catch { /* a closing connection */ }
    return 0;
  }

  // The local level comes from the sender's stats, at most five times a second.
  #pollLocalLevel(now) {
    if (this.levelBusy || now - (this.levelPolled ?? 0) < 200 || !this.room?.getPeers) return;
    this.levelPolled = now;
    const track = this.stream?.getAudioTracks()[0];
    const pc = Object.values(this.room.getPeers())[0];
    const sender = pc?.getSenders?.().find(x => x.track === track);
    if (!sender?.getStats) return;
    this.levelBusy = true;
    sender.getStats().then(stats => {
      let level;
      stats.forEach(r => { if (r.type === 'media-source' && typeof r.audioLevel === 'number') level = r.audioLevel; });
      this.localLevel = level;
    }).catch(() => {}).finally(() => { this.levelBusy = false; });
  }

  // Player ids on the local player's team, excluding the local player. Host and guests call this from the roster.
  setTeammates(ids) {
    this.teammates = new Set(ids);
    for (const peerId of this.players.keys()) {
      if (!this.teammates.has(peerId)) this.#removeRemote(peerId);
    }
    this.#syncSending();
  }

  async toggleMic() {
    if (this.mode === 'ptt') return;       // Push to talk is held, never toggled (see talk).
    if (this.state === 'unavailable' || this.state === 'requesting') return;
    if (this.state === 'on') {
      this.#stopMic();
      return;
    }
    await this.#startMic();
  }

  async #startMic() {
    this.#setState('requesting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (err) {
      console.warn('[voice] microphone refused', err?.name);
      this.#setState('denied');
      return;
    }
    this.#applyTalk();
    this.#setState('on');
    this.audio?.setMicActive(true);
    this.#syncSending();
  }

  // Runs after Trystero has attached the track; the peer connections come from its room object.
  #tuneSenders() {
    if (!this.stream || !this.room?.getPeers) return;
    const tracks = new Set(this.stream.getAudioTracks());
    for (const pc of Object.values(this.room.getPeers())) {
      for (const sender of pc.getSenders?.() ?? []) if (tracks.has(sender.track)) tuneAudioSender(sender);
    }
  }

  // 0..1. Where the element's volume is read-only (iOS) anything above zero is simply on.
  setVolume(v) {
    this.volume = v;
    for (const p of this.players.values()) this.#applyOutput(p);
  }

  #applyOutput(player, id = player.id) {
    const v = this.volume ?? 1;
    player.el.muted = this.muted || v <= 0 || peerMutes.has(id);
    if (VOICE_LEVELS_WORK) player.el.volume = Math.min(1, v);
  }

  setMuted(muted) {
    this.muted = muted;
    for (const p of this.players.values()) this.#applyOutput(p);
    this.#emit();
    if (!muted) this.#resumePlayback();
  }

  dispose() {
    this.#stopMic();
    for (const id of [...this.players.keys()]) this.#removeRemote(id);
    document.removeEventListener('touchend', this.resume);
    document.removeEventListener('click', this.resume);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.room) this.room.onPeerStream = null;
  }

  #setState(state) {
    this.state = state;
    this.#emit();
  }

  // Tracks are stopped rather than disabled because iOS keeps its reduced "voice call" volume while any capture lives.
  #stopMic() {
    if (!this.stream) {
      if (this.state === 'on') this.#setState('off');
      return;
    }
    const stream = this.stream;
    this.stream = null;
    const tids = this.#tids([...this.sendingTo]);
    if (tids.length) this.room.removeStream(stream, { target: tids });
    this.sendingTo.clear();
    for (const track of stream.getTracks()) track.stop();
    this.audio?.setMicActive(false);
    this.talking = false;
    this.#setState('off');
  }

  // The audio streams run on the transport, which knows connections rather than players.
  #tids(ids) {
    return ids.map(id => this.net.transportIdOf(id)).filter(Boolean);
  }

  #syncSending() {
    if (!this.stream) return;
    const connected = new Set(this.net.peers);
    const add = [];
    for (const id of this.teammates) {
      if (connected.has(id) && !this.sendingTo.has(id)) add.push(id);
    }
    const drop = [];
    for (const id of this.sendingTo) {
      if (!this.teammates.has(id) || !connected.has(id)) drop.push(id);
    }
    if (add.length) {
      Promise.resolve(this.room.addStream(this.stream, { target: this.#tids(add) })).catch(() => {}).then(() => this.#tuneSenders());
      setTimeout(() => this.#tuneSenders(), 1500);     // addStream's promise covers the handshake, not every late peer.
      for (const id of add) this.sendingTo.add(id);
    }
    if (drop.length) {
      const live = drop.filter(id => connected.has(id));
      if (live.length) this.room.removeStream(this.stream, { target: this.#tids(live) });
      for (const id of drop) this.sendingTo.delete(id);
    }
  }

  #addRemote(stream, peerId) {
    if (!peerId || !this.teammates.has(peerId)) return;
    this.#removeRemote(peerId);
    const el = document.createElement('audio');
    el.autoplay = true;
    el.setAttribute('playsinline', '');
    el.srcObject = stream;
    document.body.appendChild(el);
    const player = { el, stream, id: peerId };
    this.players.set(peerId, player);
    this.#applyOutput(player);
    this.#resumePlayback();
  }

  #removeRemote(peerId) {
    const player = this.players.get(peerId);
    if (!player) return;
    player.el.srcObject = null;
    player.el.remove();
    this.players.delete(peerId);
    this.sendingTo.delete(peerId);
  }

  #resumePlayback() {
    for (const { el } of this.players.values()) {
      if (el.paused && !el.muted) el.play().catch(() => {});
    }
  }
}
