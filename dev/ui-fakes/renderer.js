// Stand-in for js/render/renderer.js so UI tests run before art lands. Used only by test routing in /tmp.
export class GameRenderer {
  constructor(canvas) { this.canvas = canvas; this.g = canvas.getContext('2d'); }
  setLocal() {}
  resize() { this.canvas.width = innerWidth; this.canvas.height = innerHeight; }
  update(view) {
    const g = this.g, w = this.canvas.width, h = this.canvas.height;
    g.fillStyle = '#4a4f55'; g.fillRect(0, 0, w, h);
    const local = view.players.find(p => p.id === view.localId);
    const scale = 13;
    g.save(); g.translate(w / 2 - (local?.x ?? 0) * scale, h / 2 - (local?.z ?? 0) * scale);
    for (const p of view.players) {
      if (!p.alive) continue;
      g.fillStyle = p.team === 0 ? '#38b6ff' : '#ff4d3d';
      g.beginPath(); g.arc(p.x * scale, p.z * scale, 7, 0, 7); g.fill();
    }
    g.restore();
  }
  playFinalKill() {}
  dispose() { this.g.clearRect(0, 0, this.canvas.width, this.canvas.height); }
}

export class GunPreview {
  constructor(canvas) { this.canvas = canvas; this.g = canvas.getContext('2d'); }
  show(weapon) { this.weapon = weapon; this.t = 0; }
  tick(dt) {
    this.t += dt;
    const g = this.g, { width: w, height: h } = this.canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#59636f';
    g.fillRect(w * 0.2, h * 0.42, w * 0.55, h * 0.13);
    g.fillRect(w * 0.42, h * 0.55, w * 0.07, h * 0.2);
    g.fillRect(w * 0.75, h * 0.46, w * 0.12, h * 0.04);
  }
  dispose() {}
}
