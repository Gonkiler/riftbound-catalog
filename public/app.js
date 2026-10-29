// Archivo Riftbound: interfaz. Sin frameworks ni build; habla con la API de server/index.js.
"use strict";

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(
  ["mainSets", "nnSets", "railFoot", "brandSub", "mBrand", "main", "head", "setTitle", "stUnique", "stCopies", "stFoil", "stDup", "q", "rarChips", "adminBtn", "logoutBtn", "shareBtn", "copyBtn", "notice", "grid", "scrim", "toast"].map((id) => [id, $(id)])
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

const S = {
  sets: [], cards: [], bySet: {}, byId: {},
  set: null, q: "", own: "all", rar: new Set(),
  owned: {},          // { cardId: { EN: { n, f, p } } }
  saving: {},         // cardId -> "pending" | "err"
  admin: false,       // sesión iniciada como administrador
  editing: false,     // modo edición activado
  adminEnabled: false,
  owner: "",
  prices: {},         // cardId -> respuesta de /api/prices o { failed: true }
  open: null,         // id de la carta abierta en la ficha
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

// Las imágenes oficiales son PNG de 744×1039. El CDN de Riot acepta ?w=…&auto=format y
// devuelve una versión reducida (~1/3 del peso). Si una imagen falla, se prueba la original
// y, si tampoco carga, se quita y queda el marcador con el nombre.
const thumbUrl = (img) => (img ? `${img}?w=360&auto=format` : "");
document.addEventListener("error", (ev) => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.full) return;
  if (img.src !== img.dataset.full) img.src = img.dataset.full;
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
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.get()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || `GitHub respondió ${res.status}`), { status: res.status });
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
async function ghReadCollection() {
  const f = await gh(`/repos/${STATIC.repo}/contents/${COL_PATH}?ref=${encodeURIComponent(STATIC.branch)}`);
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
      const { sha, data } = await ghReadCollection();
      const message = commitMessage(data, batch);
      Object.assign(data, batch);
      try {
        await gh(`/repos/${STATIC.repo}/contents/${COL_PATH}`, {
          method: "PUT",
          body: JSON.stringify({ message, content: b64encode(collectionFile(data)), sha, branch: STATIC.branch }),
        });
        break;
      } catch (err) {
        // 409/422: el archivo cambió entre medias (otro commit). Se vuelve a leer y se reintenta.
        if ((err.status === 409 || err.status === 422) && attempt < 2) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
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

/* ---------- render ---------- */
function renderRail() {
  const li = (s) => {
    const p = setProgress(s.id);
    return `<li><button type="button" class="setbtn${s === ALL ? " allbtn" : ""}" data-set="${s.id}" aria-current="${S.set === s.id}"><span class="nm">${esc(s.short)}</span><span class="cd">${p.have}/${p.total}</span><span class="bar"><i style="width:${p.total ? (p.have / p.total) * 100 : 0}%"></i></span></button></li>`;
  };
  els.mainSets.innerHTML = [ALL, ...S.sets.filter((s) => !s.nn)].map(li).join("");
  els.nnSets.innerHTML = S.sets.filter((s) => s.nn).map(li).join("");
  const cur = els.mainSets.querySelector('[aria-current="true"]') || els.nnSets.querySelector('[aria-current="true"]');
  // En móvil la barra es horizontal: que la colección activa quede a la vista.
  if (cur && matchMedia("(max-width:760px)").matches) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function artHtml(c, { big = false, extra = "" } = {}) {
  const d = c.domains.split("/").filter(Boolean);
  const d1 = `var(${DOM[d[0]] || "--colorless"})`, d2 = `var(${DOM[d[1] || d[0]] || "--colorless"})`;
  const img = c.img ? `<img src="${esc(big ? c.img : thumbUrl(c.img))}" data-full="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy" decoding="async">` : "";
  return `<div class="art" style="--d1:${d1};--d2:${d2}"><div class="ph"><span class="ty">${esc(TYPE_ES[c.type] || c.type)}</span><span><span class="pn">${esc(c.name)}</span>${c.sub ? `<br><span class="ps">${esc(c.sub)}</span>` : ""}</span></div>${img}<span class="rar" title="${esc(RAR[c.rarity]?.[0] || c.rarity)}">${rarSvg(c.rarity, big ? 16 : 13)}</span>${extra}</div>`;
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
  if (S.own === "have") return S.admin ? "Todavía no has marcado ninguna carta aquí. Pulsa «Editar» y abre una carta para apuntar tus copias." : "Aún no hay ninguna carta apuntada aquí.";
  if (S.own === "dup") return "No hay cartas repetidas aquí.";
  if (S.own === "miss") return "¡Colección completa!";
  return "No hay cartas.";
}

function renderControls() {
  document.querySelectorAll("[data-own]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.own === S.own));
  if (els.q.value !== S.q) els.q.value = S.q;
}

function renderGrid() {
  const set = findSet(S.set);
  if (!set) return;
  els.setTitle.innerHTML = `${esc(set.short === ALL.short ? set.name : set.short)}${set === ALL ? "" : `<span>${esc(set.id)}</span>`}`;
  const p = setProgress(S.set);
  els.stUnique.textContent = `${p.have} / ${p.total}`;
  els.stCopies.textContent = p.copies;
  els.stFoil.textContent = p.foil;
  els.stDup.textContent = p.dup;
  const pool = S.bySet[S.set] || [];
  const rs = RAR_ORDER.filter((r) => pool.some((c) => c.rarity === r));
  els.rarChips.innerHTML = rs.map((r) => `<button type="button" class="chip" data-rar="${r}" aria-pressed="${S.rar.has(r)}">${rarSvg(r, 12)}${RAR[r][0]}</button>`).join("");

  const list = visible();
  if (!list.length) {
    els.grid.innerHTML = `<p class="empty">${esc(emptyText())}</p>`;
    return;
  }
  const showSet = S.set === ALL.id;
  els.grid.innerHTML = list.map((c) => {
    const t = totals(c);
    const promo = c.tags.includes("promo") || c.tags.includes("nexus-night");
    const pills = [
      promo ? '<span class="pill promo">Promo</span>' : "",
      c.tags.includes("signed") ? '<span class="pill">Firma</span>' : "",
      c.tags.includes("alt") ? '<span class="pill">Alt</span>' : "",
      c.tags.includes("overnumbered") ? '<span class="pill">ON</span>' : "",
    ].join("");
    const extra = `<span class="pills">${pills}</span>${t.all ? `<span class="cnt${t.all > 1 ? " dup" : ""}">×${t.all}</span>` : ""}`;
    const code = c.code.split("/")[0];
    const num = showSet ? code : code.replace(/^[A-Z]+-/, "#");
    const st = S.saving[c.id] ? ` data-saving="${S.saving[c.id]}"` : "";
    return `<button type="button" class="tile${t.all ? "" : " missing"}${t.f ? " foil" : ""}" data-id="${c.id}"${st} aria-label="${esc(c.name)} ${esc(c.code)}, ${t.all} copias">${artHtml(c, { extra })}<span class="meta"><span class="n">${esc(c.name)}</span><span class="c">${esc(num)}</span></span></button>`;
  }).join("");
}

function renderAdmin() {
  els.adminBtn.hidden = !S.adminEnabled;
  els.adminBtn.setAttribute("aria-pressed", S.editing);
  els.adminBtn.textContent = S.editing ? "Terminar edición" : "Editar";
  els.logoutBtn.hidden = !S.admin;
  els.head.classList.toggle("editing", S.editing);
  const owner = S.owner ? `Colección de ${S.owner}` : "Catálogo de cartas";
  els.brandSub.textContent = owner;
  els.mBrand.textContent = S.owner ? `Archivo Riftbound · ${owner}` : "Archivo Riftbound";
  const total = S.cards.length;
  const have = S.cards.filter((c) => totals(c).all).length;
  els.railFoot.innerHTML = `${have} de ${total} cartas apuntadas${!S.admin ? "" : STATIC
    ? `<br><a href="https://github.com/${esc(STATIC.repo)}/commits/${esc(STATIC.branch)}/${COL_PATH}" target="_blank" rel="noopener">Historial de cambios en GitHub ↗</a>`
    : `<br><a href="api/collection" download="coleccion-riftbound.json">Descargar copia de seguridad</a>`}`;
}

function render() { renderRail(); renderControls(); renderGrid(); renderAdmin(); if (S.open) renderSheet(); }

/* ---------- ficha de carta ---------- */
function openCard(id) {
  S.open = id;
  els.scrim.hidden = false;
  document.body.classList.add("modal");
  renderSheet(true);
  syncUrl();
  if (!S.prices[id]) {
    backend.price(id)
      .then((p) => { S.prices[id] = p; })
      .catch(() => { S.prices[id] = { failed: true }; })
      .finally(() => { if (S.open === id) renderSheet(); });
  }
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
  return p && p.url ? `${p.url}?language=${LANG[code].cm}` : null;
}

function stepper(lang, k, v) {
  if (!S.editing) return `<span class="${v ? "" : "zero"}">${v}</span>`;
  return `<span class="step"><button type="button" data-step="-1" data-k="${k}" data-l="${lang}" aria-label="Quitar ${k === "n" ? "normal" : k === "f" ? "foil" : "promo"} ${LANG[lang].name}" ${v ? "" : "disabled"}>−</button><output>${v}</output><button type="button" data-step="1" data-k="${k}" data-l="${lang}" aria-label="Añadir ${k === "n" ? "normal" : k === "f" ? "foil" : "promo"} ${LANG[lang].name}">+</button></span>`;
}

function saveMsg(id) {
  return S.saving[id] === "err" ? "No se ha podido guardar. Vuelve a intentarlo." : S.saving[id] ? "Guardando…" : "";
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
    return `<tr><td>${LANG[l].name}</td><td>${stepper(l, "n", v.n || 0)}</td><td>${stepper(l, "f", v.f || 0)}</td><td>${stepper(l, "p", v.p || 0)}</td><td class="lk">${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">Precio ${l} ↗</a>` : ""}</td></tr>`;
  }).join("");
  const free = LANGS.filter((l) => !langs.includes(l[0]));
  const list = visible();
  const i = list.findIndex((x) => x.id === c.id);
  const t = totals(c);
  const whose = S.admin ? "Mis copias" : S.owner ? `Copias de ${esc(S.owner)}` : "Copias";

  els.scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cardName">
   <button type="button" class="close" id="closeBtn" aria-label="Cerrar">×</button>
   <div class="artwrap">${artHtml(c, { big: true })}
     <div class="navrow"><button type="button" id="prevBtn" ${i <= 0 ? "disabled" : ""} aria-label="Carta anterior">←</button><button type="button" id="shareCard" title="Enlace directo a esta carta">Compartir</button><button type="button" id="nextBtn" ${i < 0 || i >= list.length - 1 ? "disabled" : ""} aria-label="Carta siguiente">→</button></div>
     ${c.img ? `<div class="navrow"><a href="${esc(c.img)}" target="_blank" rel="noopener">Imagen a tamaño completo ↗</a></div>` : ""}</div>
   <div class="info">
    <h3 id="cardName">${esc(c.name)}</h3>${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ""}
    <div class="facts"><div><span>Número</span> ${esc(c.code)}</div><div><span>Colección</span> ${esc(set.name)}</div><div><span>Rareza</span> ${rarSvg(c.rarity, 12)} ${esc(RAR[c.rarity]?.[0] || c.rarity)}</div><div><span>Tipo</span> ${esc(TYPE_ES[c.type] || c.type)}</div></div>
    <div class="sec"><h4>${whose} por idioma${t.all ? ` · ${t.all} en total` : ""}</h4>
     ${langs.length ? `<table class="langs"><thead><tr><th>Idioma</th><th>Normal</th><th>Foil</th><th>Promo</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="small">No está apuntada en ningún idioma.${S.admin && !S.editing ? " Pulsa «Editar» para apuntarla." : ""}</p>`}
     ${S.editing && free.length ? `<div class="addlang"><select id="langSel" aria-label="Idioma">${free.map((l) => `<option value="${l[0]}">${l[1]}</option>`).join("")}</select><button type="button" id="addLang">Añadir idioma</button></div>` : ""}
     <div class="save${S.saving[c.id] === "err" ? " err" : ""}" id="saveMsg" aria-live="polite">${saveMsg(c.id)}</div>
    </div>
    <div class="sec"><h4>Precio en Cardmarket</h4>${priceBlock(c)}</div>
   </div></div>`;
  if (first) $("closeBtn").focus();
}

function navCard(d) {
  const list = visible();
  const i = list.findIndex((x) => x.id === S.open);
  const n = list[i + d];
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

/* ---------- login ---------- */
function openLogin() {
  S.open = null;
  els.scrim.hidden = false;
  document.body.classList.add("modal");
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
  els.scrim.innerHTML = `<form class="login" id="loginForm" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
    <h3 id="loginTitle">Editar la colección</h3>
    ${field}
    <div class="err" id="loginErr" aria-live="polite"></div>
    <div class="row"><button type="button" id="cancelLogin">Cancelar</button><button type="submit" class="primary">Entrar</button></div>
  </form>`;
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
  } catch (err) {
    $("loginErr").textContent = err.message;
  }
}

/* ---------- edición ---------- */
const timers = {}, versions = {}, inFlight = {};

function change(id, mutate) {
  const e = structuredClone(S.owned[id] || {});
  mutate(e);
  S.owned[id] = e;
  S.saving[id] = "pending";
  versions[id] = (versions[id] || 0) + 1;
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => save(id), 500);
  render();
}

async function save(id) {
  if (inFlight[id]) { timers[id] = setTimeout(() => save(id), 300); return; }
  inFlight[id] = true;
  const v0 = versions[id];
  try {
    await backend.saveCard(id, S.owned[id] || {});
    if (versions[id] === v0) delete S.saving[id];
    if (STATIC && !S.toldDeploy) { S.toldDeploy = true; toast("Guardado en GitHub. Los demás lo verán en 1–2 minutos."); }
  } catch (err) {
    S.saving[id] = "err";
    if (err.status === 401) { if (STATIC) token.set(""); S.admin = false; S.editing = false; showNotice("La sesión ha caducado. Vuelve a entrar para editar."); }
    else toast("No se ha podido guardar");
  } finally {
    inFlight[id] = false;
    render();
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

/* ---------- eventos ---------- */
document.addEventListener("click", (ev) => {
  const t = ev.target;
  const sb = t.closest(".setbtn");
  if (sb) {
    if (S.set !== sb.dataset.set) { S.set = sb.dataset.set; S.rar.clear(); els.main.scrollTop = 0; }
    syncUrl(true);
    render();
    return;
  }
  const tile = t.closest(".tile");
  if (tile) { openCard(tile.dataset.id); return; }
  const og = t.closest("[data-own]");
  if (og) { S.own = og.dataset.own; syncUrl(); renderControls(); renderGrid(); return; }
  const rc = t.closest("[data-rar]");
  if (rc) { const r = rc.dataset.rar; S.rar.has(r) ? S.rar.delete(r) : S.rar.add(r); syncUrl(); renderGrid(); return; }
  if (t.closest("#shareBtn")) { shareLink(location.href, document.title); return; }
  if (t.closest("#copyBtn")) {
    if (!visible().length) { toast("No hay cartas en esta vista"); return; }
    copyText(listText(), `Lista copiada (${visible().length} cartas)`);
    return;
  }
  if (t.id === "shareCard") { const c = S.byId[S.open]; shareLink(location.href, `${c.name} · ${document.title}`); return; }
  if (t.id === "adminBtn") { if (!S.admin) openLogin(); else { S.editing = !S.editing; render(); } return; }
  if (t.id === "logoutBtn") { backend.logout().finally(() => { S.admin = false; S.editing = false; render(); }); return; }
  if (t === els.scrim || t.id === "closeBtn" || t.id === "cancelLogin") { closeModal(); return; }
  const st = t.closest("[data-step]");
  if (st && S.open) { bump(S.open, st.dataset.l, st.dataset.k, Number(st.dataset.step)); return; }
  if (t.id === "addLang") { addLang(S.open, $("langSel").value); return; }
  if (t.closest("#prevBtn")) navCard(-1);
  else if (t.closest("#nextBtn")) navCard(1);
});
document.addEventListener("submit", (ev) => { if (ev.target.id === "loginForm") submitLogin(ev); });
document.addEventListener("keydown", (ev) => {
  if (els.scrim.hidden) {
    // "/" enfoca el buscador, como en muchas webs.
    if (ev.key === "/" && document.activeElement !== els.q && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); els.q.focus(); }
    return;
  }
  if (ev.key === "Escape") closeModal();
  else if (S.open && ev.key === "ArrowRight") navCard(1);
  else if (S.open && ev.key === "ArrowLeft") navCard(-1);
});
els.q.addEventListener("input", () => { S.q = els.q.value; syncUrl(); renderGrid(); });

// Lee la URL y deja la página como dice (al cargar, al pegar un enlace o con atrás/adelante).
function route() {
  const v = readHash();
  if (S.set !== v.set) els.main.scrollTop = 0;
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
// Si se cierra la pestaña con cambios aún sin guardar, el navegador pregunta antes.
addEventListener("beforeunload", (ev) => {
  if (Object.values(S.saving).includes("pending")) ev.preventDefault();
});
addEventListener("hashchange", route);

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
