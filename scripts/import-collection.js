// Importa copias desde un JSON a la base de datos.
//   npm run import                      -> data/seed/coleccion-inicial.json
//   npm run import -- ruta/archivo.json
//
// Formato: { "cards": { "rad-046": { "EN": { "n": 0, "f": 1, "p": 0 } } } }
// (vale también el objeto de cartas suelto, que es lo que devuelve GET /api/collection).
// Sustituye las copias de cada carta que aparezca en el archivo; el resto no se toca.
import { readFile } from "node:fs/promises";
import { cardIds } from "../server/catalog.js";
import { setCard } from "../server/db.js";
import { cleanLangs } from "../server/validate.js";

const file = process.argv[2] || "data/seed/coleccion-inicial.json";
const json = JSON.parse(await readFile(file, "utf8"));
const cards = json.cards || json;

let ok = 0;
for (const [id, langs] of Object.entries(cards)) {
  if (!cardIds.has(id)) {
    console.warn(`Saltada ${id}: no está en el catálogo.`);
    continue;
  }
  setCard(id, cleanLangs(langs));
  ok++;
}
console.log(`Importadas ${ok} cartas desde ${file}.`);
