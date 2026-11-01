// Playwright harness for Twin Suns.
// Playwright: resolved via require('playwright') (global install here). On a Mac without
// a global install, run with `npx playwright install chromium` and `npm i -g playwright`
// (or set NODE_PATH) — it is deliberately NOT a dependency of this package.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const THREE_DIR = path.join(here, 'node_modules', 'three');
const SHOTS = path.join(here, 'screenshots');
const require = createRequire(import.meta.url);

async function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  try { return await import('playwright'); } catch (e) {
    throw new Error('playwright not found. Install globally (npm i -g playwright) or set NODE_PATH.');
  }
}

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg',
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function startServer(themeOverride) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (urlPath.endsWith('/')) urlPath += 'index.html';
        if (themeOverride != null && urlPath === '/game/theme.js') {
          res.writeHead(200, { 'content-type': MIME['.js'] });
          return res.end(themeOverride);
        }
        const file = path.normalize(path.join(ROOT, urlPath));
        if (!file.startsWith(ROOT + path.sep) || file.includes(path.sep + 'node_modules' + path.sep)) {
          res.writeHead(404); return res.end('not found');
        }
        fs.readFile(file, (err, buf) => {
          if (err) { res.writeHead(404); return res.end('not found'); }
          res.writeHead(200, { 'content-type': mimeOf(file), 'cache-control': 'no-store' });
          res.end(buf);
        });
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

export async function launch({ viewport = { width: 1280, height: 800 }, mobile = false, themeOverride = null, timeout = 20000 } = {}) {
  const pw = await loadPlaywright();
  const chromium = pw.chromium;
  const server = await startServer(themeOverride);
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctxOpts = { viewport };
  if (mobile) Object.assign(ctxOpts, { isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [], warnings = [];

  const isFont = (u) => /fonts\.(googleapis|gstatic)\.com/.test(u || '');
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/npm/three@0.160.0/', '');
    const file = path.normalize(path.join(THREE_DIR, rel));
    if (!file.startsWith(THREE_DIR) || !fs.existsSync(file)) {
      errors.push('three file missing: ' + rel);
      return route.fulfill({ status: 404, body: 'missing' });
    }
    route.fulfill({ status: 200, contentType: mimeOf(file), body: fs.readFileSync(file), headers: { 'access-control-allow-origin': '*' } });
  });

  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') {
      const loc = m.location()?.url || '';
      if (isFont(loc)) return;
      errors.push('console.error: ' + m.text() + (loc ? ` (${loc})` : ''));
    } else if (t === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message || e)));
  page.on('requestfailed', (r) => {
    if (isFont(r.url())) return;
    errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText || ''}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !isFont(r.url()) && !/favicon/.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`);
  });

  fs.mkdirSync(SHOTS, { recursive: true });
  const close = async () => { try { await browser.close(); } catch (e) {} server.close(); };

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' }).catch((e) => errors.push('goto: ' + e.message));
  try {
    await page.waitForFunction(() => !!window.__game, null, { timeout });
  } catch (e) {
    const err = new Error('window.__game did not appear within ' + timeout + 'ms. Errors: ' + JSON.stringify(errors, null, 1));
    await close();
    throw err;
  }

  const handle = {
    page, errors, warnings, port,
    async shot(name) {
      const p = path.join(SHOTS, name + '.png');
      await page.screenshot({ path: p });
      return p;
    },
    state: () => page.evaluate(() => window.__game.state()),
    // game(fnSource): evaluate a function source string (or function) in the page; it receives window.__game.
    game: (fn) => page.evaluate(`(${typeof fn === 'function' ? fn.toString() : fn})(window.__game)`),
    close,
  };
  return handle;
}
