# Navegación por teclado entre las secciones del editor

Fecha: 2026-07-31
Estado: aprobado, pendiente de plan de implementación

## Origen

Reporte del usuario (31/07/2026), con captura: el foco está en la quinta estrella de
Rating y, para llegar al recorte de silencios, hay que tabular por título, artista,
álbum, artista del álbum, año, género, agrupación y todo lo que venga después.

> ¿Podemos hacer también que se navegue entre secciones? Si quiero bajar a trim, tengo
> que pasar por todos los fields antes. También necesito poder hacer el toggle de la
> sección si está cerrada, desde el teclado.

Contexto que lo motiva: djotas dijo "no me agrada" sobre los atajos del editor de
silencios (v0.77). La hipótesis de trabajo es que su queja real no son las teclas del
trim sino **llegar hasta ellas**: aunque las teclas funcionen, el recorrido por teclado
es impracticable. Esta feature ataca eso. **Sin confirmar con él todavía** — ver
"Preguntas abiertas".

## Estado actual (verificado en código)

- 8 secciones (`apps/desktop/src/shared/editorSections.ts`): `form`, `otherTags`,
  `properties`, `quality`, `output`, `trim`, `declick`, `normalize`.
- El **orden es configurable** por el usuario (Settings → Editor), igual que el estado
  de plegado inicial. Algunas secciones se pueden **ocultar** (`hidden`), salvo `form`.
- Algunas **no se renderizan** cuando no aplican (p. ej. `otherTags` sin tags de
  terceros).
- `SectionHeader.tsx` ya es un `<button>` con `aria-expanded` y `onToggle`: **plegar y
  desplegar con teclado ya funciona** una vez la cabecera tiene el foco.
- Existe un modo maximizado (una sección a pantalla completa).
- `⌘1/2/3` ya saltan entre las tres columnas (lista, Discogs, editor).

El hueco es solo uno: **llegar a la cabecera**. Hoy solo se consigue tabulando por todo
lo que haya antes.

## Decisiones tomadas

- **Saltar solo enfoca; abrir es explícito.** Se descartó abrir la sección al saltar:
  `trim` decodifica la onda entera, `declick` hace su pasada de clics y `normalize` mide
  loudness — el propio código documenta que están plegadas por defecto justo por eso.
  Pasar de largo por tres secciones dispararía tres análisis caros.
- **Solo actúa dentro del editor.** Fuera no hace nada; para entrar ya existe `⌘3`. Se
  descartó una tecla contextual que saltara secciones dentro y columnas fuera: una misma
  tecla con dos significados según el contexto es exactamente lo que hizo que el usuario
  dijera "no funciona" con el ámbito del trim.
- **`mod+[` / `mod+]`.** Se descartaron `mod+↑↓` y `mod+shift+↑↓`: en macOS ⌘↓ y ⌘⇧↓ son
  atajos de edición de texto estándar (ir al final, seleccionar hasta el final), y estas
  teclas deben funcionar **con un campo enfocado**. Los corchetes no los usa el sistema
  en macOS, Windows ni Linux, y son dos teclas — cómodo en un macropad.
- **Solo secciones visibles**, respetando el orden del usuario. En modo maximizado se
  comporta igual (salta y sale del maximizado); no encadena secciones maximizadas.

## Diseño

### Comportamiento

Dos comandos: `mod+]` (siguiente sección) y `mod+[` (anterior). Mueven el foco a la
**cabecera** de la sección. No abren, no cierran, no tocan el estado de plegado.

Desde la cabecera enfocada, Enter pliega o despliega — comportamiento que ya existe.

Recorren solo las secciones visibles: se saltan las ocultas en Settings y las que no se
renderizan. En los extremos **no dan la vuelta**: en la última, `mod+]` se queda ahí. Dar
la vuelta despista cuando no se ve el final de la lista.

Recorrido resultante desde cualquier punto de la app: `⌘3`, uno o dos `mod+]`, Enter.

### Arquitectura

Los dos comandos van a `SHORTCUT_DEFAULTS` con `scope: 'editor'`, y el atributo
`data-shortcut-scope="editor"` va en el **contenedor** del editor.

Esto es deliberadamente distinto del trim, donde el ámbito vive en cada handle: allí las
teclas solo tienen sentido sobre un corte concreto; aquí tienen sentido en cualquier
punto del editor, incluido dentro de un campo de texto. La regla sigue siendo la misma
—el ámbito va donde se manejan las teclas— y aquí quien las maneja es el editor entero.

**Deben funcionar mientras se escribe.** Llevan `mod`, así que el guardián de tecleo las
deja pasar; basta con NO marcarlas `suppressWhileTyping`. Es la garantía que hace útil la
feature: irse al trim desde el campo del título sin soltar el teclado.

Salen en el tab de Shortcuts bajo su propio grupo (el agrupado por ámbito ya es
genérico), rebindeables como el resto.

### Componentes

- **`useSectionNavigation`** (hook nuevo): dada la lista de secciones visibles y cuál
  está enfocada, calcula el destino y mueve el foco. Una responsabilidad.
- **La aritmética como función pura**: siguiente/anterior, saltando ocultas, con orden
  personalizado y con los extremos. Testeable sin montar componentes.
- **`SectionHeader`**: expone un atributo que identifique su sección, para que el hook
  localice la cabecera destino. Se prefiere a un registro de refs (como el `rowRegistry`
  de `TrackList`) por no añadir ciclo de vida que mantener.

### Pruebas

TDD, centradas en lo que puede fallar de verdad:

- La aritmética pura: siguiente, anterior, saltando ocultas, con orden personalizado y en
  ambos extremos (sin dar la vuelta).
- El salto mueve el foco a la cabecera y **no** cambia el estado de plegado.
- Funciona con un campo de texto enfocado — la garantía central.
- Fuera del editor no hace nada.
- Enter sobre la cabecera enfocada sigue plegando (no romper lo existente).

## Fuera de alcance

- **Encadenar secciones en modo maximizado** (saltar de trim a declick sin salir de
  pantalla completa). Atractivo y encaja con un flujo que el código ya menciona, pero
  añade un segundo comportamiento según el modo. Si se pide, se diseña aparte.
- **Hacer globales las teclas del trim** y el rediseño de defaults (`←/→` para el trim,
  seek a `,`/`.`). Decisiones de producto separadas, pendientes de confirmar con djotas.

## Preguntas abiertas

1. ¿El "no me agrada" de djotas era esto — llegar al trim — o las teclas del trim en sí?
   Su respuesta puede reordenar prioridades.
2. ¿Qué versión tenía cuando lo probó? La v0.77.0 llevaba el bug del corte descartado en
   el borde: con él, las teclas del trim no hacían nada al recortar el silencio inicial,
   que es el caso principal. Si juzgó sobre esa versión, su impresión se formó con la
   feature rota.
