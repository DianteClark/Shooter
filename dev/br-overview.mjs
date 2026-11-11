// Writes assets/maps/<id>-overview.jpg for each giant map (docs/BR.md): a north-up, edge-to-edge top-down render with
// every tile built and no fog, for the battle royale's big map and drop map. 1024 x 1024 by default.
//   node dev/br-overview.mjs [ids] [--port=8265] [--size=1024] [--review]   (--review also writes /tmp/br-map/<id>-overview.png at 2048)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const PORT = Number(opt('port', 8265)), SIZE = Number(opt('size', 1024));
const { BR_MAP_IDS } = await import(join(ROOT, 'js/shared/map.js'));
const ids = args.filter(a => !a.startsWith('--'));
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* the global install */ }
  return createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright');
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!path.startsWith(ROOT)) throw new Error('outside');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(ok => server.listen(PORT, '127.0.0.1', ok));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  for (const id of ids.length ? ids : BR_MAP_IDS) {
    const page = await browser.newPage({ viewport: { width: 2048, height: 2048 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${PORT}/dev/br-overview.html?map=${id}`);
    await page.waitForFunction('window.ready === true', null, { timeout: 600000 });
    const url = await page.evaluate(([s]) => window.capture(s, 0.84), [SIZE]);
    const buf = Buffer.from(url.split(',')[1], 'base64');
    await writeFile(join(ROOT, 'assets', 'maps', `${id}-overview.jpg`), buf);
    if (args.includes('--review')) { await mkdir('/tmp/br-map', { recursive: true }); await page.screenshot({ path: `/tmp/br-map/${id}-overview.png` }); }
    console.log(`${id}: assets/maps/${id}-overview.jpg ${SIZE} x ${SIZE}, ${(buf.length / 1024).toFixed(0)} KB${errors.length ? '  ERRORS ' + errors.join(' | ') : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
