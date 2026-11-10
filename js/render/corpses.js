// Dismantled soldiers. On death every body part leaves its last drawn pose as a free rigid body, tumbling
// with a shove from the killing shot, then dither-fades. No blood: the break glows in the victim's team colour.
// The parts draw through Characters' instanced meshes, so a dozen bodies add instances but no draw calls.
export const MAX_CORPSES = 12;

export const PART = {
  TORSO: 0, HEAD: 1, UPPER_R: 2, FORE_R: 3, UPPER_L: 4, FORE_L: 5,
  THIGH_L: 6, SHIN_L: 7, BOOT_L: 8, THIGH_R: 9, SHIN_R: 10, BOOT_R: 11, GUN: 12, COUNT: 13,
};
const PARTS = PART.COUNT;
const CAP = MAX_CORPSES * PARTS;

// Rotation pivot of each part in its own model space.
const PIVOT_X = [0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0.5, 0.5, 0.1, 0.45];
const PIVOT_Y = [0.3, 0.2, 0, 0, 0, 0, 0, 0, -0.03, 0, 0, -0.03, 0];
// Rest radius, so a part lies on the ground rather than half in it; mass-like scale on the launch.
const RADIUS = [0.26, 0.2, 0.09, 0.09, 0.09, 0.09, 0.12, 0.1, 0.1, 0.12, 0.1, 0.1, 0.12];
const LAUNCH = [0.55, 1.15, 1.0, 1.1, 1.0, 1.1, 0.8, 0.95, 1.05, 0.8, 0.95, 1.05, 0.9];

// How hard each weapon family throws a body: push along the shot, lift, and how far the parts scatter.
const FORCE = {
  shotgun: [11, 5.5, 3.2], autoshot: [9.5, 4.5, 3], sniper: [13, 3.5, 2.2], dmr: [9, 3.5, 2.2], lmg: [7.5, 3, 2.4],
  revolver: [9, 3.5, 2.2], launcher: [6, 12, 6.5], ar: [6, 3.2, 2.4], burst: [6.5, 3.2, 2.4], smg: [5, 3, 2.6], pdw: [5, 3, 2.6], pistol: [5, 3, 2.2],
  heavyar: [7, 3.3, 2.4], tacsmg: [5, 3, 2.5], coach: [12, 6, 3.4], saw: [7, 3, 2.4], rotary: [7, 3, 2.6], battle: [8, 3.5, 2.3],
  lever: [9, 3.5, 2.2], antimat: [15, 4.5, 2.4], semisnipe: [11, 3.5, 2.2], machpistol: [4.5, 3, 2.6], deuce: [5.5, 3, 2.2], thumper: [5, 10, 6],
};
const FORCE_DEFAULT = FORCE.ar;

const rand = (a, b) => a + Math.random() * (b - a);

export class Corpses {
  constructor(chars) {
    this.chars = chars;
    this.head = 0;                 // Next corpse slot; the oldest body is overwritten when the pool is full.
    this.limit = MAX_CORPSES;      // Bodies kept at once; the quality step lowers it. Slots past it finish their fade.
    this.life = new Float32Array(MAX_CORPSES);
    this.maxLife = new Float32Array(MAX_CORPSES);
    this.age = new Float32Array(MAX_CORPSES);
    this.team = new Int8Array(MAX_CORPSES);
    this.op = new Int16Array(MAX_CORPSES);
    this.camo = new Int16Array(MAX_CORPSES);
    this.accent = new Float32Array(MAX_CORPSES * 3);
    this.gunMesh = new Array(MAX_CORPSES).fill(null);
    this.armRGB = new Array(MAX_CORPSES).fill(null);
    this.legRGB = new Array(MAX_CORPSES).fill(null);
    this.trail = new Float32Array(MAX_CORPSES);
    for (const k of ['cx', 'cy', 'cz', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'ax', 'ay', 'az', 'spin', 'ox', 'oy', 'oz']) this[k] = new Float32Array(CAP);
    this.basis = new Float32Array(CAP * 9);       // Rotation-with-scale of each part at the moment of death.
  }

  clear() { this.life.fill(0); }

  // info: { dirX, dirZ, weapon, head, explosive, force? }. dir is the unit push direction.
  spawn(r, info) {
    const chars = this.chars;
    // A rig that has not been drawn in a moment has no pose worth launching.
    if (r.posed < 0 || Math.abs(chars.time.value - r.posed) > 0.6) return false;
    const c = this.head;
    this.head = (c + 1) % this.limit;
    this.life[c] = this.maxLife[c] = rand(2.3, 2.9);
    this.age[c] = 0;
    this.team[c] = r.team; this.op[c] = r.op; this.camo[c] = r.camoI;
    this.accent[c * 3] = r.accent[0]; this.accent[c * 3 + 1] = r.accent[1]; this.accent[c * 3 + 2] = r.accent[2];
    this.gunMesh[c] = r.gunMesh; this.armRGB[c] = r.armRGB; this.legRGB[c] = r.legRGB;
    this.trail[c] = 0.3;

    const f = FORCE[info.weapon] || FORCE_DEFAULT;
    const push = f[0], lift = info.explosive ? 13 : f[1], scatter = info.explosive ? 7 : f[2];
    const pose = r.pose;
    // Body centre, for the outward part of the scatter.
    const bx = pose[12], by = pose[13] + 0.2, bz = pose[14];
    for (let p = 0; p < PARTS; p++) {
      const i = c * PARTS + p, m = p * 16;
      const a = pose[m], b = pose[m + 1], cc = pose[m + 2];
      const d = pose[m + 4], e = pose[m + 5], ff = pose[m + 6];
      const g = pose[m + 8], h = pose[m + 9], k = pose[m + 10];
      const bs = this.basis, b9 = i * 9;
      bs[b9] = a; bs[b9 + 1] = b; bs[b9 + 2] = cc; bs[b9 + 3] = d; bs[b9 + 4] = e; bs[b9 + 5] = ff; bs[b9 + 6] = g; bs[b9 + 7] = h; bs[b9 + 8] = k;
      const px = PIVOT_X[p], py = PIVOT_Y[p];
      this.ox[i] = a * px + d * py; this.oy[i] = b * px + e * py; this.oz[i] = cc * px + ff * py;
      const wx = pose[m + 12] + this.ox[i], wy = pose[m + 13] + this.oy[i], wz = pose[m + 14] + this.oz[i];
      this.cx[i] = wx; this.cy[i] = wy; this.cz[i] = wz;

      let ox = wx - bx, oy = wy - by, oz = wz - bz;
      const l = Math.hypot(ox, oy, oz) || 1;
      ox /= l; oy /= l; oz /= l;
      const j = LAUNCH[p], along = push * j * rand(0.55, 1.15);
      this.vx[i] = info.dirX * along + ox * scatter * rand(0.5, 1.2) + rand(-0.6, 0.6);
      this.vy[i] = lift * j * rand(0.7, 1.25) + oy * scatter * 0.5;
      this.vz[i] = info.dirZ * along + oz * scatter * rand(0.5, 1.2) + rand(-0.6, 0.6);
      if (p === PART.HEAD && info.head) { this.vy[i] += 7; this.vx[i] += info.dirX * 3; this.vz[i] += info.dirZ * 3; }

      this.qx[i] = 0; this.qy[i] = 0; this.qz[i] = 0; this.qw[i] = 1;
      const aa = rand(0, Math.PI * 2), ab = rand(0, Math.PI);
      this.ax[i] = Math.sin(ab) * Math.cos(aa); this.ay[i] = Math.cos(ab); this.az[i] = Math.sin(ab) * Math.sin(aa);
      this.spin[i] = rand(5, 15) * (p === PART.TORSO ? 0.45 : 1) * (info.explosive ? 1.6 : 1);
    }
    return true;
  }

  // Steps every body and appends its instances after the living soldiers' in the shared buffers.
  step(dt, n) {
    const chars = this.chars, surf = chars.surf, vfx = chars.vfx;
    const { torso, head, upper, arm, leg, boot } = chars;
    for (let c = 0; c < MAX_CORPSES; c++) {
      if (this.life[c] <= 0) continue;
      this.life[c] -= dt;
      this.age[c] += dt;
      const age = this.age[c];
      const left = this.life[c];
      const fade = left < 0.6 ? Math.max(0, left / 0.6) : 1;
      const flash = age < 0.14 ? 1 - age / 0.14 : 0;
      const team = chars.teamRGB[this.team[c]] || chars.teamRGB[0];
      const op = this.op[c];
      this.trail[c] -= dt;
      const trailing = this.trail[c] > 0 && vfx && Math.random() < 0.5;

      for (let p = 0; p < PARTS; p++) {
        const i = c * PARTS + p;
        // Motion.
        this.vy[i] -= 21 * dt;
        let nx = this.cx[i] + this.vx[i] * dt, nz = this.cz[i] + this.vz[i] * dt;
        let ny = this.cy[i] + this.vy[i] * dt;
        if (surf) {
          // Slide off walls one axis at a time; a limb clipped through a container is the first thing the eye catches.
          if (surf.solid(nx, this.cy[i], this.cz[i])) { this.vx[i] *= -0.35; nx = this.cx[i]; }
          if (surf.solid(nx, this.cy[i], nz)) { this.vz[i] *= -0.35; nz = this.cz[i]; }
        }
        const floor = (surf ? surf.groundAt(nx, nz) : 0) + RADIUS[p] * 0.55;
        if (ny < floor) {
          const wasFalling = this.vy[i] < -2;
          ny = floor;
          this.vy[i] *= -0.34;
          if (Math.abs(this.vy[i]) < 0.6) this.vy[i] = 0;
          this.vx[i] *= 0.6; this.vz[i] *= 0.6;
          this.spin[i] *= 0.55;
          if (wasFalling && floor < 0 && vfx) vfx.waterSplash(nx, nz, 0.5);
          else if (wasFalling && vfx && p < 2) vfx.groundThud(nx, nz);
        }
        this.cx[i] = nx; this.cy[i] = ny; this.cz[i] = nz;

        // Rotation around a fixed axis.
        const ang = this.spin[i] * dt * 0.5, s = Math.sin(ang), cs = Math.cos(ang);
        const ax = this.ax[i] * s, ay = this.ay[i] * s, az = this.az[i] * s;
        const qx = this.qx[i], qy = this.qy[i], qz = this.qz[i], qw = this.qw[i];
        const x = cs * qx + ax * qw + ay * qz - az * qy;
        const y = cs * qy - ax * qz + ay * qw + az * qx;
        const z = cs * qz + ax * qy - ay * qx + az * qw;
        const w = cs * qw - ax * qx - ay * qy - az * qz;
        const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
        const X = x * l, Y = y * l, Z = z * l, W = w * l;
        this.qx[i] = X; this.qy[i] = Y; this.qz[i] = Z; this.qw[i] = W;

        // Rotation matrix times the frozen basis, written straight into the part's instance slot.
        const r00 = 1 - 2 * (Y * Y + Z * Z), r01 = 2 * (X * Y - Z * W), r02 = 2 * (X * Z + Y * W);
        const r10 = 2 * (X * Y + Z * W), r11 = 1 - 2 * (X * X + Z * Z), r12 = 2 * (Y * Z - X * W);
        const r20 = 2 * (X * Z - Y * W), r21 = 2 * (Y * Z + X * W), r22 = 1 - 2 * (X * X + Y * Y);

        let mesh, slot, op2 = 0, tint = null;
        switch (p) {
          case PART.TORSO: mesh = torso; slot = n.nT; op2 = op; break;
          case PART.HEAD: mesh = head; slot = n.nT; op2 = op; break;
          case PART.UPPER_R: case PART.UPPER_L: mesh = upper; slot = n.nU++; tint = this.armRGB[c]; break;
          case PART.THIGH_L: case PART.THIGH_R: mesh = upper; slot = n.nU++; tint = this.legRGB[c]; break;
          case PART.FORE_R: case PART.FORE_L: mesh = arm; slot = n.nA++; tint = this.armRGB[c]; break;
          case PART.SHIN_L: case PART.SHIN_R: mesh = leg; slot = n.nL++; tint = this.legRGB[c]; break;
          case PART.BOOT_L: case PART.BOOT_R: mesh = boot; slot = n.nB++; break;
          default: mesh = this.gunMesh[c]; slot = mesh ? mesh.count++ : -1; break;
        }
        if (!mesh || slot >= mesh.instanceMatrix.count) continue;
        const B = this.basis, b = i * 9, e = mesh.instanceMatrix.array, j = slot * 16;
        e[j] = r00 * B[b] + r01 * B[b + 1] + r02 * B[b + 2];
        e[j + 1] = r10 * B[b] + r11 * B[b + 1] + r12 * B[b + 2];
        e[j + 2] = r20 * B[b] + r21 * B[b + 1] + r22 * B[b + 2];
        e[j + 3] = 0;
        e[j + 4] = r00 * B[b + 3] + r01 * B[b + 4] + r02 * B[b + 5];
        e[j + 5] = r10 * B[b + 3] + r11 * B[b + 4] + r12 * B[b + 5];
        e[j + 6] = r20 * B[b + 3] + r21 * B[b + 4] + r22 * B[b + 5];
        e[j + 7] = 0;
        e[j + 8] = r00 * B[b + 6] + r01 * B[b + 7] + r02 * B[b + 8];
        e[j + 9] = r10 * B[b + 6] + r11 * B[b + 7] + r12 * B[b + 8];
        e[j + 10] = r20 * B[b + 6] + r21 * B[b + 7] + r22 * B[b + 8];
        e[j + 11] = 0;
        const ox = this.ox[i], oy = this.oy[i], oz = this.oz[i];
        e[j + 12] = nx - (r00 * ox + r01 * oy + r02 * oz);
        e[j + 13] = ny - (r10 * ox + r11 * oy + r12 * oz);
        e[j + 14] = nz - (r20 * ox + r21 * oy + r22 * oz);
        e[j + 15] = 1;

        if (p === PART.GUN) {
          const ga = mesh.geometry.attributes;
          ga.aCamo.setX(slot, this.camo[c]);
          ga.aAccent.setXYZ(slot, this.accent[c * 3], this.accent[c * 3 + 1], this.accent[c * 3 + 2]);
          ga.aFx.setXY(slot, fade, flash);
          ga.aHeat.setX(slot, 0);
        } else {
          chars._writeFx(mesh, slot, fade, flash, team, op2, tint);
        }
        // Team-coloured embers stream off the severed ends for the first moments.
        if (trailing && p >= PART.HEAD && p !== PART.GUN) vfx.ember(nx, ny, nz, team);
      }
      n.nT++;
    }
  }
}
