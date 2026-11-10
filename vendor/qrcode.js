// Minimal QR code encoder: byte mode, error correction level M, versions 1 to 10 (up to 213 bytes).
// Written for Switchyard (no third-party code); follows ISO/IEC 18004. Enough for an invite link, nothing more.
//
//   encodeQR(text) -> { size, dark(x, y) }      throws if the text does not fit
//   qrSvgPath(qr, quiet = 4) -> SVG path data, one unit per module, offset by the quiet zone

// Level M block structure per version: [ec codewords per block, blocks in group 1, data codewords each,
// blocks in group 2, data codewords each].
const BLOCKS_M = [null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const EC_BITS_M = 0;   // Format-info bits for level M.

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x; LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

function ecCodewords(data, degree) {
  const g = generator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= mul(g[i + 1], factor);
  }
  return rem;
}

const capacity = v => { const b = BLOCKS_M[v]; return b[1] * b[2] + b[3] * b[4]; };

function codewords(bytes, version) {
  const bits = [];
  const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  const cap = capacity(version) * 8;
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < cap / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  // Split into blocks, protect each, then interleave data and EC column by column.
  const [ec, n1, d1, n2, d2] = BLOCKS_M[version];
  const blocks = [];
  let at = 0;
  for (let i = 0; i < n1 + n2; i++) {
    const len = i < n1 ? d1 : d2;
    const d = data.slice(at, at + len);
    at += len;
    blocks.push({ d, e: ecCodewords(d, ec) });
  }
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

function build(version, data, mask) {
  const size = version * 4 + 17;
  const mod = Array.from({ length: size }, () => new Uint8Array(size));
  const fn = Array.from({ length: size }, () => new Uint8Array(size));
  const set = (x, y, dark) => { mod[y][x] = dark ? 1 : 0; fn[y][x] = 1; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  }
  const al = ALIGN[version], last = al.length - 1;
  for (let i = 0; i <= last; i++) for (let j = 0; j <= last; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Reserve format areas now (real bits drawn after masking), and write version info for v7+.
  drawFormat(set, size, 0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit); set(b, a, bit);
    }
  }

  // Zigzag placement in two-module columns from the bottom right, skipping the vertical timing column.
  let i = 0;
  const total = data.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (fn[y][x] || i >= total) continue;
        mod[y][x] = (data[i >>> 3] >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
  }

  const masked = mod.map(r => r.slice());
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) masked[y][x] ^= 1;
  drawFormat((x, y, d) => { masked[y][x] = d ? 1 : 0; }, size, mask);
  return masked;
}

function drawFormat(set, size, mask) {
  const data = (EC_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = i => (bits >>> i) & 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, 1);
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// The standard's four penalty rules; the mask with the lowest score reads best.
function penalty(m) {
  const n = m.length;
  let score = 0, dark = 0;
  const line = get => {
    let s = 0, run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) { run++; continue; }
      if (run >= 5) s += run - 2;
      run = 1;
    }
    // 1:1:3:1:1 finder look-alikes with four light modules on either side.
    for (let i = 0; i + 10 < n; i++) {
      const p = [1, 0, 1, 1, 1, 0, 1];
      const at = k => get(i + k);
      let core = true;
      for (let k = 0; k < 7 && core; k++) core = at(k + 4) === p[k];
      if (core) {
        if (at(0) === 0 && at(1) === 0 && at(2) === 0 && at(3) === 0) s += 40;
        else if (i + 14 < n && at(11) === 0 && at(12) === 0 && at(13) === 0 && at(14) === 0) s += 40;
      }
    }
    return s;
  };
  for (let y = 0; y < n; y++) score += line(x => m[y][x]);
  for (let x = 0; x < n; x++) score += line(y => m[y][x]);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  for (const r of m) for (const c of r) dark += c;
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

export function encodeQR(text) {
  const bytes = new TextEncoder().encode(String(text));
  let version = 1;
  while (version <= 10 && capacity(version) < bytes.length + (version < 10 ? 2 : 3)) version++;
  if (version > 10) throw new Error('QR: text too long');
  const data = codewords(bytes, version);
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = build(version, data, mask);
    const s = penalty(m);
    if (s < bestScore) { best = m; bestScore = s; }
  }
  return { size: best.length, version, dark: (x, y) => best[y][x] === 1 };
}

// One path of unit squares (merged per horizontal run), so the SVG stays small and renders crisp at any scale.
export function qrSvgPath(qr, quiet = 4) {
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.dark(x, y)) continue;
      let w = 1;
      while (x + w < qr.size && qr.dark(x + w, y)) w++;
      d += `M${x + quiet} ${y + quiet}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  return d;
}
