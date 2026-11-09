// Team voice over the Trystero mesh. The microphone is only requested when the player taps the HUD mic.
const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };

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
    this.onState?.(this.state, this.muted);
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
    if (this.state === 'unavailable' || this.state === 'requesting') return;
    if (this.state === 'on') {
      this.#stopMic();
      return;
    }
    this.#setState('requesting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (err) {
      console.warn('[voice] microphone refused', err?.name);
      this.#setState('denied');
      return;
    }
    this.#setState('on');
    this.audio?.setMicActive(true);
    this.#syncSending();
  }

  // iOS ignores the volume property on media elements, so remote voice plays through a gain node when the audio
  // engine is running; the element stays muted to keep the stream alive without playing it twice.
  setVolume(v) {
    this.volume = v;
    for (const p of this.players.values()) this.#applyGain(p);
  }

  #applyGain(player) {
    const v = this.volume ?? 1;
    const ctx = this.audio?.ctx;
    if (ctx && !player.gain) {
      try {
        const source = ctx.createMediaStreamSource(player.stream);
        player.gain = ctx.createGain();
        source.connect(player.gain).connect(ctx.destination);
        player.el.muted = true;
      } catch { player.gain = null; }
    }
    if (player.gain) player.gain.gain.value = this.muted ? 0 : v;
    else player.el.volume = v;
  }

  setMuted(muted) {
    this.muted = muted;
    for (const p of this.players.values()) {
      if (p.gain) this.#applyGain(p);
      else p.el.muted = muted;
    }
    this.onState?.(this.state, this.muted);
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
    this.onState?.(state, this.muted);
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
      this.room.addStream(this.stream, { target: this.#tids(add) });
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
    el.muted = this.muted;
    el.srcObject = stream;
    document.body.appendChild(el);
    const player = { el, stream, gain: null };
    this.players.set(peerId, player);
    this.#applyGain(player);
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
      if (el.paused) el.play().catch(() => {});
    }
  }
}
