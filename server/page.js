// HTML de la página con título y vista previa (Open Graph) según el nombre del dueño.
// Lo usan el servidor (server/index.js) y la versión estática (scripts/build-static.js).
import { readFileSync } from "node:fs";

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Nombre del dueño: OWNER_NAME o, si no está, `owner` de data/site.json. */
export function ownerName() {
  let fromFile = "";
  try {
    fromFile = JSON.parse(readFileSync(new URL("../data/site.json", import.meta.url), "utf8")).owner || "";
  } catch {}
  return String(process.env.OWNER_NAME || fromFile).trim().slice(0, 40);
}

export function renderIndex(owner) {
  const title = owner ? `Colección de ${owner} · Archivo Riftbound` : "Archivo Riftbound";
  const description = owner
    ? `Las cartas de Riftbound que tiene ${owner}: copias por idioma y acabado, repetidas y precios de Cardmarket.`
    : "Catálogo de cartas de Riftbound: copias por idioma y acabado, repetidas y precios de Cardmarket.";
  return readFileSync(new URL("../public/index.html", import.meta.url), "utf8")
    .replaceAll("%TITLE%", esc(title))
    .replaceAll("%DESCRIPTION%", esc(description));
}
