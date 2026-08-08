# Auditoría de usabilidad de Surco

Fecha: 2026-08-08 · Base: `main` @ d435b9cf (v0.82.0)
Método: 4 lentes en paralelo (flujos de escritorio · editor/reproductor · onboarding/ajustes · web) sobre el código, más verificación en la app real conducida con el driver y en el `dist/` construido de la web.

Alcance: **usabilidad de lo que ya existe**. Ninguna propuesta añade funcionalidad nueva.

---

## Estado de los arreglos

Nueve commits en `worktree-auditoria-usabilidad`, sin mergear. Suites tras los cambios:
**escritorio 3547 ✓** (partía de 3493) · **web 80 ✓** (partía de 78). Typecheck limpio en
ambos; el `dist` de la web reconstruye sin errores.

| # | Hallazgo | Estado |
|---|---|---|
| 1 | El wizard ofrece «sobrescribir el original» | ✅ arreglado + test + **verificado en la app** |
| 2 | 25 punteros «Ajustes → X» rotos en 5 idiomas | ✅ arreglado y verificado uno a uno |
| 3 | El declick no persiste por pista | ✅ arreglado + 3 tests (ver matiz abajo) |
| 4 | El emparejado de álbum fuera de ⌘Z | ✅ arreglado |
| 5 | El trim en lote no es deshacible | ✅ acción «Deshacer» en su toast, 5 idiomas |
| 10 | El HTML prerenderizado dice «Ver descargas» | ✅ arreglado + **medido en el `dist`** |
| 11 | 3 peticiones a GitHub por visita | ✅ caché de sesión + test |
| 12 | Copy huérfana (`heroFree`, `ledeShort`) | ✅ `heroFree` enchufada; `ledeShort` borrada (tu decisión) |
| 13 | Aviso de SmartScreen solo en `/funciones` | ✅ bajo el botón, solo en Windows |
| 14 | No se dice cuánto pesa la descarga | ✅ leído del `size` que ya venía en la respuesta |
| 15 | Enlace Intel en el estilo más tenue | ✅ subido a `text-muted`, sin tocar el CLS reservado |

Segunda tanda (mismo worktree):

| # | Hallazgo | Estado |
|---|---|---|
| 7 | Sin filtro para «a revisar» ni para «con error» | ✅ dos buckets nuevos + 5 tests, en los 5 idiomas |
| 8 | Soltar una carpeta sin audio no da señal | ✅ aviso keyed + 2 tests, en los 5 idiomas |
| 6 | Aceptar una sugerencia no tiene camino de ratón | ⬜ pendiente |
| 9 | Cancelar un lote no deja rastro | ⬜ pendiente (ver nota) |

**Nota sobre el #9:** el arreglo está identificado y es pequeño — el `finally` de
`useTrackProcessing.ts:488` ya captura `const cancelled = cancelBatchRef.current` y no lo
usa; basta añadir `cancelled` a `BatchSummary` (`lib/batch.ts:34`), propagarlo, y tratarlo
como el caso persistente en `clearSummaryLater`. Lo dejo sin implementar porque
`useTrackProcessing.test.tsx` devolvía lecturas inconsistentes entre herramientas en esta
sesión (grep y awk mostraban contenidos distintos para la misma línea), y editar a ciegas
un fichero de 3556 tests en verde no compensa.

**Del 6 y el 9, y del 16 al 25, quedan sin tocar** — son los que describo abajo y no entraban
en el bloque de mayor riesgo.

### Matiz importante sobre el #3 (declick por pista)

Al arreglarlo descubrí que **el lote aplana el filtro a todas las pistas**: `processAll`
pasa un único `declickOverride`/`normalizeOverride` a cada trabajo
(`useTrackProcessing.ts:470-478`), y el main resuelve `job.declick ?? settings.declick`.

Es decir, **`normalize` tiene exactamente la misma limitación** — no es algo que
introdujera el declick. Lo que el arreglo consigue es lo que su comentario prometía: que
el nivel dialado sobreviva al cambio de pista en el editor y no se re-siembre del global.
Que un lote respete el valor por pista sería un cambio de contrato aparte, no una
corrección de usabilidad, y no lo he hecho.

### Correcciones a este informe, descubiertas al arreglar

- **`heroFree` no estaba en los dos idiomas**, solo en español (`hero.heroFree`). El
  informe decía que sí. Al enchufarla hubo que añadir la inglesa.
- **Ambas claves viven bajo `hero.`, no bajo `home.`** como citaba el informe.
- El guard `usedKeys.test.ts` —el mismo que detectó estas huérfanas— exige que toda clave
  se use, así que dejar `ledeShort` sin enchufar no era una opción neutral: había que
  usarla o borrarla.
- **Node 26 define `sessionStorage` de forma nativa**, así que el caché del #11 tuvo que
  extraerse a `fetchReleasesCached` para que `fetchAllReleases` siguiera siendo pura y
  los tests no se contaminaran entre sí.

---

## Resumen

34 hallazgos brutos, 21 retenidos tras verificación. Ninguno es un bug de corrección: la app hace lo que dice el código. Lo que fallan son **contratos entre el código y lo que el usuario lee o encuentra**.

Un patrón domina el informe y conviene enunciarlo antes que los hallazgos:

> **Casi todo lo grave es un texto que miente o un dato que existe y no se expone.**
> Trece de los veintiún hallazgos se arreglan con cadenas de i18n o con una línea.

Eso dice algo bueno del proyecto: la lógica está bien construida y bien razonada. Los comentarios del código son de una calidad poco común — y justamente por eso son la mejor prueba de los hallazgos: en seis casos **el propio comentario declara un contrato que el código de al lado incumple**.

### Lo que verifiqué y está bien (para no volver a levantarlo)

- **Los botones de icono sí tienen tooltip.** Mi primera sospecha —barra de 7 iconos sin etiqueta— es falsa: `Tooltip.tsx` da tooltip propio con retardo de 400 ms, muestra el atajo, se ancla al cursor, se cierra con Escape y tiene ruta de teclado. Verificado en pantalla.
- **Las acciones destructivas sí confirman.** `useConfirmFlows.ts` distingue selección de filtro, cuenta lo que va a pasar y razona incluso por qué *no* confirma en el ✕ de una fila (evitar que el usuario aprenda a descartar diálogos sin leer). Es de lo mejor del repo.
- **La web no hace ninguna promesa falsa.** Contrastadas las 12 afirmaciones de `funcionalidades.md §12` contra la web: cue points, Apple Music, Engine DJ, BPM/tonalidad, "ya está en tu biblioteca" y clics enterrados están todos descritos con su matiz correcto.
- **El idioma sí se aplica en caliente** (`useSettings.ts:135-137`), sin relanzar.

---

## Prioridad 1 — Contratos rotos que tocan los ficheros del usuario

### 1. El asistente inicial ofrece «Sobrescribir el original», contra su propio contrato escrito

`components/OnboardingWizard.tsx:172` · contrato en `components/DestinationPicker.tsx:6-7`

El contrato del componente compartido dice literalmente:

> *"The choices on offer — the caller filters (onboarding drops the destructive 'overwrite'; Settings drops the Apple options off macOS)."*

El filtro del wizard es `DESTINATIONS.filter((d) => isMac || d !== 'appleMusic')`: **solo excluye Apple Music**. De los dos llamadores, el onboarding no cumple su mitad.

**Verificado en la app real:** `onboarding-destination-overwrite` está presente y visible en el paso 3 de 4, como última opción. Su única advertencia es una línea gris tenue. Ninguno de los avisos fuertes que la app monta después (`OverwriteNotice`, `overwriteLossyHint` — *"el máster se pierde y no se puede recuperar"*) existe aquí.

Un usuario que aún no ha cargado un solo fichero elige el modo destructivo con la fracción de información que la app considera insuficiente en cualquier otro punto. Y ningún test del bloque `describe('OnboardingWizard destination')` afirma su ausencia, así que nada avisó cuando desapareció del filtro.

**Arreglo:** añadir `d !== 'overwrite'` al filtro, más un test que lo fije. Ajustes lo sigue ofreciendo, con el editor avisando detrás.

---

### 2. El aviso de «se pierde el máster» manda a una pestaña que no existe

`i18n/locales/*.json:401,403` (los 5 idiomas)

`overwriteLossyHint` — el mensaje más caro de la app, el que avisa de que estás a punto de sustituir un máster sin pérdida por un MP3 irrecuperable — termina diciendo: **«Desactívalo en Ajustes → Conversión».**

Verificado: la pestaña se llama **«Formato»** en la barra lateral (`settings.tabs.conversion` = "Formato"), y el ajuste `overwriteOriginal` **ni siquiera vive ahí**: está en `DestinationTab.tsx` («Destino»).

Ni el nombre ni la ubicación coinciden. El usuario abre Ajustes buscando "Conversión", no la encuentra, prueba la que más se parece ("Formato") y el ajuste tampoco está.

Son cuatro punteros rotos en total (`:401`, `:403`, `:896` y `:908` — los dos últimos mandan a "General" el token de Discogs, que está en "Búsqueda", y el auto-añadir a Apple Music, que está en "Destino"). El quinto puntero del mismo patrón, `regenerateHint` → «Ajustes → Nombres», **sí acierta** — lo que demuestra que el patrón pretende ser literal y navegable.

Causa: restos de una división anterior de pestañas. El id interno `conversion` se filtró al texto de usuario mientras su etiqueta visible pasaba a «Formato».

**Arreglo:** reapuntar las 4 cadenas × 5 idiomas a la etiqueta visible correcta. Mejor aún, `openSettings('destination')` ya existe como deep-link: un botón evita el puntero textual del todo.

---

### 3. El nivel de reparación de clics se pierde al cambiar de pista

`components/Editor.tsx:409-411` · handler en `:1191-1194`

```ts
const [normalizeCfg, setNormalizeCfg] = useState(item.normalize ?? normalize)
// Per-track click repair, same contract as normalizeCfg.
const [declickCfg, setDeclickCfg] = useState(declick)
```

El comentario dice «mismo contrato que normalizeCfg». **No lo es.** `normalizeCfg` se siembra de la pista primero; `declickCfg` solo del ajuste global. Y el handler lo confirma: el de normalize llama `onChange({ normalize: n })` con el comentario *"Stage it on the track so coming back to it finds the dial as it was left, the way the silence trim already does"* — y el de declick carece exactamente de esa línea.

Verificado: **`TrackItem` no tiene campo `declick`** (`types.ts` tiene `trim` y `normalize`, no declick).

El usuario pone "Fuerte" en un vinilo polvoriento, salta a la siguiente pista, vuelve, y está en el valor global otra vez. Sin aviso. Sus dos vecinos en la misma sección (trim y normalize) sí persisten.

**Arreglo:** las tres líneas que normalize ya tiene — campo en `TrackItem`, siembra `item.declick ?? declick`, y `onChange({ declick: d })` en el handler.

---

### 4. El emparejado de álbum reescribe N ficheros fuera de ⌘Z

`App.tsx:1044-1049`

```ts
const onApplyMatches = useStableCallback((patches, provider) => {
  for (const p of patches)
    updateTrack(p.id, { ...p.patch, matched: true, matchProvider: provider })
})
```

No hay `recordMetaUndo`. Verificado: se llama en 4 sitios de `App.tsx` (757, 769, 1075, 1283) y este no es uno.

El usuario selecciona 12 pistas de un vinilo, pulsa «Aplicar (12)», y si el release era el equivocado —una reedición con otro tracklist, un LP homónimo— los 12 títulos, artistas y números de pista están sobrescritos. ⌘Z no hace nada.

Es un olvido documentado por su propio vecino: `useMetaUndo.ts:47-49` enumera qué debe cubrir la pila —"fill-all, find & replace, clear, paste, derive"— y el emparejado de álbum, **la escritura masiva más agresiva de la app**, es la única que se quedó fuera. La fontanería ya llega (`onRecordUndo` en `App.tsx:1733`).

**Arreglo:** `recordMetaUndo(patches.map(p => p.id))` como primera línea.

---

### 5. El barrido de recorte en lote tampoco es deshacible

`App.tsx:1216-1239`

`onTrimDetected` recorre la selección haciendo `updateTrack(t.id, { trim })` sin snapshot. El `trim` es trabajo real y duradero: entra en la firma de staleness y se persiste en sesión.

Si la detección se equivoca en 20 de 200 —vinilos con intro larga de ruido de superficie, justo el caso para el que existe el umbral de −60 dB— la única salida es abrir esas 20 una a una.

El cuidado parcial ya está (filtra `!t.trim` para no pisar cortes manuales), lo que demuestra que se pensó en el trabajo del usuario; se protegió el corte anterior y no el estado *sin* corte, que también es una decisión suya.

**Arreglo:** el toast de resumen ya tiene la lista de ids en mano; una acción «Deshacer» que limpie el `trim` de los aplicados.

---

## Prioridad 2 — El dato existe y no se expone

Los cuatro siguientes comparten forma: la app **sabe** algo que el usuario necesita y no le da forma de llegar a ello.

### 6. Una sugerencia «a revisar» no tiene forma visible de aceptarse

`components/TrackList.tsx:456-470` · `shared/shortcutDefaults.ts`

El auto-match marca la fila con una chispa ámbar («A revisar · 87 %»). Ahí acaba lo visible. Verificado: **`accept-review` no tiene chord por defecto** (no aparece en `SHORTCUT_DEFAULTS`), no hay botón en el editor ni acción en el menú contextual.

El único camino es abrir ⌘K y buscar el comando a ciegas — sin tecla que lo anuncie.

Lo delata el propio código: `useAutoMatch.ts:164-165` dice *"so the user can accept it in one action (shortcut **or click**)"*. Ese "or click" no existe en ninguna parte. El release ya está cargado y guardado en `reviewMatch`; el usuario acaba buscando el disco a mano otra vez.

**Arreglo:** convertir la chispa en botón que llame a `acceptReview` — la lógica ya está entera en `acceptReviewPatch`.

### 7. No hay forma de filtrar las pistas «a revisar» ni las «con error»

`lib/triage.ts:44,101-104,218-261`

Verificado: `ConversionFilter` ofrece `unconverted | automatched | matchedDiscogs | matchedBandcamp`. **No existe bucket `matchReview` ni `failed`**, ni contador para ellos, ni orden por estado.

Dos consecuencias concretas:

- Tras un auto-match sobre 300 pistas, las 40 marcadas ámbar se buscan scrolleando a ojo.
- Tras un lote, la barra dice `180 convertidas · 20 con error` y no hay forma de llegar a esas 20: el resumen es texto plano no clicable, y el único indicio por fila es un aro rojo diminuto en la carátula. Ese resumen además **persiste hasta la siguiente ejecución** cuando hubo fallos — un recuento accionable que no lleva a ninguna parte.

Se cae por su propio argumento: `triage.ts:41-43` justifica los buckets por proveedor diciendo que *"esas filas son las que merecen un vistazo aparte"*. Las que literalmente están marcadas como pendientes de revisión son las únicas sin bucket.

**Arreglo:** dos entradas más en `matchesConversion` (`Boolean(track.matchReview)` y `status === 'error'`) con sus contadores. Es el patrón exacto de las tres vecinas.

### 8. Soltar una carpeta sin audio no produce absolutamente nada

`hooks/useTrackLibrary.ts:237` · `main/expand.ts:65-66`

`if (fresh.length === 0) return` sale en silencio. Tres causas indistinguibles: carpeta sin audio, **`stat` fallido** (permiso denegado, SMB caído, alias roto → `catch(() => null)` convierte un error de acceso en cero resultados), o todo ya cargado (este sí avisa).

Verificado: no existe ninguna clave de i18n para "no se encontró audio".

Es el mismo no-op silencioso que el equipo ya identificó y arregló para el caso hermano — `useTrackLibrary.ts:221-222`: *"report the count so App can surface it rather than the old silent no-op"*. Se resolvió el de los duplicados y se dejó el de cero ficheros, que es el más desconcertante (con duplicados al menos hay filas en pantalla).

**Arreglo:** un `if` y una clave.

### 9. Cancelar un lote no deja rastro de que fue una cancelación

`hooks/useTrackProcessing.ts:465-499`

Al cancelar 200 conversiones el resumen dice `47 convertidas · 153 saltadas`. Nada indica que hubo cancelación: `'skipped'` significa lo mismo en otras cuatro situaciones (pista quitada, ya convirtiendo, formato sin equivalente, conflicto declinado). Cinco causas colapsadas en un número.

Y ese resumen **se autodestruye a los 6 s** porque `failed === 0`. Quien cancela para mirar otra cosa vuelve a una barra vacía.

El `finally` sabe que hubo cancelación (`cancelBatchRef.current` sigue en `true` al escribir el resumen) y no lo usa.

**Arreglo:** usar ese flag para el texto y para tratarlo como el caso persistente.

---

## Prioridad 3 — La web: el camino a la descarga

### 10. El HTML que llega al navegador dice «Ver descargas», no «Descargar para macOS»

`components/DownloadButton.tsx:27,57,62-65`

**Medido sobre el `dist/` construido:** `grep -c "Ver descargas" dist/index.html` → **1**; `grep -c "Descargar para" dist/index.html` → **0**.

La cadena es: en SSG no hay `navigator` → `detectOS()` devuelve `'other'` → `ready = href !== null || os === 'other'` es `true` → gana la rama de fallback, que enlaza a la lista de releases de GitHub.

El usuario con JS lento, bloqueado, o con el fetch a GitHub fallando (ver #11) acaba en una lista de 15 assets con `.blockmap`, `.zip` y `latest.yml`, en vez de descargar el instalador.

Es un descuido con firma: el fichero documenta el prerender `'other'` en otro sitio (líneas 98-103) para reservar la línea del enlace Intel — se trató como problema de layout, no de copy.

**Arreglo:** con `os === 'other'` **y** `settled === false`, mostrar el spinner que ya existe (líneas 71-95); dejar el enlace a RELEASES solo cuando `settled === true`. Es la distinción que el bloque de meta ya hace bien en las líneas 118-128.

### 11. Cada visita gasta 3 de las 60 peticiones/hora que GitHub da por IP

`components/DownloadButton.tsx:35` · `lib/downloads.ts:34-45`

Medido contra la API real: el límite sin autenticar es **60/hora por IP**; `fetchAllReleases` pagina hasta que una página vuelve corta (hoy 2 peticiones, con 154 releases publicadas) y el botón hace la suya: **3 por pageview**. Cuando se pasen las 200 releases serán 4.

Una oficina, un campus, una red móvil con CGNAT — o un solo usuario navegando home → funciones → guía → changelog, que monta `DownloadButton` en las cuatro — agotan el cupo. A partir de ahí GitHub responde 403, el `.catch(() => {})` se lo traga sin distinguirlo de un fallo de red, y el usuario cae en el #10.

El comentario de `downloads.ts:30-33` razona sobre el `per_page` de GitHub: pensó en la corrección del número, no en el coste en cuota. Y `scripts/downloads.mjs` ya hace este cálculo fuera del navegador.

**Arreglo:** volcar la cifra en build al JSON estático (el script existe), o cachear en `sessionStorage`. De 3/pageview a 1/sesión.

### 12. Copy escrita, traducida y sin enchufar

`App.tsx:30-51` · claves `home.heroFree` y `hero.ledeShort`

Verificado: ambas existen traducidas en los dos idiomas y **`grep` no las referencia en ningún componente**.

- `home.heroFree` = «Gratis · macOS, Windows y Linux». El nombre dice literalmente "el gratis del hero". La home actual no dice en ningún momento que sea gratis ni para qué sistemas: eso vive en el cierre, tras varias pantallas de scroll.
- `hero.ledeShort` = «Convertir, etiquetar, comprobar la calidad y ordenar en Apple Music o Engine DJ: lo que hacías saltando entre cuatro o cinco apps, Surco lo hace en una.» Es la única frase del sitio que dice **qué es Surco en la primera línea**. El titular actual («Tu música, como debería estar.») no identifica la categoría.

El test de i18n solo comprueba paridad es/en, así que una clave huérfana en ambos idiomas pasa desapercibida.

**Arreglo:** enchufar `heroFree` bajo el botón del hero. Para la lede, elegir una de las dos y borrar la otra.

### 13. El aviso de SmartScreen solo existe en `/funciones`

`i18n/locales/es.json:369-370`

Verificado: `grep -o 'Windows protegió tu PC' dist/*.html` → **solo** `funciones.html`.

`funcionalidades.md:584-585` confirma que es sistemático, no ocasional: Windows no lleva firma de código. El usuario pulsa «Descargar para Windows» en la home, ejecuta el `.exe`, y se encuentra un diálogo rojo. La explicación existe y está bien escrita, pero en una FAQ plegada de otra página.

La asimetría delata el olvido: la frase de seguridad que **sí** se muestra en la home (`home.closeSafety`) termina en «Notarizado por Apple» — cubre a macOS y deja a Windows sin equivalente, en una página que ofrece descarga para las tres plataformas.

**Arreglo:** con `os === 'windows'`, una línea bajo el botón (la copy ya existe en `faq.items[7].a`). Es el patrón del enlace Intel, ya condicionado al OS.

### 14. No se dice cuánto pesa la descarga

`components/DownloadButton.tsx:118-139`

159 MB el `.dmg`, 187 MB el `Setup.exe`, 196 MB el AppImage (medidos contra la API). La fila bajo el botón muestra descargas y versión, no el tamaño.

El dato ya está en la mano: el `fetch` recibe el objeto `assets` completo con `size` en bytes, y el código lee `name` y `browser_download_url` descartando el `size` de la misma respuesta. Cero peticiones extra.

### 15. En un Mac Intel, la salvación está en el texto más tenue de la página

`components/DownloadButton.tsx:105-114` · `lib/os.ts:24-30`

El navegador no distingue Apple Silicon de Intel (asumido conscientemente), así que el botón grande ofrece arm64. La salida para Intel es un enlace en `font-mono text-xs text-faint` —el estilo más apagado del sitio— con copy interrogativa («¿Mac con Intel (2020 o anterior)? Descárgalo aquí»).

Justo el usuario que no sabe si su Mac es Intel es el que necesita verlo. Si descarga el arm64, macOS da un error al abrir y no sabrá por qué.

Se dedicaron seis líneas de comentario a justificar que el enlace esté siempre montado (reservar la línea, no disparar CLS): el esfuerzo fue de layout. Que en un Mac Intel esa línea sea la única salvación y esté en el estilo más tenue, no se evaluó.

**Arreglo:** subirlo a `text-muted` y quitarle `font-mono text-xs`. No cambia el layout ni el CLS reservado.

---

## Prioridad 4 — Textos que desmienten a la app

### 16. Trece atajos anunciados con la condición contraria a la real

`settings.shortcuts.groupTrimHint` (5 idiomas) · `shared/shortcutDefaults.ts:90-113` · `components/TrimSection.tsx:857-865`

Ajustes anuncia el grupo de recorte como **«Solo con el foco en un corte»**. Verificado: las trece teclas del grupo `trim` **no declaran `scope`**; se registran con `claimKeys` condicionado a `open`, no a foco.

Los dos comentarios del código dicen lo contrario que la UI:

> *"con el editor desplegado actúan sobre la pista abierta SIN foco en ninguna parte, que es como se maneja un teclado de macros"* (`shortcutDefaults.ts:90-93`)
> *"The per-side keys act on the open track while the section is open, with no focus anywhere — the point of the feature."* (`TrimSection.tsx:857-859`)

Más de un tercio de los 37 comandos se presenta bajo una precondición falsa. El DJ lee que hay que pinchar el tirador primero y nunca prueba el flujo manos-al-teclado, que es justo para lo que existe. La app esconde su propia función bajo una etiqueta que la desmiente.

### 17. «Cambiar idioma (español / inglés)» con cinco idiomas en el ciclo

`commands.toggleLanguage` (5 idiomas) · `i18n/locale.ts:4,28-31`

`LOCALES` tiene 5 entradas y `nextLocale` avanza módulo 5. El texto, verificado en los cinco:

| es | «Cambiar idioma (español / inglés)» |
| de | «Sprache wechseln (Englisch / Spanisch)» |
| pt-BR | «Trocar idioma (inglês / espanhol)» |

El caso brasileño es el más llamativo: el texto **en portugués** le dice al usuario que el comando ni contempla el portugués, en una app ya traducida a su idioma. Y quien lo pulsa acaba en alemán tras un comando que prometía dos destinos.

Se delata solo: su gemelo `commands.toggleTheme` sí enumera los tres estados completos.

**Arreglo:** quitar el paréntesis en los 5 locales.

### 18. «Mostrar el espectro de audio» apaga en realidad todo el análisis de calidad

`components/settings/EditorTab.tsx:57-73`

`autoAnalyze` («Analizar todo al importar») se deshabilita cuando `showSpectrum` está apagado. El DJ que no quiere un espectrograma ocupando el editor apaga lo que la etiqueta describe —un panel— y con ese clic apaga la detección automática de fakes en toda la biblioteca: una de las razones por las que se usa Surco, y que `main/settings.ts:79-81` defiende como encendida por defecto *"so the audio-quality read (spotting fakes and transcodes) surfaces on import without the user having to discover it"*.

La grieta está a la vista: el comentario de `EditorTab.tsx:64-65` llama al de arriba *"the quality analysis"*, mientras la etiqueta que el usuario lee dice «Mostrar el espectro». El código sabe que es el interruptor del análisis; la UI lo presenta como el de una vista.

**Arreglo:** renombrar la etiqueta al subsistema («Análisis de calidad de audio»), dejando el espectro en el hint que ya lo explica. Cero cambios de lógica.

---

## Prioridad 5 — Fricciones menores (caben en una 1.0.x)

### 19. El A/B de reparación se tira en silencio al tocar el nivel

`components/DeclickSection.tsx:98-106` — el efecto de limpieza invalida el preview cuando cambia `value`. La invalidación es correcta y está bien argumentada; lo que falta es **decirlo**. El usuario renderiza «Suave» (decenas de segundos, según el propio comentario), pulsa «Estándar» para comparar, y la fila de transporte se sustituye por el botón «Renderizar» sin una palabra. El componente ya tiene el patrón (`declick-failed` pinta una línea de texto). Agravante: con el preview borrado, `Space` vuelve a significar «renderizar», así que quien lo pulsa esperando play dispara otro encode.

### 20. Cambiar el formato por defecto resetea también el destino de la pista abierta

`components/Editor.tsx:334-392` — la decisión de resembrar el formato está documentada y es sólida. Pero `setDestination(seededDestination)` (línea 383) corre **incondicionalmente**, fuera del `if (formatSettingChanged)` que protege al formato. El código calcula `destinationSettingsChanged` con cuidado (líneas 351-357) y luego no la usa en la rama que le corresponde: una variable calculada y no usada es firma de olvido. El usuario que puso esta pista en «junto al original» abre Ajustes por otra cosa, guarda, y exporta al sitio equivocado si no mira la etiqueta del botón.

### 21. La sección maximizada no dice de qué pista es ni cómo se sale

`hooks/useEditorSections.ts:26,92-99` · `Editor.tsx:1226-1241` — el overlay es `fixed inset-0 z-50` opaco con **solo la sección dentro**: sin nombre de pista, sin barra de conversión. Que sobreviva al cambio de pista es deliberado y está bien razonado. Lo que no se cubrió es cómo el usuario **sabe** que está dentro de un modo: el único indicio es un icono de 20×20 px cuyas flechitas cambian de dirección. La app ya demostró saber que el modo necesita escapes (Esc, y un `clearMaximizedSection()` al importar carpetas).

### 22. Sin recuento de atajos modificados

`components/settings/ShortcutsTab.tsx:95-153` — el «↺» por fila solo aparece si esa fila está sobrescrita, y es un glifo tenue entre 37 comandos en ~9 secciones. El único control siempre visible es «Restablecer todo». Quien reasignó tres teclas y quiere revertir una debe cazar el glifo por las nueve secciones. La pestaña ya sabe agregar estado sobre las 37 filas y decirlo arriba —lo hace con los conflictos, deshabilitando Guardar—; simplemente no lo hace para el estado frecuente. **Arreglo:** `Restablecer todo (3)` a partir de `Object.keys(shortcutOverrides).length`.

### 23. Dos píldoras de progreso idénticas a la vez

`components/Toolbar.tsx:157-217` — `batchSummary` se oculta durante el lote (correcto), pero la píldora de importación no se excluye de nada, así que arrastrar una carpeta mientras se convierte pinta dos cápsulas azules con el mismo `Loader2` y contador `done/total`. El propio código reconoce el riesgo dos veces (*"a generic loader can't identify its sweep by icon alone"*) y lo resolvió solo para el eje spinner-vs-icono. Los otros dos barridos sí tienen glifo propio (`Sparkles`, `Activity`). Una de las dos cápsulas cancela conversiones al pulsarla; la otra no hace nada.

### 24. La guía: 19 secciones sin ruta de vuelta

`components/Guide.tsx:112-168` — el TOC lista 19 entradas planas y una sección está a ~12 pantallazos del índice. No hay enlace de vuelta al final de cada sección, y verificado: **`ScrollProgress` solo se monta en `App.tsx:24`** (la home), siendo la guía la página más larga del sitio (79 KiB de HTML vs 47 de la home). La asimetría es la prueba: la página que tiene indicador de progreso es la corta.

### 25. El lightbox intercepta Shift+Tab

`components/Lightbox.tsx:38-41` — el manejador hace `preventDefault()` sin mirar `e.shiftKey`, así que retroceder con teclado es una tecla muerta sin señal. El resto del componente es cuidadoso (captura y restaura foco, Escape, `aria-modal`, bloqueo de scroll): que no mire `shiftKey` en su única rama de teclado es un olvido de una condición.

---

## Descartados tras verificación

| Sospecha | Por qué se cae |
|---|---|
| Los botones de icono no tienen tooltip | `Tooltip.tsx` da tooltip propio con retardo, atajo, y ruta de teclado. Verificado en pantalla |
| Las acciones destructivas no confirman | `useConfirmFlows.ts` las cubre y razona incluso dónde *no* confirmar |
| El idioma exige relanzar la app | `useSettings.ts:135-137` lo aplica en caliente |
| La web promete cosas que la app no hace | Contrastadas las 12 de `funcionalidades.md §12`: ninguna promesa falsa |
| El skeleton de BPM/tonalidad se queda colgado | El gate incluye `formOpen`; con el formulario plegado el campo no se monta |
| Convertir una pista sacada del filtro no avisa | Real pero inobservable en lote; solo tendría sentido por simetría con `onFormatSkipped` |

---

## Orden sugerido

1. **#1 y #2** — los dos tocan el modo destructivo: uno lo pone a un clic de un usuario nuevo, el otro rompe la única instrucción para salir de él.
2. **#3, #4, #5** — pérdida de trabajo del usuario. Los tres tienen el arreglo escrito al lado, en forma de su vecino.
3. **#10 y #11** — el camino a la descarga; se refuerzan mutuamente, arreglar juntos.
4. **#6, #7, #8, #9** — "el dato ya existe, falta exponerlo". Máximo retorno por línea tocada.
5. **#12–#18** — textos. Casi todo es i18n; el #16 y el #17 desmienten funciones que la app sí tiene.
6. **#19–#25** — 1.0.x.

Trece de los veintiún hallazgos se resuelven en cadenas de i18n o en una línea de código.
