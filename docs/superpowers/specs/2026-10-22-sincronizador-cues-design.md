# Surco como sincronizador de cues entre programas de DJ

Estado: **aparcado (22/10)**. Se habló con Vicent y se decidió documentarlo y no construirlo
hasta que lo publicado en la v1.10 (Auto marcar, cues sin análisis de rekordbox) esté estable
y tengamos los datos que faltan (ver «Antes de retomarlo»). No está listo para planificar:
al retomarlo pasa por la revisión completa del diseño.

## El caso

Un usuario pidió (22/10, mensaje reenviado por Vicent): «Ya los cue traktor que pasen a surco
y se puedan exportar a rekordbox con los colores etc».

Vicent lo generalizó: **no queremos duplicar trabajo**. El DJ marca los cues de una pista una
vez y valen en todos sus programas: rekordbox, Traktor y Engine DJ. Quien ya tiene cues hechos
en Traktor los importa y desde ahí funcionan igual que si los hubiera marcado en Surco.

## Lo que decidió Vicent

- **Surco actúa como sincronizador**, en segundo plano. «El usuario no tiene por qué
  enterarse»: Surco actualiza el resto de programas solo.
- **Los cues se pueden retocar dentro de cualquier programa.** Surco detecta esos cambios al
  abrirse y los reparte a los demás.
- **A cada programa le llega lo que admite.** Si un programa no admite CALL, no se le copian
  (Engine DJ solo guarda hot cues).
- **Una pista es la misma en todos los programas porque es el mismo fichero.** En su caso los
  ficheros vienen de Apple Music; en Windows, que no tiene Apple Music, de carpetas.
- **Anti-objetivo: que Surco se convierta en un monstruo de complejidad.** Si no encaja, se
  aparca (como ahora).

## Lo que propuse yo (sin confirmar por Vicent)

- **Una base de datos propia de Surco con los cues de cada pista**: hot cues, CALL, color y
  nombre, guardados en el tiempo real del audio y no en el de ningún programa. Cada programa
  recibe el punto traducido a su forma de contar los milisegundos, como ya se hace con
  rekordbox (`rekordboxShiftMs`, `rekordboxTimeline.ts`).
- **Recordar qué se escribió en cada programa la última vez**, para distinguir un cambio hecho
  allí de lo que Surco puso. Es la misma idea que la lista de pendientes de ajustar
  (`rekordboxProvisional.ts`).
- **Detección barata al abrir**: primero la fecha de modificación de cada colección (si no
  cambió, no se abre); si cambió, solo lo modificado. rekordbox lleva un contador por pista
  (`djmdContent.CueUpdated`) que sube con cada cambio de cues. Traktor es un único XML que hay
  que leer entero cuando cambia. Engine DJ: sin saber aún si tiene una marca equivalente.
- **Si la misma pista cambió en dos programas entre dos sincronizaciones, gana el cambio más
  reciente** (rekordbox y Traktor guardan fecha por pista).
- **Solo se avisa al usuario cuando algo no se puede hacer**: un cue que no encaja o una pista
  que Surco no sabe identificar.
- **Copia de seguridad antes de cada escritura**, como ahora. Al ser silencioso, un error no lo
  vería nadie.
- **La pista se reconoce por su ruta resuelta**, no la escrita (el enlace `~/Music/Music` → NAS
  de Vicent ya obligó a esto en `rekordboxDb.ts`, que además rechaza las pistas con dos
  entradas para el mismo fichero en vez de elegir una). Cuando Surco convierte o sustituye la
  pista, sigue al fichero nuevo, como ya hace al reapuntar rekordbox y Traktor. Reconocer por
  la huella del audio un fichero movido por fuera de Surco queda para más adelante.

## Límites que no se pueden saltar

- **No se escribe en un programa abierto.** rekordbox y Engine bloquean su base, y Traktor
  reescribe su `collection.nml` entero al cerrarse, pisando lo que Surco hubiera puesto. Los
  cambios para un programa esperan a que se cierre, como la cola de rekordbox actual.
- **Cada programa cuenta los milisegundos a su manera en los MP3.** Medido para rekordbox
  (22/10, 2006 pistas): frente al audio decodificado, un MP3 con cabecera LAME va unos 51 ms
  por delante y un M4A el arranque del AAC. Traktor y Engine no están medidos.

## Lo que ya existe y sirve

- Escribir cues en rekordbox con su cola, copia de seguridad y detección de cambios hechos en
  rekordbox mientras se espera (`rekordboxCues.ts`, `rekordboxPlaylistWrite.ts`).
- Escribir hot cues en Engine DJ (`engineCuesWrite.ts`), solo en desarrollo, sin probar contra
  Engine real.
- Leer los cues de una pista del `collection.nml` de Traktor, con el color de Traktor Pro 4, y
  convertir ese color a la muestra de rekordbox más cercana (`traktorNmlCues.ts`, 22/10). Aún
  no lo usa nada.
- Conservar los cues de Traktor dentro del fichero al convertir, y parchear el `.nml`
  (`traktor4.ts`, `traktorNml.ts`).

## Antes de retomarlo

1. Que lo de la v1.10 lleve un tiempo en uso sin problemas.
2. Un `collection.nml` real de Traktor 4 con cues de varios colores, de un usuario.
3. Medir el desfase de Traktor y de Engine en MP3 frente a rekordbox, con pistas que estén en
   los dos programas (como la medición de la rejilla del 22/10).
4. Probar la escritura de Engine DJ contra Engine real.

## Preguntas abiertas

- Si de entrada solo pudiera sincronizar dos programas, ¿cuáles?
- ¿Se aceptan fuera de alcance los usuarios con copias distintas de la misma pista en cada
  programa (un WAV en rekordbox y un MP3 en Engine)? Con la regla de «mismo fichero» no se
  sincronizarían.
- ¿Los colores de Traktor 3, que no guarda color por cue, se deducen del tipo de cue? Los
  colores por tipo del boceto de abajo son supuestos, sin comprobar contra Traktor.
- ¿Se sincronizan los loops? Hoy Surco no escribe loops en rekordbox ni lee su duración del
  fichero de Traktor.
- ¿Qué pasa con el hot cue «AutoGrid» que Traktor 4 crea solo en casi todas las pistas?

## Material de la conversación

- Boceto de la primera idea, más estrecha (traer cues de Traktor a una playlist de
  rekordbox): https://claude.ai/artifact/X1RrxLhzhCJBaLAeTcN9iC. Queda como referencia del
  caso «importar desde Traktor», no del sincronizador.
- Ficheros reales de Traktor Pro 4 en `apps/desktop/src/main/fixtures/traktor-pro-4-collection.nml`
  (de github.com/wolkenarchitekt/traktor-nml-utils, GPL-3.0).
