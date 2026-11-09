// Pictures of guns for cards. Each is drawn once by the menu's shared WebGL context into a small 2D canvas and cached, so
// a grid of two dozen guns costs a few drawImage calls and no extra GL. Drawing happens a little at a time, between
// frames, and never while a finger is down.
//
// The GunPreview canvas may be on screen as a hero view. Thumbs borrow its drawing buffer inside a single task and the
// hero is redrawn before that task ends, so the browser only ever composites the hero.
import * as THREE from 'three';
import { getGun } from '../render/guns.js';
import { addCamoInstanceAttributes, camoIndex } from '../render/camo-shader.js';
import { hexRGB } from '../render/art.js';
import { getCamo } from '../shared/camos.js';
import { fingerDown } from './tap.js';

export const THUMB_W = 320;
export const THUMB_H = 150;
const FRAME_BUDGET_MS = 7;
const YAW = -0.34;
const PITCH = 0.2;
const DEFAULT_ACCENT = [1.0, 0.68, 0.22];
const size = new THREE.Vector2();

const keyOf = (id, camo, kit) => `${id}|${camo}|${kit ? Object.values(kit).sort().join(',') : ''}`;

export class GunThumbs {
  constructor(menu) {
    this.menu = menu;
    this.cache = new Map();      // key -> canvas
    this.jobs = new Map();       // key -> { id, camo, kit, wait: [canvas...] }, in request order
    this.raf = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(18, THUMB_W / THUMB_H, 0.1, 40);
  }

  // Paints every canvas[data-gun] under root. resolve(id) -> { camo, kit } says how that gun is dressed.
  fill(root, resolve) {
    for (const el of root.querySelectorAll('canvas[data-gun]')) {
      const { camo, kit } = resolve(el.dataset.gun);
      this.put(el, el.dataset.gun, camo, kit);
    }
  }

  put(el, id, camo, kit) {
    el.width = THUMB_W;
    el.height = THUMB_H;
    const key = keyOf(id, camo, kit);
    const done = this.cache.get(key);
    if (done) {
      el.getContext('2d').drawImage(done, 0, 0);
      el.classList.add('ready');
      return;
    }
    const job = this.jobs.get(key) ?? { key, id, camo, kit, wait: [] };
    job.wait.push(el);
    this.jobs.set(key, job);
    this.#pump();
  }

  // Quietly draws guns the player has not looked at yet, so the first switch to any tab is instant.
  warm(ids, resolve) {
    for (const id of ids) {
      const { camo, kit } = resolve(id);
      const key = keyOf(id, camo, kit);
      if (!this.cache.has(key) && !this.jobs.has(key)) this.jobs.set(key, { key, id, camo, kit, wait: [] });
    }
    this.#pump();
  }

  #pump() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.#tick());
  }

  #tick() {
    this.raf = 0;
    if (!this.jobs.size) return;
    const preview = this.menu.preview;
    if (fingerDown() || !preview || !this.menu.previewCanvas?.isConnected || preview.webgl.getContext().isContextLost()) {
      this.#pump();
      return;
    }
    const r = preview.webgl, gl = r.domElement, pr = r.getPixelRatio();
    r.getSize(size);
    const grow = gl.width < THUMB_W || gl.height < THUMB_H;
    if (grow) r.setSize(THUMB_W / pr, THUMB_H / pr, false);
    r.setScissorTest(true);
    r.setViewport(0, 0, THUMB_W / pr, THUMB_H / pr);
    r.setScissor(0, 0, THUMB_W / pr, THUMB_H / pr);
    const t0 = performance.now();
    for (const job of this.jobs.values()) {
      this.jobs.delete(job.key);
      this.#draw(job, preview, r, gl);
      if (performance.now() - t0 > FRAME_BUDGET_MS) break;
    }
    r.setScissorTest(false);
    if (grow) r.setSize(size.x, size.y, false);
    else r.setViewport(0, 0, size.x, size.y);
    this.menu.redrawPreview();
    if (this.jobs.size) this.#pump();
  }

  #draw(job, preview, r, gl) {
    const gun = getGun(job.id, job.kit);
    const geom = gun.geometry.clone();
    addCamoInstanceAttributes(geom, 1);
    geom.getAttribute('aCamo').setX(0, camoIndex(job.camo));
    const accent = getCamo(job.camo).tint;
    const rgb = accent !== undefined ? hexRGB(accent) : DEFAULT_ACCENT;
    geom.getAttribute('aAccent').setXYZ(0, rgb[0], rgb[1], rgb[2]);
    const mesh = new THREE.InstancedMesh(geom, preview.material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.frustumCulled = false;
    geom.computeBoundingBox();
    const box = geom.boundingBox;
    mesh.position.set(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
    this.scene.add(mesh);
    this.scene.rotation.y = YAW;
    const halfV = Math.tan(THREE.MathUtils.degToRad(9));
    const d = Math.max((box.max.x - box.min.x) * 0.53 / (halfV * this.camera.aspect), (box.max.y - box.min.y) * 0.62 / halfV, 1.4);
    this.camera.position.set(0, d * Math.sin(PITCH), d * Math.cos(PITCH));
    this.camera.lookAt(0, 0, 0);
    this.scene.updateMatrixWorld();
    r.render(this.scene, this.camera);

    const shot = document.createElement('canvas');
    shot.width = THUMB_W;
    shot.height = THUMB_H;
    shot.getContext('2d').drawImage(gl, 0, gl.height - THUMB_H, THUMB_W, THUMB_H, 0, 0, THUMB_W, THUMB_H);
    this.cache.set(job.key, shot);
    this.scene.remove(mesh);
    geom.dispose();
    mesh.dispose();
    for (const el of job.wait) {
      if (!el.isConnected) continue;
      el.getContext('2d').drawImage(shot, 0, 0);
      el.classList.add('ready');
    }
  }
}
