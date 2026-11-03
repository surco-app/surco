# Spike: rekordbox acepta una rejilla escrita desde fuera (03/11/2026)

Hecho sobre su colección real (rekordbox 7), con rekordbox cerrado, respaldo en
`~/rekordbox-respaldo-spike-rejilla/` con sha256 y restauración verificada ("all equal").
Script desechable guardado en el scratchpad de la sesión (`spike-grid/zzSpikeGrid.test.ts`).

## Casos

1. **What's Up (DJ Tonin), WAV, 149,92 BPM.** PQTZ del `.DAT` reescrito con todos los golpes
   +40 ms, mismo número de golpes (864). PQT2 del `.EXT` sin tocar. master.db sin tocar.
2. **Subidón (Extended Version), WAV, 137,77 → 137,76 BPM.** PQTZ regenerado desde el primer
   golpe con el BPM nuevo (698 golpes, el último pasa de 303837 a 303866 ms). En PQT2 se
   actualizaron el tempo del primer golpe y el último golpe entero (número, tempo, ms); cuerpo
   y recuento sin tocar. `djmdContent.BPM` = 13776.

## Resultado (visto por el usuario)

- What's Up: la rejilla sale corrida los 40 ms.
- Subidón: la columna marca 137,76 y la rejilla cuadra al final del tema (antes se abría ~20 ms).
- Ninguna de las dos se reanaliza ni da aviso.
- Al cerrar rekordbox, los ocho ficheros ANLZ (`.DAT/.EXT/.2EX/.3EX` de las dos) siguen
  idénticos a lo escrito: rekordbox no los reescribe. master.db sí cambia (lo hace siempre al
  abrir).

## Formato de PQT2 (`.EXT`), observado en 2 pistas

Cabecera de 56 bytes, big-endian:

| Offset | Tamaño | Contenido |
|---|---|---|
| 0 | 4 | `PQT2` |
| 4 | 4 | longitud de cabecera = 0x38 |
| 8 | 4 | longitud de la sección |
| 12 | 4 | 0 |
| 16 | 4 | 0x01000002 |
| 20 | 4 | 0 |
| 24 | 8 | primer golpe: número u16, tempo×100 u16, ms u32 (igual que en PQTZ) |
| 32 | 8 | último golpe, mismo formato |
| 40 | 4 | número de golpes (= PQTZ) |
| 44 | 4 | desconocido (distinto en cada pista; no parece afectar a rekordbox) |
| 48 | 8 | 0 |

Cuerpo: un u16 por golpe, valores < 1024, sin relación evidente con los ms. Significado
desconocido. rekordbox no lo valida: ni cuerpo viejo con PQTZ nuevo (caso 1) ni cabecera
nueva con cuerpo viejo (caso 2) le molestan.

## Consecuencias para el plan

- La escritura en rekordbox es viable: PQTZ + `djmdContent.BPM`, escritura atómica.
- PQT2: no se sabe codificar el cuerpo. Se actualiza solo la cabecera (primer y último golpe);
  cuerpo y recuento se dejan como están (lo que se probó en el caso 2).
- Sin probar: si un CDJ-3000 o la exportación a USB usan el cuerpo de PQT2. Queda para la
  parte 2, con un USB exportado.
