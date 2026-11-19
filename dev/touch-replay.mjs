// Replays a touch report (Options > Record touches, then Stick died?) through js/ui/controls.js, event for event, on
// the phone's own clock, and says where the move stick let go of a thumb that was still on the glass.
// Used by dev/touch-replay.html (paste a code) and dev/ui-touch-test.py (window.replayTouches).
//
// Each touch event is rebuilt as a TouchEvent with the recorded identifiers, coordinates, targets (a stand-in element
// per recorded target, marked as a HUD tap target or detached when it was) and event time; performance.now() reads the
// recorded handling time. Frames between events call read() at the recorded frame times, so the timed let-gos in read()
// happen when they did. After every step the controls' decision (stickSig) is compared with what the phone recorded.

import { Controls } from '../js/ui/controls.js';
import { decodeReport, restoreSnapshot, applyGeometry, stickSig } from '../js/ui/touchrec.js';

let clock = 0;
performance.now = () => clock;

const TYPES = { s: 'touchstart', m: 'touchmove', e: 'touchend', c: 'touchcancel' };
const ids = list => list.map(t => t[0]).join(' ') || '-';

let controls = null, host = null;
function setup() {
  if (controls) return;
  const root = document.createElement('div');
  root.className = 'replay-root';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:.25';
  document.body.appendChild(root);
  controls = new Controls(root);
  host = document.createElement('div');
  host.className = 'replay-targets';
  document.body.appendChild(host);
}

const leftOf = sig => sig.match(/^L(\S+)/)?.[1] ?? '-';

export async function replayTouches(codeOrReport, { quiet = false } = {}) {
  setup();
  const report = typeof codeOrReport === 'string' ? await decodeReport(codeOrReport) : codeOrReport;
  const ring = report.ring, names = report.names ?? [];
  if (ring[0]?.[0] !== 'K') throw new Error('A report starts with a checkpoint');
  const c = controls;
  const lines = [], mismatches = [], steps = [];
  const out = text => lines.push(text);
  const t0 = ring[0][1];
  const rel = t => `+${(t - t0).toFixed(0).padStart(5)}ms`;
  c.debug = text => out(`${rel(clock)}   replay: ${text}`);

  // Stand-in touch targets, one per recorded node; the controls' detached-node listeners are on each from the start.
  const els = new Map();
  const elFor = i => {
    if (i < 0) return host;
    let el = els.get(i);
    if (!el) {
      el = document.createElement('div');
      const [tag, cls] = String(names[i] ?? 'div').split('.');
      el.className = `rt-${tag}${cls ? ' ' + cls : ''}`;
      el.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px';
      host.appendChild(el);
      for (const type of ['touchmove', 'touchend', 'touchcancel']) el.addEventListener(type, c.onDetached, { passive: false });
      c.watched.add(el);
      els.set(i, el);
    }
    return el;
  };
  const touch = ([id, x, y, tf]) => {
    const el = elFor((tf >> 2));
    if (tf & 1) el.setAttribute('data-tap', '1'); else el.removeAttribute('data-tap');
    el.classList.toggle('tuner', !!(tf & 2));
    return new Touch({ identifier: id, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
  };

  clock = ring[0][1];
  c.setEnabled(false);
  restoreSnapshot(c, ring[0][2]);
  let recSig = ring[0][3];
  out(`${rel(clock)} start  ${recSig}  (build ${report.build || '?'}, ${report.screen?.join('x') ?? ''})`);

  // Where the move stick let go of a finger, and what that finger did afterwards.
  let held = leftOf(stickSig(c));
  const losses = [];
  let lastEvent = '';
  const lastXY = new Map();        // Finger id -> its last reported place, from any list.

  for (let i = 1; i < ring.length; i++) {
    const en = ring[i], kind = en[0];
    if (TYPES[kind]) {
      const [, t, d, tg, flags, ch, all] = en;
      clock = t + d;
      const target = elFor(tg);
      if (flags & 2) target.remove(); else if (!target.isConnected) host.appendChild(target);
      const changed = ch.map(touch), touches = all.map(touch);
      const ev = new TouchEvent(TYPES[kind], { bubbles: true, cancelable: true, composed: true, changedTouches: changed, touches, targetTouches: touches });
      Object.defineProperty(ev, 'timeStamp', { value: t });
      target.dispatchEvent(ev);
      if (en[7]) recSig = en[7];
      for (const x of all) lastXY.set(x[0], [x[1], x[2]]);
      for (const x of ch) lastXY.set(x[0], [x[1], x[2]]);
      lastEvent = `${TYPES[kind].replace('touch', '')} ch[${ids(ch)}] all[${ids(all)}] on ${names[tg] ?? '?'}${flags & 1 ? ' DETACHED' : ''}`;
      // A finger the stick let go of that is still listed, or moves, is a thumb still down: the stick died under it.
      for (const loss of losses) {
        if (loss.back || loss.closed) continue;
        // Its identifier landing again is a new finger; its own end closes the story after this event.
        if (kind === 's' && ch.some(x => x[0] === loss.id)) { loss.closed = true; continue; }
        if ((kind === 'e' || kind === 'c') && ch.some(x => x[0] === loss.id)) loss.closed = true;
        const listed = all.find(x => x[0] === loss.id);
        if (!listed) continue;
        loss.listed++;
        loss.lastSeen = t;
        // Stale lists repeat a lifted finger's last place exactly; a place that changes is a thumb still moving.
        if (loss.xy && (listed[1] !== loss.xy[0] || listed[2] !== loss.xy[1])) loss.moves++;
        loss.xy = [listed[1], listed[2]];
      }
    } else if (kind === 'F') {
      const [, a, b, n] = en;
      for (let k = 0; k < n; k++) { clock = n === 1 ? a : a + (b - a) * k / (n - 1); c.read(); }
      if (en[4]) recSig = en[4];
      lastEvent = `frame${n > 1 ? ` x${n}` : ''}`;
    } else if (kind === 'N') {
      if (!quiet) out(`${rel(en[1])}   phone:  ${en[2]}`);
      continue;
    } else if (kind === 'E') {
      clock = en[1];
      c.setEnabled(!!en[2]);
      out(`${rel(en[1])} controls ${en[2] ? 'on' : 'off'}`);
    } else if (kind === 'Q') {
      Object.assign(c.equip[en[2]], { kind: en[3], left: en[4] });
    } else if (kind === 'D') {
      c.detonate = !!en[2];
    } else if (kind === 'G') {
      applyGeometry(c, en[2]);
    } else if (kind === 'K') {
      recSig = en[3];
    }
    const mine = stickSig(c);
    steps.push({ i, kind, rec: recSig, replay: mine });
    if (mine !== recSig) {
      mismatches.push({ i, at: (en[1] ?? 0) - t0, rec: recSig, replay: mine });
      if (mismatches.length <= 20) out(`${rel(clock)} MISMATCH after ${lastEvent}: phone ${recSig} / replay ${mine}`);
    }
    const now = leftOf(mine);
    if (now !== held) {
      out(`${rel(clock)} L ${held} -> ${now}  after ${lastEvent}`);
      if (held !== '-') losses.push({ id: Number(held), at: clock, cause: lastEvent, listed: 0, moves: 0, lastSeen: null, back: false, xy: lastXY.get(Number(held)) ?? null });
      for (const loss of losses) if (String(loss.id) === now && !loss.closed) loss.back = true;
      held = now;
    }
  }

  const died = [];
  for (const loss of losses) {
    const tail = loss.back ? 'the stick picked it up again'
      : loss.moves ? `but the finger stayed down: it moved ${loss.moves} times in ${loss.listed} later events, until ${rel(loss.lastSeen)}`
        : loss.listed ? `and the finger stayed listed in ${loss.listed} later events without moving (stale lists, or a perfectly still thumb)`
        : 'and the finger never showed again (a real lift)';
    const dead = !loss.back && loss.moves > 0;
    if (dead) died.push(loss);
    out(`${dead ? 'STICK DIED' : 'let go    '} #${loss.id} at ${rel(loss.at)} on ${loss.cause}, ${tail}`);
  }
  if (!losses.length) out('The move stick never let go of a finger in this report.');
  out(mismatches.length ? `${mismatches.length} steps where the replay decided differently from the phone (first at +${mismatches[0].at.toFixed(0)}ms)` : `Replay matches the phone at all ${steps.length} steps.`);
  return { lines, mismatches, steps, losses, died, entries: ring.length };
}

if (typeof window !== 'undefined') window.replayTouches = replayTouches;
