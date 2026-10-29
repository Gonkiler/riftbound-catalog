// Genera la versión estática de la web en dist/ para GitHub Pages (npm run build).
//
// Sin servidor no hay /api, así que se publican archivos:
//   data/cards.json        catálogo (igual que GET /api/cards)
//   data/collection.json   colección (copiada del repo; se edita desde la web con un token de GitHub)
//   data/prices.json       precios de Cardmarket de todas las cartas, descargados ahora.
//                          Cardmarket no permite descargar su guía desde el navegador (sin CORS).
//   static.json            le dice a app.js que funcione en modo estático y contra qué repo guarda.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cardIds } from "../server/catalog.js";
import { getPrice } from "../server/prices.js";
import { ownerName, renderIndex } from "../server/page.js";

const OUT = "dist";
// En GitHub Actions, GITHUB_REPOSITORY = "usuario/repo". En local se puede pasar a mano.
const REPO = process.env.GITHUB_REPOSITORY || process.env.PAGES_REPO || "";
const BRANCH = process.env.GITHUB_REF_NAME || "main";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/data`, { recursive: true });

cpSync("public", OUT, { recursive: true });
const owner = ownerName();
writeFileSync(`${OUT}/index.html`, renderIndex(owner));
cpSync("data/cards.json", `${OUT}/data/cards.json`);

// La colección se valida al publicar: si alguien la rompe a mano, el despliegue falla en vez de publicar basura.
const collection = JSON.parse(readFileSync("data/collection.json", "utf8"));
for (const [id, langs] of Object.entries(collection)) {
  if (!cardIds.has(id)) console.warn(`Aviso: ${id} no está en el catálogo.`);
  for (const [lang, v] of Object.entries(langs)) {
    for (const k of ["n", "f", "p"]) {
      if (!Number.isInteger(v[k] ?? 0) || (v[k] ?? 0) < 0) throw new Error(`Cantidad no válida en ${id}.${lang}.${k}`);
    }
  }
}
cpSync("data/collection.json", `${OUT}/data/collection.json`);

const prices = {};
let fromGuide = 0;
for (const id of cardIds) {
  const p = await getPrice(id);
  if (!p) continue;
  if (p.source === "guide") fromGuide++;
  // Sin los campos vacíos, para que el archivo pese menos.
  prices[id] = Object.fromEntries(Object.entries(p).filter(([, v]) => v != null));
}
writeFileSync(`${OUT}/data/prices.json`, JSON.stringify(prices));

writeFileSync(`${OUT}/static.json`, JSON.stringify({ repo: REPO, branch: BRANCH, owner }));
// Sin esto GitHub Pages pasa el sitio por Jekyll, que no hace falta.
writeFileSync(`${OUT}/.nojekyll`, "");

console.log(`dist/ listo: ${cardIds.size} cartas, ${Object.keys(collection).length} en la colección, precios de ${fromGuide} cartas desde la guía de hoy${REPO ? `, repo ${REPO}` : ""}.`);
if (!fromGuide) console.warn("Aviso: no se ha podido descargar la guía de Cardmarket; se usan los precios guardados.");
