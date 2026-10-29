// Comprobaciones rápidas sin servidor: npm run check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanLangs } from "../server/validate.js";

const catalog = JSON.parse(readFileSync("data/cards.json", "utf8"));
const ids = JSON.parse(readFileSync("data/cardmarket-ids.json", "utf8"));

// Catálogo
assert.ok(catalog.cards.length > 1000, "el catálogo parece incompleto");
const setIds = new Set(catalog.sets.map((s) => s.id));
for (const row of catalog.cards) assert.ok(setIds.has(row[4]), `colección desconocida en ${row[0]}`);
assert.equal(new Set(catalog.cards.map((r) => r[0])).size, catalog.cards.length, "hay ids de carta repetidos");
assert.ok(Object.keys(ids.cards).length > 1000, "faltan ids de Cardmarket");

// Validación de copias
assert.deepEqual(cleanLangs({ EN: { n: 2 } }), { EN: { n: 2, f: 0, p: 0 } });
assert.throws(() => cleanLangs({ XX: { n: 1 } }), /Idioma desconocido/);
assert.throws(() => cleanLangs({ EN: { n: -1 } }), /no válida/);
assert.throws(() => cleanLangs({ EN: { f: 1.5 } }), /no válida/);
assert.throws(() => cleanLangs([]), /objeto/);

console.log(`OK: ${catalog.cards.length} cartas, ${catalog.sets.length} colecciones.`);
