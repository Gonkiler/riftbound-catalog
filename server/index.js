import express from "express";
import { catalogJson, cardIds } from "./catalog.js";
import { getCollection, setCard, seedOnce, dbLocation } from "./db.js";
import { adminEnabled, checkPassword, issueCookie, clearCookie, isAdmin, requireAdmin } from "./auth.js";
import { getPrice } from "./prices.js";
import { cleanLangs, cleanCollection } from "./validate.js";
import { ownerName, renderIndex } from "./page.js";

const PORT = Number(process.env.PORT || 3000);
// Detrás de un proxy con HTTPS la cookie tiene que ser "secure". Render define RENDER=true.
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.RENDER === "true";
// Nombre que aparece en la cabecera y en la vista previa del enlace ("Colección de …").
const OWNER = ownerName();
const indexHtml = renderIndex(OWNER);

const app = express();
if (TRUST_PROXY) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get(["/", "/index.html"], (_req, res) => res.type("html").set("Cache-Control", "no-cache").send(indexHtml));
app.use(express.static("public", { index: false }));

// Express 4 no captura errores de funciones async: este envoltorio los pasa al manejador final.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/api/cards", (_req, res) => {
  res.type("json").set("Cache-Control", "public, max-age=3600").send(catalogJson);
});

// Huellas de imagen para el escáner (npm run fingerprints). Solo se pide al abrir el escáner.
app.get("/api/fingerprints", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600").sendFile("data/fingerprints.json", { root: process.cwd() }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "Faltan las huellas del escáner: ejecuta npm run fingerprints." });
  });
});

app.get("/api/collection", wrap(async (_req, res) => res.json(await getCollection())));

app.put("/api/collection/:cardId", requireAdmin, wrap(async (req, res) => {
  const { cardId } = req.params;
  if (!cardIds.has(cardId)) return res.status(404).json({ error: `No existe la carta ${cardId}.` });
  let langs;
  try {
    langs = cleanLangs(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  await setCard(cardId, langs);
  res.json({ ok: true });
}));

// Solo se llama al abrir la ficha de una carta.
app.get("/api/prices/:cardId", async (req, res) => {
  if (!cardIds.has(req.params.cardId)) return res.status(404).json({ error: "Carta desconocida." });
  try {
    res.json((await getPrice(req.params.cardId)) || { source: "none" });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "No se han podido obtener los precios." });
  }
});

app.get("/api/me", (req, res) => res.json({ admin: isAdmin(req), adminEnabled, owner: OWNER }));

app.post("/api/login", async (req, res) => {
  if (!adminEnabled) return res.status(503).json({ error: "El modo administrador no está configurado (falta ADMIN_PASSWORD)." });
  if (!checkPassword(req.body?.password)) {
    await new Promise((r) => setTimeout(r, 600)); // frena intentos repetidos
    return res.status(401).json({ error: "Contraseña incorrecta." });
  }
  issueCookie(res, req.secure);
  res.json({ admin: true });
});

app.post("/api/logout", (_req, res) => {
  clearCookie(res);
  res.json({ admin: false });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Ruta desconocida." }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error del servidor. Vuelve a intentarlo en un momento." });
});

const seeded = await seedOnce("data/seed/coleccion-inicial.json", (cards) => cleanCollection(cards).cards);
if (seeded) console.log(`Colección inicial cargada: ${seeded} cartas.`);

app.listen(PORT, () => {
  console.log(`Archivo Riftbound en http://localhost:${PORT} (colección en ${dbLocation})`);
  if (!adminEnabled) console.log("Aviso: sin ADMIN_PASSWORD la web es de solo lectura.");
  if (adminEnabled && !process.env.SESSION_SECRET) console.log("Aviso: sin SESSION_SECRET cada reinicio cierra la sesión.");
});
