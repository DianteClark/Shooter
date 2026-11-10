// Keeps the screen on the whole time the game is open and in front: menus, loadouts and lobbies as well as matches.
// Callers may still call set(true/false); false no longer lets the phone dim, so a player browsing loadouts or
// waiting on the title screen between matches is not dropped to the lock screen. The Wake Lock API where it works, and a silent video where it does not:
// iOS before 16.4 has no Wake Lock, and on Home Screen apps before iOS 18.4 the API exists but does nothing.
//
// A lock is released whenever the page is hidden, so it is taken again on return. WebKit only holds the display awake
// for an unmuted video with an audio track that is not on `loop`, so the fallback is a four second clip of silence
// that seeks back on itself. It starts from the next touch when autoplay is refused (Low Power Mode refuses it).
const SILENT_MP4 = 'data:video/mp4;base64,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cWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEBL///w9FAAP+TrrwARggBwEYIAcBGCAHARggBwEYIAcBGCAHAAAABkGaIBLywAEYIAcBGCAHARggBwEYIAcBGCAHAAAABkGaQBLywAEYIAcBGCAHARggBwEYIAcBGCAHARggBwAAAAZBmmAS8sABGCAHARggBwEYIAcBGCAHARggBwAAAAZBmoAS8sABGCAHARggBwEYIAcBGCAHARggBwAAAAZBmqAS8sABGCAHARggBwEYIAcBGCAHARggBwEYIAcAAAAGQZrAEvLAARggBwEYIAcBGCAHARggBwEYIAcAAAAGQZrgEvLAARggBwEYIAcBGCAHARggBwEYIAcBGCAHAAAABkGbABLywAEYIAcBGCAHARggBwEYIAcBGCAHAAAABkGbIBLywAEYIAcBGCAHARggBwEYIAcBGCAHAAAABkGbQBLywAEYIAcBGCAHARggBwEYIAcBGCAHARggBwAAAAZBm2AS8sABGCAHARggBwEYIAcBGCAHARggBwAAAAZBm4AS8sABGCAHARggBwEYIAcBGCAHARggBwAAAAZBm6AS8sABGCAHARggBwEYIAcBGCAHARggBwEYIAcAAAAGQZvAEfLAARggBwEYIAcBGCAHARggBwEYIAcAAAAGQZvgEPLAARggBwEYIAcBGCAHARggBwEYIAcBGCAH';
const ALWAYS_ON = true;            // Hold the screen on in menus too, not only in matches.
const REWIND_AT = 3;              // Seconds into the clip to jump back; never reaches the end, so it never pauses.

function needsVideo() {
  if (!('wakeLock' in navigator)) return true;
  const m = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
  if (!m || !/iP(hone|od|ad)/.test(navigator.userAgent)) return false;
  const standalone = navigator.standalone === true;
  return standalone && (Number(m[1]) < 18 || (Number(m[1]) === 18 && Number(m[2]) < 4));
}

class WakeLockKeeper {
  constructor() {
    this.wanted = true;
    this.lock = null;
    this.pending = false;
    this.video = null;
    this.useVideo = needsVideo();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.#apply(); });
    // A refused request or autoplay gets another chance from the next gesture; both are cheap no-ops once held.
    const retry = () => this.#apply();
    document.addEventListener('touchend', retry, { passive: true });
    document.addEventListener('click', retry, { passive: true });
  }

  set(on) {
    // Always wanted while the page is visible; iOS releases the lock by itself when the app goes to the background.
    if (on || ALWAYS_ON) { this.wanted = true; this.#apply(); return; }
    this.wanted = false;
    this.#drop();
  }

  get holding() { return !!this.lock || (!!this.video && !this.video.paused); }

  #apply() {
    if (!this.wanted || document.hidden) return;
    if (this.useVideo) this.#playVideo();
    else this.#request();
  }

  async #request() {
    if (this.lock || this.pending) return;
    this.pending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      this.pending = false;
      if (!this.wanted) { lock.release().catch(() => {}); return; }
      this.lock = lock;
      lock.addEventListener('release', () => { if (this.lock === lock) this.lock = null; });
    } catch {
      this.pending = false;
      // Refused for a reason other than timing means the API is not usable here.
      if (!document.hidden && !navigator.userActivation?.isActive) return;
      this.useVideo = true;
      this.#playVideo();
    }
  }

  #playVideo() {
    const v = this.video ??= this.#makeVideo();
    if (v.paused) v.play().catch(() => {});
  }

  #makeVideo() {
    const v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('title', '');
    v.preload = 'auto';
    v.src = SILENT_MP4;
    v.style.cssText = 'position:fixed;left:-100px;top:-100px;width:2px;height:2px;opacity:0;pointer-events:none';
    v.addEventListener('timeupdate', () => { if (v.currentTime > REWIND_AT) v.currentTime = 0.25; });
    document.body.appendChild(v);
    return v;
  }

  #drop() {
    this.lock?.release().catch(() => {});
    this.lock = null;
    this.video?.pause();
  }
}

export const wakeLock = new WakeLockKeeper();
wakeLock.set(true);
