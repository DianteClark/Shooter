// Stand-in for js/audio/audio.js so UI tests run before audio lands. Used only by test routing in /tmp.
export class AudioEngine {
  unlock() {}
  onEvents() {}
  update() {}
  setMicActive(on) { window.__micActive = on; }
}
