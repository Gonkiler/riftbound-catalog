// Núcleo del escáner sin dependencias del navegador (lo prueban también los scripts de Node).
//
// Cada carta lleva impresa abajo a la izquierda la colección, el número y, en las
// colecciones recientes, el idioma:  "RAD • 138/167 • EN",  "OGN • 303*/298",  "SFD • T01".
// El escáner lee esa línea con OCR, saca las candidatas con ese número y, si hay varias
// (normal, promo, variante), elige por la huella de imagen (fingerprint.js).
import { distance, stampDistance } from "./fingerprint.js";

// Zona de la franja inferior, en fracciones de la carta (medido sobre las imágenes oficiales).
export const STRIP = { x0: 0.0, x1: 0.55, y0: 0.9, y1: 1.0 };

/**
 * Prepara la franja para el OCR: gris, texto oscuro sobre fondo claro y contraste estirado.
 * rgba: Uint8ClampedArray (w × h × 4). Devuelve un RGBA nuevo del mismo tamaño.
 */
// invert: true/false para forzarlo; sin indicar, se decide por la mediana. El escáner prueba las
// dos variantes (hay cartas con texto claro sobre una etiqueta de color medio).
export function prepStrip(rgba, w, h, invert) {
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;
  // Percentiles 5 y 95 para estirar el contraste sin que manden los reflejos.
  const hist = new Uint32Array(256);
  for (const g of gray) hist[g | 0]++;
  const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
  const lo = pct(0.05), hi = pct(0.95), mid = pct(0.5);
  // El texto es claro sobre fondo oscuro casi siempre: si la mediana es oscura, se invierte.
  if (invert === undefined) invert = mid < (lo + hi) / 2;
  const out = new Uint8ClampedArray(n * 4);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) {
    let v = ((gray[i] - lo) / span) * 255;
    if (invert) v = 255 - v;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

const LANG_CODES = new Set(["EN", "FR", "ES", "DE", "IT", "ZH", "JA", "JP", "KO", "KR", "CN"]);
const LANG_ALIAS = { JP: "JA", KR: "KO", CN: "ZH" };

// Confusiones típicas del OCR en esta tipografía.
const TO_DIGIT = { O: "0", Q: "0", D: "0", I: "1", L: "1", "|": "1", Z: "2", S: "5", B: "8", G: "6", T: "7" };
const TO_LETTER = { 0: "O", 1: "I", 5: "S", 8: "B", 6: "G", 2: "Z" };

function closestSet(raw, sets) {
  const s = raw.toUpperCase().replace(/[0-9]/g, (d) => TO_LETTER[d] || d);
  if (sets.has(s)) return s;
  // Una letra de diferencia (OGM → OGN) si solo hay una colección posible.
  const near = [...sets].filter((x) => x.length === s.length && [...x].filter((ch, i) => ch !== s[i]).length === 1);
  return near.length === 1 ? near[0] : null;
}

/**
 * Busca "SET • NUM[/TOTAL][ • LANG]" en el texto del OCR.
 * sets: Set con los códigos de colección válidos (OGN, SFD…).
 * Devuelve { set, num, lang, raw } o null. num va en mayúsculas con sufijo: "138", "303*", "R01", "T01", "061A".
 */
export function parseCode(text, sets) {
  const t = text.toUpperCase().replace(/[•·°º]/g, " ").replace(/[‘’`´]/g, "'");
  // colección (3 letras) · número (opcional R/T delante, sufijo a/b/*) · /total opcional · idioma opcional
  const re = /([A-Z0-9]{3})[\s.,:;\-_'"*+]{0,4}([RT]?[0-9OQDILSZBG|]{1,3}[A-Z*]?)(?:\s*\/\s*([0-9OQDILSZBG|]{2,3}))?(?:[\s.,:;\-_'"*+]{1,4}([A-Z]{2})\b)?/g;
  let m, best = null;
  while ((m = re.exec(t))) {
    const set = closestSet(m[1], sets);
    if (!set) continue;
    let num = m[2];
    const prefix = /^[RT]/.test(num) && num.length > 1 && /[0-9OQDILSZBG|]/.test(num[1]) ? num[0] : "";
    let body = num.slice(prefix.length);
    let suffix = "";
    if (prefix) {
      // Runas y fichas (R01, T03): siempre 2 cifras; lo que sobra es el sufijo ("R01b").
      if (body.length > 2) { suffix = body.slice(2); body = body.slice(0, 2); }
    } else if (body.length === 4 || (/[A-Z*]$/.test(body) && body.length > 1 && !/[OQDILSZBG]$/.test(body))) {
      suffix = body.slice(-1); body = body.slice(0, -1);
    }
    body = body.replace(/[OQDILSZBG|]/g, (c) => TO_DIGIT[c] || c);
    if (!/^\d{1,3}$/.test(body)) continue;
    const width = prefix ? 2 : 3;
    num = prefix + body.padStart(width, "0") + suffix;
    const lang = m[4] && LANG_CODES.has(m[4]) ? LANG_ALIAS[m[4]] || m[4] : null;
    // Con /total es mucho más fiable: se prefiere.
    const score = (m[3] ? 2 : 0) + (lang ? 1 : 0);
    if (!best || score > best.score) best = { set, num, lang, total: m[3] || null, raw: m[0].trim(), score };
  }
  return best;
}

/** Clave de búsqueda de una carta del catálogo a partir de su código: "OGN-001-P" → "OGN-001". */
export function baseKey(code) {
  const m = code.toUpperCase().match(/^([A-Z]+)-([RT]?\d+[A-Z*]?)/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Índice clave → cartas. cards: [{ id, code, ... }] */
export function buildIndex(cards) {
  const idx = new Map();
  for (const c of cards) {
    const k = baseKey(c.code);
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(c);
  }
  return idx;
}

/**
 * Candidatas para un código leído, ordenadas por parecido con la imagen de la cámara.
 * fps: Map id → huella (decodificada). camFp: huella de la cámara (o null).
 */
export function rankCandidates(read, idx, fps, camFp) {
  const list = (idx.get(`${read.set}-${read.num}`) || []).slice();
  // "061A" impreso como "061a": si no hay nada con sufijo, prueba sin él.
  if (!list.length && /[A-Z*]$/.test(read.num)) list.push(...(idx.get(`${read.set}-${read.num.slice(0, -1)}`) || []));
  const ranked = list
    .map((card) => ({ card, d: camFp && fps.has(card.id) ? distance(camFp, fps.get(card.id)) : null }))
    .sort((a, b) => (a.d ?? 0.5) - (b.d ?? 0.5));
  ranked.ambiguous = false;
  if (ranked.length < 2) return ranked;
  // Normal y promo suelen ser la misma ilustración y solo cambia el sello de abajo.
  const isPromo = (c) => c.tags?.includes("promo");
  const close = camFp && ranked[0].d != null ? ranked.filter((r) => r.d != null && r.d - ranked[0].d < TIE) : ranked.slice();
  if (close.length < 2) return ranked;
  for (const r of close) r.s = camFp ? stampDistance(camFp, fps.get(r.card.id) || {}) : null;
  const ss = close.map((r) => r.s).filter((s) => s != null).sort((a, b) => a - b);
  if (ss.length >= 2 && ss[1] - ss[0] > STAMP_GAP) {
    // El sello marca la diferencia: se ordena por él.
    close.sort((a, b) => (a.s ?? 9) - (b.s ?? 9));
  } else {
    // No se distinguen (las imágenes de referencia son casi iguales): primero la normal, y se pregunta.
    close.sort((a, b) => isPromo(a.card) - isPromo(b.card) || (a.d ?? 0.5) - (b.d ?? 0.5));
    ranked.ambiguous = true;
  }
  const out = [...close, ...ranked.filter((r) => !close.includes(r))];
  out.ambiguous = ranked.ambiguous;
  return out;
}
const TIE = 0.04; // diferencia de huella por debajo de la cual dos candidatas "se parecen igual"
const STAMP_GAP = 0.12; // diferencia en la zona del sello que se considera clara

/** Las k cartas más parecidas de todo el catálogo (si el número no se puede leer). */
export function nearest(camFp, fps, k = 5) {
  const out = [];
  for (const [id, fp] of fps) out.push({ id, d: distance(camFp, fp) });
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, k);
}
