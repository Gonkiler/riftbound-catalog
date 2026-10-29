// Acceso de administrador: una contraseña (ADMIN_PASSWORD) y una cookie firmada con HMAC.
// Sin contraseña configurada la web funciona en solo lectura.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PASSWORD = process.env.ADMIN_PASSWORD || "";
// Sin SESSION_SECRET se genera uno al arrancar: funciona, pero cada reinicio cierra la sesión.
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
const COOKIE = "rb_admin";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const adminEnabled = PASSWORD.length > 0;

function sign(value) {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function checkPassword(candidate) {
  return adminEnabled && typeof candidate === "string" && safeEqual(sign(candidate), sign(PASSWORD));
}

export function issueCookie(res, secure) {
  const expires = String(Date.now() + MAX_AGE_MS);
  res.cookie(COOKIE, `${expires}.${sign(expires)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    maxAge: MAX_AGE_MS,
  });
}

export function clearCookie(res) {
  res.clearCookie(COOKIE);
}

export function isAdmin(req) {
  if (!adminEnabled) return false;
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`));
  if (!raw) return false;
  const [expires, sig] = decodeURIComponent(raw.slice(COOKIE.length + 1)).split(".");
  if (!expires || !sig || !safeEqual(sig, sign(expires))) return false;
  return Number(expires) > Date.now();
}

export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: "Inicia sesión como administrador para cambiar la colección." });
}
