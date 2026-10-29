// Colección guardada con libSQL (SQLite compatible).
// - En local: un archivo SQLite (DB_PATH, por defecto data/coleccion.db).
// - En la nube: una base de Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN). Hace falta en
//   hostings gratuitos como Render, que borran los archivos en cada reinicio.
// Una fila por carta e idioma con el número de copias normales, foil y promo.
import { createClient } from "@libsql/client";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const REMOTE_URL = process.env.TURSO_DATABASE_URL || "";
const DB_PATH = process.env.DB_PATH || "data/coleccion.db";

export const dbLocation = REMOTE_URL ? "Turso" : DB_PATH;

if (!REMOTE_URL) mkdirSync(dirname(DB_PATH), { recursive: true });

const db = createClient(
  REMOTE_URL
    ? { url: REMOTE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${DB_PATH}` }
);

const ready = db.batch(
  [
    `CREATE TABLE IF NOT EXISTS copies (
      card_id    TEXT NOT NULL,
      lang       TEXT NOT NULL,
      normal     INTEGER NOT NULL DEFAULT 0,
      foil       INTEGER NOT NULL DEFAULT 0,
      promo      INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (card_id, lang)
    )`,
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  ],
  "write"
);

/** Toda la colección: { cardId: { EN: { n, f, p }, ... } } */
export async function getCollection() {
  await ready;
  const { rows } = await db.execute("SELECT card_id, lang, normal, foil, promo FROM copies");
  const out = {};
  for (const r of rows) {
    (out[r.card_id] ||= {})[r.lang] = { n: Number(r.normal), f: Number(r.foil), p: Number(r.promo) };
  }
  return out;
}

function cardStatements(cardId, langs, now) {
  const stmts = [{ sql: "DELETE FROM copies WHERE card_id = ?", args: [cardId] }];
  for (const [lang, v] of Object.entries(langs)) {
    if (v.n + v.f + v.p > 0) {
      stmts.push({
        sql: "INSERT INTO copies (card_id, lang, normal, foil, promo, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        args: [cardId, lang, v.n, v.f, v.p, now],
      });
    }
  }
  return stmts;
}

/** Sustituye las copias de una carta. `langs` = { EN: { n, f, p }, ... }; los idiomas a cero se borran. */
export async function setCard(cardId, langs) {
  await ready;
  await db.batch(cardStatements(cardId, langs, new Date().toISOString()), "write");
}

/** Sustituye varias cartas de una vez (en una sola transacción). `cards` = { cardId: langs } */
export async function setCards(cards) {
  await ready;
  const now = new Date().toISOString();
  const stmts = Object.entries(cards).flatMap(([id, langs]) => cardStatements(id, langs, now));
  if (stmts.length) await db.batch(stmts, "write");
}

/**
 * Carga data/seed/coleccion-inicial.json la primera vez que arranca una base nueva.
 * Queda apuntado en `meta`, así que no vuelve a cargarse aunque luego borres esas cartas.
 * `clean(cards)` filtra y valida (se pasa desde fuera para no importar el catálogo aquí).
 */
export async function seedOnce(file, clean) {
  await ready;
  const { rows } = await db.execute("SELECT value FROM meta WHERE key = 'seeded'");
  if (rows.length) return 0;
  let cards = {};
  try {
    const json = JSON.parse(readFileSync(file, "utf8"));
    cards = clean(json.cards || json);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const { rows: existing } = await db.execute("SELECT COUNT(*) AS n FROM copies");
  // Si la base ya tiene datos (p. ej. de un `npm run import`), no se pisan.
  if (Number(existing[0].n) === 0) await setCards(cards);
  await db.execute({ sql: "INSERT INTO meta (key, value) VALUES ('seeded', ?)", args: [new Date().toISOString()] });
  return Number(existing[0].n) === 0 ? Object.keys(cards).length : 0;
}

/** Cierra la conexión (lo usan los scripts al terminar). */
export function close() {
  db.close();
}
