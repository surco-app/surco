# Matching en todos los programas

## Por qué

rekordbox es el único programa con Matching. Un DJ de Traktor, Engine DJ, Serato o VirtualDJ que
prepara en Surco no tiene dónde apuntar qué temas combinan. Vicent (14/11) quiere que Surco lo
ofrezca a todos: las parejas viven en Surco y lo que llega a cada programa son las playlists y las
sesiones construidas con ellas. Los otros programas no tienen dónde guardar una pareja, así que en
cabina no la ven.

## Enfoque elegido (A)

Surco guarda sus propias parejas por ruta de fichero y las cruza con las de rekordbox.

- Descartado (B): rekordbox manda y Surco solo guarda las de los demás. Una misma pareja acabaría en
  dos sitios que no se hablan.

## Qué hace

- **Almacén**: `matching-pairs.json` en userData, solo de este Mac. Cada pareja son dos rutas
  (NFC), sin orden.
- **Lista que ve el DJ**: la suma de las parejas de Surco y las de rekordbox, cruzando cada ID de
  rekordbox con su ruta.
- **Escribir**: hacer matching, Añadir y las sugeridas guardan siempre en Surco y, si los dos temas
  están en la colección de rekordbox, también allí (con el aviso de rekordbox abierto). Quitar borra
  de los dos.
- **Seguir al fichero**: si una conversión deja el original sin existir (sustituido o movido), la
  pareja pasa a la ruta nueva. Si el original sigue, la pareja se queda en él.
- **En cada programa**: entrada fija «Matching» por cadenas, sección de la ficha, anillos, menú y
  Añadir, como en rekordbox.
- **Sesión**: usa las parejas venga la playlist de donde venga.
- **Sugeridas**: también desde las playlists de mezclas de cada programa. El historial sigue siendo
  solo de rekordbox.

## Fases (cada una mergeable)

1. Almacén, seguir conversiones y escribir en los dos sitios. rekordbox no cambia a la vista.
2. Los demás programas: entrada, ficha, anillos, menú, Añadir.
3. Sesión con las parejas de cualquier programa.
4. Sugeridas desde las playlists de mezclas de todos los programas.

## Fuera

Compartir las parejas entre Macs.
