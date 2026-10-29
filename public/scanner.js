// Escáner de cartas con la cámara. Se carga solo al pulsar "Escanear" (import dinámico desde app.js).
//
// Funciona con dos bucles independientes, para que la respuesta sea rápida:
// - Bucle visual (cada ~250 ms): recorta el marco guía, calcula la huella de imagen
//   (fingerprint.js) y busca la carta más parecida. Si está clara, la muestra al momento.
//   Prueba a la vez el encuadre vertical y el horizontal (campos de batalla) y gira el marco solo.
// - Bucle de texto (lo más rápido que deje el OCR): lee la línea "RAD • 138/167 • EN" con
//   Tesseract.js. Cuando lo consigue, confirma la carta, elige bien entre normal / promo /
//   variante y pone el idioma impreso.
// Mientras se ve un resultado, los dos bucles siguen mirando: si pones otra carta, cambia solo.
import { FP_W, FP_H, fingerprint, decode } from "./fingerprint.js";
import { STRIP, prepStrip, parseCode, buildIndex, rankCandidates, nearest, baseKey } from "./scan-core.js";

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const CARD_RATIO = 744 / 1039; // ancho / alto de una carta vertical
const LANGS = [["EN", "Inglés"], ["ES", "Español"], ["FR", "Francés"], ["DE", "Alemán"], ["IT", "Italiano"], ["ZH", "Chino"], ["JA", "Japonés"], ["KO", "Coreano"]];
const PREFS_KEY = "rb_scanner";
const VISUAL_MS = 250;      // cada cuánto se mira la imagen
const MAX_IMAGE_D = 0.27;   // por encima, la "mejor" coincidencia no es fiable (o no hay carta)
const IMAGE_MARGIN = 0.02;  // ventaja mínima sobre la segunda para aceptar por imagen
const INSTANT_D = 0.17, INSTANT_MARGIN = 0.05; // tan clara que vale con un solo fotograma
const OCR_HEIGHT = 100;     // alto (px) al que se escala la franja del número para el OCR

const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Huellas: { all: Map id → huella, p: Map (cartas verticales), l: Map (horizontales) }
let fpCache = null;
async function loadFingerprints(url) {
  fpCache ||= fetch(url, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`No se han podido cargar las huellas (${r.status})`); return r.json(); })
    .then((j) => {
      const all = new Map(), p = new Map(), l = new Map();
      for (const [id, v] of Object.entries(j.cards)) {
        const fp = decode(v.fp);
        all.set(id, fp);
        (v.o === "l" ? l : p).set(id, fp);
      }
      return { all, p, l };
    })
    .catch((e) => { fpCache = null; throw e; });
  return fpCache;
}

let tessPromise = null;
function loadTesseract() {
  tessPromise ||= new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement("script");
    s.src = TESSERACT_URL;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { tessPromise = null; reject(new Error("No se ha podido cargar el lector de texto")); };
    document.head.append(s);
  }).then(async (T) => {
    const worker = await T.createWorker("eng");
    await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/*•.- " });
    return worker;
  });
  return tessPromise;
}

/**
 * Abre el escáner a pantalla completa.
 * opts: { cards, byId, fingerprintsUrl, setName(id), canEdit(), onAdd(id, lang, finish, delta), onLogin(), openCard(id) }
 */
export function openScanner(opts) {
  const sets = new Set(opts.cards.map((c) => c.code.split("-")[0].toUpperCase()));
  const idx = buildIndex(opts.cards);
  let fps = null, worker = null, stream = null, closed = false;
  let result = null, cooldownId = null, session = [];
  let stableId = null;       // mejor coincidencia por imagen del fotograma anterior
  let lastFp = { p: null, l: null }; // última huella de cada encuadre (para el OCR)
  let searchStart = performance.now();
  let lastTopId = null, topSince = searchStart; // desde cuándo se ve la carta actual (para medir el tiempo al cambiarla)
  prefs.lang ||= "EN";
  prefs.finish ||= "n";
  prefs.orient ||= "auto";
  let orient = prefs.orient === "l" ? "l" : "p"; // encuadre que se ve ahora

  const root = document.createElement("div");
  root.className = "scanner";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Escáner de cartas");
  root.innerHTML = `
    <div class="sc-stage">
      <video class="sc-video" playsinline muted autoplay></video>
      <div class="sc-guide" aria-hidden="true"><i></i><i></i><i></i><i></i><span class="sc-strip"></span></div>
      <div class="sc-top">
        <button type="button" class="sc-btn sc-close" aria-label="Cerrar escáner">×</button>
        <div class="sc-status" aria-live="polite">Abriendo la cámara…</div>
        <button type="button" class="sc-btn sc-orient" aria-label="Orientación del marco" title="Vertical, horizontal (campos de batalla) o automático">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="12" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".6"/></svg>
          <span class="sc-orient-label"></span>
        </button>
        <button type="button" class="sc-btn sc-torch" hidden aria-pressed="false" aria-label="Linterna">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10l-2 6v3l-2 11h-2L9 11V8z" fill="currentColor"/></svg>
        </button>
      </div>
      <p class="sc-hint">Llena el marco con la carta, con la línea del número (abajo a la izquierda) dentro de la zona punteada. Los campos de batalla, en horizontal.</p>
    </div>
    <div class="sc-panel">
      <div class="sc-result" hidden></div>
      <details class="sc-settings">
        <summary><span class="sc-sumtext"></span><span class="sc-sumhint">Ajustes</span></summary>
        <div class="sc-controls">
          <label class="sc-field"><span>Idioma si no viene impreso</span>
            <select class="sc-lang">${LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</select></label>
          <label class="sc-field"><span>Acabado</span>
            <select class="sc-finish"><option value="n">Normal</option><option value="f">Foil</option></select></label>
          <label class="sc-field sc-camfield" hidden><span>Cámara</span><select class="sc-cam"></select></label>
          <label class="sc-check" ${opts.canEdit() ? "" : "hidden"}><input type="checkbox" class="sc-auto"> Añadir al detectar (sin preguntar)</label>
          <label class="sc-filebtn">Usar una foto<input type="file" accept="image/*" capture="environment" hidden></label>
        </div>
      </details>
      <div class="sc-session" hidden></div>
    </div>`;
  document.body.append(root);
  document.body.classList.add("modal");
  const $ = (sel) => root.querySelector(sel);
  const video = $(".sc-video"), guide = $(".sc-guide"), status = $(".sc-status"), resultEl = $(".sc-result"), stage = $(".sc-stage");
  $(".sc-lang").value = prefs.lang;
  $(".sc-finish").value = prefs.finish;
  $(".sc-auto").checked = Boolean(prefs.auto);

  const setStatus = (t, kind = "") => { status.textContent = t; status.dataset.kind = kind; };
  function renderSummary() {
    const lang = LANGS.find(([c]) => c === prefs.lang)?.[1] || prefs.lang;
    $(".sc-sumtext").textContent = `${lang} · ${prefs.finish === "f" ? "Foil" : "Normal"}${prefs.auto && opts.canEdit() ? " · automático" : ""}`;
    $(".sc-orient-label").textContent = { auto: "Auto", p: "Vert.", l: "Horiz." }[prefs.orient];
  }
  renderSummary();

  // ---------- cámara ----------
  async function startCamera(deviceId) {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Este navegador no deja usar la cámara. Prueba con «Usar una foto».", "err");
      return;
    }
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const constraints = deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: "environment" }, ...size };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
    } catch (err) {
      if (deviceId) { delete prefs.deviceId; savePrefs(); return startCamera(); }
      setStatus(err.name === "NotAllowedError" ? "No hay permiso para usar la cámara. Actívalo en el navegador o usa «Usar una foto»." : `No se ha podido abrir la cámara (${err.name}).`, "err");
      return;
    }
    if (closed) { stopCamera(); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    $(".sc-torch").hidden = !caps.torch;
    // Lista de cámaras (los nombres solo aparecen después de dar permiso).
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const sel = $(".sc-cam");
    sel.innerHTML = cams.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || `Cámara ${i + 1}`)}</option>`).join("");
    sel.value = track.getSettings().deviceId || "";
    $(".sc-camfield").hidden = cams.length < 2;
    layoutGuide();
    searchStart = performance.now();
    setStatus("Buscando carta…");
  }
  function stopCamera() {
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
  }

  // ---------- marco guía ----------
  // Rectángulo del marco (en px de la pantalla, relativo al escenario) para una orientación.
  function guideBox(o) {
    const r = stage.getBoundingClientRect();
    const ratio = o === "l" ? 1 / CARD_RATIO : CARD_RATIO; // ancho / alto
    const h = Math.min(r.height * 0.8, (r.width * 0.88) / ratio);
    const w = h * ratio;
    return { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h };
  }
  function layoutGuide() {
    const b = guideBox(orient);
    Object.assign(guide.style, { width: `${b.w}px`, height: `${b.h}px`, left: `${b.x}px`, top: `${b.y}px` });
    guide.classList.toggle("land", orient === "l");
  }
  // El hueco de la cámara cambia al aparecer el resultado o al girar el móvil: se recoloca el marco.
  const ro = new ResizeObserver(layoutGuide);
  ro.observe(stage);

  // El mismo rectángulo en píxeles del vídeo (el vídeo se muestra con object-fit: cover).
  function boxInVideo(o) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const r = stage.getBoundingClientRect(), b = guideBox(o);
    const scale = Math.max(r.width / vw, r.height / vh);
    const ox = (r.width - vw * scale) / 2, oy = (r.height - vh * scale) / 2;
    return { x: (b.x - ox) / scale, y: (b.y - oy) / scale, w: b.w / scale, h: b.h / scale };
  }

  // ---------- huella y franja del número ----------
  const fpCanvas = { p: Object.assign(document.createElement("canvas"), { width: FP_W, height: FP_H }), l: Object.assign(document.createElement("canvas"), { width: FP_H, height: FP_W }) };
  const stripCanvas = document.createElement("canvas");
  const ocrCanvas = document.createElement("canvas");

  function fingerprintOf(source, rect, o) {
    const c = fpCanvas[o];
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    return fingerprint(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, 4);
  }
  function stripOf(source, rect) {
    // La línea del número está abajo a la izquierda también en los campos de batalla.
    const sx = rect.x + rect.w * STRIP.x0, sy = rect.y + rect.h * STRIP.y0;
    const sw = rect.w * (STRIP.x1 - STRIP.x0), sh = rect.h * (STRIP.y1 - STRIP.y0);
    const scale = OCR_HEIGHT / sh;
    stripCanvas.width = Math.max(1, Math.round(sw * scale)); stripCanvas.height = OCR_HEIGHT;
    const ctx = stripCanvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, stripCanvas.width, stripCanvas.height);
    return ctx.getImageData(0, 0, stripCanvas.width, stripCanvas.height);
  }
  // Una pasada de OCR (texto claro u oscuro según `invert`). Las pasadas se alternan entre intentos.
  async function ocrOnce(strip, invert) {
    ocrCanvas.width = strip.width; ocrCanvas.height = strip.height;
    ocrCanvas.getContext("2d").putImageData(new ImageData(prepStrip(strip.data, strip.width, strip.height, invert), strip.width, strip.height), 0, 0);
    const { data } = await worker.recognize(ocrCanvas);
    const read = parseCode(data.text, sets);
    return read && (read.total || /^[RT]/.test(read.num)) ? read : null;
  }

  // Mira la imagen en los dos encuadres y devuelve el mejor.
  function look(source, rects) {
    let best = null;
    for (const o of ["p", "l"]) {
      if (prefs.orient !== "auto" && o !== prefs.orient) continue;
      const rect = rects[o];
      if (!rect) continue;
      const fp = fingerprintOf(source, rect, o);
      lastFp[o] = fp;
      const near = nearest(fp, fps[o], 10);
      if (near.length && (!best || near[0].d < best.near[0].d)) best = { o, rect, fp, near };
    }
    return best;
  }

  function candidatesFor(cardId, fp) {
    const card = opts.byId[cardId];
    const [set, num] = baseKey(card.code).split(/-(.+)/);
    const ranked = rankCandidates({ set, num }, idx, fps.all, fp);
    return ranked.length ? ranked : Object.assign([{ card, d: null }], { ambiguous: false });
  }

  const currentCard = () => (result ? result.ranked[result.pick].card : null);
  const sameCard = (a, b) => a && b && baseKey(a.code) === baseKey(b.code);

  // ---------- bucle visual ----------
  async function visualLoop() {
    while (!closed) {
      await sleep(VISUAL_MS);
      if (!fps || !stream || video.readyState < 2 || document.hidden) continue;
      try {
        const best = look(video, { p: boxInVideo("p"), l: boxInVideo("l") });
        if (!best) continue;
        // Auto: si la carta encaja mejor en horizontal (o al revés), se gira el marco.
        if (prefs.orient === "auto" && best.o !== orient && best.near[0].d < MAX_IMAGE_D) { orient = best.o; layoutGuide(); }
        const top = best.near[0];
        if (top.id !== lastTopId) { lastTopId = top.id; topSince = performance.now(); }
        // La ventaja se mide contra la siguiente carta *distinta*: su propia promo o variante
        // se parece igual y no debe frenar la detección (luego se elige entre ellas).
        const topKey = baseKey(opts.byId[top.id].code);
        const rival = best.near.find((n) => baseKey(opts.byId[n.id].code) !== topKey);
        const gap = rival ? rival.d - top.d : 1;
        const clear = top.d < MAX_IMAGE_D && gap > IMAGE_MARGIN;
        const instant = top.d < INSTANT_D && gap > INSTANT_MARGIN;
        const confirmed = clear && (instant || stableId === top.id);
        stableId = clear ? top.id : null;
        if (!clear) {
          // Se ha quitado la carta recién añadida: ya se puede volver a detectar.
          if (cooldownId && !(top.d < MAX_IMAGE_D && top.id === cooldownId)) cooldownId = null;
          if (!result) setStatus(worker ? "Buscando carta…" : "Buscando carta… (cargando el lector de texto)");
          continue;
        }
        if (!confirmed) continue;
        const card = opts.byId[top.id];
        if (cooldownId && sameCard(card, opts.byId[cooldownId])) { if (!result) setStatus("Retira la carta o pon otra"); continue; }
        if (result && sameCard(card, currentCard())) continue; // la misma de antes: nada que hacer
        // Carta nueva (o cambio de carta con un resultado a la vista).
        show({ how: "image", read: null, ranked: candidatesFor(top.id, best.fp), near: best.near, o: best.o }, Boolean(result));
      } catch (err) {
        console.error(err);
      }
    }
  }

  // ---------- bucle de texto (OCR) ----------
  async function ocrLoop() {
    let invert = true;
    while (!closed) {
      // Sin trabajo: no hay lector, no hay cámara o la carta ya está confirmada por el número.
      if (!worker || !fps || !stream || video.readyState < 2 || document.hidden || (result && result.how === "ocr")) { await sleep(200); continue; }
      try {
        const rect = boxInVideo(orient);
        if (!rect) { await sleep(200); continue; }
        const read = await ocrOnce(stripOf(video, rect), invert);
        invert = !invert;
        if (closed || !read) continue;
        const ranked = rankCandidates(read, idx, fps.all, lastFp[orient]);
        if (!ranked.length) continue;
        const card = ranked[0].card;
        if (cooldownId && sameCard(card, opts.byId[cooldownId])) continue;
        if (result && sameCard(card, currentCard())) {
          // Confirma la carta que ya se ve: número leído, mejor variante e idioma impreso.
          const keepId = result.userPicked ? currentCard().id : null;
          const pick = keepId ? Math.max(0, ranked.findIndex((r) => r.card.id === keepId)) : 0;
          result = { ...result, how: "ocr", read, ranked, pick, lang: result.userLang ? result.lang : read.lang || result.lang };
          renderResult();
          maybeAutoAdd();
        } else {
          show({ how: "ocr", read, ranked, near: [], o: orient }, Boolean(result));
        }
      } catch (err) {
        console.error(err);
        await sleep(500);
      }
    }
  }

  // ---------- resultado ----------
  function variantLabel(card) {
    const t = card.tags || [];
    if (t.includes("nexus-night")) return "Promo Nexus Night";
    if (t.includes("promo")) return `Promo ${card.code.split("-").slice(2).join(" ") || ""}`.trim();
    if (t.includes("signed")) return "Firmada";
    if (t.includes("alt")) return "Arte alternativo";
    if (t.includes("overnumbered")) return "Overnumbered";
    return card.rarity === "Showcase" ? "Showcase" : "Normal";
  }

  function show(res, replaced) {
    // Tiempo desde que se empezó a buscar o, si se cambia de carta, desde que apareció la nueva.
    const ms = Math.max(VISUAL_MS, performance.now() - (replaced ? Math.max(searchStart, topSince) : searchStart));
    result = { ...res, pick: 0, lang: res.read?.lang || prefs.lang, ms };
    if (navigator.vibrate) navigator.vibrate(40);
    renderResult(replaced ? "Nueva carta detectada" : "");
    maybeAutoAdd();
  }

  function maybeAutoAdd() {
    if (result && opts.canEdit() && prefs.auto && result.how === "ocr" && !result.ranked.ambiguous) addCurrent(true);
  }

  function renderResult(note = "") {
    if (!result) { resultEl.hidden = true; resultEl.innerHTML = ""; return; }
    const { ranked, read, how } = result;
    const card = ranked[result.pick].card;
    const thumb = card.img ? (card.img.includes("cmsassets.rgpub.io") ? `${card.img}?w=240&auto=format` : card.img) : "";
    const secs = `${(result.ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s`;
    const source = how === "ocr"
      ? `Leído: <b>${esc(read.raw)}</b>${read.lang ? "" : " · sin idioma impreso"} · ${secs}`
      : `Reconocida por la imagen · ${secs}${worker ? " · leyendo el número…" : ""}`;
    const variants = ranked.length > 1
      ? `<div class="sc-variants" role="group" aria-label="Variante">${ranked.slice(0, 6).map((r, i) => `<button type="button" data-pick="${i}" aria-pressed="${i === result.pick}">${esc(variantLabel(r.card))}<small>${esc(r.card.code)}</small></button>`).join("")}</div>
         ${ranked.ambiguous ? `<p class="sc-note">La normal y la promo se ven casi iguales: comprueba el sello de abajo y elige.</p>` : ""}`
      : "";
    const langs = `<div class="sc-langs" role="group" aria-label="Idioma">${LANGS.map(([c]) => `<button type="button" data-lang="${c}" aria-pressed="${c === result.lang}">${c}</button>`).join("")}</div>`;
    const edit = opts.canEdit();
    resultEl.innerHTML = `
      ${note ? `<p class="sc-new">${esc(note)}</p>` : ""}
      <div class="sc-card">
        ${thumb ? `<img src="${esc(thumb)}" alt="">` : `<div class="sc-noimg">${esc(card.name)}</div>`}
        <div class="sc-info">
          <b class="sc-name">${esc(card.name)}${card.sub ? ` <span>${esc(card.sub)}</span>` : ""}</b>
          <span class="sc-code">${esc(card.code)} · ${esc(opts.setName(card.set))}</span>
          <span class="sc-src">${source}</span>
        </div>
      </div>
      ${variants}
      ${langs}
      <div class="sc-actions">
        ${edit ? `<button type="button" class="sc-primary sc-add">Añadir 1 ${result.lang} ${prefs.finish === "f" ? "foil" : "normal"}</button>`
               : `<button type="button" class="sc-primary sc-login">Entrar para añadir</button>`}
        <button type="button" class="sc-ghost sc-view">Ver ficha</button>
        <button type="button" class="sc-ghost sc-next">Otra carta</button>
      </div>
      ${how === "image" && result.near.length > 1 ? `<details class="sc-others"><summary>¿No es esta?</summary><div>${result.near.slice(0, 5).map((n) => { const c = opts.byId[n.id]; return `<button type="button" data-near="${esc(n.id)}">${esc(c.name)} <small>${esc(c.code)}</small></button>`; }).join("")}</div></details>` : ""}`;
    resultEl.hidden = false;
    setStatus(`${card.name} · ${card.code}`, "ok");
  }

  function clearResult(status = "Buscando carta…") {
    result = null;
    stableId = null;
    searchStart = performance.now();
    renderResult();
    setStatus(status);
  }

  async function addCurrent(auto = false) {
    const card = currentCard();
    const lang = result.lang, finish = prefs.finish;
    try {
      await opts.onAdd(card.id, lang, finish);
      session.unshift({ id: card.id, lang, finish });
      renderSession();
      flash(`+1 ${card.name} (${lang}${finish === "f" ? ", foil" : ""})`);
      cooldownId = card.id;
      clearResult(auto ? `Añadida: ${card.name}. Pon la siguiente.` : "Buscando carta…");
    } catch (err) {
      setStatus(`No se ha podido añadir: ${err.message}`, "err");
    }
  }

  function renderSession() {
    const el = $(".sc-session");
    el.hidden = !session.length;
    el.innerHTML = `<div class="sc-sesshead"><b>${session.length} añadida${session.length === 1 ? "" : "s"} en esta sesión</b><button type="button" class="sc-undo">Deshacer la última</button></div>
      <ol>${session.slice(0, 8).map((s) => `<li>${esc(opts.byId[s.id].name)} <small>${esc(opts.byId[s.id].code)} · ${s.lang}${s.finish === "f" ? " · foil" : ""}</small></li>`).join("")}</ol>`;
  }

  function flash(text) {
    const f = document.createElement("div");
    f.className = "sc-flash";
    f.textContent = text;
    stage.append(f);
    setTimeout(() => f.remove(), 1600);
  }

  // ---------- foto suelta (sin cámara, o como alternativa) ----------
  async function analyzeFile(file) {
    const bmp = await createImageBitmap(file);
    setStatus("Analizando la foto…");
    searchStart = performance.now();
    // Se asume que la carta ocupa casi toda la foto: recorte centrado, en vertical y en horizontal.
    const crop = (ratio) => {
      let w = bmp.width, h = w / ratio;
      if (h > bmp.height) { h = bmp.height; w = h * ratio; }
      w *= 0.98; h *= 0.98;
      return { x: (bmp.width - w) / 2, y: (bmp.height - h) / 2, w, h };
    };
    const best = look(bmp, { p: crop(CARD_RATIO), l: crop(1 / CARD_RATIO) });
    let read = null;
    if (worker && best) for (const inv of [true, false]) { read = await ocrOnce(stripOf(bmp, best.rect), inv); if (read) break; }
    if (read) {
      const ranked = rankCandidates(read, idx, fps.all, best.fp);
      if (ranked.length) return show({ how: "ocr", read, ranked, near: best.near, o: best.o }, false);
    }
    if (best && best.near[0].d < MAX_IMAGE_D) return show({ how: "image", read: null, ranked: candidatesFor(best.near[0].id, best.fp), near: best.near, o: best.o }, false);
    setStatus("No he reconocido la carta en la foto. Prueba con otra más cerca y sin reflejos.", "err");
  }

  // ---------- eventos ----------
  root.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (t.closest(".sc-close")) return close();
    if (t.closest(".sc-torch")) {
      const b = t.closest(".sc-torch"), on = b.getAttribute("aria-pressed") !== "true";
      stream?.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] }).then(() => b.setAttribute("aria-pressed", on)).catch(() => {});
      return;
    }
    if (t.closest(".sc-orient")) {
      prefs.orient = { auto: "p", p: "l", l: "auto" }[prefs.orient];
      savePrefs();
      if (prefs.orient !== "auto") orient = prefs.orient;
      layoutGuide();
      renderSummary();
      return;
    }
    const pick = t.closest("[data-pick]");
    if (pick) { result.pick = Number(pick.dataset.pick); result.userPicked = true; renderResult(); return; }
    const lang = t.closest("[data-lang]");
    if (lang) { result.lang = lang.dataset.lang; result.userLang = true; renderResult(); return; }
    const nearBtn = t.closest("[data-near]");
    if (nearBtn) {
      const ranked = candidatesFor(nearBtn.dataset.near, null);
      const i = Math.max(0, ranked.findIndex((r) => r.card.id === nearBtn.dataset.near));
      result = { ...result, ranked, pick: i, userPicked: true };
      renderResult();
      return;
    }
    if (t.closest(".sc-add")) return addCurrent();
    if (t.closest(".sc-login")) { close(); opts.onLogin(); return; }
    if (t.closest(".sc-view")) { const id = currentCard().id; close(); opts.openCard(id); return; }
    if (t.closest(".sc-next")) { cooldownId = currentCard().id; clearResult(); return; }
    if (t.closest(".sc-undo")) {
      const last = session.shift();
      if (!last) return;
      try { await opts.onAdd(last.id, last.lang, last.finish, -1); flash(`Deshecho: ${opts.byId[last.id].name}`); }
      catch (err) { session.unshift(last); setStatus(`No se ha podido deshacer: ${err.message}`, "err"); }
      renderSession();
    }
  });
  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.classList.contains("sc-lang")) { prefs.lang = t.value; savePrefs(); renderSummary(); if (result && !result.read?.lang && !result.userLang) { result.lang = t.value; renderResult(); } }
    else if (t.classList.contains("sc-finish")) { prefs.finish = t.value; savePrefs(); renderSummary(); renderResult(); }
    else if (t.classList.contains("sc-auto")) { prefs.auto = t.checked; savePrefs(); renderSummary(); }
    else if (t.classList.contains("sc-cam")) { prefs.deviceId = t.value; savePrefs(); startCamera(t.value); }
    else if (t.type === "file" && t.files[0]) { analyzeFile(t.files[0]).catch((e) => setStatus(e.message, "err")); t.value = ""; }
  });
  function onKey(ev) { if (ev.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);

  function close() {
    if (closed) return;
    closed = true;
    stopCamera();
    ro.disconnect();
    document.removeEventListener("keydown", onKey);
    root.remove();
    document.body.classList.remove("modal");
    opts.onClose?.();
  }

  // ---------- arranque ----------
  (async () => {
    // El lector de texto (varios MB la primera vez) se carga en paralelo con las huellas y la cámara.
    loadTesseract().then((w) => { worker = w; }).catch((e) => setStatus(`${e.message}. Se reconocerá solo por la imagen.`, "err"));
    startCamera(prefs.deviceId);
    try {
      fps = await loadFingerprints(opts.fingerprintsUrl);
    } catch (err) {
      setStatus(err.message, "err");
      return;
    }
    visualLoop();
    ocrLoop();
  })();

  return { close };
}
