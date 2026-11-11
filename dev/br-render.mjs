// Battle royale map render check (dev only): drives dev/br-load.html in headless Chromium at 852 x 393 on Low (and
// any steps given): load to first frame step by step, then frames while the local player is carried round the places.
//   node dev/br-render.mjs [--port=8263] [--map=frontier] [--q=low,high]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const PORT = Number(opt('port', 8263));
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
  for (const q of opt('q', 'low').split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${PORT}/dev/br-load.html?map=${opt('map', 'frontier')}&q=${q}`);
    await page.waitForFunction('window.ready === true', null, { timeout: 600000 });
    const load = await page.evaluate(() => window.load);
    const walk = await page.evaluate(() => window.walk(240));
    console.log(`${q}: load ${JSON.stringify(load)}`);
    console.log(`${q}: walk frame median ${walk.median.toFixed(1)} ms, p95 ${walk.p95.toFixed(1)}, worst ${walk.worst.toFixed(1)}; calls ${walk.calls.toFixed(1)}, triangles ${(walk.tris / 1000).toFixed(1)}k, ` +
      `geometry ${walk.geoMB.toFixed(1)} MB; tiles built ${walk.stats.built} (${(walk.stats.buildMs / Math.max(1, walk.stats.built)).toFixed(1)} ms each, worst ${walk.stats.maxTileMs.toFixed(0)}), dropped ${walk.stats.dropped}` +
      `${errors.length ? '  ERRORS ' + errors.join(' | ') : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
