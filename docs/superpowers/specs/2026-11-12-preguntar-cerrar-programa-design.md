# Preguntar antes de dejar en cola: cerrar el programa o aplicar al cerrarlo

## Por qué

Desde la 1.33, cuando un programa de DJ está abierto, casi todo lo que Surco escribe en su biblioteca se
queda en cola en silencio y se aplica al cerrar el programa. djotas (usuario real, 12/11) no lo quiere:
cambia una carátula con Traktor abierto, no la ve en Traktor y lo vive como un fallo. Sus palabras:
"debe de aplicar los cambios estando cerrado Traktor, no como hace ahora que aunque lo tengas abierto
pueda trabajar Surco". Añade que cuando él intentó trabajar con Traktor abierto "eran muchos fallos".

Medido el 12/11 con la 1.33.0 y la 1.34.0 sobre una copia de la colección y un proceso falso
`Traktor Pro 4`: las dos escriben lo mismo y ninguna toca el caché de Traktor con Traktor abierto. No es
una regresión; es el comportamiento de la cola, que djotas no quiere.

Decisión del usuario (12/11): una mezcla de las dos soluciones. Con el programa abierto, Surco pregunta
siempre, y el DJ elige entre escribir ya o dejarlo en cola.

## Qué hace

Cuando una **acción del DJ** (algo que acaba de pulsar) tiene que escribir en la biblioteca de un
programa de DJ que está abierto, Surco muestra un aviso con dos botones:

- **«Cerrar <programa> y aplicar»**: Surco cierra el programa, escribe en ese momento y, al volver a
  abrirlo, el DJ ve el cambio.
- **«Aplicar al cerrarlo»**: el cambio queda en la cola como hoy, con su pastilla, y se escribe cuando
  el DJ cierre el programa.

Decisiones del usuario:

- Pregunta **siempre**. No hay «No volver a preguntar» ni elección recordada.
- **Todas** las acciones que escriben en la biblioteca: actualizar y convertir, guardar cues y
  rejilla, playlists (crear, renombrar, mover, borrar, añadir, arrastrar), pegar tracklist, sesión
  automática, reparar daños, «Aplicar ahora» del panel de cola y el «Reintentar» de la verificación.
  La revisión de metadatos y sustituir duplicados en rekordbox, Engine y Traktor quedan fuera: ver
  «Lo que no cambia».
- **Los cinco programas**: rekordbox, Traktor, Engine DJ, Serato y VirtualDJ.
- Las **escrituras que salen solas** detrás de otra acción siguen yendo a la cola en silencio, sin
  aviso: seguir el tamaño de un fichero reescrito (`librarySizeFollow.ts`), completar los cues de
  rekordbox al cerrarlo (`rekordboxCompleteOnClose.ts`, `rekordboxProvisional.ts`) y el vigilante que
  aplica lo que espera (`rekordboxQueueWatch.ts`).

- Al **convertir o actualizar**, el aviso sale **al pulsar el botón**, antes de empezar. Si el DJ elige
  cerrar, el programa queda cerrado durante toda la conversión y todo se escribe al terminar. Si
  alguien lo reabre a mitad, lo que quede va a la cola sin volver a preguntar.

Decisiones mías, apuntadas como tales:

- **Enter y Escape** quedan en «Aplicar al cerrarlo». Un Enter por costumbre nunca cierra el
  programa en mitad de un set.
- Si el programa no se cierra, o la espera de Serato o VirtualDJ termina sin que se cierre
  (`waitForVirtualdjExit` se rinde a unos 15 s), el cambio va a la cola.
- «Cerrar y aplicar» escribe toda la cola de ese programa, no solo este cambio.

Decisión mía, apuntada como tal: en una acción en lote (convertir 40 pistas, guardar los cues de
varias, una sesión que escribe en dos programas) se pregunta **una vez por programa y acción**, no una
vez por pista.

## Lo que no cambia

- Con el programa cerrado, nada pregunta y todo se escribe como hoy.
- La cola, su pastilla, el reintento, «Aplicar ahora» y el vigilante siguen existiendo. Solo dejan de
  ser la única salida.
- Lo que ya pregunta y no tiene cola (USB, restaurar copias) sigue igual: no se le añade «Aplicar al
  cerrarlo», porque no hay nada que poner en cola.
- Decisión del usuario: la **revisión de metadatos** y **sustituir duplicados** en rekordbox, Engine y
  Traktor siguen con «Cerrar» / «Cancelar», sin cola nueva. Única excepción: la revisión de metadatos
  de Traktor hoy pierde los cambios al cancelar (`libraryFlushes.ts:813-817`); al cancelar, sus
  parches van a la cola de Traktor que ya existe (`holdInQueue`). En Serato y VirtualDJ la revisión ya
  va por cola y pasa a preguntar como el resto.

## Anti-objetivos

- Un aviso que salte sin que el DJ haya pulsado nada.
- Perder un cambio. «Aplicar al cerrarlo» siempre deja el cambio en la cola, y la revisión de
  metadatos de Traktor deja de perderlo al cancelar.
- Decir «rechazado» y luego escribirlo igualmente. Hoy un «Cancelar» de una playlist o de unos cues se
  queda en cola mientras el aviso dice que se rechazó. Con este diseño el botón se llama «Aplicar al
  cerrarlo» y dice la verdad.
- Más de un aviso por programa en la misma acción.

## Piezas que ya existen

- El aviso: `createEnsureClosed` / `askToClose` en `djProcesses.ts:122-181`, con `QUIT_REASONS`
  (`:15-20`), `QUIT_TEXT` (`:55-100`) y `QUIT_PROMPT_SHARING` (`:115-120`). Hoy sus botones son
  «Cerrar X» / «Cancelar». Se crea en `index.ts:843-848` y se traduce en `i18n.ts` (es, en, de, fr,
  pt-BR en línea y ja en `locales/ja.json`).
- La comprobación que nunca pregunta: `closedWithoutAsking` (`libraryFlushes.ts:116`) y
  `applyQuietly` (`programQueue.ts:76-88`).
- VirtualDJ ya tiene un aviso propio que no cierra el programa: «Lo he cerrado» / «Cancelar»
  (`waitForVirtualdjExit`), porque Surco no sabe cerrarlo.

## Lo que hay que resolver al construir

- **Serato no tiene aviso.** No está en `QUIT_REASONS` ni en `QUIT_TEXT` y no hay `quitSerato`.
  Decisión mía: para Serato y VirtualDJ, el primer botón es «Lo he cerrado, aplicar», que espera a que
  el DJ lo cierre, como el aviso actual de VirtualDJ. Si el constructor ve que cerrar Serato es tan
  sencillo como cerrar Traktor en las dos plataformas, que lo proponga; si no, se queda así.
- **Inventario completo** de los 25 sitios que hoy van a la cola sin preguntar y de los que ya
  preguntan, levantado el 12/11, en el apéndice. Cada sitio de «acción del DJ» pasa a preguntar; cada
  sitio de «escritura que sale sola» se queda igual.
- **Las incoherencias de hoy** desaparecen con el diseño: hoy las playlists preguntan en rekordbox,
  Engine y Traktor pero no en Serato ni VirtualDJ, y los cues preguntan solo en Traktor.
- **El texto del aviso**: conviene revisar los `detail` de cada razón, porque algunos dicen cosas que
  ya no serán ciertas («vuelve a abrirlo cuando termine la conversión» en Engine). Seis idiomas, sin
  guion largo.
- **Cómo se ve el aviso**: es un `dialog.showMessageBox` nativo, igual que hoy. No se diseña uno nuevo.

## Cómo se prueba

- Tests por cada acción del DJ y cada programa: con el programa abierto, sale el aviso; «Cerrar y
  aplicar» cierra y escribe; «Aplicar al cerrarlo» deja el cambio en la cola y no escribe.
- Test de que las escrituras que salen solas no muestran aviso.
- Test de que un lote de varias pistas muestra un aviso por programa.
- La batería de los cinco programas (`scenarios/djPrograms/battery.test.tsx`) con el programa abierto
  en las dos respuestas.
- Prueba en la app con el proceso falso del 12/11: un binario llamado `Traktor Pro 4` que la guarda de
  `pgrep` detecta. En macOS hay que compilarlo (`cc`), porque un `sleep` copiado lo mata la firma.

## Release

Va en la misma release que el arreglo del parpadeo de la lista (`76f555d1d`, ya en main local). Antes
de lanzarla, pushear main y esperar el CI en verde, y comprobar en la app que la lista de cada programa
se queda quieta.

## Apéndice: inventario del 12/11

Sitios que hoy van a la cola sin preguntar (rutas relativas a `apps/desktop/src/main/`):

| Programa | Acción | Dónde | Tipo |
|---|---|---|---|
| rekordbox | Convertir, actualizar | `libraryFlushes.ts:554-607`, `rekordboxQueueFromRun.ts:123-142` | Acción del DJ |
| Traktor | Convertir, actualizar | `libraryFlushes.ts:483-533`, `traktorSyncFlush.ts:77-88` | Acción del DJ |
| Traktor | Añadir lo convertido | `libraryFlushes.ts:545-548` | Acción del DJ |
| Engine DJ | Convertir, actualizar, añadir | `libraryFlushes.ts:610-685`, `processTrack.ts:678-681` | Acción del DJ |
| VirtualDJ | Convertir, actualizar | `libraryFlushes.ts:420-452` | Acción del DJ |
| Serato | Convertir, actualizar | `libraryFlushes.ts:454-472` | Acción del DJ |
| rekordbox, Engine, Serato, VirtualDJ | Guardar cues y rejilla | `cuesIpc.ts:91-110`, `index.ts:1646`, `:1652`, `:1673`, `:1686` | Acción del DJ |
| rekordbox, Engine, Traktor | Sesión automática | `*PlaylistEditIpc.ts` en modo `queue`, `renderer/src/hooks/useSessionWrite.ts` | Acción del DJ |
| Serato, VirtualDJ | Toda edición de playlists | `seratoPlaylistEditIpc.ts:45`, `virtualdjPlaylistEditIpc.ts:37` | Acción del DJ |
| Serato, VirtualDJ | Revisión de metadatos | `seratoTagSync.ts:65-80`, `virtualdjTagSync.ts:45-53` | Acción del DJ |
| Traktor, Engine | Reparar daños | `damageWiring.ts:115-149`, `damageRepair.ts` | Acción del DJ |
| Serato, VirtualDJ | «Aplicar ahora» del panel de cola | `waitingCueQueueIpc.ts:17-22` | Acción del DJ |
| rekordbox, Engine, Traktor, VirtualDJ | «Reintentar» de la verificación | `verifyIpc.ts:225-273` | Acción del DJ |
| Engine, VirtualDJ | Seguir el tamaño de un fichero | `librarySizeFollow.ts`, `index.ts:703-713` | Sale sola |
| rekordbox | Completar cues al cerrar | `rekordboxCompleteOnClose.ts`, `rekordboxProvisional.ts` | Sale sola |
| Todos | Vigilante de la cola | `rekordboxQueueWatch.ts:44-66` | Sale sola |

Sitios que ya preguntan: edición de playlists en modo pregunta de rekordbox, Engine y Traktor
(`index.ts:1508`, `:1541`, `:1563`), «Aplicar ahora» de rekordbox, Engine y Traktor, guardar cues de
Traktor (`index.ts:714-726`), USB de rekordbox y Engine, restaurar copias, revisión de metadatos de
rekordbox, Engine y Traktor y sustituir duplicados (`libraryFlushes.ts:813-943`).
