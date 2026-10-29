// Calcula la huella de imagen de cada carta para el escáner: npm run fingerprints
// Genera data/fingerprints.json. Reutiliza las huellas de imágenes que no han cambiado,
// así que después de `npm run sync` solo descarga las cartas nuevas.
//
// Hace falta hacerlo aquí y no en el navegador porque el CDN de Riot no permite leer
// los píxeles de sus imágenes desde otra web (no envía cabeceras CORS).
// Necesita las dependencias de desarrollo (npm install, incluye sharp).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import sharp from "sharp";
import { FP_VERSION, FP_W, FP_H, fingerprint, encode } from "../public/fingerprint.js";

const OUT = "data/fingerprints.json";
const catalog = JSON.parse(readFileSync("data/cards.json", "utf8"));
const col = Object.fromEntries(catalog.cols.map((k, i) => [k, i]));
let old = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { cards: {} };
// Si cambia el cálculo de la huella, se recalculan todas.
if (old.version !== FP_VERSION) old = { cards: {} };

// Las imágenes de Riot admiten ?w=…: pedimos una pequeña para ir más rápido.
const src = (img) => (img.includes("cmsassets.rgpub.io") ? `${img}?w=240&auto=format` : img);

const todo = [];
const out = { version: FP_VERSION, size: [FP_W, FP_H], cards: {} };
for (const row of catalog.cards) {
  const id = row[col.id], img = row[col.img];
  if (!img) continue;
  const prev = old.cards[id];
  if (prev && prev.img === img) out.cards[id] = prev;
  else todo.push({ id, img });
}

let done = 0, failed = [];
async function work() {
  while (todo.length) {
    const { id, img } = todo.shift();
    try {
      let res;
      // Algunos CDN (dotgg) cortan si se piden muchas seguidas: se reintenta con espera.
      for (let attempt = 0; attempt < 4; attempt++) {
        res = await fetch(src(img), { headers: { "User-Agent": "archivo-riftbound (scanner fingerprints)" /* solo ASCII: dotgg rechaza tildes */ } });
        if (res.ok || ![403, 429, 503].includes(res.status)) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Los campos de batalla son horizontales: su huella se calcula en apaisado (FP_H × FP_W)
      // y el escáner la compara con un encuadre horizontal ("o": "l").
      const meta = await sharp(buf).metadata();
      const landscape = meta.width > meta.height;
      const [w, h] = landscape ? [FP_H, FP_W] : [FP_W, FP_H];
      const { data, info } = await sharp(buf).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      out.cards[id] = { img, fp: encode(fingerprint(data, info.width, info.height, info.channels)), ...(landscape ? { o: "l" } : {}) };
    } catch (err) {
      failed.push(`${id}: ${err.message}`);
    }
    if (++done % 100 === 0) console.log(`  ${done} imágenes…`);
  }
}
const pending = todo.length;
console.log(`Reutilizadas ${Object.keys(out.cards).length}; por calcular ${pending}.`);
await Promise.all(Array.from({ length: 3 }, work));

// Orden estable para que el diff del repo sea pequeño.
out.cards = Object.fromEntries(Object.entries(out.cards).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, JSON.stringify(out));
console.log(`Listo: ${Object.keys(out.cards).length} huellas en ${OUT}.`);
if (failed.length) console.warn(`No se pudieron descargar ${failed.length}:\n  ${failed.join("\n  ")}`);
