# Chip de estado activo en los toggles del player

Cierre del punto 4 de la crítica de diseño del mini player: con la onda azul, la porción
reproducida azul y dos toggles activos azules, el acento aparece en tantos sitios que el
estado "activo" de los toggles pierde señal — un icono azul entre azules.

## Decisión

No se atenúa el acento del icono (perdería la lectura de "encendido"); el activo gana un
chip de fondo: `bg-[var(--color-accent)]/10`, con hover a `/20`. El estado se lee por
forma + relleno además del matiz. Mismo recurso de alpha sobre token que los pills
(`bg-[var(--color-panel-2)]/85`).

- Afecta a los dos toggles con estado (`player-continuous`, `player-waveform`) en
  `Player.tsx`. Play/pausa, crosshair y cierre no cambian (no son toggles).
- El fondo pasa a ser totalmente condicional para que no compitan dos `bg-*`:
  activo → chip acento con su hover; inactivo → como hasta ahora
  (`hover:bg-line-strong`).

## Tests

Sin tests nuevos: cambio puramente de estilo; la semántica del estado ya está cubierta
por los tests de `aria-pressed`. Verificación visual con el driver (ambos toggles
activos + screenshot).

## Criterios de cierre

Tests existentes en verde, biome/tsc por fichero, screenshot verificado, merge local a
main sin push.
