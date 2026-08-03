# Auditoría pre-1.0 de Surco

Fecha: 2026-08-02 · Base: `main` @ aaf9a526 (v0.80.0)
Método: 6 lentes de auditoría en paralelo sobre ~51k LOC + verificación adversarial de cada hallazgo (25 auditados → 13 confirmados, 12 refutados).

---

## Resumen

La app llega a la 1.0 en buen estado. Lo que sigue son 13 hallazgos confirmados con fichero y línea; ninguno es crítico y ninguno provoca pérdida de datos.

**Estado base verificado (ejecutado, no estimado):**

| Comprobación | Resultado |
|---|---|
| Tests desktop | 3493 ✓ · 1 skipped · 20s |
| Typecheck (`tsconfig.web` + `tsconfig.node`) | limpio |
| Seguridad Electron | `sandbox:true`, `contextIsolation`, CSP, allowlist http/https ✓ |
| i18n (en/es/fr/de/pt-BR) | 912 claves exactas en los 5, sin huecos |
| TODO/FIXME/HACK reales | 0 |
| `catch {}` vacíos | 0 |
| Elementos clicables no semánticos (`div`/`span` + onClick) | 0 |
| Lint | 4 errores reales; el resto, formato |

Dos cosas que **no** son problemas, pese a parecerlo:

- **`TrackList` no está sin optimizar.** Usa `memo` en filas, callbacks estables y `content-visibility` en lugar de virtualización — decisión deliberada y documentada (TrackList.tsx:253, 289) para no romper teclado ni lectores de pantalla.
- **Las capturas de la guía sí tienen `loading="lazy"`** (Guide.tsx:53). El problema es el peso por imagen, no la descarga inicial.

---

## Estado de los arreglos

Dos ramas, ninguna mergeada ni subida:

- **`worktree-audit-fixes-1.0`** — desktop, 7 commits. Suite: **3522 tests ✓** (partía de 3493).
- **`worktree-audit-web-1.0`** — web, 5 commits. Suite: **78 tests ✓** (partía de 69).

| # | Hallazgo | Estado |
|---|---|---|
| 1 | Progreso invisible en la fila seleccionada | ✅ arreglado + verificado en la app |
| 2 | Punto de "analizando" invisible | ✅ arreglado |
| 3 | Worker que muere sin `'error'` | ✅ arreglado (mutation-tested) |
| 4 | Cerrar sin avisar con conversiones vivas | ✅ arreglado + `quitGuard` con tests |
| 5 | Toasts apilados por carpeta | ✅ arreglado |
| 7 | Guía de 15 MB en PNG | ✅ arreglado → **1,9 MB** (−87%) |
| 8 | Capturas sin `width`/`height` (19 saltos) | ✅ arreglado (`aspect-ratio` verificado en navegador) |
| 9 | Aviso de sobrescritura bajo AA | ✅ arreglado: 3.80:1 → **5.16:1** |
| 10 | `icon.png` de 313 KB en todas las páginas | ✅ arreglado → **2,4 KB** (−99%) |
| 12 | `/funciones` fuera del sitemap | ✅ arreglado + guard anti-desincronización |
| 6 | `visibleTracks` rompe el memo | ✅ arreglado (`sameTracks`, mutation-tested) |
| 11 | ffmpeg huérfano al cerrar durante escaneo | ✅ arreglado (`killActiveScans`, mutation-tested) |
| 13 | Redirect de idioma tras hidratar | **requiere tu decisión** (ver abajo) |

**Los 13 hallazgos quedan cerrados salvo el #13**, que depende de una decisión tuya sobre producción.

### Impacto medido en la web

| Métrica | Antes | Después |
|---|---|---|
| `public/guide` | 15 MB (38 PNG) | 1,9 MB (38 WebP) |
| Carga inicial de `/en/guide` | ~1,5 MB en 3 imágenes | **59 KB en 3 imágenes** |
| Logo (todas las páginas) | 313 KB @1024px | 2,4 KB @128px |
| `apple-touch-icon` | 313 KB | 20 KB @180px |
| Saltos de layout en la guía | 19 | 0 |
| URLs en el sitemap | 6 (faltaban 2) | 8, todas responden 200 |

Las capturas se redimensionaron a **1440 px** porque medí el contenedor real en el navegador: se pinta a 718 px CSS como máximo, y 1440 es su 2× exacto para retina. Calidad verificada a ojo sobre la captura más comprimida — los números de loudness y el espectrograma siguen legibles.

### Pendiente de tu decisión: #13 (redirect de idioma)

`vercel.json` existe y es editable, pero un redirect por `Accept-Language` **cambia qué HTML recibe cada visitante en producción** y no puedo verificarlo localmente (`vite preview` no ejecuta el edge de Vercel). Un error ahí puede provocar bucles o dejar la home inaccesible. Propuesta concreta cuando lo autorices:

```json
"redirects": [
  { "source": "/", "has": [{ "type": "header", "key": "accept-language", "value": "^(?!es).*" }],
    "destination": "/en", "permanent": false }
]
```

### Peso muerto detectado (no tocado)

`public/icon.png` (320 KB) ya no lo referencia nadie —verificado: cero referencias— pero sigue copiándose a `dist` en cada despliegue porque vive en `public/`. Lo he conservado por ser la fuente 1024px de la que derivan `icon-128.webp` y `apple-touch-icon.png`. Si prefieres moverla fuera de `public/`, son 320 KB menos por despliegue.

**Correcciones al análisis original, descubiertas al arreglar:**

- **El #1 afecta a los DOS temas, no solo al claro.** Medido: claro 1.00 (mismo hex), oscuro 2.12 — ambos por debajo del 3:1 relajado. El remedio (`--color-on-row-selected`) da 6.77 y 5.33 respectivamente.
- **El #3 no se dispara por OOM.** Comprobado empíricamente en Node v26.5.0: un worker que agota memoria **sí** emite `'error'`, luego esa ruta ya estaba cubierta. Lo que emite solo `'exit'` es `process.exit()` (código 0) y `terminate()` externo (código 1) — el disparador realista es un crash nativo de `node-taglib-sharp`.
- **El #4 necesitaba más que un `preventDefault`.** El evento `close` es síncrono y la decisión asíncrona, así que el guard se extrajo a `quitGuard.ts` con 5 tests, incluido el caso de ⌘Q llegando mientras el diálogo de la X ya está abierto (un solo diálogo, no dos).

### Tests inestables bajo carga (identificados)

La suite es **verde en condiciones normales (3522/3522)**, pero bajo carga paralela degrada. Aislado con una baseline sobre el árbol limpio, sin ninguno de estos cambios:

| Fichero | Test |
|---|---|
| `App.test.tsx` | clipping del sidebar; prefetch del espectro con la sección plegada; reseed del destino del editor |
| `Editor.test.tsx` | apertura de la fase de audio |
| `usedKeys.test.ts` | referencias a claves de locale |

**No los causan estos cambios**: la baseline sin ellos daba 5 fallos, y la pasada final con todo aplicado da 0. `usedKeys.test.ts` pasa solo en aislamiento (1781 ms) — escanea todo el código fuente y es el más sensible.

La causa raíz es que hay tests de integración que invocan **ffmpeg real** (`ffmpeg.test.ts`, `convertCancel.test.ts`, `tags.test.ts`). La suite pasó de 20 s a entre 174 s y 1032 s según la carga de la máquina. Para la 1.0 no bloquea, pero en CI conviene aislar esos tests o subirles el timeout, o darán falsos rojos.

---

## Alta prioridad

### 1. En tema claro, el progreso de conversión es literalmente invisible en la fila seleccionada

`apps/desktop/src/renderer/src/index.css:54,65` · `components/TrackList.tsx:404,411`

Verificado directamente en los tokens. En tema claro:

```css
--color-accent:       #2959aa;   /* línea 54 */
--color-row-selected: #2959aa;   /* línea 65 */
```

El texto de etapa (`text-[var(--color-accent)]`) y la barra (`bg-[var(--color-accent)]`) se pintan **del mismo color hexadecimal exacto** que el fondo de la fila seleccionada. Contraste 1:1.

**Impacto:** al convertir la pista abierta en el editor —el flujo principal— se pierde toda la señal de progreso justo en la fila que más se mira. Las demás filas sí lo muestran, así que parece que esa pista se ha colgado.

El bloque `.is-primary` (index.css:585-602) ya remapea `track-quality`, `track-automatched` y `track-match-review`, pero se dejó fuera `track-stage`. Es un olvido, no una postura.

**Fix:** añadir `track-stage` (texto y `.progress-sweep`) al bloque `.is-primary`, usando `--color-on-row-selected`.

---

## Media prioridad

### 2. El punto de "analizando" desaparece sobre la fila seleccionada

`components/TrackList.tsx:479-480` — mismo origen que el anterior: `data-testid="track-quality-loading"` usa `bg-fg-faint` y no está en el bloque `.is-primary`. El indicador de que hay análisis en curso no se ve en la pista abierta.

**Fix:** añadir el testid a la regla de index.css:600 y usar `bg-current`.

### 3. Un worker que muere en silencio deja colgadas para siempre las promesas de sus jobs

`main/workerClient.ts:62` — solo se escucha `'error'`. Un `worker_thread` que termina por `process.exit()` o `terminate()` emite **solo `'exit'`** (el verificador lo comprobó empíricamente en Node v26.5.0: `error emitted? false`). Sin listener de `'exit'`, `pending` y `queue` nunca se vacían.

**Impacto:** onda cargando eternamente, o una conversión clavada en "converting" que nunca resuelve ni falla, con el `.tmp` a medias. Además `inFlightId` queda fijado y ese slot del pool muere el resto de la sesión.

El disparador realista es un crash nativo de `node-taglib-sharp`. El comentario del test (workerClient.test.ts:71) nombra "crash in native code" como escenario cubierto — y no lo cubre.

**Fix:** `spawned.on('exit', (code) => failEverything(new Error(...)))`. `failEverything` ya es idempotente.

### 4. Cerrar la app durante una conversión mata ffmpeg sin avisar

`main/index.ts:1374` — no existe ningún handler `win.on('close')` (solo `'closed'`, ya irreversible). Un ⌘Q con un lote largo en marcha descarta el trabajo en vuelo y lo encolado sin preguntar. No hay corrupción (el `catch` de `convertAudio` borra el `.tmp`), pero sí trabajo perdido en silencio.

**Fix:** `win.on('close')` con `preventDefault` + diálogo nativo si `activeConversions` tiene jobs vivos.

### 5. Un import de red apila un toast de "tags ilegibles" por cada carpeta

`renderer/src/App.tsx:460` — el walk emite `onBatch` una vez por directorio (expand.ts:92) y cada batch cierra su propio ciclo de contadores. Verificado con test: 3 batches fallidos → `[[1],[1],[1]]`, tres toasts.

En tu crate SMB de 560 carpetas eso son cientos de tarjetas apiladas tapando la UI durante todo el import. El comentario de useTrackLibrary.ts:156 dice que esto existe para dar *un* aviso agregado; no lo consigue.

**Fix:** `key: 'meta-read-failed'` en el `setNotice` (como ya hace `onProcessError` en App.tsx:737) y acumular el contador entre batches. Igual para `onDuplicatesSkipped` (App.tsx:459).

### 6. `visibleTracks` se recrea en cada cambio y rompe siempre el memo de `TrackList`

`renderer/src/App.tsx:907` — `.filter()` + `sortTracks` (`[...tracks].sort()`) devuelven array nuevo aunque el conjunto visible no cambie. `tracks` es la única prop no estable de `TrackList` (App.tsx:1638), así que su `memo` (TrackList.tsx:547) se rompe en cada patch por pista.

Matiz del verificador: el efecto es menor de lo que parece — `viewCache` preserva la identidad de cada view, así que el memo de `TrackRow` aguanta y **ninguna fila se repinta**. Se paga creación de elementos y N comparaciones shallow, no un repintado. Sobrecarga notable solo en crates grandes.

Vale la pena porque el arreglo ya existe en el mismo fichero: `selectedTracks` (App.tsx:849-856) usa una guarda de identidad con `useRef`. La asimetría delata el olvido.

### 7. La guía sirve ~8 MB de capturas a 2640×1640 en una columna de 700 px

`apps/web/src/components/Guide.tsx:50` — 38 PNG, 15 MB en total, cero WebP. Es ~4× más píxeles de los que se pintan. Con lazy carga a cuentagotas al scrollear; la primera imagen entra en la carga inicial con casi medio MB.

**Fix:** redimensionar a ~1400 px y pasar a WebP, como ya se hace con `hero-app.webp` (136 KB para 2000×1242). De ~8 MB a menos de 1 MB sin pérdida visible.

### 8. Las capturas de la guía no llevan `width`/`height`: la página salta 19 veces

`Guide.tsx:50` — cada `<figure>` nace a altura ~0 y salta a ~435 px al llegar la imagen. Con `loading="lazy"` el salto ocurre mientras el usuario lee. Además rompe los anclas `#id` del índice.

El resto del sitio sí cuida esto (`DownloadButton.tsx:98-103` reserva hueco a propósito), así que es un descuido.

**Fix:** `width={2640} height={1640}` en el `<img>`.

### 9. El aviso de sobrescritura se pinta por debajo de AA

`apps/web/src/App.tsx:68` — único texto del sitio bajo AA (3.8:1), y es precisamente el que avisa de que reexportar al mismo formato **reescribe el fichero original**. Va en `font-mono text-xs`, el tamaño más pequeño de la página.

`index.css:19-21` documenta que `#6b7396` se subió a `#828bb8` justo por fallar AA; el `/80` devuelve el color a ese rango y anula la corrección.

**Fix:** quitar el `/80` (deja 5.16:1). La jerarquía, con tamaño o margen.

### 10. `icon.png`: 313 KB a 1024×1024 para pintarse a 56 px, en todas las páginas

`apps/web/src/components/Header.tsx:83` (y Footer, DonateCompleted, DonateCancel) — ~80× más píxeles de los necesarios, en la carga crítica de todas las rutas.

**Fix:** `icon-128.webp` (~4 KB) para header/footer; el PNG de 1024 solo para `apple-touch-icon`. Añadir `width`/`height` a las cuatro `<img>`.

---

## Baja prioridad

### 11. El escaneo de canales spawnea ffmpeg fuera del alcance del kill de cierre

`main/channelScan.ts:18` — el spawn vive en el hilo worker; `app.on('will-quit')` solo llama a `activeConversions.killAll()`, que no lo conoce. Al cerrar durante un escaneo, queda un ffmpeg huérfano consumiendo CPU hasta el `timeout` de 120s.

### 12. `/funciones` no está en el sitemap

`apps/web/public/sitemap.xml:3` — la página con más términos de búsqueda (formatos, Discogs, Engine DJ, rekordbox) y destino del CTA de la home queda fuera. Los `lastmod` están congelados en 2026-06-17 con el changelog ya en v0.80.0.

**Fix:** añadir `/funciones` y `/en/features`; mejor, generar el sitemap desde el array `routes` en build.

### 13. La home redirige a `/en` tras hidratar: parpadeo y entrada en el historial

`apps/web/src/lib/useAutoLanguage.ts:27` — el visitante con navegador en inglés recibe el HTML español ya pintado y solo después navega a `/en`: ve el hero en español, parpadeo y recarga completa.

**Fix:** redirect por `Accept-Language` en el edge de Vercel.

---

## Higiene del repo (no bloquea la 1.0)

- **Biome desde la raíz falla**: no existe `biome.json` en la raíz y trata los dos configs de workspace como *nested roots*. Hay que lintar por workspace. (Los schemas **sí** están alineados con el binario 2.5.4 — no es el desajuste de versión de otras veces.)
- **`npm run check` usa `--write`**: reformatea en vez de comprobar. Conviene un `check` de solo lectura para CI.
- **4 errores de lint reales**: `noDescendingSpecificity` ×2, `useNodejsImportProtocol`, `noUselessFragments`.
- **3 ramas sin mergear**: `web-3d-flow`, `worktree-phrases-editor`, `worktree-player-gap`.

---

## Refutados (12)

Descartados tras verificación adversarial — se documentan para no volver a levantarlos:

| Hallazgo | Por qué se cae |
|---|---|
| `onDragOver` hace setState por evento | La traza se corta una capa antes; no llega a re-render |
| `matchesSearch` no hoistea la consulta | Benchmark reproducido: impacto no medible |
| ~8 lecturas síncronas de settings por pista | Mecanismo real, magnitud inobservable |
| `recordStat` escribe disco por pista | Íd. — no supera el listón de "se nota" |
| El handler `surco://` puede colgar el `<audio>` | Impacto falso por dos vías verificadas |
| El walk de carpetas agota descriptores | Todas las consecuencias empíricamente falsas |
| Cancelar un lote reporta "omitidas" | Citas exactas, conclusión no sostenida |
| La cabecera "File" del editor recorta botones | No reproduce |
| Dos radios distintos en botones de 32px | Hechos exactos, sin efecto observable |
| El grabador de atajos atrapa Enter/Espacio | Se cae por otra rama del código |
| El asistente no mueve el foco al cambiar de paso | `useFocusTrap` ya lo cubre |
| Escape no cierra el asistente | Ubicación citada incorrecta; refutado en tres frentes |

---

## Orden sugerido para la 1.0

1. **#1** (progreso invisible en tema claro) — una regla CSS, impacto alto en el flujo principal.
2. **#2** (punto de análisis) — misma regla, mismo sitio.
3. **#3** (`'exit'` del worker) — una línea; evita cuelgues sin salida.
4. **#4** (confirmar al cerrar con conversiones vivas).
5. **#5** (toasts apilados) — se nota en imports de red grandes.
6. **#7–#10** (web) — mecánicos y de alto retorno en carga y accesibilidad.

Del 6 al 13 caben perfectamente en una 1.0.x.
