# Copy de la home: destinos como argumento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescribir el copy de la home para que no asuma público de cabina, corrija dos afirmaciones inexactas y convierta los destinos de nota al pie en argumento.

**Architecture:** Solo cambian cadenas en los dos ficheros de locale, más una nota
nueva en el cierre de `App.tsx`. No se toca el hero visual, ni `Walkthrough.tsx`,
ni la estructura de 6 pasos. El español es canónico; el inglés se traduce.

**Tech Stack:** React 19 + TypeScript, i18next, Vitest, Biome.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-30-home-copy-destinos-design.md`.
- Inventario de funcionalidades: `docs/funcionalidades.md`. **Ninguna afirmación
  nueva puede contradecir su §12.**
- `es.json` y `en.json` deben exponer **exactamente** las mismas claves. Lo valida
  `apps/web/src/i18n/keys.test.ts`.
- Los tests se ejecutan desde `apps/web`, no desde la raíz.
- Comando de test: `npm test` (vitest run) desde `apps/web`.
- Comando de tipos: `npm run typecheck` desde `apps/web`.
- No se borra `hero.ledeShort` (código muerto conocido, fuera de alcance).
- Prohibido añadir comentarios al código.
- Un commit por tarea, título descriptivo, sin prefijos tipo `feat:`.

---

## File Structure

| Fichero | Responsabilidad | Acción |
|---|---|---|
| `apps/web/src/i18n/locales/es.json` | Copy canónico | Modificar |
| `apps/web/src/i18n/locales/en.json` | Traducción | Modificar |
| `apps/web/src/App.tsx` | Estructura de la home | Modificar (una nota en el cierre) |
| `apps/web/src/i18n/keys.test.ts` | Paridad de claves | Sin cambios (ya cubre el riesgo) |

---

### Task 1: Hero y entradilla del walkthrough

**Files:**
- Modify: `apps/web/src/i18n/locales/es.json` (`hero.h1a`, `hero.h1b`, `home.heroLede`, `home.walkthrough.kicker`, `home.walkthrough.lede`)
- Modify: `apps/web/src/i18n/locales/en.json` (mismas claves)
- Test: `apps/web/src/i18n/keys.test.ts` (existente, no se modifica)

**Interfaces:**
- Consumes: nada.
- Produces: nada que otras tareas usen. `App.tsx:33,35,40` ya leen estas claves.

- [ ] **Step 1: Editar el hero en `es.json`**

Sustituir los valores actuales:

```json
"hero": {
  "h1a": "Tu música,",
  "h1b": "como debería estar.",
  "ledeShort": "Convertir, etiquetar, comprobar la calidad y ordenar en Apple Music o Engine DJ: lo que hacías saltando entre cuatro o cinco apps, Surco lo hace en una. De minutos por pista a un par de segundos."
}
```

`ledeShort` se deja **tal cual** — es código muerto, fuera de alcance.

- [ ] **Step 2: Editar `home.heroLede` en `es.json`**

```json
"heroLede": "Surco abre cada archivo y te dice qué tienes de verdad: si el lossless es auténtico, qué etiquetas faltan, dónde hay clics y silencio de sobra. Lo arregla y lo deja listo en tu reproductor o en tu equipo de DJ.",
```

- [ ] **Step 3: Editar la entradilla del walkthrough en `es.json`**

```json
"walkthrough": {
  "kicker": "Paso a paso",
  "title": "Una pista, de principio a fin",
  "lede": "Todo lo que Surco le hace a un archivo desde que lo sueltas hasta que está donde lo escuchas. Seis pasos, una sola ventana."
},
```

- [ ] **Step 4: Aplicar los mismos cambios en `en.json`**

```json
"hero": {
  "h1a": "Your music,",
  "h1b": "the way it should be.",
  "ledeShort": "Convert, tag, check the quality and file into Apple Music or Engine DJ: what used to take four or five apps, Surco does in one. From minutes per track to a couple of seconds."
}
```

```json
"heroLede": "Surco opens every file and tells you what you actually have: whether the lossless is genuine, which tags are missing, where the clicks and the dead air are. Then it fixes all of it and files it into your player or your DJ gear.",
```

```json
"walkthrough": {
  "kicker": "Step by step",
  "title": "One track, start to finish",
  "lede": "Everything Surco does to a file between dropping it in and having it where you listen. Six steps, one window."
},
```

- [ ] **Step 5: Verificar paridad de claves y tipos**

```bash
cd apps/web && npm test -- keys.test.ts
```

Esperado: PASS — `es and en expose the exact same keys`.

- [ ] **Step 6: Comprobar que no queda jerga de cabina por encima del walkthrough**

```bash
cd apps/web && node -e "
const es = require('./src/i18n/locales/es.json');
const arriba = [es.hero.h1a, es.hero.h1b, es.home.heroLede, es.home.walkthrough.kicker, es.home.walkthrough.lede].join(' ').toLowerCase();
const jerga = ['pinchar', 'cabina'];
const hit = jerga.filter(w => arriba.includes(w));
if (hit.length) { console.error('FALLO, jerga encontrada:', hit); process.exit(1); }
console.log('OK: sin jerga de cabina por encima del walkthrough');
"
```

Esperado: `OK: sin jerga de cabina por encima del walkthrough`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/i18n/locales/es.json apps/web/src/i18n/locales/en.json
git commit -m "Open the hero to anyone with a music library"
```

---

### Task 2: Corregir el paso del espectro

Corrige una **inexactitud factual**: la nota dice que son dos pistas distintas
cuando `SpectrumPair.tsx:6-8` documenta que son la misma pista procesada dos
veces.

**Files:**
- Modify: `apps/web/src/i18n/locales/es.json` (`home.quality.title`, `home.quality.lede`, `home.quality.note`)
- Modify: `apps/web/src/i18n/locales/en.json` (mismas claves)

**Interfaces:**
- Consumes: nada.
- Produces: nada. `Walkthrough.tsx:70-79` ya lee estas claves.

- [ ] **Step 1: Leer la evidencia antes de escribir**

```bash
sed -n '4,10p' "$(git rev-parse --show-toplevel)/apps/web/src/components/scenes/SpectrumPair.tsx"
```

Confirma que las dos imágenes son la misma pista, y que la única diferencia es el
códec. El copy nuevo debe reflejarlo.

- [ ] **Step 2: Editar `home.quality` en `es.json`**

Solo estas tres claves; el resto del objeto (`step`, `pill`, badges, alts,
captions) se deja intacto:

```json
"title": "Ese FLAC era un MP3.",
"lede": "Comprar lossless no garantiza que lo sea. Si alguien convirtió un MP3 a FLAC, el archivo pesa lo mismo que un lossless pero le falta la mitad de los agudos — y en el espectro se ve como un muro plano. Surco te lo marca antes de que la pista salga de casa.",
"note": "La misma pista, dos veces: el FLAC original y ese mismo audio pasado por MP3 y devuelto a FLAC. Solo cambia el códec, así que el muro no tiene otra explicación.",
```

- [ ] **Step 3: Editar `home.quality` en `en.json`**

```json
"title": "That FLAC was an MP3.",
"lede": "Buying lossless is no guarantee it is. If someone converted an MP3 to FLAC, the file weighs what a lossless weighs but half the treble is gone — and on the spectrum it shows as a flat wall. Surco flags it before the track ever leaves the house.",
"note": "The same track, twice: the original FLAC, and that same audio pushed through MP3 and back. Only the codec differs, so the wall has no other explanation.",
```

- [ ] **Step 4: Verificar paridad**

```bash
cd apps/web && npm test -- keys.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/locales/es.json apps/web/src/i18n/locales/en.json
git commit -m "Say the spectrum pair is one track processed twice"
```

---

### Task 3: Explicar por qué importa la comparación A/B

**Files:**
- Modify: `apps/web/src/i18n/locales/es.json` (`home.declick.lede`)
- Modify: `apps/web/src/i18n/locales/en.json` (`home.declick.lede`)

**Interfaces:**
- Consumes: nada.
- Produces: nada. `Walkthrough.tsx:177` ya lee esta clave.

El título (`home.declick.title`, «Los clics del vinilo, fuera.») **no cambia**.

- [ ] **Step 1: Editar `home.declick.lede` en `es.json`**

```json
"lede": "Si tus pistas vienen de un disco, traen chasquidos. Surco los encuentra, los marca sobre la onda y los quita — y puedes cambiar entre el audio original y el reparado mientras suena, sin cortes, para comprobar que no se ha llevado nada de la música por delante.",
```

- [ ] **Step 2: Editar `home.declick.lede` en `en.json`**

```json
"lede": "If your tracks came off a record, they carry clicks. Surco finds them, marks them on the wave and takes them out — and you can switch between the original and the repaired audio while it plays, with no gap, to check the repair didn't take any of the music with it.",
```

- [ ] **Step 3: Verificar paridad**

```bash
cd apps/web && npm test -- keys.test.ts
```

Esperado: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/locales/es.json apps/web/src/i18n/locales/en.json
git commit -m "Explain what the declick A/B is for"
```

---

### Task 4: Los destinos como argumento

El cambio de fondo del plan. Además **acota una promesa que hoy es falsa**: los
cue points no sobreviven a WAV ni a ALAC (`docs/funcionalidades.md` §10).

**Files:**
- Modify: `apps/web/src/i18n/locales/es.json` (`home.batch.title`, `home.batch.lede`, `home.batch.cues`)
- Modify: `apps/web/src/i18n/locales/en.json` (mismas claves)

**Interfaces:**
- Consumes: nada.
- Produces: nada. `Walkthrough.tsx:214,216,259` ya leen estas claves.

`home.batch.pill`, `stage`, `cancel` y `summary` se dejan intactos.

- [ ] **Step 1: Editar `home.batch` en `es.json`**

```json
"title": "Y acaba donde tú la escuchas.",
"lede": "Elige formato y destino, y Surco convierte la selección entera. No exporta un fichero para que tú lo importes: escribe en la biblioteca — con su carátula, su rating y su playlist.",
```

Y la nota de cues, acotada a los formatos donde la promesa se cumple:

```json
"cues": "tus cue points de Traktor siguen donde estaban en MP3, AIFF y FLAC",
```

- [ ] **Step 2: Editar `home.batch` en `en.json`**

```json
"title": "And it ends up where you listen.",
"lede": "Pick a format and a destination, and Surco converts the whole selection. It doesn't export a file for you to import: it writes into the library — artwork, rating and playlist included.",
```

```json
"cues": "your Traktor cue points stay put in MP3, AIFF and FLAC",
```

- [ ] **Step 3: Verificar que no se promete de más**

```bash
cd apps/web && node -e "
const es = require('./src/i18n/locales/es.json');
const en = require('./src/i18n/locales/en.json');
for (const [name, loc] of [['es', es], ['en', en]]) {
  const cues = loc.home.batch.cues.toLowerCase();
  const acota = ['mp3', 'aiff', 'flac'].every(f => cues.includes(f));
  if (!acota) { console.error('FALLO ' + name + ': la nota de cues no acota los formatos'); process.exit(1); }
  if (cues.includes('wav') || cues.includes('alac')) { console.error('FALLO ' + name + ': nombra un formato donde los cues se pierden'); process.exit(1); }
}
console.log('OK: la promesa de cue points esta acotada a MP3, AIFF y FLAC');
"
```

Esperado: `OK: la promesa de cue points esta acotada a MP3, AIFF y FLAC`.

- [ ] **Step 4: Verificar paridad**

```bash
cd apps/web && npm test -- keys.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/locales/es.json apps/web/src/i18n/locales/en.json
git commit -m "Name the destinations and scope the cue point promise"
```

---

### Task 5: Cierre con los dos quitamiedos

Añade una clave **nueva**, así que el test de paridad es la red de seguridad real:
si solo se añade en un idioma, falla.

**Files:**
- Modify: `apps/web/src/i18n/locales/es.json` (`home.closeTitle`, nueva `home.closeSafety`)
- Modify: `apps/web/src/i18n/locales/en.json` (mismas claves)
- Modify: `apps/web/src/App.tsx:61-64`

**Interfaces:**
- Consumes: `home.closeSafety` (creada en el Step 1 de esta tarea).
- Produces: nada.

- [ ] **Step 1: Añadir las claves en `es.json`**

Modificar `home.closeTitle` y añadir `home.closeSafety` justo después de
`home.closeNote`:

```json
"closeTitle": "Todo esto, en una ventana.",
"closeNote": "Gratis, para siempre. Sin cuenta, sin nube, sin límites.",
"closeSafety": "Tus archivos originales no se tocan: lo convertido va a una carpeta aparte. Notarizado por Apple; en Windows, SmartScreen avisa por ser una app nueva.",
```

- [ ] **Step 2: Añadir las claves en `en.json`**

```json
"closeTitle": "All of it, in one window.",
"closeNote": "Free, forever. No account, no cloud, no limits.",
"closeSafety": "Your original files are left alone — converted tracks go to a separate folder. Notarized by Apple; on Windows, SmartScreen warns because the app is new.",
```

- [ ] **Step 3: Ejecutar el test de paridad para ver que la clave nueva ya está en ambos**

```bash
cd apps/web && npm test -- keys.test.ts
```

Esperado: PASS. Si falla con una diferencia en `home.closeSafety`, es que falta en
uno de los dos ficheros.

- [ ] **Step 4: Renderizar la nota en `App.tsx`**

En `apps/web/src/App.tsx`, dentro de la sección de cierre, añadir un párrafo
después del que ya muestra `home.closeNote`. El bloque queda así:

```tsx
            <div className="mt-10 flex flex-col items-center gap-4">
              <DownloadButton />
              <p className="font-mono text-xs text-faint">{t('home.closeNote')}</p>
              <p className="max-w-md text-center font-mono text-xs leading-relaxed text-faint/80">
                {t('home.closeSafety')}
              </p>
            </div>
```

- [ ] **Step 5: Comprobar tipos y lint**

```bash
cd apps/web && npm run typecheck && npm run lint
```

Esperado: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/i18n/locales/es.json apps/web/src/i18n/locales/en.json apps/web/src/App.tsx
git commit -m "Answer the two download worries next to the button"
```

---

### Task 6: Verificación final en el navegador

El copy se juzga renderizado, no en JSON. Y hay que usar `preview`, no `dev`
(memoria del proyecto: las capturas contra `dev` no son fiables).

**Files:**
- Ninguno. Solo verificación.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Pasar toda la suite de la web**

```bash
cd apps/web && npm test
```

Esperado: todos los tests en verde, incluido `keys.test.ts` y `changelog.test.ts`.

- [ ] **Step 2: Construir y levantar el preview**

```bash
cd apps/web && npm run build && npm run preview
```

Esperado: build sin errores. El preview queda escuchando (normalmente en
`http://localhost:4173`).

- [ ] **Step 3: Revisar las dos versiones**

Abrir `http://localhost:4173/` (español) y `http://localhost:4173/en` (inglés).

Comprobar visualmente, en ambas:

1. El titular del hero cabe en dos líneas sin desbordar ni partirse mal.
2. El lede del hero no empuja el botón de descarga fuera de la vista en el
   viewport inicial.
3. En el paso 06 se leen los seis destinos en la maqueta.
4. La nota de cue points nombra MP3, AIFF y FLAC.
5. La nota nueva del cierre no compite visualmente con `closeNote` — debe leerse
   como letra pequeña secundaria.

- [ ] **Step 4: Contrastar contra el inventario**

```bash
grep -n "^[0-9]*\." docs/funcionalidades.md | tail -15
```

Releer las doce afirmaciones prohibidas de la §12 y confirmar que ninguna cadena
nueva las contradice. Prestar atención especial a los puntos 1 (cue points),
2 (Apple Music) y 7 («ya está en tu biblioteca»).

- [ ] **Step 5: Commit final si algo se ajustó**

Si los pasos 3 o 4 obligaron a retocar alguna cadena:

```bash
git add apps/web/src/i18n/locales/es.json apps/web/src/i18n/locales/en.json
git commit -m "Adjust home copy after reviewing the rendered page"
```

Si no hizo falta ningún ajuste, no hay commit en esta tarea.

---

## Self-review

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| Hero | 1 |
| Entradilla del walkthrough | 1 |
| Paso 02 (espectro) | 2 |
| Paso 04 (declick) | 3 |
| Paso 06 (destinos + cues) | 4 |
| Cierre + quitamiedos | 5 |
| Jerga | 1, 2 y 4 (aplicada al redactar) |
| Cambios en componentes | 5 |
| Código muerto no tocado | Constraint global |
| Verificación | 6 |

Sin huecos.

**Consistencia:** `home.closeSafety` es la única clave nueva; se crea en la Tarea 5
Step 1-2 y se consume en el Step 4 de la misma tarea. Ninguna otra tarea depende
de otra: las 1-5 tocan claves disjuntas y podrían ejecutarse en cualquier orden.

**Riesgo conocido:** las tareas 1-5 modifican los dos mismos ficheros JSON. Si se
ejecutan en paralelo habría conflictos. **Deben ejecutarse en serie.**
