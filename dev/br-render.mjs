// Drives dev/br-render.html in headless Chromium (SwiftShader, so times are relative: a CPU rasteriser, not a phone
// GPU) at 852 x 393 on the Low profile, with and without chunked, culled world meshes. See docs/BR-PERF.md.
//   node dev/br-render.mjs [--port=8174] [--density=1]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const PORT = Number(opt('port', 8174)), DENSITY = opt('density', '1');

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through to the global install */ }
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
  for (const page0 of [['harvest', null], ...['none', 'chunk', 'distance'].map(c => ['br', c])]) {
    const [kind, cull] = page0;
    // An iPhone's device pixel ratio is 3; Low caps it at 1.3. A ratio of 2 here lets the cap apply.
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
    const url = kind === 'harvest' ? `http://127.0.0.1:${PORT}/dev/br-render.html?harvest=1` : `http://127.0.0.1:${PORT}/dev/br-render.html?density=${DENSITY}&cull=${cull}`;
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction('window.ready === true', null, { timeout: 600000 });
    const r = await page.evaluate(() => window.measure(120));
    console.log(`${kind === 'harvest' ? 'harvest ' : `br ${cull.padEnd(8)}`} walls ${r.walls}  world ${(r.worldTris / 1000).toFixed(0)}k tris, ${r.geoMB.toFixed(1)} MB, built in ${r.buildMs.toFixed(0)} ms` +
      `  chunks ${r.chunks}  calls ${r.calls.toFixed(0)}  drawn ${(r.triangles / 1000).toFixed(0)}k tris  frame ${r.ms.toFixed(1)} ms (update ${r.cpuMs.toFixed(1)} ms)  dpr ${r.dpr}${errors.length ? '  ERRORS ' + errors.join(' | ') : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
