// Invite links: the host shares https://.../Shooter/?join=CODE, and opening it goes straight into joining that room.
//
// iOS facts this file is built around:
// - navigator.share and the clipboard need a live user gesture. tap.js fires actions with el.click() inside the
//   trusted touchend, which carries one, so share/copy are called synchronously from the action, with no await before.
// - A link tapped in Messages opens in Safari, never in a Home Screen web app, and the two keep separate storage. So
//   the join has to work in Safari from nothing (callsign asked if missing), and a short note offers the code for
//   anyone who would rather play from the Home Screen icon.
// - The link is single use from the page's point of view: `join` and `t` are stripped as soon as they are read, so
//   a reload, or a Home Screen bookmark made from this tab, never rejoins.
import { PUBLIC_LOBBIES } from '../net/lobbies.js';
import { encodeQR, qrSvgPath } from '../../vendor/qrcode.js';
import { esc } from './widgets.js';
import { ico } from './yard.js';

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/;   // Net.makeCode's alphabet: no 0/O or 1/I/L.
const INVITE_TTL_MS = 8 * 3600e3;                         // Older than this and the room has almost surely closed.
const KEEP_PARAMS = ['net', 'relay'];                      // Test transports travel with the link.
const WAIT_RETRY_S = 15;                                   // "Wait for it" retries a mid-match room this often.
const NOTE_MS = 14000;

// ---- Reading the link ------------------------------------------------------------------------------------------

export function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

export function isIOS() {
  return /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Normalises what a person or a link might carry: lower case, spaces, a stray dash.
export function cleanCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function validCode(code) {
  return CODE_RE.test(code);
}

// Call once at startup, before anything else reads the URL. Returns null when the page was not opened from an
// invite, else { code, valid, age (ms, or null if the link carries no time), expired }. Always strips the invite.
export function takeInvite() {
  const url = new URL(location.href);
  // A link pasted with a #join=CODE fragment (some chat apps mangle queries) is accepted too.
  const hash = new URLSearchParams(url.hash.slice(1));
  const raw = url.searchParams.get('join') ?? hash.get('join');
  if (raw === null) return null;
  const stamp = url.searchParams.get('t') ?? hash.get('t');
  for (const p of ['join', 't']) { url.searchParams.delete(p); hash.delete(p); }
  url.hash = hash.toString();
  try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch { /* sandboxed: harmless */ }

  const code = cleanCode(raw);
  const minutes = stamp ? parseInt(stamp, 36) : NaN;
  const age = Number.isFinite(minutes) ? Math.max(0, Date.now() - minutes * 60000) : null;
  const invite = { code, valid: validCode(code), age, expired: age !== null && age > INVITE_TTL_MS };
  pending = invite.valid ? invite : null;
  return invite;
}

// ---- Making the link -------------------------------------------------------------------------------------------

// The page's own address with ?join=CODE&t=<minutes, base 36>, so it works on GitHub Pages and on a test server alike.
export function inviteUrl(code, now = Date.now()) {
  const here = new URL(location.href);
  const url = new URL(here.pathname.replace(/index\.html$/, ''), here.origin);
  url.searchParams.set('join', code);
  url.searchParams.set('t', Math.floor(now / 60000).toString(36));
  for (const p of KEEP_PARAMS) if (here.searchParams.has(p)) url.searchParams.set(p, here.searchParams.get(p));
  return url.toString();
}

function inviteText(code) {
  return `Join my Switchyard squad. Room code ${code}.`;
}

// Must start inside a tap. The async clipboard (iOS 13.4+) is tried first; the old textarea path is the fallback for
// browsers without it or that refuse it. Resolves true if the text reached the clipboard.
export function copyText(text) {
  if (navigator.clipboard?.writeText) {
    let p;
    try { p = navigator.clipboard.writeText(text); } catch { p = Promise.reject(); }
    return p.then(() => true, () => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';   // 16px: iOS would zoom otherwise.
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// Opens the share sheet; without one (or if it fails) copies the link. Resolves to 'shared' | 'cancelled' |
// 'copied' | 'failed'. Must be called straight from a tap handler.
export function shareInvite(code, menu) {
  const url = inviteUrl(code);
  const data = { title: 'Switchyard invite', text: inviteText(code), url };
  let sharing = null;
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try { sharing = navigator.share(data); } catch (err) { sharing = Promise.reject(err); }
  }
  if (!sharing) return copyFallback(code, url, menu);
  return sharing.then(() => 'shared', err => {
    // The person closed the sheet: nothing to say. Anything else (no gesture, blocked) falls back to copying.
    if (err?.name === 'AbortError') return 'cancelled';
    return copyFallback(code, url, menu);
  });
}

function copyFallback(code, url, menu) {
  return copyText(url).then(ok => {
    if (ok) {
      menu.toast('Invite link copied. Paste it to your squad.');
      return 'copied';
    }
    // No clipboard either: the sheet shows the link as selectable text.
    openInviteSheet(menu, code, { showLink: true });
    return 'failed';
  });
}

// ---- The host's lobby -----------------------------------------------------------------------------------------

// Two plates for the lobby header, after the room code: Invite (share sheet) and the big code with a QR.
// listed: the room is public (shown in Browse games); the third plate switches it (main.js, action lobbyPublic).
export function inviteControls({ listed = false } = {}) {
  return `<div class="inv-ctl">
    <button class="btn is-primary inv-share" data-act="invite" data-sound="confirm">${ico('share')}<b>Invite</b></button>
    <button class="btn inv-qr" data-act="inviteShow" aria-label="Show code and QR">${qrGlyph()}</button>
    ${PUBLIC_LOBBIES ? `<button class="btn inv-listed${listed ? ' on' : ''}" data-act="lobbyPublic" aria-pressed="${listed}" aria-label="${listed ? 'Public room: listed in Browse games. Tap to make private' : 'Private room. Tap to list it in Browse games'}">${ico(listed ? 'ui:signal' : 'ui:lock')}<b>${listed ? 'Public' : 'Private'}</b></button>` : ''}
  </div>`;
}

// A small fixed QR-like mark for the button (the real code is in the sheet).
function qrGlyph() {
  const sq = (x, y) => `<path d="M${x} ${y}h9v9h-9zM${x + 2} ${y + 2}v5h5v-5z M${x + 3.5} ${y + 3.5}h2v2h-2z" fill-rule="evenodd"/>`;
  return `<svg class="ico" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"><g fill="currentColor">${sq(3, 3)}${sq(20, 3)}${sq(3, 20)}<path d="M20 20h3v3h-3zM26 20h3v3h-3zM23 23h3v3h-3zM20 26h3v3h-3zM26 26h3v3h-3zM14 4h3v3h-3zM14 10h3v6h-3zM4 14h6v3h-6zM20 14h3v3h-3zM26 14h3v3h-3z"/></g></svg>`;
}

// Registers the lobby's invite actions once; code() returns the room code at the moment of the tap.
export function wireInvite(menu, code) {
  menu.on({
    invite: () => { const c = code(); if (c) shareInvite(c, menu); },
    inviteShow: () => { const c = code(); if (c) openInviteSheet(menu, c); },
  });
}

// Large code and a locally drawn QR, for a friend sitting next to the host.
export function openInviteSheet(menu, code, { showLink = false } = {}) {
  const url = inviteUrl(code);
  let qr = '';
  try {
    const q = encodeQR(url), n = q.size + 8;
    qr = `<svg class="inv-qrcode" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code for the invite link">
      <rect width="${n}" height="${n}" fill="#fff"/><path d="${qrSvgPath(q, 4)}" fill="#10141a"/></svg>`;
  } catch { /* An absurdly long test URL: the code alone still works. */ }
  menu.overlay(`
    <div class="sheet inv-sheet">
      ${qr ? `<div class="inv-qrwrap">${qr}<small>Scan with the camera</small></div>` : ''}
      <div class="inv-main">
        <div class="sheet-head">${ico('team')}<h2>Invite your squad</h2></div>
        <div class="inv-code" aria-label="Room code ${[...code].join(' ')}">${[...code].map(c => `<b>${esc(c)}</b>`).join('')}</div>
        <p>Friends tap <b>Join</b> and enter this code, scan the QR, or open the link you send them.</p>
        ${showLink ? `<p class="inv-link">${esc(url)}</p>` : ''}
        <div class="sheet-row">
          <button class="btn" data-act="invClose">${ico('close')}<b>Done</b></button>
          <button class="btn" data-act="invCopy">${ico('copy')}<b>Copy link</b></button>
          ${navigator.share ? `<button class="btn is-primary" data-sound="confirm" data-act="invShare">${ico('share')}<b>Share</b></button>` : ''}
        </div>
      </div>
    </div>`);
  menu.on({
    invClose: () => menu.overlay(''),
    invShare: () => shareInvite(code, menu),
    invCopy: () => {
      copyText(url).then(ok => {
        if (ok) menu.toast('Invite link copied');
        else openInviteSheet(menu, code, { showLink: true });
      });
    },
  });
}

// ---- Opening a link --------------------------------------------------------------------------------------------

let pending = null;      // The invite this page was opened with, until its first join attempt fails or succeeds.
let waiting = null;      // { code, timer, left } while "Wait for it" retries a room that is mid-match.

// Startup, after the title is up. Handles a bad or old link, asks for a callsign if there is none (needName), then
// joins. ctx: { menu, needName(next), join(code), enterCode() }.
export function joinFromInvite(invite, ctx) {
  if (!invite.valid) {
    showJoinProblem(ctx.menu, { why: 'badlink', code: invite.code, enterCode: ctx.enterCode });
    return;
  }
  // The note waits for the callsign keypad to be done with, so it never sits over the keys.
  const go = () => ctx.needName(() => {
    showHomeScreenNote(invite.code);
    ctx.join(invite.code);
  });
  if (invite.expired) {
    showJoinProblem(ctx.menu, { why: 'expired', code: invite.code, age: invite.age, retry: go, enterCode: ctx.enterCode });
    return;
  }
  go();
}

// For main.js's onJoinFailed: true if this failure was the invite's and was shown here (an invite-specific message),
// false to let the ordinary "No room at" screen show. Only the first failure per invite is claimed.
export function inviteJoinFailed(menu, code, { retry, enterCode }) {
  if (!pending || pending.code !== code) return false;
  pending = null;
  showJoinProblem(menu, { why: 'notfound', code, retry, enterCode });
  return true;
}

// The host's answer to a join it cannot take. `reason` stays for phones on an older build, which show it as a toast.
const REFUSALS = {
  full: 'That room is full.',
  started: 'That match is already under way. Ask the host to finish first.',
};
export function refusal(why) {
  return { t: 'refused', why, reason: REFUSALS[why] ?? 'The host could not seat you.' };
}

// Older hosts send only the text.
export function refusalKind(msg) {
  if (msg?.why) return msg.why;
  const r = String(msg?.reason ?? '');
  if (/full/i.test(r)) return 'full';
  if (/under way|in progress/i.test(r)) return 'started';
  return 'other';
}

function ageText(ms) {
  const h = Math.round(ms / 3600e3);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} days`;
}

const PROBLEMS = {
  full: (c) => ({ title: 'Room full', body: `Room ${c} already has a full squad on both sides. Ask the host to make space, then try again.`, mark: 'team' }),
  started: (c) => ({ title: 'Match under way', body: `Room ${c} is mid-match. You can get in once the host is back in the lobby. If you were already playing in it, rejoin from the same app you played in.`, mark: 'wait' }),
  notfound: (c) => ({ title: 'Room not found', body: `Nobody is hosting ${c} right now. The host may have left the lobby, or this invite is old. Ask them for a fresh link.`, mark: 'warn' }),
  expired: (c, age) => ({ title: 'Invite expired', body: `This invite to ${c} is ${ageText(age)} old, and rooms close when the host leaves. Ask for a fresh link, or try it anyway.`, mark: 'timer' }),
  badlink: () => ({ title: 'Broken invite', body: 'That link does not hold a room code. Ask the host for the 4-letter code and enter it.', mark: 'warn' }),
  other: (c) => ({ title: 'Could not join', body: `The host of ${c} could not seat you.`, mark: 'warn' }),
};

// A sheet over the title screen explaining why a join did not happen, with the ways forward that make sense.
// opts: { why, code, age?, reason?, retry?, enterCode?, back? }. Buttons appear only for the handlers given.
export function showJoinProblem(menu, { why, code, age = 0, reason = '', retry, enterCode, back }) {
  stopWaiting();
  const make = PROBLEMS[why] ?? PROBLEMS.other;
  const p = make(code, age);
  const body = why === 'other' && reason ? reason : p.body;
  const canWait = why === 'started' && retry;
  const tiles = validCode(code) ? `<div class="code-tiles${why === 'notfound' || why === 'expired' ? ' bad' : ''}">${[...code].map(c => `<b>${esc(c)}</b>`).join('')}</div>` : '';
  menu.overlay(`
    <div class="sheet slim inv-problem" data-why="${esc(why)}">
      <div class="err-mark${why === 'started' || why === 'full' ? ' soft' : ''}">${ico(p.mark)}</div>
      <h2>${esc(p.title)}</h2>
      ${tiles}
      <p>${esc(body)}</p>
      ${canWait ? '<p class="inv-wait" hidden></p>' : ''}
      <div class="sheet-row">
        <button class="btn" data-act="ipBack">${ico('back')}<b>Back</b></button>
        ${enterCode ? `<button class="btn" data-act="ipCode">${ico('edit')}<b>Enter code</b></button>` : ''}
        ${canWait ? `<button class="btn" data-act="ipWait">${ico('wait')}<b>Wait for it</b></button>` : ''}
        ${retry ? `<button class="btn is-primary" data-sound="confirm" data-act="ipRetry">${ico('retry')}<b>${why === 'expired' ? 'Try anyway' : 'Try again'}</b></button>` : ''}
      </div>
    </div>`);
  const close = () => { stopWaiting(); menu.overlay(''); };
  menu.on({
    ipBack: () => { waiting = null; close(); back?.(); },
    ipCode: () => { waiting = null; close(); enterCode(); },
    ipRetry: () => { close(); retry(); },
    ipWait: () => startWaiting(menu, code, retry),
  });
  // Already waiting on this room: keep counting rather than make them tap again.
  if (canWait && waiting?.code === code) startWaiting(menu, code, retry);
}

function startWaiting(menu, code, retry) {
  stopWaiting();
  waiting = { code, timer: 0, left: WAIT_RETRY_S };
  const line = menu.overlayEl.querySelector('.inv-wait');
  const btn = menu.overlayEl.querySelector('[data-act="ipWait"]');
  if (btn) btn.hidden = true;
  const paint = () => { if (line) { line.hidden = false; line.textContent = `Checking again in ${waiting.left} s. You join as soon as the lobby opens.`; } };
  paint();
  waiting.timer = setInterval(() => {
    if (!waiting) return;
    if (--waiting.left > 0) return paint();
    clearInterval(waiting.timer);
    menu.overlay('');
    retry();
  }, 1000);
}

function stopWaiting() {
  if (waiting) clearInterval(waiting.timer);
}

// For main.js: the room took this player, so any wait or pending invite is over.
export function inviteSettled() {
  stopWaiting();
  waiting = null;
  pending = null;
}

// ---- Safari versus the Home Screen app --------------------------------------------------------------------------

// Opened from a link in iOS Safari: if they also have the Home Screen app, they may want to play there instead.
// Non-blocking, dismissible, gone by itself after a few seconds. Lives outside the scaled menu layer.
export function showHomeScreenNote(code, { force = false } = {}) {
  if (!force && (!isIOS() || isStandalone())) return;
  document.querySelector('.inv-note')?.remove();
  const note = document.createElement('div');
  note.className = 'inv-note';
  note.setAttribute('role', 'status');
  note.innerHTML = `<span>${ico('phone')}<span>Joining in Safari. Have the Home Screen app? Open it, tap <b>Join</b>, enter <b class="inv-note-code">${esc(code)}</b>.</span></span>
    <button class="inv-note-copy" data-tap="invNoteCopy" data-sound="tap">${ico('copy')}<b>Copy code</b></button>
    <button class="inv-note-x" data-tap="invNoteClose" data-sound="back" aria-label="Dismiss">${ico('close')}</button>`;
  const remove = () => {
    clearTimeout(timer);
    note.classList.add('out');
    setTimeout(() => note.remove(), 260);
  };
  let timer = setTimeout(remove, NOTE_MS);
  note.addEventListener('click', e => {
    const t = e.target.closest('[data-tap]');
    if (!t) return;
    if (t.dataset.tap === 'invNoteClose') return remove();
    copyText(code).then(ok => {
      t.querySelector('b').textContent = ok ? 'Copied' : code;
      clearTimeout(timer);
      timer = setTimeout(remove, 3000);
    });
  });
  document.body.appendChild(note);
}
