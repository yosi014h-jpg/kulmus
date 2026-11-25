// גשר הדפדפן: אותו ממשק window.api שהגרסה למחשב מקבלת מ-preload.js,
// ממומש כאן בכלים של הדפדפן בלבד. שום קובץ לא יוצא מהמחשב.
(function () {
  'use strict';

  const VERSION = '__VERSION__';
  const hasFS = typeof window.showOpenFilePicker === 'function';
  const hasDir = typeof window.showDirectoryPicker === 'function';

  /* ---------- רישום קבצים: "נתיב" מדומה ← ידית קובץ / File ---------- */
  // נתיב בסגנון web:7/שם הקובץ.pdf — הסוף הוא שם הקובץ, כמו שהממשק מצפה.
  const reg = new Map();
  let seq = 1;
  function register(name, src) {
    const p = `web:${seq++}/${name}`;
    reg.set(p, src);
    return p;
  }
  const nameOf = (p) => String(p).split('/').pop();

  async function entryFromFile(file, handle) {
    return { name: file.name, path: register(file.name, { handle: handle || null, file }), bytes: new Uint8Array(await file.arrayBuffer()) };
  }

  /** בחירת קבצים: ידיות קבצים כשאפשר (שמירה חוזרת לאותו קובץ), אחרת input רגיל */
  async function pick(accept, mimes, multiple) {
    if (hasFS) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple,
          types: [{ description: accept.label, accept: mimes }],
          excludeAcceptAllOption: false,
        });
        const out = [];
        for (const h of handles) out.push(await entryFromFile(await h.getFile(), h));
        return out;
      } catch (e) {
        if (e && e.name === 'AbortError') return [];
        // דפדפן שחוסם את הבורר (למשל בתוך iframe) — נופלים ל-input
      }
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept.ext;
      input.multiple = multiple;
      input.style.display = 'none';
      let done = false;
      const finish = async () => {
        if (done) return;
        done = true;
        const files = [...(input.files || [])];
        input.remove();
        resolve(await Promise.all(files.map((f) => entryFromFile(f))));
      };
      input.addEventListener('change', finish);
      input.addEventListener('cancel', () => { done = true; input.remove(); resolve([]); });
      document.body.appendChild(input);
      input.click();
    });
  }

  const PDF = { label: 'קבצי PDF', ext: '.pdf,application/pdf' };
  const PDF_MIME = { 'application/pdf': ['.pdf'] };
  const IMG = { label: 'תמונות', ext: '.png,.jpg,.jpeg,image/png,image/jpeg' };
  const IMG_MIME = { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'] };
  const PFX = { label: 'קובצי תעודה', ext: '.pfx,.p12,application/x-pkcs12' };
  const PFX_MIME = { 'application/x-pkcs12': ['.pfx', '.p12'] };

  /* ---------- אפליקציית אנדרואיד: התוסף המקומי (ראו android/.../KulmusPlugin.java) ---------- */
  const NATIVE = window.KulmusNative || null;
  function toB64(u8) {
    u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  function download(name, bytes, type) {
    if (NATIVE) {
      // באנדרואיד אין "הורדה" מתוך האפליקציה — שומרים ישירות לתיקיית ההורדות
      return NATIVE.saveFile({ name, mime: type || 'application/pdf', data: toB64(bytes) })
        .catch((e) => console.error('שמירה נכשלה', e));
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  async function writeHandle(handle, bytes) {
    if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('הדפדפן לא קיבל הרשאה לכתוב לקובץ');
    }
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
  }

  const withPdf = (n) => (/\.pdf$/i.test(n) ? n : n + '.pdf');

  /* ---------- חתימה דיגיטלית: תעודות נשמרות בדפדפן בלבד ---------- */
  const CERT_DB = 'kulmus-certs';
  function certStore(mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CERT_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('p12');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('p12', mode);
        const r = fn(tx.objectStore('p12'));
        tx.oncomplete = () => resolve(r && r.result);
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  async function p12Bytes(source) {
    if (!source || source.kind !== 'file') throw new Error('מקור תעודה לא מוכר');
    const src = reg.get(source.path);
    if (src && src.file) return new Uint8Array(await src.file.arrayBuffer());
    const saved = await certStore('readonly', (s) => s.get(source.path));
    if (saved) return new Uint8Array(saved);
    throw new Error('קובץ התעודה כבר לא זמין. בחרו אותו שוב.');
  }

  let fontCache = null;
  async function fonts() {
    if (!fontCache) fontCache = Promise.all([api.readAsset('fonts/Alef-Regular.ttf'), api.readAsset('fonts/Alef-Bold.ttf')]).then(([regular, bold]) => ({ regular, bold }));
    return fontCache;
  }

  const DS = () => {
    if (!window.DigiSig) throw new Error('רכיב החתימה הדיגיטלית לא נטען');
    return window.DigiSig;
  };

  /* ---------- סגירת הדף עם שינויים לא שמורים ---------- */
  let dirty = false;
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* ---------- קיצורי מקלדת: במחשב הם מגיעים מהתפריט ---------- */
  const menuHandlers = [];
  const emit = (cmd) => menuHandlers.forEach((cb) => cb(cmd));
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    let cmd = null;
    if (k === 'o' || e.code === 'KeyO') cmd = 'open';
    else if (k === 'p' || e.code === 'KeyP') cmd = 'print';
    else if ((k === 's' || e.code === 'KeyS') && e.shiftKey) cmd = 'save-as';
    else if (k === 's' || e.code === 'KeyS') cmd = 'save';
    else if ((k === 'z' || e.code === 'KeyZ') && !e.shiftKey) cmd = 'undo';
    else if (k === 'y' || e.code === 'KeyY' || ((k === 'z' || e.code === 'KeyZ') && e.shiftKey)) cmd = 'redo';
    else if (k === 'a' || e.code === 'KeyA') cmd = 'select-all';
    else if (k === '=' || k === '+') cmd = 'zoom-in';
    else if (k === '-') cmd = 'zoom-out';
    else if (k === '0') cmd = 'zoom-fit';
    else if (k === '9') cmd = 'zoom-page';
    if (!cmd) return;
    // בתוך שדה טקסט משאירים לדפדפן ביטול/בחירה רגילים
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (typing && (cmd === 'undo' || cmd === 'redo' || cmd === 'select-all')) return;
    e.preventDefault();
    emit(cmd);
  }, true);

  const openHandlers = [];
  const queued = [];
  let ready = false;

  const api = {
    platform: 'web',
    isWeb: true,
    isApp: !!NATIVE, // אפליקציית אנדרואיד
    canShowFolder: false,

    openPdfs: () => pick(PDF, PDF_MIME, true),
    openImages: () => pick(IMG, IMG_MIME, true),

    async readFile(p) {
      const src = reg.get(p);
      if (!src) throw new Error('הקובץ כבר לא זמין');
      const file = src.handle ? await src.handle.getFile() : src.file;
      return { name: file.name, path: p, bytes: new Uint8Array(await file.arrayBuffer()) };
    },

    /** שמירה לקובץ שנפתח: כתיבה ישירה כשיש ידית, אחרת הורדה */
    async writeFile(target, bytes) {
      const src = reg.get(target);
      if (src && src.handle && src.handle.createWritable) {
        await writeHandle(src.handle, bytes);
        return target;
      }
      download(withPdf(nameOf(target)), bytes);
      return target;
    },

    async saveAs(defaultName, bytes) {
      const name = withPdf(defaultName || 'מסמך.pdf');
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: PDF.label, accept: PDF_MIME }] });
          await writeHandle(h, bytes);
          return register(h.name, { handle: h, file: null });
        } catch (e) {
          if (e && e.name === 'AbortError') return null;
        }
      }
      download(name, bytes);
      return register(name, { handle: null, file: null });
    },

    async chooseFolder() {
      if (hasDir) {
        try {
          const h = await window.showDirectoryPicker({ mode: 'readwrite' });
          return register(h.name, { dir: h });
        } catch (e) {
          if (e && e.name === 'AbortError') return null;
        }
      }
      return 'download:';
    },

    async writeFiles(folder, files) {
      const src = reg.get(folder);
      const written = [];
      if (src && src.dir) {
        for (const f of files) {
          let name = f.name;
          for (let n = 2; ; n++) {
            try { await src.dir.getFileHandle(name); name = f.name.replace(/\.pdf$/i, ` (${n}).pdf`); } catch (e) { break; }
          }
          const h = await src.dir.getFileHandle(name, { create: true });
          await writeHandle(h, f.bytes);
          written.push(register(name, { handle: h, file: null }));
        }
        return written;
      }
      // בלי גישה לתיקייה — מורידים את הקבצים אחד אחרי השני
      for (const f of files) {
        download(f.name, f.bytes);
        written.push(register(f.name, { handle: null, file: null }));
        await new Promise((r) => setTimeout(r, 350));
      }
      return written;
    },

    async readAsset(rel) {
      const safe = String(rel).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
      const r = await fetch(new URL('assets/' + safe, document.baseURI));
      if (!r.ok) throw new Error('לא נמצא: ' + safe);
      return new Uint8Array(await r.arrayBuffer());
    },

    showInFolder() {},
    openPath() {},
    appVersion: async () => VERSION,

    integrationStatus: async () => ({ supported: false }),
    integrationSet: async () => ({ supported: false }),

    /* חתימה דיגיטלית — רק עם קובץ תעודה (מאגר התעודות של Windows לא זמין בדפדפן) */
    certsSupported: async () => false,
    certsList: async () => [],
    async pickPfx() {
      const [e] = await pick(PFX, PFX_MIME, false);
      return e ? e.path : null;
    },
    async certInfo(source) {
      return DS().p12Info(await p12Bytes(source), source.password);
    },
    async certCreate({ name, email, password }) {
      const p12 = DS().createSelfSigned({ name, email, password });
      const safe = String(name).trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'cert';
      const key = `cert:${Date.now()}/${safe}.p12`;
      await certStore('readwrite', (s) => s.put(p12.buffer.slice(p12.byteOffset, p12.byteOffset + p12.byteLength), key));
      // עותק להורדה: התעודה שמורה רק בדפדפן הזה, וכדאי לשמור גיבוי
      download(`${safe}.p12`, p12, 'application/x-pkcs12');
      return { kind: 'file', path: key };
    },
    async digitalSign({ bytes, source, pageIndex, rect, name, reason, location, appearance }) {
      const D = DS();
      const signer = D.p12Signer(await p12Bytes(source), source.password);
      const signingTime = new Date();
      let ap = null;
      if (appearance && rect) {
        const date = signingTime.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
          + ' ' + signingTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        ap = { ...appearance, date, reason, location, fonts: await fonts() };
      }
      return D.signPdf(new Uint8Array(bytes), signer, { pageIndex, rect: ap ? rect : null, name, reason, location, signingTime, appearance: ap });
    },
    async verifySignatures(bytes) {
      return window.DigiSig ? window.DigiSig.verify(new Uint8Array(bytes)) : [];
    },

    setDirty: (v) => { dirty = !!v; },
    closeNow: () => { dirty = false; },
    rendererReady() {
      ready = true;
      while (queued.length) { const q = queued.shift(); openHandlers.forEach((cb) => cb(q)); }
    },
    pathForFile: (file) => register(file.name, { handle: null, file }),
    /** באנדרואיד: הדפסה דרך מערכת ההדפסה של הטלפון (בדפדפן — undefined, והממשק משתמש ב-window.print) */
    printPdf: NATIVE ? (bytes, name) => NATIVE.printPdf({ name: withPdf(name || 'מסמך'), data: toB64(bytes) }) : undefined,
    onOpenRequest: (cb) => openHandlers.push(cb),
    onMenu: (cb) => menuHandlers.push(cb),
    onBeforeClose: () => {},
  };

  // אפליקציה מותקנת (PWA): פתיחת קובץ PDF ממערכת ההפעלה
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const paths = [];
      for (const h of params.files) { const f = await h.getFile(); paths.push(register(f.name, { handle: h, file: f })); }
      const req = { mode: paths.length > 1 ? 'merge' : 'open', paths };
      if (ready) openHandlers.forEach((cb) => cb(req)); else queued.push(req);
    });
  }

  // אנדרואיד: קבצי PDF שנפתחו מאפליקציה אחרת ("פתח באמצעות" / "שיתוף")
  if (NATIVE) {
    const pull = async () => {
      try {
        const { files } = await NATIVE.takePending();
        if (!files || !files.length) return;
        const paths = files.map((f) => register(f.name, { handle: null, file: new File([fromB64(f.data)], f.name, { type: 'application/pdf' }) }));
        const req = { mode: paths.length > 1 ? 'merge' : 'open', paths };
        if (ready) openHandlers.forEach((cb) => cb(req)); else queued.push(req);
      } catch (e) { console.error(e); }
    };
    NATIVE.addListener('incoming', pull);
    pull();
  }

  window.api = api;
})();
