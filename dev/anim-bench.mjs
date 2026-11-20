// Characters CPU before/after (docs/ANIMATION.md "Performance"): drives dev/anim-bench.html in headless Chromium for
// this checkout and, with --base, another one (an export of an older commit), alternating rounds so machine load hits
// both alike. Prints the mean of the per-round means for each crowd size.
//   node dev/anim-bench.mjs [--base=/tmp/anim-base] [--n=12,32] [--rounds=4] [--frames=600] [--port=9601]
//   (an export: mkdir /tmp/anim-base && git archive <commit> js vendor | tar -x -C /tmp/anim-base)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const PORT = Number(opt('port', 9601));
const BASE = opt('base', null);
const NS = opt('n', '12,32').split(',').map(Number);
const ROUNDS = Number(opt('rounds', 4)), FRAMES = Number(opt('frames', 600));

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* the global install */ }
  return createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright');
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    let url = decodeURIComponent(new URL(req.url, 'http://x').pathname), base = HERE;
    if (url.startsWith('/base/') && BASE) { base = resolve(BASE); url = url.slice(5); }
    const path = join(base, url);
    if (!path.startsWith(base)) throw new Error('outside');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(ok => server.listen(PORT, '127.0.0.1', ok));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const roots = BASE ? ['/base/', '/'] : ['/'];
try {
  for (const n of NS) {
    const got = Object.fromEntries(roots.map(r => [r, []]));
    for (let k = 0; k < ROUNDS; k++) {
      for (const root of k % 2 ? [...roots].reverse() : roots) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${PORT}/dev/anim-bench.html?n=${n}&frames=${FRAMES}&root=${root}`);
        await page.waitForFunction('window.__result', null, { timeout: 600000 });
        const r = await page.evaluate(() => window.__result);
        if (errors.length) console.log('ERRORS', root, errors.join(' | '));
        got[root].push(r.meanMs);
        await page.close();
      }
    }
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    // The machine is shared: the quickest round of each is the least disturbed, so the change is read off those.
    const min = a => Math.min(...a);
    const line = roots.map(r => `${r === '/' ? 'this' : 'base'} best ${min(got[r]).toFixed(3)} mean ${mean(got[r]).toFixed(3)} ms [${got[r].map(v => v.toFixed(3)).join(' ')}]`).join('   ');
    const delta = BASE ? `   change (best) ${(((min(got['/']) / min(got['/base/'])) - 1) * 100).toFixed(1)}%` : '';
    console.log(`n=${n}  ${line}${delta}`);
  }
} finally {
  await browser.close();
  server.close();
}
