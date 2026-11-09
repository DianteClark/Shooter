// Ambient particles and lightning for the map's theme. Each field is one instanced quad draw and is
// animated entirely in the vertex shader, so a frame costs a few uniform writes and no CPU per particle.
// Particles live in a box that wraps around the camera focus: nothing is ever spawned, simulated or
// drawn away from the screen, and the pool never grows.
import * as THREE from 'three';

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wraps a moving world-space point into the box around uCentre (horizontally) without popping as the camera moves.
const GLSL_WRAP = /* glsl */`
uniform vec3 uCentre;
uniform vec3 uBox;
vec3 wrapBox(vec3 p) {
  p.xz = mod(p.xz - uCentre.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5 + uCentre.xz;
  p.y = mod(p.y, uBox.y);      // Height is measured from the ground, not the camera focus.
  return p;
}`;

const STREAK_VERT = /* glsl */`
${GLSL_WRAP}
uniform vec3 uVel;
uniform float uTime, uLen, uWidth;
attribute vec4 aSeed;
varying float vA;
void main() {
  vec3 p = wrapBox(aSeed.xyz * uBox + uVel * uTime * (0.82 + 0.36 * aSeed.w));
  p.y = max(p.y, 0.02);
  vec3 dir = normalize(uVel);
  // Billboard across the screen: the camera never rotates, so world X is screen-right.
  vec3 world = p + dir * position.y * uLen * (0.7 + 0.6 * aSeed.w) + vec3(1.0, 0.0, 0.0) * position.x * uWidth;
  vA = 1.0 - abs(position.y) * 1.6;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const STREAK_FRAG = /* glsl */`
uniform vec3 uCol;
uniform float uAlpha, uBoost;
varying float vA;
void main() { gl_FragColor = vec4(uCol * (1.0 + uBoost * 2.2), vA * uAlpha); }`;

const RIPPLE_VERT = /* glsl */`
${GLSL_WRAP}
uniform float uTime, uLife, uSize;
attribute vec4 aSeed;
varying vec2 vP;
varying float vT;
void main() {
  float t = fract(uTime / uLife + aSeed.w);
  // Re-roll position each cycle so a ring doesn't keep landing on the same spot.
  float n = floor(uTime / uLife + aSeed.w);
  vec3 p = wrapBox(vec3(aSeed.x + fract(n * 0.618) * 7.0, 0.0, aSeed.z + fract(n * 0.732) * 11.0) * uBox);
  p.y = 0.06;
  float s = uSize * (0.25 + 0.75 * t);
  vP = position.xz * 2.0;
  vT = t;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + position * s, 1.0);
}`;

const RIPPLE_FRAG = /* glsl */`
uniform vec3 uCol;
uniform float uAlpha;
varying vec2 vP;
varying float vT;
void main() {
  float d = length(vP);
  float ring = smoothstep(0.55, 0.82, d) * smoothstep(1.0, 0.86, d);
  gl_FragColor = vec4(uCol, ring * (1.0 - vT) * uAlpha);
}`;

const MOTE_VERT = /* glsl */`
${GLSL_WRAP}
uniform vec3 uVel;
uniform float uTime, uSize;
attribute vec4 aSeed;
varying vec2 vP;
void main() {
  vec3 base = aSeed.xyz * uBox + uVel * uTime * (0.7 + 0.6 * aSeed.w);
  // A slow sideways wander so a cloud of them doesn't move as one sheet.
  base.xz += vec2(sin(uTime * 0.5 + aSeed.y * 40.0), cos(uTime * 0.4 + aSeed.x * 40.0)) * 0.5;
  vec3 p = wrapBox(base);
  p.y = max(p.y, 0.05);
  float s = uSize * (0.6 + 0.8 * aSeed.w);
  vP = position.xy * 2.0;
  // Keep it facing the fixed tilted camera: X across the screen, Y mostly up.
  vec3 world = p + vec3(position.x, position.y * 0.82, position.y * 0.57) * s;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const MOTE_FRAG = /* glsl */`
uniform vec3 uCol;
uniform float uAlpha;
varying vec2 vP;
void main() {
  float a = max(0.0, 1.0 - dot(vP, vP));
  gl_FragColor = vec4(uCol, a * a * uAlpha);
}`;

function makeField(spec, rnd, sharedBox) {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = spec.kind === 'ripple'
    ? [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]
    : [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(quad, 3));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  const seeds = new Float32Array(spec.count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = spec.count;

  const col = new THREE.Vector3(...spec.col);
  const box = new THREE.Vector3(...spec.box);
  const u = { uCentre: sharedBox.centre, uBox: { value: box }, uTime: sharedBox.time, uCol: { value: col }, uAlpha: { value: spec.alpha } };
  let vertexShader, fragmentShader;
  if (spec.kind === 'rain' || spec.kind === 'streak') {
    vertexShader = STREAK_VERT; fragmentShader = STREAK_FRAG;
    u.uVel = { value: new THREE.Vector3(...spec.vel) };
    u.uLen = { value: spec.len };
    u.uWidth = { value: spec.width };
    u.uBoost = sharedBox.flash;
  } else if (spec.kind === 'ripple') {
    vertexShader = RIPPLE_VERT; fragmentShader = RIPPLE_FRAG;
    u.uLife = { value: spec.life };
    u.uSize = { value: spec.size };
  } else {
    vertexShader = MOTE_VERT; fragmentShader = MOTE_FRAG;
    u.uVel = { value: new THREE.Vector3(...spec.vel) };
    u.uSize = { value: spec.size };
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms: u,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;   // The box follows the camera, so it is always in view by construction.
  mesh.renderOrder = 8;
  return mesh;
}

export class Weather {
  constructor(scene, theme) {
    this.scene = scene;
    this.theme = theme;
    this.time = { value: 0 };
    this.centre = { value: new THREE.Vector3() };
    this.flash = { value: 0 };           // 0..1, lightning; also brightens rain as a cheap wet-air bloom.
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    const rnd = mulberry(4021);
    const shared = { centre: this.centre, time: this.time, flash: this.flash };
    for (const spec of theme.weather.fields) this.group.add(makeField(spec, rnd, shared));
    scene.add(this.group);

    this.rng = mulberry(77);
    this.nextStrike = 4 + this.rng() * 6;
    this.strike = 0;                     // Time inside the current strike.
    this.strikeLen = 0;
  }

  // A strike is a quick double flash with a decaying tail, not one fade.
  _lightning(dt) {
    if (this.strikeLen <= 0) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) { this.strikeLen = 0.75; this.strike = 0; }
      return 0;
    }
    this.strike += dt;
    const t = this.strike;
    let v = Math.exp(-t * 7.5);
    if (t > 0.14) v = Math.max(v, 0.85 * Math.exp(-(t - 0.14) * 9));
    if (t > 0.34) v = Math.max(v, 0.45 * Math.exp(-(t - 0.34) * 11));
    if (t >= this.strikeLen) { this.strikeLen = 0; this.nextStrike = 7 + this.rng() * 12; return 0; }
    return v;
  }

  // focusX/Z is the camera's ground focus; worldMat receives the flash on its uFlash uniform.
  update(dt, focusX, focusZ, worldMat) {
    this.time.value = (this.time.value + dt) % 3600;
    this.centre.value.set(focusX, 0, focusZ + 2);
    if (this.theme.lightning) {
      const f = this._lightning(dt);
      this.flash.value = f;
      if (worldMat) worldMat.uniforms.uFlash.value = f;
    }
  }

  get drawCalls() { return this.group.children.length; }

  dispose() {
    this.scene.remove(this.group);
    for (const m of this.group.children) { m.geometry.dispose(); m.material.dispose(); }
    this.group.clear();
  }
}
