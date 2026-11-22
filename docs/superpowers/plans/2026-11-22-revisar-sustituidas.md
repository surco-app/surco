# Revisar las pistas sustituidas: índice del plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, one phase after another, in this order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-11-22-revisar-sustituidas-design.md`

## Fases, en este orden

| Fase | Plan | Tareas |
|---|---|---|
| 1 | `2026-11-22-revisar-sustituidas-fase-1-traktor.md`: Traktor sigue la sustitución con sus cues, también con «Add to Traktor» sin «Sync Traktor» | 8 |
| 2 | `2026-11-22-revisar-sustituidas-fase-2-serato.md`: Serato sigue la sustitución, copia cues y rejilla, aviso de estrellas | 10 |
| 3 | `2026-11-22-revisar-sustituidas-fase-3-medida.md`: medir el desfase y desplazar los cues en los cinco programas; fallo de frecuencia de Engine DJ | 10 |
| 4 | `2026-11-22-revisar-sustituidas-fase-4-lista.md`: almacén, nodo «To review», pastilla, «Reviewed» con ⌘Z | 9 |

## Piezas compartidas entre fases

- `RekordboxRepoint.replaced?: true`, puesto por `rekordboxRepointFor` cuando hay `replaces`. **Lo crea la fase 1.** La fase 2 lo reutiliza: si ya existe, sus pasos que lo añaden se quedan en comprobar que está.
- `const replacedCueShift: CueShift = { shiftMs: 0 }` en `convertAudio` (fase 1) y `const replaceCueShiftMs = 0` (fase 2). La fase 3 los sustituye por la medida.
- `shared/replaceShift.ts` con `ReplaceShift` y `UnmovedReason` (fase 3), y `ProcessResult.replaceShift?`, que consume la fase 4.
- La fase 3, antes de su tarea 5, comprueba con `grep` que los nombres de las fases 1 y 2 existen tal cual. Si algo difiere, se usa lo real y se informa.

## Decidido por Vicent

- Reanálisis de rekordbox cuando una sustitución copia el audio tal cual y la medida dice que se movió: SÍ (22/11). Fase 3, tarea 5, paso 9.

## Reglas de cierre de cada fase

- Suite entera desde `apps/desktop` con código de salida 0 y sin `Unhandled`/`Errors`, `npx tsc --build` desde `apps/desktop`, y lint de escritorio y web enteros.
- Todo se queda en la rama `revisar-sustituidas` hasta acabar y probar las cuatro fases. Entonces se hace merge a main local sin push. Ningún release hasta que Vicent lo diga.
- Las pruebas reales usan copias, salvo VirtualDJ. Hay que avisar a Vicent antes de tocar rekordbox o Music.
