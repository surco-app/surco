# Medidas de <Programa>

Copiar a `docs/<programa>-medidas.md` y rellenar con el programa real instalado. Modelo completo:
`docs/virtualdj-medidas.md`. Cada línea dice qué se hizo, qué se vio y con qué fichero. Lo que no se
midió se escribe como "sin medir", nunca se deduce.

<Programa> <versión> (build <n>), <SO>, <fecha>. Carpeta `<ruta de la biblioteca>`.
Copia de cada estado en `<scratchpad o .superpowers/...>` (fuera del repo).
Fixtures con rutas reescritas a `/Music/...` en `apps/desktop/src/main/<programa>Fixtures/`.

## Dónde guarda cada cosa

- **Biblioteca:** fichero(s), formato (XML, SQLite, binario), raíz, cómo identifica una pista (ruta,
  id, ruta + tamaño).
- **Cues y loops:** dónde (base de datos, etiquetas del audio, los dos), unidades (s, ms, muestras),
  numeración de pads, color (formato exacto, un ejemplo elegido por el usuario), cues sin nombre.
- **Rejilla:** campos y unidades (BPM o segundos por pulso), qué es el ancla, regla comprobada contra la
  rejilla que pinta el programa.
- **Listas y carpetas:** ficheros, orden, listas inteligentes (se muestran o no).
- **Otros ficheros junto a la base** (cachés, SQLite auxiliares): qué guardan y si Surco los toca.

## Cuándo escribe

- ¿Escribe al cambiar algo, al cerrar, o las dos? (cargar una pista, editar un cue, cerrar).
- ¿Reescribe al cerrar lo que Surco escribió con él cerrado? ¿Lo conserva al reabrir?
- Prueba: añadir a mano con él cerrado un cue y una lista, abrir, ver que aparecen, cerrar, ver que
  siguen en disco.

## Formato de escritura

- Finales de línea por fichero (`file`, `sed -n l`). Codificación y BOM. Entidades o escapes en rutas.
- Qué pasa si se escriben mal (probarlo una vez con copia): aviso, copia "broken", base nueva, cues
  perdidos.
- Cabecera o relleno que el programa cambia por su cuenta.

## Reloj

Una fila por fichero de la misma canción en WAV, AIFF, FLAC, MP3 (LAME 44,1 kHz, 48 kHz, sin cabecera)
y M4A (AAC, ALAC).

| Fichero | Análisis propio del programa (ancla, inicio) | Rejilla frente a `measureBeatGrid` | Conclusión |
|---|---|---|---|

- Comparar lo que el programa calcula él mismo entre formatos. Si coincide entre formatos y con la
  rejilla de Surco, su posición es el reloj de Surco (desfase 0).
- Los cues que importa de otro programa (etiquetas de Serato, etc.) NO miden su reloj: apuntarlos
  aparte, como conversión de importación.

## Discos externos

- ¿Una base por volumen? Ruta (`<volumen>/<Programa>/...`), forma de las rutas guardadas (absolutas,
  relativas, letra de unidad), entidades.
- Qué letra o prefijo corresponde a cada volumen (medido con uno o dos discos).

## Pista desaparecida

- Fichero renombrado: qué hace con su entrada al abrir y al cerrar.

## Proceso

- Nombre exacto del ejecutable (`pgrep -x <Nombre>`), en macOS y en Windows si se mide.
- Cómo abrirlo (`open -a <Nombre>`) y cerrarlo (¿su Quit pide confirmación? ¿AppleScript devuelve
  "User canceled"? ¿`pkill -TERM` deja la base bien?).
- ¿Pide cuenta o red al abrirse?

## Sin medir

- Lista explícita de lo que queda, con el bloque que lo necesita.
