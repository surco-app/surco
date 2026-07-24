# Deezer en la web de marketing — diseño

Fecha: 2026-07-24
Estado: aprobado (conversación 2026-07-24)

## Problema

La app ya busca en Deezer (con match exacto por ISRC para música comercial), pero la web
(`apps/web`) sigue contando un mundo de dos fuentes: ~38 menciones de Discogs/Bandcamp por
locale entre la home, las metas SEO y la guía. Un visitante no puede saber que Surco ahora
también cubre el single comercial que no está en Discogs ni Bandcamp.

## Objetivo

Que toda enumeración de fuentes en la web incluya Deezer, y que la guía explique la fuente
nueva y el match por ISRC — sin secciones nuevas ni rediseños.

## Alcance

Solo copy: los dos locales de la web (`apps/web/src/i18n/locales/es.json` y `en.json`),
mismas claves en ambos. Nada de componentes nuevos, iconos ni layout (`Icon.tsx` usa
iconos genéricos de línea, no logos — no hay trabajo visual).

Fuera de alcance:
- El changelog de la web (`i18n/changelog/*`): lo genera el skill de release al cortar
  versión.
- Las menciones de "Discogs" que nombran piezas de UI de la app ("columna de Discogs",
  "búsqueda de Discogs", la tecla `/`, "release id de Discogs"): describen la interfaz
  real, no la cobertura de fuentes.

## Cambios

En ambos locales, con redacción equivalente por idioma:

### Home y SEO — enumeraciones de fuentes

1. `home.meta.description`, `home.meta.ogDescription`, `home.meta.jsonLdDescription`:
   "…desde Discogs…" → "…desde Discogs, Bandcamp y Deezer…" (en: "from Discogs, Bandcamp
   and Deezer").
2. Bullet de features: "Rellena artista, álbum, sello, BPM y tono desde Discogs y
   Bandcamp" → "…desde Discogs, Bandcamp y Deezer".
3. Claim "en vez de Discogs y Bandcamp en el navegador y un editor de tags" → "en vez de
   Discogs, Bandcamp y Deezer en el navegador y un editor de tags".
4. Marquesina `.stack`: añadir el ítem "Deezer" tras "Bandcamp".
5. Tarjeta de feature "Match de Discogs y Bandcamp" → "Match de Discogs, Bandcamp y
   Deezer"; su descripción pasa de "Busca el lanzamiento exacto en Discogs o Bandcamp y
   elige la versión correcta." a incluir la cobertura comercial: "Busca el lanzamiento
   exacto en Discogs, Bandcamp o Deezer — de la edición de club al single comercial — y
   elige la versión correcta."
6. FAQ: "…los completa desde Discogs." → "…los completa desde Discogs, Bandcamp o
   Deezer."

### Guía — secciones de fuentes

7. Sección "Etiqueta desde Discogs y Bandcamp" → título "Etiqueta desde Discogs, Bandcamp
   y Deezer". El párrafo que explica activar Bandcamp gana una continuación para Deezer:
   viene activado de serie, no necesita cuenta ni token, y cubre la música comercial
   (pop, urbano, éxitos de radio) que no suele estar en los catálogos de Discogs y
   Bandcamp. El tip del filtro "solo Discogs o solo Bandcamp" → "a una sola fuente".
8. Sección de auto-match: "Discogs primero y Bandcamp de respaldo" → "Discogs primero, y
   Bandcamp y Deezer de respaldo". Frase nueva sobre el ISRC: si el archivo trae ISRC en
   sus tags (habitual en descargas de streaming), Surco lo usa para localizar la
   grabación exacta en Deezer, así el single original no se confunde con remixes de
   nombre parecido.
9. `guide.metaDescription`: "etiquetar desde Discogs" → "etiquetar desde Discogs,
   Bandcamp y Deezer".

## Verificación

- Suite de la web (`npm test --workspace apps/web`) y build (`npm run build --workspace
  apps/web`): los JSON deben seguir siendo válidos y las claves idénticas entre locales
  (si existe test de paridad, debe seguir verde; los cambios no añaden ni quitan claves,
  salvo el ítem nuevo del array `.stack` en ambos).
- Captura headless de la home tocada contra `vite preview` (no dev); `/` redirige por
  idioma.

## Testing

Sin tests nuevos: no hay lógica nueva, solo strings. La paridad de claves entre locales ya
la cubren los tests existentes de la web si los hay; la validez del JSON la impone el
build.
