// Huella de imagen de una carta, para reconocerla con la cámara.
// La usan el navegador (escáner, con un <canvas>) y scripts/fingerprints.js (con sharp),
// así las dos partes calculan exactamente lo mismo a partir de una imagen de FP_W × FP_H.
//
// - hash: "dHash" de 256 bits sobre una cuadrícula gris de 17×16 (compara cada celda con la
//   de su derecha). Resume la forma de la ilustración y aguanta cambios de brillo.
// - color: media RGB en una cuadrícula de 4×4. Al comparar se normaliza por el brillo,
//   para que la luz de la habitación influya menos.
// - stamp: gris en 12×5 de la zona del sello (abajo en el centro). Es lo único que cambia
//   entre una carta normal y su promo (logo de Nexus Night, del evento…); sirve para desempatar.

export const FP_VERSION = 3; // 3: campos de batalla en horizontal
export const FP_W = 96;
export const FP_H = 134; // proporción de la carta: 744 × 1039
const INSET = 0.04; // ignora el borde exterior (la cámara rara vez encuadra justo)
const FULL = { x0: INSET, x1: 1 - INSET, y0: INSET, y1: 1 - INSET };
export const STAMP = { x0: 0.38, x1: 0.62, y0: 0.9, y1: 0.985 };

function grid(px, w, h, ch, gx, gy, r = FULL) {
  const x0 = w * r.x0, x1 = w * r.x1, y0 = h * r.y0, y1 = h * r.y1;
  const out = new Float64Array(gx * gy * 3);
  const cnt = new Float64Array(gx * gy);
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const cy = Math.min(gy - 1, Math.max(0, Math.floor(((y - y0) / (y1 - y0)) * gy)));
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const cx = Math.min(gx - 1, Math.max(0, Math.floor(((x - x0) / (x1 - x0)) * gx)));
      const i = (y * w + x) * ch, c = cy * gx + cx;
      out[c * 3] += px[i]; out[c * 3 + 1] += px[i + 1]; out[c * 3 + 2] += px[i + 2];
      cnt[c]++;
    }
  }
  for (let c = 0; c < gx * gy; c++) for (let k = 0; k < 3; k++) out[c * 3 + k] /= cnt[c] || 1;
  return out;
}
const lum = (g, i) => g[i] * 0.299 + g[i + 1] * 0.587 + g[i + 2] * 0.114;
const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** px: píxeles RGB o RGBA (ch = 3 o 4) de una imagen de w × h (idealmente FP_W × FP_H). */
export function fingerprint(px, w, h, ch) {
  const g = grid(px, w, h, ch, 17, 16);
  const hash = new Uint8Array(32);
  let bit = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const a = (y * 17 + x) * 3;
      if (lum(g, a) > lum(g, a + 3)) hash[bit >> 3] |= 1 << (bit & 7);
      bit++;
    }
  }
  const c = grid(px, w, h, ch, 4, 4);
  const color = Uint8Array.from(c, byte);
  const s = grid(px, w, h, ch, 12, 5, STAMP);
  const stamp = new Uint8Array(60);
  for (let i = 0; i < 60; i++) stamp[i] = byte(lum(s, i * 3));
  return { hash, color, stamp };
}

const HEX = "0123456789abcdef";
const b64 = (bytes) => { let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const unb64 = (s, n) => { const bin = atob(s); const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i); return out; };

export function encode({ hash, color, stamp }) {
  let h = "";
  for (const b of hash) h += HEX[b >> 4] + HEX[b & 15];
  return `${h}:${b64(color)}:${b64(stamp)}`;
}
export function decode(s) {
  const [h, c, st] = s.split(":");
  const hash = new Uint8Array(32);
  for (let i = 0; i < 32; i++) hash[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return { hash, color: unb64(c, 48), stamp: st ? unb64(st, 60) : null };
}

const POP = new Uint8Array(256).map((_, i) => { let n = 0; for (let v = i; v; v >>= 1) n += v & 1; return n; });
function normalized(arr) {
  let s = 0;
  for (const v of arr) s += v;
  const m = s / arr.length || 1;
  return Array.from(arr, (v) => v / m);
}

/** Distancia entre dos huellas: 0 = idénticas, ~1 = nada que ver. */
export function distance(a, b) {
  let ham = 0;
  for (let i = 0; i < 32; i++) ham += POP[a.hash[i] ^ b.hash[i]];
  // El color normalizado se guarda en la propia huella: así buscar entre 1.600 cartas es rápido.
  const ca = (a.nc ||= normalized(a.color)), cb = (b.nc ||= normalized(b.color));
  let cd = 0;
  for (let i = 0; i < 48; i++) cd += Math.abs(ca[i] - cb[i]);
  return (ham / 256) * 0.6 + Math.min(1, cd / 48) * 0.4;
}

/** Distancia solo en la zona del sello (z-scores, así da igual el brillo). null si falta. */
export function stampDistance(a, b) {
  if (!a.stamp || !b.stamp) return null;
  const z = (arr) => {
    const m = arr.reduce((x, y) => x + y, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((x, y) => x + (y - m) ** 2, 0) / arr.length) || 1;
    return Array.from(arr, (v) => (v - m) / sd);
  };
  const za = z(a.stamp), zb = z(b.stamp);
  let d = 0;
  for (let i = 0; i < za.length; i++) d += Math.abs(za[i] - zb[i]);
  return d / za.length;
}
