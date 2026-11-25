// מטמון לעבודה בלי אינטרנט. הקבצים של המשתמש לא עוברים כאן — רק קבצי הכלי עצמו.
const CACHE = "kulmus-1.3.4-mwwd68vt";
const FILES = ["./","app.js","assets/fonts/Alef-Bold.ttf","assets/fonts/Alef-Regular.ttf","assets/fonts/IBMPlexSansHebrew-Bold.ttf","assets/fonts/IBMPlexSansHebrew-Medium.ttf","assets/fonts/IBMPlexSansHebrew-Regular.ttf","assets/fonts/IBMPlexSansHebrew-SemiBold.ttf","assets/fonts/OFL-Alef.txt","assets/fonts/OFL-IBMPlex.txt","core/hebrew.js","core/ops.js","core/textedit.js","icon-512.png","index.html","lib/bidi.min.js","lib/digisig.js","lib/fontkit.umd.min.js","lib/pdf-lib.min.js","lib/pdfjs/build/pdf.min.mjs","lib/pdfjs/build/pdf.worker.min.mjs","logo.png","manifest.webmanifest","styles.css","web-api.js","web.css"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
