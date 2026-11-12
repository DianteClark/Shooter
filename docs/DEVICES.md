# Every phone (ROADMAP item 34)

Switchyard targets iPhone first (the owner plays on a 430x932 @3x iPhone, iOS 18, as a Home Screen app) and now
also runs properly on Android Chrome, Samsung Internet and every iPhone size back to the SE. This file is the map of
what differs per device and where it lives.

## Quality tiers (js/render/quality.js)

`deviceProfile(gl)` guesses a starting step (`ultra`..`potato`); the Auto governor then corrects it within seconds.
The perf overlay's last line shows the guess: `phone: high (430x932 @3x, iOS 18)`.

| Device | What is real | Guess |
| --- | --- | --- |
| iPhone | screen size, DPR, iOS version (GPU string is just "Apple GPU", cores report 4) | by screen family and iOS floor, unchanged: <=568 potato; <=736 (6s-8 Plus, SE 2/3) medium on iOS 17+, low on 16, potato before; <=812 (X/XS/11 Pro, 12/13 mini) medium on iOS 17+, else low; <=896 (XR, 11, XS Max) medium; larger (12 and later) high |
| Android | GPU renderer string (WEBGL_debug_renderer_info), deviceMemory, hardwareConcurrency | by GPU family (`gpuTier`), pulled down by memory <= 4 GB; unknown GPU: by memory and cores |
| Anything | software renderer (SwiftShader, llvmpipe) | potato |

`gpuTier` table: Adreno 730+ and 650-699 high, 710/720 medium, 618-649 medium, 600-617 and 530-599 low, older potato;
Mali G7x/G710+ (and Immortalis, Xclipse) high, G68-G72 and G6xx medium, G51-G57 and G5xx low, G31 and Mali-T potato;
PowerVR GE8xxx potato, BXM low. Apple A-number when a shell exposes it: <=A9 potato, A10-11 low, A12-13 medium, A14+ high.

Each tier carries, for Auto only (a step the player picks is honoured as is):
- `dprCap`: drawing-buffer pixel ratio cap on top of the step's own (high/ultra: none, medium 2, low 1.6, potato 1.3).
  Budget Android phones ship 2.6-3.75x screens; this is the cheapest saving there is.
- `ceiling`: the highest step Auto may climb to, one above the guess at most (never above High).

The governor already lowered resolution, then the step, after a few slow windows, and handled 30 Hz caps and heat. New:
four windows in a row (2 s) below about 37 fps (frames 1.6x the target) step down at once without first walking the
resolution to its floor. The step Auto settles on is remembered for 14 days, as before.

The owner's iPhone gets exactly what it had: tier high, no cap, ceiling High.

## Android specifics

- Viewport (js/ui/viewport.js): the iOS corrections (grow to `screen` in a Home Screen app, to `100lvh` in Safari) are
  skipped on Android. There `screen.height` includes the status and navigation bars and `100lvh` assumes the address
  bar scrolled away, so either would size the app past what is on screen. Safe areas (display cutouts, gesture bar)
  come from `env(safe-area-inset-*)`, which Chrome fills with `viewport-fit=cover` as Safari does.
- Touch: the controls use touch events with `touch-action: none` and `overscroll-behavior: none` on the page, which
  Chrome and Samsung Internet handle the same as Safari (multi-touch sticks verified through CDP touch in the test).
  Pull-to-refresh cannot start.
- Full screen (js/ui/android.js): in a browser tab each tap outside full screen requests it (Options > Full screen, on
  by default, shown only in an Android tab) and then locks the orientation to landscape. The installed app gets both
  from the manifest (`display_override: fullscreen`, `orientation: landscape`).
- Back gesture: one history entry is kept while anything sits above the title. A back presses the screen's Back (or the
  open sheet's close); in a match it is swallowed with a hint; on the title the entry is not kept, a toast says "Back
  again to close", and the next back leaves. Off on iPhone (Safari's edge swipe would animate a page change).
- Wake lock: js/ui/wakelock.js already uses the Screen Wake Lock API, which Android Chrome and Samsung Internet have.
- Audio unlock: on the first touchend/click, as on iPhone; both count as user activation in Chrome.
- Vibration (js/ui/haptics.js): Options > Vibrate on hits, off by default, offered only where `navigator.vibrate`
  exists (not iPhone). Short buzz when hit, a tick when landing a hit, a double tap on a kill, at most every 90 ms.
- Manifest: name, short_name, description, id, start_url, scope, `display: standalone` with `display_override:
  [fullscreen, standalone]` (Safari ignores the override, so the iPhone app is unchanged), landscape, colours,
  categories, icons 180/192/512 and maskable 192/512 (dev/ui-make-icons.py draws them; maskable keeps the mark inside
  the 80% safe circle).
- Service worker (sw.js): registered on Android only. Chrome and Samsung Internet offer Install (and fire
  `beforeinstallprompt`) only for a site whose worker handles fetch. It passes every request to the network with the
  request's own cache mode and stores nothing, so js/ui/updater.js (build check with `no-store`, refresh with
  `cache: reload`) works exactly as on iPhone. Not registered on iOS, where it would change Home Screen app behaviour
  for nothing.

## Install guide (js/ui/installguide.js, js/ui/platform.js)

- How to play > Install: a platform picker (iPhone Safari, iPhone other browsers, Android Chrome, Samsung Internet),
  the detected one chosen first; three steps for it; an Install button when the browser has handed over
  `beforeinstallprompt`; and "Where your progress lives".
- The once-only sheet (main.js `maybeInstallPrompt`, flag `installPrompt`) for any phone in a browser tab: steps for
  this browser, a storage note, More (opens the tab), Install where available. Players who saw the old iOS sheet do not
  see it again.
- iPhone other browsers: Share > Add to Home Screen on iOS 16.4+; otherwise (or in a chat app's browser) open in
  Safari first.
- Storage, as players read it: progress lives only on this phone, in this site's browser storage; no account, no
  server; friends connect phone to phone; the Save code is the backup and moves progress to another phone; clearing
  website data, deleting the Home Screen app on iPhone or a browser purge can wipe it without a code; on iPhone the
  Safari tab and the Home Screen app keep separate storage.
- `navigator.storage.persist()` is requested at the first match (not on Firefox, which would show a dialog), when the
  app runs installed, and after an install is accepted. The guide shows whether it was granted.

## Tests

`python3 dev/ui-devices-test.py [port] [--shots]`: Pixel 7 (tab and app), Galaxy S23 on Samsung Internet, Galaxy S24
Ultra, a 360x800 budget phone, iPhone SE and 12 mini: viewport sized to the visible area, title, Multiplayer,
install sheet and guide (platform detected), a solo match (buttons on screen and at least 40 px, two real thumbs on
the sticks), the gunsmith, the Android back gesture, and the GPU tier table. Screenshots in /tmp/devices-*.png.
