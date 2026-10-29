// Catálogo de cartas (data/cards.json) cargado una vez en memoria.
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));

export const catalogJson = JSON.stringify(raw);
export const cardIds = new Set(raw.cards.map((row) => row[0]));

// Idiomas que se pueden apuntar. `cm` es el id de idioma que usa Cardmarket en sus URLs (?language=).
export const LANGUAGES = {
  EN: { name: "Inglés", cm: 1 },
  FR: { name: "Francés", cm: 2 },
  DE: { name: "Alemán", cm: 3 },
  ES: { name: "Español", cm: 4 },
  IT: { name: "Italiano", cm: 5 },
  ZH: { name: "Chino", cm: 6 },
  JA: { name: "Japonés", cm: 7 },
  KO: { name: "Coreano", cm: 10 },
};
