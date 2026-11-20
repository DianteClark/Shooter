// Operators remade (ROADMAP item 49, docs/OPERATORS-ART.md): the active-skin effects every Elite skin wears, a showpiece
// suit for every operator's Mastery skin, and the suits' distance versions.
//
//   SKIN_FX_GLSL    skinFx(c, k, p, a): effect k of operators.js SKIN_FX over a fragment of plain gear (characters.js)
//   farSuitBuilder  a MeshBuilder that records each piece and cuts the suit to its biggest ones (`cut(budget)`)
//   SUITS           (operator-kit.js) gets every suit below added to the pilot's bear and mech
//
// Suit frames are operator-kit.js's: forward +X, up +Y, the wearer's left +Z; torso origin at the hips (chest top ~0.62),
// head origin at the top of the chest (a face's front at x ~0.17). Plain part-0 pieces take the skin's gear colour, KEEP
// pieces keep theirs, ACC pieces take the accent and glow, TONE pieces the operator's skin tone, part 1 the team colour.
import { MeshBuilder } from './meshbuild.js';
import { ACC, KEEP, TONE, LOCKS, SUITS, tag, seg, plate } from './operator-kit.js';

/* ---------- Active skins ---------- */
// One branch per effect, a few ALU ops each: no textures, no loops. c is the lit colour, p the object position (metres),
// a the skin's accent; vLight and uTime come from CHAR_FRAG. Numbers match operators.js SKIN_FX (append only).
export const SKIN_FX_GLSL = /* glsl */`
float fxH(vec2 q) { return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
float fxH3(vec3 q) { return fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 skinFx(vec3 c, float k, vec3 p, vec3 a) {
  float t = uTime;
  float lum = dot(vLight, vec3(0.333));
  if (k < 1.5) {                                           // 1 holo
    vec3 h = 0.55 + 0.45 * cos(6.2832 * (p.y * 1.7 + (p.x + p.z) * 0.9 + t * 0.3 + vec3(0.0, 0.33, 0.67)));
    float scan = smoothstep(0.82, 1.0, fract(p.y * 12.0 - t * 1.4));
    return mix(c, h * (0.35 + 0.65 * vLight), 0.6) + h * scan * 0.35;
  }
  if (k < 2.5) {                                           // 2 circuit
    vec3 q = p * 9.0;
    float row = floor(q.y);
    float hl = step(0.42, abs(fract(q.y) - 0.5));
    float vl = step(0.44, abs(fract(q.z + q.x + row * 0.37) - 0.5)) * step(0.5, fract(row * 0.618 + 0.2));
    float line = max(hl, vl);
    float pulse = pow(0.5 + 0.5 * sin(t * 3.2 - p.y * 11.0 + p.z * 3.0), 6.0);
    return c * 0.8 + a * line * (0.3 + 1.3 * pulse);
  }
  if (k < 3.5) {                                           // 3 shimmer
    float w = sin(p.y * 16.0 + sin(p.x * 11.0 + p.z * 9.0 + t * 2.6) * 2.2 - t * 5.0);
    float w2 = 0.5 + 0.5 * w;
    return mix(c, a * (0.55 + 0.45 * vLight), 0.18 + 0.32 * w2) + a * pow(w2, 10.0) * 0.7;
  }
  if (k < 4.5) {                                           // 4 flame: tongues licking up the gear
    float n = sin(p.x * 13.0 + t * 4.1) * 0.5 + sin(p.z * 11.0 - t * 3.3) * 0.5;
    float h = fract(p.y * 3.2 - t * 1.6 + n * 0.22);
    float f = pow(1.0 - h, 2.5) * (0.6 + 0.4 * sin(t * 9.0 + p.x * 20.0));
    vec3 fire = mix(a, vec3(1.0, 0.92, 0.45), f * f);
    return c * 0.55 + fire * f * 1.5;
  }
  if (k < 5.5) {                                           // 5 frost: icy glaze and twinkling crystals
    vec3 q = floor(p * 16.0);
    float h = fxH3(q);
    float tw = step(0.9, h) * pow(max(0.0, sin(t * 2.5 + h * 50.0)), 6.0);
    float vein = 1.0 - smoothstep(0.0, 0.06, abs(sin(p.x * 9.0 + p.y * 14.0) * sin(p.z * 12.0 - p.y * 7.0)));
    vec3 ice = mix(vec3(0.72, 0.88, 1.0), a, 0.3) * (0.45 + 0.55 * lum);
    return mix(c, ice, 0.5) + ice * vein * 0.35 + vec3(0.9, 0.97, 1.0) * tw * 1.2;
  }
  if (k < 6.5) {                                           // 6 glitch: torn bands, channel swaps, stutter
    float tick = floor(t * 7.0);
    float band = floor(p.y * 9.0 + fxH(vec2(tick, 3.0)) * 4.0);
    float on = step(0.78, fxH(vec2(band, tick)));
    float scan = step(0.5, fract(p.y * 40.0 + t * 3.0));
    vec3 g = mix(c, c.brg * 1.4 + a * 0.6, on);
    return g * (0.9 + 0.1 * scan) + a * on * step(0.5, fxH(vec2(band + 7.0, tick))) * 0.6;
  }
  if (k < 7.5) {                                           // 7 starfield: deep space with twinkling stars
    vec3 q = floor(p * 22.0);
    float h = fxH3(q);
    float star = step(0.94, h) * (0.4 + 0.6 * sin(t * 3.0 + h * 40.0));
    float neb = 0.5 + 0.5 * sin(p.y * 4.0 + p.z * 3.0 + sin(p.x * 5.0 + t * 0.4) * 1.5 + t * 0.3);
    return c * 0.3 + a * neb * neb * 0.45 + vec3(1.0) * max(star, 0.0) * 1.3;
  }
  if (k < 8.5) {                                           // 8 lightning: forks crawling over it, a flash with each
    float seed = floor(t * 9.0);
    float f = p.x * 1.4 + p.z * 2.2 + sin(p.y * 17.0 + seed * 2.3) * 0.07 + sin(p.y * 41.0 - seed) * 0.025;
    float d = abs(fract(f * 1.6 + fxH(vec2(seed, 1.0))) - 0.5);
    float bolt = 1.0 - smoothstep(0.0, 0.03, d);
    float live = step(0.35, fxH(vec2(seed, 2.0)));
    return c * 0.8 + (a + 0.35) * bolt * live * 1.6 + a * 0.12 * live;
  }
  if (k < 9.5) {                                           // 9 camo: digital blocks shuffling, a cloak band sweeping up
    vec3 q = floor(p * 9.0);
    float h = fxH3(q + floor(t * 1.5 + fxH3(q) * 3.0));
    vec3 shade = c * (0.55 + 0.6 * h);
    float sweep = smoothstep(0.06, 0.0, abs(fract(p.y * 0.7 - t * 0.35) - 0.5) - 0.02);
    return mix(shade, a * (0.4 + 0.6 * lum) * (0.6 + 0.4 * h), 0.25 + 0.55 * sweep);
  }
  if (k < 10.5) {                                          // 10 lava: dark crust split by glowing molten veins
    float v = abs(sin(p.x * 8.0 + sin(p.z * 7.0 + p.y * 3.0) * 1.3) * sin(p.y * 9.0 + sin(p.x * 6.0 - p.z * 5.0) * 1.2));
    float crack = 1.0 - smoothstep(0.0, 0.14, v);
    float glow = crack * (0.65 + 0.35 * sin(t * 2.2 + p.y * 6.0 + p.z * 4.0));
    return c * 0.45 + mix(a, vec3(1.0, 0.85, 0.35), crack * 0.6) * glow * 1.6;
  }
  if (k < 11.5) {                                          // 11 aurora: shifting curtains of colour
    float w = sin(p.z * 5.0 + sin(p.y * 3.0 + t * 0.7) * 1.6 + t * 0.5 + p.x * 3.0);
    vec3 col = 0.5 + 0.5 * cos(6.2832 * (p.y * 0.6 + vec3(0.25, 0.45, 0.7) + t * 0.08));
    float band = pow(0.5 + 0.5 * w, 3.0);
    return c * 0.55 + mix(a, col, 0.55) * band * 1.1;
  }
  if (k < 12.5) {                                          // 12 hex: a shield grid with pulses running through it
    vec2 uv = vec2(p.z + p.x * 0.6, p.y) * 9.0;
    vec2 r = vec2(1.0, 1.732), hr = r * 0.5;
    vec2 g1 = mod(uv, r) - hr, g2 = mod(uv - hr, r) - hr;
    vec2 g = dot(g1, g1) < dot(g2, g2) ? g1 : g2;
    g = abs(g);
    float e = 0.5 - max(dot(g, vec2(0.5, 0.866)), g.x);
    float line = 1.0 - smoothstep(0.0, 0.07, e);
    float pulse = pow(0.5 + 0.5 * sin(t * 2.6 - length(p.yz - vec2(0.4, 0.0)) * 9.0), 6.0);
    return c * 0.8 + a * line * (0.3 + 1.2 * pulse);
  }
  if (k < 13.5) {                                          // 13 void: light falls into it, its edges burn
    vec3 q = floor(p * 26.0);
    float h = fxH3(q);
    float rim = pow(1.0 - clamp(lum, 0.0, 1.0), 2.0) * (0.6 + 0.4 * sin(t * 2.4 + p.y * 6.0));
    float mote = step(0.97, h) * (0.5 + 0.5 * sin(t * 2.0 + h * 30.0));
    return c * 0.18 + a * rim * 0.9 + a * mote * 0.9 + a * 0.06;
  }
  if (k < 14.5) {                                          // 14 sparkle: glints twinkling, a sheen sweeping up
    vec3 q = floor(p * 18.0);
    float h = fxH3(q);
    float tw = step(0.84, h) * pow(max(0.0, sin(t * 4.0 + h * 60.0)), 16.0);
    float sheen = pow(max(0.0, sin(p.y * 3.0 - t * 2.0 + p.x * 2.0 + p.z)), 14.0);
    return c * 1.05 + (a * 0.6 + 0.5) * tw * 1.6 + a * sheen * 0.45;
  }
  if (k < 15.5) {                                          // 15 caustics: light through rippling water
    float w = sin(p.x * 10.0 + t * 1.3 + sin(p.z * 8.0 + t)) + sin(p.z * 11.0 - t * 1.1 + sin(p.y * 9.0 - t * 0.8)) + sin(p.y * 9.0 + t * 1.7 + p.x * 4.0);
    float cs = pow(max(0.0, 1.0 - abs(w) * 0.8), 4.0);
    return c * 0.7 + a * cs * 1.0 + a * 0.08;
  }
  if (k < 16.5) {                                          // 16 radar: a sweep turning round the body, range rings
    float ang = atan(p.z, p.x) / 6.2832 + 0.5;
    float s = fract(ang - t * 0.45);
    float trail = pow(1.0 - s, 7.0);
    float ring = step(0.86, fract(p.y * 5.0 - t * 0.6));
    return c * 0.75 + a * trail * 1.0 + a * ring * (0.15 + 0.8 * trail);
  }
  if (k < 17.5) {                                          // 17 bubbles: rising in the gear
    vec2 uv = vec2((p.x + p.z) * 7.0, p.y * 7.0 - t * 1.4);
    vec2 q = floor(uv), f = fract(uv) - 0.5;
    float h = fxH(q);
    float d = length(f - (vec2(h, fract(h * 7.3)) - 0.5) * 0.35);
    float bub = step(0.55, h) * (smoothstep(0.26, 0.2, d) - 0.6 * smoothstep(0.17, 0.1, d));
    return c * 0.78 + a * bub * 1.3 + a * 0.1;
  }
  if (k < 18.5) {                                          // 18 code rain: glyph columns falling
    float col = floor((p.x + p.z) * 16.0);
    float sp = 0.6 + fxH(vec2(col, 1.0)) * 0.9;
    float gy = floor(p.y * 22.0 + t * sp * 6.0);
    float on = step(0.45, fxH(vec2(col, gy)));
    float head = pow(fract(-p.y * 0.9 + t * sp * 0.45 + fxH(vec2(col, 2.0))), 5.0);
    return c * 0.45 + a * on * (0.12 + 1.3 * head);
  }
  if (k < 19.5) {                                          // 19 embers: sparks rising off a smouldering glow
    vec2 uv = vec2((p.x - p.z) * 9.0, p.y * 6.0 - t * 1.8 + sin(p.z * 9.0) * 0.3);
    vec2 q = floor(uv), f = fract(uv) - 0.5;
    float h = fxH(q);
    float d = length(f - (vec2(h, fract(h * 13.1)) - 0.5) * 0.6);
    float sp = step(0.62, h) * smoothstep(0.14, 0.0, d) * (0.6 + 0.4 * sin(t * 9.0 + h * 30.0));
    float smoulder = 0.5 + 0.5 * sin(t * 1.7 + p.x * 9.0 + p.y * 5.0);
    return c * 0.65 + a * smoulder * 0.25 + mix(a, vec3(1.0, 0.9, 0.5), 0.5) * sp * 2.2;
  }
  if (k < 20.5) {                                          // 20 hazard: chevron stripes scrolling, a beacon blink
    float s = step(0.5, fract((p.y + abs(p.z) + p.x * 0.5) * 4.5 - t * 0.9));
    float blink = step(0.7, fract(t * 1.2));
    return mix(c * 0.55, a * (0.45 + 0.55 * lum), s * 0.7) + a * s * blink * 0.35;
  }
  if (k < 21.5) {                                          // 21 morse: dots and dashes running along the lines
    float row = floor(p.y * 11.0);
    float dir = mod(row, 2.0) * 2.0 - 1.0;
    float x = (p.z + p.x) * 9.0 - t * 2.6 * dir;
    float pat = fxH(vec2(floor(x), row));
    float w = fract(x) - 0.5;
    float on = pat < 0.3 ? 0.0 : pat < 0.65 ? step(abs(w), 0.14) : step(abs(w), 0.42);
    float line = step(abs(fract(p.y * 11.0) - 0.5), 0.16);
    return c * 0.78 + a * on * line * 1.4 + a * line * 0.06;
  }
  if (k < 22.5) {                                          // 22 heartbeat: a cardiogram trace running round the body
    float x = fract(atan(p.z, p.x) / 6.2832 + 0.5 - t * 0.35);
    float row = fract(p.y * 2.6);
    float e = 0.5 + 0.34 * exp(-pow((x - 0.5) * 38.0, 2.0)) - 0.16 * exp(-pow((x - 0.54) * 34.0, 2.0)) + 0.06 * exp(-pow((x - 0.3) * 16.0, 2.0));
    float line = 1.0 - smoothstep(0.0, 0.05, abs(row - e));
    float beat = pow(max(0.0, sin(t * 6.0)), 12.0);
    return c * 0.78 + a * line * (0.5 + 0.9 * x) + a * beat * 0.18;
  }
  if (k < 23.5) {                                          // 23 thermal: the hunter's view, heat bands drifting
    float v = clamp(0.5 + 0.45 * sin(p.y * 4.0 - t * 1.1 + sin(p.x * 6.0 + p.z * 5.0 + t * 0.8) * 1.3), 0.0, 1.0);
    vec3 th = clamp(vec3(v * 2.2 - 0.6, v * 2.4 - 1.3, 0.9 - abs(v * 2.0 - 0.5) * 1.6), 0.0, 1.0);
    return mix(c, mix(th, a, 0.2) * (0.6 + 0.4 * lum), 0.65);
  }
  if (k < 24.5) {                                          // 24 wind: streaks of sand racing past
    float row = floor(p.y * 18.0);
    float h = fxH(vec2(row, 4.0));
    float s = pow(max(0.0, sin((p.x - p.z * 0.4 - t * (2.5 + h * 2.0)) * 4.0 + h * 20.0)), 24.0) * step(0.35, h);
    float grain = step(0.93, fxH3(floor(p * 40.0) + floor(t * 6.0)));
    return c * 0.85 + a * s * 1.2 + a * grain * 0.35;
  }
  if (k < 25.5) {                                          // 25 chevron: arrows driving forward through the gear
    float v = fract(p.x * 3.0 - abs(p.z) * 2.5 + p.y * 0.4 - t * 1.4);
    float on = smoothstep(0.62, 0.7, v) * (1.0 - smoothstep(0.88, 0.96, v));
    return c * 0.72 + a * on * 1.2;
  }
  if (k < 26.5) {                                          // 26 ink: brush strokes flowing, a red streak through them
    float n = sin(p.y * 6.0 + sin(p.z * 5.0 + t * 0.6) * 1.6 + sin(p.x * 7.0 - t * 0.4));
    float ink = smoothstep(0.25, 0.6, n);
    float streak = pow(max(0.0, sin(p.y * 18.0 + n * 3.0 - t * 2.0)), 28.0);
    return mix(c, vec3(0.03), ink * 0.65) + a * streak * 1.4 + a * 0.08 * (1.0 - ink);
  }
  if (k < 27.5) {                                          // 27 checker: board squares flipping in waves
    vec2 q = floor(vec2(p.x + p.z, p.y) * 7.0);
    float par = mod(q.x + q.y, 2.0);
    float w = step(0.5, fract(t * 0.25 + fxH(q) * 0.25 + p.y * 0.3));
    float tile = abs(par - w);
    return mix(c * 0.4, mix(c, a, 0.55) * 1.2, tile);
  }
  if (k < 28.5) {                                          // 28 clouds: a sky drifting over the gear
    float n = sin(p.x * 5.0 + t * 0.5 + sin(p.z * 4.0) * 1.5) * sin(p.z * 5.0 + sin(p.y * 6.0 + t * 0.3)) + 0.5 * sin(p.y * 9.0 + t * 0.7);
    float cl = smoothstep(0.15, 0.6, n);
    vec3 sky = mix(a * 0.55 + vec3(0.1, 0.2, 0.35), vec3(0.97), cl);
    return mix(c, sky * (0.55 + 0.45 * lum), 0.6);
  }
  if (k < 29.5) {                                          // 29 snow: flakes falling, the gear rimed white
    vec2 uv = vec2((p.x + p.z) * 10.0 + sin(p.y * 4.0 + t) * 0.5, p.y * 10.0 + t * 1.3);
    vec2 q = floor(uv), f = fract(uv) - 0.5;
    float h = fxH(q);
    float flake = step(0.72, h) * smoothstep(0.16, 0.05, length(f));
    return mix(c, vec3(0.86, 0.92, 1.0) * (0.5 + 0.5 * lum), 0.22) + vec3(1.0) * flake + a * 0.1;
  }
  if (k < 30.5) {                                          // 30 rays: radiance turning round the wearer
    float ang = atan(p.z, p.y - 0.25);
    float r = pow(max(0.0, sin(ang * 7.0 + t * 1.3)), 5.0);
    float sheen = pow(max(0.0, sin(p.y * 5.0 - t * 2.4)), 10.0);
    return c * 0.85 + mix(a, vec3(1.0), 0.45) * r * 0.65 + a * sheen * 0.4 + a * 0.08;
  }
  if (k < 31.5) {                                          // 31 scan: a security sweep up and down, a fine grid
    float y = 0.5 + 0.5 * sin(t * 1.4);
    float band = smoothstep(0.07, 0.0, abs(fract(p.y * 0.75) - y));
    float grid = max(step(0.9, fract(p.y * 24.0)), step(0.9, fract((p.x + p.z) * 24.0)));
    return c * 0.82 + a * band * 1.3 + a * grid * (0.1 + 0.9 * band);
  }
  if (k < 32.5) {                                          // 32 smoke: grave mist curling over the gear
    float n = sin(p.x * 7.0 + t * 0.9 + sin(p.y * 5.0 - t * 1.3) * 2.0) * sin(p.z * 6.0 - t * 0.7 + sin(p.y * 4.0 + t * 0.5) * 2.0);
    float s = smoothstep(0.0, 0.8, 0.5 + 0.5 * n);
    return mix(c * 0.7, a * 0.5 + vec3(0.06), s * 0.55) + a * pow(s, 8.0) * 0.8;
  }
  if (k < 33.5) {                                          // 33 harlequin: diamonds trading colours
    vec2 uv = vec2((p.x + p.z) * 5.0, p.y * 5.0 + t * 0.35);
    float par = mod(floor(uv.x + uv.y) + floor(uv.x - uv.y), 2.0);
    float flip = step(0.5, fract(t * 0.5 + floor(uv.y + uv.x) * 0.13));
    float edge = 1.0 - smoothstep(0.0, 0.06, min(abs(fract(uv.x + uv.y) - 0.5), abs(fract(uv.x - uv.y) - 0.5)) - 0.44);
    return mix(c * 0.5, a * (0.4 + 0.6 * lum), abs(par - flip) * 0.75) + vec3(1.0, 0.9, 0.6) * edge * 0.2;
  }
  if (k < 34.5) {                                          // 34 tracer: rounds streaking across, flashes behind
    float row = floor((p.y + p.x * 0.5) * 14.0);
    float h = fxH(vec2(row, 9.0));
    float x = fract(p.z * 1.4 - p.x * 0.3 + t * (1.4 + h * 1.6) + h);
    float on = step(0.55, h) * (1.0 - smoothstep(0.2, 0.35, abs(fract((p.y + p.x * 0.5) * 14.0) - 0.5)));
    float s = smoothstep(0.75, 1.0, x) * on;
    float tip = smoothstep(0.96, 1.0, x) * on;
    return c * 0.8 + a * s * 1.1 + vec3(1.0, 0.95, 0.7) * tip * 1.2;
  }
  float dd = length(p - vec3(0.25, 0.4, 0.0));             // 35 shockwave: rings bursting out of the chest
  float wv = fract(dd * 3.0 - t * 1.3);
  float ring = smoothstep(0.8, 0.97, wv) * (1.0 - smoothstep(0.97, 1.0, wv));
  return c * 0.78 + a * ring * 1.4 * (1.2 - min(dd, 1.0));
}`;

/* ---------- Distance versions ---------- */
// The far twin of a suit is the same code run through a builder that drops bevels, caps prisms at six sides and keeps
// a record of every piece (thin ones get four sides); cut(budget) keeps the pieces that show most from the match camera (top-down area plus some
// height, team colour weighted up so sides still read) until the vertex budget, in their original order.
export const FAR_BUDGET = [480, 300];     // Torso, head.
export function farSuitBuilder() {
  const b = new MeshBuilder();
  const rec = [];
  const wrap = (name, fix) => {
    const orig = b[name].bind(b);
    b[name] = (...args) => {
      const from = b.pos.length / 3;
      orig(...fix(args));
      const to = b.pos.length / 3;
      if (to > from) rec.push([from, to, b.part]);
      return b;
    };
  };
  wrap('box', a => { const o = a.slice(0, 6); o.push(0); return o; });
  for (const n of ['prismX', 'prismY', 'prismZ']) wrap(n, a => { const o = a.slice(); o[6] = Math.min(o[6] ?? 6, Math.max(o[4], o[5]) < 0.1 ? 4 : 6); return o; });
  wrap('extrude', a => a);
  b.cut = budget => {
    const P = b.pos;
    const scored = rec.map(([from, to, part], i) => {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let v = from; v < to; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const score = (dx * dz + 0.45 * Math.max(dx, dz) * dy) * (part === 1 ? 1.8 : 1);
      return { i, from, to, score };
    }).sort((p, q) => q.score - p.score);
    const keep = new Set();
    let n = 0;
    for (const s of scored) {
      if (n + (s.to - s.from) > budget) continue;
      keep.add(s.i); n += s.to - s.from;
    }
    // Rebuild a plain builder with the kept vertices, carrying each vertex's tags over.
    const tags = new Uint16Array(P.length / 3);
    for (const [from, to, t] of b.tags ?? []) for (let v = from; v < to; v++) tags[v] |= t;
    const out = new MeshBuilder();
    out.tags = [];
    rec.forEach(([from, to], i) => {
      if (!keep.has(i)) return;
      for (let v = from; v < to; v++) {
        const o = out.pos.length / 3;
        out.pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        out.nor.push(b.nor[v * 3], b.nor[v * 3 + 1], b.nor[v * 3 + 2]);
        out.col.push(b.col[v * 3], b.col[v * 3 + 1], b.col[v * 3 + 2]);
        out.par.push(b.par[v]);
        if (tags[v]) out.tags.push([o, o + 1, tags[v]]);
      }
    });
    return out;
  };
  return b;
}

/* ---------- Suits ---------- */
const TAU = Math.PI * 2;
// A ring of n boxes round the Y axis at height y (a ruff, a mane, a collar of plates).
function ring(b, y, r, n, sx, sy, sz, cx = 0, tilt = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = cx + Math.cos(a) * r, z = Math.sin(a) * r;
    plate(b, [x - Math.cos(a) * sx * 0.5, y - sy * 0.5 * Math.cos(tilt), z - Math.sin(a) * sx * 0.5],
      [x + Math.cos(a) * sx * 0.5, y + sy * 0.5 * Math.sin(tilt), z + Math.sin(a) * sx * 0.5], sz, sy);
  }
}
// A curve of prisms through points (horns, tails, hoses), radius tapering r0 -> r1.
function chain(b, pts, r0, r1 = r0, sides = 5) {
  for (let i = 0; i < pts.length - 1; i++) {
    const u = i / (pts.length - 1), v = (i + 1) / (pts.length - 1);
    seg(b, pts[i], pts[i + 1], r0 + (r1 - r0) * u, r0 + (r1 - r0) * v, sides);
  }
}
// A seeded scatter, so strips and tufts land the same on every client.
function rng(seed) {
  let h = seed >>> 0;
  return () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = (h + 0x6d2b79f5) >>> 0; return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
}
// The round body of an animal suit: hips, belly, shoulders, as three octagons.
function roundBody(b, r = 0.34, top = 0.68) {
  b.prismY(-0.06, 0.18, 0, 0, r * 0.82, r, 8, Math.PI / 8);
  b.prismY(0.18, top - 0.2, 0, 0, r, r, 8, Math.PI / 8);
  b.prismY(top - 0.2, top, 0, 0, r, r * 0.66, 8, Math.PI / 8);
}
// A team harness over any suit: belt and four straps, the bear's fix from build 1119-12.
function harness(b, r = 0.36, y = 0.2) {
  b.setPart(1).prismY(y - 0.045, y + 0.045, 0, 0, r + 0.015, r + 0.015, 8, Math.PI / 8);
  b.box(r - 0.005, 0.47, 0.15, 0.04, 0.3, 0.07).box(r - 0.005, 0.47, -0.15, 0.04, 0.3, 0.07);
  b.box(-r + 0.005, 0.47, 0.15, 0.04, 0.3, 0.07).box(-r + 0.005, 0.47, -0.15, 0.04, 0.3, 0.07);
}

export const MORE_SUITS = {};
Object.assign(SUITS, MORE_SUITS);
