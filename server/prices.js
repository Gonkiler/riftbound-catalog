// Precios de Cardmarket.
//
// La API oficial de Cardmarket no acepta nuevas solicitudes, así que usamos su guía de
// precios pública (un JSON diario, sin clave). Riftbound es el juego 22.
// La guía se descarga solo cuando alguien pide un precio y se reutiliza durante
// PRICE_TTL_HOURS; si la descarga falla se usa la última copia guardada y, si no hay
// ninguna, el precio de respaldo que trae data/cardmarket-ids.json.
//
// Ojo: la guía da UN precio por producto que mezcla todos los idiomas.
import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_22.json";
const CACHE_FILE = "data/cache/price_guide_22.json";
const TTL_MS = Number(process.env.PRICE_TTL_HOURS || 12) * 60 * 60 * 1000;

const ids = JSON.parse(readFileSync(new URL("../data/cardmarket-ids.json", import.meta.url), "utf8"));

let guide = null; // { fetchedAt, createdAt, byProduct: Map }
let loading = null;

function index(json, fetchedAt) {
  const byProduct = new Map();
  for (const row of json.priceGuides || []) byProduct.set(Number(row.idProduct), row);
  return { fetchedAt, createdAt: json.createdAt || null, byProduct };
}

async function readCache() {
  try {
    const saved = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    return index(saved.guide, saved.fetchedAt);
  } catch {
    return null;
  }
}

async function download() {
  const res = await fetch(GUIDE_URL, { headers: { "User-Agent": "archivo-riftbound (catálogo personal)" } });
  if (!res.ok) throw new Error(`Cardmarket respondió ${res.status}`);
  const json = await res.json();
  const fetchedAt = Date.now();
  await mkdir("data/cache", { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify({ fetchedAt, guide: json }));
  return index(json, fetchedAt);
}

async function loadGuide() {
  if (!guide) guide = await readCache();
  if (guide && Date.now() - guide.fetchedAt < TTL_MS) return guide;
  loading ||= download()
    .then((g) => (guide = g))
    .catch((err) => {
      console.warn(`No se pudo descargar la guía de precios: ${err.message}`);
      return guide; // copia anterior, o null
    })
    .finally(() => (loading = null));
  return loading;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Precio de una carta o null si no tiene producto en Cardmarket. */
export async function getPrice(cardId) {
  const link = ids.cards[cardId];
  if (!link) return null;
  const g = link.cmId ? await loadGuide() : null;
  const row = g && g.byProduct.get(link.cmId);
  if (row) {
    return {
      source: "guide",
      date: g.createdAt || new Date(g.fetchedAt).toISOString(),
      trend: num(row.trend),
      avg30: num(row.avg30),
      low: num(row.low),
      foilTrend: num(row["trend-foil"]),
      foilLow: num(row["low-foil"]),
      url: link.url,
    };
  }
  const s = link.snapshot || {};
  return {
    source: "snapshot",
    date: ids.snapshotAt,
    trend: num(s.trend),
    avg30: num(s.avg30),
    low: num(s.low),
    foilTrend: num(s.foilTrend),
    foilLow: num(s.foilLow),
    url: link.url,
  };
}
