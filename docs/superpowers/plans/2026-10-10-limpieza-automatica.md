# Limpieza automática Implementation Plan

**Goal:** Al terminar una carga (soltar o elegir ficheros), Surco deja como cambio pendiente en cada pista lo que no tiene duda, igual que el auto-match deja sus resultados. Nada se escribe en el momento; llega al fichero, a Music y a las bibliotecas DJ con la conversión o el Actualizar de siempre. Lo dudoso sigue en «Revisar metadatos de la lista».

**Boceto:** `scratchpad/auto-limpieza.html` (aprobado). No hay spec aparte.

## Decisiones

- **Dos ajustes, apagados por defecto**, en Ajustes › Búsqueda › sección de emparejado, debajo del auto-match: `autoCleanSpacing` («Limpiar al cargar») y `autoCleanCase` («Unificar mayúsculas y acentos con tu biblioteca»). Sincronizados (son preferencias, no dependen de la máquina como el token del auto-match).
- **Espacios e invisibles**: el mismo `clean()` de `lib/musicSpelling.ts` (INVISIBLE, `\s+` → un espacio, trim) sobre el valor entero de título, artista, artista del álbum, álbum y género. Nada de apóstrofes ni otra puntuación: la clave de puntuación de la revisión no se usa para escribir.
- **Mayúsculas y acentos**: solo grupos `case` de `spellingGroups`. Con «Limpiar al cargar» encendido se agrupa sobre los valores ya limpios; apagado, sobre los crudos (y un grupo con una variante sucia es `invisible`, no `case`, así que no se toca).
- **Mayoría clara**: la variante ganadora la llevan al menos 3 pistas y al menos el doble que cualquier otra variante. Empate o mayoría corta, nada. Ejemplos fijados en tests: 11/1 sí, 4/2 sí, 2/1 no, 4/3 no, 3/3 no.
- **Mayoría sobre toda la lista cargada; se aplica solo a las pistas de esta carga** (las rutas que `useListReviewNotice` ya junta). Una pista de una carga anterior no se vuelve a tocar.
- **Ignorados**: un grupo de `listReviewIgnored` (tipo `invisible` o `case`) bloquea la limpieza de esas celdas (campo × pista); un grupo `case` ignorado no se unifica.
- **Exclusión**: la misma de `listReviewEntries` (sin leer, lectura fallida, procesando). Fuente: `reviewRaw` cuando sigue valiendo, si no la lectura del disco.
- **Nunca pisa una edición**: un campo solo se limpia si su valor vivo es exactamente el de la lectura del disco (`diskSignature`). Se vuelve a comprobar en el `setTracks` funcional, y se salta la pista cuyo campo tiene el foco (`editingRef`, como el auto-match).
- **Registro por campo** en `TrackItem.cleaned[field] = { raw, before, to, undone? }`. La marca de la fila, el contador y la pista en el editor leen el registro activo: no deshecho y con el valor vivo igual a `to`. Una exportación correcta borra `cleaned` (el cambio ya está en el fichero).
- **Deshacer** devuelve el campo a `before` y marca `undone`; un campo deshecho nunca se vuelve a limpiar. Con «Limpiar al cargar», `before` es la grafía del fichero (`reviewRaw`) y esa grafía pasa también a la instantánea del disco (`diskSignature`): la lectura ya recorta, así que sin eso un espacio al principio no contaba como cambio pendiente. Deshacer deja la fila igual que el disco, sin nada pendiente. Solo la limpieza toca la instantánea; con el ajuste apagado nada cambia.
- **Contador** en la barra superior, junto al del auto-match: «✧ N limpiadas», pistas con alguna limpieza activa. No es pulsable: el del auto-match se pulsa para cancelar una pasada en curso y aquí no hay pasada que cancelar.
- **Marca en la fila**: un destello hueco en verde (`track-cleaned`) junto al del auto-match, con tooltip. Las filas sin convertir no tienen anillo de cambios pendientes en la app (el anillo ámbar solo existe para pistas ya convertidas), así que la marca propia es la señal.
- **Auto-match**: una limpieza cambia `meta`, y el auto-match descarta un resultado si `meta` cambió durante la búsqueda. Las pistas limpiadas se vuelven a encolar en el auto-match cuando está activo.
- **Nunca solo**: erratas y duplicados.

## Tareas

1. `lib/autoClean.ts` puro: `planAutoClean`, `applyAutoClean`, `activeCleanups`, `undoCleanup`, `cleanReasons`. TDD con mutación en guarda de edición, mayoría clara, exclusión de no leídas y deshacer.
2. Ajustes: tipos, defaults de main, borrador, controles en SearchTab, i18n.
3. Disparo: `useListReviewNotice` avisa del asentamiento con las rutas de la carga; App planifica, aplica y reencola.
4. Contador en Toolbar y marca en TrackList.
5. Pista en el editor con Deshacer (prop `note` en Field).
6. `exportedPatch` limpia `cleaned`.
7. Capturas en la app construida (`shot/png/limpieza-*.png`).

## Verificación

`npm test` desde `apps/desktop`, `npx tsc --build`, `npx biome check src`.
