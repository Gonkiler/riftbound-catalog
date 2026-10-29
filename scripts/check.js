// Comprobaciones rápidas sin servidor: npm run check
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// La base de pruebas va a una carpeta temporal, nunca a la colección de verdad.
const tmp = mkdtempSync(join(tmpdir(), "riftbound-check-"));
process.env.DB_PATH = join(tmp, "check.db");
delete process.env.TURSO_DATABASE_URL;

const { cleanLangs, cleanCollection } = await import("../server/validate.js");
const db = await import("../server/db.js");

const catalog = JSON.parse(readFileSync("data/cards.json", "utf8"));
const ids = JSON.parse(readFileSync("data/cardmarket-ids.json", "utf8"));

// Catálogo
assert.ok(catalog.cards.length > 1000, "el catálogo parece incompleto");
const setIds = new Set(catalog.sets.map((s) => s.id));
for (const row of catalog.cards) assert.ok(setIds.has(row[4]), `colección desconocida en ${row[0]}`);
assert.equal(new Set(catalog.cards.map((r) => r[0])).size, catalog.cards.length, "hay ids de carta repetidos");
assert.ok(Object.keys(ids.cards).length > 1000, "faltan ids de Cardmarket");
const extra = JSON.parse(readFileSync("data/cards-extra.json", "utf8")).cards;
const catalogIds = new Set(catalog.cards.map((r) => r[0]));
for (const e of extra) assert.ok(catalogIds.has(e.id), `${e.id} está en cards-extra.json pero no en el catálogo: ejecuta npm run sync`);

// Validación de copias
assert.deepEqual(cleanLangs({ EN: { n: 2 } }), { EN: { n: 2, f: 0, p: 0 } });
assert.throws(() => cleanLangs({ XX: { n: 1 } }), /Idioma desconocido/);
assert.throws(() => cleanLangs({ EN: { n: -1 } }), /no válida/);
assert.throws(() => cleanLangs({ EN: { f: 1.5 } }), /no válida/);
assert.throws(() => cleanLangs([]), /objeto/);
const cc = cleanCollection({ "rad-046": { EN: { f: 1 } }, "no-existe": { EN: { n: 1 } } });
assert.deepEqual(cc.cards, { "rad-046": { EN: { n: 0, f: 1, p: 0 } } });
assert.deepEqual(cc.skipped, ["no-existe"]);

// Base de datos (archivo temporal)
const seed = (cards) => cleanCollection(cards).cards;
assert.equal(await db.seedOnce("data/seed/coleccion-inicial.json", seed), 9, "la colección inicial no se ha cargado");
assert.equal(await db.seedOnce("data/seed/coleccion-inicial.json", seed), 0, "la colección inicial se carga dos veces");
await db.setCard("ogn-001-298", { EN: { n: 2, f: 0, p: 0 }, ES: { n: 0, f: 0, p: 0 } });
let col = await db.getCollection();
assert.deepEqual(col["ogn-001-298"], { EN: { n: 2, f: 0, p: 0 } }, "los idiomas a cero no deben guardarse");
await db.setCard("ogn-001-298", {});
col = await db.getCollection();
assert.equal(col["ogn-001-298"], undefined, "borrar una carta no funciona");
assert.equal(Object.keys(col).length, 9);

db.close();
// En Windows el archivo puede seguir bloqueado un momento; no es un fallo de la comprobación.
try { rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`OK: ${catalog.cards.length} cartas, ${catalog.sets.length} colecciones, base de datos y validación.`);
