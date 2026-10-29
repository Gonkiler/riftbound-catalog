// Descarga el catálogo de cartas y los ids de Cardmarket y genera:
//   data/cards.json            catálogo compacto que lee la web
//   data/cardmarket-ids.json   id de producto de Cardmarket por carta + precio de respaldo
//
// Fuente: el repositorio público Goodplayer01/riftbound-tracker, que mantiene la
// lista de cartas (con las imágenes oficiales de Riot) y el enlace de cada carta
// con su producto de Cardmarket. Ejecuta `npm run sync` cuando salga una colección nueva.

import { readFile, writeFile, mkdir } from "node:fs/promises";

const SRC = "https://raw.githubusercontent.com/Goodplayer01/riftbound-tracker/main/public";

// Orden de la barra lateral. Una colección nueva que no esté aquí se añade al final.
const SET_ORDER = ["OGN", "OGS", "SFD", "UNL", "VEN", "RAD", "OGN-NN", "SFD-NN", "UNL-NN", "VEN-NN", "RAD-NN"];
const KEEP_TAGS = new Set(["promo", "overnumbered", "alt", "signed", "nexus-night", "ultimate", "release"]);
const ID_RE = /^[A-Za-z0-9_\-.~:@+]+$/;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
  return res.json();
}

// Ordena "OGN-002/298" antes que "OGN-010/298" comparando los números como números.
function naturalKey(code) {
  return code.split(/(\d+)/).map((part) => (/^\d+$/.test(part) ? part.padStart(6, "0") : part)).join("");
}

const [cardsSrc, pricesSrc] = await Promise.all([getJson(`${SRC}/cards.json`), getJson(`${SRC}/prices.json`)]);

// Cartas y colecciones añadidas a mano (data/cards-extra.json).
const extraFile = JSON.parse(await readFile("data/cards-extra.json", "utf8"));
const setNames = { ...(extraFile.sets || {}), ...cardsSrc.sets };
const order = [...SET_ORDER, ...Object.keys(setNames).filter((s) => !SET_ORDER.includes(s))];
const sets = order.filter((id) => setNames[id]).map((id) => ({ id, name: setNames[id] }));

const cards = [];
for (const c of cardsSrc.cards) {
  if (!ID_RE.test(c.id)) throw new Error(`Id de carta inesperado: ${c.id}`);
  cards.push([
    c.id,
    c.name,
    c.subtitle || "",
    c.code,
    c.set,
    c.rarity,
    (c.types && c.types[0]) || "",
    (c.domains || []).join("/"),
    (c.image || "").split("?")[0],
    (c.tags || []).filter((t) => KEEP_TAGS.has(t)),
  ]);
}
// Cartas añadidas a mano (data/cards-extra.json): solo las que el tracker aún no trae.
const extra = extraFile.cards;
const trackerIds = new Set(cards.map((r) => r[0]));
const trackerCodes = new Set(cards.map((r) => r[3].toUpperCase()));
const extraUsed = [];
for (const e of extra) {
  if (!ID_RE.test(e.id)) throw new Error(`Id de carta inesperado en cards-extra.json: ${e.id}`);
  if (trackerIds.has(e.id) || trackerCodes.has(e.code.toUpperCase())) {
    console.log(`El tracker ya trae ${e.id} (${e.name}): puedes quitarla de data/cards-extra.json.`);
    continue;
  }
  cards.push([e.id, e.name, e.sub || "", e.code, e.set, e.rarity, e.type, e.domains, e.img || "", e.tags || []]);
  extraUsed.push(e);
}

cards.sort((a, b) => order.indexOf(a[4]) - order.indexOf(b[4]) || naturalKey(a[3]).localeCompare(naturalKey(b[3])));

const ids = {};
for (const [id, p] of Object.entries(pricesSrc.cards)) {
  ids[id] = {
    cmId: p.cmId ? Number(p.cmId) : null,
    url: (p.cmUrl || "").split("?")[0] || null,
    snapshot: { trend: p.trend, avg30: p.avg30, low: p.low, foilTrend: p.foilTrend, foilLow: p.foilLow },
  };
}

for (const e of extraUsed) {
  if (e.cmId) ids[e.id] = { cmId: Number(e.cmId), url: e.cmUrl || null, snapshot: {} };
}

// ---------- Enlazar por nombre las cartas que tienen enlace a Cardmarket pero no producto ----------
// Pasa con muchas promos (Nexus Night…): el tracker sabe la página de Cardmarket pero no el id de
// producto, y sin id no hay precio. El catálogo de productos de Cardmarket da nombre y expansión;
// se enlaza solo cuando el nombre es único en su expansión, para no asignar un precio equivocado.
const PRODUCTS_URL = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_22.json";
const linkReport = { linked: 0, ambiguous: [], notFound: [] };
try {
  const products = (await getJson(PRODUCTS_URL)).products;
  const prodById = new Map(products.map((p) => [p.idProduct, p]));
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const slugOf = (url) => url?.split("/Singles/")[1]?.split("/")[0] || null;
  const used = new Set(Object.values(ids).map((v) => v.cmId).filter(Boolean));
  const byId = Object.fromEntries(cards.map((r) => [r[0], r]));
  const fullName = (r) => norm(r[2] ? `${r[1]} ${r[2]}` : r[1]);

  // Expansiones de las colecciones normales (no promo): una promo nunca se enlaza ahí, porque
  // allí está la carta normal, con otro precio.
  const isPromo = (r) => r[4].endsWith("-NN") || r[9].includes("promo");
  const mainExps = new Set();
  for (const [id, v] of Object.entries(ids)) {
    const exp = v.cmId && prodById.get(v.cmId)?.idExpansion;
    if (exp && byId[id] && !isPromo(byId[id])) mainExps.add(exp);
  }
  const promoProducts = products.filter((p) => !mainExps.has(p.idExpansion));
  // Expansiones de cada página de Cardmarket ("Spiritforged-Promos"…), según las cartas ya enlazadas.
  const expsOfSlug = {};
  for (const v of Object.values(ids)) {
    const exp = v.cmId && prodById.get(v.cmId)?.idExpansion, slug = slugOf(v.url);
    if (exp && slug && !mainExps.has(exp)) (expsOfSlug[slug] ||= new Set()).add(exp);
  }
  const todo = Object.entries(ids).filter(([id, v]) => !v.cmId && slugOf(v.url) && byId[id]);
  // Páginas sin ninguna carta enlazada: la expansión que más nombres coincide.
  for (const slug of new Set(todo.map(([, v]) => slugOf(v.url)))) {
    if (expsOfSlug[slug]) continue;
    const votes = {};
    for (const [id, v] of todo) {
      if (slugOf(v.url) !== slug) continue;
      const exps = new Set(promoProducts.filter((p) => norm(p.name) === fullName(byId[id])).map((p) => p.idExpansion));
      for (const e of exps) votes[e] = (votes[e] || 0) + 1;
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 3) expsOfSlug[slug] = new Set([Number(best[0])]);
  }

  const match = (pool, r) => {
    let c = pool.filter((p) => norm(p.name) === fullName(r));
    if (!c.length && r[2]) c = pool.filter((p) => norm(p.name) === norm(r[1])); // producto sin subtítulo
    return c;
  };
  for (const [id, v] of todo) {
    const r = byId[id], exps = expsOfSlug[slugOf(v.url)];
    if (!isPromo(r)) { linkReport.notFound.push(id); continue; }
    const free = promoProducts.filter((p) => !used.has(p.idProduct));
    // Primero en la expansión de su página; si no está, en el resto de expansiones de promos
    // (Cardmarket agrupa algunas promos en otra, p. ej. las de Proving Grounds con las de Origins).
    let cands = exps ? match(free.filter((p) => exps.has(p.idExpansion)), r) : [];
    if (!cands.length) cands = match(free, r);
    if (cands.length === 1) {
      v.cmId = cands[0].idProduct;
      used.add(v.cmId);
      linkReport.linked++;
    } else (cands.length ? linkReport.ambiguous : linkReport.notFound).push(id);
  }
  console.log(`Enlazadas con Cardmarket por nombre: ${linkReport.linked}. Ambiguas (varios productos con el mismo nombre): ${linkReport.ambiguous.length}. Sin producto: ${linkReport.notFound.length}.`);
  if (linkReport.ambiguous.length) console.log(`  Ambiguas: ${linkReport.ambiguous.join(", ")}`);
  if (linkReport.notFound.length) console.log(`  Sin producto: ${linkReport.notFound.join(", ")}`);
} catch (err) {
  console.warn(`No se ha podido enlazar por nombre con Cardmarket: ${err.message}`);
}

await mkdir("data", { recursive: true });
await writeFile(
  "data/cards.json",
  JSON.stringify({ sets, cols: ["id", "name", "sub", "code", "set", "rarity", "type", "domains", "img", "tags"], cards })
);
await writeFile(
  "data/cardmarket-ids.json",
  JSON.stringify({ snapshotAt: pricesSrc.guideCreatedAt || pricesSrc.updatedAt, cards: ids })
);
console.log(`${cards.length} cartas en ${sets.length} colecciones (${extraUsed.length} de cards-extra.json); ${Object.keys(ids).length} con producto de Cardmarket.`);
