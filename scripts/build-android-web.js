#!/usr/bin/env node
// גרסת האנדרואיד: לוקחת את dist/web ומתאימה אותה לאפליקציה → dist/android-web
// - בלי CSP ו-service worker (Capacitor מזריק סקריפט גשר משלו, והקבצים כבר בתוך האפליקציה)
// - מוסיפה את lib/kulmus-native.js לפני web-api.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'dist', 'web');
const OUT = path.join(ROOT, 'dist', 'android-web');

async function main() {
  if (!fs.existsSync(path.join(SRC, 'index.html'))) throw new Error('חסר dist/web — הריצו קודם npm run build:web');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(SRC, OUT, { recursive: true });
  fs.rmSync(path.join(OUT, 'sw.js'), { force: true });

  await require('esbuild').build({
    entryPoints: [path.join(ROOT, 'src/android/native.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome90'],
    minify: true,
    outfile: path.join(OUT, 'lib/kulmus-native.js'),
    logLevel: 'warning',
  });

  let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const before = html;
  html = html
    .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
    .replace(/\s*<link rel="manifest"[^>]*>/, '')
    .replace(/\s*<script>if \('serviceWorker'[\s\S]*?<\/script>/, '')
    .replace('<script src="web-api.js"></script>', '<script src="lib/kulmus-native.js"></script>\n  <script src="web-api.js"></script>');
  for (const must of ['kulmus-native.js']) if (!html.includes(must)) throw new Error('index.html: לא הוכנס ' + must);
  if (html.includes('Content-Security-Policy') || html.includes("serviceWorker")) throw new Error('index.html: CSP או service worker לא הוסרו');
  if (html === before) throw new Error('index.html לא השתנה');
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log('dist/android-web מוכן');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
