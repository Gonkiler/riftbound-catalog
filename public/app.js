// Archivo Riftbound: interfaz. Sin frameworks ni build; habla con la API de server/index.js.
"use strict";

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(
  ["mainSets", "nnSets", "railFoot", "main", "setTitle", "stUnique", "stCopies", "stFoil", "q", "rarChips", "adminBtn", "logoutBtn", "notice", "grid", "scrim"].map((id) => [id, $(id)])
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

const S = {
  sets: [], cards: [], bySet: {}, byId: {},
  set: null, q: "", own: "all", rar: new Set(),
  owned: {},          // { cardId: { EN: { n, f, p } } }
  saving: {},         // cardId -> "pending" | "err"
  admin: false,       // sesión iniciada como administrador
  editing: false,     // modo administrador activado
  adminEnabled: false,
  prices: {},         // cardId -> respuesta de /api/prices o { failed: true }
  open: null,
};

/* ---------- utilidades ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eur = (v) => (v == null ? "—" : v.toLocaleString("es-ES", { style: "currency", currency: "EUR" }));

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

// Las imágenes oficiales son PNG de 744×1039. Pedimos una versión reducida al CDN de Riot;
// si no la acepta, el manejador de errores de abajo prueba la original y, si tampoco carga,
// quita la imagen y queda el marcador con el nombre.
const thumbUrl = (img) => (img ? `${img}?w=360&auto=format` : "");
document.addEventListener("error", (ev) => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.full) return;
  if (img.src !== img.dataset.full) img.src = img.dataset.full;
  else img.remove();
}, true);

/* ---------- colección ---------- */
const entry = (c) => S.owned[c.id] || {};
function totals(c) {
  let n = 0, f = 0, p = 0;
  for (const v of Object.values(entry(c))) { n += v.n || 0; f += v.f || 0; p += v.p || 0; }
  return { n, f, p, all: n + f + p };
}
function setProgress(set) {
  const cs = S.bySet[set] || [];
  let have = 0, copies = 0, foil = 0;
  for (const c of cs) { const t = totals(c); if (t.all) { have++; copies += t.all; foil += t.f; } }
  return { have, total: cs.length, copies, foil };
}

/* ---------- render ---------- */
function renderRail() {
  const li = (s) => {
    const p = setProgress(s.id);
    return `<li><button type="button" class="setbtn" data-set="${s.id}" aria-current="${S.set === s.id}"><span class="nm">${esc(s.short)}</span><span class="cd">${p.have}/${p.total}</span><span class="bar"><i style="width:${p.total ? (p.have / p.total) * 100 : 0}%"></i></span></button></li>`;
  };
  els.mainSets.innerHTML = S.sets.filter((s) => !s.nn).map(li).join("");
  els.nnSets.innerHTML = S.sets.filter((s) => s.nn).map(li).join("");
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
    if (q && !(c.name.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderGrid() {
  const set = S.sets.find((s) => s.id === S.set);
  if (!set) return;
  els.setTitle.innerHTML = `${esc(set.short)}<span>${esc(set.id)}</span>`;
  const p = setProgress(S.set);
  els.stUnique.textContent = `${p.have} / ${p.total}`;
  els.stCopies.textContent = p.copies;
  els.stFoil.textContent = p.foil;
  const rs = RAR_ORDER.filter((r) => (S.bySet[S.set] || []).some((c) => c.rarity === r));
  els.rarChips.innerHTML = rs.map((r) => `<button type="button" class="chip" data-rar="${r}" aria-pressed="${S.rar.has(r)}">${rarSvg(r, 12)}${RAR[r][0]}</button>`).join("");

  const list = visible();
  if (!list.length) {
    els.grid.innerHTML = `<p class="empty">${S.own === "have" ? "Todavía no has marcado ninguna carta de esta colección. Entra en el modo administrador y abre una carta para apuntar tus copias." : "No hay cartas que coincidan con estos filtros."}</p>`;
    return;
  }
  els.grid.innerHTML = list.map((c) => {
    const t = totals(c);
    const promo = c.tags.includes("promo") || c.tags.includes("nexus-night");
    const pills = [
      promo ? '<span class="pill promo">Promo</span>' : "",
      c.tags.includes("signed") ? '<span class="pill">Firma</span>' : "",
      c.tags.includes("alt") ? '<span class="pill">Alt</span>' : "",
      c.tags.includes("overnumbered") ? '<span class="pill">ON</span>' : "",
    ].join("");
    const extra = `<span class="pills">${pills}</span>${t.all ? `<span class="cnt">×${t.all}</span>` : ""}`;
    const num = c.code.split("/")[0].replace(/^[A-Z]+-/, "#");
    return `<button type="button" class="tile${t.all ? "" : " missing"}${t.f ? " foil" : ""}" data-id="${c.id}" aria-label="${esc(c.name)} ${esc(c.code)}, ${t.all} copias">${artHtml(c, { extra })}<span class="meta"><span class="n">${esc(c.name)}</span><span class="c">${esc(num)}</span></span></button>`;
  }).join("");
}

function renderAdmin() {
  els.adminBtn.hidden = !S.adminEnabled;
  els.adminBtn.setAttribute("aria-pressed", S.editing);
  els.adminBtn.textContent = !S.admin ? "Entrar como administrador" : S.editing ? "Salir de edición" : "Modo administrador";
  els.logoutBtn.hidden = !S.admin;
}

function render() { renderRail(); renderGrid(); renderAdmin(); if (S.open) renderSheet(); }

/* ---------- ficha de carta ---------- */
function openCard(id) {
  S.open = id;
  els.scrim.hidden = false;
  renderSheet(true);
  if (!S.prices[id]) {
    api(`/api/prices/${encodeURIComponent(id)}`)
      .then((p) => { S.prices[id] = p; })
      .catch(() => { S.prices[id] = { failed: true }; })
      .finally(() => { if (S.open === id) renderSheet(); });
  }
}
function closeModal() { S.open = null; els.scrim.hidden = true; els.scrim.innerHTML = ""; }

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
  return `<span class="step"><button type="button" data-step="-1" data-k="${k}" data-l="${lang}" aria-label="Quitar">−</button><output>${v}</output><button type="button" data-step="1" data-k="${k}" data-l="${lang}" aria-label="Añadir">+</button></span>`;
}

function saveMsg(id) {
  return S.saving[id] === "err" ? "No se ha podido guardar. Vuelve a intentarlo." : S.saving[id] ? "Guardando…" : "";
}

function renderSheet(first = false) {
  const c = S.byId[S.open];
  if (!c) return;
  const set = S.sets.find((s) => s.id === c.set);
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

  els.scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cardName">
   <button type="button" class="close" id="closeBtn" aria-label="Cerrar">×</button>
   <div class="artwrap">${artHtml(c, { big: true })}
     <div class="navrow"><button type="button" id="prevBtn" ${i <= 0 ? "disabled" : ""}>← Anterior</button><button type="button" id="nextBtn" ${i < 0 || i >= list.length - 1 ? "disabled" : ""}>Siguiente →</button></div>
     ${c.img ? `<div class="navrow"><a href="${esc(c.img)}" target="_blank" rel="noopener">Ver imagen a tamaño completo ↗</a></div>` : ""}</div>
   <div>
    <h3 id="cardName">${esc(c.name)}</h3>${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ""}
    <div class="facts"><div><span>Número</span> ${esc(c.code)}</div><div><span>Colección</span> ${esc(set.name)}</div><div><span>Rareza</span> ${rarSvg(c.rarity, 12)} ${esc(RAR[c.rarity]?.[0] || c.rarity)}</div><div><span>Tipo</span> ${esc(TYPE_ES[c.type] || c.type)}</div></div>
    <div class="sec"><h4>Precio en Cardmarket</h4>${priceBlock(c)}</div>
    <div class="sec"><h4>Mis copias por idioma${t.all ? ` · ${t.all} en total` : ""}</h4>
     ${langs.length ? `<table class="langs"><thead><tr><th>Idioma</th><th>Normal</th><th>Foil</th><th>Promo</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="small">No tienes esta carta en ningún idioma.${S.adminEnabled ? " Entra en el modo administrador para apuntarla." : ""}</p>`}
     ${S.editing && free.length ? `<div class="addlang"><select id="langSel" aria-label="Idioma">${free.map((l) => `<option value="${l[0]}">${l[1]}</option>`).join("")}</select><button type="button" id="addLang">Añadir idioma</button></div>` : ""}
     <div class="save" id="saveMsg" aria-live="polite">${saveMsg(c.id)}</div>
    </div>
   </div></div>`;
  if (first) $("closeBtn").focus();
}

function navCard(d) {
  const list = visible();
  const i = list.findIndex((x) => x.id === S.open);
  const n = list[i + d];
  if (n) openCard(n.id);
}

/* ---------- login ---------- */
function openLogin() {
  S.open = null;
  els.scrim.hidden = false;
  els.scrim.innerHTML = `<form class="login" id="loginForm" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
    <h3 id="loginTitle">Modo administrador</h3>
    <label for="pw">Contraseña</label>
    <input id="pw" type="password" autocomplete="current-password" required>
    <div class="err" id="loginErr" aria-live="polite"></div>
    <div class="row"><button type="button" id="cancelLogin">Cancelar</button><button type="submit" class="primary">Entrar</button></div>
  </form>`;
  $("pw").focus();
}

async function submitLogin(ev) {
  ev.preventDefault();
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("pw").value }) });
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
    await api(`/api/collection/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(S.owned[id] || {}) });
    if (versions[id] === v0) delete S.saving[id];
  } catch (err) {
    S.saving[id] = "err";
    if (err.status === 401) { S.admin = false; S.editing = false; showNotice("La sesión ha caducado. Vuelve a entrar como administrador."); }
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
  if (sb) { location.hash = sb.dataset.set.toLowerCase(); return; }
  const tile = t.closest(".tile");
  if (tile) { openCard(tile.dataset.id); return; }
  const og = t.closest("[data-own]");
  if (og) {
    S.own = og.dataset.own;
    document.querySelectorAll("[data-own]").forEach((b) => b.setAttribute("aria-pressed", b === og));
    renderGrid();
    return;
  }
  const rc = t.closest("[data-rar]");
  if (rc) { const r = rc.dataset.rar; S.rar.has(r) ? S.rar.delete(r) : S.rar.add(r); renderGrid(); return; }
  if (t.id === "adminBtn") { if (!S.admin) openLogin(); else { S.editing = !S.editing; render(); } return; }
  if (t.id === "logoutBtn") { api("/api/logout", { method: "POST" }).finally(() => { S.admin = false; S.editing = false; render(); }); return; }
  if (t === els.scrim || t.id === "closeBtn" || t.id === "cancelLogin") { closeModal(); return; }
  const st = t.closest("[data-step]");
  if (st && S.open) { bump(S.open, st.dataset.l, st.dataset.k, Number(st.dataset.step)); return; }
  if (t.id === "addLang") { addLang(S.open, $("langSel").value); return; }
  if (t.id === "prevBtn" || t.id === "nextBtn") navCard(t.id === "nextBtn" ? 1 : -1);
});
document.addEventListener("submit", (ev) => { if (ev.target.id === "loginForm") submitLogin(ev); });
document.addEventListener("keydown", (ev) => {
  if (els.scrim.hidden) return;
  if (ev.key === "Escape") closeModal();
  else if (S.open && ev.key === "ArrowRight") navCard(1);
  else if (S.open && ev.key === "ArrowLeft") navCard(-1);
});
els.q.addEventListener("input", () => { S.q = els.q.value; renderGrid(); });

function route() {
  const h = location.hash.slice(1).toUpperCase();
  const s = S.sets.find((x) => x.id === h) || S.sets[0];
  if (S.set !== s.id) { S.set = s.id; S.rar.clear(); els.main.scrollTop = 0; }
  renderRail();
  renderGrid();
}
addEventListener("hashchange", route);

/* ---------- arranque ---------- */
(async () => {
  try {
    const [data, owned, me] = await Promise.all([api("/api/cards"), api("/api/collection"), api("/api/me")]);
    S.sets = data.sets.map((s) => {
      const nn = s.id.endsWith("-NN");
      return { ...s, nn, short: nn ? s.name.split("|")[0].trim() : s.name };
    });
    S.cards = data.cards.map((row) => Object.fromEntries(data.cols.map((k, i) => [k, row[i]])));
    for (const c of S.cards) { (S.bySet[c.set] ||= []).push(c); S.byId[c.id] = c; }
    S.owned = owned;
    S.admin = me.admin;
    S.adminEnabled = me.adminEnabled;
    els.railFoot.textContent = `${S.cards.length} cartas en ${S.sets.length} colecciones`;
    route();
    renderAdmin();
  } catch (err) {
    els.setTitle.textContent = "No se han podido cargar las cartas";
    showNotice(err.message);
  }
})();
