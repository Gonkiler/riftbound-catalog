# CLAUDE.md

Notas para Claude Code sobre este repositorio. El README es para personas; este archivo explica cómo encaja el código.

## Proyecto

- Archivo Riftbound: catálogo personal de cartas del TCG Riftbound. Lo usa Gonchu para apuntar su colección (por idioma y acabado: normal, foil, promo) y consultar precios de Cardmarket.
- Responde en español. La interfaz está en español. El código (nombres de variables y funciones) en inglés; los comentarios pueden ir en español.
- Empezó como un artifact de claude.ai (una sola página con base de datos del artifact) y se pasó a este repo. La interfaz es la misma; lo que cambió es que ahora hay un servidor propio.

## Stack

- Node.js ≥ 22.13, ESM (`"type": "module"`). Única dependencia: Express.
- Base de datos: `node:sqlite` (`DatabaseSync`), incluido en Node. Avisa con un `ExperimentalWarning`; los scripts de npm lo silencian con `--disable-warning=ExperimentalWarning`.
- Frontend sin frameworks ni build: `public/index.html`, `public/styles.css`, `public/app.js`. No añadas un bundler salvo que se pida.

## Estructura

- `server/index.js`: rutas de Express.
  - `GET /api/cards`: catálogo (`data/cards.json`, filas compactas con `cols`).
  - `GET /api/collection`: `{ cardId: { EN: { n, f, p } } }` (n = normal, f = foil, p = promo).
  - `PUT /api/collection/:cardId` (solo admin): sustituye todas las copias de una carta. Los idiomas a cero no se guardan.
  - `GET /api/prices/:cardId`: precio de Cardmarket. Se llama solo al abrir la ficha de una carta, para no descargar precios que nadie mira.
  - `GET /api/me`, `POST /api/login`, `POST /api/logout`: sesión de administrador.
- `server/db.js`: tabla `copies(card_id, lang, normal, foil, promo, updated_at)`, clave `(card_id, lang)`.
- `server/auth.js`: una sola contraseña (`ADMIN_PASSWORD`) y cookie `rb_admin` = `caducidad.hmac` firmada con `SESSION_SECRET`. Sin `ADMIN_PASSWORD` la web es de solo lectura.
- `server/prices.js`: descarga `price_guide_22.json` de Cardmarket bajo demanda, la guarda en `data/cache/` y la reutiliza `PRICE_TTL_HOURS`. Cruza carta → producto con `data/cardmarket-ids.json` (`cmId`). Si no hay guía, usa el `snapshot` de ese archivo y lo marca como `source: "snapshot"`.
- `server/validate.js`: valida el cuerpo del PUT. Idiomas permitidos en `server/catalog.js` (`LANGUAGES`, con el id de idioma de Cardmarket).
- `scripts/sync-cards.js`: regenera `data/cards.json` y `data/cardmarket-ids.json` desde Goodplayer01/riftbound-tracker. El orden de la barra lateral está en `SET_ORDER`.
- `scripts/import-collection.js`: importa copias desde JSON. `data/seed/coleccion-inicial.json` es lo que Gonchu ya había apuntado en la versión de claude.ai.
- `scripts/check.js`: comprobaciones con `node:assert`. No hay framework de tests.

## Datos

- Ids de carta: los del tracker, p. ej. `ogn-001-298`, `rad-046`, `ogn-007b` (Nexus Night). Son estables; la colección se guarda por id.
- Colecciones con sufijo `-NN` son promos de Nexus Night y van en su propio grupo de la barra lateral.
- Rarezas: Common, Uncommon, Rare, Epic, Showcase, Ultimate Rare. Símbolos y colores en `RAR` de `public/app.js`.
- Imágenes: URLs oficiales de Riot (`cmsassets.rgpub.io`). La cuadrícula pide `?w=360&auto=format` para una versión reducida; si el CDN no la sirve, cae a la imagen completa y, si tampoco carga, se ve el marcador con el nombre. No se ha comprobado si el CDN de Riot acepta esos parámetros: verifícalo y ajusta `thumbUrl` si hace falta.

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
