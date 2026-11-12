# Revision de rendimiento: web Surco (apps/web)

## Resumen
1. El problema dominante es un unico bundle JS de 2,79 MB (819 KB gzip, 636 KB brotli) que carga en TODAS las paginas: los 6 idiomas y 6 changelogs (unos 4,8 MB de JSON) van estaticos en `src/i18n/index.ts:2-14`.
2. Aun asi, en laboratorio las metricas son buenas: LCP desktop 0,05-0,9 s, CLS 0,02, TBT 0-88 ms. En movil con throttling el LCP de `/` es 2,2 s y CLS 0,105 (sobre 0,1).
3. `/cambios` pesa 442 KB de HTML (unos 130-150 KB gzip estimado, no medido) y en movil su LCP fue 5,7 s (un SPAN, probablemente texto tardio o tras el scroll del script).
4. Cache: solo `/assets/*` es immutable (`apps/web/vercel.json:8-10`). Hero, capturas de guia, covers y espectros (`public/`, 52 MB en dist) usan el default de Vercel.
5. La funcion `api/feedback.ts` es trivial (un POST a Resend); no hay riesgo de coste ni cold start relevante. Metricas reales de Vercel NO obtenidas (ver abajo).

## Metricas de Vercel
- `vercel whoami` responde (CLI 62.4.0, sesion activa), pero `apps/web` no esta enlazado (no existe `.vercel/`) y la skill `vercel-optimize` marca vite-react-ssg como framework no soportado (exige parar y preguntar). Enlazar habria modificado el repo, asi que NO se han leido Speed Insights, invocaciones ni ancho de banda. Todo lo de abajo es laboratorio.
- Para completarlo: confirmar proyecto/equipo y ejecutar `vercel link` fuera del repo o con `--cwd` a un directorio temporal.

## Medidas (hechos medidos, Brave headless, vite preview local)
Movil: 390x844 @2x, 150 ms latencia, 1,6 Mbit/s, CPU x4. Los bytes de JS son decodificados (tras gzip); transferidos serian unos 1,0 MB. Preview local no replica el CDN de Vercel (brotli, HTTP/2). El LCP incluye el scroll posterior que hace el script, asi que puede sobreestimar.

| Pagina | Perfil | FCP | LCP | CLS | TBT | Long tasks | Objetivo |
|---|---|---|---|---|---|---|---|
| / | desktop | 920 ms | 920 ms (img hero) | 0,025 | 88 ms | 1 (138 ms) | LCP<2,5 s, CLS<0,1, TBT<200 |
| /funciones | desktop | 48 ms | 48 ms | 0,021 | 0 | 0 | idem |
| /guia | desktop | 72 ms | 688 ms | 0,022 | 0 | 0 | idem |
| /cambios | desktop | 64 ms | 64 ms | 0,021 | 0 | 0 | idem |
| / | movil | 744 ms | 2192 ms (img hero) | 0,105 | 78 ms | 3 | idem |
| /funciones | movil | 588 ms | 588 ms | 0,072 | 39 ms | 2 | idem |
| /guia | movil | 556 ms | 556 ms | 0,078 | 35 ms | 2 | idem |
| /cambios | movil | 616 ms | 5680 ms (SPAN) | 0,072 | 54 ms | 3 | idem |

Bytes por pagina (decodificados): JS 3,18 MB en todas (app 2,79 MB + client 0,21 MB; mas gtag 182 KB de GTM), CSS 69 KB, fuentes 0 (stack del sistema, `src/index.css:38`), HTML 88-443 KB (/ 211 KB, /cambios 443 KB), imagenes `/` 231-289 KB (hero 129 KB + espectro JPG 102 KB), video 332 KB webm cargado en desktop.

Otros hechos:
- Un solo chunk: `dist/assets/app-LGdeMqvD.js`. No hay `lazy()`/`import()` en `src/*.tsx`.
- `dist/index.html` precarga `/logo.svg` y `/hero-app-es.webp` con fetchpriority alto (correcto); `preconnect` a api.github.com.
- Hero `dist/hero-app-es.webp` es 2000x1242 (129 KB) servido igual a movil (se muestra a unos 358 px CSS): sin `srcset`/`sizes` (`src/components/HeroApp.tsx:42-50`).
- Capturas de guia 1440x867 WebP 60-65 KB cada una; `dist/guide` 4,9 MB y `dist/use-cases` 25 MB (solo se descargan las vistas).
- `dist/og.png` 436 KB (solo scrapers, sin impacto de usuario). `dist/spectrum/*.jpg` 900x245 JPG 66-102 KB.
- CLS 0,105 en movil `/`: algo se desplaza al hidratar o al cargar; no localizado (hipotesis abajo).
- Funcion: `apps/web/api/feedback.ts` (4 lineas, importa `src/lib/feedbackMail.js`, usa `fetch` a Resend). Sin `functions`/`regions` en vercel.json: region y runtime por defecto. Bundle diminuto.

## Recomendaciones (ordenadas)
1. Dividir los recursos i18n por idioma y cargar solo el activo. Evidencia: `src/i18n/index.ts:2-14` importa 12 JSON (2,3 MB locales + 3,3 MB changelogs sin comprimir) en el bundle unico. Cada pagina de `/es` baja los otros 5 idiomas y changelogs que no usa. Opciones: `import()` dinamico por idioma en `createI18n` (SSG prerenderiza cada ruta con su idioma, asi que solo hace falta el suyo; el cliente hidrata con ese) y changelog en chunk aparte solo para `/cambios` y el LatestRelease. Ganancia esperada (estimacion): JS de ~820 KB gzip a unos 200-250 KB; menos parse en movil real. Esfuerzo M. Nota: la app de escritorio comparte los JSON del changelog (comentario en el fichero), no tocar su contrato.
2. Reducir el HTML de `/cambios` (443 KB) y los ~210 KB de cada home. Hipotesis: el HTML prerenderizado incluye todo el changelog/seccion expandida. Paginar o renderizar releases antiguas en cliente bajo demanda. Ganancia: LCP movil de `/cambios` (5,7 s medido, causa no confirmada). Esfuerzo M. Medir primero con Lighthouse real que elemento es el SPAN.
3. Cabeceras de cache para `public/`. Anadir en `apps/web/vercel.json` reglas para `/(.*)\.(webp|jpg|png|svg|webm|mp4)` con `max-age` largo (p. ej. 1 mes + `stale-while-revalidate`) o nombres con hash; hoy solo `/assets/` esta cubierto (`vercel.json:5-11`). Ojo: nombres como `hero-app-es.webp` no llevan hash, un max-age largo sin hash serviria imagenes viejas tras un cambio; usar `s-maxage` + `stale-while-revalidate` o hashear. Ganancia: visitas repetidas y menos ancho de banda. Esfuerzo S.
4. Hero responsive: generar 800/1200 px webp y usar `srcset`/`sizes` en `HeroApp.tsx:42`. Ganancia estimada: de 129 KB a unos 35-50 KB en movil, LCP movil de `/` (2,2 s medido) mejor. Esfuerzo S-M (los hero salen del driver de capturas).
5. Cargar gtag tras interaccion o `requestIdleCallback`/`load`: `GoogleAnalytics.tsx` ya lo hace en `useEffect`, pero 182 KB de GTM compiten con el hero en redes lentas. Ademas hay doble analitica (`@vercel/analytics` en `routes.tsx:358` y GA). Evaluar si ambas hacen falta. Esfuerzo S. Es decision de producto, no solo de rendimiento.
6. CLS movil `/` 0,105: hipotesis (no verificada) hero con `h-auto` a la espera del CSS, o la barra de estadisticas que cambia al cargar datos de GitHub (`preconnect api.github.com`, `LatestRelease.tsx`). Reservar altura minima en esos bloques. Verificar con `layout-shift` sources antes de tocar. Esfuerzo S.
7. Convertir `spectrum/*.jpg` a WebP/AVIF (66-102 KB, -50-70 % esperable) y comprimir `og.png` (436 KB). Ganancia pequena. Esfuerzo S.
8. Funcion de feedback: nada urgente. Opcional fijar `regions` a la cercana a Resend/usuarios si la latencia importara. Sin evidencia de coste.

## Hechos vs hipotesis
- Hechos: tamanos de chunk, ausencia de lazy loading, cabeceras de `vercel.json`, resoluciones de imagen, tabla de metricas de laboratorio, funcion sin config.
- Hipotesis: reduccion de JS tras dividir idiomas, causa del CLS movil y del LCP 5,7 s de `/cambios`, tamanos transferidos reales en el CDN (brotli) y datos de campo (Web Vitals reales) sin comprobar.
- No se modifico ningun fichero del repo; preview detenido. Scripts de medida en el scratchpad (`lab.cjs`, `lab.out`).
