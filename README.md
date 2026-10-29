# Archivo Riftbound

Catálogo de cartas de **Riftbound** (el TCG de League of Legends) para apuntar tu colección y compartirla con gente que quiera intercambiar cartas. Guarda cuántas copias tienes de cada carta, en qué idioma y si son normales, foil o promo, y muestra su precio en Cardmarket.

Colecciones incluidas: Origins, Proving Grounds, Spiritforged, Unleashed, Vendetta y Radiance, más las promos de Nexus Night de cada set (1.620 cartas).

## Qué hace

- Barra lateral con las colecciones y el progreso de cada una, y una vista con **todas las colecciones** juntas.
- Cuadrícula de cartas con imagen, rareza, número y copias. Filtros **Todas / Las tengo / Me faltan / Repetidas**, por rareza y buscador por nombre o número.
- Ficha de cada carta con sus datos, las copias por idioma y el precio de Cardmarket (se pide solo al abrirla).
- **Compartir:** cada vista y cada carta tienen su propio enlace, filtros incluidos (p. ej. `/#todas?ver=repetidas`). El botón *Compartir* copia el enlace (en el móvil abre el menú de compartir) y *Copiar lista* copia las cartas que se ven como texto, listo para pegar en WhatsApp o Discord.
- **Edición con contraseña.** Quien no la tiene solo puede mirar.

## Publicarla en GitHub Pages (gratis, sin servidor)

La web se publica como archivos estáticos y la colección vive en `data/collection.json`, dentro del propio repositorio.

1. Crea un repositorio **público** en GitHub (Pages gratis solo funciona con repos públicos) y sube este proyecto a la rama `main`.
2. En el repositorio: *Settings* → *Pages* → *Source*: **GitHub Actions**.
3. Ve a la pestaña *Actions*: el flujo "Publicar en GitHub Pages" se ejecuta solo con cada push. Al terminar, la web está en `https://<usuario>.github.io/<repo>/`.

Tu nombre para la cabecera y la vista previa del enlace está en `data/site.json`.

**Editar desde la web.** Pulsa **Editar** y pega un token de GitHub (la ventana explica cómo crearlo: *fine-grained*, solo este repositorio, permiso *Contents: Read and write*). Se guarda solo en ese navegador. Cada cambio se guarda como un commit en `data/collection.json` y la web se vuelve a publicar sola: tú ves el cambio al momento y los visitantes en 1–2 minutos. El historial de commits sirve de copia de seguridad.

**Precios.** Cardmarket no deja descargar su guía desde el navegador, así que el flujo la descarga al publicar y la guarda en `data/prices.json`. Se vuelve a publicar cada día para tener los precios al día. (GitHub pausa las tareas programadas si el repo pasa 60 días sin actividad; se reactivan desde *Actions*.)

Para generar la versión estática en local: `npm run build` (sale en `dist/`).

## Alternativa con servidor: Render + Turso

Si más adelante prefieres editar con contraseña en vez de token, o que los cambios se vean al instante, la misma web funciona con servidor propio: Render la aloja y Turso guarda la colección. Hace falta Turso porque el plan gratuito de Render borra los archivos en cada reinicio.

### 1. Base de datos en Turso

1. Crea una cuenta en [turso.tech](https://turso.tech) (vale con GitHub).
2. *Create database* → ponle un nombre (p. ej. `riftbound`) y elige una región en Europa.
3. En la página de la base, copia la **URL** (empieza por `libsql://`) y crea un **token** (*Create token*, sin caducidad, lectura y escritura).

### 2. Web en Render

1. Sube este repositorio a GitHub (puede ser privado).
2. En [render.com](https://render.com): *New* → *Blueprint* → elige el repositorio. Render lee `render.yaml`.
3. Rellena las variables que te pide:
   - `ADMIN_PASSWORD`: la contraseña para editar.
   - `OWNER_NAME`: tu nombre o apodo; la web dirá "Colección de …" y así saldrá en la vista previa del enlace.
   - `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`: los del paso anterior.
4. Espera a que termine el despliegue y abre la URL (`https://<nombre>.onrender.com`).

La primera vez que arranca carga `data/seed/coleccion-inicial.json` (lo que apuntaste en la versión de claude.ai). Después ya no se vuelve a cargar. Si vienes de GitHub Pages, importa lo que tengas allí: `npm run import -- data/collection.json`.

Para editar desde cualquier sitio: abre la web, pulsa **Editar** y escribe la contraseña. La sesión dura 30 días en ese navegador.

**Límite del plan gratuito:** si nadie visita la web en 15 minutos, Render la duerme y la siguiente visita tarda en torno a un minuto en cargar. Los datos no se pierden.

Cada vez que subas cambios a GitHub, Render vuelve a desplegar solo.

## Usarla en tu ordenador

Necesitas **Node.js 22.13 o superior**.

```bash
npm install
cp .env.example .env        # y pon tu ADMIN_PASSWORD y SESSION_SECRET
npm start                   # http://localhost:3000
```

Sin `TURSO_DATABASE_URL`, la colección se guarda en el archivo `data/coleccion.db`. Si pones en `.env` los datos de Turso, trabajas sobre la misma colección que la web publicada.

Para desarrollo, `npm run dev` reinicia el servidor al guardar cambios.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el servidor. |
| `npm run dev` | Igual, recargando al guardar. |
| `npm run sync` | Vuelve a descargar el catálogo de cartas y los ids de Cardmarket (úsalo cuando salga una colección nueva). |
| `npm run import [archivo]` | Importa copias desde un JSON (por defecto `data/seed/coleccion-inicial.json`) en la base que diga `.env`. |
| `npm run build` | Genera la versión estática para GitHub Pages en `dist/`. |
| `npm run check` | Comprobaciones del catálogo, la validación y la base de datos. |

## Precios de Cardmarket

La API oficial de Cardmarket ya no admite nuevas solicitudes de acceso. Por eso se usa la **guía de precios pública** que Cardmarket publica a diario (`price_guide_22.json`, juego 22 = Riftbound). No necesita cuenta ni clave.

- El servidor la descarga la primera vez que alguien abre una carta y la reutiliza durante `PRICE_TTL_HOURS` (12 h por defecto).
- Si la descarga falla, usa la última copia guardada y, si no hay, un precio de respaldo que viene en `data/cardmarket-ids.json`.
- **Limitación:** la guía da un único precio por producto que mezcla todos los idiomas. Por eso, en cada idioma que tengas, la ficha enlaza a Cardmarket ya filtrado por ese idioma.

## Copia de seguridad

Con la sesión iniciada, la barra lateral tiene un enlace **Descargar copia de seguridad** (un JSON con toda la colección). También puedes descargarla con:

```bash
curl https://<tu-web>/api/collection > mi-coleccion.json
```

y para volver a cargarla: `npm run import -- mi-coleccion.json`.

## Datos y créditos

- Lista de cartas, imágenes y enlaces con Cardmarket: [Goodplayer01/riftbound-tracker](https://github.com/Goodplayer01/riftbound-tracker), que a su vez toma las imágenes de la galería oficial de Riot.
- Precios: guía pública de [Cardmarket](https://www.cardmarket.com/en/Riftbound/Data).

Proyecto de fans, sin relación con Riot Games ni con UVS Games.
