// Escáner de cartas con la cámara. Se carga solo al pulsar "Escanear" (import dinámico desde app.js).
//
// Cómo reconoce una carta (cada ~0,5 s mientras la cámara está abierta):
// 1. Recorta lo que hay dentro del marco guía (proporción de carta).
// 2. Huella de imagen (fingerprint.js) → las cartas más parecidas de todo el catálogo.
// 3. OCR (Tesseract.js) de la línea de abajo a la izquierda: "RAD • 138/167 • EN" → colección,
//    número e idioma. Si se lee, manda el número; la huella elige entre normal / promo / variante.
// 4. Si el número no se lee, vale la imagen sola cuando la mejor coincidencia es clara y se
//    repite en dos fotogramas seguidos.
import { FP_W, FP_H, fingerprint, decode } from "./fingerprint.js";
import { STRIP, prepStrip, parseCode, buildIndex, rankCandidates, nearest, baseKey } from "./scan-core.js";

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const CARD_RATIO = 744 / 1039;
const LANGS = [["EN", "Inglés"], ["ES", "Español"], ["FR", "Francés"], ["DE", "Alemán"], ["IT", "Italiano"], ["ZH", "Chino"], ["JA", "Japonés"], ["KO", "Coreano"]];
const PREFS_KEY = "rb_scanner";
const MAX_IMAGE_D = 0.27; // por encima, la "mejor" coincidencia por imagen no es fiable (o no hay carta)
const IMAGE_MARGIN = 0.02; // ventaja mínima sobre la segunda para aceptar por imagen

const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let fpCache = null;
async function loadFingerprints(url) {
  fpCache ||= fetch(url, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`No se han podido cargar las huellas (${r.status})`); return r.json(); })
    .then((j) => new Map(Object.entries(j.cards).map(([id, v]) => [id, decode(v.fp)])))
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
 * opts: { cards, byId, fingerprintsUrl, canEdit(), onAdd(id, lang, finish) → Promise, onLogin(), openCard(id), label(card) }
 */
export function openScanner(opts) {
  const sets = new Set(opts.cards.map((c) => c.code.split("-")[0].toUpperCase()));
  const idx = buildIndex(opts.cards);
  let fps = null, worker = null, stream = null, timer = null, busy = false, ocrBusy = false, closed = false;
  let lastImageTop = null, result = null, cooldownId = null, session = [];
  prefs.lang ||= "EN";
  prefs.finish ||= "n";

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
        <button type="button" class="sc-btn sc-torch" hidden aria-pressed="false" aria-label="Linterna">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10l-2 6v3l-2 11h-2L9 11V8z" fill="currentColor"/></svg>
        </button>
      </div>
      <p class="sc-hint">Coloca la carta dentro del marco, con la línea del número (abajo a la izquierda) visible y sin reflejos.</p>
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
  const video = $(".sc-video"), guide = $(".sc-guide"), status = $(".sc-status"), resultEl = $(".sc-result");
  $(".sc-lang").value = prefs.lang;
  $(".sc-finish").value = prefs.finish;
  $(".sc-auto").checked = Boolean(prefs.auto);

  const setStatus = (t, kind = "") => { status.textContent = t; status.dataset.kind = kind; };

  // ---------- cámara ----------
  async function startCamera(deviceId) {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Este navegador no deja usar la cámara. Prueba con «Usar una foto».", "err");
      return;
    }
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const video_ = deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: "environment" }, ...size };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: video_ });
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
    setStatus("Buscando carta…");
    loop();
  }
  function stopCamera() {
    clearTimeout(timer);
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
  }

  // Marco guía: lo más grande posible con proporción de carta, centrado en la imagen visible.
  function layoutGuide() {
    const r = $(".sc-stage").getBoundingClientRect();
    const h = Math.min(r.height * 0.8, (r.width * 0.82) / CARD_RATIO);
    const w = h * CARD_RATIO;
    Object.assign(guide.style, { width: `${w}px`, height: `${h}px`, left: `${(r.width - w) / 2}px`, top: `${(r.height - h) / 2}px` });
  }
  // El hueco de la cámara cambia al aparecer el resultado o al girar el móvil: se recoloca el marco.
  const ro = new ResizeObserver(layoutGuide);
  ro.observe($(".sc-stage"));
  function renderSummary() {
    const lang = LANGS.find(([c]) => c === prefs.lang)?.[1] || prefs.lang;
    $(".sc-sumtext").textContent = `${lang} · ${prefs.finish === "f" ? "Foil" : "Normal"}${prefs.auto && opts.canEdit() ? " · automático" : ""}`;
  }
  renderSummary();

  // Rectángulo del marco en píxeles del vídeo (el vídeo se muestra con object-fit: cover).
  function guideInVideo() {
    const stage = $(".sc-stage").getBoundingClientRect(), g = guide.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.max(stage.width / vw, stage.height / vh);
    const ox = (stage.width - vw * scale) / 2, oy = (stage.height - vh * scale) / 2;
    return { x: (g.left - stage.left - ox) / scale, y: (g.top - stage.top - oy) / scale, w: g.width / scale, h: g.height / scale };
  }

  // ---------- análisis de un fotograma (o de una foto) ----------
  const cardCanvas = document.createElement("canvas");
  cardCanvas.width = 600; cardCanvas.height = Math.round(600 / CARD_RATIO);
  const fpCanvas = document.createElement("canvas");
  fpCanvas.width = FP_W; fpCanvas.height = FP_H;
  const stripCanvas = document.createElement("canvas");

  function capture(source, rect) {
    const cc = cardCanvas.getContext("2d", { willReadFrequently: true });
    cc.imageSmoothingQuality = "high";
    cc.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, cardCanvas.width, cardCanvas.height);
    const fc = fpCanvas.getContext("2d", { willReadFrequently: true });
    fc.imageSmoothingQuality = "high";
    fc.drawImage(cardCanvas, 0, 0, FP_W, FP_H);
    const fp = fingerprint(fc.getImageData(0, 0, FP_W, FP_H).data, FP_W, FP_H, 4);
    // Franja del número, a la resolución original para que el OCR tenga píxeles de sobra.
    const sx = rect.x + rect.w * STRIP.x0, sy = rect.y + rect.h * STRIP.y0;
    const sw = rect.w * (STRIP.x1 - STRIP.x0), sh = rect.h * (STRIP.y1 - STRIP.y0);
    const scale = Math.max(1, 160 / sh);
    stripCanvas.width = Math.round(sw * scale); stripCanvas.height = Math.round(sh * scale);
    const sc = stripCanvas.getContext("2d", { willReadFrequently: true });
    sc.imageSmoothingQuality = "high";
    sc.drawImage(source, sx, sy, sw, sh, 0, 0, stripCanvas.width, stripCanvas.height);
    const raw = sc.getImageData(0, 0, stripCanvas.width, stripCanvas.height);
    return { fp, strip: raw };
  }

  async function ocr(strip) {
    if (!worker) return null;
    const c = document.createElement("canvas");
    c.width = strip.width; c.height = strip.height;
    const ctx = c.getContext("2d");
    for (const inv of [true, false]) {
      const img = new ImageData(prepStrip(strip.data, strip.width, strip.height, inv), strip.width, strip.height);
      ctx.putImageData(img, 0, 0);
      const { data } = await worker.recognize(c);
      const read = parseCode(data.text, sets);
      if (read && (read.total || /^[RT]/.test(read.num))) return read;
    }
    return null;
  }

  async function analyze(source, rect, { still = false } = {}) {
    const { fp, strip } = capture(source, rect);
    const near = nearest(fp, fps, 5);
    let read = null;
    if (!ocrBusy) {
      ocrBusy = true;
      try { read = await ocr(strip); } finally { ocrBusy = false; }
    }
    if (read) {
      const ranked = rankCandidates(read, idx, fps, fp);
      if (ranked.length) return { how: "ocr", read, ranked, near };
    }
    // Sin número: vale la imagen si es clara (y en vídeo, si se repite en dos fotogramas).
    const top = near[0];
    const clear = top && top.d < MAX_IMAGE_D && (!near[1] || near[1].d - top.d > IMAGE_MARGIN);
    if (clear && (still || lastImageTop === top.id)) {
      const card = opts.byId[top.id];
      const key = baseKey(card.code);
      const [set, num] = key.split(/-(.+)/);
      const ranked = rankCandidates({ set, num }, idx, fps, fp);
      return { how: "image", read: null, ranked: ranked.length ? ranked : [{ card, d: top.d }], near };
    }
    lastImageTop = top && top.d < MAX_IMAGE_D ? top.id : null;
    return { how: null, near };
  }

  async function loop() {
    if (closed || !stream) return;
    if (!busy && !result && video.readyState >= 2 && video.videoWidth) {
      busy = true;
      try {
        const res = await analyze(video, guideInVideo());
        if (closed) return;
        if (res.how) {
          const top = res.ranked[0].card;
          // Después de añadir una carta, no se vuelve a detectar la misma hasta que se quite del marco.
          if (cooldownId === top.id) setStatus("Retira la carta o pon otra");
          else showResult(res);
        } else {
          if (cooldownId && !(res.near[0] && res.near[0].d < MAX_IMAGE_D && res.near[0].id === cooldownId)) cooldownId = null;
          setStatus(worker ? "Buscando carta…" : "Buscando carta… (cargando el lector de texto)");
        }
      } catch (err) {
        console.error(err);
        setStatus(`Error al analizar: ${err.message}`, "err");
      } finally {
        busy = false;
      }
    } else if (!busy && result && result.how === "image" && worker && (result.tries || 0) < 8 && video.readyState >= 2) {
      // Reconocida por la imagen: se sigue intentando leer el número un rato para confirmar
      // la carta y saber el idioma (el lector de texto puede haber tardado en cargar).
      busy = true;
      result.tries = (result.tries || 0) + 1;
      try {
        const { fp, strip } = capture(video, guideInVideo());
        const read = await ocr(strip);
        const current = result && result.ranked[result.pick].card;
        if (read && current && `${read.set}-${read.num}` === baseKey(current.code)) {
          const ranked = rankCandidates(read, idx, fps, fp);
          const keep = Math.max(0, ranked.findIndex((r) => r.card.id === current.id));
          result = { ...result, how: "ocr", read, ranked, pick: keep, lang: read.lang || result.lang, langFromCard: Boolean(read.lang) };
          renderResult();
        }
      } catch (err) {
        console.error(err);
      } finally {
        busy = false;
      }
    }
    timer = setTimeout(loop, result ? 400 : 350);
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

  function showResult(res) {
    result = { ...res, pick: 0, lang: res.read?.lang || prefs.lang };
    if (navigator.vibrate) navigator.vibrate(40);
    if (opts.canEdit() && prefs.auto && !res.ranked.ambiguous && res.how === "ocr") {
      addCurrent(true);
      return;
    }
    renderResult();
  }

  function renderResult() {
    if (!result) { resultEl.hidden = true; resultEl.innerHTML = ""; return; }
    const { ranked, read, how } = result;
    const card = ranked[result.pick].card;
    const thumb = card.img ? (card.img.includes("cmsassets.rgpub.io") ? `${card.img}?w=240&auto=format` : card.img) : "";
    const source = how === "ocr"
      ? `Leído: <b>${esc(read.raw)}</b>${read.lang ? "" : " · sin idioma impreso"}`
      : "Reconocida por la imagen (no se ha podido leer el número)";
    const variants = ranked.length > 1
      ? `<div class="sc-variants" role="group" aria-label="Variante">${ranked.slice(0, 6).map((r, i) => `<button type="button" data-pick="${i}" aria-pressed="${i === result.pick}">${esc(variantLabel(r.card))}<small>${esc(r.card.code)}</small></button>`).join("")}</div>
         ${ranked.ambiguous ? `<p class="sc-note">La normal y la promo se ven casi iguales: comprueba el sello de abajo y elige.</p>` : ""}`
      : "";
    const langs = `<div class="sc-langs" role="group" aria-label="Idioma">${LANGS.map(([c]) => `<button type="button" data-lang="${c}" aria-pressed="${c === result.lang}">${c}</button>`).join("")}</div>`;
    const edit = opts.canEdit();
    resultEl.innerHTML = `
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

  async function addCurrent(auto = false) {
    const card = result.ranked[result.pick].card;
    const lang = result.lang, finish = prefs.finish;
    try {
      await opts.onAdd(card.id, lang, finish);
      session.unshift({ id: card.id, lang, finish });
      renderSession();
      flash(`+1 ${card.name} (${lang}${finish === "f" ? ", foil" : ""})`);
      cooldownId = card.id;
      result = null;
      lastImageTop = null;
      renderResult();
      setStatus(auto ? `Añadida: ${card.name}. Pon la siguiente.` : "Buscando carta…", "ok");
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
    $(".sc-stage").append(f);
    setTimeout(() => f.remove(), 1600);
  }

  // ---------- foto suelta (sin cámara, o como alternativa) ----------
  async function analyzeFile(file) {
    const bmp = await createImageBitmap(file);
    // Se asume que la carta ocupa casi toda la foto: recorte centrado con proporción de carta.
    let w = bmp.width, h = w / CARD_RATIO;
    if (h > bmp.height) { h = bmp.height; w = h * CARD_RATIO; }
    w *= 0.98; h *= 0.98;
    setStatus("Analizando la foto…");
    const res = await analyze(bmp, { x: (bmp.width - w) / 2, y: (bmp.height - h) / 2, w, h }, { still: true });
    if (res.how) showResult(res);
    else setStatus("No he reconocido la carta en la foto. Prueba con otra más cerca y sin reflejos.", "err");
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
    const pick = t.closest("[data-pick]");
    if (pick) { result.pick = Number(pick.dataset.pick); renderResult(); return; }
    const lang = t.closest("[data-lang]");
    if (lang) { result.lang = lang.dataset.lang; renderResult(); return; }
    const nearBtn = t.closest("[data-near]");
    if (nearBtn) {
      const card = opts.byId[nearBtn.dataset.near];
      const key = baseKey(card.code).split(/-(.+)/);
      const ranked = rankCandidates({ set: key[0], num: key[1] }, idx, fps, null);
      const i = Math.max(0, ranked.findIndex((r) => r.card.id === card.id));
      result = { ...result, ranked, pick: i };
      renderResult();
      return;
    }
    if (t.closest(".sc-add")) return addCurrent();
    if (t.closest(".sc-login")) { close(); opts.onLogin(); return; }
    if (t.closest(".sc-view")) { const id = result.ranked[result.pick].card.id; close(); opts.openCard(id); return; }
    if (t.closest(".sc-next")) { cooldownId = result.ranked[result.pick].card.id; result = null; renderResult(); setStatus("Buscando carta…"); return; }
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
    if (t.classList.contains("sc-lang")) { prefs.lang = t.value; savePrefs(); renderSummary(); if (result && !result.read?.lang) { result.lang = t.value; renderResult(); } }
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
    try {
      fps = await loadFingerprints(opts.fingerprintsUrl);
    } catch (err) {
      setStatus(err.message, "err");
      return;
    }
    loadTesseract().then((w) => { worker = w; }).catch((e) => setStatus(`${e.message}. Se reconocerá solo por la imagen.`, "err"));
    startCamera(prefs.deviceId);
  })();

  return { close };
}
