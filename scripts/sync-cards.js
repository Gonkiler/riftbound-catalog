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
