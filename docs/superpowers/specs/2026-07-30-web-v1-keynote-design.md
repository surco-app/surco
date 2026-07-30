# Web v1: recorrido de una pista, de principio a fin

Fecha: 2026-07-30
Estado: aprobado

## Objetivo

Rehacer la portada de `apps/web` para el lanzamiento de la v1. La web actual vende
con densidad (cuatro bloques de funciones con ~6 bullets cada uno). La nueva vende
enseñando la app trabajando.

Impresión que debe dejar: **una herramienta profesional que resuelve un problema
real del día a día**. No alivio emocional, no lucimiento técnico.

## Decisiones tomadas

| Decisión | Elegido | Descartado |
|---|---|---|
| Stack | el actual (Vite + React 19 + SSG + i18n) | migrar a Next.js |
| Alcance | rediseñar `apps/web` en sitio | app nueva en paralelo |
| Eje | preparar la música entera, de principio a fin | higiene de metadatos; ahorro de tiempo |
| Estructura | una pista real recorrida entera | cuatro bloques por fase; antes/después |
| Proporción | app en pantalla casi siempre, texto de pie de foto | capítulos conceptuales |
| Titular | el de producción, sin tocar | cuatro alternativas nuevas |
| Densidad actual | sobrevive comprimida debajo | moverla a otra página |

### Por qué se descartó el eje de metadatos

La primera propuesta montaba la web sobre una auditoría real de 72 FLAC: 55 con una
URL de publicidad en COMPOSER, 67 sin BPM, 3 con el artista corrupto. Es material
potente, pero vende **una función como si fuera la app**. Surco hace conversión,
calidad, espectro, declick, loudness, lote y exportación a seis destinos.

La auditoría baja de tesis a **prueba**: aparece dentro de la escena de etiquetar,
como evidencia de por qué ese paso importa.

## Estructura

Apertura + seis escenas + cierre. Cada escena: un trozo de interfaz real a la
izquierda o derecha, un titular corto y un pie. Ni una pantalla de solo concepto.

| # | Escena | Qué se ve | Titular |
|---|---|---|---|
| — | Apertura | vídeo del drop, 300 filas cayendo | Deja de preparar. Ponte a pinchar. |
| 01 | entra | lista poblándose, píldora «Leyendo 212/319» | Suéltalas y ya están dentro. |
| 02 | se comprueba | dos espectros reales comparados | El espectro no miente. |
| 03 | se etiqueta | Discogs/Bandcamp/Deezer + campo corrupto arreglándose | Cada pista, con su nombre puesto. |
| 04 | se limpia | onda con clics marcados + A/B | Los clics del vinilo, fuera. |
| 05 | se ajusta | final real de la pista + imán | Acaba donde acaba la música. |
| 06 | sale | lote corriendo + destinos | Toda la carpeta, de una vez. |
| — | Cierre | descarga | De la carpeta a la cabina. |

Después del cierre, un corte visual explícito y la densidad actual (funciones
completas, atajos, precio, FAQ) para quien ya está convencido.

## Material visual

**Regla: nada de espectros ni ondas dibujados con CSS.** La web dice que el espectro
no miente; enseñar uno falso sería incoherente.

| Recurso | Origen | Nota |
|---|---|---|
| Espectro bueno | FLAC de `Masterboy - Feel The Heat Of The Night` | ffmpeg `showspectrumpic`, escala **lineal** |
| Espectro fake | ese mismo audio → MP3 128k → FLAC | fabricado a propósito; se declara en el pie |
| Onda declick | picos reales a 22 kHz + 9 clics inyectados | la «reparada» es el audio intacto |
| Onda recorte | últimos 12 s reales (fade 0.78 → 0.0001) | caso auténtico |
| Onda completa | 150 picos, 14 en 0 dBFS | clipping real del máster |

Hallazgos del análisis de las 72 pistas que condicionan el rodaje:

- **Ninguna es un falso lossless.** El fake es fabricado y así se dice.
- **Ninguna tiene silencio de entrada** (ya venían recortadas). Para grabar el
  carril de INICIO hace falta un rip sin editar.
- **En escala logarítmica el muro del códec no se ve.** Usar lineal siempre.

## Vídeos

Clips de 4-6 s, silenciosos, en bucle. Rodar desde **disco local**, no desde el NAS:
el SMB es lento con directorios y el clip enseñaría la velocidad de la red, no la
de Surco.

Momentos, por orden de impacto:

1. **El drop** — overlay azul, 300 filas en cascada, skeletons resolviendo.
2. **Fake lossless** — banda de carga barriendo → espectro → el tercio superior se
   inunda de rojo → la píldora salta a «Fake lossless».
3. **El lote** — anillos ámbar pulsando, barras llenándose, la píldora contando,
   anillos convirtiéndose en monedas con check.
4. **El imán del recorte** — el asa engancha en el transitorio.
5. **A/B del declick** — un botón conmutando sin cortar el audio.

## Alcance técnico

Se conserva sin tocar: i18n (es/en), rutas SSG, `Head`/JSON-LD, changelog, guía,
descargas, donaciones, analítica, y los tests existentes.

Se rehace: `App.tsx` (composición de la portada) y los componentes de escena.

Se reutiliza: `Reveal`, `ScrollProgress`, `Band`, `Kicker`, `DownloadButton`,
`Footer`, `Header`, `Pricing`, `Faq`, `InstallSection`.

Componentes nuevos (uno por escena, en `src/components/scenes/`):

- `SceneLayout` — rejilla texto/app, invertible, responsive
- `AppFrame` — chrome de ventana (barra, puntos, píldoras, barra de progreso)
- `TrackRows` — filas con estados (skeleton, procesando, hecho, sospechosa)
- `SpectrumPair` — los dos espectros reales con eje y banda muerta
- `WaveStrip` — onda desde array de picos, con marcas, asa y zona descartada
- `TagFix` — el campo antes/después
- `DestinationRow` — los seis destinos

Copy nuevo bajo `home.*` en los dos locales. El titular (`hero.h1a`/`h1b`) no se toca.

## Rendimiento y accesibilidad

- Espectros como `<img>` con `width`/`height`, `loading="lazy"`, `decoding="async"`.
- Vídeos: `muted playsinline loop preload="none"` con `poster`; solo se cargan al
  entrar en viewport.
- Ondas en SVG o divs con `transform`; nada que anime `width`/`left`.
- `prefers-reduced-motion`: los vídeos no arrancan solos, las revelaciones son
  instantáneas. Ya hay precedente en `Reveal` y `HeroGlow`.
- Contraste AA sobre el fondo. El ámbar de las marcas solo es decorativo; el
  estado nunca se codifica solo con color (siempre hay texto o icono).

## Criterios de aceptación

1. `npm run typecheck`, `npm run lint` y `npm test` pasan en `apps/web`.
2. Los tests de i18n (`keys.test.ts`) siguen verdes: toda clave nueva existe en
   es y en en.
3. La portada renderiza en SSG sin errores de hidratación en las dos rutas.
4. Ningún espectro ni onda generado con gradientes CSS.
5. Con `prefers-reduced-motion: reduce` no hay nada en movimiento automático.
6. Las rutas de guía, changelog y donaciones siguen funcionando igual.

## Fuera de alcance

- Auditar en el navegador la carpeta del visitante (buena segunda página, mala
  primera impresión: convierte el pico emocional en una tarea).
- Rehacer la guía o el changelog.
- Cambiar el titular o la estructura de precios.
