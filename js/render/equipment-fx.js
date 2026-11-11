// Gear wave equipment, drawn: the ten new tacticals and lethals (js/sim/equipment.js), and the read-at-a-glance extras
// the reworked old ones need (a Sticky riding a player, a Tagger dart on its mark). Kept out of combat.js so that file
// and vfx.js stay the weapon-feel engineer's; CombatFX owns one of these and calls update() and onEvents().
//
// Budget: one instanced draw for every model here (same shader as the grenades: combat.modelMat), nothing allocated
// per frame. Everything else rides vfx.js batches (addDot, addRing, ring, spawn, sparks, pop), so it costs no draw
// calls of its own, and degrades with the quality profile through vfx._n.
//
// Read from the top-down camera, on a phone, at a glance:
//   Satchel   a blinking red lamp; its owner also sees the blast ring, so they know when to tap Detonate.
//   Thermite  a white-hot disc the size of its burn, with a spark fountain: the doorway is shut, visibly.
//   Tripwire  its whole beam as a dotted laser in the owner's team colour, for both sides. Seeing it is the counter.
//   Crawler   a legged puck with a red hunting ring while it chases.
//   Bulwark   a real-size waist-high shield with a team-coloured strip.
//   Medpack   a green cross case and its heal ring, teammates only.
//   Snapshot  a camera-flash burst on top of the recon ring; Tagger a dart and a ring round its victim.
//   Sticky    on a player: a magenta lamp over their head and a ring at their feet, so everybody sees who is carrying it.
import * as THREE from 'three';
import * as VFX from './vfx.js';
import { castRay } from './fog.js';
import { hexRGB } from './art.js';
import { smokeBlocks } from '../shared/geometry.js';
import { EQUIPMENT, tripBeam } from '../sim/equipment.js';

const KINDS = ['snapshot', 'blackout', 'bulwark', 'tagger', 'medpack', 'charge', 'thermite', 'tripwire', 'crawler', 'shiv'];
const MODEL = Object.fromEntries(KINDS.map((k, i) => [k, i]));
const MAX = 20;
const SCALE = 1.35;                       // Same oversize as the grenades (combat.js NADE_SCALE); the Bulwark is life size.
const BASE = { snapshot: 0.18, blackout: 0.08, bulwark: 0, tagger: 0.05, medpack: 0.13, charge: 0.09, thermite: 0.18, tripwire: 0.1, crawler: 0.14, shiv: 0.04 };

// Signature colours: body band, trail, throw preview, bursts. Merged into combat.js NADE_RGB so the throw arc agrees.
export const GEAR_RGB = {
  snapshot: hexRGB(0xf4f8ff), blackout: hexRGB(0x6aa8ff), bulwark: hexRGB(0x9fb4c4), tagger: hexRGB(0xffd23c), medpack: hexRGB(0x46f08a),
  charge: hexRGB(0xff3a2a), thermite: hexRGB(0xfff1b0), tripwire: hexRGB(0xff2a4a), crawler: hexRGB(0xff6a2a), shiv: hexRGB(0xd8e2ea),
};
// Throw-preview danger ring for each kind: its effect radius.
const S = EQUIPMENT;
export const GEAR_BLAST_R = {
  snapshot: S.snapshot.snap.radius, blackout: S.blackout.emp.radius, bulwark: S.bulwark.cover.half, tagger: 0.8, medpack: S.medpack.medic.radius,
  charge: S.charge.blast.radius, thermite: S.thermite.burn.radius, tripwire: 0.9, crawler: S.crawler.crawl.seek, shiv: 0.6,
};
const THERM_R = S.thermite.burn.radius, THERM_LIFE = S.thermite.fuse, MED_R = S.medpack.medic.radius, CHARGE_R = S.charge.blast.radius;
const EMP_R = S.blackout.emp.radius;
const WHITE = [1, 1, 1], HOT = [1, 0.86, 0.5], DEBRIS = [0.55, 0.58, 0.6], STICKY_RGB = hexRGB(0xff2bd6);
const rand = (a, b) => a + Math.random() * (b - a);

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0), _axisZ = new THREE.Vector3(0, 0, 1);
const BEAM = { x0: 0, z0: 0, x1: 0, z1: 0 };

// Origin at the centre, +X the throw direction (and the way a planted one faces), before SCALE.
function buildModels(ModelSet) {
  const S = new ModelSet();
  S.model(MODEL.snapshot, b => {        // Squat silver can with a big lens on top.
    b.setPart(0).setColor(0x3a3f46).prismY(-0.18, 0.1, 0, 0, 0.16, 0.16, 8);
    b.setPart(1).prismY(-0.08, -0.02, 0, 0, 0.166, 0.166, 8);
    b.setPart(0).setColor(0x22252a).prismY(0.1, 0.16, 0, 0, 0.13, 0.12, 8);
    b.setPart(2).prismY(0.16, 0.2, 0, 0, 0.09, 0.07, 8);
  });
  S.model(MODEL.blackout, b => {        // Flat blue-rimmed EMP disc with a coil dome.
    b.setPart(0).setColor(0x22262c).prismY(-0.08, 0.03, 0, 0, 0.27, 0.25, 8);
    b.setPart(1).prismY(-0.03, 0.0, 0, 0, 0.275, 0.275, 8);
    b.setPart(0).setColor(0x5a6068).prismY(0.03, 0.08, 0, 0, 0.16, 0.13, 8);
    b.setPart(2).prismY(0.08, 0.15, 0, 0, 0.09, 0.03, 6);
  });
  S.model(MODEL.bulwark, b => {         // Life size: a 2.5 m ballistic panel on two feet, team strip along the top.
    b.setPart(0).setColor(0x4c5660).box(0, 0.55, 0, 0.36, 1.0, 2.5, 0.04);
    b.setColor(0x6a7782).box(0.19, 0.6, -0.62, 0.05, 0.78, 1.0, 0.02);
    b.box(0.19, 0.6, 0.62, 0.05, 0.78, 1.0, 0.02);
    b.setPart(1).box(0, 1.08, 0, 0.4, 0.1, 2.54);
    b.setPart(0).setColor(0x2a2d33).box(-0.22, 0.05, -0.95, 0.5, 0.1, 0.16);
    b.box(-0.22, 0.05, 0.95, 0.5, 0.1, 0.16);
    b.setPart(2).box(0.09, 0.95, 0, 0.02, 0.1, 0.5);
  });
  S.model(MODEL.tagger, b => {          // A dart: barbed tip on +X, fins at the back, a lit body.
    b.setPart(0).setColor(0x30353b).prismX(-0.2, 0.12, 0, 0, 0.035, 0.035, 5);
    b.setColor(0xc8d0d8).prismX(0.12, 0.24, 0, 0, 0.035, 0.002, 5);
    b.setPart(1).box(-0.18, 0, 0, 0.08, 0.13, 0.015); b.box(-0.18, 0, 0, 0.08, 0.015, 0.13);
    b.setPart(2).prismX(-0.04, 0.06, 0, 0, 0.045, 0.045, 5);
  });
  S.model(MODEL.medpack, b => {         // White case, green cross, a handle.
    b.setPart(0).setColor(0xd8dde2).box(0, 0, 0, 0.36, 0.22, 0.26, 0.02);
    b.setPart(1).box(0, 0.115, 0, 0.2, 0.012, 0.06); b.box(0, 0.115, 0, 0.06, 0.012, 0.2);
    b.setPart(0).setColor(0x2a2d33).box(0, 0.14, 0, 0.14, 0.03, 0.03);
    b.setPart(2).box(0.185, 0.02, 0, 0.012, 0.06, 0.08);
  });
  S.model(MODEL.charge, b => {          // Taped putty block, a detonator box, an aerial and its lamp.
    b.setPart(0).setColor(0xb8a070).box(0, 0, 0, 0.36, 0.12, 0.24, 0.02);
    b.setPart(1).box(-0.12, 0.0, 0, 0.035, 0.126, 0.246); b.box(0.12, 0.0, 0, 0.035, 0.126, 0.246);
    b.setPart(0).setColor(0x2a2d33).box(0, 0.09, 0, 0.13, 0.06, 0.12, 0.01);
    b.prismY(0.12, 0.42, 0.05, 0.04, 0.008, 0.006, 4);
    b.setPart(2).prismY(0.11, 0.15, -0.03, -0.02, 0.03, 0.025, 5);
  });
  S.model(MODEL.thermite, b => {        // Grey canister, orange band, a fizzing cap.
    b.setPart(0).setColor(0x6a6e72).prismY(-0.18, 0.12, 0, 0, 0.12, 0.12, 8);
    b.setPart(1).prismY(-0.06, 0.02, 0, 0, 0.126, 0.126, 8);
    b.setPart(0).setColor(0x2e3238).prismY(0.12, 0.17, 0, 0, 0.09, 0.07, 6);
    b.setPart(2).prismY(0.17, 0.22, 0, 0, 0.05, 0.02, 6);
  });
  S.model(MODEL.tripwire, b => {        // A wedge anchor with an emitter lens facing +X.
    b.setPart(0).setColor(0x3a3f46).box(-0.02, 0, 0, 0.16, 0.2, 0.24, 0.02);
    b.setPart(1).box(-0.1, 0, 0, 0.02, 0.21, 0.25);
    b.setPart(0).setColor(0x22252a).prismX(0.06, 0.12, 0, 0, 0.06, 0.05, 6);
    b.setPart(2).prismX(0.12, 0.15, 0, 0, 0.04, 0.04, 6);
  });
  S.model(MODEL.crawler, b => {         // Domed puck on four splayed legs, eye on +X.
    b.setPart(0).setColor(0x2e3238).prismY(-0.04, 0.08, 0, 0, 0.17, 0.15, 8);
    b.setPart(1).prismY(0.08, 0.14, 0, 0, 0.13, 0.06, 8);
    b.setPart(0).setColor(0x5a6068);
    for (let i = 0; i < 4; i++) { const a = 0.785 + i * 1.5708; b.box(Math.cos(a) * 0.2, -0.08, Math.sin(a) * 0.2, 0.05, 0.12, 0.05); }
    b.setPart(2).prismX(0.14, 0.19, 0.04, 0, 0.035, 0.035, 5);
  });
  S.model(MODEL.shiv, b => {            // Wrapped grip, guard, a long bright blade along +X.
    b.setPart(1).box(-0.16, 0, 0, 0.16, 0.05, 0.05);
    b.setPart(0).setColor(0x2a2d33).box(-0.07, 0, 0, 0.025, 0.04, 0.12);
    b.setColor(0xc8d0d8).extrude([[-0.06, -0.025], [0.2, -0.025], [0.28, 0.0], [0.2, 0.025], [-0.06, 0.025]], -0.008, 0.008);
    b.setPart(2).box(-0.245, 0, 0, 0.02, 0.055, 0.055);
  });
  return S.build();
}

export class EquipmentFX {
  // combat: the CombatFX that owns this (scene, vfx, time, modelMat, teamRGB, teamOf, posOf, map). The tables are
  // combat.js's own, passed in so this file needs nothing exported from it but the model builder.
  constructor(combat, { ModelSet, NADE_RGB, BLAST_R }) {
    this.c = combat;
    this.vfx = combat.vfx;
    Object.assign(NADE_RGB, GEAR_RGB);
    Object.assign(BLAST_R, GEAR_BLAST_R);
    this.visionWalls = combat.map.walls.filter(w => w.blocksVision);
    const geom = buildModels(ModelSet);
    const add = (name, n) => geom.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage));
    add('aShow', 1); add('aAcc', 3); add('aLight', 4); add('aFx', 4);
    const mesh = this.mesh = new THREE.InstancedMesh(geom, combat.modelMat, MAX);
    mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 3;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.array.fill(0);
    combat.scene.add(mesh);
    this.slots = Array.from({ length: MAX }, () => ({ id: null, spin: 0, yaw: 0, touched: false, lit: false }));
    this.trail = 0;
    VFX.prewarm?.([mesh]);
  }

  #clear(x0, z0, x1, z1, smokes) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.5) return true;
    return castRay(this.visionWalls, x0, z0, dx / len, dz / len, len) >= len && !smokeBlocks(smokes, x0, z0, x1, z1);
  }

  update(view, dt, lx, lz, localTeam, hasLocal) {
    const list = view.projectiles, mesh = this.mesh, g = mesh.geometry, vfx = this.vfx, c = this.c;
    const aShow = g.attributes.aShow, aAcc = g.attributes.aAcc, aLight = g.attributes.aLight;
    const t = c.time.value, slots = this.slots;
    this.trail += dt;
    const trail = this.trail > 0.05;
    if (trail) this.trail = 0;
    for (let i = 0; i < slots.length; i++) slots[i].touched = false;
    let n = 0;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        // A Sticky riding someone: combat.js draws the charge; this marks the carrier for everyone.
        if (p.kind === 'sticky' && p.attached) {
          const k = 0.5 + 0.5 * Math.sin(t * 22);
          vfx.addDot(p.x, 2.0, p.z, 0.3 + 0.12 * k, STICKY_RGB);
          vfx.addRing(p.x, p.z, 0.75, 0.95, STICKY_RGB, 0.55 + 0.4 * k);
          continue;
        }
        const model = MODEL[p.kind];
        if (model === undefined || n >= MAX) continue;
        const team = c.teamOf.get(p.owner), friendly = team === localTeam, mine = p.owner === view.localId;
        const tc = c.teamRGB[team ?? 0] ?? c.teamRGB[0];
        // Enemy kit shows only where you could see it, like every other grenade; a Bulwark is cover, so always.
        if (hasLocal && !friendly && p.kind !== 'bulwark' && !this.#clear(lx, lz, p.x, p.z, view.smokes)) continue;
        let s = null;
        for (let k = 0; k < slots.length; k++) if (slots[k].id === p.id) { s = slots[k]; break; }
        if (!s) {
          for (let k = 0; k < slots.length; k++) if (slots[k].id === null) { s = slots[k]; break; }
          if (!s) continue;
          s.id = p.id; s.spin = Math.random() * 6; s.yaw = Math.atan2(p.vz || 0, p.vx || 0); s.lit = false;
        }
        s.touched = true;
        const vx = p.vx || 0, vz = p.vz || 0, speed = Math.hypot(vx, vz), age = p.age || 0;
        // Planted things keep their facing in vx, vz (Bulwark, Tripwire); flying ones face their velocity.
        if (speed > 0.05 && (!p.stuck || p.kind === 'bulwark' || p.kind === 'tripwire')) s.yaw = Math.atan2(vz, vx);
        const sc = p.kind === 'bulwark' ? 1 : SCALE;
        let y = BASE[p.kind] * sc;
        _q.setFromAxisAngle(_axisY, -s.yaw);
        if (p.attached) {
          y = 1.25;                                                     // A Tagger dart on its victim.
        } else if (!p.stuck && !p.grounded) {
          s.spin += dt * (p.kind === 'shiv' || p.kind === 'tagger' ? 4 : 9);
          if (p.kind !== 'tagger') { _q2.setFromAxisAngle(_axisZ, -s.spin); _q.multiply(_q2); }
          y = Math.max(y + 0.1, (p.y ?? 1) + 0.15);
        } else if (p.kind === 'crawler' && speed > 0.3) {
          y += Math.abs(Math.sin(t * 26 + i)) * 0.06;                  // Scuttling.
        } else if (p.kind === 'shiv' && p.stuck) {
          _q2.setFromAxisAngle(_axisZ, -0.9); _q.multiply(_q2); y = 0.22;   // Point down in the dirt.
        }
        _p.set(p.x, y, p.z);
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, n * 16);
        const acc = p.kind === 'bulwark' ? tc : GEAR_RGB[p.kind];
        aShow.setX(n, model);
        aAcc.setXYZ(n, acc[0], acc[1], acc[2]);
        let li = 0.6, lr = acc[0], lg = acc[1], lb = acc[2];
        n++;
        switch (p.kind) {
          case 'charge': {
            // Armed Satchels blink red for everyone; the owner sees how far it reaches.
            const on = (t * (p.stuck ? 2.2 : 6)) % 1 < 0.3;
            lr = 1; lg = 0.2; lb = 0.12; li = on ? 1 : 0.08;
            if (on && p.stuck) vfx.addDot(p.x, 0.45, p.z, 0.22, GEAR_RGB.charge);
            if (mine && p.stuck) vfx.addRing(p.x, p.z, CHARGE_R - 0.12, CHARGE_R, GEAR_RGB.charge, 0.22 + 0.12 * Math.sin(t * 4));
            break;
          }
          case 'thermite': {
            if (!p.stuck) break;
            const left = Math.max(0, THERM_LIFE - age), k = Math.min(1, left / 1.2);
            if (!s.lit) { s.lit = true; vfx.scorch(p.x, p.z, THERM_R * 1.1); }
            const f = 0.75 + 0.25 * Math.sin(t * 31 + i);
            vfx.addRing(p.x, p.z, 0, THERM_R * 0.6, HOT, 0.55 * k * f);
            vfx.addRing(p.x, p.z, THERM_R * 0.6, THERM_R, GEAR_RGB.thermite, 0.5 * k * f);
            vfx.addRing(p.x, p.z, THERM_R - 0.1, THERM_R + 0.05, [1, 0.45, 0.12], 0.8 * k);
            vfx.addDot(p.x, 0.5, p.z, 0.55 * k * f, WHITE);
            if (trail && k > 0.1) {
              for (let j = vfx._n(4); j > 0; j--) {
                const a = rand(0, 6.283), sp = rand(1, 4);
                vfx.spawn(p.x, 0.35, p.z, Math.cos(a) * sp, rand(4, 9), Math.sin(a) * sp, rand(0.35, 0.7), 0.07, 0.02, j % 2 ? HOT : WHITE, 0, 14, 0.5, 0.05);
              }
              if (Math.random() < 0.25) vfx.spawn(p.x + rand(-1, 1), 0.6, p.z + rand(-1, 1), 0, rand(0.6, 1.4), 0, rand(0.8, 1.2), 0.2, 0.6, DEBRIS, 0.25 * k, -0.2, 0.5);
            }
            lr = 1; lg = 0.95; lb = 0.8; li = k;
            break;
          }
          case 'tripwire': {
            if (!p.stuck || !(vx || vz)) break;
            // The beam, for both sides: dots every 0.3 m in the owner's team colour, brighter once armed.
            const b = tripBeam(c.map, p.x, p.z, vx, vz, BEAM);
            const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0), armed = age > 1.2;
            const steps = Math.min(30, Math.max(1, Math.round(len / 0.3)));
            const flick = armed ? 0.85 + 0.15 * Math.sin(t * 40) : 0.35;
            for (let k = 0; k <= steps; k++) {
              const u = k / steps;
              vfx.addDot(b.x0 + (b.x1 - b.x0) * u, 0.45, b.z0 + (b.z1 - b.z0) * u, (k % 2 ? 0.07 : 0.1) * flick, tc);
            }
            vfx.addDot(b.x1, 0.45, b.z1, 0.18 * flick, GEAR_RGB.tripwire);
            vfx.addDot(b.x0, 0.45, b.z0, 0.18 * flick, GEAR_RGB.tripwire);
            lr = tc[0]; lg = tc[1]; lb = tc[2]; li = flick;
            break;
          }
          case 'crawler': {
            const hunting = p.grounded && speed > 0.3;
            li = hunting ? (Math.sin(t * 30) > 0 ? 1 : 0.2) : 0.5 + 0.4 * Math.sin(t * 6);
            if (hunting) vfx.addRing(p.x, p.z, 0.55, 0.75, GEAR_RGB.crawler, 0.7);
            if (hunting && trail) vfx.spawn(p.x, 0.08, p.z, rand(-0.5, 0.5), rand(0.3, 0.8), rand(-0.5, 0.5), 0.4, 0.12, 0.3, DEBRIS, 0.5, 2, 1);
            break;
          }
          case 'bulwark': {
            lr = tc[0]; lg = tc[1]; lb = tc[2]; li = 0.5 + 0.2 * Math.sin(t * 3);
            if (p.stuck && age < 0.35) vfx.addRing(p.x, p.z, 0.4, 1.6, tc, 1 - age / 0.35);
            // A team-coloured light along the top edge, brightest at the ends: the shield's span reads from above.
            if (p.stuck) {
              const ex = -Math.sin(s.yaw) * 1.25, ez = Math.cos(s.yaw) * 1.25;
              vfx.addBeam(p.x + ex, 1.16, p.z + ez, p.x - ex, 1.16, p.z - ez, tc, 0.1);
              vfx.addDot(p.x + ex, 1.16, p.z + ez, 0.2, tc); vfx.addDot(p.x - ex, 1.16, p.z - ez, 0.2, tc);
            }
            break;
          }
          case 'medpack': {
            if (!p.stuck) break;
            li = 0.6 + 0.4 * Math.sin(t * 5);
            if (friendly) vfx.addRing(p.x, p.z, MED_R - 0.14, MED_R, GEAR_RGB.medpack, 0.3 + 0.15 * Math.sin(t * 3));
            vfx.addDot(p.x, 0.55, p.z, 0.16 + 0.05 * li, GEAR_RGB.medpack);
            if (trail && Math.random() < 0.35) vfx.spawn(p.x + rand(-MED_R, MED_R) * 0.6, 0.3, p.z + rand(-MED_R, MED_R) * 0.6, 0, rand(0.8, 1.6), 0, 0.7, 0.1, 0.02, GEAR_RGB.medpack, 0, -0.5, 0.5);
            break;
          }
          case 'tagger': {
            li = Math.sin(t * 14) > 0 ? 1 : 0.15;
            // On a victim: a ring round them, for the team that tagged them (and for the victim, who should know).
            if (p.attached && (friendly || hasLocal)) vfx.addRing(p.x, p.z, 0.8, 1.0, GEAR_RGB.tagger, 0.4 + 0.5 * li);
            break;
          }
          case 'snapshot': case 'blackout': {
            const fuse = EQUIPMENT[p.kind].fuse, k = Math.min(1, age / fuse);
            li = 0.5 + 0.5 * Math.sin(age * (9 + 46 * k));
            vfx.addDot(p.x, y + 0.36, p.z, 0.16 + li * 0.16, acc);
            break;
          }
          default: break;
        }
        aLight.setXYZW(n - 1, lr, lg, lb, li);
        if (!p.stuck && !p.grounded && trail) vfx.spawn(p.x, y, p.z, 0, 0.2, 0, 0.22, 0.09, 0.03, acc, 0, 0, 0);
      }
    }
    for (let i = 0; i < slots.length; i++) if (!slots[i].touched) slots[i].id = null;
    mesh.count = n;
    if (n) {
      mesh.instanceMatrix.needsUpdate = true;
      aShow.needsUpdate = true; aAcc.needsUpdate = true; aLight.needsUpdate = true;
    }
  }

  onEvents(events, localId, localTeam) {
    const vfx = this.vfx, c = this.c;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.t) {
        case 'gear':
          if (ev.kind === 'blackout') {
            const r = ev.r || EMP_R, rgb = GEAR_RGB.blackout;
            vfx.ring(ev.x, ev.z, 0.3, r, 0.5, rgb, 0.95);
            vfx.ring(ev.x, ev.z, 0.2, r * 0.55, 0.35, WHITE, 0.6);
            vfx.pop(ev.x, 0.8, ev.z, 5, rgb, 0.22);
            for (let k = 0; k < 6; k++) {
              const a = rand(0, 6.283), d = rand(r * 0.4, r);
              vfx.tracer(ev.x, 0.4, ev.z, ev.x + Math.cos(a) * d, rand(0.3, 1.2), ev.z + Math.sin(a) * d, rgb, 0.05, 3, 0.12, 300);
            }
            if (c.teamOf.get(ev.by) !== localTeam) c.staticBurst = Math.max(c.staticBurst || 0, 0.35);
          } else if (ev.kind === 'thermite') {
            vfx.pop(ev.x, 0.6, ev.z, 3.2, HOT, 0.25);
            vfx.sparks(ev.x, 0.4, ev.z, 0, 0, WHITE, vfx._n(14), 10);
          }
          break;
        case 'pulse':
          if (ev.kind === 'snapshot') {         // The camera flash on top of the recon ring combat.js draws.
            vfx.pop(ev.x, 1.4, ev.z, 9, WHITE, 0.16);
            vfx.ring(ev.x, ev.z, 0.2, ev.r || 12, 0.45, WHITE, 0.7);
          }
          break;
        case 'jammed': {
          const p = c.posOf.get(ev.id);
          if (p) { vfx.sparks(p.x, 1.8, p.z, 0, 0, GEAR_RGB.blackout, vfx._n(8), 5); vfx.ring(p.x, p.z, 0.2, 1.4, 0.35, GEAR_RGB.blackout, 0.8); }
          break;
        }
        case 'stuck': {
          const p = c.posOf.get(ev.id);
          const rgb = ev.kind === 'tagger' ? GEAR_RGB.tagger : STICKY_RGB;
          if (p) { vfx.ring(p.x, p.z, 0.2, 1.8, 0.35, rgb, 1); vfx.pop(p.x, 1.4, p.z, 1.8, rgb, 0.18); }
          break;
        }
        case 'popped': {
          // A device shot dead or burnt out: a puff of parts, no blast.
          const rgb = GEAR_RGB[ev.kind] ?? DEBRIS;
          vfx.sparks(ev.x, 0.4, ev.z, 0, 0, HOT, vfx._n(8), 7);
          for (let k = vfx._n(ev.kind === 'bulwark' ? 10 : 5); k > 0; k--) vfx.shard(ev.x + rand(-0.6, 0.6), 0.6, ev.z + rand(-0.6, 0.6), rand(-4, 4), rand(2, 5), rand(-4, 4), DEBRIS, rand(0.5, 1));
          vfx.pop(ev.x, 0.5, ev.z, 1.4, rgb, 0.14);
          break;
        }
        case 'pickup': {
          const p = c.posOf.get(ev.id);
          if (p && ev.id === localId) vfx.ring(p.x, p.z, 0.2, 1.1, 0.3, GEAR_RGB.shiv, 0.8);
          break;
        }
        case 'heal':
          if (ev.kind === 'medpack') {
            const p = c.posOf.get(ev.id);
            if (p && c.teamOf.get(ev.id) === localTeam) vfx.spawn(p.x, 1.6, p.z, 0, 1.4, 0, 0.5, 0.16, 0.05, GEAR_RGB.medpack, 0, 0, 0.6);
          }
          break;
        case 'bang':
          if (ev.kind === 'charge') {
            vfx.ring(ev.x, ev.z, 0.3, (ev.r || CHARGE_R) * 1.1, 0.4, GEAR_RGB.charge, 0.9);
            vfx.fireball?.(ev.x, 0.7, ev.z, 2.6, 0.45);
            vfx.scorch(ev.x, ev.z, 2.4);
          } else if (ev.kind === 'tripwire') {
            vfx.ring(ev.x, ev.z, 0.2, (ev.r || 3.4) * 1.05, 0.3, GEAR_RGB.tripwire, 0.9);
          } else if (ev.kind === 'crawler') {
            vfx.ring(ev.x, ev.z, 0.2, (ev.r || 3.6) * 1.05, 0.3, GEAR_RGB.crawler, 0.9);
            vfx.sparks(ev.x, 0.3, ev.z, 0, 0, HOT, vfx._n(10), 9);
          }
          break;
        default: break;
      }
    }
  }

  reset() { for (let i = 0; i < this.slots.length; i++) this.slots[i].id = null; this.mesh.count = 0; }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
