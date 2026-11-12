# Revision de diseno y accesibilidad de la web de Surco

Alcance: apps/web (dist ya construido, servido con vite preview en :4317, ya detenido). Paginas medidas: /, /en, /funciones, /en/features, /guia, /cambios, /casos-de-uso, /convertir. Anchos 1440 y 390, claro y oscuro, reduced motion, teclado, axe-core 4.10.2 (reglas wcag2a/aa/21aa + best-practice). La skill apple-design esta deshabilitada para el modelo, asi que use web-design-guidelines (sin descargar el listado remoto) y mi propio criterio de jerarquia/materiales/movimiento. Capturas en este mismo directorio: /private/tmp/claude-501/-Users-vicent-code-surco/67320b12-9df1-495b-ba11-01b7b0364003/scratchpad/review/ (shot-*.png, m-en-light.png, m-menu.png, kb-skip.png). Datos crudos: audit.json, scripts audit.mjs y kb.mjs.

## Resumen
1. Base muy solida: skip link funcional, foco visible 2px en todo, un solo H1 por pagina, lang correcto por idioma, sin desbordamiento horizontal a 390, alt en todas las imagenes, selector de idioma operable con teclado (Enter abre, Escape cierra y devuelve el foco), reduced motion pausa el video y muestra los reveals.
2. El unico fallo real de contraste (axe, serious): `text-faint` sobre `bg-surface` mide 4,37:1 (necesita 4,5) en la rejilla de grupos de /funciones (6 nodos) y en /convertir; solo en oscuro. La causa es el token, no cada uso.
3. El CTA de descarga es claro (boton 44 px, version, peso, arquitectura), pero el header de escritorio no tiene boton Descargar y los enlaces secundarios del hero (Intel Mac, macOS 12, Stats) miden 16-20 px de alto.
4. Problemas de interaccion menores: video del hero en bucle sin control de pausa (WCAG 2.2.2), tabla de programas con scroll horizontal no enfocable en movil, banner de oferta de idioma pegado al header sticky.
5. Nada que bloquee la descarga; todo es pulido. Los 8 quick wins suman menos de una hora.

## Hallazgos (por impacto sobre quien decide descargar)

### 1. Token `--color-faint` no cumple 4,5:1 sobre superficies (oscuro)
- Pagina: /funciones y /en/features (6 nodos, 1440 y 390), /convertir (1); tema oscuro. Claro pasa.
- Visto: axe color-contrast serious, `#838bb2` sobre `#24283b` = 4,37:1, 12 px. Son los contadores "N funciones" de las tarjetas de grupo y la linea de spec de /convertir.
- Regla: WCAG 1.4.3 AA. El comentario del token dice que se ajusto contra `--color-bg`, no contra `--color-surface`.
- Donde: apps/web/src/index.css:28 (token), usos en components/Features.tsx:71 y components/ConvertPage.tsx:138.
- Arreglo: subir faint a ~#8c94ba (>=4,5 sobre #24283b y sobre #1a1b26) y actualizar el comentario; contrast.test.ts ya existe, anadir el par faint/surface.
- Esfuerzo: S.

### 2. El header de escritorio no ofrece Descargar
- Pagina: / y /en, 1440, ambos temas. kb-skip.png / shot-_en-1440-dark.png.
- Visto: el header sticky solo tiene Funciones, Guia, Casos de uso, Novedades, tema, idioma. Al bajar por la pagina (el hero es lo unico con CTA) el visitante que ya esta convencido a media pagina tiene que subir o ir a #instalar. En movil pasa igual (menu solo con 4 enlaces).
- Regla: jerarquia / CTA siempre alcanzable.
- Donde: components/Header.tsx:160 (nav) y :357 (nav movil).
- Arreglo: boton pill pequeno "Descargar" (mismo `btnPrimary`) a la derecha del selector de idioma que aparezca cuando `scrolled` sea true y el CTA del hero haya salido de pantalla; apunta a #instalar.
- Esfuerzo: M.

### 3. Enlaces secundarios del bloque de descarga con diana minuscula
- Pagina: / y /en, 390 y 1440. Medido: "Intel Mac" 55x16, "macOS 12" 61x16, "Stats" 48x20, "Ver la guia" 131x20.
- Regla: WCAG 2.5.8 (24 px minimo) y guia tactil 44 px. En movil el visitante con Mac Intel (el que mas necesita ese enlace) debe acertar un subrayado de 16 px.
- Donde: components/DownloadButton.tsx:31 (`altLink`), usado tambien en :272.
- Arreglo: `inline-block py-1.5 -my-1.5` (agranda la diana sin mover el layout) o `py-2` en movil.
- Esfuerzo: S.

### 4. Video del hero en bucle infinito sin control
- Pagina: / y /en, ambos anchos, movimiento permitido. HeroApp reproduce al entrar en vista, `loop`, sin boton de pausa; con reduced motion si se detiene (bien).
- Regla: WCAG 2.2.2 Pause, Stop, Hide (contenido en movimiento de mas de 5 s). Ademas el `<video>` no tiene nombre accesible propio.
- Donde: components/HeroApp.tsx:55-70 (video), :20-36 (efecto).
- Arreglo: boton pausa/play de 36 px en la esquina (aria-pressed, data-testid), o parar tras 1-2 vueltas; `aria-hidden` en el video porque la imagen tiene alt.
- Esfuerzo: S-M.

### 5. Tabla de programas: region con scroll sin foco
- Pagina: /funciones y /en/features, 390, ambos temas. axe scrollable-region-focusable serious (1).
- Visto: tabla con `min-w-[760px]` dentro de contenedor `overflow-x-auto`; un usuario de teclado no puede desplazarla.
- Regla: WCAG 2.1.1.
- Donde: components/ProgramTable.tsx:42.
- Arreglo: `tabIndex={0} role="region" aria-label={t(...)}` (clave i18n en 6 idiomas) en el contenedor; el foco ya tiene estilo global.
- Esfuerzo: S.

### 6. Banner "Esta pagina tambien esta en ingles" dentro del header sticky
- Pagina: / con navegador en en, 1440 claro (shot-_-1440-light.png). Aparece sobre el header y, al ser parte del `sticky`, ocupa ~37 px de pantalla durante todo el scroll en movil hasta cerrarlo.
- Regla: no tapar contenido persistente; la oferta de idioma es util pero no debe ser permanente.
- Donde: components/Header.tsx:101 (header sticky) y :113-137 (bloque offered).
- Arreglo: sacar el banner del elemento sticky (que scrolle con la pagina) o ocultarlo tras el primer scroll.
- Esfuerzo: S.

### 7. Logo con alt duplicado
- Pagina: todas. axe image-redundant-alt (minor).
- Visto: `<img alt="Surco">` junto al texto "Surco" en el mismo enlace; lector de pantalla dice "Surco Surco".
- Donde: components/Header.tsx:150 y components/Footer.tsx:23.
- Arreglo: `alt=""` (decorativo, el texto ya nombra el enlace).
- Esfuerzo: S.

### 8. Anclas "#" dentro de los H2 ensucian el nombre del encabezado
- Pagina: / y /en. Los H2 de cada escena llevan un `<a aria-label="Link to this example">#</a>` anidado; el nombre accesible del titulo termina en "#", y en navegacion por encabezados se oye "That lossless file was an MP3 #". En tactil se oculta (bien).
- Donde: components/scenes (data-testid="scene-anchor"); el marcado sale de SectionView/Blocks (buscar `scene-anchor`).
- Arreglo: sacar el enlace del H2 (hermano posicionado con el mismo grupo hover) o `aria-hidden` no vale (es focusable); mejor hermano.
- Esfuerzo: S-M.

### 9. Menu movil: sin cierre al cambiar foco ni trampa, solo Escape
- Pagina: 390, ambos temas (m-menu.png). Escape cierra (bien), el panel usa `invisible` cuando cerrado (bien). El panel es `bg-bg/95` y deja traslucir el hero debajo del ultimo enlace: se lee "Surco converts your tracks..." justo bajo "What's new".
- Regla: materiales; separacion clara del panel.
- Donde: components/Header.tsx:361.
- Arreglo: `bg-bg` opaco (o /98) + sombra inferior; el blur no basta.
- Esfuerzo: S.

### 10. Dianas pequenas en pie y en /cambios
- Pagina: footer en 390 (Funciones 56x17, Guia 38x17, Donar 46x17, Privacidad 44x20...); /cambios 149 enlaces/botones <24 px (indice de versiones).
- Regla: WCAG 2.5.8 y espaciado entre dianas.
- Donde: components/Footer.tsx (enlaces de columnas), components/Changelog.tsx.
- Arreglo: `py-2` en los enlaces del footer en movil; revisar el indice de versiones de Changelog.
- Esfuerzo: S.

### 11. Texto de 8-11 px
- Hay 19 usos de `text-[11px]`, 8 de `text-[10px]`, 2 de `text-[9px]`, 1 de `text-[8px]`. Los de scenes/ son reproducciones de la UI de la app (aria-hidden, aceptable). Los reales: chips de UseCase.tsx:89 y :124 (11 px, color faint), ejes de graficas Stats.tsx (11 px en escritorio).
- Regla: tipografia legible, minimo ~12 px para texto que informa.
- Arreglo: 12 px en los chips de UseCase y en los ejes de Stats.
- Esfuerzo: S.

### 12. Landmark nav sin etiqueta y sin nav en el footer
- Pagina: todas. Hay 3 `<nav>`: el principal y el movil sin aria-label, y el tercero ("See how") etiquetado; el footer es un `<footer>` con enlaces sin `<nav>`.
- Regla: landmarks distinguibles.
- Donde: components/Header.tsx:160 y :357; components/Footer.tsx.
- Arreglo: aria-label="Principal" (i18n) en los dos del header; envolver enlaces del footer en `<nav aria-label>`.
- Esfuerzo: S.

### 13. Texto del H1 sin espacio en textContent
- Pagina: / y /en. `h1.textContent` = "From downloadto the booth" (dos spans de bloque). innerText lleva salto de linea, asi que los lectores modernos lo leen bien, pero herramientas de extraccion, snippets de buscadores y algunos lectores lo juntan.
- Donde: hero (i18n home.h1a/h1b renderizados en el componente del hero; mismo patron que ConvertPage.tsx:118 que si usa `{a} {b}`).
- Arreglo: anadir `{' '}` entre los dos spans como en ConvertPage.
- Esfuerzo: S.

### 14. `theme-color` fijo para dos temas
- index.html:13 y :25-26 solo ajusta el meta una vez al cargar; revisar que el boton de tema del header (Header.tsx:186) lo actualice. No verificado en navegador (headless no pinta la barra).
- Esfuerzo: S.

## Lo que esta bien (no tocar)
- Skip link visible al primer Tab (kb-skip.png), orden de Tab logico: logo, nav, tema, idioma, novedad, CTA, enlaces secundarios, tarjetas.
- Foco: `:focus-visible` 2px azul con offset en todos los elementos (index.css:120).
- Idiomas: `<html lang>` correcto en es/en/de/fr, `lang`/`hreflang` en cada opcion del menu, aria-current en la activa.
- Reduced motion: video no arranca, reveals visibles, scroll-behavior auto (index.css, bloque prefers-reduced-motion).
- Sin scroll horizontal en ninguna pagina a 390; imagenes con width/height (sin CLS), 24 de 27 en lazy; hero con fetchPriority alto.
- Contraste en claro: cero fallos axe en todas las paginas.
- Jerarquia del hero: un H1 grande, subtitulo, un solo CTA primario, metadatos de version/peso/arquitectura debajo; el lightbox usa role=dialog + aria-modal + foco devuelto.

## Quick wins (< 1 h en total)
1. #1 faint a ~#8c94ba (index.css:28) + test de contraste.
2. #7 alt="" en logos (Header.tsx:150, Footer.tsx:23).
3. #3 agrandar diana de `altLink` (DownloadButton.tsx:31).
4. #5 tabIndex/role/aria-label en ProgramTable.tsx:42.
5. #9 fondo opaco del menu movil (Header.tsx:361).
6. #12 aria-label en los nav.
7. #13 espacio entre h1a/h1b.
8. #11 chips de UseCase a 12 px.

## No cubierto
- No se midieron de, fr, ja, pt-BR en navegador mas alla de lang/hreflang (las cadenas largas en aleman/frances pueden desbordar el boton de descarga o el selector; vale una pasada con la misma audit.mjs cambiando rutas).
- Contraste dentro de las escenas SVG del hero (axe no calcula bien sobre SVG/canvas) ni el video.
- Lector de pantalla real (VoiceOver) no probado.
