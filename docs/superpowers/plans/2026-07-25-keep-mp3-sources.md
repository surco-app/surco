# Keep MP3 Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setting `keepMp3Sources` que, con formato de export lossless, deja los `.mp3` como MP3 (edición in-place de tags) en vez de transcodificarlos.

**Architecture:** La regla vive como 4º parámetro opcional de `resolveJobFormat` (shared), aplicada solo en call sites cuyo formato es settings-derived; los lotes deciden procedencia por valor con el helper `batchKeepMp3`. El Editor siembra `format: 'mp3'`, con lo que la UI existente (etiqueta "Update", aviso in-place, confirmaciones) cuenta lo que va a pasar sin cambios propios.

**Tech Stack:** Electron + React 19 + TS + Vitest. Spec: `docs/superpowers/specs/2026-07-25-keep-mp3-sources-design.md`.

## Global Constraints

- Todo el código vive bajo `apps/desktop/`; las rutas de abajo son relativas a ese directorio.
- NUNCA `npm run check` (reformatea ~92 ficheros ajenos). Verificar por fichero: `npx @biomejs/biome check <files>` y `npx tsc --noEmit -p tsconfig.web.json` + `npx tsc --noEmit -p tsconfig.node.json` (el tsc pelado de raíz no comprueba nada).
- Tests: `npx vitest run <file>` desde `apps/desktop`.
- Este repo comenta el porqué de cada decisión (campos de Settings, funciones de shared). Mantén ese estilo: comentarios de intención, no de mecánica.
- Commits: título descriptivo solo, sin body, sin prefijos `feat:`/`fix:`.
- La clave del setting es exactamente `keepMp3Sources`. Default `false`. Sincronizado (NO añadir a `LOCAL_KEYS`).
- Ningún job debe llegar al IPC con un formato no concreto; `OutputFormat` no se toca.

---

### Task 1: Regla keep-mp3 en shared/format

**Files:**
- Modify: `src/shared/format.ts`
- Test: `src/shared/format.test.ts`

**Interfaces:**
- Produces: `resolveJobFormat(setting: FormatSetting, inputPath: string, fallback: OutputFormat, keepMp3 = false): OutputFormat` — con `keepMp3` y entrada `.mp3` devuelve `'mp3'`.
- Produces: `reencodesLossyInPlace(setting, inputPath, overwriteOriginal, filtersActive, fallback, keepMp3 = false): boolean` — reenvía `keepMp3` a `resolveJobFormat`.
- Produces: `batchKeepMp3(format: FormatSetting | undefined, outputFormat: FormatSetting, keepMp3Sources: boolean): boolean`.

- [ ] **Step 1: Write the failing tests**

En `src/shared/format.test.ts`, dentro del `describe('resolveJobFormat')` existente añade (importa `batchKeepMp3` en la cabecera junto a los imports actuales):

```ts
  // Transcodificar un mp3 a lossless no recupera nada de lo que el encoder descartó:
  // con keepMp3 el fichero conserva su formato y el motor entra en el stream copy.
  it('keeps an mp3 source as mp3 under any lossless setting when keepMp3 is on', () => {
    expect(resolveJobFormat('aiff', '/music/song.mp3', 'aiff', true)).toBe('mp3')
    expect(resolveJobFormat('wav', '/music/song.mp3', 'aiff', true)).toBe('mp3')
    expect(resolveJobFormat('flac', '/music/song.mp3', 'aiff', true)).toBe('mp3')
    expect(resolveJobFormat('alac', '/music/song.mp3', 'aiff', true)).toBe('mp3')
    expect(resolveJobFormat('source', '/music/song.mp3', 'aiff', true)).toBe('mp3')
  })

  // Sin el flag, el comportamiento de siempre: el setting manda.
  it('converts an mp3 normally when keepMp3 is off', () => {
    expect(resolveJobFormat('aiff', '/music/song.mp3', 'aiff')).toBe('aiff')
    expect(resolveJobFormat('aiff', '/music/song.mp3', 'aiff', false)).toBe('aiff')
  })

  // La regla es solo para mp3: el resto de fuentes (incluido el .m4a ambiguo) no
  // cambia — un AAC dentro de .m4a seguiría sin poder "conservarse" con seguridad.
  it('leaves non-mp3 sources untouched when keepMp3 is on', () => {
    expect(resolveJobFormat('aiff', '/music/song.flac', 'aiff', true)).toBe('aiff')
    expect(resolveJobFormat('aiff', '/music/song.wav', 'aiff', true)).toBe('aiff')
    expect(resolveJobFormat('aiff', '/music/song.m4a', 'aiff', true)).toBe('aiff')
    expect(resolveJobFormat('aiff', '/music/song.ogg', 'aiff', true)).toBe('aiff')
  })
```

En el `describe('reencodesLossyInPlace')` existente añade:

```ts
  // keepMp3 convierte un export "a AIFF" en un mp3→mp3 in-place; con un filtro activo
  // eso es el mismo re-encode generacional que ya cubren 'source' y overwrite, y el
  // aviso tiene que verlo con el mismo formato que verá el job.
  it('flags a keepMp3 rewrite of an mp3 with an active filter', () => {
    expect(reencodesLossyInPlace('aiff', '/music/song.mp3', false, true, 'aiff', true)).toBe(true)
    expect(reencodesLossyInPlace('aiff', '/music/song.mp3', false, false, 'aiff', true)).toBe(false)
    expect(reencodesLossyInPlace('aiff', '/music/song.mp3', false, true, 'aiff', false)).toBe(false)
  })
```

Y un `describe` nuevo al final del fichero:

```ts
describe('batchKeepMp3', () => {
  // En un lote la procedencia del formato se pierde al fijarlo, así que se decide por
  // valor: sin formato, o con el mismo valor que el setting, el formato es
  // settings-derived y la regla aplica.
  it('applies to a settings-derived batch format', () => {
    expect(batchKeepMp3(undefined, 'aiff', true)).toBe(true)
    expect(batchKeepMp3('aiff', 'aiff', true)).toBe(true)
  })

  // Un pick distinto del setting solo puede venir del menú: elección explícita, la
  // regla se aparta y el lote entero sale en el formato pedido.
  it('steps aside for an explicit batch pick', () => {
    expect(batchKeepMp3('wav', 'aiff', true)).toBe(false)
  })

  it('never applies with the setting off', () => {
    expect(batchKeepMp3(undefined, 'aiff', false)).toBe(false)
    expect(batchKeepMp3('aiff', 'aiff', false)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/format.test.ts`
Expected: FAIL — `batchKeepMp3` no existe y los casos `keepMp3` devuelven el setting.

- [ ] **Step 3: Implement**

En `src/shared/format.ts`:

`resolveJobFormat` — añade el parámetro y el early return (ajusta el comentario doc de la función para mencionar la regla):

```ts
export function resolveJobFormat(
  setting: FormatSetting,
  inputPath: string,
  fallback: OutputFormat,
  keepMp3 = false,
): OutputFormat {
  // Upconverting an mp3 to lossless can't restore what the lossy encoder discarded —
  // the file only grows. With the Keep MP3 setting the source keeps its format, which
  // routes the job into the same stream-copy path a same-format export already takes.
  if (keepMp3 && formatMatchesInput('mp3', inputPath)) return 'mp3'
  if (setting !== 'source') return setting
  const match = (Object.keys(INPUT_EXT) as OutputFormat[]).find((f) =>
    formatMatchesInput(f, inputPath),
  )
  return match ?? fallback
}
```

`reencodesLossyInPlace` — nuevo parámetro reenviado:

```ts
export function reencodesLossyInPlace(
  setting: FormatSetting,
  inputPath: string,
  overwriteOriginal: boolean,
  filtersActive: boolean,
  fallback: OutputFormat,
  keepMp3 = false,
): boolean {
  if (!filtersActive) return false
  const resolved = resolveJobFormat(setting, inputPath, fallback, keepMp3)
  return resolved === 'mp3' && editsInPlace(resolved, inputPath, overwriteOriginal)
}
```

`batchKeepMp3` — nueva función al final:

```ts
// Whether the Keep MP3 rule applies to a whole batch. A batch pins one format for the
// run, losing where it came from, so provenance is judged by value: no format, or the
// same value the setting holds, is settings-derived; a different value can only be an
// explicit menu pick, which wins over the rule.
export function batchKeepMp3(
  format: FormatSetting | undefined,
  outputFormat: FormatSetting,
  keepMp3Sources: boolean,
): boolean {
  return keepMp3Sources && (format === undefined || format === outputFormat)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/format.test.ts`
Expected: PASS (los tests previos del fichero incluidos — los parámetros nuevos son opcionales).

- [ ] **Step 5: Verify per-file**

Run: `npx @biomejs/biome check src/shared/format.ts src/shared/format.test.ts && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/shared/format.ts src/shared/format.test.ts
git commit -m "Teach resolveJobFormat to keep mp3 sources on demand"
```

---

### Task 2: Setting keepMp3Sources + checkbox en Conversion

**Files:**
- Modify: `src/shared/types.ts` (~línea 133, tras `outputFormat`)
- Modify: `src/main/settings.ts` (~línea 31, tras `outputFormat: 'aiff'`)
- Modify: `src/renderer/src/lib/settingsContext.tsx` (interfaz `ResolvedSettings`, objeto `DEFAULTS` y el mapeo settings→resolved que hay más abajo en el fichero)
- Modify: `src/renderer/src/lib/settingsDraft.ts` (`SyncedDraft` ~línea 11 y `pickSynced` ~línea 75)
- Modify: `src/renderer/src/components/settings/ConversionTab.tsx`
- Modify: `src/renderer/src/i18n/locales/{en,es,de,fr,pt-BR}.json` (bloque `settings`, junto a `outputFormatHint`)
- Test: `src/renderer/src/components/settings/ConversionTab.test.tsx`

**Interfaces:**
- Consumes: nada de Task 1 (independiente).
- Produces: `Settings.keepMp3Sources: boolean` (default `false`, sincronizado), `SyncedDraft.keepMp3Sources: boolean`, `ResolvedSettings.keepMp3Sources: boolean`, claves i18n `settings.keepMp3Sources` / `settings.keepMp3SourcesHint`, checkbox `data-testid="settings-keep-mp3"`.

- [ ] **Step 1: Write the failing tests**

En `src/renderer/src/components/settings/ConversionTab.test.tsx` (usa el helper `renderTab` existente; añade `keepMp3Sources: false` al objeto `synced` base del test, que es un `SyncedDraft` completo y dejará de compilar sin él):

```tsx
describe('keep mp3 checkbox', () => {
  // El checkbox solo tiene sentido cuando el export transcodificaría un mp3: con MP3 o
  // "Same as source" como formato la regla nunca actúa y mostrarlo sería ruido.
  it('shows the checkbox only for lossless formats', () => {
    renderTab({ outputFormat: 'aiff' })
    expect(screen.getByTestId('settings-keep-mp3')).toBeInTheDocument()
  })

  it('hides the checkbox under mp3 and source', () => {
    renderTab({ outputFormat: 'mp3' })
    expect(screen.queryByTestId('settings-keep-mp3')).not.toBeInTheDocument()
    cleanup()
    renderTab({ outputFormat: 'source' })
    expect(screen.queryByTestId('settings-keep-mp3')).not.toBeInTheDocument()
  })

  it('patches keepMp3Sources on toggle', () => {
    const { patch } = renderTab({ outputFormat: 'aiff' })
    fireEvent.click(screen.getByTestId('settings-keep-mp3'))
    expect(patch).toHaveBeenCalledWith('keepMp3Sources', true)
  })
})
```

Nota: comprueba qué devuelve `renderTab` — si no expone `patch`, imita cómo los tests existentes del fichero acceden al spy. Si `CheckboxRow` monta el `data-testid` en un input y el click necesita otro target, imita el test existente de otro checkbox (p. ej. el de `flacFinderCovers` en `ArtworkTab.test.tsx`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/settings/ConversionTab.test.tsx`
Expected: FAIL (testid inexistente; posible error de tipos por el `SyncedDraft` incompleto).

- [ ] **Step 3: Implement the setting end to end**

`src/shared/types.ts`, justo después de `outputFormat: FormatSetting`:

```ts
  // When the export format is lossless, keep .mp3 sources as MP3 instead of
  // transcoding them: upconverting lossy audio can't restore quality and only grows
  // the file. Like any same-format export this edits the original in place (tags
  // rewritten where the file lives, no output-folder copy). Off by default.
  keepMp3Sources: boolean
```

`src/main/settings.ts`, tras `outputFormat: 'aiff'`:

```ts
  // Off by default: exports honor the chosen format unless the user opts in.
  keepMp3Sources: false,
```

NO tocar `LOCAL_KEYS` ni `mergeSettings` (los booleanos se fusionan por spread).

`src/renderer/src/lib/settingsContext.tsx`: añade `keepMp3Sources: boolean` a `ResolvedSettings` (tras `outputFormat`), `keepMp3Sources: false` a `DEFAULTS`, y la línea de mapeo en el punto del fichero donde cada campo se resuelve desde `settings` (sigue el patrón exacto de `outputFormat`).

`src/renderer/src/lib/settingsDraft.ts`: `keepMp3Sources: boolean` en `SyncedDraft` (tras `outputFormat`) y `keepMp3Sources: s.keepMp3Sources` en `pickSynced`. `buildSettingsPatch` lo recoge solo vía `...rest`.

`src/renderer/src/components/settings/ConversionTab.tsx`, nuevo bloque tras el `SettingsField` del formato (importa `SettingsCheckboxField` desde `./SettingsPrimitives`):

```tsx
          {/* Only offered while the export would transcode an mp3: under MP3 or "Same
              as source" the rule never fires, so the checkbox would be noise. */}
          {synced.outputFormat !== 'mp3' && synced.outputFormat !== 'source' && (
            <SettingsCheckboxField
              testid="settings-keep-mp3"
              checked={synced.keepMp3Sources}
              onChange={(v) => patch('keepMp3Sources', v)}
              label={tr('settings.keepMp3Sources')}
              hint={tr('settings.keepMp3SourcesHint')}
            />
          )}
```

i18n — en cada locale, junto a `outputFormat`/`outputFormatHint` del bloque `settings`:

- `en.json`: `"keepMp3Sources": "Keep MP3 files as MP3"`, `"keepMp3SourcesHint": "Converting an MP3 to a lossless format can't restore quality — the file only gets bigger. With this on, MP3s skip the conversion: tags are updated on the original file, right where it lives."`
- `es.json`: `"keepMp3Sources": "Mantener los MP3 como MP3"`, `"keepMp3SourcesHint": "Convertir un MP3 a un formato sin pérdida no recupera calidad: el archivo solo ocupa más. Con esto activo, los MP3 no se convierten: las etiquetas se actualizan sobre el archivo original, allí donde está."`
- `de.json`: `"keepMp3Sources": "MP3-Dateien als MP3 behalten"`, `"keepMp3SourcesHint": "Die Umwandlung einer MP3 in ein verlustfreies Format bringt keine Qualität zurück – die Datei wird nur größer. Ist dies aktiv, werden MP3s nicht konvertiert: Die Tags werden direkt in der Originaldatei aktualisiert."`
- `fr.json`: `"keepMp3Sources": "Conserver les MP3 en MP3"`, `"keepMp3SourcesHint": "Convertir un MP3 vers un format sans perte ne restaure aucune qualité : le fichier devient seulement plus volumineux. Avec cette option, les MP3 ne sont pas convertis : les tags sont mis à jour sur le fichier d'origine, là où il se trouve."`
- `pt-BR.json`: `"keepMp3Sources": "Manter arquivos MP3 como MP3"`, `"keepMp3SourcesHint": "Converter um MP3 para um formato sem perdas não recupera qualidade — o arquivo só fica maior. Com isso ativo, os MP3 não são convertidos: as tags são atualizadas no arquivo original, onde ele está."`

Ojo: otros tests construyen `SyncedDraft` completos (p. ej. `SettingsModal`/wizard); si tsc señala más literales incompletos, añade `keepMp3Sources: false` en ellos.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/settings/ConversionTab.test.tsx src/main/settings.test.ts src/renderer/src/lib/settingsDraft.test.ts 2>/dev/null || npx vitest run src/renderer/src/components/settings/ConversionTab.test.tsx src/main/settings.test.ts`
Expected: PASS (si `settingsDraft.test.ts` no existe, el `||` ejecuta el resto).

- [ ] **Step 5: Verify per-file**

Run: `npx @biomejs/biome check src/shared/types.ts src/main/settings.ts src/renderer/src/lib/settingsContext.tsx src/renderer/src/lib/settingsDraft.ts src/renderer/src/components/settings/ConversionTab.tsx && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: sin errores (el tsc de web es el que detecta literales `SyncedDraft` incompletos en otros tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/settings.ts src/renderer/src/lib/settingsContext.tsx src/renderer/src/lib/settingsDraft.ts src/renderer/src/components/settings/ConversionTab.tsx src/renderer/src/i18n/locales/*.json src/renderer/src/components/settings/ConversionTab.test.tsx
git commit -m "Add the Keep MP3 setting to the Conversion tab"
```

---

### Task 3: Aplicar la regla en jobs y confirmaciones

**Files:**
- Modify: `src/renderer/src/hooks/useTrackProcessing.ts` (`processOne` ~161-178, `processAll` ~381 y la llamada a `processOne` ~404)
- Modify: `src/renderer/src/hooks/useConfirmFlows.ts` (`risksLossyReencode` ~44-60, `askConvertAll` ~329)
- Test: `src/renderer/src/hooks/useTrackProcessing.test.tsx`, `src/renderer/src/hooks/useConfirmFlows.test.tsx`

**Interfaces:**
- Consumes: `resolveJobFormat(..., keepMp3)`, `reencodesLossyInPlace(..., keepMp3)`, `batchKeepMp3(format, outputFormat, keepMp3Sources)` de Task 1; `Settings.keepMp3Sources` de Task 2.
- Produces: `processOne(id, formatOverride?, normalizeOverride?, overwriteOverride?, forceReencode?, destinationOverride?, declickOverride?, keepMp3?: boolean)` — el 8º parámetro solo lo pasa `processAll`.

- [ ] **Step 1: Write the failing tests**

En `useTrackProcessing.test.tsx`, un `describe('Keep MP3')` nuevo junto al de `'Same as source'` (mismo harness: `setApi`, `track()`, `renderHook`, `withClient`):

```tsx
  describe('Keep MP3', () => {
    // La conversión selectiva que 'source' no puede expresar: lo lossless va al
    // formato elegido y los mp3 se quedan como están, sin engordar la biblioteca.
    it('keeps mp3 tracks while converting the rest of the batch', async () => {
      const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x' })
      setApi({ processTrack })
      const settings = {
        outputFormat: 'aiff',
        keepMp3Sources: true,
        overwriteOriginal: false,
      } as Settings
      const tracks = [
        track({ id: 'a', inputPath: '/music/a.flac' }),
        track({ id: 'b', inputPath: '/music/b.mp3' }),
      ]
      const { result } = renderHook(
        () => useTrackProcessing({ tracks, settings, updateTrack: vi.fn() }),
        { wrapper: withClient() },
      )
      await act(async () => {
        await result.current.processAll(tracks)
      })
      const formats = processTrack.mock.calls.map(([job]) => job.format)
      expect(formats).toEqual(['aiff', 'mp3'])
    })

    // Un pick del menú distinto del setting es una orden explícita para el lote
    // entero: la regla se aparta y el mp3 también se convierte.
    it('converts mp3 tracks when the batch pins an explicit different format', async () => {
      const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x' })
      setApi({ processTrack })
      const settings = {
        outputFormat: 'aiff',
        keepMp3Sources: true,
        overwriteOriginal: false,
      } as Settings
      const tracks = [track({ id: 'b', inputPath: '/music/b.mp3' })]
      const { result } = renderHook(
        () => useTrackProcessing({ tracks, settings, updateTrack: vi.fn() }),
        { wrapper: withClient() },
      )
      await act(async () => {
        await result.current.processAll(tracks, 'wav')
      })
      expect(processTrack.mock.calls[0][0].format).toBe('wav')
    })

    // El single-select ya sembró la regla en el formato que envía; un formato
    // explícito en processOne debe viajar tal cual o el pick del editor mentiría.
    it('honors an explicit processOne format over the rule', async () => {
      const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x' })
      setApi({ processTrack })
      const settings = {
        outputFormat: 'aiff',
        keepMp3Sources: true,
        overwriteOriginal: false,
      } as Settings
      const tracks = [track({ id: 'b', inputPath: '/music/b.mp3' })]
      const { result } = renderHook(
        () => useTrackProcessing({ tracks, settings, updateTrack: vi.fn() }),
        { wrapper: withClient() },
      )
      await act(async () => {
        await result.current.processOne('b', 'aiff')
      })
      expect(processTrack.mock.calls[0][0].format).toBe('aiff')
    })
  })
```

En `useConfirmFlows.test.tsx` (harness `setup()` + `track()` existentes; el modelo es el test `'confirms a batch convert-all with no picks when Settings normalize is on'` ~línea 289, que asserta longitud + `destructive`):

```tsx
  // Con keep activo y un filtro encendido, el "convert to AIFF" de la UI es en realidad
  // un mp3→mp3 re-encode sobre el original: el diálogo de pérdida generacional tiene
  // que salir aunque el formato del lote diga aiff.
  it('confirms a keep-mp3 batch whose filter forces a lossy re-encode', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3], {
      settings: {
        outputFormat: 'aiff',
        keepMp3Sources: true,
        overwriteOriginal: false,
        normalize: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      } as Settings,
    })
    flows.askConvertAll([mp3])
    expect(opened).toHaveLength(1)
    expect(opened[0].destructive).toBe(true)
  })

  // Sin el setting, el mismo lote escribe un AIFF nuevo y no toca el original: no hay
  // nada que confirmar. El contraste fija que el aviso viene de la regla, no del filtro.
  it('does not confirm the same batch with keep mp3 off', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3], {
      settings: {
        outputFormat: 'aiff',
        keepMp3Sources: false,
        overwriteOriginal: false,
        normalize: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      } as Settings,
    })
    flows.askConvertAll([mp3])
    expect(opened).toHaveLength(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/hooks/useTrackProcessing.test.tsx src/renderer/src/hooks/useConfirmFlows.test.tsx`
Expected: FAIL — el mp3 del lote sale `'aiff'` y el diálogo lossy no se abre.

- [ ] **Step 3: Implement**

`useTrackProcessing.ts` — importa `batchKeepMp3` junto a los imports de `shared/format`. En `processOne`, añade el 8º parámetro y deriva el flag (sustituyendo la línea de `jobFormat`):

```ts
      keepMp3?: boolean,
```

```ts
      // The Editor already seeds the rule into any format it sends, so a format
      // received here is explicit and must travel untouched; only the branch that read
      // the setting applies keep. processAll pins the batch decision via the parameter.
      const keep = keepMp3 ?? (formatOverride === undefined && (settings?.keepMp3Sources ?? false))
      const jobFormat = resolveJobFormat(pickedFormat, track.inputPath, 'aiff', keep)
```

En `processAll`, junto a `pinnedFormat` (~381):

```ts
      const pinnedKeep = batchKeepMp3(
        formatOverride,
        settings?.outputFormat ?? 'aiff',
        settings?.keepMp3Sources ?? false,
      )
```

y en la llamada interna (~404) pasa `pinnedKeep` como 8º argumento de `processOne(id, pinnedFormat, normalizeOverride, pinnedOverwrite, undefined, destinationOverride, declickOverride, pinnedKeep)`.

`useConfirmFlows.ts` — importa `batchKeepMp3` junto a `reencodesLossyInPlace`. `risksLossyReencode` gana un parámetro final `keepMp3: boolean` que reenvía como 6º argumento de `reencodesLossyInPlace`. En `askConvertAll`, antes del `targets.some(...)`:

```ts
    const keep = batchKeepMp3(
      format,
      settings?.outputFormat ?? 'aiff',
      settings?.keepMp3Sources ?? false,
    )
```

y pasa `keep` en la llamada `risksLossyReencode(t, format, overwriting, normalize, declick, settings, keep)`. En `askConvertOne` pasa `false` (el formato que le llega del editor ya viene sembrado y concreto — un `'mp3'` sembrado dispara el aviso por sí solo).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/hooks/useTrackProcessing.test.tsx src/renderer/src/hooks/useConfirmFlows.test.tsx`
Expected: PASS, incluidos todos los tests previos de ambos ficheros.

- [ ] **Step 5: Verify per-file**

Run: `npx @biomejs/biome check src/renderer/src/hooks/useTrackProcessing.ts src/renderer/src/hooks/useConfirmFlows.ts && npx tsc --noEmit -p tsconfig.web.json`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useTrackProcessing.ts src/renderer/src/hooks/useConfirmFlows.ts src/renderer/src/hooks/useTrackProcessing.test.tsx src/renderer/src/hooks/useConfirmFlows.test.tsx
git commit -m "Apply the Keep MP3 rule to jobs and lossy re-encode warnings"
```

---

### Task 4: Seed del Editor, comando y guardia de main

**Files:**
- Modify: `src/renderer/src/components/Editor.tsx` (seeds ~290 y ~358, ref `lastSettings` ~333, deps del efecto ~375, destructure del context ~213)
- Modify: `src/renderer/src/lib/commands.ts` (~684)
- Modify: `src/main/processTrack.ts` (~130)
- Test: `src/renderer/src/components/Editor.test.tsx`

**Interfaces:**
- Consumes: `resolveJobFormat(..., keepMp3)` de Task 1; `ResolvedSettings.keepMp3Sources` (context) de Task 2.
- Produces: nada nuevo para otras tasks.

- [ ] **Step 1: Write the failing test**

En `Editor.test.tsx`, junto al test existente `'labels the button "Update" when the export format matches the source'` (~línea 1534) y copiando su forma exacta de montar (`renderEditor` acepta el `outputFormat` como 2º argumento y un objeto de settings extra vía provider — si `keepMp3Sources` no entra por `renderEditor`, pásalo por el `settings` de `renderWithQuery` igual que hace ese test con su formato):

```tsx
  // Con Keep MP3 activo, "convertir a AIFF" un mp3 es en realidad una edición in-place
  // de tags: el botón tiene que decir "Update", no prometer un AIFF que nunca se crea.
  it('labels the button "Update" for an mp3 source when keep mp3 is on', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.mp3', fileName: 'a.mp3' }, 'aiff', {
      keepMp3Sources: true,
    })
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Update')
  })
```

Nota: `renderEditor` no acepta hoy `keepMp3Sources` — extiende su parámetro `props` con `keepMp3Sources?: boolean` y pásalo al objeto settings del provider (mismo mecanismo que `overwriteOriginal`), y en el test usa `{ keepMp3Sources: true }`. Comprueba también el test vecino de :1534 para ver si necesita `addToAppleMusic: false` para que el literal sea exactamente "Update".

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/Editor.test.tsx -t 'keep mp3'`
Expected: FAIL — el botón dice "Convert to AIFF…".

- [ ] **Step 3: Implement**

`Editor.tsx`:
- añade `keepMp3Sources` al destructure del settings context (~213).
- seed inicial (~290): `useState(resolveJobFormat(outputFormat, item.inputPath, 'aiff', keepMp3Sources))`.
- re-seed (~358): `resolveJobFormat(outputFormat, item.inputPath, 'aiff', keepMp3Sources)`.
- `lastSettings` ref (~333): añade `keepMp3Sources` al objeto guardado, inclúyelo en `formatSettingChanged` (`outputFormat !== prev.outputFormat || keepMp3Sources !== prev.keepMp3Sources`) y en la reasignación del ref (~350); añade `keepMp3Sources` al array de deps del efecto (~375). Es el mismo trato que ya recibe `outputFormat`: cambiar el setting con el editor abierto reseedea el formato.

`commands.ts` (~684): `resolveJobFormat(settings?.outputFormat ?? 'aiff', selected.inputPath, 'aiff', settings?.keepMp3Sources ?? false)`.

`processTrack.ts` (~130): `job.format ?? resolveJobFormat(settings.outputFormat, job.inputPath, 'aiff', settings.keepMp3Sources)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/Editor.test.tsx`
Expected: PASS completo (el seed nuevo con `keepMp3Sources: false` por defecto no altera ningún test previo).

- [ ] **Step 5: Verify per-file**

Run: `npx @biomejs/biome check src/renderer/src/components/Editor.tsx src/renderer/src/lib/commands.ts src/main/processTrack.ts && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Editor.tsx src/renderer/src/lib/commands.ts src/main/processTrack.ts src/renderer/src/components/Editor.test.tsx
git commit -m "Seed the editor format with the Keep MP3 rule"
```

---

### Task 5: Verificación completa

**Files:** ninguno nuevo.

- [ ] **Step 1: Full renderer + shared + main test sweep**

Run (desde `apps/desktop`): `npx vitest run src/shared src/renderer/src/hooks src/renderer/src/components/settings src/renderer/src/components/Editor.test.tsx src/renderer/src/components/ExportButton.test.tsx src/renderer/src/lib`
Expected: todo PASS. Los suites de `src/main/convert*` usan ffmpeg real y son lentos; ejecútalos solo si Task 4 tocó algo más que la línea 130 de `processTrack.ts` — esta feature no cambia el motor.

- [ ] **Step 2: Typecheck ambos targets**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: sin errores.

- [ ] **Step 3: Smoke visual (opcional, si la sesión puede)**

Con la skill `run-desktop`: arranca la app, activa el setting en Settings → Conversion con formato AIFF, carga un mp3 y comprueba que el botón dice "Update + Apple Music" (o "Update"), y que un flac sigue diciendo "Convert to AIFF…". Ojo a los gotchas conocidos de la skill (userData aislado, log compartido).

- [ ] **Step 4: Report**

Checkpoint final: resumen de lo hecho, tests en verde, y flecos si los hay. El merge a main local y la limpieza del worktree los decide el usuario (su flujo: merge local sin push).
