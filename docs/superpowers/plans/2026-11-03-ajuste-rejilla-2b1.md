# Ajuste de rejilla, parte 2b-1 (Traktor y Engine en formatos sin compresión)

**Goal:** Editar, ajustar con Auto y guardar la rejilla en las pestañas de Traktor y Engine para WAV, AIFF y FLAC.

**Spec:** `docs/superpowers/specs/2026-11-03-ajuste-rejilla-design.md`

## Medido (03/11, su Mac)

- Engine, 21 AIFF: rejilla − onda de Surco ≈ +1,4 ms de mediana (el +2 del golpe tras la subida que ya usa rekordbox). Reloj de Engine = reloj de Surco en PCM.
- Traktor, 12 MP3: ≈ +29 ms estable = retardo del codificador (576+529 muestras) que Traktor no descuenta. Queda para 2b-2 junto con desplazar la onda y la escucha.
- Traktor AIFF/FLAC, Engine WAV/MP3/FLAC: sin muestras. WAV, AIFF y FLAC no tienen retardo de decodificador; se habilitan por eso (decisión mía, con la medición de AIFF en Engine como apoyo).

## Reglas

- Habilitado en Traktor y Engine solo para `.wav`, `.aif`, `.aiff`, `.flac`. El resto sigue con el motivo "reloj sin medir".
- Sin zonas en Traktor y Engine en este paso: botón de ancla deshabilitado; una rejilla leída con zonas deshabilita la fila con el motivo de varios tempos.
- Rejilla bloqueada en el programa (Traktor `LOCK="1"` en ENTRY, Engine `Track.isBeatGridLocked`): fila deshabilitada con motivo propio.
- Auto: `gridFit` con desplazamiento 0 + 2 ms (como rekordbox en PCM).
- Traktor escribe en collection.nml: el CUE_V2 TYPE="4" (START = primer golpe 1 ≥ 0, `<GRID BPM>`) y `<TEMPO BPM>` de la entrada. Si no hay marcador, se crea uno.
- Engine escribe en `PerformanceData.beatData` solo la lista ajustada (dos marcadores: primer golpe ≥ 0 y último antes del final) y `Track.bpm`/`bpmAnalyzed`.
- Ambos con la huella de rejilla aparte, como rekordbox.

## Tareas

1. `TrackCues.gridLocked` en los lectores de Traktor y Engine; motivo "bloqueada" y filtro por formato en `CuesSection`; ancla deshabilitada fuera de rekordbox.
2. `gridFit` y `gridVerdict` para Traktor y Engine en PCM (fichero desde el NML / la base de Engine; `host.beatGrid` inyectado).
3. Escritura en Traktor (`withTraktorGrid`) dentro de `planBatch`, con huella, bloqueo y BPM válido.
4. Escritura en Engine (`encodeAdjustedGrid` en `engineBlobs.ts`) dentro de `plan`, con huella, bloqueo y BPM válido.
5. Suite, tipos, lint y prueba en la app sobre copias de collection.nml y m.db.
