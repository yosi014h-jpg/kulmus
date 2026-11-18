#!/usr/bin/env node
// בניית גרסת הדפדפן מאותו קוד של התוכנה למחשב → dist/web
// הממשק (src/renderer) והליבה (src/core) מועתקים כמו שהם; רק window.api מוחלף בגשר דפדפן.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'web');
const NM = path.join(ROOT, 'node_modules');
const pkg = require(path.join(ROOT, 'package.json'));

const r = (...p) => path.join(ROOT, ...p);
const o = (...p) => path.join(OUT, ...p);
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };
const write = (to, text) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, text); };
const must = (p) => { if (!fs.existsSync(p)) throw new Error(`חסר: ${path.relative(ROOT, p)} — הריצו npm install`); return p; };

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // ספריות
  copy(must(path.join(NM, 'pdf-lib/dist/pdf-lib.min.js')), o('lib/pdf-lib.min.js'));
  copy(must(path.join(NM, '@pdf-lib/fontkit/dist/fontkit.umd.min.js')), o('lib/fontkit.umd.min.js'));
  copy(must(path.join(NM, 'bidi-js/dist/bidi.min.js')), o('lib/bidi.min.js'));
  for (const f of ['build/pdf.min.mjs', 'build/pdf.worker.min.mjs', 'cmaps', 'standard_fonts']) {
    copy(must(path.join(NM, 'pdfjs-dist', f)), o('lib/pdfjs', f));
  }

  // ליבה, ממשק וגופנים — אותם קבצים כמו בתוכנה למחשב
  for (const f of ['hebrew.js', 'textedit.js', 'ops.js']) copy(r('src/core', f), o('core', f));
  write(o('styles.css'), fs.readFileSync(r('src/renderer/styles.css'), 'utf8').split('../../assets/').join('assets/'));
  copy(r('src/renderer/logo.png'), o('logo.png'));
  copy(r('build/icon.png'), o('icon-512.png'));
  copy(r('assets/fonts'), o('assets/fonts'));
  copy(r('src/web/web.css'), o('web.css'));

  const app = fs.readFileSync(r('src/renderer/app.js'), 'utf8').split('../../node_modules/pdfjs-dist/').join('./lib/pdfjs/');
  if (app.includes('node_modules')) throw new Error('app.js עדיין מפנה ל-node_modules');
  write(o('app.js'), app);

  write(o('web-api.js'), fs.readFileSync(r('src/web/web-api.js'), 'utf8').replace('__VERSION__', pkg.version));

  // חתימה דיגיטלית: digisig.js כמו שהוא, עם תחליפים לדפדפן ל-crypto ול-Buffer
  const esbuild = require('esbuild');
  await esbuild.build({
    entryPoints: [r('src/core/digisig.js')],
    bundle: true,
    format: 'iife',
    globalName: 'DigiSig',
    platform: 'browser',
    target: ['chrome100', 'firefox100', 'safari15'],
    minify: true,
    outfile: o('lib/digisig.js'),
    alias: { crypto: r('src/web/crypto-shim.js') },
    inject: [r('src/web/buffer-global.js')],
    define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  });

  // דף ראשי
  let html = fs.readFileSync(r('src/renderer/index.html'), 'utf8');
  html = html
    .replace(/<script src="\.\.\/\.\.\/node_modules\/pdf-lib\/dist\/pdf-lib\.min\.js"><\/script>/, '<script src="web-api.js"></script>\n  <script src="lib/pdf-lib.min.js"></script>')
    .replace('../../node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'lib/fontkit.umd.min.js')
    .replace('../../node_modules/bidi-js/dist/bidi.min.js', 'lib/bidi.min.js')
    .split('../core/').join('core/')
    .replace('<script type="module" src="app.js"></script>', '<script defer src="lib/digisig.js"></script>\n  <script type="module" src="app.js"></script>\n  <script>if (\'serviceWorker\' in navigator && location.protocol !== \'file:\') navigator.serviceWorker.register(\'sw.js\').catch(() => {});</script>')
    .replace(/script-src 'self'/, "script-src 'self' 'sha256-SWHASH'")
    .replace('<link rel="stylesheet" href="styles.css">', [
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="description" content="עריכה, חתימה, מיזוג, פיצול, השחרה והקטנה של קבצי PDF בעברית מלאה — ישירות בדפדפן, בלי להעלות קבצים.">',
      '<meta name="theme-color" content="#8B1A1A">',
      '<link rel="manifest" href="manifest.webmanifest">',
      '<link rel="icon" href="logo.png">',
      '<link rel="stylesheet" href="styles.css">',
      '<link rel="stylesheet" href="web.css">',
    ].join('\n  '))
    .replace('<div class="top-actions">', '<div class="top-actions">\n      <button class="about-btn" id="btn-about" title="אודות" aria-label="אודות"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg></button>');
  if (html.includes('node_modules')) throw new Error('index.html עדיין מפנה ל-node_modules');
  // ה-CSP של התוכנה חוסם סקריפט מוטמע — מאשרים רק את שורת רישום ה-service worker
  const inline = /<script>(if \('serviceWorker'[\s\S]*?)<\/script>/.exec(html)[1];
  const hash = require('crypto').createHash('sha256').update(inline).digest('base64');
  html = html.replace('SWHASH', hash);
  write(o('index.html'), html);

  write(o('manifest.webmanifest'), JSON.stringify({
    name: 'קולמוס PDF',
    short_name: 'קולמוס',
    lang: 'he',
    dir: 'rtl',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#FBF7F6',
    theme_color: '#8B1A1A',
    icons: [{ src: 'logo.png', sizes: '128x128', type: 'image/png', purpose: 'any' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
    file_handlers: [{ action: './', accept: { 'application/pdf': ['.pdf'] } }],
  }, null, 2));

  // service worker: אחרי הביקור הראשון הכלי עובד גם בלי אינטרנט
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else files.push(path.relative(OUT, p).split(path.sep).join('/'));
    }
  })(OUT);
  const core = files.filter((f) => !f.startsWith('lib/pdfjs/cmaps/') && !f.startsWith('lib/pdfjs/standard_fonts/'));
  const version = `${pkg.version}-${Date.now().toString(36)}`;
  write(o('sw.js'), fs.readFileSync(r('src/web/sw.js'), 'utf8')
    .replace('__CACHE__', JSON.stringify('kulmus-' + version))
    .replace('__FILES__', JSON.stringify(['./', ...core])));

  const size = files.reduce((n, f) => n + fs.statSync(o(f)).size, 0);
  console.log(`dist/web: ${files.length + 1} קבצים, ${(size / 1048576).toFixed(1)} MB (גרסה ${pkg.version})`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
