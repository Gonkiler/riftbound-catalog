// Colección guardada en SQLite (módulo node:sqlite, incluido en Node 22.13+; sin dependencias nativas).
// Una fila por carta e idioma con el número de copias normales, foil y promo.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "data/coleccion.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS copies (
    card_id    TEXT NOT NULL,
    lang       TEXT NOT NULL,
    normal     INTEGER NOT NULL DEFAULT 0,
    foil       INTEGER NOT NULL DEFAULT 0,
    promo      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (card_id, lang)
  );
`);

const selectAll = db.prepare("SELECT card_id, lang, normal, foil, promo FROM copies");
const deleteCard = db.prepare("DELETE FROM copies WHERE card_id = ?");
const insertRow = db.prepare(
  "INSERT INTO copies (card_id, lang, normal, foil, promo, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
);

/** Toda la colección: { cardId: { EN: { n, f, p }, ... } } */
export function getCollection() {
  const out = {};
  for (const r of selectAll.all()) {
    (out[r.card_id] ||= {})[r.lang] = { n: r.normal, f: r.foil, p: r.promo };
  }
  return out;
}

/** Sustituye las copias de una carta. `langs` = { EN: { n, f, p }, ... }; los idiomas a cero se borran. */
export function setCard(cardId, langs) {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    deleteCard.run(cardId);
    for (const [lang, v] of Object.entries(langs)) {
      if (v.n + v.f + v.p > 0) insertRow.run(cardId, lang, v.n, v.f, v.p, now);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
