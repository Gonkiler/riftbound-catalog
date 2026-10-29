// Archivo Riftbound: interfaz. Sin frameworks ni build.
// Funciona con el servidor propio (/api) o como web estática en GitHub Pages (ver "datos" abajo).
"use strict";

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(
  ["railSets", "railFoot", "head", "setPick", "setTitle", "stats", "q", "searchToggle", "filters", "rarChips", "scanBtn", "shareBtn", "copyBtn", "adminBtn",
   "notice", "grid", "sentinel", "bSets", "bScan", "bCopy", "bEdit", "bEditLabel", "scrim", "toast"].map((id) => [id, $(id)])
);

// Orden y nombres de idioma. `cm` = id de idioma en las URLs de Cardmarket (?language=).
const LANGS = [["EN", "Inglés", 1], ["FR", "Francés", 2], ["ZH", "Chino", 6], ["ES", "Español", 4], ["DE", "Alemán", 3], ["IT", "Italiano", 5], ["KO", "Coreano", 10], ["JA", "Japonés", 7]];
const LANG = Object.fromEntries(LANGS.map((l) => [l[0], { name: l[1], cm: l[2] }]));
const RAR = {
  Common: ["Común", "circle", "#8a90a0"],
  Uncommon: ["Infrecuente", "triangle", "#2f9a8a"],
  Rare: ["Rara", "diamond", "#3a74c9"],
  Epic: ["Épica", "pentagon", "#8a4fd0"],
  Showcase: ["Showcase", "hexagon", "#c9952a"],
  "Ultimate Rare": ["Ultimate", "star", "#d24a3a"],
};
const RAR_ORDER = Object.keys(RAR);
const DOM = { Fury: "--fury", Calm: "--calm", Mind: "--mind", Body: "--body", Chaos: "--chaos", Order: "--order", Colorless: "--colorless" };
const TYPE_ES = { Unit: "Unidad", Spell: "Hechizo", Gear: "Equipo", Battlefield: "Campo de batalla", Legend: "Leyenda", Rune: "Runa", Token: "Ficha" };

// Vista "todas las colecciones" (no es una colección real del catálogo).
const ALL = { id: "ALL", name: "Todas las colecciones", short: "Todas", slug: "todas" };
// Nombres de los filtros en la URL: #ogn?ver=repetidas&rareza=rare,epic&q=jinx&carta=ogn-001-298
const OWN_VIEWS = { all: "Todas", have: "Las tengo", miss: "Me faltan", dup: "Repetidas" };
const OWN_TO_URL = { have: "tengo", miss: "faltan", dup: "repetidas" };
const OWN_FROM_URL = Object.fromEntries(Object.entries(OWN_TO_URL).map(([k, v]) => [v, k]));
const rarSlug = (r) => r.split(" ")[0].toLowerCase();
const RAR_FROM_SLUG = Object.fromEntries(RAR_ORDER.map((r) => [rarSlug(r), r]));
const MOBILE = matchMedia("(max-width: 899px)");
const CHUNK = 60; // tarjetas que se pintan de cada vez al bajar

const S = {
  sets: [], cards: [], bySet: {}, byId: {},
  set: null, q: "", own: "all", rar: new Set(),
  owned: {},          // { cardId: { EN: { n, f, p } } }
  saving: {},         // cardId -> "pending" | "err"
  saveError: {},      // cardId -> motivo del último error al guardar
  admin: false,       // sesión iniciada (contraseña o token de GitHub)
  editing: false,     // modo edición activado
  adminEnabled: false,
  owner: "",
  prices: {},         // cardId -> precio o { failed: true }
  open: null,         // id de la carta abierta en la ficha
  list: [], shown: 0, // cuadrícula: cartas filtradas y cuántas hay pintadas
};

/* ---------- utilidades ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eur = (v) => (v == null ? "—" : v.toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
const findSet = (id) => (id === ALL.id ? ALL : S.sets.find((s) => s.id === id));

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Error ${res.status}`), { status: res.status });
  return body;
}

function rarSvg(r, s = 14) {
  const [, shape, col] = RAR[r] || RAR.Common;
  if (shape === "circle") return `<svg width="${s}" height="${s}" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="${col}"/></svg>`;
  const pts = {
    triangle: "5,1 9.3,8.8 0.7,8.8",
    diamond: "5,0.5 9.5,5 5,9.5 0.5,5",
    pentagon: "5,0.6 9.4,3.9 7.7,9.2 2.3,9.2 0.6,3.9",
    hexagon: "5,0.4 9,2.7 9,7.3 5,9.6 1,7.3 1,2.7",
    star: "5,0.3 6.3,3.6 9.8,3.8 7.1,6.1 8,9.6 5,7.6 2,9.6 2.9,6.1 0.2,3.8 3.7,3.6",
  }[shape];
  return `<svg width="${s}" height="${s}" viewBox="0 0 10 10" aria-hidden="true"><polygon points="${pts}" fill="${col}"/></svg>`;
}

// Imágenes: el CDN de Riot acepta ?w=…&auto=format y devuelve una versión reducida.
// Si una imagen falla, se prueba la original y, si tampoco carga, queda el marcador con el nombre.
const isRiot = (img) => img.includes("cmsassets.rgpub.io");
function imgAttrs(img, big) {
  if (!img) return "";
  if (big || !isRiot(img)) return `src="${esc(img)}"`;
  return `src="${esc(img)}?w=360&amp;auto=format" srcset="${esc(img)}?w=240&amp;auto=format 240w, ${esc(img)}?w=360&amp;auto=format 360w" sizes="(max-width: 600px) 33vw, 180px"`;
}
document.addEventListener("error", (ev) => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.full) return;
  if (img.srcset) { img.removeAttribute("srcset"); img.src = img.dataset.full; }
  else if (img.src !== img.dataset.full) img.src = img.dataset.full;
  else img.remove();
}, true);

let toastTimer;
function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    // Sin permiso de portapapeles (o sin HTTPS): se deja el texto a mano para copiarlo.
    window.prompt("Copia el texto:", text);
  }
}

/* ---------- datos: servidor propio o GitHub Pages ---------- */
// En GitHub Pages no hay /api. El build publica static.json y entonces:
// - el catálogo, la colección y los precios se leen de archivos en data/;
// - para editar se usa un token de GitHub (solo en este navegador) y cada cambio es un commit
//   en data/collection.json; GitHub Actions vuelve a publicar la web en 1-2 minutos.
let STATIC = null; // { repo: "usuario/repo", branch, owner } en modo estático
const TOKEN_KEY = "rb_github_token";
const token = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } },
  set(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch {} },
};
const COL_PATH = "data/collection.json";

async function getJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`No se ha podido cargar ${path} (${res.status})`);
  return res.json();
}

async function gh(path, opts = {}) {
  let res;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      ...opts,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.get()}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch {
    // Sin conexión, o el móvil cortó la petición (pantalla bloqueada…).
    throw Object.assign(new Error("sin conexión con GitHub"), { status: 0 });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Límite de peticiones de GitHub: dice cuánto esperar (Retry-After o la hora de reinicio).
    const hdr = (k) => res.headers?.get?.(k) ?? null;
    const after = Number(hdr("retry-after")) || (hdr("x-ratelimit-remaining") === "0" ? Math.max(1, Number(hdr("x-ratelimit-reset")) - Date.now() / 1000) : 0);
    throw Object.assign(new Error(body.message || `GitHub respondió ${res.status}`), { status: res.status, retryAfterMs: after ? after * 1000 : 0 });
  }
  return body;
}
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
function b64encode(s) {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}
// Una carta por línea y en orden, para que el historial de GitHub muestre cambios legibles.
function collectionFile(col) {
  const rows = [];
  for (const id of Object.keys(col).sort()) {
    const langs = Object.fromEntries(Object.entries(col[id] || {}).filter(([, v]) => (v.n || 0) + (v.f || 0) + (v.p || 0) > 0));
    if (Object.keys(langs).length) rows.push(`  ${JSON.stringify(id)}: ${JSON.stringify(langs)}`);
  }
  return `{\n${rows.join(",\n")}\n}\n`;
}
// La API de GitHub puede devolver unos segundos la versión anterior del archivo justo después de
// escribirlo (lo cachea hasta 60 s). Por eso se recuerda la última versión escrita (`ghKnown`) y se
// guarda sobre ella; solo se vuelve a leer si hay conflicto, y entonces con un parámetro único.
let ghKnown = null; // { sha, data }
async function ghReadCollection(fresh = false) {
  const bust = fresh ? `&_=${Date.now()}` : "";
  const f = await gh(`/repos/${STATIC.repo}/contents/${COL_PATH}?ref=${encodeURIComponent(STATIC.branch)}${bust}`);
  return { sha: f.sha, data: JSON.parse(b64decode(f.content)) };
}

// "Colección: Garen (OGS-013) +1 normal EN; Lux (OGS-014) −1 foil EN"
// Hay muchas cartas con el mismo nombre, así que va el número y el cambio exacto.
function commitMessage(before, batch) {
  const KIND = { n: "normal", f: "foil", p: "promo" };
  const parts = Object.entries(batch).map(([id, langs]) => {
    const c = S.byId[id];
    const label = c ? `${c.name} (${c.code.split("/")[0]})` : id;
    const old = before[id] || {};
    const deltas = [];
    for (const lang of new Set([...Object.keys(old), ...Object.keys(langs)])) {
      for (const k of ["n", "f", "p"]) {
        const d = (langs[lang]?.[k] || 0) - (old[lang]?.[k] || 0);
        if (d) deltas.push(`${d > 0 ? "+" : "−"}${Math.abs(d)} ${KIND[k]} ${lang}`);
      }
    }
    return `${label} ${deltas.join(", ") || "sin cambios"}`;
  });
  return `Colección: ${parts.slice(0, 4).join("; ")}${parts.length > 4 ? ` y ${parts.length - 4} más` : ""}`;
}

// Los cambios se juntan y se guardan en un solo commit cuando pasan 5 s sin tocar nada
// (cada commit vuelve a publicar la web, así el historial no se llena de commits sueltos).
const SAVE_DELAY_MS = 5000;
const ghQueue = { pending: {}, waiters: [], timer: null, running: false };
function ghSave(id, langs) {
  ghQueue.pending[id] = structuredClone(langs);
  return new Promise((resolve, reject) => {
    ghQueue.waiters.push({ resolve, reject });
    clearTimeout(ghQueue.timer);
    ghQueue.timer = setTimeout(ghFlush, SAVE_DELAY_MS);
  });
}
async function ghFlush() {
  if (ghQueue.running) { ghQueue.timer = setTimeout(ghFlush, 500); return; }
  const batch = ghQueue.pending, waiters = ghQueue.waiters;
  ghQueue.pending = {};
  ghQueue.waiters = [];
  if (!Object.keys(batch).length) { waiters.forEach((w) => w.resolve()); return; }
  ghQueue.running = true;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        // Primer intento: sobre la última versión que escribimos nosotros (si la hay).
        const base = attempt === 0 && ghKnown ? ghKnown : await ghReadCollection(attempt > 0);
        const data = structuredClone(base.data);
        const message = commitMessage(data, batch);
        Object.assign(data, batch);
        const content = collectionFile(data);
        const res = await gh(`/repos/${STATIC.repo}/contents/${COL_PATH}`, {
          method: "PUT",
          body: JSON.stringify({ message, content: b64encode(content), sha: base.sha, branch: STATIC.branch }),
        });
        ghKnown = res?.content?.sha ? { sha: res.content.sha, data: JSON.parse(content) } : null;
        break;
      } catch (err) {
        ghKnown = null;
        // Se reintenta si el archivo cambió entre medias (409/422), si GitHub falla o limita (5xx, 403/429
        // con espera) o si se cortó la conexión. Esperas crecientes: 1, 2, 4, 8 s.
        const retry = [409, 422, 429, 0].includes(err.status) || err.status >= 500 || (err.status === 403 && err.retryAfterMs);
        if (retry && attempt < 4) { await new Promise((r) => setTimeout(r, Math.min(60000, err.retryAfterMs || 1000 * 2 ** attempt))); continue; }
        throw err;
      }
    }
    waiters.forEach((w) => w.resolve());
  } catch (err) {
    waiters.forEach((w) => w.reject(err));
  } finally {
    ghQueue.running = false;
  }
}

const backend = {
  async load() {
    STATIC = await fetch("static.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!STATIC) {
      const [data, owned, me] = await Promise.all([api("api/cards"), api("api/collection"), api("api/me")]);
      return { data, owned, me };
    }
    const data = await getJson("data/cards.json");
    let owned = null, admin = false;
    if (token.get() && STATIC.repo) {
      // Con token se lee del repo: la copia publicada puede ir 1-2 minutos por detrás.
      try { owned = (await ghReadCollection()).data; admin = true; }
      catch (err) { if ([401, 403, 404].includes(err.status)) token.set(""); }
    }
    owned ||= await getJson(COL_PATH);
    return { data, owned, me: { admin, adminEnabled: Boolean(STATIC.repo), owner: STATIC.owner || "" } };
  },
  prices: null, // promesa de data/prices.json (modo estático)
  async price(id) {
    if (!STATIC) return api(`api/prices/${encodeURIComponent(id)}`);
    this.prices ||= getJson("data/prices.json").catch((err) => { this.prices = null; throw err; });
    return (await this.prices)[id] || { source: "none" };
  },
  async login(secret) {
    if (!STATIC) return api("api/login", { method: "POST", body: JSON.stringify({ password: secret }) });
    token.set(secret.trim());
    try {
      const repo = await gh(`/repos/${STATIC.repo}`);
      if (!repo.permissions?.push) throw new Error("Este token puede leer el repositorio pero no escribir en él. Dale el permiso «Contents: Read and write».");
      S.owned = (await ghReadCollection()).data;
    } catch (err) {
      token.set("");
      if (err.status === 401) throw new Error("GitHub no reconoce este token. Cópialo otra vez o crea uno nuevo.");
      if (err.status === 404 || err.status === 403) throw new Error(`El token no tiene acceso al repositorio ${STATIC.repo}.`);
      throw err;
    }
  },
  async logout() {
    if (!STATIC) return api("api/logout", { method: "POST" });
    token.set("");
  },
  saveCard(id, langs) {
    if (!STATIC) return api(`api/collection/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(langs) });
    return ghSave(id, langs);
  },
};

/* ---------- colección ---------- */
const entry = (c) => S.owned[c.id] || {};
function totals(c) {
  let n = 0, f = 0, p = 0;
  for (const v of Object.values(entry(c))) { n += v.n || 0; f += v.f || 0; p += v.p || 0; }
  return { n, f, p, all: n + f + p };
}
function setProgress(set) {
  const cs = S.bySet[set] || [];
  let have = 0, copies = 0, foil = 0, dup = 0;
  for (const c of cs) {
    const t = totals(c);
    if (t.all) { have++; copies += t.all; foil += t.f; }
    if (t.all > 1) dup++;
  }
  return { have, total: cs.length, copies, foil, dup };
}
/** "EN 2 normal + 1 foil, ES 1 promo" */
function langDetail(c) {
  const e = entry(c);
  return LANGS.filter(([l]) => e[l])
    .map(([l]) => {
      const v = e[l];
      const parts = [[v.n, "normal"], [v.f, "foil"], [v.p, "promo"]].filter(([x]) => x).map(([x, k]) => `${x} ${k}`);
      return parts.length ? `${l} ${parts.join(" + ")}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

/* ---------- URL: cada vista y cada carta tienen su enlace ---------- */
function viewHash() {
  const p = new URLSearchParams();
  if (S.own !== "all") p.set("ver", OWN_TO_URL[S.own]);
  if (S.rar.size) p.set("rareza", RAR_ORDER.filter((r) => S.rar.has(r)).map(rarSlug).join(","));
  if (S.q.trim()) p.set("q", S.q.trim());
  if (S.open) p.set("carta", S.open);
  const qs = p.toString();
  return `#${S.set === ALL.id ? ALL.slug : S.set.toLowerCase()}${qs ? `?${qs}` : ""}`;
}
// `push` crea una entrada en el historial (cambio de colección); el resto la sustituye.
function syncUrl(push = false) {
  const h = viewHash();
  if (h === location.hash) return;
  history[push ? "pushState" : "replaceState"](null, "", h);
}
function readHash() {
  const [path, qs = ""] = location.hash.slice(1).split("?");
  const p = new URLSearchParams(qs);
  const key = decodeURIComponent(path).toUpperCase();
  const card = S.byId[p.get("carta")] || null;
  let set = key === ALL.slug.toUpperCase() ? ALL.id : findSet(key)?.id;
  if (!set) set = card ? card.set : S.sets[0].id;
  return {
    set,
    own: OWN_FROM_URL[p.get("ver")] || "all",
    rar: (p.get("rareza") || "").split(",").map((s) => RAR_FROM_SLUG[s]).filter(Boolean),
    q: p.get("q") || "",
    card: card ? card.id : null,
  };
}

/* ---------- colecciones (barra lateral y hoja en el móvil) ---------- */
function setGroups() {
  return [
    { title: "Colecciones", sets: [ALL, ...S.sets.filter((s) => !s.nn)] },
    { title: "Promos Nexus Night", sets: S.sets.filter((s) => s.nn) },
  ];
}
function setListHtml() {
  return setGroups().map((g) => `<div class="setgroup"><h2>${esc(g.title)}</h2><ul>${g.sets.map((s) => {
    const p = setProgress(s.id);
    const pct = p.total ? (p.have / p.total) * 100 : 0;
    return `<li><button type="button" class="setbtn${s === ALL ? " allbtn" : ""}" data-set="${s.id}" aria-current="${S.set === s.id}"><span class="nm">${esc(s.short)}</span><span class="cd">${p.have}/${p.total}</span><span class="bar"><i style="width:${pct}%"></i></span></button></li>`;
  }).join("")}</ul></div>`).join("");
}
function footHtml() {
  const have = S.cards.filter((c) => totals(c).all).length;
  const links = [];
  if (S.admin) {
    links.push(STATIC
      ? `<a href="https://github.com/${esc(STATIC.repo)}/commits/${esc(STATIC.branch)}/${COL_PATH}" target="_blank" rel="noopener">Historial de cambios en GitHub ↗</a>`
      : `<a href="api/collection" download="coleccion-riftbound.json">Descargar copia de seguridad</a>`);
    links.push(`<button type="button" class="linkbtn" data-act="logout">Cerrar sesión</button>`);
  }
  return `<p>${have} de ${S.cards.length} cartas apuntadas</p>${links.map((l) => `<p>${l}</p>`).join("")}`;
}
function renderRail() {
  els.railSets.innerHTML = setListHtml();
  els.railFoot.innerHTML = footHtml();
}
function openSetSheet() {
  showSheet(`<div class="sheet setsheet" role="dialog" aria-modal="true" aria-labelledby="setsTitle">
    <div class="grab" aria-hidden="true"></div>
    <div class="sheethead"><h3 id="setsTitle">Colecciones</h3><button type="button" class="close" data-act="close" aria-label="Cerrar">×</button></div>
    <nav class="setnav">${setListHtml()}</nav>
    <div class="railfoot">${footHtml()}</div>
  </div>`);
  els.scrim.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center" });
}

/* ---------- cabecera ---------- */
function renderHead() {
  const set = findSet(S.set);
  if (!set) return;
  els.setTitle.innerHTML = set === ALL ? esc(set.name) : `${esc(set.short)}<span class="code">${esc(set.id)}</span>`;
  const p = setProgress(S.set);
  const pct = p.total ? Math.round((p.have / p.total) * 100) : 0;
  els.stats.innerHTML = `<span class="st"><b>${p.have}/${p.total}</b> distintas</span><span class="st"><b>${p.copies}</b> copias</span><span class="st"><b>${p.foil}</b> foil</span><span class="st"><b>${p.dup}</b> repetidas</span><span class="prog" title="${pct}% de la colección"><i style="width:${pct}%"></i></span>`;
  document.querySelectorAll("[data-own]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.own === S.own));
  if (els.q.value !== S.q) els.q.value = S.q;
  const pool = S.bySet[S.set] || [];
  const rs = RAR_ORDER.filter((r) => pool.some((c) => c.rarity === r));
  els.rarChips.innerHTML = rs.map((r) => `<button type="button" class="chip" data-rar="${r}" aria-pressed="${S.rar.has(r)}">${rarSvg(r, 12)}${RAR[r][0]}</button>`).join("");
  els.head.classList.toggle("searching", Boolean(S.q) || els.head.classList.contains("searchopen"));
}

function renderAdmin() {
  els.adminBtn.hidden = !S.adminEnabled;
  els.adminBtn.setAttribute("aria-pressed", S.editing);
  els.adminBtn.textContent = S.editing ? "Terminar edición" : "Editar";
  els.bEdit.hidden = !S.adminEnabled;
  els.bEdit.setAttribute("aria-pressed", S.editing);
  els.bEditLabel.textContent = S.editing ? "Terminar" : "Editar";
  document.body.classList.toggle("editing", S.editing);
  const owner = S.owner ? `Colección de ${S.owner}` : "Catálogo de cartas";
  document.querySelectorAll(".brandSub").forEach((el) => { el.textContent = el.classList.contains("mbrand") ? (S.owner ? `Colección de ${S.owner}` : "Archivo Riftbound") : owner; });
}

/* ---------- cuadrícula (se pinta por tandas al bajar) ---------- */
function artHtml(c, { big = false, extra = "" } = {}) {
  const d = c.domains.split("/").filter(Boolean);
  const d1 = `var(${DOM[d[0]] || "--colorless"})`, d2 = `var(${DOM[d[1] || d[0]] || "--colorless"})`;
  const img = c.img ? `<img ${imgAttrs(c.img, big)} data-full="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy" decoding="async">` : "";
  return `<div class="art" style="--d1:${d1};--d2:${d2}"><div class="ph"><span class="ty">${esc(TYPE_ES[c.type] || c.type)}</span><span><span class="pn">${esc(c.name)}</span>${c.sub ? `<br><span class="ps">${esc(c.sub)}</span>` : ""}</span></div>${img}<span class="rar" title="${esc(RAR[c.rarity]?.[0] || c.rarity)}">${rarSvg(c.rarity, big ? 16 : 12)}</span>${extra}</div>`;
}

function visible() {
  const q = S.q.trim().toLowerCase();
  return (S.bySet[S.set] || []).filter((c) => {
    if (S.rar.size && !S.rar.has(c.rarity)) return false;
    const t = totals(c).all;
    if (S.own === "have" && !t) return false;
    if (S.own === "miss" && t) return false;
    if (S.own === "dup" && t < 2) return false;
    if (q && !(c.name.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))) return false;
    return true;
  });
}

function emptyText() {
  if (S.q.trim() || S.rar.size) return "No hay cartas que coincidan con estos filtros.";
  if (S.own === "have") return S.admin ? "Todavía no has apuntado ninguna carta aquí. Pulsa «Editar» y abre una carta, o usa «Escanear»." : "Aún no hay ninguna carta apuntada aquí.";
  if (S.own === "dup") return "No hay cartas repetidas aquí.";
  if (S.own === "miss") return "¡Colección completa!";
  return "No hay cartas.";
}

function tileHtml(c) {
  const t = totals(c);
  const promo = c.tags.includes("promo") || c.tags.includes("nexus-night");
  const pills = [
    promo ? '<span class="pill promo">Promo</span>' : "",
    c.tags.includes("signed") ? '<span class="pill">Firma</span>' : "",
    c.tags.includes("alt") ? '<span class="pill">Alt</span>' : "",
    c.tags.includes("overnumbered") ? '<span class="pill">ON</span>' : "",
  ].join("");
  const extra = `<span class="pills">${pills}</span>${t.all ? `<span class="cnt${t.all > 1 ? " dup" : ""}">×${t.all}</span>` : ""}`;
  // "OGN-202-RELEASE/298" → "OGN-202" (la etiqueta Promo ya lo indica) y "#202" dentro de su colección.
  const code = c.code.split("/")[0].replace(/^([A-Z]+-[^-]+)-.+$/, "$1");
  const num = S.set === ALL.id ? code : code.replace(/^[A-Z]+-/, "#");
  const st = S.saving[c.id] ? ` data-saving="${S.saving[c.id]}"` : "";
  return `<button type="button" class="tile${t.all ? "" : " missing"}${t.f ? " foil" : ""}" data-id="${c.id}"${st} aria-label="${esc(c.name)} ${esc(c.code)}, ${t.all} copias">${artHtml(c, { extra })}<span class="meta"><span class="n">${esc(c.name)}</span><span class="c">${esc(num)}</span></span></button>`;
}

function renderGrid() {
  S.list = visible();
  S.shown = 0;
  els.grid.innerHTML = S.list.length ? "" : `<p class="empty">${esc(emptyText())}</p>`;
  appendTiles();
}
function appendTiles() {
  if (S.shown >= S.list.length) return;
  const next = S.list.slice(S.shown, S.shown + CHUNK);
  els.grid.insertAdjacentHTML("beforeend", next.map(tileHtml).join(""));
  S.shown += next.length;
  // Si el final sigue a la vista (pantalla grande), se pinta otra tanda.
  requestAnimationFrame(() => {
    if (els.sentinel.getBoundingClientRect().top < innerHeight + 800) appendTiles();
  });
}
new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) appendTiles(); }, { rootMargin: "800px 0px" }).observe(els.sentinel);

// Tras cambiar las copias de una carta: solo se repinta esa tarjeta y los contadores.
function refreshCard(id) {
  const tile = els.grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (tile) tile.outerHTML = tileHtml(S.byId[id]);
  renderHead();
  renderRail();
  if (S.open === id) renderSheet();
}

function render() { renderRail(); renderHead(); renderGrid(); renderAdmin(); if (S.open) renderSheet(); }

/* ---------- hojas (ficha, colecciones, login) ---------- */
function showSheet(html) {
  els.scrim.innerHTML = html;
  els.scrim.hidden = false;
  document.body.classList.add("modal");
}
function closeModal() {
  const wasCard = S.open;
  S.open = null;
  els.scrim.hidden = true;
  els.scrim.innerHTML = "";
  document.body.classList.remove("modal");
  if (wasCard) {
    syncUrl();
    els.grid.querySelector(`[data-id="${CSS.escape(wasCard)}"]`)?.focus({ preventScroll: true });
  }
}

function openCard(id) {
  S.open = id;
  renderSheet(true);
  syncUrl();
  if (!S.prices[id]) {
    backend.price(id)
      .then((p) => { S.prices[id] = p; })
      .catch(() => { S.prices[id] = { failed: true }; })
      .finally(() => { if (S.open === id) renderSheet(); });
  }
}

function priceBlock(c) {
  const p = S.prices[c.id];
  if (!p) return `<p class="small">Cargando precios de Cardmarket…</p>`;
  if (p.failed) return `<p class="small">No se han podido cargar los precios.</p>`;
  if (p.source === "none") return `<p class="small">Cardmarket no tiene esta carta.</p>`;
  const date = p.date ? new Date(p.date).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "";
  const note = p.source === "snapshot" ? "Precio guardado (no se ha podido descargar la guía de hoy)" : "Guía de precios de Cardmarket";
  return `<div class="prices"><div class="pbox"><span>Tendencia</span><b>${eur(p.trend)}</b></div><div class="pbox"><span>Media 30 días</span><b>${eur(p.avg30)}</b></div><div class="pbox"><span>Desde</span><b>${eur(p.low)}</b></div><div class="pbox"><span>Foil tendencia</span><b>${eur(p.foilTrend)}</b></div></div>
  <p class="small">${note}${date ? ` del ${date}` : ""}. Es un precio por producto que mezcla todos los idiomas; para el precio de un idioma concreto usa los enlaces de la tabla.${p.url ? ` <a class="ext" href="${esc(p.url)}" target="_blank" rel="noopener">Abrir en Cardmarket ↗</a>` : ""}</p>`;
}

function langUrl(c, code) {
  const p = S.prices[c.id];
  if (!p || !p.url) return null;
  const u = new URL(p.url);
  u.searchParams.set("language", LANG[code].cm);
  return u.href;
}

function stepper(lang, k, v) {
  const what = `${k === "n" ? "normal" : k === "f" ? "foil" : "promo"} ${LANG[lang].name}`;
  if (!S.editing) return `<span class="${v ? "" : "zero"}">${v}</span>`;
  return `<span class="step"><button type="button" data-step="-1" data-k="${k}" data-l="${lang}" aria-label="Quitar ${what}" ${v ? "" : "disabled"}>−</button><output>${v}</output><button type="button" data-step="1" data-k="${k}" data-l="${lang}" aria-label="Añadir ${what}">+</button></span>`;
}

function saveMsg(id) {
  if (S.saving[id] === "err") return `No se ha podido guardar${S.saveError[id] ? ` (${S.saveError[id]})` : ""}. Se reintentará solo; no cierres la página.`;
  return S.saving[id] ? "Guardando…" : "";
}

function renderSheet(first = false) {
  const c = S.byId[S.open];
  if (!c) return;
  const set = findSet(c.set);
  const e = entry(c);
  let langs = Object.keys(e).filter((l) => LANG[l]);
  if (S.editing && !langs.length) langs = ["EN"];
  langs.sort((a, b) => LANGS.findIndex((x) => x[0] === a) - LANGS.findIndex((x) => x[0] === b));
  const rows = langs.map((l) => {
    const v = e[l] || {};
    const u = langUrl(c, l);
    return `<tr><td>${LANG[l].name}</td><td>${stepper(l, "n", v.n || 0)}</td><td>${stepper(l, "f", v.f || 0)}</td><td>${stepper(l, "p", v.p || 0)}</td><td class="lk">${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${l} ↗</a>` : ""}</td></tr>`;
  }).join("");
  const free = LANGS.filter((l) => !langs.includes(l[0]));
  const i = S.list.findIndex((x) => x.id === c.id);
  const t = totals(c);
  const whose = S.admin ? "Mis copias" : S.owner ? `Copias de ${esc(S.owner)}` : "Copias";
  const scroll = els.scrim.querySelector(".sheet")?.scrollTop || 0;

  showSheet(`<div class="sheet cardsheet" role="dialog" aria-modal="true" aria-labelledby="cardName">
   <div class="grab" aria-hidden="true"></div>
   <button type="button" class="close" data-act="close" id="closeBtn" aria-label="Cerrar">×</button>
   <div class="artwrap">${artHtml(c, { big: true })}
     <div class="navrow"><button type="button" data-act="prev" ${i <= 0 ? "disabled" : ""} aria-label="Carta anterior">←</button><button type="button" data-act="shareCard" title="Enlace directo a esta carta">Compartir</button><button type="button" data-act="next" ${i < 0 || i >= S.list.length - 1 ? "disabled" : ""} aria-label="Carta siguiente">→</button></div>
     ${c.img ? `<a class="fullimg" href="${esc(c.img)}" target="_blank" rel="noopener">Imagen a tamaño completo ↗</a>` : ""}</div>
   <div class="info">
    <h3 id="cardName">${esc(c.name)}</h3>${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ""}
    <div class="facts"><div><span>Número</span> ${esc(c.code)}</div><div><span>Colección</span> ${esc(set.name)}</div><div><span>Rareza</span> ${rarSvg(c.rarity, 12)} ${esc(RAR[c.rarity]?.[0] || c.rarity)}</div><div><span>Tipo</span> ${esc(TYPE_ES[c.type] || c.type)}</div></div>
    <div class="sec"><h4>${whose} por idioma${t.all ? ` · ${t.all} en total` : ""}</h4>
     ${langs.length ? `<table class="langs"><thead><tr><th>Idioma</th><th>Normal</th><th>Foil</th><th>Promo</th><th><span class="sr">Precio</span></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="small">No está apuntada en ningún idioma.${S.admin && !S.editing ? " Pulsa «Editar» para apuntarla." : ""}</p>`}
     ${S.editing && free.length ? `<div class="addlang"><select id="langSel" aria-label="Idioma">${free.map((l) => `<option value="${l[0]}">${l[1]}</option>`).join("")}</select><button type="button" data-act="addLang">Añadir idioma</button></div>` : ""}
     ${S.adminEnabled && !S.editing ? `<button type="button" class="editcta" data-act="edit">${S.admin ? "Editar copias" : "Entrar para editar"}</button>` : ""}
     <div class="save${S.saving[c.id] === "err" ? " err" : ""}" aria-live="polite">${saveMsg(c.id)}</div>
    </div>
    <div class="sec"><h4>Precio en Cardmarket</h4>${priceBlock(c)}</div>
   </div></div>`);
  const sheet = els.scrim.querySelector(".sheet");
  if (first) $("closeBtn").focus({ preventScroll: true });
  else sheet.scrollTop = scroll;
}

function navCard(d) {
  const i = S.list.findIndex((x) => x.id === S.open);
  const n = S.list[i + d];
  if (n) openCard(n.id);
}

/* ---------- compartir ---------- */
async function shareLink(url, title) {
  // En móvil, el menú de compartir del sistema (WhatsApp, Telegram…); en escritorio, copiar.
  if (navigator.share && matchMedia("(pointer:coarse)").matches) {
    try { await navigator.share({ title, url }); return; } catch (err) { if (err.name === "AbortError") return; }
  }
  copyText(url, "Enlace copiado");
}

function listText() {
  const set = findSet(S.set);
  const list = visible();
  const who = S.owner ? `Colección de ${S.owner}` : "Archivo Riftbound";
  const filters = [set.name, OWN_VIEWS[S.own]];
  if (S.rar.size) filters.push(RAR_ORDER.filter((r) => S.rar.has(r)).map((r) => RAR[r][0]).join(", "));
  if (S.q.trim()) filters.push(`«${S.q.trim()}»`);
  const lines = list.map((c) => {
    const t = totals(c);
    let s = `${c.code} ${c.name}${c.sub ? ` (${c.sub})` : ""}`;
    if (S.own === "dup") s += ` — ${t.all - 1} de sobra (${langDetail(c)})`;
    else if (t.all && S.own !== "miss") s += ` — ×${t.all} (${langDetail(c)})`;
    return s;
  });
  return [`${who} — ${filters.join(" · ")}: ${list.length} cartas`, "", ...lines, "", location.href].join("\n");
}
function copyList() {
  const n = visible().length;
  if (!n) { toast("No hay cartas en esta vista"); return; }
  copyText(listText(), `Lista copiada (${n} cartas)`);
}

/* ---------- login ---------- */
let afterLogin = null;
function openLogin(then = null) {
  afterLogin = then;
  S.open = null;
  const field = STATIC
    ? `<p class="small">En GitHub Pages se edita con un token de GitHub que solo pueda escribir en <b>${esc(STATIC.repo)}</b>. Se guarda únicamente en este navegador.</p>
    <ol class="small steps">
      <li>Abre <a class="ext" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → nuevo token (fine-grained) ↗</a>.</li>
      <li>En <i>Repository access</i> elige <i>Only select repositories</i> → <b>${esc(STATIC.repo.split("/")[1] || STATIC.repo)}</b>.</li>
      <li>En <i>Permissions</i> → <i>Contents</i> elige <i>Read and write</i>. Genera el token y pégalo aquí.</li>
    </ol>
    <label for="pw">Token de GitHub</label>
    <input id="pw" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required>`
    : `<p class="small">Solo quien tiene la contraseña puede cambiar las copias. Los demás ven la colección en modo lectura.</p>
    <label for="pw">Contraseña</label>
    <input id="pw" type="password" autocomplete="current-password" required>`;
  showSheet(`<form class="sheet login" id="loginForm" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
    <div class="grab" aria-hidden="true"></div>
    <h3 id="loginTitle">Editar la colección</h3>
    ${field}
    <div class="err" id="loginErr" aria-live="polite"></div>
    <div class="row"><button type="button" data-act="close">Cancelar</button><button type="submit" class="primary">Entrar</button></div>
  </form>`);
  $("pw").focus();
}

async function submitLogin(ev) {
  ev.preventDefault();
  try {
    $("loginErr").textContent = "Comprobando…";
    await backend.login($("pw").value);
    S.admin = true;
    S.editing = true;
    closeModal();
    render();
    const then = afterLogin;
    afterLogin = null;
    if (then) then();
  } catch (err) {
    $("loginErr").textContent = err.message;
  }
}

function toggleEdit() {
  if (!S.admin) { openLogin(S.open ? ((id) => () => openCard(id))(S.open) : null); return; }
  S.editing = !S.editing;
  renderAdmin();
  if (S.open) renderSheet();
}

function logout() {
  backend.logout().finally(() => { S.admin = false; S.editing = false; closeModal(); render(); });
}

/* ---------- edición ---------- */
const timers = {}, versions = {}, inFlight = {}, retries = {};

function change(id, mutate) {
  const e = structuredClone(S.owned[id] || {});
  mutate(e);
  S.owned[id] = e;
  S.saving[id] = "pending";
  versions[id] = (versions[id] || 0) + 1;
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => save(id), 500);
  refreshCard(id);
}

async function save(id) {
  if (inFlight[id]) { timers[id] = setTimeout(() => save(id), 300); return; }
  inFlight[id] = true;
  const v0 = versions[id];
  try {
    await backend.saveCard(id, S.owned[id] || {});
    if (versions[id] === v0) delete S.saving[id];
    if (STATIC && !S.toldDeploy) { S.toldDeploy = true; toast("Guardado en GitHub. Los demás lo verán en 1–2 minutos."); }
    retries[id] = 0;
    delete S.saveError[id];
  } catch (err) {
    console.error("Error al guardar", id, err);
    S.saving[id] = "err";
    S.saveError[id] = err.message;
    if (err.status === 401) { if (STATIC) token.set(""); S.admin = false; S.editing = false; showNotice("La sesión ha caducado. Vuelve a entrar para editar."); renderAdmin(); }
    else if (err.status === 403 && !err.retryAfterMs) toast(`No se ha podido guardar: el token no tiene permiso para escribir (${err.message})`);
    else {
      // El cambio no se pierde: se vuelve a intentar solo, cada vez más espaciado.
      retries[id] = (retries[id] || 0) + 1;
      const wait = Math.min(120000, 10000 * 2 ** (retries[id] - 1));
      timers[id] = setTimeout(() => { if (S.saving[id] === "err") save(id); }, wait);
      if (retries[id] === 1) toast(`No se ha podido guardar (${err.message}). Se reintentará solo.`);
    }
  } finally {
    inFlight[id] = false;
    refreshCard(id);
  }
}

function bump(id, lang, k, d) {
  change(id, (e) => {
    const v = { n: 0, f: 0, p: 0, ...(e[lang] || {}) };
    v[k] = Math.max(0, v[k] + d);
    e[lang] = v;
  });
}

function addLang(id, lang) {
  // Solo visual hasta que se sume una copia: un idioma a cero no se guarda.
  S.owned[id] = { ...(S.owned[id] || {}), [lang]: { n: 0, f: 0, p: 0 } };
  renderSheet();
}

function showNotice(t) { els.notice.textContent = t; els.notice.hidden = !t; }

/* ---------- escáner (se carga al abrirlo) ---------- */
async function openScan() {
  let mod;
  try { mod = await import("./scanner.js"); }
  catch (err) { toast("No se ha podido abrir el escáner"); console.error(err); return; }
  closeModal();
  mod.openScanner({
    cards: S.cards,
    byId: S.byId,
    fingerprintsUrl: STATIC ? "data/fingerprints.json" : "api/fingerprints",
    setName: (id) => findSet(id)?.name || id,
    canEdit: () => S.admin,
    onLogin: () => openLogin(openScan),
    openCard,
    async onAdd(id, lang, finish, delta = 1) {
      if (!S.editing) { S.editing = true; renderAdmin(); }
      bump(id, lang, finish, delta);
    },
  });
}

/* ---------- eventos ---------- */
function setSearchOpen(open) {
  els.head.classList.toggle("searchopen", open);
  els.searchToggle.setAttribute("aria-pressed", open);
  renderHead();
  if (open) els.q.focus();
}

document.addEventListener("click", (ev) => {
  const t = ev.target;
  const sb = t.closest(".setbtn");
  if (sb) {
    if (S.set !== sb.dataset.set) { S.set = sb.dataset.set; S.rar.clear(); scrollTo({ top: 0 }); }
    if (!els.scrim.hidden) closeModal();
    syncUrl(true);
    render();
    return;
  }
  const tile = t.closest(".tile");
  if (tile) { openCard(tile.dataset.id); return; }
  const og = t.closest("[data-own]");
  if (og) { S.own = og.dataset.own; syncUrl(); renderHead(); renderGrid(); return; }
  const rc = t.closest("[data-rar]");
  if (rc) { const r = rc.dataset.rar; S.rar.has(r) ? S.rar.delete(r) : S.rar.add(r); syncUrl(); renderHead(); renderGrid(); return; }
  if (t.closest("#setPick") && MOBILE.matches) { openSetSheet(); return; }
  if (t.closest("#bSets")) { openSetSheet(); return; }
  if (t.closest("#searchToggle")) { setSearchOpen(!els.head.classList.contains("searchopen")); return; }
  if (t.closest("#shareBtn")) { shareLink(location.href, document.title); return; }
  if (t.closest("#copyBtn") || t.closest("#bCopy")) { copyList(); return; }
  if (t.closest("#scanBtn") || t.closest("#bScan")) { openScan(); return; }
  if (t.closest("#adminBtn") || t.closest("#bEdit")) { toggleEdit(); return; }
  const act = t.closest("[data-act]")?.dataset.act;
  if (act === "close" || t === els.scrim) { closeModal(); return; }
  if (act === "logout") { logout(); return; }
  if (act === "edit") { toggleEdit(); return; }
  if (act === "shareCard") { const c = S.byId[S.open]; shareLink(location.href, `${c.name} · ${document.title}`); return; }
  if (act === "prev") { navCard(-1); return; }
  if (act === "next") { navCard(1); return; }
  if (act === "addLang") { addLang(S.open, $("langSel").value); return; }
  const st = t.closest("[data-step]");
  if (st && S.open) bump(S.open, st.dataset.l, st.dataset.k, Number(st.dataset.step));
});
document.addEventListener("submit", (ev) => { if (ev.target.id === "loginForm") submitLogin(ev); });
document.addEventListener("keydown", (ev) => {
  if (document.querySelector(".scanner")) return;
  if (els.scrim.hidden) {
    // "/" enfoca el buscador, como en muchas webs.
    if (ev.key === "/" && document.activeElement !== els.q && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); if (MOBILE.matches) setSearchOpen(true); else els.q.focus(); }
    return;
  }
  if (ev.key === "Escape") closeModal();
  else if (S.open && ev.key === "ArrowRight") navCard(1);
  else if (S.open && ev.key === "ArrowLeft") navCard(-1);
});
els.q.addEventListener("input", () => { S.q = els.q.value; syncUrl(); renderGrid(); });
els.q.addEventListener("keydown", (ev) => { if (ev.key === "Enter") els.q.blur(); });

// En el móvil, deslizar la hoja hacia abajo desde el asa la cierra.
let drag = null;
els.scrim.addEventListener("touchstart", (ev) => {
  const sheet = ev.target.closest(".sheet");
  if (!sheet || !MOBILE.matches || sheet.scrollTop > 0) return;
  drag = { sheet, y: ev.touches[0].clientY, dy: 0 };
}, { passive: true });
els.scrim.addEventListener("touchmove", (ev) => {
  if (!drag) return;
  drag.dy = Math.max(0, ev.touches[0].clientY - drag.y);
  if (drag.dy > 4) drag.sheet.style.transform = `translateY(${drag.dy}px)`;
}, { passive: true });
els.scrim.addEventListener("touchend", () => {
  if (!drag) return;
  const { sheet, dy } = drag;
  drag = null;
  if (dy > 110) closeModal();
  else sheet.style.transform = "";
});

// Lee la URL y deja la página como dice (al cargar, al pegar un enlace o con atrás/adelante).
function route() {
  const v = readHash();
  if (S.set !== v.set) scrollTo({ top: 0 });
  S.set = v.set;
  S.own = v.own;
  S.rar = new Set(v.rar);
  S.q = v.q;
  render();
  if (v.card && v.card !== S.open) openCard(v.card);
  else if (!v.card && S.open) closeModal();
  syncUrl(); // normaliza la URL (p. ej. sin colección → la primera)
}
addEventListener("popstate", route);
addEventListener("hashchange", route);
// Si se cierra la pestaña con cambios aún sin guardar, el navegador pregunta antes.
// Al recuperar la conexión, se reintentan en el acto los cambios que no se pudieron guardar.
addEventListener("online", () => {
  for (const [id, st] of Object.entries(S.saving)) if (st === "err") { clearTimeout(timers[id]); save(id); }
});
addEventListener("beforeunload", (ev) => {
  if (Object.values(S.saving).some((st) => st === "pending" || st === "err")) ev.preventDefault();
});

/* ---------- arranque ---------- */
(async () => {
  try {
    const { data, owned, me } = await backend.load();
    S.sets = data.sets.map((s) => {
      const nn = s.id.endsWith("-NN");
      return { ...s, nn, short: nn ? s.name.split("|")[0].trim() : s.name };
    });
    S.cards = data.cards.map((row) => Object.fromEntries(data.cols.map((k, i) => [k, row[i]])));
    for (const c of S.cards) { (S.bySet[c.set] ||= []).push(c); S.byId[c.id] = c; }
    S.bySet[ALL.id] = S.cards;
    S.owned = owned;
    S.admin = me.admin;
    S.adminEnabled = me.adminEnabled;
    S.owner = me.owner || "";
    route();
  } catch (err) {
    els.setTitle.textContent = "No se han podido cargar las cartas";
    showNotice(`${err.message}. Si la web llevaba un rato sin visitas puede estar arrancando: recarga en unos segundos.`);
  }
})();
