// Renders the vote and picker art for every map: assets/maps/<id>.jpg, 480x270, with the real renderer.
//   node dev/render-snapshots.mjs                 every map in MAP_IDS
//   node dev/render-snapshots.mjs frost sunken    just these
//   node dev/render-snapshots.mjs --review        also writes full-size PNGs to /tmp/map-art/ for checking
//   node dev/render-snapshots.mjs --port=8172     serve on this port (default: any free one)
// Needs Playwright and Chrome (the same setup as docs/ARCHITECTURE.md). Serves the repo itself on a free port.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'maps');
const MAX_BYTES = 60 * 1024;
const args = process.argv.slice(2);
const review = args.includes('--review');
const PORT = Number(args.find(a => a.startsWith('--port='))?.split('=')[1] ?? 0);

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through to the global install */ }
  const root = execSync('npm root -g').toString().trim();
  return createRequire(join(root, 'noop.js'))('playwright');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serve() {
  const server = createServer(async (req, res) => {
    try {
      const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!path.startsWith(ROOT)) throw new Error('outside');
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(ok => server.listen(PORT, '127.0.0.1', () => ok(server)));
}

const { MAP_IDS } = await import(join(ROOT, 'js/shared/map.js'));
const ids = args.filter(a => !a.startsWith('--'));
const todo = ids.length ? ids : MAP_IDS;
const { chromium } = await loadPlaywright();
const server = await serve();
const port = server.address().port;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
await mkdir(OUT, { recursive: true });
if (review) await mkdir('/tmp/map-art', { recursive: true });
let failed = 0;
try {
  for (const id of todo) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/dev/render-maps.html?map=${id}&shot=art`);
    await page.waitForFunction('window.ready === true', null, { timeout: 120000 });
    // Highest quality that fits the size budget.
    let bytes = null, q = 0.86;
    for (; q >= 0.5; q -= 0.06) {
      const url = await page.evaluate(qq => window.capture(480, 270, qq), q);
      bytes = Buffer.from(url.split(',')[1], 'base64');
      if (bytes.length <= MAX_BYTES) break;
    }
    await writeFile(join(OUT, `${id}.jpg`), bytes);
    if (review) await page.screenshot({ path: `/tmp/map-art/${id}.png` });
    console.log(`${id.padEnd(9)} ${(bytes.length / 1024).toFixed(1)} KB  q ${q.toFixed(2)}${errors.length ? '  ERRORS: ' + errors.join(' | ') : ''}`);
    if (errors.length) failed++;
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
