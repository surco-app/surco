# Decisiones del repaso: un solo botón de convertir y el aviso de idioma flotante

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar las dos decisiones del usuario del 13/11 sobre el boceto: (A10) quitar el botón de convertir de la barra superior y dejar solo el del pie del editor, con el progreso y la cancelación del lote; (W9) convertir el aviso de idioma de la web en una tarjeta flotante que sale del botón de idioma y no mueve la portada.

**Architecture:** A10 en `apps/desktop` (Toolbar, ConvertFooter, Editor y su estado vacío). W9 en `apps/web` (Header y el hook del aviso). A14 no se toca: la columna de resultados ya recuerda el plegado por fuente (`foldedResults` con clave `browser.source`, `App.tsx:895-899`).

**Tech Stack:** Electron + React 19 + TS + Tailwind v4, vite-react-ssg, Vitest, Biome.

**Spec:** boceto aprobado en https://claude.ai/artifact/PiTHmt38i2HmueHimaqeV8 (opción «Solo el de abajo» para A10, «Tarjeta flotante junto al idioma» para W9) y los informes `docs/superpowers/reviews/2026-11-12-repaso/desktop-design.md` (hallazgo 4) y `web-design-a11y.md` (hallazgo 6) / `web-perf.md` (W9).

## Global Constraints

- Worktree `../surco-wt/decisiones`, rama `decisiones`, desde `main` local. Merge a main local al final, sin push.
- Cero comentarios de código. `data-testid` para selectores. Copia en seis idiomas, sin guion largo ni dos puntos explicativos.
- Nada aparece y desaparece solo sin motivo (preferencia del usuario).
- Desktop: `npx tsc --build`, `npm run lint`, `npx vitest run` completo en primer plano antes de cada commit. Web: `npm test -w apps/web` y `npm run build -w apps/web`. Nunca `biome check --write`.
- Títulos de commit descriptivos, sin cuerpo.

## Review Focus

- Un lote lanzado desde la paleta o con ⌘⏎ sin ninguna pista seleccionada: el progreso y la cancelación tienen que verse y funcionar aunque el editor esté vacío.
- Cambiar de selección durante un lote: el progreso y la cancelación siguen en el pie, sea cual sea la pista seleccionada.
- ⌘⏎ y «Convertir todas» de la paleta siguen haciendo lo mismo que hoy.
- W9: con el navegador en el idioma de la página, no sale nada; al cerrar la tarjeta no vuelve (como hoy el banner).

---

### Task 1: Un solo botón de convertir (A10)

**Files:** `apps/desktop/src/renderer/src/components/Toolbar.tsx` (~150-200, el botón de convertir y su pastilla de lote), `components/ConvertFooter.tsx`, `components/Editor.tsx` (estado vacío), `lib/commands.ts` (process-all), locales del escritorio, `docs/funcionalidades.md`.

- [ ] La barra superior deja de mostrar el botón de convertir (con sus etiquetas «Convertir N pistas», «Convertir N seleccionadas», «Convertir N de M» y «Convirtiendo… x/y»). Test: la barra no tiene `data-testid` del botón de convertir en ningún estado.
- [ ] El pie del editor muestra, mientras corre un lote, «Convirtiendo… x/y» y su botón principal pasa a «Cancelar» y cancela el lote (lo que hoy hace la pastilla de la barra), con cualquier selección. Tests: con una selección múltiple, iniciar un lote enseña el progreso y Cancelar lo para; cambiar de selección a mitad conserva progreso y cancelar.
- [ ] Sin ninguna pista seleccionada, mientras corre un lote (lanzado con ⌘⏎ o la paleta), el editor vacío muestra ese mismo pie de progreso con Cancelar. Test.
- [ ] ⌘⏎ y el comando «Convertir todas» de la paleta siguen igual. Tests existentes en verde; uno nuevo si no hay ninguno que lo cubra sin selección.
- [ ] Claves de copia que queden sin uso: quitarlas de los seis idiomas solo si nada más las usa (comprobar con grep; `keys.test` debe seguir en verde).
- [ ] `docs/funcionalidades.md`: cambiar lo que diga del botón de la barra superior. Las capturas de `/guia` que muestren el botón quedan apuntadas como pendientes (no se regeneran aquí).
- [ ] Comprobar en la app real: una pista, varias, y lote sin selección con ⌘⏎, con capturas.

### Task 2: Aviso de idioma como tarjeta flotante (W9)

**Files:** `apps/web/src/components/Header.tsx` (~101-137, el bloque `offered`), el hook `useAutoLanguage`, `apps/web/src/index.css` si hace falta.

- [ ] El aviso deja de estar dentro de la cabecera sticky y pasa a una tarjeta flotante anclada bajo el botón de idioma (posición absoluta o fixed, con una flechita hacia el botón), por encima del contenido, sin ocupar espacio en el flujo. Mismos textos y mismas acciones (cambiar de idioma y cerrar) en seis idiomas.
- [ ] Entra creciendo desde el botón de idioma (transform-origin en el botón, opacidad y escala, ~200 ms, sin rebote); con movimiento reducido, aparición directa.
- [ ] Teclado: la tarjeta es alcanzable con Tab justo después del botón de idioma, Escape la cierra y devuelve el foco al botón.
- [ ] En móvil (390 px) no se sale de la pantalla y no tapa el botón de descarga del hero.
- [ ] Medir en Brave (playwright-core del skill run-desktop, `executablePath` de Brave): CLS de la portada con el navegador en inglés sobre la página en español, antes y después (antes ~0,072 atribuible al banner). Debe quedar en 0 para ese desplazamiento.
- [ ] Texto prerenderizado igual en todas las rutas.
