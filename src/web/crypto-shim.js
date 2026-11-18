// תחליף דפדפן למודול crypto של Node — רק מה ש-digisig.js משתמש בו, על בסיס node-forge.
// כך אותו קוד חתימה ואימות רץ גם בגרסה למחשב וגם בדפדפן.
const forge = require('node-forge');
const { Buffer } = require('buffer');

const toBin = (b) => Buffer.from(b).toString('binary');
const fromBin = (s) => Buffer.from(s, 'binary');

const MD = {
  sha1: () => forge.md.sha1.create(),
  sha256: () => forge.md.sha256.create(),
  sha384: () => forge.md.sha384.create(),
  sha512: () => forge.md.sha512.create(),
};

function createHash(alg) {
  const md = (MD[String(alg).toLowerCase()] || MD.sha256)();
  return {
    update(data) { md.update(toBin(data)); return this; },
    digest(enc) { const b = fromBin(md.digest().getBytes()); return enc ? b.toString(enc) : b; },
  };
}

function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return Buffer.from(a);
}

function getRandomValues(a) { return globalThis.crypto.getRandomValues(a); }

/** generateKeyPairSync('rsa', { modulusLength }) — מחזיר אובייקטים עם export(pem) כמו ב-Node */
function generateKeyPairSync(type, opts) {
  if (type !== 'rsa') throw new Error('רק RSA נתמך');
  const kp = forge.pki.rsa.generateKeyPair({ bits: (opts && opts.modulusLength) || 2048, e: 0x10001 });
  return {
    privateKey: { export: () => forge.pki.privateKeyToPem(kp.privateKey), _forge: kp.privateKey },
    publicKey: { export: () => forge.pki.publicKeyToPem(kp.publicKey), _forge: kp.publicKey },
  };
}

const SHORT = { commonName: 'CN', emailAddress: 'E', organizationName: 'O', organizationalUnitName: 'OU', countryName: 'C', localityName: 'L', stateOrProvinceName: 'ST' };
function dn(attrs) {
  return attrs.map((a) => {
    let v = a.value;
    try { v = forge.util.decodeUtf8(v); } catch (e) { /* כבר טקסט */ }
    return `${SHORT[a.name] || a.shortName || a.type}=${v}`;
  }).join('\n');
}

/** X509Certificate — המאפיינים ש-verify צריך: subject, issuer, validTo, publicKey */
class X509Certificate {
  constructor(der) {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(toBin(der)));
    const cert = forge.pki.certificateFromAsn1(asn1);
    this._cert = cert;
    this.subject = dn(cert.subject.attributes);
    this.issuer = dn(cert.issuer.attributes);
    this.validTo = cert.validity.notAfter.toUTCString();
    this.validFrom = cert.validity.notBefore.toUTCString();
    this.publicKey = { _forge: cert.publicKey };
  }
}

/** verify(alg, data, key, signature) — RSA PKCS#1 v1.5 */
function verify(alg, data, key, signature) {
  const pub = key && key._forge;
  if (!pub || typeof pub.verify !== 'function') return false;
  const md = (MD[String(alg).toLowerCase()] || MD.sha256)();
  md.update(toBin(data));
  try { return pub.verify(md.digest().getBytes(), toBin(signature)); } catch (e) { return false; }
}

module.exports = { createHash, randomBytes, getRandomValues, generateKeyPairSync, X509Certificate, verify, webcrypto: globalThis.crypto };
