# Archivo Riftbound

Catálogo personal de cartas de **Riftbound** (el TCG de League of Legends). Sirve para apuntar qué cartas tienes de cada colección, en qué idioma y si son normales, foil o promo, y para consultar su precio en Cardmarket.

Colecciones incluidas: Origins, Proving Grounds, Spiritforged, Unleashed, Vendetta y Radiance, más las promos de Nexus Night de cada set (1.620 cartas).

## Qué hace

- Barra lateral con las colecciones y el progreso de cada una.
- Cuadrícula de cartas con imagen, símbolo de rareza, número y cuántas copias tienes. Filtros por rareza y por "las tengo / me faltan", y buscador por nombre o número.
- Ficha de cada carta con nombre, número, colección, rareza, precio de Cardmarket y tus copias por idioma (normal / foil / promo).
- El precio solo se pide al servidor cuando abres una carta.
- **Modo administrador** protegido con contraseña para cambiar las cantidades. Sin iniciar sesión, la web es de solo lectura.

## Puesta en marcha

Necesitas **Node.js 22.13 o superior** (usa el SQLite que trae Node, sin dependencias nativas).

```bash
npm install
cp .env.example .env        # y pon tu ADMIN_PASSWORD y SESSION_SECRET
npm run import              # opcional: carga la colección que tenías en la versión de claude.ai
npm start                   # http://localhost:3000
```

Para desarrollo, `npm run dev` reinicia el servidor al guardar cambios.

Los scripts de npm leen `.env` automáticamente. En un servicio de hosting, configura las mismas variables en su panel.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el servidor. |
| `npm run dev` | Igual, recargando al guardar. |
| `npm run sync` | Vuelve a descargar el catálogo de cartas y los ids de Cardmarket (úsalo cuando salga una colección nueva). |
| `npm run import [archivo]` | Importa copias desde un JSON (por defecto `data/seed/coleccion-inicial.json`). |
| `npm run check` | Comprobaciones rápidas del catálogo y de la validación. |

## Precios de Cardmarket

La API oficial de Cardmarket ya no admite nuevas solicitudes de acceso. Por eso se usa la **guía de precios pública** que Cardmarket publica a diario (`price_guide_22.json`, juego 22 = Riftbound). No necesita cuenta ni clave.

- El servidor la descarga la primera vez que alguien abre una carta y la reutiliza durante `PRICE_TTL_HOURS` (12 h por defecto).
- Si la descarga falla, usa la última copia guardada y, si no hay, un precio de respaldo que viene en `data/cardmarket-ids.json`.
- **Limitación:** la guía da un único precio por producto que mezcla todos los idiomas. Por eso, en cada idioma que tengas, la ficha enlaza a Cardmarket ya filtrado por ese idioma.

## Copia de seguridad

Tu colección está en `data/coleccion.db` (no se sube a Git). Para exportarla en JSON:

```bash
curl http://localhost:3000/api/collection > mi-coleccion.json
```

y para volver a cargarla: `npm run import -- mi-coleccion.json`.

## Datos y créditos

- Lista de cartas, imágenes y enlaces con Cardmarket: [Goodplayer01/riftbound-tracker](https://github.com/Goodplayer01/riftbound-tracker), que a su vez toma las imágenes de la galería oficial de Riot.
- Precios: guía pública de [Cardmarket](https://www.cardmarket.com/en/Riftbound/Data).

Proyecto de fans, sin relación con Riot Games ni con UVS Games.
