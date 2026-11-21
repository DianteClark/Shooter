// In-match music: one theme per kind of match, each in four intensity levels, written as code that emits one bar of
// notes at a time for the sequencer (music-seq.js). And pickTheme, the small state machine that decides from the
// match view which theme and level should be playing.
//
// Levels, in every theme:  0 the bed (pads, sub, texture)   1 the pulse comes in (bass, light drums)
//                          2 the full groove                 3 the peak (the lead, crashes, fills)
//
// Everything is original. The themes share the game's key family (D minor, with neighbours) and the title motif
// (music-synth.js MOTIF), quoted on the lead at the peaks, so the match music sounds like the same game as the menu.
// bar(b, L, e): b counts bars from the theme's start; e(channel, beat, note, beats held, velocity).
import { CH, ROOT, MOTIF } from './music-synth.js';

// ---- Writing helpers. Patterns are parsed once, here, never per bar. ----
// 16 steps a bar: x full, o soft, - ghost, . rest. -> flat [beat, vel, beat, vel, ...]
const pat = s => { const a = []; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '.' || c === ' ') continue; a.push(i / 4, c === 'x' ? 1 : c === 'o' ? 0.6 : 0.3); } return a; };
function hits(e, ch, p, v = 1, n = 0) { for (let i = 0; i < p.length; i += 2) e(ch, p[i], n, 0, p[i + 1] * v); }
function chord(e, ch, ns, len, v, beat = 0, shift = 0) { for (let i = 0; i < ns.length; i++) e(ch, beat, ns[i] + shift, len, v); }
// A bass figure: offsets from the root, one per step of `step` beats.
function figure(e, ch, root, offs, step, v, len = step * 0.85, accent = 1) {
  for (let i = 0; i < offs.length; i++) { const o = offs[i]; if (o === null) continue; e(ch, i * step, root + o, len, (i * step) % accent === 0 ? v : v * 0.72); }
}
// Up-down arpeggio over a chord, `n` notes `step` beats apart.
function arp(e, ch, ns, n, step, v, shift = 12, order = ARP_UPDOWN) {
  for (let i = 0; i < n; i++) e(ch, i * step, ns[order[i % order.length] % ns.length] + shift, step, i % 4 === 0 ? v : v * 0.7);
}
const ARP_UPDOWN = [0, 1, 2, 1];
const ARP_UP = [0, 1, 2];
// The title motif, split into its four bars: [beat, note, beats] each.
const MOTIF_BARS = [0, 1, 2, 3].map(k => MOTIF.filter(m => m[0] === k).map(m => [m[1], m[2], m[3]]));
function motif(e, ch, k, shift, v) { const m = MOTIF_BARS[k & 3]; for (let i = 0; i < m.length; i++) e(ch, m[i][0], m[i][1] + shift, m[i][2], v); }
// A melody line: [beat, note, beats, ...] flat.
function mel(e, ch, a, v, shift = 0) { for (let i = 0; i < a.length; i += 3) e(ch, a[i], a[i + 1] + shift, a[i + 2], v); }
// A tom fill down the last two beats.
const FILL = pat('........x.x.x.xx');
function fill(e, v = 0.6, top = 50) { for (let i = 0; i < FILL.length; i += 2) e('tom', FILL[i], top - i, 0, FILL[i + 1] * v); }
// Rail joints: the double knock of a wheel set crossing a joint (the menu theme's signature).
function joints(e, v = 0.4) { e('clank', 3.5, 0, 0, v * 0.7); e('clank', 3.75, 0, 0, v); }

// Chords used below, close-voiced around middle C so they move by step. Roots for the bass (an octave under the sub).
const C = {
  ...CH,
  Cm: [55, 60, 63], Ab: [56, 60, 63], Fm: [56, 60, 65], Am: [57, 60, 64], Em: [55, 59, 64], Bm: [54, 59, 62],
  Bdim: [53, 59, 62], E: [56, 59, 64], Db: [56, 61, 65], Abm: [56, 59, 63], Ddim: [56, 62, 65], Gsus: [55, 60, 62],
};
const R = { ...ROOT, Cm: 36, Ab: 32, Fm: 41, Am: 33, Em: 40, Bm: 35, Bdim: 35, E: 40, Db: 37, Abm: 32, Ddim: 38, Gsus: 31 };

// Common drum patterns.
const K4 = pat('x...x...x...x...'), K2 = pat('x.......x.......'), K1 = pat('x...............'), KB = pat('x.....x...x.....');
const KH = pat('x.........x.....');
const SN = pat('....x.......x...'), SN3 = pat('........x.......'), SNF = pat('....x.......x.-x');
const H8 = pat('o.o.o.o.o.o.o.o.'), H16 = pat('xoxoxoxoxoxoxoxo'), HOFF = pat('..x...x...x...x.'), H8S = pat('-.o.-.o.-.o.-.o.');
const RIM16 = pat('o-o-o-o-o-o-o-o-'), RIM8 = pat('o.-.o.-.o.-.o.-.');
const MARCH = pat('x.-x..x.x.-x.x--'), TOMS = pat('x..x..x...x.x...'), HEART = pat('x..o............');

// ---- The themes. ----
export const THEMES = {
  // Standard 6 v 6 (Team Deathmatch, Domination, Hardpoint, Kill Confirmed and the rest): "Switchyard Run". Driving
  // and bright in D minor, the rail joints on every bar line, the motif on the lead at the peak.
  tdm: {
    bpm: 104, gain: 0.95,
    bar(b, L, e) {
      const k = b & 7, ch = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'][k], ns = C[ch], r = R[ch];
      chord(e, L >= 2 ? 'pad' : 'dark', ns, 4, L >= 2 ? 0.6 : 0.75);
      if (L <= 1) e('sub', 0, r, 4, 0.7);
      joints(e, L >= 2 ? 0.45 : 0.35);
      if (L >= 1) { figure(e, 'bass', r, [0, 0, 12, 0, 0, 12, 0, 7], 0.5, 0.7); hits(e, 'hat', L >= 2 ? H16 : H8, 0.7); }
      if (L === 1) hits(e, 'kick', K2, 0.8);
      if (L >= 2) {
        hits(e, 'kick', L >= 3 ? K4 : KB, 0.9); hits(e, 'snare', k === 7 ? SNF : SN, 0.75);
        arp(e, 'pluck', ns, 8, 0.5, 0.45);
      }
      if (L >= 3) {
        if (k >= 4) motif(e, 'lead', k - 4, -12, 0.7);
        if (k === 0) e('crash', 0, 0, 0, 0.7);
        if (k === 7) fill(e, 0.55);
      }
    },
  },

  // Ranked: "Ladder". Colder and tighter: C minor techno, four on the floor from the first level, rolling bass on the
  // off sixteenths, bell blips, tremolo strings and the motif at the peak.
  ranked: {
    bpm: 122, gain: 0.9,
    bar(b, L, e) {
      const k = b & 7, ch = ['Cm', 'Cm', 'Ab', 'Bb', 'Cm', 'Cm', 'Fm', 'Bb'][k], ns = C[ch], r = R[ch];
      if ((k & 1) === 0) chord(e, 'dark', ns, 8, 0.7);
      hits(e, 'rim', RIM16, L === 0 ? 0.25 : 0.35);
      if (L === 0) e('sub', 0, r, 4, 0.7);
      if ((k & 3) === 1) e('bell', 2.5, ns[2] + 24, 0, 0.35);
      if (L >= 1) { hits(e, 'kick', K4, 0.85); hits(e, 'ohat', HOFF, 0.6); figure(e, 'bass', r, [null, 0, 12, 0, null, 0, 12, 0, null, 0, 12, 0, null, 0, 12, 3], 0.25, 0.65); }
      if (L >= 2) { hits(e, 'snare', SN, 0.6); hits(e, 'hat', H16, 0.5); for (const bt of [0.5, 1.75, 3]) chord(e, 'pluck', ns, 0.25, 0.32, bt, 12); }
      if (L >= 3) {
        chord(e, 'trem', ns, 4, 0.45, 0, 12);
        if (k >= 4) motif(e, 'lead', k - 4, -14, 0.6);
        if (k === 7) e('riser', 2, 0, 0, 0.5);
        if (k === 0) e('crash', 0, 0, 0, 0.6);
      }
    },
  },

  // Rounds with one life (Search and Destroy, Control, Showdown, One in the Chamber): "Clockwork". A ticking clock, a
  // low heartbeat, A minor with a Phrygian half step; half-time drums when it gets close.
  tactical: {
    bpm: 90, gain: 0.95,
    bar(b, L, e) {
      const k = b & 3, ch = ['Am', 'Am', 'F', 'E'][k], ns = C[ch], r = R[ch];
      chord(e, 'dark', ns, 4, 0.7);
      hits(e, 'rim', RIM8, 0.3 + 0.08 * L);
      e('sub', 0, r, L >= 2 ? 2 : 4, 0.65);
      if (L >= 1) { hits(e, 'tom', HEART, 0.5, 40); if (k === 1 || k === 3) e('bell', 1.5, k === 3 ? 80 : 76, 0, 0.3); }
      if (L >= 2) { hits(e, 'kick', KH, 0.85); hits(e, 'snare', SN3, 0.65); figure(e, 'bass', r, [0, null, 0, 1, null, 0, null, 0], 0.5, 0.6); }
      if (L >= 3) { chord(e, 'trem', ns, 4, 0.4, 0, 12); hits(e, 'hat', H16, 0.45); if (k === 3) e('riser', 2, 0, 0, 0.45); }
    },
  },

  // Ground War: "Front Line". Slow and wide: war drums, booms, big chords two bars each, a march on the snare, the
  // motif in octaves at the peak.
  gw: {
    bpm: 84, gain: 1,
    bar(b, L, e) {
      const k = b & 7, ch = ['Dm', 'Dm', 'Gm', 'Gm', 'Bb', 'Bb', 'A', 'A'][k], ns = C[ch], r = R[ch];
      if ((k & 1) === 0) { chord(e, L >= 2 ? 'pad' : 'dark', ns, 8, 0.7); e('sub', 0, r, 8, L >= 1 ? 0.55 : 0.75); }
      if ((b & 3) === 0) e('wind', 0, 0, 0, L >= 2 ? 0.3 : 0.5);
      if (L >= 1) { e('boom', 0, 0, 0, 0.8); hits(e, 'tom', TOMS, 0.55, 43); if ((k & 1) === 1) e('boom', 2.5, 0, 0, 0.5); }
      if (L >= 2) { hits(e, 'snare', MARCH, 0.5); hits(e, 'kick', K2, 0.8); figure(e, 'bass', r, [0, null, null, 0, 0, null, 7, null], 0.5, 0.6, 0.9); }
      if (L >= 3) {
        if (k >= 4) { motif(e, 'lead', k - 4, -12, 0.65); motif(e, 'pluck', k - 4, 0, 0.35); }
        else chord(e, 'trem', ns, 4, 0.35, 0, 12);
        if (k === 0) e('crash', 0, 0, 0, 0.75);
        if (k === 7) fill(e, 0.6, 47);
      }
    },
  },

  // Battle royale, in the air: "Drop Zone". Four on the floor, octave bass, the wind through the door, the motif.
  brdrop: {
    bpm: 124, gain: 0.9,
    bar(b, L, e) {
      const k = b & 7, ch = ['Dm', 'Bb', 'Gm', 'A'][k & 3], ns = C[ch], r = R[ch] + 12;
      chord(e, 'pad', ns, 4, 0.55);
      if ((k & 3) === 0) e('wind', 0, 0, 0, 0.55);
      hits(e, 'kick', K4, 0.9); hits(e, 'snare', SN, 0.6); hits(e, 'ohat', HOFF, 0.55);
      figure(e, 'bass', r - 12, [0, 12, 0, 12, 0, 12, 0, 12], 0.5, 0.7);
      if (k < 4) motif(e, 'pluck', k, 0, 0.5); else if (L >= 3) motif(e, 'lead', k - 4, -12, 0.65);
      if (k === 0) e('crash', 0, 0, 0, 0.55);
      if (k === 7) e('riser', 2, 0, 0, 0.4);
    },
  },

  // Battle royale on the ground: "Island". Calm at the start (wind, a bell, a slow pad in A minor), tension building
  // as the circle closes: the pulse, then drums and tremolo strings.
  br: {
    bpm: 96, gain: 0.95,
    bar(b, L, e) {
      const k = b & 7, ch = ['F', 'G', 'Am', 'Am', 'F', 'G', 'Em', 'Am'][k], ns = C[ch], r = R[ch];
      chord(e, L >= 2 ? 'pad' : 'dark', ns, 4, 0.6);
      if ((k & 1) === 0) e('wind', 0, 0, 0, L === 0 ? 0.5 : 0.3);
      e('sub', 0, r, 4, L >= 2 ? 0.45 : 0.6);
      // A few bell notes from the pentatonic, the same ones each time round.
      const bell = [[1, 76], [2.5, 72], [0.5, 69], [3, 74], [1.5, 79], [0, 76], [2, 72], [3.5, 69]][k];
      if (L <= 1 || (k & 1)) e('bell', bell[0], bell[1], 0, 0.3);
      if (L >= 1) { hits(e, 'hat', H8S, 0.6); figure(e, 'bass', r, [0, null, null, null, 7, null, null, null], 0.5, 0.55, 1.6); arp(e, 'pluck', ns, 4, 1, 0.3); }
      if (L >= 2) { hits(e, 'kick', KB, 0.8); hits(e, 'snare', SN, 0.55); chord(e, 'trem', ns, 4, 0.3, 0, 12); figure(e, 'bass', r, [null, 0, 12, 0, null, 0, 12, 0], 0.5, 0.45); }
      if (L >= 3) { hits(e, 'hat', H16, 0.4); if (k >= 4) motif(e, 'lead', k - 4, -17, 0.6); if (k === 0) e('crash', 0, 0, 0, 0.6); if (k === 7) fill(e, 0.5); }
    },
  },

  // Battle royale, final circle: "Last Circle". Tremolo strings on the title's chords, toms and booms, a riser into
  // every phrase; at the very end (a few squads left) four on the floor and the motif.
  brfinal: {
    bpm: 112, gain: 0.95,
    bar(b, L, e) {
      const k = b & 7, ch = ['Dm', 'Bb', 'Gm', 'A'][k & 3], ns = C[ch], r = R[ch];
      chord(e, 'trem', ns, 4, 0.6, 0, 12); chord(e, 'dark', ns, 4, 0.5);
      e('boom', 0, 0, 0, 0.75);
      hits(e, 'tom', TOMS, 0.6, (k & 3) === 3 ? 45 : 43);
      figure(e, 'bass', r, [0, null, 0, 0, null, 0, 1, 0], 0.5, 0.65);
      if (k === 7) e('riser', 2, 0, 0, 0.5);
      if (L >= 3) { hits(e, 'kick', K4, 0.85); hits(e, 'snare', SN, 0.7); hits(e, 'hat', H16, 0.5); if (k >= 4) motif(e, 'lead', k - 4, -12, 0.65); if (k === 0) e('crash', 0, 0, 0, 0.7); }
    },
  },

  // Extraction: "Contract". Industrial and patient in E minor: a clanking ostinato in threes, a muted pluck figure,
  // the groove when the shooting starts.
  ex: {
    bpm: 100, gain: 0.95,
    bar(b, L, e) {
      const k = b & 7, ch = ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'Am', 'Bm'][k], ns = C[ch], r = R[ch];
      chord(e, 'dark', ns, 4, 0.65);
      hits(e, 'clank', EX_CLANK, 0.3);
      mel(e, 'pluck', EX_OST, 0.25 + 0.05 * L, (r % 12) - 4);
      if (L === 0) e('sub', 0, r, 4, 0.6);
      if (L >= 1) { hits(e, 'rim', RIM8, 0.35); figure(e, 'bass', r, [0, null, null, 0, null, null, 0, 12], 0.5, 0.6); }
      if (L >= 2) { hits(e, 'kick', KB, 0.85); hits(e, 'snare', SN, 0.65); hits(e, 'hat', H16, 0.45); }
      if (L >= 3) { chord(e, 'trem', ns, 4, 0.35, 0, 12); if (k >= 4) mel(e, 'lead', EX_LEAD[k - 4], 0.55); if (k === 7) fill(e, 0.55, 52); }
    },
  },

  // Exfil called: "Dust Off". Urgent: a sixteenth pulse with a half-step rub, four on the floor, rising lead swells,
  // the rotor wash in the wind, a riser into every phrase.
  exfil: {
    bpm: 128, gain: 0.9,
    bar(b, L, e) {
      const k = b & 7, rr = [40, 40, 36, 38, 40, 40, 43, 42][k];
      chord(e, 'dark', [rr + 15, rr + 19, rr + 22].map(n => n > 67 ? n - 12 : n), 4, 0.55);
      figure(e, 'bass', rr, EXFIL_BASS, 0.25, 0.7, 0.2);
      hits(e, 'kick', K4, 0.9); hits(e, 'snare', SN, 0.65); hits(e, 'hat', H16, 0.5);
      if ((k & 1) === 0) e('lead', 0, rr + 24 + (k === 6 ? 1 : 0), 7.5, 0.4);
      if ((k & 3) === 0) e('wind', 0, 0, 0, 0.35);
      if (k === 7) e('riser', 2, 0, 0, 0.55);
      if (k === 0) e('crash', 0, 0, 0, 0.6);
      if (L >= 3) { chord(e, 'trem', [rr + 27, rr + 31, rr + 34].map(n => n > 79 ? n - 12 : n), 4, 0.4); hits(e, 'tom', TOMS, 0.5, 45); }
    },
  },

  // Graveyard Shift: "Night Shift". Eerie: a music box out of tune with itself over D minor and a tritone, wind, a
  // heartbeat. Each level is a few more rounds survived: the heartbeat, then tremolo and toms, then a march.
  zm: {
    bpm: 72, gain: 1,
    bar(b, L, e) {
      const k = b & 7, ch = ['Dm', 'Dm', 'Ab', 'Ab', 'Dm', 'Bb', 'Ddim', 'A'][k], ns = C[ch], r = R[ch];
      chord(e, 'dark', ns, 4, 0.7);
      e('sub', 0, r, 4, 0.55);
      if ((k & 1) === 0) e('wind', 0, 0, 0, 0.45);
      mel(e, 'bell', ZM_BOX[k & 3], 0.32, k >= 4 ? 1 : 0);      // The second time round, a half step sour.
      if (L >= 1) hits(e, 'boom', HEART, 0.6);
      if (L >= 2) { chord(e, 'trem', [ns[0] + 12, ns[0] + 18], 4, 0.3); hits(e, 'tom', TOMS, 0.45, 40); figure(e, 'bass', r, [0, null, 0, null, 0, null, 6, null], 0.5, 0.5); }
      if (L >= 3) { hits(e, 'snare', MARCH, 0.45); hits(e, 'kick', K2, 0.8); if (k >= 4) mel(e, 'lead', ZM_LEAD[k - 4], 0.5); if (k === 7) fill(e, 0.5, 44); }
    },
  },

  // A Graveyard Shift boss round: "The Warden". Half-time booms, a tritone cluster on tremolo, a chromatic lead
  // falling, snare rolls.
  zmboss: {
    bpm: 76, gain: 1,
    bar(b, L, e) {
      const k = b & 3;
      chord(e, 'trem', [62, 63, 68], 4, 0.5); chord(e, 'dark', [50, 56, 62], 4, 0.55);
      e('boom', 0, 0, 0, 0.9); e('boom', 2, 0, 0, 0.7);
      figure(e, 'bass', 26, [0, 0, 0, 6, 0, 0, 1, 0, 0, 0, 0, 6, 0, 1, 0, 6], 0.25, 0.7, 0.2);
      hits(e, 'tom', TOMS, 0.55, 41);
      hits(e, 'snare', k === 3 ? pat('x-x-x-x-xxxxxxxx') : SN3, 0.6);
      mel(e, 'lead', BOSS_LEAD[k], 0.55);
      if (L >= 3) { hits(e, 'hat', H16, 0.45); hits(e, 'kick', K4, 0.8); }
      if (k === 0) e('crash', 0, 0, 0, 0.65);
    },
  },

  // The campaign. Each mission picks one of these (MISSION_MOOD) and a key of its own.
  // Stealth and infiltration: "Quiet Hours". A clock and a held breath; the alarm brings the drums in.
  cpstealth: {
    bpm: 80, gain: 1,
    bar(b, L, e) {
      const k = b & 3, ch = ['Dm', 'Dm', 'Bb', 'A'][k], ns = C[ch], r = R[ch];
      chord(e, 'dark', ns, 4, 0.6);
      e('sub', 0, r, 4, 0.5);
      hits(e, 'rim', RIM8, 0.25);
      if (k === 2) e('bell', 2, 81, 0, 0.25);
      if (L >= 1) { arp(e, 'pluck', ns, 8, 0.5, 0.22, 0, ARP_UP); hits(e, 'kick', K1, 0.6); }
      if (L >= 2) { figure(e, 'bass', r, [0, 0, 0, 0, 0, 0, 1, 0], 0.5, 0.6, 0.3); chord(e, 'trem', ns, 4, 0.35, 0, 12); hits(e, 'tom', TOMS, 0.45, 43); hits(e, 'snare', SN3, 0.5); }
      if (L >= 3) { hits(e, 'kick', KB, 0.8); hits(e, 'hat', H16, 0.45); if (k === 3) fill(e, 0.5); }
    },
  },

  // Assault, defence, escort, sabotage: "Nightrail". A train at speed: steady eighths on the bass, rail joints,
  // the motif on the lead at the peak.
  cpaction: {
    bpm: 112, gain: 0.95,
    bar(b, L, e) {
      const k = b & 7, ch = ['Dm', 'C', 'Bb', 'A', 'Dm', 'C', 'Gm', 'A'][k], ns = C[ch], r = R[ch];
      chord(e, L >= 2 ? 'pad' : 'dark', ns, 4, 0.6);
      joints(e, 0.45);
      figure(e, 'bass', r, [0, 0, 0, 0, 0, 0, 0, 0], 0.5, L >= 1 ? 0.65 : 0.4, 0.4);
      if (L >= 1) { hits(e, 'hat', H8, 0.6); hits(e, 'kick', K2, 0.8); }
      if (L >= 2) { hits(e, 'snare', k === 7 ? SNF : SN, 0.7); hits(e, 'kick', KB, 0.7); arp(e, 'pluck', ns, 8, 0.5, 0.35); }
      if (L >= 3) { if (k >= 4) motif(e, 'lead', k - 4, -12, 0.65); if (k === 0) e('crash', 0, 0, 0, 0.65); hits(e, 'hat', H16, 0.4); }
    },
  },

  // The chase: "Dead Man's Run". Fast: a sixteenth bass, toms, tremolo, everything leaning forward.
  cpchase: {
    bpm: 140, gain: 0.9,
    bar(b, L, e) {
      const k = b & 7, ch = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'][k], ns = C[ch], r = R[ch];
      chord(e, 'trem', ns, 4, 0.4, 0, 12);
      figure(e, 'bass', r, [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12, 0, 7], 0.25, 0.65, 0.2);
      hits(e, 'kick', K4, 0.85); hits(e, 'hat', H16, 0.5);
      if (L >= 1) hits(e, 'snare', k === 7 ? SNF : SN, 0.7);
      if (L >= 2) hits(e, 'tom', TOMS, 0.45, 45);
      if (L >= 3 && k >= 4) motif(e, 'lead', k - 4, -12, 0.6);
      if (k === 0) e('crash', 0, 0, 0, 0.55);
      if (k === 7) e('riser', 2, 0, 0, 0.45);
    },
  },

  // The campaign's last fight: "Iron Crown". A march for the juggernaut: booms, the tritone on tremolo, the motif
  // turned heavy on the lead; his last phase adds four on the floor.
  cpboss: {
    bpm: 96, gain: 1,
    bar(b, L, e) {
      const k = b & 7, ch = ['Dm', 'Dm', 'Ab', 'Ab', 'Bb', 'Bb', 'A', 'A'][k], ns = C[ch], r = R[ch];
      chord(e, 'trem', ns, 4, 0.5, 0, 12); chord(e, 'dark', ns, 4, 0.5);
      e('boom', 0, 0, 0, 0.85); if (k & 1) e('boom', 2, 0, 0, 0.6);
      hits(e, 'snare', MARCH, 0.55);
      figure(e, 'bass', r, [0, 0, 12, 0, 0, 6, 0, 12], 0.5, 0.65);
      if (k >= 4) motif(e, 'lead', k - 4, -13, 0.6);
      if (L >= 3) { hits(e, 'kick', K4, 0.85); hits(e, 'hat', H16, 0.45); }
      if (k === 0) e('crash', 0, 0, 0, 0.7);
      if (k === 7) fill(e, 0.6, 46);
    },
  },

  // Infected: "Outbreak". Horror synth in E Phrygian: a heartbeat, then a sixteenth pulse grinding on the half step,
  // four on the floor as the survivors thin out, a screaming lead for the last one.
  inf: {
    bpm: 118, gain: 0.95,
    bar(b, L, e) {
      const k = b & 3, ch = ['Em', 'Em', 'Fmaj', 'Em'][k];
      chord(e, 'dark', ch === 'Fmaj' ? [57, 60, 65] : C.Em, 4, 0.6);
      chord(e, 'trem', [76, 77], 4, 0.18 + 0.06 * L);
      hits(e, 'boom', HEART, 0.6);
      if (L >= 1) figure(e, 'bass', 28, INF_BASS, 0.25, 0.65, 0.18);
      if (L >= 2) { hits(e, 'kick', K4, 0.85); hits(e, 'rim', RIM16, 0.35); }
      if (L >= 3) { hits(e, 'snare', SN, 0.7); mel(e, 'lead', INF_LEAD[k], 0.55); if (k === 0) e('crash', 0, 0, 0, 0.6); }
    },
  },
};

// Melodic material for the themes above.
const EX_CLANK = pat('x..o..x...x..o..');
const EX_OST = [0, 64, 0.25, 0.75, 67, 0.25, 1.5, 71, 0.25, 2, 69, 0.25, 2.75, 67, 0.25, 3.5, 64, 0.25];
const EX_LEAD = [[0, 64, 1.5, 1.5, 67, 0.5, 2, 71, 2], [0, 69, 1, 1, 67, 1, 2, 64, 2], [0, 64, 1.5, 1.5, 67, 0.5, 2, 72, 2], [0, 71, 2, 2, 69, 1, 3, 66, 1]];
const EXFIL_BASS = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 1, 0, 13, 0];
const ZM_BOX = [[0, 86, 1, 1, 81, 1, 2, 82, 1, 3, 80, 1], [0, 86, 1, 1.5, 89, 0.5, 2, 86, 1, 3, 80, 1],
  [0, 84, 1, 1, 81, 1, 2, 77, 1, 3, 80, 1], [0, 81, 1, 1, 80, 1, 2, 74, 2]];
const ZM_LEAD = [[0, 50, 2, 2, 56, 2], [0, 53, 2, 2, 50, 2], [0, 56, 1.5, 1.5, 55, 0.5, 2, 50, 2], [0, 49, 2, 2, 50, 2]];
const BOSS_LEAD = [[0, 62, 1, 1, 61, 1, 2, 60, 1, 3, 59, 1], [0, 56, 2, 2, 55, 2], [0, 62, 0.5, 0.5, 63, 0.5, 1, 62, 1, 2, 56, 2], [0, 50, 4]];
const INF_BASS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 12];
const INF_LEAD = [[0, 64, 1.5, 1.5, 65, 0.5, 2, 64, 2], [0, 71, 1, 1, 70, 1, 2, 64, 2], [0, 65, 2, 2, 64, 2], [0, 76, 0.5, 0.5, 77, 0.5, 1, 76, 3]];

export const THEME_IDS = Object.keys(THEMES);

// ---- Which theme for which match. ----
// Campaign missions (js/shared/campaign.js MISSIONS, by number): their theme and key.
export const MISSION_MOOD = {
  1: ['cpstealth', 0],    // Switch Room: infiltrate and hack.
  2: ['cpstealth', -2],   // Quiet Hours: stealth.
  3: ['cpaction', 0],     // Seawall: defend.
  4: ['cpaction', 3],     // Kestrel: escort.
  5: ['cpaction', -2],    // Long Fuse: sabotage.
  6: ['cpstealth', 2],    // Kingfisher: the hunt.
  7: ['cpchase', 0],      // Dead Man's Run: the chase.
  8: ['cpaction', -1],    // Iron Crown: the boss's yard (cpboss when he is up).
};
const TACTICAL = new Set(['snd', 'ctl', 'gf', 'oic']);

// The base theme of a match, from what main.js knows when it starts (mode id, rules, ranked, Ground War, mission).
export function baseTheme(info) {
  const rules = info.rules ?? info.mode;
  if (info.mode === 'range' || info.mode === 'tutorial') return [null, 0];
  if (rules === 'br') return ['br', 0];
  if (rules === 'ex') return ['ex', 0];
  if (rules === 'zm') return ['zm', 0];
  if (rules === 'cp') return MISSION_MOOD[info.mission] ?? ['cpaction', 0];
  if (rules === 'inf') return ['inf', 0];
  if (info.ranked) return ['ranked', 0];
  if (info.large) return ['gw', 0];
  if (TACTICAL.has(rules)) return ['tactical', 0];
  return ['tdm', 0];
}

// The state machine. Called every frame by the director with scalars it already has; keeps its memory in `st`
// (made by newPickState) and writes the answer into st.theme / st.level / st.transpose. Returns a sting to play,
// or null. `now` is in seconds.
//   in   info: { mode, rules, ranked, large, mission }       view: the match view       me: the local player (or null)
//        fight: 0..1 (the engine's firefight level)          closing: the engine's "last kills / last seconds" flag
export function newPickState() {
  return { theme: null, level: 0, transpose: 0, heatAt: -99, peak: false, exfil: false, exSite: -1, exFinal: false, boss: false, cpPhase: 0, zmRound: 0, stung: {} };
}

const obj = v => v?.obj ?? v?.points?.obj ?? null;

export function pickTheme(st, info, view, me, fight, closing, now) {
  let [theme, transpose] = baseTheme(info);
  st.transpose = transpose;
  if (!theme || !view || view.phase === 'ended') { st.theme = null; return null; }
  if (fight > 0.55) st.heatAt = now;
  const hot = now - st.heatAt < 8;       // A firefight holds the level up for a few seconds after it stops.
  const live = view.phase === 'live';
  const rules = info.rules ?? info.mode;
  let level = live ? 1 : 0, sting = null;
  const o = obj(view);

  if (rules === 'br') {
    const br = view.br;
    if (me?.air) { theme = 'brdrop'; level = 3; }
    else if (br?.state === 'final') { theme = 'brfinal'; level = (br.squadsLeft ?? 9) <= 2 || (br.alive ?? 99) <= 4 ? 3 : 2; }
    else {
      const ph = br?.phase ?? 0;
      level = ph <= 1 ? 0 : ph <= 3 ? 1 : 2;
      if (br?.state === 'shrink') level++;
      if (hot) level = Math.max(level, 2);
      level = Math.min(3, level);
    }
  } else if (rules === 'ex') {
    if (st.exfil) { theme = 'exfil'; level = st.exFinal ? 3 : 2; }
    else {
      const left = o ? (o.length ?? 900) - (o.t ?? 0) : 900;
      level = hot ? 2 : live ? 0 : 0;
      if (left < 120 && live) level = Math.max(level, 2);
    }
  } else if (rules === 'zm') {
    const z = o;
    const round = z?.round ?? 0;
    if (z?.boss || (round > 0 && round % 10 === 0 && z?.state === 'round')) {
      theme = 'zmboss'; level = z?.boss && z.boss.hp < 0.33 ? 3 : 2;
      if (!st.boss) { st.boss = true; sting = 'boss'; }
    } else {
      st.boss = false;
      level = round <= 2 ? 0 : round <= 5 ? 1 : round <= 9 ? 2 : 3;
      if (z?.state === 'break' || z?.state === 'pre') level = Math.max(0, level - 2);
    }
  } else if (rules === 'cp') {
    const cp = o;
    if (cp?.boss) {
      theme = 'cpboss'; level = st.cpPhase >= 2 || cp.boss.frac < 0.33 ? 3 : 2;
      if (!st.boss) { st.boss = true; sting = 'boss'; }
    } else {
      st.boss = false;
      if (theme === 'cpstealth') level = cp?.alarm ? 2 : hot ? 2 : live ? 1 : 0;
      else level = hot ? 2 : live ? 1 : 0;
      if (cp?.timer > 0 && cp.timer < 30) level = 3;
    }
  } else if (rules === 'inf') {
    let surv = 0, all = 0;
    const ps = view.players;
    for (let i = 0; i < ps.length; i++) { const p = ps[i]; if (p.dummy) continue; all++; if (p.team === 0) surv++; }
    level = !o?.started ? 0 : surv <= 1 || (view.timeLeft > 0 && view.timeLeft <= 30) ? 3 : surv <= all / 2 ? 2 : 1;
  } else {
    if (hot && live) level = 2;
    if (live && (closing || (view.timeLeft > 0 && view.timeLeft <= 60))) {
      level = 3;
      if (!st.peak) { st.peak = true; sting = 'matchPoint'; }
    }
  }
  st.theme = theme; st.level = level;
  return sting;
}

// Match events the state machine needs to hear about (the director passes them on from the engine).
export function pickEvent(st, e, localTeam) {
  switch (e.t) {
    case 'excall': if (e.team === localTeam) { st.exfil = true; st.exSite = e.site; } break;
    case 'exfil': case 'exwipe': if (e.team === localTeam) st.exfil = false; break;
    case 'exleave': if (e.site === st.exSite) st.exfil = false; break;
    case 'exwindow': if (e.final) st.exFinal = true; break;
    case 'cpphase': st.cpPhase = e.n | 0; break;
    default: break;
  }
}
