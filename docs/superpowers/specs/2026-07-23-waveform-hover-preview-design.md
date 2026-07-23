# Preview del scrub en la onda del player

Al pasar el cursor por la onda, una línea fantasma bajo el puntero y una burbuja con el
tiempo de destino (patrón rekordbox/SoundCloud): el DJ sabe a qué segundo caerá el click
antes de hacerlo, en vez de buscar por prueba y error. Fichero afectado: `Waveform.tsx`.

## Comportamiento

- `pointermove` sobre la franja guarda la fracción 0..1 del cursor; `pointerleave` la
  limpia. Durante un drag de scrub (pointer capture) el preview sigue al puntero igual.
- Línea fantasma: vertical, más discreta que el playhead (mismo `bg-fg` pero atenuada,
  1px), posicionada con el mismo truco de carrier + `translateX(%)` que el playhead —
  compositor, sin relayout por movimiento.
- Burbuja de tiempo: `formatTime(fracción × durationSec)`, con el mismo vestido que el
  pill del reloj (panel translúcido, ring, 10px tabular) para mantener el vocabulario.
  Centrada sobre la línea; en los extremos (<8% / >92%) se alinea al borde interior para
  no recortarse contra el card.
- Sin duración (`durationSec === 0`) no hay franja (ya se renderiza null); sin cursor
  encima no se pinta nada — el estado de reposo no cambia.

## Tests

`Waveform.test.tsx`: mover el puntero a 1/4 de una pista de 60s muestra la burbuja
«0:15» con el carrier en `translateX(25%)`; `pointerleave` lo oculta.

## Criterios de cierre

Tests en verde, biome/tsc por fichero, verificación visual con el driver (hover sobre la
onda + screenshot), merge local a main sin push.
