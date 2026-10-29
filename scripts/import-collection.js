// Importa copias desde un JSON a la base de datos (local o Turso, según .env).
//   npm run import                      -> data/seed/coleccion-inicial.json
//   npm run import -- ruta/archivo.json
//
// Formato: { "cards": { "rad-046": { "EN": { "n": 0, "f": 1, "p": 0 } } } }
// (vale también el objeto de cartas suelto, que es lo que devuelve GET /api/collection).
// Sustituye las copias de cada carta que aparezca en el archivo; el resto no se toca.
import { readFile } from "node:fs/promises";
import { setCards, dbLocation } from "../server/db.js";
import { cleanCollection } from "../server/validate.js";

const file = process.argv[2] || "data/seed/coleccion-inicial.json";
const json = JSON.parse(await readFile(file, "utf8"));
const { cards, skipped } = cleanCollection(json.cards || json);

for (const id of skipped) console.warn(`Saltada ${id}: no está en el catálogo.`);
await setCards(cards);
console.log(`Importadas ${Object.keys(cards).length} cartas desde ${file} en ${dbLocation}.`);
