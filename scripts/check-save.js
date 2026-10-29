// Comprueba el guardado en GitHub (modo GitHub Pages) contra un GitHub simulado que devuelve
// versiones atrasadas, corta la conexión y tiene commits de otro sitio. Lo ejecuta npm run check.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(process.argv[2] || "public/app.js", "utf8");
const code = src.slice(src.indexOf("/* ---------- datos: servidor propio o GitHub Pages"), src.indexOf("/* ---------- colección ---------- */"));

let versions = [{ sha: "s0", text: '{\n  "rad-046": {"EN":{"n":0,"f":1,"p":0}}\n}\n' }];
let staleReads = 0, dropNext = 0, foreignCommitBeforeNextPut = false, commits = [], gets = 0, puts = 0;
const cur = () => versions[versions.length - 1];
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const json = (status, body, headers = {}) => ({ ok: status < 300, status, json: async () => body, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
globalThis.localStorage = { m: { rb_github_token: "tok" }, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; }, removeItem(k) { delete this.m[k]; } };
globalThis.fetch = async (url, opts = {}) => {
  if (url === "static.json") return json(200, { repo: "G/r", branch: "main", owner: "X" });
  if (dropNext > 0) { dropNext--; throw new TypeError("Failed to fetch"); }
  if (url.endsWith("/repos/G/r")) return json(200, { permissions: { push: true } });
  if (url.includes("/contents/data/collection.json")) {
    if (!opts.method) {
      gets++;
      // Lectura "atrasada": devuelve la versión anterior, salvo con el parámetro único (_=...).
      const v = staleReads > 0 && !url.includes("&_=") && versions.length > 1 ? (staleReads--, versions[versions.length - 2]) : cur();
      return json(200, { sha: v.sha, content: b64(v.text) });
    }
    puts++;
    if (foreignCommitBeforeNextPut) {
      foreignCommitBeforeNextPut = false;
      const d = JSON.parse(cur().text); d["ogn-999"] = { ES: { n: 1, f: 0, p: 0 } };
      versions.push({ sha: "x" + versions.length, text: JSON.stringify(d) });
    }
    const body = JSON.parse(opts.body);
    if (body.sha !== cur().sha) return json(409, { message: `data/collection.json does not match ${body.sha}` });
    const text = Buffer.from(body.content, "base64").toString("utf8");
    versions.push({ sha: "s" + versions.length, text });
    staleReads = 3;
    commits.push(body.message);
    return json(200, { content: { sha: cur().sha } });
  }
  throw new Error("URL inesperada " + url);
};
const S = { byId: { a: { name: "A", code: "OGN-001" }, b: { name: "B", code: "OGN-002" }, c: { name: "C", code: "OGN-003" } }, owned: {} };
const { backend, setDelay } = new Function("S", "api", code.replace("const SAVE_DELAY_MS = 5000;", "let SAVE_DELAY_MS = 30;") + "; return { backend, setDelay: (v) => { SAVE_DELAY_MS = v; } };")(S, () => { throw new Error("sin api"); });
const real = setTimeout;
globalThis.setTimeout = (fn, ms) => real(fn, Math.min(ms, 40)); // acelera las esperas de los reintentos

await backend.load().catch(() => {});
// 1. Guardados seguidos con lecturas atrasadas: antes fallaba al 2.º o 3.º.
for (const [id, n] of [["a", 1], ["a", 2], ["b", 1], ["a", 3], ["c", 1]]) {
  await backend.saveCard(id, { EN: { n, f: 0, p: 0 } });
}
const final = JSON.parse(cur().text);
assert.deepEqual(final.a, { EN: { n: 3, f: 0, p: 0 } });
assert.deepEqual(final.b, { EN: { n: 1, f: 0, p: 0 } });
assert.deepEqual(final.c, { EN: { n: 1, f: 0, p: 0 } });
assert.deepEqual(final["rad-046"], { EN: { n: 0, f: 1, p: 0 } });
console.log(`✔ 5 guardados seguidos con lecturas atrasadas: ${commits.length} commits, ${gets} lecturas (sin conflictos)`);

// 2. Commit de otro sitio entre medias: conflicto → relee la versión buena y no pierde nada.
foreignCommitBeforeNextPut = true;
await backend.saveCard("b", { EN: { n: 5, f: 0, p: 0 } });
const f2 = JSON.parse(cur().text);
assert.deepEqual(f2.b, { EN: { n: 5, f: 0, p: 0 } });
assert.deepEqual(f2["ogn-999"], { ES: { n: 1, f: 0, p: 0 } }, "se ha perdido el commit de otro sitio");
console.log("✔ conflicto con otro commit (y lecturas atrasadas): se relee, se reintenta y se conservan los dos cambios");

// 3. Conexión cortada dos veces: reintenta y guarda.
dropNext = 2;
await backend.saveCard("c", { EN: { n: 2, f: 0, p: 0 } });
assert.deepEqual(JSON.parse(cur().text).c, { EN: { n: 2, f: 0, p: 0 } });
console.log("✔ conexión cortada 2 veces: se reintenta y se guarda");

// 4. Sin conexión de forma persistente: error claro (la interfaz lo reintentará más tarde).
dropNext = 99;
const err = await backend.saveCard("a", { EN: { n: 9, f: 0, p: 0 } }).catch((e) => e);
assert.equal(err.status, 0);
assert.match(err.message, /sin conexión/);
dropNext = 0;
console.log(`✔ sin conexión: error «${err.message}» (la web lo reintenta sola después)`);
console.log("Mensajes de commit:", commits.slice(0, 4).join(" | "));
