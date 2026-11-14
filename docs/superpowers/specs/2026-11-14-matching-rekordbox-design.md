# Matching de rekordbox en Surco

## Por qué

Enrique (usuario real, 13/11) marca en rekordbox con el botón de Matching las parejas de temas que
combinan bien mientras pincha. Luego rekordbox no le deja verlas todas juntas: solo tema a tema, desde
Related Tracks con el criterio «Matching». Con una biblioteca grande se olvida de qué marcó. Quiere
verlas en una lista y hacerse una playlist tipo «Mixable Tracks».

Vicent (14/11) amplía: verlas también por pista, que la sesión automática las tenga en cuenta y poder
crear y quitar parejas desde Surco.

## Cómo lo guarda rekordbox (medido el 14/11 en rekordbox 7, su master.db)

- Tabla `djmdRecommendLike`: `ID` (UUID en texto), `ContentID1`, `ContentID2`, `LikeRate`,
  `DataCreatedH`, `DataCreatedL`, `UUID`, columnas de auditoría (`rb_local_usn`, `created_at`,
  `updated_at`, `rb_local_deleted`…).
- Una fila por pareja. `ContentID1` es el tema del deck 1 y `ContentID2` el del deck 2. No hay fila
  inversa: para las parejas de un tema hay que mirarlo en las dos columnas.
- `LikeRate` NULL. `DataCreatedH`/`DataCreatedL` son el epoch en milisegundos partido en 32+32 bits.
- `rb_local_usn` = el `localUpdateCount` de `agentRegistry` en ese momento (580816 en los dos).
- Quitar una pareja (volver a pulsar el botón) BORRA la fila. No marca `rb_local_deleted`.
- El botón está en modo Export y exige temas en el deck 1 y el deck 2.

## Qué hace

1. **«Matching» en la fuente rekordbox.** Entrada fija bajo «Todas las pistas», con el icono de dos
   anillos y su contador de pistas. Muestra los temas con alguna pareja, agrupados en **cadenas**
   (componentes conexos: si A va con B y B con C, salen juntos y en ese orden). «Crear playlist»
   crea una playlist de rekordbox con esos temas por el camino de escritura que ya existe.
2. **Sección «Matching» en la ficha.** Con un tema de rekordbox elegido, sus parejas con botón de
   escuchar. Las filas de la lista que son pareja del tema elegido llevan los anillos en azul.
3. **Sesión automática, variante A.** Las parejas entran como combos fuertes y en los dos sentidos.
   La lista de la sesión no cambia de aspecto (decisión del 10/11: la sesión se ve como una playlist).
4. **Crear y quitar desde Surco.** «Hacer matching» en el menú contextual con exactamente dos temas
   de rekordbox seleccionados. «Quitar» al pasar el ratón por una pareja de la ficha, sin confirmar.
   Crear = insertar la fila como lo hace rekordbox (orden de la selección = deck 1, deck 2). Quitar =
   borrar la fila. Con rekordbox abierto se usa el aviso de «Cerrar rekordbox y aplicar / Aplicar al
   cerrarlo» que ya tienen todas las acciones que escriben (spec del 12/11).

## Objetivos, no objetivos, antiobjetivos

- Objetivo: ver todas las parejas de golpe y por pista, y que la sesión las aproveche.
- No objetivo: Matching propio para Traktor, Engine DJ, Serato o VirtualDJ (no tienen esa tabla).
- No objetivo: la variante B de la sesión (anillos entre filas).
- Antiobjetivo: escribir en master.db sin copia de seguridad o sin pasar por la guarda de rekordbox
  abierto. Antiobjetivo: duplicar una pareja que ya existe en cualquier orden.

## Enfoques considerados

- **Leer en cada consulta desde master.db (elegido).** La tabla es pequeña (una fila por pareja) y ya
  abrimos master.db para playlists y cues. Sin caché nueva.
- Copiar las parejas a un almacén propio de Surco. Descartado: se desincroniza en cuanto el DJ marca
  algo en rekordbox.
- Matching propio de Surco para todos los programas. Descartado por ahora (no objetivo).

## Decisiones tomadas por mí (corregibles)

- Nombre visible «Matching», el de rekordbox: «Emparejar» ya es el botón de Discogs.
- Cadenas en la vista 1 (no parejas sueltas). Orden de la cadena: recorrido desde el tema con menos
  parejas; empate por título.
- Peso de las parejas en la sesión: el mismo que un combo visto en 2+ playlists de mezcla.
- Sin aviso propio con rekordbox abierto: se reutiliza el aviso general del 12/11.

## Lo que queda por comprobar

- Que rekordbox muestre en Related Tracks un Matching creado por Surco. Se prueba una vez con la
  rekordbox de Vicent antes de dar la escritura por buena.
