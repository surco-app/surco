# Sección de rapidez en la home

Aprobado por Vicent el 18/11/2026 sobre el boceto https://claude.ai/artifact/WFjmsEh8ToS885mXHoXpiV (versión 3).

## Intención

Tras la tanda de rendimiento de noviembre (v1.37.1 a v1.38.2) Surco va fluido con bibliotecas de decenas de miles de pistas. Vicent quiere una sección en la home para que quien llega vea lo rápido que es.

## Objetivos

- Una sección nueva en la home de `apps/web`, entre Matching y Biblioteca (`LibraryReview`).
- Titular «Rápido, muy rápido.», una frase y tres cifras grandes que cuentan desde cero.
- Solo cifras medidas.

## Fuera

- Barras, carrera o cronómetro (se quitaron de `/funciones` el 02/11 y no vuelven).
- Lista interactiva de 30.000 pistas (variante A del boceto, descartada).
- Cambios en `/funciones` o en otras páginas.
- La cifra 30.000 en cualquier texto. No hay medidas a ese tamaño.

## Contenido

Titular (es): `Rápido, muy rápido.`
Frase (es): `Surco responde al momento, por grande que sea tu biblioteca.`

| Cifra | Unidad | Pie (es) | Procedencia |
|---|---|---|---|
| 44 | ms | Lo que tarda en responder la pestaña de rekordbox con 14.835 pistas | responsiveness de v1.37.1 contra v1.37.0 (1841 ms antes); mide el clic sobre la pestaña hasta que la app lo atiende, no la lista pintada |
| 25.000 | | Pistas de Traktor seleccionadas de golpe, sin esperar | fixture surco-gate-traktor-25000, 17/11, sin bloqueos del main |
| 5,3 | s | Borrar los cues de 13.280 pistas en Engine DJ | fixture surco-gate-engine-13280, 17/11 |

Textos en los 8 idiomas de la web (es, en, de, fr, pt-BR, ja, ca, it), de tú, sin guion largo ni dos puntos de explicación. El separador decimal y el de miles siguen al idioma.

## Animación

- Las tres cifras cuentan de 0 a su valor una sola vez, cuando esa cifra entra en pantalla (IntersectionObserver, umbral 0,3, el del hook existente), durante 1,2 s con salida suave (`1 - (1 - t)^4`).
- Función pura `render(t)` como el resto de animaciones de la web, movida por `requestAnimationFrame`. Sin librerías.
- Cada cifra cuenta cuando ella entra en pantalla, no la sección entera. Las que aún están por debajo esperan en cero y las que ya se ven al montar conservan su valor.
- Cada cifra reserva su ancho con una copia invisible de la cifra final, en cifras tabulares, en lugar de `ch`, así nada se desplaza mientras cuenta y queda centrada.
- Con `prefers-reduced-motion` y en el HTML prerenderizado se pinta el valor final.

## Enfoques

1. **Cifras quietas que cuentan (elegido).** Poco texto, sin ventana de app, encaja con la home calmada. Vicent eligió «algo como la B» y pidió números animados.
2. **Lista interactiva de 30.000 pistas con tres tarjetas.** Deja probar la sensación, pero es una réplica web que no mide la app y añade mucho código a la home. Descartada por Vicent.
3. **Antes y ahora con barras.** Enseña lo lento que era y repite el cronómetro retirado. Descartada sin dibujar.

## Decisiones del constructor

- Nombre del componente y del fichero de cifras, siguiendo lo que haya en `apps/web/src/components` y `apps/web/src/lib`.
- Ancla y evento de analítica de la sección, siguiendo `SCENE_ANCHORS` y `SECTION_VIEWS`.
- Todo color por token; `palette.test.ts` y `flat.test.ts` deben seguir en verde.

## Tests

- La función de conteo da 0 en `t = 0` y la cifra exacta en `t = 1`, con el formato del idioma.
- Con movimiento reducido no cuenta.
- Las claves nuevas existen en los 8 idiomas (`keys.test.ts` ya lo exige).
- La sección está en la home entre Matching y Biblioteca.

## Cierre

Worktree `home-rapidez`, merge a main local al acabar, sin push.
