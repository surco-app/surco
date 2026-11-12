# Revisión de prácticas React (Vercel) de Surco

Alcance: renderer de escritorio (apps/desktop/src/renderer/src) y web (apps/web/src). Solo lectura. Rutas relativas a esos directorios. Sin medir con profiler: lo que depende de medición va marcado.

## Resumen

1. La pasada de rendimiento reciente está bien hecha: casi todo lo que App.tsx pasa a Toolbar, TrackList y Editor es estable (useMemo, useCallback o useStableCallback), y no encontré props inestables que rompan los memo de esos tres. El problema que queda es estructural: App.tsx tiene 4520 líneas, 39 efectos y 136 useStableCallback.
2. El mayor hallazgo con impacto de usuario está en la web: un único bundle JS de 2,79 MB (app-LGdeMqvD.js) que sirve todas las rutas e incluye los 6 idiomas y los 6 changelogs (1,1 MB de locales + 1,6 MB de changelog) en cada página.
3. En el escritorio, el Editor se desmonta y vuelve a montar entero en cada cambio de pista (App.tsx:4256, key por pista) con 72 hooks y todas las secciones (Cues, Trim, Declick, Discogs) dentro del mismo chunk de 318 KB. Es lo primero que medir.
4. Hay efectos que deberían ser estado derivado y provocan un render intermedio incoherente (poda de selección al filtrar, App.tsx:2419 y 2428; formato de filtro, 2281; dials de normalizar/declick en Editor.tsx:610).
5. useStableCallback/useLatest escriben el ref durante el render (hooks/useLatest.ts:6): funciona en StrictMode pero es frágil con useDeferredValue y Suspense. Hay además lecturas de refs mutables en render pasadas a un Editor memoizado (App.tsx:4290).

## Hallazgos, de mayor a menor impacto

### 1. Web: un solo chunk de 2,79 MB con todos los idiomas y changelogs
- Archivo: apps/web/src/i18n/index.ts:3-35 y apps/web/src/routes.tsx:1-20, 31-35, 313-330.
- Regla: bundle-dynamic-imports, bundle-conditional.
- Por qué importa: i18n/index.ts importa estáticamente los 6 locales y los 6 changelog JSON y los mete en `resources`; routes.tsx importa estáticamente todas las páginas (Guide, Changelog, Features, UseCases, Stats, Privacy...). dist/assets/app-*.js pesa 2.792.602 bytes. Cada página prerrenderizada solo necesita su idioma y sus componentes. La hidratación espera a parsear todo eso, también en móvil. src/i18n/changelog pesa 1,6 MB por sí solo y solo lo usa /cambios y LatestRelease (que solo lee el primer release).
- Arreglo: (a) cargar los recursos por idioma: `createI18n(lng)` con `import()` por locale y changelog (vite-react-ssg admite rutas con `lazy`), (b) rutas pesadas con `lazy: () => import(...)` en routes.tsx, (c) LatestRelease no debería arrastrar el array completo: extraer un `latest.json` pequeño por idioma en el script de build. Con SSG el HTML ya viene pintado, así que el lazy no produce parpadeo si el chunk de la ruta se precarga (vite-react-ssg lo hace con la ruta actual).
- Esfuerzo: M. Medir primero: `vite-react-ssg build` y tamaño gzip por ruta, y LCP/TBT en Lighthouse móvil. No pude ejecutar la build; las cifras son del dist presente.

### 2. Editor se remonta entero por pista y es muy pesado de montar
- Archivo: App.tsx:4256-4258 (`<ErrorBoundary key={selected.id}>`), components/Editor.tsx:282 (memo, 72 llamadas a hooks, ~65 props declaradas), Editor.tsx:1757-1930 (secciones).
- Regla: rerender-memo, rerender-transitions, rendering-activity, bundle-conditional.
- Por qué importa: la key es deliberada (contrato de sembrado de estado), pero implica que moverse con flechas por la lista paga el montaje completo del Editor (CuesSection 2382 líneas, TrimSection 1266, DeclickSection, DiscogsPanel, WaveformCompare). El resaltado de fila y el editor van en el mismo render urgente, así que si el montaje es lento la fila se queda atrás de la tecla.
- Arreglo (ordenado por coste): (1) medir el montaje con React Profiler tras flecha-abajo en una lista de 500 pistas; (2) si pasa de un frame, `const shown = useDeferredValue(selected)` para el Editor, con la fila resaltada usando la selección inmediata; así el resaltado es instantáneo y el Editor se pone al día en una pasada interrumpible; (3) no montar el cuerpo de las secciones plegadas (useEditorSections ya conoce el estado de plegado) y/o `lazyChunk` para CuesSection y TrimSection.
- Esfuerzo: M. Requiere medir primero.

### 3. Efectos que podan la selección después del render (estado derivado en efecto)
- Archivo: App.tsx:2419-2423 (filtros), 2428-2434 (búsqueda), 2281-2285 (formatFilter), 2107-2125 (playlistIds).
- Regla: rerender-derived-state-no-effect, rerender-move-effect-to-event.
- Por qué importa: al cambiar el filtro se pinta primero un frame con una selección que ya no está visible (editor apuntando a una pista oculta, contador "‒/N") y luego el efecto llama a `setSelection`, que además ejecuta `flushPendingEdits()` (efecto lateral) dentro de un efecto. Los dos primeros llevan biome-ignore de dependencias porque leen `visibleTracks` y `selection` del render: es la señal de que no son realmente efectos.
- Arreglo: hacer la poda en el manejador que cambia el filtro (`setFilterSelection`, `setFormatFilter`) o derivar la selección efectiva en render (`effectiveSelection = useMemo(() => pruneToVisible(...) ?? selection)`) y consolidar al siguiente evento. Para la búsqueda diferida el efecto sobre `deferredSearch` es defendible, pero entonces mover la lógica a un hook `useSelectionPrune` con dependencias reales y sin biome-ignore.
- Esfuerzo: M (hay tests de comportamiento que cubrir; el caso "no saltar de pista al teclear" ya está documentado en el comentario).

### 4. Editor copia dials de la pista a estado local mediante efecto
- Archivo: components/Editor.tsx:606-618 (normalize y declick), también 595-602 (efecto de solo montaje que reporta hacia arriba).
- Regla: rerender-derived-state-no-effect, rerender-dependencies.
- Por qué importa: `setNormalizeCfg(item.normalize)` y luego `onNormalizeChange` hacen dos pasadas (render, efecto, setState local, callback a App, setState en App, render de nuevo del Editor memoizado). Es un ciclo ida y vuelta evitable que además repinta secciones pesadas justo cuando llega la lectura de metadatos de la pista.
- Arreglo: calcular `const normalizeCfg = userPick ?? item.normalize ?? settingsDefault` en render (patrón "valor controlado con override") y que `onNormalizeChange` se llame solo desde el manejador de usuario.
- Esfuerzo: M.

### 5. Escritura de refs durante el render en useLatest / useStableCallback
- Archivo: hooks/useLatest.ts:6, hooks/useStableCallback.ts:10-12; ~25 asignaciones `xRef.current = ...` en render en App.tsx (551-574, 1998-2001, 2164-2168, 2251, 2338-2360, 3630).
- Regla: advanced-use-latest, advanced-event-handler-refs.
- Por qué importa: con `useDeferredValue` (App.tsx:507) y Suspense, React puede iniciar un render que descarta; ese render ya habrá puesto en el ref un cierre de una versión no confirmada, y un listener nativo (IPC, timers) lo vería. Hoy funciona porque App no suspende en su propio render, pero es la clase de bug que aparece cuando alguien añade una transición. No encontré un caso roto hoy.
- Arreglo: asignar en `useInsertionEffect` (patrón recomendado para "latest ref", corre antes de los efectos de layout y no en render descartado) dentro de useLatest; las ~25 asignaciones sueltas de App pueden pasar por `useLatest(value)` para tener un solo sitio.
- Esfuerzo: S para useLatest/useStableCallback; M para App.

### 6. Prop de ref mutable leída en render hacia un Editor memoizado
- Archivo: App.tsx:4290 (`autoMatchDeclined(selected.id)`), 4298-4299 (`rememberedPick(selected.id)`); hooks/useAutoMatch.ts:132, 456, 527, 537; hooks/useEditorPicks.ts:82.
- Regla: rerender-defer-reads (al revés: aquí se lee fuera de la suscripción), rerender-use-ref-transient-values.
- Por qué importa: `declined` es un `Set` en un ref que se muta en deshacer/rehacer de matches; el booleano se pasa como prop a un componente memoizado, de modo que solo se refresca si App re-renderiza por otro motivo. El deshacer de un match cambia además los tags de la pista, lo que probablemente fuerza el render, por eso no lo vi roto. Necesita verificación con un test (deshacer match sin otro cambio de estado).
- Arreglo: pasar el estado a useSyncExternalStore o a un contador de versión del set, o moverlo al appStore que ya existe (lib/appStore.ts).
- Esfuerzo: S.

### 7. Suspense con fallback null alrededor de CopiesScreen y Editor
- Archivo: App.tsx:3948, 4263, 4447.
- Regla: async-suspense-boundaries, rendering-hoist-jsx.
- Por qué importa: el Editor está precargado en un efecto tras el primer render (App.tsx:658), así que el hueco solo existe si el usuario selecciona antes de que acabe la carga: aceptable y documentado en el comentario. CopiesScreen y los modales (4447) no se precargan: la primera apertura muestra un panel vacío un instante. Los modales ya están en `lazyChunk` y existe `preloadLazy` (lib/lazyChunk.ts:10) pero solo lo llaman los tests: en producción no hay precarga ociosa de los demás chunks.
- Arreglo: llamar a `preloadLazy()` en `requestIdleCallback` tras el primer pintado (una línea en main.tsx o en el efecto de App.tsx:658), o precargar CopiesScreen al pasar el ratón por el icono de copias (bundle-preload). Los fallback null están bien para modales.
- Esfuerzo: S. Medir el tamaño que se baja tras el inicio para no competir con la carga de la biblioteca.

### 8. Editor con ~65 props: candidato a contexto de acciones
- Archivo: App.tsx:4264-4326 (62 props pasadas), components/Editor.tsx:282-380.
- Regla (composición): architecture-avoid-boolean-props, state-context-interface, state-lift-state.
- Por qué importa: es prop drilling puro; cada acción nueva toca App.tsx, el tipo de Props de Editor y el test. La estabilidad actual de los callbacks hace que sea correcto, no que sea mantenible. Además cada sección vuelve a recibir lo que necesita desde Editor, que los pasa de nuevo.
- Arreglo: un `EditorActionsContext` (interfaz `{ state, actions, meta }`) provisto por una función `EditorProvider` en App; las secciones (Cues, Trim, Declick, Normalize, Properties) leen lo suyo con `use(EditorActionsContext)` (React 19). El valor sería un objeto estable construido con las ya estables useStableCallback. Hay un precedente en el repo: MusicReviewProvider (components/MusicReviewColumn.tsx:156-180) y SettingsProvider.
- Esfuerzo: L (migrar por secciones, de una en una, para que cada commit sea pequeño).

### 9. App.tsx hace demasiado: listeners y toasts mezclados con orquestación
- Archivo: App.tsx:1067-1160 (USB feed y toasts), 1408-1500 (toasts de nuevas pistas, updates, sync issues), 2062-2075 (toast library-check), 1649-1700 (priorización y auto-match).
- Regla: rerender-move-effect-to-event, advanced-init-once; composición: state-decouple-implementation.
- Por qué importa: ~12 efectos del tipo "suscribirse a IPC y empujar un toast" no dependen del resto del estado de App, pero viven en el mismo componente que se renderiza por cada cambio de pista. Moverlos no cambia el rendimiento (los efectos no re-ejecutan), pero hace de App.tsx un fichero revisable y baja el coste cognitivo de los `useStableCallback`.
- Arreglo: extraer a hooks `useAppNotifications(store)` y `useUsbExportToasts(...)` sin tocar comportamiento (refactor puro, un commit cada uno). Solo es mover.
- Esfuerzo: M.

### 10. Contexto de ajustes provoca render de todas las filas visibles en cada guardado
- Archivo: lib/settingsContext.tsx:267-293; components/TrackList.tsx:530 (`useAppSettings()` dentro de TrackRow).
- Regla: rerender-derived-state, rerender-memo.
- Por qué importa: `resolveSettings` produce un objeto nuevo en cada guardado y TrackRow solo lee `keyNotation`; cada guardado de ajustes (por ejemplo conmutar la onda) re-renderiza todas las filas montadas (virtualizadas, así que serán ~30-50) y todos los demás consumidores. Poco frecuente, impacto bajo; solo importa si se guardan ajustes a menudo (p. ej. al arrastrar un control).
- Arreglo: pasar `keyNotation` como prop primitiva desde TrackList (que ya consume el contexto una vez), o `useSyncExternalStore` con selector. Medir primero si algún guardado ocurre durante scroll o drag.
- Esfuerzo: S.

### 11. Fallos menores de render en TrackList
- Archivo: components/TrackList.tsx:416-440 (`new Intl.DateTimeFormat` dentro del render de cada fila con backup), 384-414.
- Regla: js-cache-function-results, js-hoist-regexp (aplicado a Intl).
- Arreglo: cachear el formateador por idioma en un Map a nivel de módulo. Solo pasa en filas con backup, así que el beneficio es pequeño.
- Esfuerzo: S.

### 12. Efectos de reinicio por prop (reset por evento)
- Archivo: components/CopiesScreen.tsx:349-353, components/RekordboxQueuePill.tsx:51-55, components/MusicReviewDetail.tsx:563-566 (`setInfo({})` al cambiar la clave), hooks/useDiscogsBrowser.ts:430-440.
- Regla: rerender-derived-state-no-effect, rerender-move-effect-to-event (patrón "ajustar estado al cambiar una prop": `key` o comparar en render).
- Por qué importa: cada uno provoca un render extra con estado viejo (por ejemplo la confirmación de vaciar sigue visible un frame al cerrarse). Impacto visual mínimo.
- Arreglo: `key` en el subárbol (CopiesScreen ya recibe `key={copiesOpen.key}` desde App.tsx:3951) o poner el estado a cero en el manejador de cierre.
- Esfuerzo: S cada uno.

### 13. Lotes de props inline a componentes no memoizados
- Archivo: App.tsx:3880-3915 (SourceRail con `copies={{...}}`, `onSelect`, `onHide` inline), 3951-3965 (`trash={{...}}` a CopiesScreen).
- Regla: rerender-memo-with-default-value.
- Por qué importa: SourceRail y CopiesScreen no están en memo, así que se re-renderizan con App de todos modos; el objeto inline no empeora nada hoy. Si alguien los envuelve en memo, el memo no funcionará sin pensar en ello. Anotarlo como trampa de mantenimiento.
- Arreglo: solo cuando se decida memoizarlos, sacar `copies` y `trash` a useMemo. No tocar ahora.
- Esfuerzo: S.

### 14. React 19: useContext y APIs nuevas
- Archivo: components/MusicReviewColumn.tsx:182, 212, 226, 238; components/ModalShell.tsx:70; lib/settingsContext.tsx:293; lib/openSettingsContext.tsx:23; lib/toastContext.tsx:38; components/settings/SettingsPrimitives.tsx:49.
- Regla: react19-no-forwardref (use en lugar de useContext).
- Por qué importa: no hay forwardRef (bien). `useContext` funciona y no es un problema; `use()` permitiría leer el contexto tras un `return` condicional, por ejemplo en MusicReviewColumn.tsx:182 donde hoy se llama al hook y luego se sale con `if (!shared) return null`. Sin ganancia de rendimiento.
- Arreglo: migrar solo si se toca el fichero. Esfuerzo: S.

### 15. useOptimistic / useTransition: oportunidad, no urgencia
- Archivo: hooks/useRekordboxEdits.ts y la ruta de "pintar la edición de playlist de inmediato y preguntar luego" (commit 8e5f1d64f), hooks/useAutoMatch.ts.
- Regla: rerender-transitions, rendering-usetransition-loading.
- Por qué importa: el repo ya implementa a mano el patrón optimista (estado pendiente + reversión). `useOptimistic` encajaría para los cambios que esperan la respuesta de cerrar un programa DJ, pero la lógica de "pintar ya, preguntar luego, descartar si se cancela" ya está probada con tests y reescribirla sería riesgo sin beneficio visible. Solo vale la pena para código nuevo.
- Esfuerzo: M. No recomendado ahora.

### 16. Bundle del renderer: chunk principal de 1,24 MB
- Archivo: apps/desktop/out/renderer/assets/index-Du_SmBl6.js (1.238.101 bytes minificado), electron.vite.config.ts:35-45.
- Regla: bundle-conditional, bundle-barrel-imports.
- Por qué importa: contiene App.tsx (4520 líneas) + `en.json` (~220 KB en el chunk de idioma, importado estáticamente en i18n/index.ts:3) + react-query + virtual + el resto. En Electron se lee de disco, así que el parseo (no la red) es el coste. El resto de idiomas ya son lazy.
- Arreglo: medir con `rollup-plugin-visualizer` antes de actuar; candidatos probables: MusicReview (1518 líneas, importado estático en App.tsx:77-83 aunque solo se usa al abrir la revisión) y el motor de reglas del bundle de Toolbar/FilterBar. Se puede pasar MusicReview a `lazyChunk` como hicieron con CopiesScreen.
- Esfuerzo: S para el lazy; M para la medición. Medir primero.
- Nota: hay dos copias de cada chunk de idioma en out/ (por ejemplo ja-CeLdoO3b y ja-CelYksUQ), son restos de dos builds, no un problema de código.

### 17. Web: rutas con cálculo de filtros en render y formateadores creados por render
- Archivo: apps/web/src/components/UseCases.tsx:28-31 (`cases.filter` en cada render), apps/web/src/components/Stats.tsx:40-52 (`new Intl.NumberFormat` por render de `useFormat`).
- Regla: rerender-memo, js-cache-function-results.
- Por qué importa: tamaños pequeños (decenas de casos), impacto despreciable. Solo si crece la lista.
- Arreglo: useMemo / formateador por idioma a nivel de módulo. Esfuerzo: S.

### 18. Web: hidratación sin problemas, con dos puntos a vigilar
- Archivo: apps/web/src/components/UseCases.tsx:33-37, apps/web/src/components/Header.tsx:33-35, 44-47.
- Regla: rendering-hydration-no-flicker, rendering-hydration-suppress-warning.
- Estado: lectura de `window`/`document`/`matchMedia` en efectos o manejadores, nunca en render. Bien. Los filtros de UseCases se leen de `window.location.search` en un efecto tras la hidratación: el listado se pinta sin filtro y luego se filtra (un parpadeo si llegas con `?q=`). Es la forma correcta de evitar mismatch; solo costaría resolverlo con un script en línea (rendering-hydration-no-flicker), que no recomiendo por la poca frecuencia del caso.
- Esfuerzo: S si se quisiera.

### 19. Web: imágenes en buen estado, mejoras pequeñas
- Archivo: components/HeroApp.tsx:42-48 (`fetchPriority="high"`, `decoding="async"`, width/height: bien), components/Guide.tsx:64-72, components/UseCase.tsx:227-233 y 277-284 (lazy + dimensiones: bien), components/Header.tsx:150-156.
- Regla: rendering-resource-hints.
- Por qué importa: todo con dimensiones declaradas y lazy salvo el hero. La única oportunidad: el hero `hero-app-*.webp` pesa ~130 KB a 2000 px de ancho sin `srcset`; en móvil se descarga a tamaño completo. Además `HeroApp` no tiene `<link rel="preload" as="image">` en el `<Head>`, y el vídeo está con `preload="none"` (correcto).
- Arreglo: añadir un `srcset` con una variante de 1000 px y `sizes`; preload del hero en DocumentHead (routes.tsx:50-80). Medir LCP antes.
- Esfuerzo: S.

### 20. Web: GoogleAnalytics y Analytics en el layout raíz
- Archivo: apps/web/src/routes.tsx:353-362.
- Regla: bundle-defer-third-party.
- Estado: `GoogleAnalytics` inyecta el script en un efecto tras hidratar (GoogleAnalytics.tsx:27-30) y solo en producción: correcto. `@vercel/analytics/react` se importa estático (entra en el bundle de todas formas, ~pocos KB). No hay nada que hacer salvo mencionarlo.

## Cosas que revisé y están bien (no tocar)
- memo + useStableCallback en Toolbar, TrackList, Editor, SourceTree: todas las props derivadas (reorder, bindings, treeEdit, pendingCuePaths, unsavedCueIds, autoMarkById, gridNoteOf, outsideFilterIds, cueTargets...) están en useMemo o son callbacks estables; no vi ninguna función inline en esos tres.
- `useDeferredValue` para la búsqueda (App.tsx:507) con el cuadro de texto sobre el valor inmediato: patrón correcto.
- Posición de reproducción fuera de App (hooks/usePlayer.ts:101, LivePlayer): App no se re-renderiza por cada `timeupdate`.
- Modales y pantallas en lazyChunk (components/Overlays.tsx:26-60, App.tsx:301-312), locales no ingleses y changelog del escritorio cargados bajo demanda (lib/changelog.ts:8-13, i18n/index.ts:12-18).
- Virtualización con @tanstack/react-virtual en TrackList y IntersectionObserver compartido por fila.
- Ningún `forwardRef`, ningún componente definido dentro de otro que haya visto en las rutas calientes.

## Orden sugerido
1. Web bundle por idioma y por ruta (hallazgo 1).
2. Medir el montaje del Editor por pista y decidir useDeferredValue (hallazgo 2).
3. Efectos de poda de selección y dials de Editor (3 y 4), cada uno con su test.
4. useLatest en useInsertionEffect y revisar la lectura de `autoMatchDeclined` (5 y 6).
5. Precarga ociosa y MusicReview lazy (7 y 16) tras medir.
6. Composición y extracción de hooks de App.tsx (8 y 9) por pasos pequeños.
