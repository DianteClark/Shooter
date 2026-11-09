// The title backdrop: a low-poly dusk sky over the freight yard, generated rather than shipped as an image.
const VIEW_W = 844, VIEW_H = 390, HORIZON = 178;

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Dusk runs from sodium orange at the horizon, through bruised mauve, to steel night overhead.
const STOPS = [
  [0, [38, 38, 58]],
  [0.5, [74, 60, 88]],
  [0.82, [150, 88, 84]],
  [1, [232, 148, 72]],
];

function sky(t) {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const f = (t - a) / (b - a);
      return ca.map((v, c) => v + (cb[c] - v) * f);
    }
  }
  return STOPS[STOPS.length - 1][1];
}

function css([r, g, b]) {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function skyPolys(rand) {
  const cols = 15, rows = 6, jitter = 0.34;
  const cw = VIEW_W / cols, ch = HORIZON / rows;
  const pts = [];
  for (let r = 0; r <= rows; r++) {
    pts[r] = [];
    for (let c = 0; c <= cols; c++) {
      const edge = c === 0 || c === cols || r === 0 || r === rows;
      pts[r][c] = [
        c * cw + (edge ? 0 : (rand() - 0.5) * cw * jitter * 2),
        r * ch + (edge ? 0 : (rand() - 0.5) * ch * jitter * 2),
      ];
    }
  }
  const tri = (a, b, c) => {
    const cy = (a[1] + b[1] + c[1]) / 3, cx = (a[0] + b[0] + c[0]) / 3;
    // The glow leans toward the east, where the sun went down behind the gantry.
    const east = cx / VIEW_W;
    const t = Math.min(1, Math.max(0, cy / HORIZON * (0.82 + east * 0.28) + (rand() - 0.5) * 0.09));
    const fill = css(sky(t));
    return `<polygon points="${a} ${b} ${c}" fill="${fill}" stroke="${fill}" stroke-width=".6"/>`;
  };
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = pts[r][c], b = pts[r][c + 1], d = pts[r + 1][c], e = pts[r + 1][c + 1];
      if (rand() > 0.5) out += tri(a, b, d) + tri(b, e, d);
      else out += tri(a, b, e) + tri(a, e, d);
    }
  }
  return out;
}

function containerStacks(rand) {
  const colors = ['#27303a', '#2e3742', '#242c35', '#333c44', '#3a3540'];
  let out = '';
  let x = -10;
  while (x < VIEW_W + 40) {
    const width = 54 + rand() * 40, high = 1 + Math.floor(rand() * 4);
    const h = 21;
    for (let i = 0; i < high; i++) {
      const y = HORIZON + 8 - (i + 1) * h;
      out += `<rect x="${x.toFixed(1)}" y="${y}" width="${width.toFixed(1)}" height="${h - 1}" fill="${colors[Math.floor(rand() * colors.length)]}"/>`;
    }
    x += width + (rand() < 0.2 ? 10 + rand() * 30 : 1);
  }
  return out;
}

function gantry() {
  // A rail-mounted container crane, right of frame, in silhouette against the glow.
  const c = '#1b2129';
  return `
    <path fill="${c}" d="M664 240 L672 96 L680 96 L676 240 Z M742 240 L738 96 L746 96 L754 240 Z"/>
    <path fill="${c}" d="M620 96 H806 V106 H620 Z M660 80 H770 V96 H660 Z M702 62 H728 V80 H702 Z"/>
    <path fill="none" stroke="${c}" stroke-width="2.4" d="M672 112 L744 168 M744 112 L672 168 M676 170 L750 226 M750 170 L676 226"/>
    <path fill="${c}" d="M694 106 h22 v8 h-22 Z"/>
    <path stroke="${c}" stroke-width="2" d="M699 114 V150 M711 114 V150"/>
    <rect x="688" y="150" width="34" height="14" fill="${c}"/>`;
}

function mast(x, top, lamp) {
  const c = '#1b2129';
  return `
    <path d="M${x} 262 V${top}" stroke="${c}" stroke-width="3"/>
    <rect x="${x - 7}" y="${top - 30}" width="14" height="32" fill="${c}"/>
    <circle cx="${x}" cy="${top - 22}" r="3.4" fill="${lamp}"/>
    <circle cx="${x}" cy="${top - 22}" r="11" fill="${lamp}" opacity=".22"/>
    <circle cx="${x}" cy="${top - 10}" r="3.4" fill="#39424c"/>`;
}

function rails() {
  // Ballast and converging rails; the vanishing point sits under the crane.
  const vx = 712;
  let lines = '';
  for (const x of [-420, -60, 230, 480, 980, 1320]) {
    lines += `<path d="M${x} 390 L${vx + (x - vx) * 0.12} ${HORIZON + 22}" stroke="#57636e" stroke-width="1.6"/>`;
  }
  return `<rect y="${HORIZON + 8}" width="${VIEW_W}" height="${VIEW_H - HORIZON - 8}" fill="#222931"/>
    <rect y="${HORIZON + 8}" width="${VIEW_W}" height="3" fill="#ad6a3e" opacity=".55"/>${lines}`;
}

export function yardBackdrop() {
  const rand = rng(90417);
  return `<svg class="yard" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${skyPolys(rand)}
    ${containerStacks(rand)}
    ${rails()}
    <g transform="translate(0 -58)">${gantry()}</g>
    <g transform="translate(-32 -60)">${mast(592, 196, '#f2a63b')}</g>
    <g transform="translate(-32 -70)">${mast(608, 212, '#4bd18a')}</g>
  </svg>`;
}
