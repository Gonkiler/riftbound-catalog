import express from "express";
import { catalogJson, cardIds } from "./catalog.js";
import { getCollection, setCard } from "./db.js";
import { adminEnabled, checkPassword, issueCookie, clearCookie, isAdmin, requireAdmin } from "./auth.js";
import { getPrice } from "./prices.js";
import { cleanLangs } from "./validate.js";

const PORT = Number(process.env.PORT || 3000);
// Detrás de un proxy con HTTPS (Render, Railway, Fly...) pon TRUST_PROXY=1 para que la cookie sea "secure".
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

const app = express();
if (TRUST_PROXY) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static("public", { extensions: ["html"] }));

app.get("/api/cards", (_req, res) => {
  res.type("json").set("Cache-Control", "public, max-age=3600").send(catalogJson);
});

app.get("/api/collection", (_req, res) => res.json(getCollection()));

app.put("/api/collection/:cardId", requireAdmin, (req, res) => {
  const { cardId } = req.params;
  if (!cardIds.has(cardId)) return res.status(404).json({ error: `No existe la carta ${cardId}.` });
  let langs;
  try {
    langs = cleanLangs(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  setCard(cardId, langs);
  res.json({ ok: true });
});

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

app.get("/api/me", (req, res) => res.json({ admin: isAdmin(req), adminEnabled }));

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

app.listen(PORT, () => {
  console.log(`Archivo Riftbound en http://localhost:${PORT}`);
  if (!adminEnabled) console.log("Aviso: sin ADMIN_PASSWORD la web es de solo lectura.");
});
