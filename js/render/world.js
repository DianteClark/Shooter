// Generates the freight yard from map.walls. Everything static lands in one opaque merged mesh with
// lighting baked per triangle on the CPU (no realtime lights), plus one multiply-blended decal mesh
// for sun shadows and contact darkening. Two draw calls for the whole map.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuild.js';
import { hexRGB, lightAt, SUN_DIR } from './art.js';

export const MAX_POPS = 4;   // Simultaneous dynamic light pops the ground shader evaluates.

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise for the ground: returns 0..1.
function makeNoise(seed) {
  const rnd = mulberry(seed);
  const size = 64, grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (x, z) => grid[((z & (size - 1)) * size) | (x & (size - 1))];
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    let fx = x - xi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = at(xi, zi), b = at(xi + 1, zi), c = at(xi, zi + 1), d = at(xi + 1, zi + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

const INK = {
  ground:   hexRGB(0x5a5552), asphalt: hexRGB(0x4b4a52), dirt: hexRGB(0x6a5c4e), gravel: hexRGB(0x60595a),
  roof:     hexRGB(0x565f6b), wall: hexRGB(0x6a5f58), wallB: hexRGB(0x5b5f66), trim: hexRGB(0x3f3d44),
  concrete: hexRGB(0x7b7a78), crate: hexRGB(0x9a7a4c), crateD: hexRGB(0x5c4a30),
  rail:     hexRGB(0x7f8690), tie: hexRGB(0x3f3530), hazardY: hexRGB(0x9c7a2c), hazardK: hexRGB(0x24222a),
  paint:    hexRGB(0xc9b48a), glow: hexRGB(0xffcf8a), glowCool: hexRGB(0xbdd8ff),
};

const CONTAINER_COLORS = [0x3c6a72, 0x8a4634, 0xa8853c, 0x5b4a6e, 0x3e5a48];

const VERT = /* glsl */`
attribute vec3 aCol;
uniform vec4 uFogXf;
varying vec3 vCol;
varying vec3 vWorld;
varying vec2 vFogUv;
void main() {
  vCol = aCol;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  // Vertical faces sample the mask just in front of themselves so a lit wall face matches lit ground.
  vec2 p = w.xz + normal.xz * 0.45;
  vFogUv = p * uFogXf.xy + uFogXf.zw;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */`
uniform sampler2D uFogTex;
uniform float uFogOn;
uniform float uDesat;
uniform vec4 uPopPos[${MAX_POPS}];   // x,y,z,radius
uniform vec3 uPopCol[${MAX_POPS}];
varying vec3 vCol;
varying vec3 vWorld;
varying vec2 vFogUv;
const vec3 LUM = vec3(0.3, 0.59, 0.11);
void main() {
  vec3 col = vCol;
  for (int i = 0; i < ${MAX_POPS}; i++) {
    vec3 d = vWorld - uPopPos[i].xyz;
    float r2 = uPopPos[i].w * uPopPos[i].w;
    float f = max(0.0, 1.0 - dot(d, d) / r2);
    col += col * uPopCol[i] * f * f;
  }
  float v = texture2D(uFogTex, vFogUv).r;
  vec2 q = abs(vFogUv - 0.5);
  float outside = smoothstep(0.495, 0.505, max(q.x, q.y));
  v = max(v, outside * 0.6);                // Off-map scenery stays dim but legible.
  v = mix(1.0, v, uFogOn);
  float vis = smoothstep(0.1, 0.9, v);
  float lum = dot(col, LUM);
  vec3 fogged = mix(vec3(lum), col, 0.3) * vec3(0.4, 0.44, 0.6);
  vec3 lit = mix(fogged, col, vis);
  lit += (vis * (1.0 - vis)) * vec3(0.16, 0.10, 0.04);   // Thin warm seam where vision ends.
  if (uDesat > 0.0) lit = mix(lit, vec3(dot(lit, LUM)) * vec3(0.8, 0.78, 0.9), uDesat);
  gl_FragColor = vec4(lit, 1.0);
}`;

export function createWorldMaterial(fogUniforms) {
  const pos = [], col = [];
  for (let i = 0; i < MAX_POPS; i++) { pos.push(new THREE.Vector4(0, -100, 0, 1)); col.push(new THREE.Vector3()); }
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uFogTex: fogUniforms.tex, uFogXf: fogUniforms.xf, uFogOn: fogUniforms.on,
      uDesat: { value: 0 }, uPopPos: { value: pos }, uPopCol: { value: col },
    },
  });
}

// World-baking rules: every face is lit once, here, and emissive surfaces skip the bake.
function makeBake(lamps) {
  return (nx, ny, nz, c, cx, cy, cz) => {
    const l = lightAt(nx, ny, nz);
    let r = c[0] * l[0], g = c[1] * l[1], b = c[2] * l[2];
    if (ny > 0.5) {           // Warm floodlight pools on horizontal faces.
      for (const lp of lamps) {
        const d2 = (cx - lp.x) ** 2 + (cz - lp.z) ** 2;
        const f = Math.max(0, 1 - d2 / (lp.r * lp.r));
        r += c[0] * f * 0.34; g += c[1] * f * 0.24; b += c[2] * f * 0.12;
      }
    }
    return [r, g, b];
  };
}

function box3(b, x, y, z, w, h, d, ch = 0) { b.box(x + w / 2, y + h / 2, z + d / 2, w, h, d, ch); }

function emissive(b, fn) {
  const saved = b.bake;
  b.bake = null;
  fn();
  b.bake = saved;
}

function building(b, w, rnd, lamps) {
  const { x, z, w: bw, d: bd, h, landmark } = w;
  const wallC = landmark ? INK.concrete : (rnd() < 0.5 ? INK.wall : INK.wallB);
  b.setColor(wallC);
  box3(b, x, 0, z, bw, h - 0.25, bd);
  b.setColor(INK.trim);
  box3(b, x - 0.05, 0, z - 0.05, bw + 0.1, 0.45, bd + 0.1);       // Dark footing.

  // Corrugation ribs on all four sides.
  b.setColor(wallC.map(c => c * 1.14));
  for (let i = 0.5; i < bw; i += 0.8) {
    box3(b, x + i - 0.08, 0.45, z - 0.06, 0.16, h - 0.75, 0.06);
    box3(b, x + i - 0.08, 0.45, z + bd, 0.16, h - 0.75, 0.06);
  }
  for (let i = 0.5; i < bd; i += 0.8) {
    box3(b, x - 0.06, 0.45, z + i - 0.08, 0.06, h - 0.75, 0.16);
    box3(b, x + bw, 0.45, z + i - 0.08, 0.06, h - 0.75, 0.16);
  }

  // Sawn parapet ring and a recessed roof deck.
  b.setColor(INK.trim);
  box3(b, x - 0.1, h - 0.25, z - 0.1, bw + 0.2, 0.3, 0.3);
  box3(b, x - 0.1, h - 0.25, z + bd - 0.2, bw + 0.2, 0.3, 0.3);
  box3(b, x - 0.1, h - 0.25, z - 0.1, 0.3, 0.3, bd + 0.2);
  box3(b, x + bw - 0.2, h - 0.25, z - 0.1, 0.3, 0.3, bd + 0.2);
  b.setColor(INK.roof);
  box3(b, x + 0.2, h - 0.2, z + 0.2, bw - 0.4, 0.04, bd - 0.4);

  // Roof clutter: skylights give the top surface something to read at gameplay zoom.
  const units = Math.max(1, Math.floor(bw / 4));
  for (let i = 0; i < units; i++) {
    const ux = x + 1.2 + (i * (bw - 2.4)) / Math.max(1, units - 1);
    b.setColor(0x7c8590);
    box3(b, ux - 0.6, h - 0.18, z + bd * 0.28, 1.2, 0.45, 0.9, 0.05);
    b.setColor(0x4a505a);
    box3(b, ux - 0.4, h + 0.27, z + bd * 0.28 + 0.15, 0.8, 0.08, 0.6);
    emissive(b, () => {
      b.setColor(INK.glow.map(c => c * 0.55));
      box3(b, ux - 0.75, h - 0.15, z + bd * 0.64, 1.5, 0.05, 0.5);
    });
  }

  // Warm lit windows and a roller door on the camera-facing (south) wall.
  emissive(b, () => {
    b.setColor(INK.glow);
    const n = Math.floor(bw / 2.4);
    for (let i = 0; i < n; i++) {
      const wx = x + 0.9 + (i * (bw - 1.8 - 1.2)) / Math.max(1, n - 1);
      if (Math.abs(wx + 0.6 - (x + bw / 2)) < 1.5) continue;
      box3(b, wx, h * 0.52, z + bd + 0.02, 1.2, 0.55, 0.05);
    }
  });
  b.setColor(0x3a3f47);
  box3(b, x + bw / 2 - 1.3, 0.0, z + bd + 0.02, 2.6, h * 0.62, 0.06);
  b.setColor(INK.hazardY);
  box3(b, x + bw / 2 - 1.3, h * 0.62, z + bd + 0.02, 2.6, 0.14, 0.08);

  if (landmark) {
    // Signal mast on the centrepiece so the middle of the map has a silhouette.
    b.setColor(0x5a6370);
    b.prismY(h - 0.2, h + 2.4, x + bw / 2, z + bd / 2, 0.28, 0.14, 6);
    emissive(b, () => {
      b.setColor([1.0, 0.8, 0.35]);
      b.prismY(h + 1.9, h + 2.3, x + bw / 2, z + bd / 2, 0.26, 0.26, 6);
    });
    b.setColor(INK.hazardY);
    box3(b, x + 0.3, h - 0.14, z + 0.3, bw - 0.6, 0.03, 0.3);
    lamps.push({ x: x + bw / 2, z: z + bd / 2, r: 9 });
  }
}

function container(b, w, rnd) {
  const { x, z, w: cw, d: cd, h } = w;
  const base = hexRGB(CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]);
  const long = cw >= cd;
  const dark = base.map(c => c * 0.72);
  b.setColor(base);
  box3(b, x, 0.12, z, cw, h - 0.18, cd);
  b.setColor(dark);
  box3(b, x - 0.04, 0, z - 0.04, cw + 0.08, 0.14, cd + 0.08);     // Bottom rail.
  box3(b, x - 0.04, h - 0.1, z - 0.04, cw + 0.08, 0.14, cd + 0.08);
  box3(b, x + 0.08, h + 0.04, z + 0.08, cw - 0.16, 0.03, cd - 0.16);
  const step = 0.36;
  b.setColor(dark);
  if (long) {
    for (let i = 0.3; i < cw - 0.15; i += step) {
      box3(b, x + i - 0.05, 0.15, z - 0.05, 0.1, h - 0.3, 0.05);
      box3(b, x + i - 0.05, 0.15, z + cd, 0.1, h - 0.3, 0.05);
    }
  } else {
    for (let i = 0.3; i < cd - 0.15; i += step) {
      box3(b, x - 0.05, 0.15, z + i - 0.05, 0.05, h - 0.3, 0.1);
      box3(b, x + cw, 0.15, z + i - 0.05, 0.05, h - 0.3, 0.1);
    }
  }
  b.setColor(base.map(c => c * 1.18));
  for (let i = 0.5; i < Math.max(cw, cd) - 0.3; i += 0.9) {
    if (long) box3(b, x + i, h + 0.05, z + 0.25, 0.5, 0.03, cd - 0.5);
    else box3(b, x + 0.25, h + 0.05, z + i, cw - 0.5, 0.03, 0.5);
  }
  b.setColor(0xd9d2c0);
  if (long) box3(b, x + cw * 0.3, h * 0.45, z + cd + 0.02, cw * 0.28, h * 0.32, 0.04);
  else box3(b, x + cw + 0.02, h * 0.45, z + cd * 0.3, 0.04, h * 0.32, cd * 0.28);
}

function crate(b, w, rnd) {
  const { x, z, w: cw, d: cd, h } = w;
  const c = rnd() < 0.5 ? INK.crate : INK.crate.map(v => v * 0.9);
  b.setColor(c);
  box3(b, x + 0.08, 0, z + 0.08, cw - 0.16, h - 0.12, cd - 0.16);
  b.setColor(INK.crateD);
  // Frame edges.
  for (const [fx, fz] of [[x, z], [x + cw - 0.2, z], [x, z + cd - 0.2], [x + cw - 0.2, z + cd - 0.2]]) {
    box3(b, fx, 0, fz, 0.2, h, 0.2);
  }
  box3(b, x, h - 0.16, z, cw, 0.16, 0.2);
  box3(b, x, h - 0.16, z + cd - 0.2, cw, 0.16, 0.2);
  box3(b, x, h - 0.16, z, 0.2, 0.16, cd);
  box3(b, x + cw - 0.2, h - 0.16, z, 0.2, 0.16, cd);
  b.setColor(c.map(v => v * 1.15));
  box3(b, x + 0.2, h - 0.1, z + 0.2, cw - 0.4, 0.04, cd - 0.4);
  b.setColor(INK.crateD);
  b.tri([x + 0.3, h - 0.05, z + 0.3], [x + 0.55, h - 0.05, z + 0.3], [x + cw - 0.3, h - 0.05, z + cd - 0.3]);
  b.tri([x + 0.3, h - 0.05, z + 0.3], [x + cw - 0.3, h - 0.05, z + cd - 0.3], [x + cw - 0.55, h - 0.05, z + cd - 0.3]);
}

// Jersey barrier: faceted concrete, hazard stripes on top so it reads as low cover from above.
function barrier(b, w) {
  const { x, z, w: bw, d: bd, h } = w;
  const long = bw >= bd;
  const L = long ? bw : bd, T = long ? bd : bw;
  const ring = (t, inset, y) => {
    const a = long ? [x + t, y, z + inset] : [x + inset, y, z + t];
    const c = long ? [x + t, y, z + bd - inset] : [x + bw - inset, y, z + t];
    return [a, c];
  };
  const profile = (t) => [
    ...ring(t, 0, 0),
    ...ring(t, T * 0.18, h * 0.32),
    ...ring(t, T * 0.34, h),
  ];
  // Rebuild as a convex ring: bottom-near, bottom-far, mid-far, top-far, top-near, mid-near.
  const makeRing = (t) => {
    const p = profile(t);
    return [p[0], p[1], p[3], p[5], p[4], p[2]];
  };
  b.setColor(INK.concrete);
  b.loft([makeRing(0), makeRing(L)]);
  const segs = Math.round(L / 0.6);
  for (let i = 0; i < segs; i++) {
    b.setColor(i % 2 === 0 ? INK.hazardY : INK.hazardK);
    const s0 = (i + 0.06) * (L / segs), s1 = (i + 0.94) * (L / segs);
    const y = h + 0.02, in0 = T * 0.3;
    if (long) box3(b, x + s0, y - 0.03, z + in0, s1 - s0, 0.03, bd - in0 * 2);
    else box3(b, x + in0, y - 0.03, z + s0, bw - in0 * 2, 0.03, s1 - s0);
  }
}

function concreteWall(b, w) {
  const { x, z, w: bw, d: bd, h } = w;
  b.setColor(INK.concrete.map(c => c * 0.9));
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(INK.hazardY);
  box3(b, x - 0.04, h - 0.22, z - 0.04, bw + 0.08, 0.22, bd + 0.08);
  b.setColor(INK.hazardK);
  const long = bw >= bd, L = Math.max(bw, bd);
  for (let i = 0.2; i < L; i += 0.8) {
    if (long) box3(b, x + i, h - 0.24, z - 0.06, 0.4, 0.26, bd + 0.12);
    else box3(b, x - 0.06, h - 0.24, z + i, bw + 0.12, 0.26, 0.4);
  }
}

// Perimeter: precast panels with piers; lamp heads create the warm pools baked into the ground.
function border(b, w) {
  const { x, z, w: bw, d: bd, h } = w;
  const c = INK.concrete.map(v => v * 0.72);
  b.setColor(c);
  box3(b, x, 0, z, bw, h, bd);
  b.setColor(c.map(v => v * 1.2));
  const long = bw >= bd;
  const n = Math.floor(Math.max(bw, bd) / 6);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.max(bw, bd);
    if (long) box3(b, x + t - 0.3, 0, z - 0.2, 0.6, h + 0.3, bd + 0.4);
    else box3(b, x - 0.2, 0, z + t - 0.3, bw + 0.4, h + 0.3, 0.6);
  }
  b.setColor(INK.hazardY.map(v => v * 0.8));
  if (long) box3(b, x, h - 0.5, z - 0.02, bw, 0.16, bd + 0.04);
  else box3(b, x - 0.02, h - 0.5, z, bw + 0.04, 0.16, bd);
}

// Ground: one continuous jittered, height-noised sheet, tinted per facet. Lanes and spawn pads
// are colour regions so the map reads at a glance. Extends well past the walls for off-map views.
function ground(b, map, noise, rnd, W, H) {
  const pad = 28, cell = 1.5;
  const nx = Math.ceil((W + pad * 2) / cell), nz = Math.ceil((H + pad * 2) / cell);
  const pts = [];
  for (let j = 0; j <= nz; j++) {
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const x0 = -pad + i * cell, z0 = -pad + j * cell;
      const edge = i === 0 || j === 0 || i === nx || j === nz;
      const jx = edge ? 0 : (rnd() - 0.5) * cell * 0.55, jz = edge ? 0 : (rnd() - 0.5) * cell * 0.55;
      row.push([x0 + jx, (noise(x0 * 0.5, z0 * 0.5) - 0.5) * 0.12, z0 + jz]);
    }
    pts.push(row);
  }
  const shade = (p) => {
    const [x, , z] = p;
    const inMap = x > 0 && x < W && z > 0 && z < H;
    let base = INK.ground;
    let dLane = 99;
    for (const l of map.lanes) dLane = Math.min(dLane, Math.abs(z - l.z));
    if (!inMap) base = INK.ground.map(c => c * 0.72);
    else if (dLane < 3.2) base = INK.asphalt;
    else if (noise(x * 0.18 + 9, z * 0.18) > 0.6) base = INK.dirt;
    const v = 0.9 + noise(x * 0.8, z * 0.8) * 0.2 + (rnd() - 0.5) * 0.06;
    return base.map(c => c * v);
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = pts[j][i], b1 = pts[j + 1][i], c = pts[j + 1][i + 1], d = pts[j][i + 1];
      const flip = rnd() < 0.5;
      const t1 = flip ? [a, b1, c] : [a, b1, d];
      const t2 = flip ? [a, c, d] : [d, b1, c];
      for (const t of [t1, t2]) {
        b.color = shade(t[0]);
        b.tri(t[0], t[1], t[2]);
      }
    }
  }
}

// Things that lie flat, so they never lie about what blocks you.
function groundPaint(b, map, rnd, W, H) {
  const blocked = (x, z, pad = 0.2) => map.walls.some(w => x > w.x - pad && x < w.x + w.w + pad && z > w.z - pad && z < w.z + w.d + pad);
  const y = 0.1;

  // Rails down the north and south lanes, broken where a wall sits on them.
  for (const lane of map.lanes) {
    if (lane.id === 'mid') continue;
    const zc = lane.z;
    for (let x = -26; x < W + 26; x += 1.05) {
      if (blocked(x, zc)) continue;
      b.setColor(INK.tie);
      box3(b, x, 0.02, zc - 1.2, 0.34, 0.1, 2.4);
    }
    for (const dz of [-0.75, 0.75]) {
      b.setColor(INK.rail);
      let start = null;
      for (let x = -26; x < W + 26.5; x += 0.5) {
        const free = !blocked(x, zc + dz, 0.05);
        if (free && start === null) start = x;
        if (!free && start !== null) { box3(b, start, 0.1, zc + dz - 0.06, x - start, 0.08, 0.12); start = null; }
      }
      if (start !== null) box3(b, start, 0.1, zc + dz - 0.06, W + 26 - start, 0.08, 0.12);
    }
  }

  // Dashed centre line on the mid lane, stopping for the landmark.
  b.setColor(INK.paint.map(c => c * 0.75));
  for (let x = 5; x < W - 5; x += 3.2) {
    if (!blocked(x + 0.9, 24, 0.4)) b.groundRect(x, 23.9, 1.8, 0.2, y);
  }
  // Lane edge lines.
  for (const lane of map.lanes) {
    for (let x = 3; x < W - 3; x += 0.9) {
      for (const dz of [-3.6, 3.6]) {
        if (!blocked(x + 0.3, lane.z + dz, 0.2) && rnd() > 0.12) {
          const k = 0.45 + rnd() * 0.2;
          b.setColor(INK.paint.map(c => c * k));
          b.groundRect(x, lane.z + dz - 0.06, 0.7, 0.12, y);
        }
      }
    }
  }
  // Hazard chevrons framing the centre building.
  const lm = map.walls.find(w => w.landmark);
  if (lm) {
    for (let i = 0; i < 7; i++) {
      for (const side of [-1, 1]) {
        const sx = side < 0 ? lm.x - 1.0 : lm.x + lm.w + 0.1;
        b.setColor(i % 2 ? INK.hazardY.map(c => c * 0.8) : INK.hazardK);
        b.tri([sx, y, lm.z + i], [sx, y, lm.z + i + 1], [sx + 0.9, y, lm.z + i + 1]);
        b.tri([sx, y, lm.z + i], [sx + 0.9, y, lm.z + i + 1], [sx + 0.9, y, lm.z + i]);
      }
    }
  }
}

// Saturated team paint is reserved for the spawn pads; everything else in the yard stays muted.
function spawnPads(b, map, teams, W) {
  const y = 0.09;
  map.spawns.forEach((list, team) => {
    const c = hexRGB(teams[team].color);
    const dim = c.map(v => v * 0.55);
    const x0 = team === 0 ? 0.6 : W - 5.6;
    emissive(b, () => {
      b.setColor(dim);
      for (const s of list) {
        b.tri([s.x - 1.1, y, s.z - 1.1], [s.x - 1.1, y, s.z + 1.1], [s.x + 1.1, y, s.z + 1.1]);
        b.tri([s.x - 1.1, y, s.z - 1.1], [s.x + 1.1, y, s.z + 1.1], [s.x + 1.1, y, s.z - 1.1]);
      }
      b.setColor(c);
      for (let z = 1; z < map.height - 1; z += 3) {
        b.tri([x0, y, z], [x0, y, z + 1.6], [x0 + 1.6, y, z + 0.8]);
      }
    });
  });
}

// Off-map silhouette: container stacks and sheds so the arena does not float in nothing.
function backdrop(b, W, H, rnd) {
  const place = (x, z) => {
    const base = hexRGB(CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]).map(c => c * 0.6);
    b.setColor(base);
    const wid = 5 + rnd() * 2, dep = 2.5, stack = 1 + Math.floor(rnd() * 3);
    for (let s = 0; s < stack; s++) box3(b, x + (rnd() - 0.5) * 0.8, s * 2.7, z, wid, 2.6, dep);
  };
  for (let x = -22; x < W + 22; x += 8.5 + rnd() * 3) { place(x, -6.5 - rnd() * 5); place(x, -13 - rnd() * 5); place(x + 3, H + 3.5 + rnd() * 3); place(x + 1, H + 9 + rnd() * 3); }
  for (let z = -10; z < H + 10; z += 8 + rnd() * 3) { place(-11 - rnd() * 4, z); place(W + 4 + rnd() * 4, z); }
}

// Floodlight masts along the north wall. Lamp heads are emissive.
function floodlights(b, W, H, lamps) {
  for (let x = 12; x < W; x += 16) {
    b.setColor(0x4a505a);
    b.prismY(4, 7.8, x, -0.75, 0.13, 0.09, 6);
    b.setColor(0x383c44);
    box3(b, x - 1, 7.7, -1.1, 2, 0.14, 0.45);
    emissive(b, () => { b.setColor([1.0, 0.86, 0.58]); box3(b, x - 0.85, 7.6, -0.72, 1.7, 0.06, 0.26); });
    lamps.push({ x, z: 4, r: 13 });
  }
  for (let x = 4; x < W; x += 16) lamps.push({ x, z: H + 2, r: 12 });
}

// Sun shadows and contact darkening: per-vertex strength a, drawn with multiply blending.
function buildDecals(map) {
  const pos = [], str = [];
  const push = (x, z, a) => { pos.push(x, 0.14, z); str.push(a); };
  const tri = (ax, az, aa, bx, bz, ba, cx, cz, ca) => { push(ax, az, aa); push(bx, bz, ba); push(cx, cz, ca); };

  // Shadow direction on the ground, away from the sun, lengthened for a low dusk sun.
  const sx = -SUN_DIR[0] / SUN_DIR[1], sz = -SUN_DIR[2] / SUN_DIR[1];
  for (const w of map.walls) {
    const h = w.h * 0.82;
    const pts = [
      [w.x, w.z, 0.62], [w.x + w.w, w.z, 0.62], [w.x + w.w, w.z + w.d, 0.62], [w.x, w.z + w.d, 0.62],
      [w.x + sx * h, w.z + sz * h, 0.03], [w.x + w.w + sx * h, w.z + sz * h, 0.03],
      [w.x + w.w + sx * h, w.z + w.d + sz * h, 0.03], [w.x + sx * h, w.z + w.d + sz * h, 0.03],
    ];
    // Convex hull (monotone chain) so overlapping side quads never double-darken.
    const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of s) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = s.length - 1; i >= 0; i--) { const p = s[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    const c = [w.x + w.w / 2, w.z + w.d / 2];
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i], q = hull[(i + 1) % hull.length];
      // Winding is CCW in (x,z), which faces up; shadows are viewed from above.
      tri(c[0], c[1], 0.62, q[0], q[1], q[2], p[0], p[1], p[2]);
    }

    // Soft contact band hugging the footprint.
    const e = 0.55;
    const band = (ax, az, bx, bz, ox, oz) => {
      tri(ax, az, 0.5, ax + ox, az + oz, 0, bx + ox, bz + oz, 0);
      tri(ax, az, 0.5, bx + ox, bz + oz, 0, bx, bz, 0.5);
    };
    band(w.x, w.z + w.d, w.x + w.w, w.z + w.d, 0, e);
    band(w.x + w.w, w.z, w.x, w.z, 0, -e);
    band(w.x, w.z, w.x, w.z + w.d, -e, 0);
    band(w.x + w.w, w.z + w.d, w.x + w.w, w.z, e, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aStr', new THREE.Float32BufferAttribute(str, 1));
  return g;
}

export function buildWorld(map, teams, fogUniforms) {
  const rnd = mulberry(7321);
  const noise = makeNoise(991);
  const lamps = [];
  const W = map.width, H = map.height;

  // Lamps need registering before ground bakes, so collect them first.
  const b = new MeshBuilder(makeBake(lamps));
  floodlights(b, W, H, lamps);
  for (const w of map.walls) if (w.landmark) lamps.push({ x: w.x + w.w / 2, z: w.z + w.d / 2, r: 9 });

  ground(b, map, noise, rnd, W, H);
  groundPaint(b, map, rnd, W, H);
  spawnPads(b, map, teams, W);
  for (const w of map.walls) {
    if (w.kind === 'building') building(b, w, rnd, lamps);
    else if (w.kind === 'container') container(b, w, rnd);
    else if (w.kind === 'wall') concreteWall(b, w);
    else if (w.kind === 'border') border(b, w);
    else if (w.kind === 'crate') crate(b, w, rnd);
    else if (w.kind === 'barrier') barrier(b, w);
  }
  backdrop(b, W, H, rnd);

  const group = new THREE.Group();
  const material = createWorldMaterial(fogUniforms);
  const world = new THREE.Mesh(b.build(), material);
  world.frustumCulled = false;
  group.add(world);

  const decalMat = new THREE.ShaderMaterial({
    vertexShader: `attribute float aStr; varying float vS; void main(){ vS = aStr; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying float vS; void main(){ gl_FragColor = vec4(mix(vec3(1.0), vec3(0.42,0.40,0.62), vS), 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    side: THREE.DoubleSide,
  });
  const decals = new THREE.Mesh(buildDecals(map), decalMat);
  decals.frustumCulled = false;
  decals.renderOrder = -1;
  group.add(decals);

  return { group, material, tris: b.pos.length / 9 };
}
