# Revisar metadatos en Apple Music

## Problema

Una biblioteca de Music crecida durante años acumula grafías distintas de lo
mismo (`DJ Lara` ×11 / `Dj Lara` ×1, `Head Horny's` / `Head Horny´s`,
`Álex Cevera`), caracteres invisibles pegados desde webs (`Aar​ó​n Alfonso`) y
duplicados (`This Rap` / `This Rap (Original Mix)`). Music no avisa de nada de
esto y corregirlo a mano pista a pista no lo hace nadie.

## Qué se entrega (primera entrega)

Una vista de revisión, fuera del flujo de trabajo de Surco, que lee la
biblioteca de Music, agrupa lo que está mal y lo arregla en el fichero y en
Music a la vez, con copia de seguridad y deshacer.

Dos clases de hallazgo:

- **Grafías**, sobre artista (por actos), album artist (por actos), álbum
  (dentro del mismo album artist), género (valor entero) y título (solo
  invisibles). Cuatro tipos: `invisible`, `case` (mayúsculas, acentos, NFC),
  `punctuation` (espacios y signos) y `typo` (una o dos letras). Los tres
  primeros son seguros; `typo` siempre se revisa.
- **Duplicados**: misma grabación (artistas como conjunto, título sin
  `(Original Mix)` ni `feat.`) y duración a 5 s o menos (medido: la misma grabación con y sin `(Original Mix)` difiere 4 s por el silencio del rip). Con más diferencia es
  "otra versión", se muestra aparte y su botón no se destaca.

Queda fuera de esta entrega: campos vacíos, búsqueda en proveedores desde la
revisión, carátulas y géneros con varios valores.

## Medido sobre la biblioteca real (06/10/2026, 2044 pistas)

- 2 valores con caracteres invisibles.
- Grupos de mayúsculas o acentos: 22 de actos, 16 de album artist, 5 de
  álbum, 3 de género. Uno es solo NFC contra NFD (`Christian Millán`).
- 30 pares a 1-2 letras; unos 12 son erratas reales y el resto artistas
  distintos (`Cascada` / `Cascade`). Por eso `typo` nunca es seguro.
- Duplicados: la regla actual encuentra 5 grupos y marca como duplicado una
  edición distinta (`Make My Body Move [ADC075]`, 6:57 frente a 5:07). La
  nueva encuentra 8 y la separa.

## Decisiones

- **Fuente única**: la biblioteca local de Music, leída en bloque por
  AppleScript. Nada de catálogos online.
- **Acceso**: dos entradas en el menú Archivo y en ⌘K, "Revisar metadatos en
  Apple Music…" y "Mostrar duplicados en Apple Music…", que abren la misma vista
  con su filtro. Ningún botón en la lista ni en el editor. Solo macOS.
- **Vista**: ocupa la columna de la lista mientras está abierta; cerrar
  devuelve la lista tal como estaba. Grupos que se resuelven a tu ritmo, una
  bandeja que acumula los cambios y una hoja de confirmación antes de escribir.
- **Grafía por defecto**: la mayoritaria. En empate no se marca ninguna.
- **Ignorar es para siempre** y se guarda por máquina.
- **Escritura mínima**: un campo, por TagLib sobre una copia, con
  `assertDecodable`, copia de seguridad y renombrado. No pasa por el pipeline de
  conversión: así no hay normalización, recorte, auto-match ni reetiquetado
  completo que se cuelen. El fichero solo se toca si su valor es exactamente el
  que tiene Music; si no (un WAV con otro valor o vacío), se corrige solo Music
  y se dice.
- **Music** se escribe campo a campo y solo si la entrada sigue diciendo lo
  que la revisión leyó (misma guarda que el borrado de copias).
- **Duplicados**: quitar una copia la borra de Music y manda su fichero a la
  Papelera, o a Copias de seguridad en un volumen sin Papelera (un NAS), como ya
  hace el flujo de copia antigua, salvo que la copia que se
  queda apunte al mismo fichero real. Antes, la copia que se queda entra en
  las playlists normales donde solo estaba la quitada (al final de la lista).
- **Bibliotecas DJ, como un Actualizar**: lo que tomó el fichero o Music se
  lleva a rekordbox, Engine DJ y Traktor si su sincronización está activa, con la
  app cerrada y copia de su base. En rekordbox artista, álbum y género son
  referencias a otras tablas: la pista se reapunta a la fila bien escrita (o a una
  nueva), nunca se renombra la fila compartida. Engine no guarda album artist ni
  Traktor tampoco. Si la biblioteca ya dice otra cosa, no se toca.
- **Deshacer** restaura las copias de seguridad de la tanda y devuelve los
  valores antiguos a Music y a las bibliotecas DJ. Una biblioteca vuelve atrás solo en los
  campos que Music o el fichero restaurado devolvieron. Las copias de duplicados quitadas no
  se deshacen desde aquí. Sus ficheros están en la Papelera, o en Copias de seguridad en un
  volumen sin Papelera.
- **Verificar**: al terminar se vuelve a leer la biblioteca y se recuentan
  los grupos.
