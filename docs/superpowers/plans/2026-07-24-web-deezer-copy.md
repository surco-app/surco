# Deezer en la web — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la web de marketing enumere Deezer junto a Discogs/Bandcamp y que la guía explique la fuente nueva y el match por ISRC.

**Architecture:** Solo strings en los dos locales de la web (`es.json`/`en.json`), mismas claves; sin componentes, iconos ni layout. El test de paridad (`keys.test.ts`) compara claves incluyendo índices de array, así que el único cambio estructural (ítem "Deezer" en `stack`) debe hacerse en ambos locales.

**Tech Stack:** Vite + React (apps/web), i18n por JSON, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-24-web-deezer-copy-design.md`

## Global Constraints

- Repo npm. Ejecutar desde la raíz del worktree.
- Solo se tocan `apps/web/src/i18n/locales/es.json` y `en.json`. El changelog y las menciones de UI ("columna de Discogs", "búsqueda de Discogs", "release id de Discogs", el icono ✦, "no descarga nada de Discogs en el lote") NO se tocan.
- Sin tests nuevos (solo strings); el ciclo de verificación es la suite web existente + build.
- Commit con título descriptivo, sin prefijos ni cuerpo.
- Verificación visual contra `vite preview`, no dev; `/` redirige por idioma.

---

### Task 1: Los 13 pares de strings en ambos locales

**Files:**
- Modify: `apps/web/src/i18n/locales/es.json`
- Modify: `apps/web/src/i18n/locales/en.json`
- Test: suite existente (`apps/web/src/i18n/keys.test.ts` y demás)

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: los locales finales que Task 2 verifica visualmente.

- [ ] **Step 1: Ediciones en `es.json`** — cada par es literal actual → literal nuevo (Edit exacto):

1. `meta.description`: `edita etiquetas y metadatos desde Discogs y manda` → `edita etiquetas y metadatos desde Discogs, Bandcamp y Deezer, y manda`
2. `meta.ogDescription`: `etiqueta desde Discogs y organiza` → `etiqueta desde Discogs, Bandcamp y Deezer, y organiza`
3. `meta.jsonLdDescription`: `etiqueta desde Discogs, manda` → `etiqueta desde Discogs, Bandcamp y Deezer, manda`
4. `features.groups[1].replaces`: `en vez de Discogs y Bandcamp en el navegador` → `en vez de Discogs, Bandcamp y Deezer en el navegador`
5. `features.groups[1].items[0]`: `desde Discogs y Bandcamp` → `desde Discogs, Bandcamp y Deezer`
6. `stack`: `"Discogs",\n    "Bandcamp",` → `"Discogs",\n    "Bandcamp",\n    "Deezer",` (respetando la indentación real del fichero)
7. `showcase.tour.discogs.title`: `Match de Discogs y Bandcamp` → `Match de Discogs, Bandcamp y Deezer`
8. `showcase.tour.discogs.desc`: `Busca el lanzamiento exacto en Discogs o Bandcamp y elige la versión correcta.` → `Busca el lanzamiento exacto en Discogs, Bandcamp o Deezer — de la edición de club al single comercial — y elige la versión correcta.`
9. `faq.items[1].a`: `y los completa desde Discogs.` → `y los completa desde Discogs, Bandcamp o Deezer.`
10. `guide.metaDescription`: `etiquetar desde Discogs,` → `etiquetar desde Discogs, Bandcamp y Deezer,`
11. `guide.sections[7].title`: `Etiqueta desde Discogs y Bandcamp` → `Etiqueta desde Discogs, Bandcamp y Deezer`
12. `guide.sections[7].body[2]`: `Bandcamp no necesita cuenta ni token.` → `Bandcamp no necesita cuenta ni token. ¿Y la música comercial — pop, urbano, éxitos de radio — que no está en ninguno de los dos? Para eso viene Deezer activado de serie: tampoco pide cuenta ni token, y cubre justo el catálogo que a Discogs y Bandcamp se les escapa.`
13. `guide.sections[7].points[4]`: `Con las dos fuentes activas, un filtro reduce la lista de resultados a solo Discogs o solo Bandcamp.` → `Con varias fuentes activas, un filtro reduce la lista de resultados a una sola.`
14. `guide.sections[8].body[0]`, dos ediciones en la misma string: `Discogs primero y Bandcamp de respaldo.` → `Discogs primero, y Bandcamp y Deezer de respaldo.`; y el final `igual que si la hubieras elegido a mano.` → `igual que si la hubieras elegido a mano. Si el archivo trae ISRC en sus tags (habitual en descargas de streaming), Surco lo usa para localizar la grabación exacta en Deezer, así el single original no se confunde con remixes de nombre parecido.`

- [ ] **Step 2: Ediciones en `en.json`** — espejo exacto:

1. `meta.description`: `edit tags and metadata from Discogs and send` → `edit tags and metadata from Discogs, Bandcamp and Deezer, and send`
2. `meta.ogDescription`: `tag from Discogs and organize` → `tag from Discogs, Bandcamp and Deezer, and organize`
3. `meta.jsonLdDescription`: `tag from Discogs, send` → `tag from Discogs, Bandcamp and Deezer, send`
4. `features.groups[1].replaces`: `instead of Discogs and Bandcamp in the browser` → `instead of Discogs, Bandcamp and Deezer in the browser`
5. `features.groups[1].items[0]`: `from Discogs and Bandcamp` → `from Discogs, Bandcamp and Deezer`
6. `stack`: `"Discogs",\n    "Bandcamp",` → `"Discogs",\n    "Bandcamp",\n    "Deezer",` (indentación real)
7. `showcase.tour.discogs.title`: `Discogs & Bandcamp match` → `Discogs, Bandcamp & Deezer match`
8. `showcase.tour.discogs.desc`: `Find the exact release on Discogs or Bandcamp and pick the right version.` → `Find the exact release on Discogs, Bandcamp or Deezer — from club pressings to chart singles — and pick the right version.`
9. `faq.items[1].a`: `fills them in from Discogs.` → `fills them in from Discogs, Bandcamp or Deezer.`
10. `guide.metaDescription`: `tag from Discogs, match a whole release` → `tag from Discogs, Bandcamp and Deezer, match a whole release`
11. `guide.sections[7].title`: `Tag from Discogs and Bandcamp` → `Tag from Discogs, Bandcamp and Deezer`
12. `guide.sections[7].body[2]`: `Bandcamp needs no account or token.` → `Bandcamp needs no account or token. And the commercial stuff — pop, chart hits, radio singles — that neither catalog carries? That's what Deezer ships enabled for: no account or token either, covering exactly what Discogs and Bandcamp miss.`
13. `guide.sections[7].points[4]`: `With both sources on, a filter narrows the result list to Discogs or Bandcamp only.` → `With several sources on, a filter narrows the result list to a single one.`
14. `guide.sections[8].body[0]`, dos ediciones: `Discogs first, Bandcamp as the fallback.` → `Discogs first, with Bandcamp and Deezer as fallbacks.`; y el final `exactly as if you had picked it by hand.` → `exactly as if you had picked it by hand. If the file carries an ISRC in its tags (common in streaming downloads), Surco uses it to pin down the exact recording on Deezer, so the original single never gets mistaken for a similarly named remix.`

- [ ] **Step 3: Verificar**

```bash
npm test --workspace apps/web
npm run build --workspace apps/web
```

Expected: 6 files / 32 tests verdes (paridad incluida) y build sin errores. Comprobar que no queda ninguna enumeración huérfana: `grep -n "Discogs y Bandcamp\|Discogs and Bandcamp\|Discogs o Bandcamp\|Discogs or Bandcamp" apps/web/src/i18n/locales/*.json` debe devolver vacío.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/locales/es.json apps/web/src/i18n/locales/en.json
git commit -m "Mention Deezer across the website copy"
```

---

### Task 2: Verificación visual

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: los locales de Task 1.

- [ ] **Step 1: Servir la build y capturar** — según el flujo de verificación web headless del proyecto: build ya hecha en Task 1, servir con `npm run preview --workspace apps/web` (puerto que indique), y capturar `http://localhost:<puerto>/es` (la raíz `/` redirige por idioma). Verificar en la captura: el bullet de features con las tres fuentes, la marquesina del stack con "Deezer" y la tarjeta "Match de Discogs, Bandcamp y Deezer".

- [ ] **Step 2: Cerrar el preview** y reportar la captura al usuario.
