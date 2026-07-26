# Sincronizar el collection.nml de Traktor

## Problema

Traktor guarda los cues y la carátula de cada pista en dos sitios: dentro del fichero
(PRIV/GEOB en MP3 y AIFF, comentario `TRAKTOR4` armado en basE91 en FLAC) y en su propia
base de datos, `collection.nml`. Surco escribe el fichero. Traktor lee el NML.

Para una pista que Traktor ya tiene fichada, **manda el NML**. Surco puede dejar el
fichero perfecto y Traktor seguir mostrando los cues viejos, porque nunca vuelve a mirar
dentro. El usuario ve que "Surco no hace nada" cuando en realidad hizo su trabajo entero.

Esto está confirmado por djotas (2026-07-26): convirtió cues a otro archivo y sólo los vio
aparecer en el caso donde el NML no imponía los suyos. Y no es un problema de cues: metió
carátulas nuevas y Traktor siguió enseñando las viejas. Mismo mecanismo, dos síntomas.

La única salida hoy es editar el NML a mano. Djotas lo hace con un script propio
(`traktor_nml_cleaner.py`), lo que confirma que la operación es viable y define qué
hace falta tocar.

## Qué se construye

Surco actualiza la `ENTRY` del `collection.nml` correspondiente a cada pista que procesa:
le escribe los `CUE_V2` re-anclados, le borra el `COVERARTID` para que Traktor relea la
carátula, y le reapunta el `LOCATION` cuando la conversión cambió la extensión.

Se dispara solo, al terminar un lote de conversión, sin pedir nada al usuario. Si no hay
NML configurado, o Traktor está abierto, o la pista no está en la colección, no se escribe
nada y la conversión sigue su curso.

## Precedente: Engine DJ

Surco **ya escribe en la biblioteca real de otro programa DJ**: `engineLibrary.ts` mete
las pistas convertidas en la Engine Library del usuario. Esa integración ya resolvió los
mismos problemas que plantea el NML, y esta feature copia sus decisiones en lugar de
inventar otras:

- copia de seguridad antes de cada escritura (`m.db.surco-backup`),
- se niega a escribir si Engine DJ está corriendo (`engineProcess.ts`, `pgrep -x`),
- actualiza la fila existente en vez de duplicarla,
- empareja por ruta normalizada NFC (APFS trata NFC y NFD como el mismo fichero),
- escritura atómica write-then-rename.

La objeción "escribir en la biblioteca del usuario es demasiado peligroso" no se sostiene
en este codebase: ya se hace, con red de seguridad, y funciona. Lo que sí cambia es el
tamaño de la caída — el NML es la colección entera de un DJ, con sus playlists e historial.
De ahí que las garantías de abajo sean más estrictas que las de Engine, no iguales.

## Módulos

Tres ficheros nuevos en `apps/desktop/src/main/`, con el mismo reparto que la integración
de Engine:

**`traktorNml.ts`** — el XML y nada más. Cargar un NML, localizar `ENTRY`s, aplicar una
lista de cambios, serializar. No sabe qué es Surco ni qué es una conversión: entra un
documento y una lista de cambios, sale un documento. Es la pieza testeable sin tocar disco
ni depender de un Traktor instalado.

**`traktorNmlLibrary.ts`** — la política. Backup rotado, guarda de Traktor abierto,
emparejado de pistas, agrupación del lote, escritura atómica. El equivalente de
`engineLibrary.ts`.

**`traktorProcess.ts`** — si Traktor está corriendo, y el cierre educado. Calcado de
`engineProcess.ts`: `pgrep -x` en macOS, `tasklist` en Windows, `osascript ... to quit`
para pedirle que se cierre y espera a que el proceso desaparezca.

## Localizar el collection.nml

Traktor lo pone por defecto en:

```
~/Documents/Native Instruments/Traktor <versión>/collection.nml
```

Con dos complicaciones reales, ambas visibles en la instalación de djotas:

1. **Una carpeta por versión.** Conviven `Traktor 4.4.1`, `4.4.2` y `4.5.0`. La ruta
   cambia al actualizar Traktor.
2. **No siempre está en el sitio estándar.** La suya cuelga de `Documentos — Local`
   (Documentos en iCloud, ésa es la carpeta local). La autodetección pura le fallaría.

Por eso Surco **propone, no impone**: busca `~/Documents/Native Instruments/Traktor
*/collection.nml`, coge la versión más alta y la ofrece en Ajustes. El usuario la confirma
o elige otra con el selector de ficheros. Un ajuste nuevo `traktorNmlPath` (string, vacío
por defecto) guarda la elección; vacío significa feature apagada.

Si más adelante aparece una carpeta de versión superior con su `collection.nml`, Surco
avisa y ofrece cambiar. Sin eso, actualizar Traktor dejaría a Surco escribiendo en una
colección muerta, con el síntoma más confuso posible: "no pasa nada".

`traktorNmlPath` va en `LOCAL_KEYS` (es una ruta de máquina, no se sincroniza).

## Emparejar pista con ENTRY

Cascada corta y estricta:

1. **Ruta exacta** — `VOLUME` + `DIR` + `FILE`, normalizado NFC, como hace Engine.
2. **Misma ruta, distinta extensión** — el caso AIFF→FLAC. Aquí es donde se reapunta
   `LOCATION` al fichero nuevo, para que la pista siga siendo *una* en Traktor, con sus
   playlists e historial intactos.
3. **Nada más.** Sin coincidencia, no se toca esa pista.

Se descarta a propósito el emparejado difuso (difflib, nombre normalizado, título+artista)
que sí usa el script de djotas. Allí es una herramienta manual donde él revisa el
resultado antes de aplicar; aquí sería automático sobre su colección real, y confundir dos
pistas significa escribirle los cues de otro track. El coste de fallar es asimétrico: no
actualizar es un no-op recuperable, actualizar la pista equivocada corrompe datos que el
usuario cree correctos.

Esto respeta lo que pidió djotas literalmente: "y si no está pues no actualizaría nada".

## Qué se escribe en la ENTRY

- **`CUE_V2`** — los cues re-anclados. Ojo: el fichero guarda un árbol binario y el NML
  guarda elementos XML `<CUE_V2 NAME TYPE START ...>`; no son el mismo formato, así que
  hay una traducción de por medio. El cálculo de posiciones sí está resuelto y se reutiliza
  (`traktor4.ts`, `shiftTraktorCues`) — lo nuevo es emitir el XML equivalente.
- **`COVERARTID`** — se borra el atributo de `<INFO>`. Es una referencia a la caché de
  carátulas de Traktor, no la imagen: mientras esté, Traktor sigue mostrando la vieja
  aunque el fichero lleve otra. Borrarlo le obliga a releer. Es lo que hace el script de
  djotas y por lo que existe esa función en él.
- **`LOCATION`** — sólo cuando la conversión cambió la extensión (caso 2 del emparejado).

No se sincronizan metadatos (título, artista, BPM, key). Multiplicaría los campos que
podemos estropear en una colección real a cambio de un problema que nadie ha reportado.

## Seguridad

Invariantes, no opciones configurables:

**Copia siempre.** Antes de cualquier escritura, `collection.nml.surco-<ISO>.bak` junto al
original, rotando las 10 más recientes. **Si el backup falla, no se escribe.** Engine
guarda una sola copia que se pisa en cada escritura; aquí no basta: el flujo real es
iterativo (djotas prueba, comprueba en Traktor, vuelve a probar) y una escritura mala que
además pise el backup bueno lo deja sin red. Sus propios `collection ORI.nml`,
`collection buena retocada.nml` y `collection1/2/3.nml` son exactamente este versionado
hecho a mano.

**Traktor abierto → no se escribe.** Traktor carga la colección en memoria al arrancar y
la reescribe al cerrar: cualquier cosa que Surco escriba con Traktor abierto se pierde al
salir, sin aviso y sin error. Se detecta el proceso, se avisa, y se ofrece cerrarlo — el
mismo trato que Engine DJ.

**Escritura atómica.** Fichero temporal + rename, para que un corte de luz o un fallo a
media escritura no deje el NML truncado.

**Un fallo del NML no rompe la conversión.** El audio ya está convertido y correcto; el
NML es un extra. Cualquier error se reporta pero no aborta el lote. Misma política que ya
tiene la preservación de cues en `tags.ts` ("cue handling never fails an otherwise good
conversion").

## Cuándo se dispara

Automático, sin intervención del usuario, **agrupado al final del lote**. El NML es la
colección entera y puede ser de decenas de MB; reescribirlo una vez por pista en un lote de
300 sería inaceptablemente lento. Una lectura, todos los cambios aplicados en memoria, una
escritura.

## Pruebas

`traktorNml.test.ts` sobre NMLs sintéticos, sin necesidad de Traktor instalado:

- un árbol binario de cues se traduce a los `CUE_V2` XML equivalentes (nombre, tipo,
  posición y hotcue de cada marcador), que es la pieza nueva de verdad
- ENTRY encontrada por ruta exacta → cues escritos
- ENTRY encontrada por extensión distinta → `LOCATION` reapuntado y cues escritos
- ENTRY no encontrada → el documento sale byte a byte igual
- `COVERARTID` borrado del `<INFO>`
- cues re-anclados con el desplazamiento de un trim
- un NML malformado no lanza: se reporta y se deja el original intacto

`traktorNmlLibrary.test.ts` para las guardas:

- backup escrito antes que el NML
- backup que falla → no se escribe el NML
- rotación: con 11 backups quedan los 10 más recientes
- Traktor corriendo → no se escribe
- un lote de N pistas produce **una** escritura, no N

**Lo que no se puede probar aquí:** un `collection.nml` real de Traktor, y la
autodetección de rutas. Esta máquina no tiene Traktor instalado. La validación final es de
djotas, igual que lo fue con los cues en FLAC.

## Validación antes de soltarlo

La primera prueba real se hace **sobre una copia** de la colección de djotas, no sobre la
buena. Con la feature apuntando a esa copia, se convierte una pista, se abre esa colección
en Traktor y se comprueba que los cues salen donde deben. Sólo después se apunta a la
colección de verdad.

No es una formalidad: es su biblioteca de quince años, y el argumento de que las garantías
técnicas son buenas no sustituye a haberlo visto funcionar una vez.

## Fuera de alcance

- **Playlists, historial, ordenación** — el script de djotas los toca; Surco no.
- **Emparejado difuso** — descartado arriba, con motivo.
- **Metadatos** — descartado arriba.
- **Windows/Linux** — la detección de proceso se escribe multiplataforma copiando
  `engineProcess.ts`, pero la autodetección de rutas se implementa y verifica para macOS.
- **Leer el NML como fuente de metadatos** (importar cues de Traktor a Surco). Es una
  feature distinta y esta no la bloquea.
