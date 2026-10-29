# CLAUDE.md

Notas para Claude Code sobre este repositorio. El README es para personas; este archivo explica cómo encaja el código.

## Proyecto

- Archivo Riftbound: catálogo de cartas del TCG Riftbound. Lo usa Gonchu para apuntar su colección (por idioma y acabado: normal, foil, promo), consultar precios de Cardmarket y compartirla con gente para intercambiar cartas. Hay dos formas de publicarla con el mismo frontend: **GitHub Pages** (estática, la que se usa ahora) y **Render + Turso** (con servidor). `public/app.js` decide al arrancar: si existe `static.json` va en modo estático; si no, usa `/api`.
- Responde en español. La interfaz está en español. El código (nombres de variables y funciones) en inglés; los comentarios pueden ir en español.
- Empezó como un artifact de claude.ai (una sola página con base de datos del artifact) y se pasó a este repo. Ahora tiene servidor propio.

## Stack

- Node.js ≥ 22.13, ESM (`"type": "module"`). Dependencias: Express y `@libsql/client`. De desarrollo: `sharp` (huellas del escáner) y `tesseract.js` (pruebas del OCR).
- Base de datos: libSQL. Con `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` usa Turso (producción); sin ellas, el archivo local `DB_PATH` (`data/coleccion.db`). La API del cliente es asíncrona; las escrituras de varias filas van en `db.batch(..., "write")`, que es atómico.
- Despliegue: `render.yaml` (Blueprint de Render). El disco de Render gratuito no persiste: no guardes nada que importe en archivos (la caché de precios en `data/cache/` sí puede perderse). Render define `RENDER=true` y con eso se activa `trust proxy` (cookie `secure`).
- Frontend sin frameworks ni build: `public/index.html`, `public/styles.css`, `public/app.js` (script clásico). El escáner son módulos ES que `app.js` carga con `import()` al pulsar Escanear: `public/scanner.js` (cámara e interfaz), `public/scan-core.js` (OCR: preparar la franja, `parseCode`, candidatas) y `public/fingerprint.js` (huella de imagen). Tesseract.js se carga de jsDelivr solo al abrir el escáner. No añadas un bundler salvo que se pida.
- Diseño: primero el móvil (barra superior fija, filtros en una fila deslizable, barra inferior `.bnav`, hojas que suben desde abajo); a partir de 900px, barra lateral `.rail`. Se desplaza la página, no un panel interior. La cuadrícula se pinta en tandas de `CHUNK` con un `IntersectionObserver`; al cambiar copias se repinta solo esa tarjeta (`refreshCard`).

## Modo estático (GitHub Pages)

- `scripts/build-static.js` (`npm run build`) genera `dist/`: copia `public/`, rellena `index.html`, y publica `data/cards.json`, `data/collection.json`, `data/prices.json` (precios de todas las cartas, descargados en el build porque la guía de Cardmarket no tiene CORS) y `static.json` (`{ repo, branch, owner }`).
- `.github/workflows/pages.yml` lo ejecuta en cada push a `main`, cada día (precios) y a mano.
- La colección es `data/collection.json` en el repo: una carta por línea, ordenadas, sin idiomas a cero. Para editar, la web usa un token fine-grained de GitHub guardado en `localStorage` (`rb_github_token`) y hace commits con la API de contenidos (`backend` en `app.js`: junta los cambios en un commit cuando pasan `SAVE_DELAY_MS` (5 s) sin tocar nada y reintenta si cambió el `sha`).
- Rutas relativas en `index.html` y `app.js` (Pages sirve en `/<repo>/`). No uses rutas que empiecen por `/`.
- El nombre del dueño sale de `data/site.json` (o de `OWNER_NAME`). Lo lee `server/page.js`, compartido por el servidor y el build.

## Estructura

- `server/index.js`: rutas de Express.
  - `GET /api/cards`: catálogo (`data/cards.json`, filas compactas con `cols`).
  - `GET /api/collection`: `{ cardId: { EN: { n, f, p } } }` (n = normal, f = foil, p = promo).
  - `PUT /api/collection/:cardId` (solo admin): sustituye todas las copias de una carta. Los idiomas a cero no se guardan.
  - `GET /api/prices/:cardId`: precio de Cardmarket. Se llama solo al abrir la ficha de una carta, para no descargar precios que nadie mira.
  - `GET /api/me`: `{ admin, adminEnabled, owner }`. `POST /api/login`, `POST /api/logout`: sesión de administrador.
  - `GET /`: sirve `public/index.html` sustituyendo `%TITLE%` y `%DESCRIPTION%` según `OWNER_NAME`, para la vista previa del enlace (Open Graph).
  - Al arrancar, `seedOnce` carga `data/seed/coleccion-inicial.json` si la base es nueva (lo apunta en la tabla `meta`).
- `server/db.js`: tabla `copies(card_id, lang, normal, foil, promo, updated_at)`, clave `(card_id, lang)`, y `meta(key, value)`.
- `server/auth.js`: una sola contraseña (`ADMIN_PASSWORD`) y cookie `rb_admin` = `caducidad.hmac` firmada con `SESSION_SECRET`. Sin `ADMIN_PASSWORD` la web es de solo lectura.
- `server/prices.js`: descarga `price_guide_22.json` de Cardmarket bajo demanda, la guarda en `data/cache/` y la reutiliza `PRICE_TTL_HOURS`. Cruza carta → producto con `data/cardmarket-ids.json` (`cmId`). Si no hay guía, usa el `snapshot` de ese archivo y lo marca como `source: "snapshot"`.
- `server/validate.js`: `cleanLangs` valida el cuerpo del PUT y `cleanCollection` una colección entera (importación y carga inicial). Idiomas permitidos en `server/catalog.js` (`LANGUAGES`, con el id de idioma de Cardmarket).
- `scripts/sync-cards.js`: regenera `data/cards.json` y `data/cardmarket-ids.json` desde Goodplayer01/riftbound-tracker. El orden de la barra lateral está en `SET_ORDER`.
  - `data/cards-extra.json`: cartas que le faltan al tracker, añadidas a mano (con su `cmId` de Cardmarket). La sincronización las incluye y deja de usarlas cuando el tracker trae el mismo id o código. `npm run check` falla si hay alguna sin sincronizar.
  - Para buscar huecos: la galería oficial (`playriftbound.com/es-es/card-gallery/`, datos en `__NEXT_DATA__`, sin tokens) y el catálogo de productos de Cardmarket (`productCatalog/productList/products_singles_22.json`, por expansión, sin códigos).
- `scripts/import-collection.js`: importa copias desde JSON. `data/seed/coleccion-inicial.json` es lo que Gonchu ya había apuntado en la versión de claude.ai.
- `scripts/check.js`: comprobaciones con `node:assert`, incluida la base de datos sobre un archivo temporal. No hay framework de tests.
- `public/app.js`: el estado de la vista vive en la URL (`#<set>?ver=tengo|faltan|repetidas&rareza=rare,epic&q=…&carta=<id>`; `#todas` = todas las colecciones). `syncUrl` la escribe y `route` la lee. Los cambios de colección añaden entrada al historial; los filtros la sustituyen.

## Escáner

- Línea impresa abajo a la izquierda: `SET • NNN/TOTAL • IDIOMA` (el idioma solo en colecciones recientes; Origins/Unleashed EN no lo llevan). Runas `R01`, fichas `T01`, variantes `061a`, firmadas `303*`. `parseCode` corrige confusiones típicas (O/0, I/1…) y valida la colección.
- `baseKey(code)` agrupa una carta con sus promos/variantes (`OGN-001-P` → `OGN-001`). Entre varias candidatas decide la huella; si normal y promo son casi iguales (imágenes de referencia idénticas salvo el sello), `rankCandidates` marca `ambiguous`, pone primero la normal y la interfaz pregunta.
- Huellas: `scripts/fingerprints.js` → `data/fingerprints.json` (dHash 256 bits + color 4×4 + zona del sello). El CDN de Riot da 403 a peticiones con `Origin`, así que no se pueden calcular en el navegador. Si cambias `fingerprint.js`, sube `FP_VERSION` y regenera. dotgg rechaza un User-Agent con caracteres no ASCII.
- Resultados con fotos simuladas (80 cartas): número leído ~68 %, carta correcta solo por imagen ~92 % (top-5: 100 %). Sin probar con cámaras reales.

## Datos

- Ids de carta: los del tracker, p. ej. `ogn-001-298`, `rad-046`, `ogn-007b` (Nexus Night). Son estables; la colección se guarda por id.
- Colecciones con sufijo `-NN` son promos de Nexus Night y van en su propio grupo de la barra lateral.
- Rarezas: Common, Uncommon, Rare, Epic, Showcase, Ultimate Rare. Símbolos y colores en `RAR` de `public/app.js`.
- Imágenes: URLs oficiales de Riot (`cmsassets.rgpub.io`). Unas 180 cartas (sobre todo promos) usan otras webs (piltoverarchive, dotgg, riftcompare). La cuadrícula pide `?w=360&auto=format` (comprobado: el CDN de Riot devuelve ~1/3 del peso); si falla, cae a la imagen completa y, si tampoco carga, se ve el marcador con el nombre.

## Precios: límites conocidos

- La API oficial de Cardmarket no admite nuevas solicitudes. Solo usamos la guía pública.
- La guía da un precio por producto, mezclando idiomas. El precio por idioma se resuelve con enlaces a Cardmarket con `?language=<id>`.
- Los nombres de campo de la guía (`trend`, `avg30`, `low`, `trend-foil`, `low-foil`, `idProduct`) son los del formato público de Cardmarket; si un día cambian, el síntoma es que todas las fichas muestran "—".

## Comandos

```
npm install
npm start          # servidor en http://localhost:3000
npm run dev        # con recarga
npm run sync       # actualizar catálogo
npm run import     # cargar data/seed/coleccion-inicial.json
npm run check      # comprobaciones
```

Antes de dar un cambio por terminado: `npm run check` y arrancar el servidor una vez.
