# Player waveform polish

Tres mejoras de usabilidad sobre la onda del mini player, aprobadas tras crítica de diseño
sobre captura real. Ficheros afectados: `Waveform.tsx` y `Player.tsx` (renderer).

## 1. Altura y raster

- El canvas pasa de `h-12` (48px) a `h-16` (64px): a 48px la dinámica del tema se comprime
  y un break o un drop apenas se distinguen — leer la estructura de un vistazo es el valor
  de la onda frente a una barra.
- `CANVAS_H` sube de 96 a 128: a @2x, 64px CSS = 128 píxeles de dispositivo, raster 1:1.
  Sin el bump, la onda más alta escalaría 96→128 con blur vertical.
- `CANVAS_W` no se toca.

## 2. Split reproducido/pendiente

Patrón SoundCloud/Serato: la porción ya reproducida a color pleno, el resto atenuado, para
que el progreso se lea con visión periférica sin buscar el playhead.

- Dos canvases apilados, ambos pintados **una vez** con el mismo `drawWaveform`
  (acento + RMS, argumentos idénticos).
- El canvas base lleva opacidad CSS reducida (~0.35) — es la porción pendiente. El fondo
  `bg-black/15` sube al wrapper para que la atenuación no lo afecte.
- El canvas superior, absoluto encima, se recorta con `clip-path: inset(0 X% 0 0)` donde
  X = 100 − progreso%. Actualizar un clip-path inline a ~4Hz no redibuja el canvas —
  misma filosofía que el playhead por `translateX` ya documentada en el fichero.
- El playhead blanco se mantiene: el split da progreso periférico; la línea, posición
  exacta para scrub fino.
- Sin playhead activo (player en otra pista), el canvas superior queda recortado al 0% y
  solo se ve la capa atenuada.

Descartado: redibujar el canvas con dos colores en cada `timeupdate` (repaint a 4Hz,
contra la filosofía explícita del componente) y un velo semitransparente sobre la zona
pendiente (teñiría la banda de fondo y crearía una costura visible).

## 3. Reloj siempre visible

En modo onda, el pill de tiempo (`player-time`) deja de depender de `hovered`: visible
siempre, también en pausa. El pill de volumen mantiene su fade por hover tal cual. La fila
compacta sin onda ya mostraba el tiempo siempre; no cambia.

## Tests

- `Waveform.test.tsx`: el canvas reproducido se recorta al porcentaje del playback
  (15s/60s → `inset(0 75% 0 0)`); ambas capas se pintan con el mismo envelope.
- `Player.test.tsx`: `player-time` visible sin hover en modo onda; el pill de volumen
  sigue oculto hasta hover.

## Criterios de cierre

Tests en verde, biome/tsc limpios por fichero (nunca `npm run check` global), commits
incrementales (una funcionalidad por commit), merge local a main sin push.
