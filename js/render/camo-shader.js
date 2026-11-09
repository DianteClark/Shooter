// The one camo shader, shared by in-match guns and GunPreview.
// Pattern coordinates are object-space: each flat face projects along its dominant axis, so there is
// no UV unwrap and patterns stay big and bold on any model. Only aPart == 0 (body) is camouflaged.
import * as THREE from 'three';
import { CAMOS, getCamo } from '../shared/camos.js';
import { GLSL_LIGHT, GLSL_DITHER, hexRGB } from './art.js';

export const PART = { BODY: 0, GRIP: 1, METAL: 2, ACCENT: 3 };

const PATTERN_IDS = { solid: 0, digital: 1, tiger: 2, splinter: 3, hex: 4, gold: 5, molten: 6, prism: 7, carbon: 8, livewire: 9, aurora: 10, singularity: 11 };

// Both lookups run per soldier per frame; the Maps keep that free of closures and scans.
const INDEX_BY_ID = new Map();
export function camoIndex(id) {
  let i = INDEX_BY_ID.get(id);
  if (i === undefined) {
    i = CAMOS.findIndex(c => c.id === id);
    if (i < 0) i = 0;
    INDEX_BY_ID.set(id, i);
  }
  return i;
}

// Tint used for tracers and muzzle flash, or -1 when the camo has none.
const TINT_BY_ID = new Map();
export function camoTint(id) {
  let t = TINT_BY_ID.get(id);
  if (t === undefined) {
    const c = getCamo(id);
    t = c.tint === undefined ? -1 : c.tint;
    TINT_BY_ID.set(id, t);
  }
  return t;
}

const camoCount = CAMOS.length;

const VERT = /* glsl */`
attribute vec3 aCol;
attribute float aPart;
attribute float aCamo;
attribute vec3 aAccent;
attribute vec2 aFx;            // x: fade 0..1, y: white hit flash 0..1
attribute float aHeat;         // Overheat glow along the barrel, 0..1 (LMG only; other guns stay 0).

varying vec3 vCol;
varying vec3 vLight;
varying vec3 vAccent;
varying vec2 vFx;
varying vec2 vUv2;
varying float vPart;
varying float vSpec;
varying float vHeat;
flat varying int vCamo;

${GLSL_LIGHT}

void main() {
  mat4 world = modelMatrix * instanceMatrix;
  vec3 n = normalize(mat3(world) * normal);
  vCol = aCol; vPart = aPart; vAccent = aAccent; vFx = aFx; vCamo = int(aCamo + 0.5);
  vLight = duskLight(n);
  // The glow gathers toward the muzzle; the grip never heats.
  vHeat = aHeat * smoothstep(0.42, 1.25, position.x) * (aPart > 0.5 && aPart < 1.5 ? 0.0 : 1.0);
  vec3 h = normalize(vec3(-0.17, 0.87, 0.47));
  vSpec = pow(max(dot(n, h), 0.0), 18.0);

  // Pick the projection plane from the object-space face normal; flat faces make this per-face.
  vec3 an = abs(normal);
  if (an.y > an.x && an.y > an.z) vUv2 = position.xz;
  else if (an.z > an.x) vUv2 = position.xy;
  else vUv2 = position.zy + vec2(0.37, 0.11);

  gl_Position = projectionMatrix * viewMatrix * world * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
#define CAMO_N ${camoCount}
uniform float uTime;
uniform vec3 uCols[CAMO_N * 4];
uniform vec4 uPar[CAMO_N];     // x: pattern id, y: scale

varying vec3 vCol;
varying vec3 vLight;
varying vec3 vAccent;
varying vec2 vFx;
varying vec2 vUv2;
varying float vPart;
varying float vSpec;
varying float vHeat;
flat varying int vCamo;

${GLSL_DITHER}

float h21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
vec3 pick4(float k, int o) {
  if (k < 0.42) return uCols[o];
  if (k < 0.72) return uCols[o + 1];
  if (k < 0.92) return uCols[o + 2];
  return uCols[o + 3];
}

// Returns surface albedo; emissive light that ignores shading goes in emit.
vec3 camo(int i, vec2 uv, out vec3 emit, out float gloss) {
  emit = vec3(0.0); gloss = 0.0;
  int pat = int(uPar[i].x);
  int o = i * 4;
  vec2 p = uv * uPar[i].y;
  if (pat == 1) {                // Digital: big blocks broken up by single pixels.
    vec2 c = floor(p);
    float k = fract(h21(floor(p / 3.0)) * 0.85 + h21(c) * 0.45);
    return pick4(k, o);
  }
  if (pat == 2) {                // Tiger: warped diagonal stripes with a pale highlight band.
    float w = vnoise(p * 0.9 + 7.3) * 2.6;
    float s = sin(p.x * 1.9 + p.y * 3.2 + w * 2.4);
    if (s > 0.62) return uCols[o + 1];
    if (s < -0.72) return uCols[o + 2];
    return uCols[o];
  }
  if (pat == 3) {                // Splinter: hard angular shards from three crossing band sets.
    float a = floor(dot(p, vec2(0.86, 0.5)) * 0.9);
    float b = floor(dot(p, vec2(-0.5, 0.86)) * 1.3 + 0.4);
    float c = floor(dot(p, vec2(0.3, -0.95)) * 0.8 + 1.7);
    return pick4(h21(vec2(a * 3.7 + b * 1.3, c * 2.1 - b * 0.7)), o);
  }
  if (pat == 4 || pat == 5) {    // Hex cells; gold reuses the lattice as engraving.
    vec2 q = p * vec2(1.0, 1.1547);
    q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 cell = floor(q), f = fract(q) - 0.5;
    float d = abs(f.x) * 1.0 + abs(f.y) * 0.5774;
    float rim = max(d, abs(f.y) * 1.1547);
    if (pat == 4) {
      if (rim > 0.46) return uCols[o + 3];
      return uCols[o + int(mod(h21(cell) * 3.0, 3.0))];
    }
    // Gold: slow bands, engraved cells, and a highlight that sweeps down the gun.
    float band = 0.5 + 0.5 * sin((uv.x + uv.y) * 6.0 + uTime * 0.8);
    vec3 col = mix(uCols[o + 1], uCols[o], 0.35 + 0.65 * band);
    col *= rim > 0.45 ? 0.62 : 1.0;
    float sweep = smoothstep(0.93, 1.0, sin(uv.x * 3.2 - uTime * 2.4));
    emit = uCols[o + 2] * (sweep * 0.5 + 0.1);
    gloss = 1.0;
    return col;
  }
  if (pat == 6) {                // Molten: cooled crust over flowing, pulsing cracks.
    vec2 q = p + vec2(uTime * 0.25, uTime * 0.55);
    float n = vnoise(q) * 0.6 + vnoise(q * 2.1 + 3.1) * 0.4;
    float crack = 1.0 - smoothstep(0.0, 0.085, abs(n - 0.5));
    float pulse = 0.72 + 0.28 * sin(uTime * 4.0 + p.x * 2.0);
    vec3 hot = mix(uCols[o + 1], uCols[o + 2], crack * crack);
    emit = hot * crack * pulse * 1.8;
    return uCols[o] * (0.65 + n);
  }
  if (pat == 7) {                // Prism: diamond facets whose hue sweeps along the gun.
    vec2 q = p * 0.5;
    vec2 d = vec2(q.x + q.y, q.x - q.y);
    vec2 c = floor(d);
    float line = min(fract(d.x), fract(d.y));
    float t = (uv.x + uv.y) * 0.9 + h21(c) * 0.18 - uTime * 0.45;
    // Cycle through the camo's own three colours, not the whole wheel.
    float s = fract(t) * 3.0;
    int a = int(floor(s));
    vec3 col = mix(uCols[o + a], uCols[o + (a + 1 == 3 ? 0 : a + 1)], smoothstep(0.25, 0.75, fract(s)));
    if (line < 0.06) return vec3(0.06, 0.03, 0.09);
    emit = col * 0.45;
    gloss = 0.9;
    return col * 0.7;
  }
  if (pat == 8) {                // Carbon: over-under weave with a thin hot pinstripe.
    vec2 c = floor(p), f = fract(p) - 0.5;
    float rib = mod(c.x + c.y, 2.0) < 1.0 ? abs(f.y) : abs(f.x);
    vec3 col = mix(uCols[o], uCols[o + 1], smoothstep(0.08, 0.5, rib));
    float stripe = step(0.93, fract(uv.x * 1.4 + uv.y * 0.6));
    gloss = 0.5;
    return mix(col, uCols[o + 2], stripe);
  }
  if (pat == 9) {                // Live Wire: arcs strike along noise contours, redrawn nine times a second.
    float tick = floor(uTime * 9.0);
    vec2 q = p * 0.6;
    float a1 = 1.0 - smoothstep(0.0, 0.04, abs(vnoise(q + vec2(tick * 1.7, tick * 0.9)) - 0.5));
    float a2 = 1.0 - smoothstep(0.0, 0.03, abs(vnoise(q * 1.7 - vec2(tick * 0.6, tick * 1.3) + 11.0) - 0.5));
    // Some frames go dark, so it stutters like a bad contact rather than strobing evenly.
    float live = step(0.22, h21(vec2(tick, 3.7)));
    float arc = max(a1, a2 * 0.8) * live;
    float surge = smoothstep(0.94, 1.0, sin(uv.x * 5.0 + uv.y * 3.0 - uTime * 7.0));
    vec3 plate = uCols[o] * (0.8 + 0.5 * vnoise(p * 0.8 + 4.0));
    emit = mix(uCols[o + 1], uCols[o + 2], arc * arc) * arc * 2.4 + uCols[o + 1] * surge * 0.55;
    gloss = 0.6;
    return plate;
  }
  if (pat == 10) {               // Polar Night: aurora curtains rippling over a starfield.
    vec2 q = p;
    float sway = vnoise(vec2(q.x * 0.7 + uTime * 0.28, uTime * 0.2)) * 2.0;
    float curtain = pow(0.5 + 0.5 * sin(q.y * 1.7 + sway * 3.2 + uTime * 0.85), 3.0);
    float rays = 0.55 + 0.45 * sin(q.x * 11.0 + sway * 7.0 + uTime * 1.7);
    vec3 hue = mix(uCols[o + 1], uCols[o + 2], smoothstep(-0.7, 0.8, sin(q.x * 0.8 + sway + uTime * 0.45)));
    float cell = h21(floor(p * 7.0));
    float star = step(0.93, cell) * step(length(fract(p * 7.0) - 0.5), 0.2) * (0.6 + 0.4 * sin(uTime * 5.0 + cell * 40.0));
    emit = hue * curtain * rays * 2.1 + uCols[o + 3] * star * 1.3 + hue * curtain * curtain * 0.5;
    gloss = 0.35;
    return uCols[o] * (0.8 + 0.6 * vnoise(p * 0.5 + 2.0));
  }
  if (pat == 11) {               // Event Horizon: black holes whose accretion disks spiral inward.
    vec2 g = p * 0.5;
    vec2 d = fract(g) - 0.5;
    float r = length(d) * 2.0;
    float a = atan(d.y, d.x);
    float seed = h21(floor(g));
    // Two arms, integer multiple of the angle so the atan seam stays hidden.
    float spiral = 0.5 + 0.5 * sin(a * 2.0 + r * 13.0 - uTime * (3.2 + seed * 1.4) + seed * 6.28);
    float disk = (1.0 - smoothstep(0.34, 0.98, r)) * smoothstep(0.2, 0.34, r);
    float lensing = 1.0 - smoothstep(0.0, 0.05, abs(r - 0.32));
    float rim = 1.0 - smoothstep(0.0, 0.03, abs(r - 0.98));
    vec3 hot = mix(uCols[o + 1], uCols[o + 2], spiral * spiral);
    float cell = h21(floor(p * 8.0));
    float star = step(0.92, cell) * step(length(fract(p * 8.0) - 0.5), 0.2) * step(0.98, r) * (0.5 + 0.5 * sin(uTime * 3.0 + cell * 30.0));
    emit = hot * disk * (0.35 + spiral * 1.9) + uCols[o + 2] * lensing * 2.6 + uCols[o + 3] * rim * 0.9 + uCols[o + 3] * star * 1.2;
    gloss = 0.8;
    return uCols[o] * (r < 0.3 ? 0.0 : 1.0);
  }
  return vCol;                   // Solid: the model's factory colour.
}

void main() {
  if (vFx.x < 0.999 && vFx.x < screenDither(gl_FragCoord.xy)) discard;
  vec3 col = vCol, emit = vec3(0.0);
  float gloss = 0.0;
  if (vPart < 0.5) {
    col = camo(vCamo, vUv2, emit, gloss);
    if (gloss == 0.0) gloss = 0.28;
  } else if (vPart < 1.5) {
    gloss = 0.1;
  } else if (vPart < 2.5) {
    gloss = 0.7;
  } else {
    // Accents read as powered strips: colour from the instance, ignores shading.
    col = vec3(0.0);
    emit = vAccent * 1.25;
  }
  col = col * vLight + emit + vSpec * gloss * vec3(1.0, 0.86, 0.68);
  if (vHeat > 0.002) {
    vec3 hot = mix(vec3(1.0, 0.3, 0.04), vec3(1.0, 0.94, 0.78), smoothstep(0.5, 0.95, vHeat));
    col = mix(col, hot, smoothstep(0.0, 0.6, vHeat)) + hot * vHeat * vHeat;
  }
  col += vFx.y * vec3(1.2);
  gl_FragColor = vec4(col, 1.0);
}`;

// A new material per WebGL context. time is a shared {value} so all guns animate together.
export function createCamoMaterial(time) {
  const cols = [];
  const par = [];
  for (const c of CAMOS) {
    for (let i = 0; i < 4; i++) {
      const rgb = hexRGB(c.colors[Math.min(i, c.colors.length - 1)]);
      cols.push(new THREE.Vector3(rgb[0], rgb[1], rgb[2]));
    }
    par.push(new THREE.Vector4(PATTERN_IDS[c.pattern] ?? 0, c.scale || 1, 0, 0));
  }
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uTime: time, uCols: { value: cols }, uPar: { value: par } },
  });
}

// Per-instance attributes every gun mesh needs, aFx defaulting to fully visible.
export function addCamoInstanceAttributes(geometry, capacity) {
  const aCamo = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const aAccent = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(0.6), 3);
  const aFx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  const aHeat = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  for (let i = 0; i < capacity; i++) aFx.setXY(i, 1, 0);
  for (const a of [aCamo, aAccent, aFx, aHeat]) a.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCamo', aCamo);
  geometry.setAttribute('aAccent', aAccent);
  geometry.setAttribute('aFx', aFx);
  geometry.setAttribute('aHeat', aHeat);
  return geometry;
}
