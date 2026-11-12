// Install guide: how to put Switchyard on this phone's Home Screen, for the browser it is open in, and where its
// progress is kept. Two ways in: the Install tab of How to play, and a sheet offered once to a player in a browser tab
// (main.js maybeInstallPrompt). docs/DEVICES.md has the background.
import { esc } from './widgets.js';
import { ico } from './yard.js';
import { platformKey, installed, canPromptInstall, promptInstall, onInstallChange, iosOtherCanAdd, IOS, ANDROID, storageState, requestPersist } from './platform.js';

// The guide's own platform picker: the detected one is chosen first, the others stay a tap away (a friend's phone).
const PLATS = [
  ['ios-safari', 'iPhone Safari'],
  ['ios-other', 'iPhone, other'],
  ['android-chrome', 'Android Chrome'],
  ['android-samsung', 'Samsung'],
];

const detected = () => {
  const k = platformKey();
  if (k === 'ios-inapp') return 'ios-other';
  if (k === 'android-other') return 'android-chrome';
  if (k === 'desktop') return 'ios-safari';
  return k;
};

const step = (n, icon, html) => `<li><span class="step-n">${n}</span>${ico(icon)}<span>${html}</span></li>`;

// Three steps for a platform. A browser that can show its own install dialog gets a button as the first step.
function stepsFor(plat) {
  switch (plat) {
    case 'ios-safari': return [
      step(1, 'share', 'Tap <b>Share</b>: the square with an arrow in Safari\'s bar (on iOS 26, tap <b>···</b> first)'),
      step(2, 'plus', 'Scroll down and choose <b>Add to Home Screen</b>, then <b>Add</b>'),
      step(3, 'play', 'Open Switchyard from its new icon. It runs full screen, with no browser bars'),
    ];
    case 'ios-other': return [
      step(1, 'share', iosOtherCanAdd() || !IOS
        ? 'Tap <b>Share</b>: in Chrome it is in the address bar, in Firefox and Edge under the menu'
        : 'Copy this page\'s link and open it in <b>Safari</b>: older iOS only adds to the Home Screen from there'),
      step(2, 'plus', 'Choose <b>Add to Home Screen</b>. Not there, or opened from a chat app? Open the link in <b>Safari</b> and add it from Safari\'s Share'),
      step(3, 'play', 'Open Switchyard from its new icon'),
    ];
    case 'android-chrome': return [
      step(1, 'menu', canPromptInstall() ? 'Tap <b>Install</b> below, or open the <b>⋮</b> menu at the top right' : 'Tap the <b>⋮</b> menu at the top right of Chrome'),
      step(2, 'plus', 'Choose <b>Install app</b> (older Chrome: <b>Add to Home screen</b>), then <b>Install</b>'),
      step(3, 'play', 'Open Switchyard from the Home screen or the app drawer. It runs full screen, sideways'),
    ];
    case 'android-samsung': return [
      step(1, 'menu', canPromptInstall() ? 'Tap <b>Install</b> below, or the <b>≡</b> menu at the bottom' : 'Tap the <b>≡</b> menu at the bottom, or the install icon in the address bar'),
      step(2, 'plus', 'Choose <b>Add page to</b>, then <b>Home screen</b> (or <b>Install</b>)'),
      step(3, 'play', 'Open Switchyard from its new icon. It runs full screen, sideways'),
    ];
    default: return [];
  }
}

// The facts about storage, in plain words. persisted: true, false or null (unknown).
function storageHtml(persisted) {
  const status = persisted === true
    ? `<p class="ig-status ok">${ico('check')}This browser has agreed to keep Switchyard's data for good (persistent storage).</p>`
    : persisted === false
      ? `<p class="ig-status">${ico('info')}This browser has not marked the game's storage as permanent yet. Installing helps; the Save code is the sure backup.</p>`
      : '';
  return `
    <ul class="ig-facts">
      <li>${ico('phone')}<span><b>Your progress lives only on this phone</b>, in this website's storage in the browser. There is no account and no server: nothing about you is sent anywhere.</span></li>
      <li>${ico('team')}<span><b>Friends connect phone to phone.</b> Matches run directly between your phones; public relays only help them find each other by room code.</span></li>
      <li>${ico('save')}<span><b>The Save code is your backup.</b> Copy it from <b>Save code</b> on the title and keep it somewhere safe. Paste it on another phone to move your progress there.</span></li>
      <li>${ico('warn')}<span><b>Without a code, progress can be wiped</b> by clearing website data or history for this site, by deleting the Home Screen app on iPhone, or by the browser clearing storage itself (low space, or a site left unopened for weeks in Safari).</span></li>
      <li>${ico('swap')}<span><b>On iPhone, the Safari tab and the Home Screen app keep separate storage.</b> Progress made in one does not show in the other: carry it across with the Save code.</span></li>
    </ul>
    ${status}`;
}

// The Install tab of How to play. state: { plat } is kept across repaints by help.js.
export function installPanel(state) {
  const plat = state.plat ??= detected();
  const here = installed();
  const banner = here
    ? `<p class="ig-here ok">${ico('check')}You are playing in the installed app. Nothing more to do here.</p>`
    : platformKey() === 'desktop' ? `<p class="ig-here">${ico('phone')}Open this page on your phone to add it there.</p>` : '';
  const btn = canPromptInstall() && plat.startsWith('android') && ANDROID
    ? `<button class="btn is-primary ig-install" data-sound="confirm" data-act="igInstall">${ico('load')}<b>Install</b></button>` : '';
  return `
    <div class="ig">
      <section class="ig-how scroll-y">
        <h4>${ico('phone')}<span>Add to your phone</span></h4>
        ${banner}
        <nav class="ig-plats">${PLATS.map(([id, label]) => `<button class="seg${id === plat ? ' on' : ''}" data-act="igPlat" data-plat="${id}"><b>${esc(label)}</b></button>`).join('')}</nav>
        <ol class="steps ig-steps">${stepsFor(plat).join('')}</ol>
        ${btn ? `<div class="ig-row">${btn}</div>` : ''}
      </section>
      <section class="ig-data scroll-y">
        <h4>${ico('save')}<span>Where your progress lives</span></h4>
        <div class="ig-storage">${storageHtml(state.persisted ?? null)}</div>
      </section>
    </div>`;
}

// Actions for the panel; repaint() redraws it. Shared by How to play and the sheet.
export function installActions(state, repaint) {
  storageState().then(s => { state.persisted = s.persisted; repaint(); });
  const off = onInstallChange(repaint);
  return {
    actions: {
      igPlat: ({ plat }) => { state.plat = plat; repaint(); },
      igInstall: async () => {
        const r = await promptInstall();
        if (r === 'accepted') state.persisted = await requestPersist();
        repaint();
      },
    },
    dispose: off,
  };
}

// Offered once, over the title, to a player in a browser tab on a phone. onDone(): closed either way.
export function installSheet(menu, { onDone = () => {}, onMore = null } = {}) {
  const state = {};
  const paint = () => {
    const plat = state.plat ??= detected();
    const btn = canPromptInstall() && ANDROID
      ? `<button class="btn is-primary" data-sound="confirm" data-act="igInstall">${ico('load')}<b>Install</b></button>`
      : `<button class="btn is-primary" data-sound="confirm" data-act="igDone">${ico('check')}<b>Got it</b></button>`;
    menu.overlay(`
      <div class="sheet install ig-sheet">
        <div class="sheet-head">${ico('phone')}<h2>${ANDROID ? 'Install Switchyard' : 'Add to Home Screen'}</h2></div>
        <p>Switchyard plays best as an app: full screen, sideways, with no browser bars in the way of your thumbs.</p>
        <ol class="steps">${stepsFor(plat).join('')}</ol>
        <p class="ig-note">${ico('info')}<span>Progress stays on this phone only. Keep your <b>Save code</b> as a backup${IOS ? ': the Home Screen app starts with its own storage, apart from this Safari tab' : ''}.</span></p>
        <div class="sheet-row">
          ${onMore ? `<button class="btn" data-act="igMore">${ico('info')}<b>More</b></button>` : ''}
          ${canPromptInstall() && ANDROID ? `<button class="btn" data-act="igDone">${ico('close')}<b>Not now</b></button>` : ''}
          ${btn}
        </div>
      </div>`);
    // overlay() replays the sheet's entrance; a repaint from an install event should not, so it only runs once.
  };
  const off = onInstallChange(() => { if (menu.overlayEl.querySelector('.ig-sheet')) paint(); });
  const close = () => { off(); menu.overlay(''); onDone(); };
  menu.on({
    igDone: close,
    igMore: () => { close(); onMore?.(); },
    igInstall: async () => { const r = await promptInstall(); close(); if (r === 'accepted') menu.toast('Installing. Open Switchyard from its new icon'); },
  });
  paint();
}
