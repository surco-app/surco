# Fase (d), primer tramo: de Serato y Traktor al USB de Pioneer

Continúa `2026-11-03-serato-cuarto-programa-design.md` (objetivo 2, fase d: "USB desde cualquier
programa"). Las fases (a), (b) y (c) de Serato están en main.

## Por qué

Hoy solo se puede exportar al USB desde rekordbox (USB de Pioneer) y desde Engine (USB de
Engine). Un DJ que prepara en Serato o en Traktor no puede llevar sus crates o playlists a un
CDJ sin pasar por rekordbox. Kue (la competencia, gratis) ya lleva Serato a un USB de Pioneer.
Decisión del usuario (04/11): empezar la fase (d) por "Serato/Traktor → USB Pioneer", con la
regla de siempre: "estate seguro de que no rompemos nada".

## Lo que ya hay (medido en el código el 04/11)

- El exportador de Pioneer (`usbExport.ts`, `usbExportStage.ts`, `bakenXml.ts`, `bakenRun.ts`)
  prepara un `collection.xml` y llama a baken 4.6.1 (`expressport`). Ya pasa
  `--generate-analysis`: baken calcula la onda decodificando el audio cuando no le damos el
  análisis de rekordbox, y toma la rejilla (`TEMPO`) y los cues (`POSITION_MARK`) del XML. Los
  autores de baken lo han probado en CDJ-3000 y CDJ-2000NXS2, con análisis copiado y generado.
- `buildBakenXml` no sabe de rekordbox: recibe `ExportSelection` (playlists y pistas) y, por
  pista, la rejilla como `Beat[]`.
- Lo que sí es de rekordbox: leer `master.db`, copiar su análisis y sus carátulas
  (`shareDir`), los My Settings, la identidad de la colección (`--master-ids`), los IDs de
  dispositivo, los ficheros `playlists3.sync`, el aviso de rekordbox abierto y la memoria de
  exportaciones (`usb-exports.json`). Todo eso tiene ya un camino "sin él": `identity` puede
  ser `null`, sin `settingsDir` baken recibe `--no-settings`, sin `analysisPath` no se copia
  análisis.
- Serato y Traktor ya se leen: árbol y pistas (`seratoLibrary.ts`, `traktorPlaylists.ts`), y
  cues, bucles y rejilla en el reloj de Surco (`seratoCueSource.ts`, `traktorCues.ts`,
  `traktorNmlCues.ts`, `CueReader.trackCues`). El flujo de cues entre programas (fase b) ya
  sabe pasar cues del reloj de Surco al de rekordbox.

## Objetivos

1. **Exportar al USB de Pioneer desde la pestaña Serato:** crates y subcrates, con sus pistas
   en orden, sus cues (memoria y hot cues A–H), sus bucles, su rejilla, título, artista,
   álbum, género, clave y BPM. El USB lo lee un CDJ como uno de rekordbox.
2. **Lo mismo desde la pestaña Traktor:** playlists y carpetas, con cues, bucles, rejilla,
   valoración y los datos que da su colección.
3. **Las mismas pantallas que hoy:** el botón de USB en el árbol, el modal con su plan
   (espacio, pistas que faltan, avisos de equipo) y el progreso. Lo que dice "rekordbox" en
   esos textos y no aplica deja de decirlo cuando el origen es Serato o Traktor.

## No objetivos

- **USB de Engine desde Serato o Traktor**, y **USB de Serato** desde cualquier programa: son
  los otros dos tramos de la fase (d), con su propio diseño.
- **My Settings** de rekordbox en un USB hecho desde Serato o Traktor: se exporta siempre con
  `--no-settings`, así el CDJ conserva sus ajustes (lo que suele querer un DJ sin rekordbox).
- **Sincronizar con rekordbox:** sin `playlists3.sync`, sin identidad de colección ni IDs de
  dispositivo. rekordbox verá el USB como uno ajeno.
- **Análisis de frases** (solo existe si lo hizo rekordbox) y **valoración de Serato** (vive en
  `master.sqlite`).
- **Color de los cues:** el XML de baken no lo lleva hoy, ni desde rekordbox.
- Windows para Serato (ya excluido en la fase c). Traktor sí en Windows, como hoy su pestaña.

## Antiobjetivos

- **Cambiar en algo la exportación desde rekordbox o desde Engine.** Sus tests y su
  comportamiento quedan idénticos.
- **Escribir en la biblioteca de Serato o de Traktor**, ni en `master.db` de rekordbox. El
  origen solo se lee.
- **Cues fuera de sitio en el CDJ.** Un cue cuya posición en el reloj de rekordbox no se puede
  calcular con lo medido no se exporta, y el plan lo dice; nunca se manda uno a ojo.
- **Mezclar la memoria de exportaciones** de un origen con la de otro.

## Diseño

### Origen y destino

- La petición de exportación distingue el **origen** (rekordbox, Engine, Serato, Traktor) del
  **formato del USB** (Pioneer o Engine). Serato y Traktor van al formato Pioneer.
- Cada origen nuevo tiene su lector, que devuelve la misma `ExportSelection` que hoy da
  `master.db`, más la rejilla de cada pista. El resto del exportador de Pioneer se reutiliza con
  las piezas de rekordbox apagadas (sin análisis copiado, sin carátulas de su caché, sin
  identidad, sin `.sync`, sin My Settings, sin aviso de rekordbox abierto).
- Cada origen guarda su propia memoria de exportaciones.

### Pistas

- IDs numéricos estables dentro de una exportación (baken los exige numéricos).
- Datos que el origen no tiene se dejan vacíos o a 0.
- Una pista que no está en disco aparece como "falta", igual que hoy.

### Cues y rejilla

- Se parte de lo que ya da `trackCues` del origen (reloj de Surco) y se pasa al reloj de
  rekordbox con la misma conversión que usa el flujo de cues hacia rekordbox (fase b). Hot
  cues A–H por su letra, el resto como cues de memoria, bucles con su final.
- La rejilla va como `TEMPO`: un tramo por cada cambio de BPM, en el mismo reloj.
- Si el desfase de un formato no está medido para ese origen, la pista se exporta sin cues ni
  rejilla y el plan la cuenta aparte.

### Árbol

- **Serato:** un crate con subcrates puede tener pistas propias. En el USB pasa a una carpeta
  con su nombre, que contiene una playlist con sus pistas propias (si tiene) y sus subcrates.
- **Traktor:** carpetas y playlists tal cual; las smartlists no se ofrecen (ya no salen en su
  pestaña).

## Cómo no romper nada

- Tests primero en cada pieza nueva: los dos lectores, la conversión de cues y rejilla, el
  árbol de Serato y el XML resultante para pistas de Serato y de Traktor.
- Los tests actuales de la exportación (`usbExport*.test.ts`, `bakenXml.test.ts`,
  `UsbExportModal.test.tsx`, `useUsbPlan.test.tsx`) pasan sin tocar lo que afirman.
- Prueba manual al final, sobre `~/Music/Serato Pruebas` y la colección de Traktor de pruebas,
  exportando a una carpeta (el exportador ya admite carpeta como destino):
  - el `export.pdb` y los `ANLZ` que deja baken;
  - abrir esa carpeta como dispositivo en rekordbox (solo lectura) y comprobar playlists, onda,
    rejilla y que los cues caen en el chasquido de las pistas de medida (regla de 50 ms).
- Sin CDJ a mano: lo que diga el CDJ queda pendiente y se avisa en el resumen.

## Lo que queda al constructor

- El nombre y la forma del campo de origen en la petición, y cómo se reparte el router.
- Qué datos extra de Serato se leen de las etiquetas del fichero (duración, año, sello) si son
  baratos; si no, se dejan vacíos.
- Los textos nuevos o neutros del modal, en los 6 idiomas, sin guion largo ni dos puntos de
  explicación.
