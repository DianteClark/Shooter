// Drives dev/perf-render.html in headless Chromium (SwiftShader: a CPU rasteriser, so frame times only compare runs on
// this machine; draw calls and triangles are exact) at 852 x 393, on Low and High. See docs/BR-PERF.md, "After".
//   node dev/perf-render.mjs [--port=8223] [--root=/path/to/checkout] [--maps=range,railyard,...] [--q=low,high]
//                            [--shots=/tmp/perf]   screenshots of each map on its first quality step
// --root serves another checkout (an older commit) with this script's page, so before and after run the same page.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const PORT = Number(opt('port', 8223));
const ROOT = resolve(opt('root', HERE));
const MAPS = opt('maps', 'range,railyard,pier,foundry,downtown,expedition,giant').split(',');
const STEPS = opt('q', 'low,high').split(',');
const SHOTS = opt('shots', null);

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through to the global install */ }
  return createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright');
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // The measuring page (and the giant map) always come from this checkout; the engine from ROOT.
    const base = url.startsWith('/dev/perf-render') || url === '/dev/br-map.mjs' ? HERE : ROOT;
    const path = join(base, url);
    if (!path.startsWith(base)) throw new Error('outside');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(ok => server.listen(PORT, '127.0.0.1', ok));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
console.log(`root ${ROOT}`);
console.log('map         q     walls  world tris  geometry  meshes  build   calls  tris drawn  frame ms, median (update, mean)');
try {
  for (const id of MAPS) {
    for (const q of STEPS) {
      // An iPhone's device pixel ratio is 3; Low caps it at 1.3 and High at 2. A ratio of 2 here lets both caps apply.
      const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
      await page.goto(`http://127.0.0.1:${PORT}/dev/perf-render.html?map=${id}&q=${q}`, { waitUntil: 'commit' });
      await page.waitForFunction('window.ready === true', null, { timeout: 600000 });
      const r = await page.evaluate(() => window.measure(30));
      if (SHOTS && q === STEPS[0]) await page.screenshot({ path: `${SHOTS}/render-${id}-${q}.png` });
      console.log(`${id.padEnd(11)} ${q.padEnd(5)} ${String(r.walls).padEnd(6)} ${(r.worldTris / 1000).toFixed(0).padStart(6)}k    ${r.geoMB.toFixed(1).padStart(5)} MB  ${String(r.meshes).padStart(5)}  ${r.buildMs.toFixed(0).padStart(5)}  ${r.calls.toFixed(0).padStart(6)}  ${(r.triangles / 1000).toFixed(1).padStart(8)}k  ${r.ms.toFixed(1).padStart(6)} (${r.cpuMs.toFixed(1)})` +
        `${errors.length ? '  ERRORS ' + errors.join(' | ') : ''}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
