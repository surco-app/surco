# Condición por repetición en las reglas de cues

Boceto aprobado por Vicent el 19/11/2026: https://claude.ai/artifact/KA35udGrvYHRVRyyCMCUC9

## Objetivo

Una regla de flujo con «un color por repetición» deja que cada repetición lleve su propia condición, además de la condición de la regla. Caso real: Subidón pone 16 y 32 «hasta la marca anterior» y el de 48 (rojo) «solo en una bajada».

Hoy eso obliga a partir la regla en dos. Con esto vuelve a ser una regla de 3 repeticiones.

## Entorno

- Worktree `/Users/vicent/code/surco/.claude/worktrees/cues-secciones`, rama `cues-secciones`. No tocar el checkout principal.
- El worktree no tiene `node_modules`. Lanzar siempre desde `apps/desktop` del worktree con los binarios del repo principal:
  - tests: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <ruta>`
  - lint: `/Users/vicent/code/surco/node_modules/.bin/biome check src`
  - tipos: `/Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.web.json --noEmit`, y lo mismo con `tsconfig.node.json` y `tsconfig.scenarios.json`
- `console.log` no sale en vitest.
- TDD estricto: test rojo visto fallar, luego el código. Los nombres de test dicen por qué importa el comportamiento.
- Selectores de test por `data-testid`. Nunca por clase CSS.
- Cero comentarios nuevos en el código.
- Un commit por tarea, solo título, en inglés, sin prefijos `feat:` ni cuerpo. Nunca `--no-verify`.
- No cambiar aserciones existentes. Si un test existente falla, parar y avisar con el nombre del test.
- Sin guion largo ni dos puntos explicativos en textos de UI. Tuteo en todos los idiomas.

## Modelo

`apps/desktop/src/shared/cueFlows.ts`

```ts
export type RepeatCondition = 'rule' | 'fits' | 'up' | 'down' | 'chorus'
export const REPEAT_CONDITIONS: RepeatCondition[] = ['rule', 'fits', 'down', 'up', 'chorus']

export interface CueRule {
  // ...lo que ya hay
  whenEach?: RepeatCondition[]
}
```

- `whenEach[k - 1]` es la condición de la repetición `k`. Ausente o `'rule'` significa «como la regla».
- Solo tiene sentido con `bars > 0` y `color` en modo `each`. En otro caso `ruleOf` lo descarta.
- `ruleOf` normaliza: recorta a `MAX_RULE_REPEAT` (y a `repeat` si es número), quita los `'rule'` del final y omite el campo si queda vacío.
- Compatibilidad hacia delante, igual que el resto de palabras: si `whenEach` es un array de cadenas y alguna no está en `REPEAT_CONDITIONS`, la regla es `foreign` (se guarda aparte intacta, ver `isForeign`). Si `whenEach` no es un array de cadenas, se ignora el campo.

## Motor

`apps/desktop/src/shared/cueRules.ts`, función `walkFlow`.

Para cada repetición `k` de una regla con `bars > 0`:

1. La comprobación de la regla (`misfit`, límites, `allowed`) va primero y no cambia. Si la regla corta el recorrido, se corta como hoy.
2. Si pasa y `whenEach[k - 1]` es propia:
   - `'fits'`: la posición no puede estar dentro de una parte fuerte, salvo que sea el arranque de una racha fuerte (`startsStrongRun`). Con un drop marcado a mano (`hand`) no se comprueba, igual que hace la regla. Motivo de rechazo `'strong'`.
   - `'up' | 'down' | 'chorus'`: la frase en vigor en esa posición (la última de `track.phrases` con `p.ms <= ms + SAME_POSITION_MS`) tiene que ser de ese tipo. Se aplica también a drops marcados a mano. Sin frases, no sale. Motivo de rechazo nuevo `'section'`.
   - Si no cumple, esa repetición va a `rejected` y **el recorrido sigue** con la siguiente repetición.
3. `RejectReason` gana `'section'`.

Una regla sin `whenEach` se comporta exactamente como hoy. `cueRulesParity.test.ts` tiene que seguir pasando sin tocarlo.

Caso de prueba obligado, en compases (rejilla sintética de 4 golpes por compás, 250 compases):
- drops en los compases 33, 109 y 181
- fuerte tal como lo trocea rekordbox: 9 a 25, 33 a 41, 41 a 49, 49 a 65, 109 a 125, 125 a 137, 137 a 141, 141 a 157, 157 a 165, 181 a 197, 197 a 213, 213 a 221 (con los tramos unidos, `previous` corta antes y el 149 no sale)
- frases: 1 intro, 9 chorus, 25 up, 33 chorus, 65 up, 89 down, 97 up, 109 chorus, 165 down, 173 up, 181 chorus, 221 up, 229 down, 245 outro
- regla: desde drop, atrás, 16 compases, 3 veces, `previous`, `whenEach: ['rule', 'rule', 'down']`
- sale en los compases 1, 17, 77, 93, 149 y 165; quedan rechazados 61 y 133 con motivo `'section'`
- con `whenEach: ['rule', 'rule', 'fits']` el resultado es el mismo con motivo `'strong'`
- sin `whenEach` salen además 61 y 133

## Ajustes

`apps/desktop/src/renderer/src/components/CueRuleRow.tsx`

- El desplegable de cada cuadro de repetición (`${id}-color-${slot}-palette`) añade, bajo la paleta y solo cuando `bars > 0` y el color va por repetición, una lista de `role="menuitemradio"` con las cinco condiciones, en el orden de `REPEAT_CONDITIONS`. Testids `${id}-color-${slot}-when-${value}`. Mismo estilo que `ITEM_CLASS`.
- Elegir una condición llama a `onChange` con `whenEach` actualizado (relleno con `'rule'` hasta el hueco, sin `'rule'` al final, campo omitido si queda vacío) y cierra el desplegable devolviendo el foco al cuadro, como hace el color.
- Un cuadro con condición propia se pinta en contorno: fondo transparente, borde de 1,5 px del color del cue, texto `text-fg`. Lleva `data-own="true"`. Nada de etiqueta nueva.
- La línea de ayuda `${id}-when-line` añade, tras la ayuda de la regla, una frase por cada repetición con condición propia, en el orden en que se ven los cuadros. Ejemplo: «Cruza los estribillos sin marca y se para en la marca anterior. El de 48, solo en una bajada.»
- Al bajar `repeat`, pasar a `bars = 0` o cambiar a «un color», `whenEach` se recorta o se quita.

`CueFlowPreview.tsx` ya lee `settings.cueFlows.leftOut.reason.${c.reason}`; solo necesita la clave nueva.

### Textos (8 idiomas: es, en, de, fr, it, ca, pt-BR, ja)

Claves bajo `settings.cueFlows`:

| clave | es |
|---|---|
| `whenEach.rule` | como la regla |
| `whenEach.fits` | si cabe |
| `whenEach.down` | solo en una bajada |
| `whenEach.up` | solo en una subida |
| `whenEach.chorus` | solo en un estribillo |
| `whenEachHint.fits` | El de {{bars}}, solo si cabe. |
| `whenEachHint.down` | El de {{bars}}, solo en una bajada. |
| `whenEachHint.up` | El de {{bars}}, solo en una subida. |
| `whenEachHint.chorus` | El de {{bars}}, solo en un estribillo. |
| `leftOut.reason.section` | Fuera de esa sección |

En cada idioma, usar para bajada, subida y estribillo las mismas palabras que ya usa `settings.cueFlows.from.down`, `from.up` y `from.chorus` de ese fichero, y para «si cabe» la de `settings.cueFlows.when.fits`.

## Tareas

1. **Modelo y motor** (`cueFlows.ts`, `cueRules.ts` y sus tests). Commit: `Let each repetition of a cue rule carry its own condition`.
2. **Ajustes y textos** (`CueRuleRow.tsx`, su test, los 8 locales). Commit: `Pick the condition of each repetition from its colour square in the cue rules`.

Cada tarea termina con lint de `src` entero, los tres `tsc` y los tests de `src/shared` y de `src/renderer/src/components/CueRuleRow.test.tsx`, `CueFlowPreview` y `src/renderer/src/i18n` en verde, mirando también `Errors` y `Unhandled` en la salida.
