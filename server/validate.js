import { LANGUAGES, cardIds } from "./catalog.js";

const MAX_COPIES = 999;

/**
 * Comprueba el cuerpo de PUT /api/collection/:id y lo devuelve limpio.
 * Formato: { EN: { n: 2, f: 0, p: 1 }, FR: { ... } }  (n = normal, f = foil, p = promo)
 * Lanza un Error con un mensaje en español si algo no cuadra.
 */
export function cleanLangs(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("El cuerpo debe ser un objeto por idioma.");
  const out = {};
  for (const [lang, v] of Object.entries(body)) {
    if (!LANGUAGES[lang]) throw new Error(`Idioma desconocido: ${lang}`);
    if (!v || typeof v !== "object") throw new Error(`Faltan las cantidades de ${lang}.`);
    const counts = {};
    for (const k of ["n", "f", "p"]) {
      const x = v[k] ?? 0;
      if (!Number.isInteger(x) || x < 0 || x > MAX_COPIES) throw new Error(`Cantidad no válida en ${lang}.${k}: ${x}`);
      counts[k] = x;
    }
    out[lang] = counts;
  }
  return out;
}

/**
 * Valida una colección entera ({ cardId: { EN: {...} } }) y devuelve { cards, skipped }.
 * Las cartas que no están en el catálogo se saltan; los errores de formato lanzan.
 */
export function cleanCollection(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("La colección debe ser un objeto por carta.");
  const cards = {};
  const skipped = [];
  for (const [id, langs] of Object.entries(input)) {
    if (!cardIds.has(id)) skipped.push(id);
    else cards[id] = cleanLangs(langs);
  }
  return { cards, skipped };
}
