# Convertir una pista usando solo el teclado

Fecha: 2026-07-31
Estado: aprobado, pendiente de implementación

## Origen

Djotas, que trabaja con un teclado de macros (15 teclas + 3 encoders), probó los atajos
del editor de silencios de la v0.77 y respondió "no me agrada". El diagnóstico tardó en
llegar porque su queja se confundió con dos bugs reales que sí existían (el corte
descartado en el borde y `⌘R` deshabilitado), ya corregidos en 0.77.1.

La causa de fondo la señaló el usuario del repo: **el modelo pedía enfocar un tirador
antes de que las teclas hicieran nada**. Para quien viene de un controlador de DJ, una
tecla se pulsa y actúa; "haz clic en la línea del corte para que el teclado funcione" es
una frase que no debería existir en esta herramienta.

Y hay un segundo problema, medido: con una sola sección abierta el editor tiene **133
paradas de tabulador**. Llegar al recorte desde el campo de título es cruzar decenas de
campos.

## Objetivo

Que un usuario pueda convertir una pista de principio a fin sin tocar el ratón, con teclas
que actúan sobre lo que tiene delante y sin pasos invisibles.

## Estado actual (verificado en código)

- `SHORTCUT_DEFAULTS` (`shared/shortcutDefaults.ts`) es la tabla única de atajos, con
  overrides por usuario, y `matchChord` los resuelve. Soporta `scope` (ámbito por foco),
  usado hoy por `track-menu`.
- `lib/spaceClaim.ts` implementa un **registro de teclas reclamadas**: una sección abierta
  registra manejadores y el listener global los consulta antes que el registro de
  comandos. Lo creó click-repair para quedarse con Espacio mientras está abierto.
- `hooks/useEditorSections.ts` expone `editorSectionOpen(id)`, legible desde fuera de
  React.
- `SectionHeader` ya es `<button>` con `aria-expanded`: plegar y desplegar con teclado ya
  funciona **si se consigue llegar a la cabecera**.
- Las 8 secciones tienen orden configurable y algunas se pueden ocultar.

### Bug encontrado durante el diagnóstico (ya corregido en esta rama)

`electron.vite.config.ts` no fijaba `manualChunks`, y Rollup **duplicaba
`lib/spaceClaim`** en dos chunks: el de entrada (donde vive el listener global) y el
diferido del editor (donde viven las secciones). Cada copia tenía su propia pila de
reclamos, así que lo registrado en una era invisible para la otra.

Consecuencia: **el reclamo de Espacio de click-repair estaba roto en producción** desde
que existe. Los tests nunca lo vieron porque Vitest usa un único grafo de módulos, sin
chunks. El arreglo fuerza el módulo a un chunk compartido.

## Diseño

### 1. Las teclas del recorte: una por lado, sin foco

Nueve comandos que actúan sobre la pista abierta mientras el editor de silencios está
**desplegado**. Sin foco en ninguna parte.

| Acción | Corte de entrada | Corte de salida |
|---|---|---|
| Mover atrás | `q` | `o` |
| Mover adelante | `w` | `p` |
| Escuchar | `a` | `l` |
| Limpiar | `z` | `.` |
| Aplicar lo detectado | `s` (ambos lados a la vez) | |

`⇧` da el paso grueso (100 ms) en las cuatro de mover; sin él, 1 ms.

**Una tecla por lado, no un lado activo.** Sin foco que desambigüe, la tecla ES el lado:
cero estado que recordar y una pulsación nunca puede mover el corte equivocado. Un
macropad absorbe ocho teclas sin problema, que es justo para lo que existe.

**El punto de partida es la línea que se ve.** Con la pista aún sin recortar, la línea del
corte se dibuja sobre el silencio detectado, no sobre el segundo cero (las calles enmarcan
ahí). La tecla parte de esa línea. Leyendo el `0` interno, la primera pulsación movía un
milisegundo al principio de la pista mientras la línea seguía quieta nueve segundos más
allá: se leía como que la tecla no hacía nada.

**Se implementan como reclamos** (`claimKeys`), no como comandos del registro global:
solo así pueden llegar al estado de la sección (la onda decodificada, el elemento de
audio de la audición) sin sacarlo del componente.

**Teclas sueltas a propósito.** Con la sección cerrada quedan libres para cualquier otra
cosa, y el guardián de tecleo las calla con un campo de texto enfocado — escribir "plaza"
en un título no puede mover cortes.

### 2. Las flechas siguen siendo seek

`←`/`→` conservan su significado global (adelantar y retroceder la reproducción) en toda
la app, incluido el editor de silencios abierto. Con teclas dedicadas por lado, el recorte
no las necesita.

El tirador enfocado **conserva** sus flechas: un `role="slider"` que las ignora está roto
para accesibilidad. No compite con lo anterior porque son teclas distintas.

### 3. Navegar entre secciones

`mod+]` salta a la cabecera de la siguiente sección visible, `mod+[` a la anterior
(`mod` = ⌘ en macOS, Ctrl en Windows y Linux). Mueven el foco; no abren ni cierran. Desde
la cabecera, Enter pliega o despliega — comportamiento que ya existe.

Solo actúan con el foco dentro del editor; para entrar ya existe `⌘3`. Recorren solo las
secciones visibles, respetan el orden configurado, y en los extremos no dan la vuelta.

**Funcionan mientras se escribe**: llevan `mod`, así que el guardián las deja pasar. Es lo
que permite irse al recorte desde el campo del título sin soltar el teclado.

Se descartaron `mod+↑↓` y `mod+⇧↑↓`: en macOS ⌘↓ y ⌘⇧↓ son atajos de edición de texto
estándar, y estas teclas deben convivir con un campo enfocado. Los corchetes están libres
en las tres plataformas.

### 4. Cómo se listan en Ajustes

Campo `group?: string` en `ShortcutDef`, independiente de `scope`. Una tecla puede estar
acotada sin depender del foco: las del recorte actúan mientras la sección está abierta, así
que no llevan `scope` pero tampoco son globales. Listarlas entre "Convertir" y "Ajustes"
haría creer que funcionan en toda la app.

El tab de Shortcuts agrupa por `group ?? scope`. Todo rebindeable, que es lo que necesita
quien tiene un macropad que emite otras teclas.

### 5. El recorrido completo

1. `⌘1` lista de pistas → `↑`/`↓` o `j`/`k` para elegir.
2. `⌘3` editor.
3. `mod+]` hasta el recorte de silencios, Enter para desplegar.
4. `s` aplica lo detectado; `q`/`w` y `o`/`p` afinan; `a` y `l` comprueban por oído.
5. `mod+]` a las siguientes secciones, Enter en cada una.
6. `⌘↵` convierte.

Sin ratón y sin pasos invisibles.

## Invariante que protege todo esto

Cada comando de la tabla debe caer en una de tres formas de ejecutarse: el registro global
(`runCommand`), un ámbito cuyo componente lo maneja, o una sección abierta que lo reclama.
Un comando que no esté en ninguna resuelve, se traga la tecla con `preventDefault` y no
hace nada — el fallo silencioso que ya mordió dos veces en esta misma área.

El test vive en `commands.test.ts` y recorre `SHORTCUT_DEFAULTS` entera.

## Pruebas

- **Unitarias**: la aritmética de salto entre secciones (siguiente, anterior, saltando
  ocultas, extremos); cada tecla del recorte sobre su lado y nunca sobre el otro; el paso
  grueso con `⇧`; el arranque desde la línea dibujada cuando no hay corte; la invariante.
- **De empaquetado**: que `lib/spaceClaim` quede en un solo chunk. Es el fallo que los
  tests unitarios no pueden ver por construcción.
- **En la app real**: el recorrido completo del punto 5, con el binario construido. Los
  tests unitarios pasaron en verde mientras la funcionalidad estaba rota en producción;
  la verificación en la app es obligatoria, no opcional.

## Fuera de alcance

- Encadenar secciones en modo maximizado.
- Mover el seek a `,`/`.`.
- Auto-abrir la sección al saltar a ella (dispararía análisis caros al pasar de largo).
