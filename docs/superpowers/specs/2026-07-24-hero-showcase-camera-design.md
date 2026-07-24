# HeroShowcase: cámara + lista de features en el hero de la web

El tour actual del hero (`apps/web/src/components/HeroTour.tsx`) — hotspots numerados
sobre la captura, spotlight que oscurece el resto y tarjeta flotante — no convence como
concepto. Se sustituye por un patrón de "cámara + tabs": lista de features a un lado y
la captura haciendo pan/zoom suave hacia la zona de la feature activa. Sin oscurecer ni
tapar: la cámara encuadra.

## Decisión

Componente nuevo `apps/web/src/components/HeroShowcase.tsx` que reemplaza a
`<HeroTour />` en `App.tsx`. `HeroTour.tsx` y la clave i18n `showcase.tourHint` quedan
sin uso y se eliminan. Las claves `showcase.tour.*`, el botón de zoom y el `Lightbox`
se conservan.

## Layout

- Desktop: grid de dos columnas — lista de features (~1/3) a la izquierda, captura
  (~2/3) a la derecha, dentro de un marco con el estilo actual (borde `line`, fondo
  `bg2`, sombra, glow radial detrás).
- Móvil: apilado, captura arriba y lista debajo.
- Lista: 5 items (número + título desde `showcase.tour.*`). La activa se expande con su
  descripción y una barra de progreso fina que se llena durante el intervalo de
  autoplay; las inactivas quedan atenuadas. Patrón tablist accesible: items como
  `tab`s, el panel de la captura como `tabpanel`.

## Cámara

- El mismo `app-{lang}.webp` (2000×1242) dentro de un viewport `overflow-hidden` con la
  relación de aspecto de la imagen.
- Cada feature define su encuadre como rectángulo en porcentajes (punto de partida: los
  `REGIONS` de `HeroTour`, retocados para componer bien).
- Al activar una feature la imagen se mueve con `transform: scale(...) translate(...)`
  hacia ese encuadre; ~900ms con el ease de la página
  `cubic-bezier(0.22,1,0.36,1)` y `will-change: transform`.
- Zoom capado a ~2.2× para no pixelar (el asset de 2000px da margen de sobra; el
  atributo `sizes` declara el ancho efectivo con zoom para que el navegador sirva el
  webp grande).
- La escala ajusta el ancho del encuadre — `min(cap, 100/width%)` — y las zonas altas
  recortan por arriba/abajo en vez de aplanar el zoom; centrado en el rectángulo y con
  el translate acotado a los bordes de la imagen.

## Autoplay

- Arranca cuando la sección entra en viewport (IntersectionObserver); avanza cada ~6s
  en orden 1→5 y vuelve a la 1.
- Hover sobre el componente lo pausa; clic del visitante en una feature la selecciona y
  **detiene el autoplay definitivamente** (el visitante toma el control).
- `prefers-reduced-motion`: sin autoplay y sin transición — cambios instantáneos al
  hacer clic.

## Tests (Vitest, TDD)

- Renderiza los 5 títulos desde i18n con roles de tablist.
- Clic en una feature la activa (aria-selected) y detiene el autoplay (con fake timers:
  tras el clic ya no avanza).
- El autoplay avanza de la 1 a la 2 pasado el intervalo (fake timers).
- Con `prefers-reduced-motion` (matchMedia mockeado) no hay autoplay.

## Criterios de cierre

Tests nuevos y existentes en verde, biome/tsc por fichero tocado, verificación visual
de la web en dev, merge local a main sin push.
