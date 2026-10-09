# Revisar metadatos de la lista Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La revisión de grafías y duplicados que ya existe para Apple Music, corriendo sobre las pistas cargadas en la lista de Surco, abierta desde el menú Pistas y ⌘K en todas las plataformas.

**Architecture:** El motor (`musicSpelling`, `duplicates`, `musicFixPlan`) y el hook `useMusicReview` dejan de conocer Music: trabajan con `ReviewEntry` cuyo `id` es la ruta o el persistent ID, y todo lo que difiere vive en una `ReviewSource` (`lib/reviewSource.ts` para Music, `lib/listReviewSource.ts` para la lista). Main gana dos orquestadores pequeños con dependencias inyectadas: `listReviewApply.ts` (fichero primero, Music después) y el canal `listreview:removeDuplicates`, que reutiliza `replaceDuplicates` con un paso de Music entre las bibliotecas DJ y la Papelera. La vista es la misma, con los textos que cambian sacados de la fuente.

**Tech Stack:** TypeScript, Electron (main + preload + renderer React 19), node-taglib-sharp, AppleScript por `osascript` (solo macOS), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-08-revisar-metadatos-lista-design.md`

## Global Constraints

- **Todas las plataformas.** La entrada de la lista se registra siempre y se activa con `tracks.length > 0 && !batching`. Todo lo de Apple Music es solo `darwin`: fuera de macOS no se consulta ni se escribe Music.
- **La guarda es el fichero.** Un campo se escribe solo si el fichero sigue diciendo exactamente (NFC) lo que se leyó de la instantánea del disco (`diskSignature`). Music solo se toca en los campos que llegaron al fichero, con la guarda de `setAppleMusicField`.
- **Orden al quitar una copia:** bibliotecas DJ → Apple Music → Papelera → la fila sale de la lista. Nunca se tira un fichero que una biblioteca aún usa, ni si la copia que se queda es el mismo fichero real, ni si Music sigue teniéndolo (ambiguo, sin entrada para la que se queda, `mismatch`, fallo).
- **Papelera recuperable:** la misma regla que `shell:trash` (`trashRecoverably`); en un volumen sin Papelera el fichero va a Copias de seguridad.
- **Nada se escribe sin la hoja de confirmación.**
- **Comportamiento de Music intacto.** Ningún test de `useMusicReview.test.tsx` ni de `App.test.tsx` cambia salvo los renombrados mecánicos que nombra la Task 1.
- **Ignorados en `listReviewIgnored`**, en `LOCAL_KEYS` desde el principio. `musicReviewIgnored` no se toca.
- **Coste:** `spellingGroups` sobre 5000 pistas sintéticas (generador de la Task 2) por debajo de 500 ms.
- **Tests desde `apps/desktop`**: `cd apps/desktop && npm test -- <ruta>`. Desde la raíz se salta el setup y da fallos falsos.
- **Typecheck explícito**: `cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`.
- **Comentarios**: solo porqués no evidentes, en el estilo del repo. Conflicto ya señalado en el plan de Music con la regla global de cero comentarios; se sigue el repo.
- **Textos**: castellano llano, sin guion largo ni dos puntos de explicación; cinco lenguas (`es`, `en`, `de`, `fr`, `pt-BR`) con las mismas claves (`keys.test.ts`, `usedKeys.test.ts`).
- **Selectores de test**: `data-testid`.
- **TDD**: cada test nuevo se ve fallar antes de implementar; la lógica de guardas se comprueba además por mutación (romper la guarda, ver el test en rojo, deshacer).
- **Commits**: título descriptivo en inglés, sin cuerpo ni prefijos, uno por tarea, en `worktree-revisar-lista`. Nunca `--no-verify`.

## Review Focus

- **Fila con ediciones sin guardar** (el usuario cambió el artista en el editor y no convirtió): la revisión enseña y escribe lo que hay en el disco, y tras aplicar la edición pendiente sigue en la fila. Test en la Task 3.
- **Dos rutas al mismo fichero real** (enlace simbólico, alias de volumen): quitar una como duplicado no puede mandar a la Papelera el audio de la otra. Test en la Task 6.
- **Un fichero con dos entradas en Apple Music**: no se corrige ninguna entrada y, si es una copia que se quita, el fichero se queda. Tests en las Tasks 6 y 8.
- **Fichero reetiquetado por otra app entre la carga y Aplicar**: TagLib responde `unchanged`, Music no se toca y la fila no se parchea. Test en la Task 5.
- **Carpeta en un NAS sin Papelera**: el fichero quitado acaba en Copias de seguridad, nunca borrado del todo. Test en la Task 6.

---

### Task 1: El motor y el hook trabajan con una fuente (Music sin cambios)

Refactor que no añade comportamiento. Las entradas pasan a llevar `id` y el hook recibe una `ReviewSource` opcional; sin ella usa `musicSource`, que hace exactamente las llamadas IPC de hoy.

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (tras `MusicFixOutcome`)
- Create: `apps/desktop/src/renderer/src/lib/reviewSource.ts`
- Modify: `apps/desktop/src/renderer/src/lib/musicSpelling.ts`, `lib/musicFixPlan.ts`, `lib/libraryTagUpdates.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/useMusicReview.ts`
- Modify: `apps/desktop/src/renderer/src/components/MusicReview.tsx:335`, `components/MusicReviewDetail.tsx`
- Test: `apps/desktop/src/renderer/src/lib/reviewSource.test.ts` (nuevo), `hooks/useMusicReview.test.tsx`
- Renombrado mecánico en tests: `lib/musicSpelling.test.ts`, `lib/musicFixPlan.test.ts`, `components/MusicReview.test.tsx`

**Interfaces:**
- Produces (`shared/types.ts`):

```ts
// One track as the review sees it: `id` is the Music persistent ID for the library review
// and the file path for the list review.
export interface ReviewEntry {
  id: string
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  durationSec?: number
}

export interface ReviewFix {
  id: string
  field: MusicReviewField
  from: string
  to: string
}

// `music` runs parallel to `fixes`; 'none' is a field Music was never asked about.
export interface ReviewOutcome {
  id: string
  musicId?: string
  path?: string
  fixes: ReviewFix[]
  music: (MusicFieldOutcome | 'none')[]
  file: MusicFixOutcome['file']
  written: MusicReviewField[]
  backupId?: string
  error?: string
}
```

- Produces (`lib/reviewSource.ts`):

```ts
export interface ReviewLoad {
  entries: ReviewEntry[]
  skipped: number
}
export interface ReviewRemoval {
  removeId: string
  keepId: string
  label: string
  keepLabel: string
}
export interface ReviewRemovalRun {
  removed: RemoveCopyResult[]
  replaced: DuplicateReplaceOutcome[]
  librariesUntouched: boolean
  replaceFailed: boolean
}
export interface RemovalHooks {
  isCancelled: () => boolean
  onStep: (current: number) => void
  onDone: (done: number) => void
  onLibraries: () => void
}
export interface ReviewSource {
  kind: 'music' | 'list'
  load: () => Promise<ReviewLoad>
  locate: (id: string) => Promise<string>
  applyFixes: (fixes: ReviewFix[]) => Promise<ReviewOutcome[]>
  onProgress: (cb: (p: MusicFixProgress) => void) => () => void
  cancel: () => void
  removeCopies: (removals: ReviewRemoval[], hooks: RemovalHooks) => Promise<ReviewRemovalRun>
  revertMusic: (outcome: ReviewOutcome, fix: ReviewFix) => Promise<unknown>
}
export const musicSource: ReviewSource
```

- Changes: `SpellingVariant.persistentIds` → `ids`; `spellingGroups(entries: ReviewEntry[])`; `planFixes(entries: ReviewEntry[], choices): ReviewFix[]`; `summarizeFixes(fixes: ReviewFix[])`; `DuplicateCard.entries: ReviewEntry[]`; `ReviewRun.outcomes: ReviewOutcome[]`; `MusicReview.affected(key): (ReviewFix & { title: string })[]`; `useMusicReview({ source?: ReviewSource, … })`.

- [ ] **Step 1: Escribir los tests que fallan**

`lib/reviewSource.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { musicSource } from './reviewSource'

function setApi(over: Partial<Record<keyof Api, unknown>>) {
  ;(window as unknown as { api: unknown }).api = over
}
afterEach(() => vi.restoreAllMocks())

describe('musicSource', () => {
  // Main and every Music script still speak persistent IDs; only the renderer's engine
  // moved to a neutral id, so the mapping must be exact in both directions.
  it('sends persistent IDs to Music and hands back ids', async () => {
    const applyMusicFixes = vi.fn().mockResolvedValue([
      {
        persistentId: 'C',
        path: '/m/c.mp3',
        fixes: [{ persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
        music: ['set'],
        file: 'written',
        written: ['artist'],
        backupId: 'b1',
      },
    ])
    setApi({ applyMusicFixes })
    const out = await musicSource.applyFixes([
      { id: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(applyMusicFixes).toHaveBeenCalledWith([
      { persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(out).toEqual([
      {
        id: 'C',
        musicId: 'C',
        path: '/m/c.mp3',
        fixes: [{ id: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
        music: ['set'],
        file: 'written',
        written: ['artist'],
        backupId: 'b1',
      },
    ])
  })

  it('loads the library as entries keyed by persistent ID, with nothing skipped', async () => {
    setApi({
      loadMusicReview: vi.fn().mockResolvedValue([
        { persistentId: 'A', title: 'T', artist: 'X', albumArtist: '', album: '', genre: '', durationSec: 3 },
      ]),
    })
    expect(await musicSource.load()).toEqual({
      entries: [{ id: 'A', title: 'T', artist: 'X', albumArtist: '', album: '', genre: '', durationSec: 3 }],
      skipped: 0,
    })
  })

  it('stops removing at a cancel and tells the libraries nothing', async () => {
    const removeMusicDuplicate = vi.fn().mockResolvedValue({
      outcome: 'removed',
      playlists: 0,
      fileTrashed: false,
      pair: { from: '/m/q.aiff', to: '/m/p.aiff', shared: false },
    })
    const replaceDuplicatesInLibraries = vi.fn()
    setApi({ removeMusicDuplicate, replaceDuplicatesInLibraries })
    let cancelled = false
    const run = await musicSource.removeCopies(
      [
        { removeId: 'Q', keepId: 'P', label: 'Ann - Song', keepLabel: 'Ann - Song' },
        { removeId: 'R', keepId: 'P', label: 'Ann - Song', keepLabel: 'Ann - Song' },
      ],
      {
        isCancelled: () => cancelled,
        onStep: () => {},
        onDone: () => {
          cancelled = true
        },
        onLibraries: () => {},
      },
    )
    expect(removeMusicDuplicate).toHaveBeenCalledTimes(1)
    expect(removeMusicDuplicate).toHaveBeenCalledWith({
      removePid: 'Q',
      keepPid: 'P',
      label: 'Ann - Song',
      keepLabel: 'Ann - Song',
    })
    expect(replaceDuplicatesInLibraries).not.toHaveBeenCalled()
    expect(run.librariesUntouched).toBe(true)
  })
})
```

En `hooks/useMusicReview.test.tsx`, al final del `describe('useMusicReview')`:

```ts
  // The seam the list review plugs into: a source given to the hook is the only thing it
  // talks to for reading, writing and undoing.
  it('reads, writes and undoes through the source it is given', async () => {
    setApi()
    const source = {
      kind: 'music' as const,
      load: vi.fn().mockResolvedValue({
        entries: [
          { id: '/a', title: 'A', artist: 'DJ Lara', albumArtist: '', album: '', genre: '' },
          { id: '/b', title: 'B', artist: 'DJ Lara', albumArtist: '', album: '', genre: '' },
          { id: '/c', title: 'C', artist: 'Dj Lara', albumArtist: '', album: '', genre: '' },
        ],
        skipped: 0,
      }),
      locate: vi.fn(async (id: string) => id),
      applyFixes: vi.fn().mockResolvedValue([
        {
          id: '/c',
          musicId: 'PID',
          path: '/c',
          fixes: [{ id: '/c', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
          music: ['set'],
          file: 'written',
          written: ['artist'],
          backupId: 'b1',
        },
      ]),
      onProgress: vi.fn(() => () => {}),
      cancel: vi.fn(),
      removeCopies: vi.fn(),
      revertMusic: vi.fn().mockResolvedValue('set'),
    }
    const { result } = renderHook(() => useMusicReview(props({ source })))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(source.applyFixes).toHaveBeenCalledWith([
      { id: '/c', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    await act(() => result.current.undo())
    expect(source.revertMusic).toHaveBeenCalledWith(
      expect.objectContaining({ musicId: 'PID' }),
      { id: '/c', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    )
    expect(window.api.loadMusicReview).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/reviewSource.test.ts src/renderer/src/hooks/useMusicReview.test.tsx`
Expected: FAIL, `Cannot find module './reviewSource'` y el test nuevo del hook en rojo (llama a `loadMusicReview`, ignora `source`).

- [ ] **Step 3: Tipos y motor**

Añadir los tres tipos de **Interfaces** a `shared/types.ts`.

`lib/musicSpelling.ts`: importar `ReviewEntry` en lugar de `MusicReviewEntry`; `SpellingVariant { value: string; ids: string[] }`; en `valuesOf(entry: ReviewEntry, …)` y `collect(entries: ReviewEntry[], …)` usar `ids.add(entry.id)`; en `variantsOf`, `suggest`, `typoGroups` y el `tracks` de `spellingGroups`, `persistentIds` → `ids`; `spellingGroups(entries: ReviewEntry[])`. Comprobación: `grep -n persistentId src/renderer/src/lib/musicSpelling.ts` no devuelve nada.

`lib/musicFixPlan.ts` completo:

```ts
import type { MusicReviewField, ReviewEntry, ReviewFix } from '../../../shared/types'
import { replaceAct, type SpellingGroup } from './musicSpelling'

export interface GroupChoice {
  group: SpellingGroup
  to: string
}

const ACT_FIELDS: ReadonlySet<MusicReviewField> = new Set(['artist', 'albumArtist'])

export function planFixes(entries: ReviewEntry[], choices: GroupChoice[]): ReviewFix[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const next = new Map<string, { id: string; field: MusicReviewField; value: string }>()
  for (const { group, to } of choices) {
    for (const variant of group.variants) {
      if (variant.value === to) continue
      for (const id of variant.ids) {
        const entry = byId.get(id)
        if (!entry) continue
        const key = `${id}|${group.field}`
        // Several choices can touch one credit; each must build on the previous result.
        const before = next.get(key)?.value ?? entry[group.field]
        const after = ACT_FIELDS.has(group.field)
          ? replaceAct(before, variant.value, to)
          : before === variant.value
            ? to
            : before
        next.set(key, { id, field: group.field, value: after })
      }
    }
  }
  const fixes: ReviewFix[] = []
  for (const { id, field, value } of next.values()) {
    const from = (byId.get(id) as ReviewEntry)[field]
    if (from !== value) fixes.push({ id, field, from, to: value })
  }
  return fixes
}

export function summarizeFixes(fixes: ReviewFix[]): {
  tracks: number
  byField: Partial<Record<MusicReviewField, number>>
} {
  const byField: Partial<Record<MusicReviewField, number>> = {}
  for (const fix of fixes) byField[fix.field] = (byField[fix.field] ?? 0) + 1
  return { tracks: new Set(fixes.map((f) => f.id)).size, byField }
}
```

`lib/libraryTagUpdates.ts`: solo la firma, estructural, para que acepte `MusicFixOutcome` (su test) y `ReviewOutcome`:

```ts
import type { LibraryTagUpdate, MusicReviewField, TagChange } from '../../../shared/types'

type Written = {
  path?: string
  written: MusicReviewField[]
  fixes: ({ field: MusicReviewField } & TagChange)[]
}

export function tagUpdatesOf(outcomes: Written[], direction: 'apply' | 'undo'): LibraryTagUpdate[] {
```

(cuerpo sin cambios).

- [ ] **Step 4: La fuente de Music**

`lib/reviewSource.ts`: los tipos de **Interfaces** y:

```ts
import type {
  DuplicateReplaceOutcome,
  MusicFixOutcome,
  MusicFixProgress,
  MusicReviewEntry,
  RemoveCopyResult,
  ReviewEntry,
  ReviewFix,
  ReviewOutcome,
} from '../../../shared/types'

const FAILED_REMOVAL: RemoveCopyResult = { outcome: 'failed', playlists: 0, fileTrashed: false }

const entryOf = ({ persistentId, ...rest }: MusicReviewEntry): ReviewEntry => ({
  id: persistentId,
  ...rest,
})

const outcomeOf = ({ persistentId, fixes, ...rest }: MusicFixOutcome): ReviewOutcome => ({
  ...rest,
  id: persistentId,
  musicId: persistentId,
  fixes: fixes.map(({ persistentId: id, ...fix }) => ({ id, ...fix })),
})

// The library review as it always ran: every call is the IPC the hook made itself before
// the list review needed a second source.
export const musicSource: ReviewSource = {
  kind: 'music',
  load: async () => ({ entries: (await window.api.loadMusicReview()).map(entryOf), skipped: 0 }),
  locate: (id) => window.api.appleMusicEntryLocation(id),
  applyFixes: async (fixes) =>
    (
      await window.api.applyMusicFixes(fixes.map(({ id, ...fix }) => ({ persistentId: id, ...fix })))
    ).map(outcomeOf),
  onProgress: (cb) => window.api.onMusicFixProgress(cb),
  cancel: () => {
    void window.api.cancelMusicFixes()
  },
  removeCopies: async (removals, { isCancelled, onStep, onDone, onLibraries }) => {
    const removed: RemoveCopyResult[] = []
    for (const r of removals) {
      if (isCancelled()) break
      onStep(removed.length + 1)
      removed.push(
        await window.api
          .removeMusicDuplicate({
            removePid: r.removeId,
            keepPid: r.keepId,
            label: r.label,
            keepLabel: r.keepLabel,
          })
          .catch(() => FAILED_REMOVAL),
      )
      onDone(removed.length)
    }
    const pairs = removed.flatMap((r) => (r.pair ? [r.pair] : []))
    const run = { removed, replaced: [], librariesUntouched: false, replaceFailed: false }
    if (pairs.length === 0) return run
    if (isCancelled()) return { ...run, librariesUntouched: true }
    onLibraries()
    let replaceFailed = false
    const replaced: DuplicateReplaceOutcome[] = await window.api
      .replaceDuplicatesInLibraries(pairs)
      .catch(() => {
        replaceFailed = true
        return []
      })
    return { ...run, replaced, replaceFailed }
  },
  revertMusic: (_outcome, fix) => window.api.setMusicField(fix.id, fix.field, fix.to, fix.from),
}
```

(`MusicFixProgress` se usa en el tipo `ReviewSource.onProgress`.)

- [ ] **Step 5: El hook usa la fuente**

En `hooks/useMusicReview.ts`:
- Importar `musicSource`, `ReviewRemoval`, `ReviewRemovalRun`, `ReviewSource` de `../lib/reviewSource`; `ReviewEntry`, `ReviewFix`, `ReviewOutcome` de shared. Quitar `FAILED_REMOVAL`, `MusicFieldFix`, `MusicFixOutcome`, `MusicReviewEntry`, `RemoveCopyResult` si quedan sin uso.
- `DuplicateCard.entries: ReviewEntry[]`; `ReviewRun.outcomes: ReviewOutcome[]`; `affected: (key: string) => (ReviewFix & { title: string })[]`.
- `toItem = (e: ReviewEntry) => ({ id: e.id, artist: e.artist, title: e.title, durationSec: e.durationSec })`; `labelOf(e: ReviewEntry)`; `pendingCount(entries: ReviewEntry[], …)`; `joined` usa `v.ids`.
- Firma: `useMusicReview({ source = musicSource, initialFilter, ignored, saveIgnored, onFilesChanged }: { source?: ReviewSource; … })`.
- `load`: `const { entries: next } = await source.load()`; deps `[source]`.
- Efecto de ubicaciones: `missing.map((id) => source.locate(id))`; añadir `source` a sus deps.
- `byPid` → `byId = new Map(entries.map((e) => [e.id, e]))` y sus usos.
- `removals` devuelve `ReviewRemoval`: `{ removeId, keepId, label: labelOf(removed), keepLabel: labelOf(keep) }`, con `keepId = choice(g.key) as string`.
- `fixes`: `removing = new Set(removals.map((r) => r.removeId))`, filtro por `e.id`. `affected`: título por `byId.get(fix.id)`.
- `apply`, cambiando solo el tramo entre la escritura y `librarySync`:

```ts
    const writes = new Set(fixes.map((f) => f.id)).size
    // ... setProgress / setPhase iniciales igual que hoy ...
    const off = source.onProgress((p) => {
      setProgress({ done: p.done, total })
      setPhase({ name: 'writing', current: p.current, total: p.total })
    })
    try {
      let outcomes: ReviewOutcome[] = []
      let applyError: string | undefined
      if (fixes.length)
        try {
          outcomes = await source.applyFixes(fixes)
        } catch (error) {
          applyError = error instanceof Error ? error.message : String(error)
        }
      let librariesPhase = false
      let removal: ReviewRemovalRun = {
        removed: [],
        replaced: [],
        librariesUntouched: false,
        replaceFailed: false,
      }
      if (applyError === undefined && removals.length)
        removal = await source.removeCopies(removals, {
          isCancelled: () => cancelled.current,
          onStep: (current) => setPhase({ name: 'duplicates', current, total: removals.length }),
          onDone: (done) => setProgress({ done: writes + done, total }),
          onLibraries: () => {
            librariesPhase = true
            setPhase({ name: 'libraries' })
          },
        })
      const { removed, replaced } = removal
      const updates = tagUpdatesOf(outcomes, 'apply')
      if (updates.length && !librariesPhase) setPhase({ name: 'libraries' })
      let librarySync: ReviewRun['librarySync'] = removal.replaceFailed ? 'failed' : 'none'
      // ... syncLibraryTags, onFilesChanged, verifying, load igual que hoy ...
      setLastRun({
        outcomes,
        removed,
        replaced,
        ...(removal.librariesUntouched ? { librariesUntouched: true } : {}),
        // ... resto igual ...
      })
```

  Deps de `apply`: añadir `source`.
- `cancel`: `source.cancel()`; deps `[source]`.
- `undo`: el bucle de Music pasa a `await source.revertMusic(o, f).catch(() => { ok = false })` con la misma condición `o.music[i] === 'set'`; deps añaden `source`.

Mapeo del orden de fases con el código de hoy, para el revisor: `onLibraries` se llama justo donde hoy se ponía `libraries` antes de `replaceDuplicatesInLibraries`; si solo hay etiquetas, el hook la pone antes de `syncLibraryTags`. Mismo resultado visible.

- [ ] **Step 6: Vista**

`components/MusicReview.tsx:335`: `v.persistentIds` → `v.ids`.
`components/MusicReviewDetail.tsx`: tipo `MusicReviewEntry` → `ReviewEntry`; `persistentIds` → `ids`; `persistentId` → `id` (entradas y filas de `affected`). Ejecutar:

```bash
cd apps/desktop
perl -pi -e 's/\bMusicReviewEntry\b/ReviewEntry/g; s/\bpersistentIds\b/ids/g; s/\bpersistentId\b/id/g' src/renderer/src/components/MusicReviewDetail.tsx
```

- [ ] **Step 7: Renombrados mecánicos en los tests**

```bash
cd apps/desktop
perl -pi -e 's/\bMusicReviewEntry\b/ReviewEntry/g; s/\bMusicFieldFix\b/ReviewFix/g; s/\bpersistentIds\b/ids/g; s/\bpersistentId\b/id/g' \
  src/renderer/src/lib/musicSpelling.test.ts src/renderer/src/lib/musicFixPlan.test.ts src/renderer/src/components/MusicReview.test.tsx
```

En `hooks/useMusicReview.test.tsx` cambiar a mano solo las expectativas sobre la salida del hook, nunca los fixtures de `window.api` ni los `toHaveBeenCalledWith` de `window.api`:
- las dos `lastRun?.outcomes.map((o) => o.persistentId)` → `o.id`;
- en el test de `affected`: `{ persistentId: 'C', title: 'TC', …}` (dos líneas) → `{ id: 'C', … }` y `.map((f) => f.persistentId)` → `f.id`;
- en "merges both fields into one group": `persistentIds:` (dos líneas) → `ids:`.

Comprobación: `git diff -U0 src/renderer/src/hooks/useMusicReview.test.tsx | grep '^[-+] ' ` muestra solo esas líneas y el test nuevo.

- [ ] **Step 8: Ver que pasa todo**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib src/renderer/src/hooks/useMusicReview.test.tsx src/renderer/src/components/MusicReview.test.tsx src/renderer/src/App.test.tsx` y el typecheck.
Expected: PASS. `App.test.tsx` sin tocar.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/renderer/src/lib apps/desktop/src/renderer/src/hooks/useMusicReview.ts apps/desktop/src/renderer/src/hooks/useMusicReview.test.tsx apps/desktop/src/renderer/src/components/MusicReview.tsx apps/desktop/src/renderer/src/components/MusicReviewDetail.tsx apps/desktop/src/renderer/src/components/MusicReview.test.tsx
git commit -m "Run the metadata review through a source so it is not tied to Apple Music"
```

---

### Task 2: Agrupar 5000 pistas en menos de medio segundo

Medido: 1,45 s hoy, 0,14 s con la comprobación lineal y los dígitos calculados una vez (spec).

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/musicSpelling.ts` (`distance`, `Cluster`, `isClusterTypo`, `isTypoPair`, `typoGroups`)
- Modify: `apps/desktop/src/renderer/src/hooks/useMusicReview.ts` (memos de `spelling` y `dupGroups`, `pendingCount`)
- Test: `apps/desktop/src/renderer/src/lib/musicSpelling.test.ts`, `apps/desktop/src/renderer/src/hooks/useMusicReview.cost.test.tsx` (nuevo)

**Interfaces:**
- Consumes: `ReviewEntry`, `ReviewSource` (Task 1).
- Produces: `export function withinOneEdit(a: string, b: string): boolean` en `musicSpelling.ts`; `distance` desaparece.

- [ ] **Step 1: Escribir los tests que fallan**

Al final de `musicSpelling.test.ts` (importar `withinOneEdit`):

```ts
describe('cost', () => {
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const SYL = ['ka', 'lo', 'mi', 'ra', 'sen', 'tor', 'vel', 'dan', 'ri', 'us', 'mar', 'tin', 'el', 'go', 'ber']
  const word = (n: number) => {
    let s = ''
    for (let i = 0; i < n; i++) s += SYL[Math.floor(rnd() * SYL.length)]
    return s[0].toUpperCase() + s.slice(1)
  }

  // A crate dragged in from a NAS reaches thousands of tracks; the review opens on the
  // list's own thread, so grouping has to stay well under a second. Measured 1.45 s before.
  it('groups 5000 tracks with 2000 distinct artists in under half a second', () => {
    const artists = Array.from({ length: 2000 }, () => `${word(2)} ${word(2)}`)
    const entries: ReviewEntry[] = Array.from({ length: 5000 }, (_, i) => {
      const artist = artists[Math.floor(rnd() * artists.length)]
      return {
        id: `/music/${i}.mp3`,
        title: `${word(3)} ${word(2)}`,
        artist,
        albumArtist: rnd() < 0.5 ? artist : '',
        album: word(3),
        genre: ['House', 'Techno', 'Trance', 'Hard House', 'Electronic'][i % 5],
        durationSec: 200 + Math.floor(rnd() * 300),
      }
    })
    spellingGroups(entries)
    const start = performance.now()
    spellingGroups(entries)
    expect(performance.now() - start).toBeLessThan(500)
  })

  // The fast check must be the same rule, not a cousin of it: a looser one invents typo
  // groups between different artists, a stricter one hides real typos.
  it('answers one edit exactly like the full distance does', () => {
    const osa = (a: string, b: string): number => {
      const d: number[][] = []
      for (let i = 0; i <= a.length; i++) {
        d.push([i])
        for (let j = 1; j <= b.length; j++) {
          if (i === 0) {
            d[0].push(j)
            continue
          }
          let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2][j - 2] + 1)
          d[i].push(best)
        }
      }
      return d[a.length][b.length]
    }
    const pick = (n: number) => Array.from({ length: n }, () => 'ab1c'[Math.floor(rnd() * 4)]).join('')
    for (let k = 0; k < 20000; k++) {
      const a = pick(Math.floor(rnd() * 7))
      const b = rnd() < 0.5 ? pick(Math.floor(rnd() * 7)) : a.slice(0, 2) + pick(1) + a.slice(3)
      expect(withinOneEdit(a, b), `${a} / ${b}`).toBe(osa(a, b) <= 1)
    }
  })
})
```

`hooks/useMusicReview.cost.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as spelling from '../lib/musicSpelling'
import type { ReviewSource } from '../lib/reviewSource'
import { useMusicReview } from './useMusicReview'

vi.mock('../lib/musicSpelling', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/musicSpelling')>()
  return { ...actual, spellingGroups: vi.fn(actual.spellingGroups) }
})

const entry = (id: string, artist: string) => ({ id, title: id, artist, albumArtist: '', album: '', genre: '' })

describe('useMusicReview cost', () => {
  // Ignoring is one click per group on a list of thousands; regrouping everything on each
  // click was the cost the user would feel most.
  it('does not regroup the whole list when a group is ignored', async () => {
    ;(window as unknown as { api: unknown }).api = { libraryStatus: vi.fn().mockResolvedValue(null) }
    const source = {
      kind: 'list',
      load: vi.fn().mockResolvedValue({
        entries: [entry('/a', 'DJ Lara'), entry('/b', 'DJ Lara'), entry('/c', 'Dj Lara'), entry('/d', 'Kim  Lee'), entry('/e', 'Kim Lee')],
        skipped: 0,
      }),
      locate: async (id: string) => id,
    } as unknown as ReviewSource
    const { result } = renderHook(() =>
      useMusicReview({ source, initialFilter: 'all', ignored: [], saveIgnored: vi.fn(), onFilesChanged: vi.fn() }),
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const calls = vi.mocked(spelling.spellingGroups).mock.calls.length
    act(() => result.current.ignore(result.current.spelling[0].key))
    expect(result.current.spelling).toHaveLength(1)
    expect(vi.mocked(spelling.spellingGroups).mock.calls.length).toBe(calls)
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/musicSpelling.test.ts src/renderer/src/hooks/useMusicReview.cost.test.tsx`
Expected: FAIL; `withinOneEdit is not a function`, el tiempo por encima de 500 ms y la cuenta de llamadas sube en uno.

- [ ] **Step 3: Implementar**

En `musicSpelling.ts`, borrar `distance` y añadir:

```ts
// The typo rule only ever asks "one edit or none" (Damerau, so swapping two neighbours is
// one). Answering that in one pass instead of filling the whole table took grouping 5000
// tracks from 1.45 s to a tenth of that.
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (la === lb)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    )
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

const digitsOf = (key: string) => key.replace(/\D/g, '')
```

`Cluster` gana los dígitos, calculados una vez por nombre en lugar de una vez por par:

```ts
interface Cluster {
  key: string
  bare: string | null
  keyDigits: string
  bareDigits: string | null
}

function isClusterTypo(a: Cluster, b: Cluster): boolean {
  return a.bare !== null && b.bare !== null
    ? isTypoPair(a.bare, b.bare, a.bareDigits as string, b.bareDigits as string)
    : isTypoPair(a.key, b.key, a.keyDigits, b.keyDigits)
}

function isTypoPair(a: string, b: string, aDigits: string, bDigits: string): boolean {
  if (Math.min(a.length, b.length) < MIN_TYPO_LENGTH) return false
  if (aDigits !== bDigits) return false
  return withinOneEdit(a, b)
}
```

En `typoGroups`, el mapa `info`:

```ts
  const info = new Map<string, Cluster>(
    keys.map((k) => {
      const bare = bareKey((reps.get(k) as SpellingVariant).value)
      return [k, { key: k, bare, keyDigits: digitsOf(k), bareDigits: bare === null ? null : digitsOf(bare) }]
    }),
  )
```

En `useMusicReview.ts`, separar agrupar de filtrar:

```ts
const allSpelling = useMemo(() => spellingGroups(entries), [entries])
const allDuplicates = useMemo(() => uniqueKeys(duplicateGroups(entries.map(toItem))), [entries])
const spelling = useMemo(
  () => mergeSpelling(allSpelling.filter((g) => !hidden.has(g.key))),
  [allSpelling, hidden],
)
const dupGroups = useMemo(
  () => allDuplicates.filter((g) => !hidden.has(g.key)),
  [allDuplicates, hidden],
)
```

y `pendingCount` recibe los grupos ya hechos:

```ts
function pendingCount(
  spelling: SpellingGroup[],
  duplicates: DuplicateGroup[],
  ignored: ReadonlySet<string>,
): number {
  return (
    mergeSpelling(spelling.filter((g) => !ignored.has(g.key))).length +
    duplicates.filter((g) => g.kind === 'duplicate' && !ignored.has(g.key)).length
  )
}
const groupsOf = (entries: ReviewEntry[]) =>
  [spellingGroups(entries), uniqueKeys(duplicateGroups(entries.map(toItem)))] as const
```

`before = pendingCount(allSpelling, allDuplicates, hidden)`; `after: next ? pendingCount(...groupsOf(next), hidden) : null`. Deps de `apply`: `allSpelling`, `allDuplicates` en lugar de `entries` donde ya no se use.

- [ ] **Step 4: Ver que pasan y mutación**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/musicSpelling.test.ts src/renderer/src/hooks` y el typecheck.
Expected: PASS. Mutación: cambiar `a[i] === b[i + 1]` por `a[i] === b[i]` en `withinOneEdit`, ver rojo el test de equivalencia, deshacer.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/musicSpelling.ts apps/desktop/src/renderer/src/lib/musicSpelling.test.ts apps/desktop/src/renderer/src/hooks/useMusicReview.ts apps/desktop/src/renderer/src/hooks/useMusicReview.cost.test.tsx
git commit -m "Group a review of thousands of tracks in a tenth of the time"
```

---

### Task 3: Las entradas de la lista salen de lo que hay en el disco

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/listReviewEntries.ts`
- Test: `apps/desktop/src/renderer/src/lib/listReviewEntries.test.ts`

**Interfaces:**
- Consumes: `ReviewEntry` (Task 1), `ReviewLoad` (Task 1), `TrackItem` (`renderer/src/types.ts`), `trackSignature` (`lib/dirty.ts`).
- Produces:
  - `listReviewEntries(rows: TrackItem[]): ReviewLoad` (id = `inputPath`)
  - `withListChanges(entries: ReviewEntry[], updates: LibraryTagUpdate[], gone: ReadonlySet<string>): ReviewEntry[]`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { listReviewEntries, withListChanges } from './listReviewEntries'

function row(path: string, artist: string, over: Partial<TrackItem> = {}): TrackItem {
  const meta = { ...emptyMetadata(), title: 'Song', artist }
  return {
    id: path,
    inputPath: path,
    fileName: path,
    listLabel: 'Song',
    query: '',
    status: 'idle',
    meta,
    duration: 351.4,
    diskSignature: trackSignature({ meta }),
    ...over,
  }
}

describe('listReviewEntries', () => {
  it('reads each loaded row by its path, with the length in whole seconds', () => {
    expect(listReviewEntries([row('/m/a.aiff', 'DJ Ter')])).toEqual({
      entries: [
        { id: '/m/a.aiff', title: 'Song', artist: 'DJ Ter', albumArtist: '', album: '', genre: '', durationSec: 351 },
      ],
      skipped: 0,
    })
  })

  // The review writes over the file, so it has to look at the file: an artist typed in
  // the editor and not saved yet is the user's pending work, not what is on disk.
  it('reads what is on disk, not an edit waiting in the editor', () => {
    const r = row('/m/a.aiff', 'Dj Lara')
    const edited = { ...r, meta: { ...r.meta, artist: 'Someone Else' } }
    expect(listReviewEntries([edited]).entries[0].artist).toBe('Dj Lara')
  })

  // A row still reading, or one whose read failed, holds a file-name parse: grouping it
  // would offer to "fix" values the file never had.
  it('leaves out rows not read, failed or converting, and counts them', () => {
    const out = listReviewEntries([
      row('/m/a.aiff', 'A'),
      row('/m/b.aiff', 'B', { loadingMeta: true }),
      row('/m/c.aiff', 'C', { metaReadFailed: true }),
      row('/m/d.aiff', 'D', { diskSignature: undefined }),
      row('/m/e.aiff', 'E', { status: 'processing' }),
    ])
    expect(out.entries.map((e) => e.id)).toEqual(['/m/a.aiff'])
    expect(out.skipped).toBe(4)
  })

  it('has no length for a row whose probe found none', () => {
    expect(listReviewEntries([row('/m/a.aiff', 'A', { duration: undefined })]).entries[0]).not.toHaveProperty('durationSec')
  })
})

describe('withListChanges', () => {
  // The list commits its own patch a render later; a recount in between must not show the
  // old spelling as still to fix, and a value the rows already carry stays as it is.
  it('applies what the review wrote and drops what it trashed', () => {
    const { entries } = listReviewEntries([row('/m/a.aiff', 'Dj Lara'), row('/m/b.aiff', 'DJ Lara')])
    const out = withListChanges(
      entries,
      [{ path: '/m/a.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } }],
      new Set(['/m/b.aiff']),
    )
    expect(out.map((e) => [e.id, e.artist])).toEqual([['/m/a.aiff', 'DJ Lara']])
    expect(withListChanges(out, [{ path: '/m/a.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } }], new Set())).toEqual(out)
  })

  it('replays an undo after the apply, in order', () => {
    const { entries } = listReviewEntries([row('/m/a.aiff', 'Dj Lara')])
    const out = withListChanges(
      entries,
      [
        { path: '/m/a.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
        { path: '/m/a.aiff', fields: { artist: { from: 'DJ Lara', to: 'Dj Lara' } } },
      ],
      new Set(),
    )
    expect(out[0].artist).toBe('Dj Lara')
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/listReviewEntries.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
import type { LibraryTagUpdate, ReviewEntry, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import type { ReviewLoad } from './reviewSource'

const FIELDS = ['title', 'artist', 'albumArtist', 'album', 'genre'] as const

// diskSignature holds the pure read of the file; meta also carries what the user typed and
// has not saved. The review writes over the file, so it reads the file's side.
function diskMeta(row: TrackItem): TrackMetadata | null {
  if (!row.diskSignature) return null
  try {
    const [meta] = JSON.parse(row.diskSignature) as [TrackMetadata]
    return meta && typeof meta === 'object' ? meta : null
  } catch {
    return null
  }
}

export function listReviewEntries(rows: TrackItem[]): ReviewLoad {
  const entries: ReviewEntry[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const row of rows) {
    if (seen.has(row.inputPath)) continue
    seen.add(row.inputPath)
    const meta =
      row.loadingMeta || row.metaReadFailed || row.status === 'processing' ? null : diskMeta(row)
    if (!meta) {
      skipped += 1
      continue
    }
    const entry: ReviewEntry = {
      id: row.inputPath,
      title: meta.title ?? '',
      artist: meta.artist ?? '',
      albumArtist: meta.albumArtist ?? '',
      album: meta.album ?? '',
      genre: meta.genre ?? '',
    }
    if (row.duration !== undefined && row.duration > 0) entry.durationSec = Math.round(row.duration)
    entries.push(entry)
  }
  return { entries, skipped }
}

export function withListChanges(
  entries: ReviewEntry[],
  updates: LibraryTagUpdate[],
  gone: ReadonlySet<string>,
): ReviewEntry[] {
  const byPath = new Map<string, LibraryTagUpdate[]>()
  for (const u of updates) byPath.set(u.path, [...(byPath.get(u.path) ?? []), u])
  return entries
    .filter((e) => !gone.has(e.id))
    .map((e) => {
      let next = e
      for (const u of byPath.get(e.id) ?? [])
        for (const field of FIELDS) {
          const change = u.fields[field]
          if (change && next[field].normalize('NFC') === change.from.normalize('NFC'))
            next = { ...next, [field]: change.to }
        }
      return next
    })
}
```

- [ ] **Step 4: Ver que pasan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/listReviewEntries.test.ts` y el typecheck.
Expected: PASS. Mutación: leer `row.meta` en lugar de `diskMeta(row)`, ver rojo "reads what is on disk", deshacer.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/listReviewEntries.ts apps/desktop/src/renderer/src/lib/listReviewEntries.test.ts
git commit -m "Build review entries from what each loaded track's file holds"
```

---

### Task 4: Saber qué ficheros de la lista están en Apple Music

Un solo `osascript` lee persistent ID, ubicación, artista y nombre de cada pista con fichero, y se cruza con las rutas por igualdad exacta en NFC. Solo macOS, y Music no se abre si no estaba abierta salvo que el renderer lo pida.

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (junto a `ReviewOutcome`)
- Modify: `apps/desktop/src/main/applemusic.ts` (tras `dumpMusicReview`)
- Modify: `apps/desktop/src/main/appleMusicIpc.ts` (dentro de `registerAppleMusicIpc`, tras `applemusic:reviewDump`)
- Modify: `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/test/api.ts`
- Test: `apps/desktop/src/main/applemusic.test.ts`

**Interfaces:**
- Produces:

```ts
// shared/types.ts
export interface MusicFileEntry {
  persistentId: string
  // "artist - name" exactly as Music holds it: what the delete and transfer scripts check.
  label: string
}
export interface MusicFileLookup {
  consulted: boolean
  entries: Record<string, MusicFileEntry[]>
}
```

  - `buildMusicRunningScript(): string`, `buildFileEntriesScript(): string`, `parseFileEntries(stdout: string): { persistentId: string; path: string; label: string }[]`, `entriesForPaths(rows, paths: string[]): Record<string, MusicFileEntry[]>`, `musicFileEntries(paths: string[], launch: boolean, run?: typeof runOsascript): Promise<MusicFileLookup>`
  - IPC `applemusic:fileEntries(paths, launch)`; preload `appleMusicFileEntries(paths: string[], launch: boolean): Promise<MusicFileLookup>`

- [ ] **Step 1: Escribir los tests que fallan**

En `applemusic.test.ts` (importar las cinco funciones):

```ts
describe('Music entries for loaded files', () => {
  const RS = '\u001e'
  const FS = '\u001f'
  const row = (...f: string[]) => f.join(FS)

  it('reads each file track with its location and the label the scripts check', () => {
    expect(
      parseFileEntries(
        [
          row('6E592CFE07A6246A', '/Volumes/Public/Musica/This Rap.aiff', 'DJ Ter', 'This Rap'),
          row('5FA52DD35E307CBB', '', 'Gone', 'Missing file'),
        ].join(RS),
      ),
    ).toEqual([
      { persistentId: '6E592CFE07A6246A', path: '/Volumes/Public/Musica/This Rap.aiff', label: 'DJ Ter - This Rap' },
    ])
  })

  // The NAS stores names decomposed while Surco works composed (entryForFile), and a file
  // Music holds twice must come back as two entries so the review can refuse to guess.
  it('matches a loaded path composed and keeps every entry on the same file', () => {
    const nfd = '/m/Café.aiff'
    const rows = [
      { persistentId: 'A', path: nfd, label: 'X - Café' },
      { persistentId: 'B', path: nfd, label: 'X - Café' },
      { persistentId: 'C', path: '/m/other.aiff', label: 'Y - Z' },
    ]
    expect(entriesForPaths(rows, ['/m/Café.aiff', '/m/none.aiff'])).toEqual({
      '/m/Café.aiff': [
        { persistentId: 'A', label: 'X - Café' },
        { persistentId: 'B', label: 'X - Café' },
      ],
    })
  })

  // A user who never uses Music would see it launch just because they reviewed a folder.
  it('does not open Music to ask unless told to', async () => {
    const run = vi.fn().mockResolvedValue('false\n')
    expect(await musicFileEntries(['/m/a.aiff'], false, run)).toEqual({ consulted: false, entries: {} })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toBe(buildMusicRunningScript())
  })

  it('asks an open Music, or any Music when told to', async () => {
    const dump = row('6E592CFE07A6246A', '/m/a.aiff', 'A', 'T')
    const running = vi.fn().mockResolvedValueOnce('true\n').mockResolvedValueOnce(dump)
    expect((await musicFileEntries(['/m/a.aiff'], false, running)).consulted).toBe(true)
    const launch = vi.fn().mockResolvedValue(dump)
    expect(await musicFileEntries(['/m/a.aiff'], true, launch)).toEqual({
      consulted: true,
      entries: { '/m/a.aiff': [{ persistentId: '6E592CFE07A6246A', label: 'A - T' }] },
    })
    expect(launch).toHaveBeenCalledTimes(1)
  })

  // POSIX path is a system coercion: inside the tell block it yields "" for every track
  // (appleMusicPlaylists.ts), so the locations must leave it first.
  it('reads locations in bulk and coerces them outside the tell block', () => {
    const script = buildFileEntriesScript()
    expect(script).toContain('location of every file track of library playlist 1')
    expect(script).toContain('if (count of file tracks of library playlist 1) is 0 then return ""')
    expect(script.indexOf('POSIX path of loc')).toBeGreaterThan(script.indexOf('end tell'))
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/applemusic.test.ts`
Expected: FAIL, imports inexistentes.

- [ ] **Step 3: Implementar**

`shared/types.ts`: los dos tipos de **Interfaces**.

`main/applemusic.ts`, tras `dumpMusicReview` (reutiliza `REVIEW_RS` y `REVIEW_FS`):

```ts
// Referring to the application outside a tell block does not launch it.
export function buildMusicRunningScript(): string {
  return 'return application "Music" is running'
}

// Four bulk fetches, as the playlist import does (measured 1.39 s for 400 tracks there),
// instead of one lookup per loaded file.
export function buildFileEntriesScript(): string {
  const of = (prop: string) => `${prop} of every file track of library playlist 1`
  return [
    'tell application "Music"',
    '  if (count of file tracks of library playlist 1) is 0 then return ""',
    `  set thePids to ${of('persistent ID')}`,
    `  set theLocs to ${of('location')}`,
    `  set theArtists to ${of('artist')}`,
    `  set theNames to ${of('name')}`,
    'end tell',
    'set RS to ASCII character 30',
    'set FS to ASCII character 31',
    'set out to {}',
    'repeat with i from 1 to count of thePids',
    '  set loc to item i of theLocs',
    '  set p to ""',
    '  if loc is not missing value then',
    '    try',
    '      set p to POSIX path of loc',
    '    end try',
    '  end if',
    '  set end of out to (item i of thePids) & FS & p & FS & (item i of theArtists) & FS & (item i of theNames)',
    'end repeat',
    "set AppleScript's text item delimiters to RS",
    'return out as text',
  ].join('\n')
}

export function parseFileEntries(
  stdout: string,
): { persistentId: string; path: string; label: string }[] {
  const rows: { persistentId: string; path: string; label: string }[] = []
  const body = stdout.replace(/\n$/, '')
  if (!body) return rows
  for (const line of body.split(REVIEW_RS)) {
    const fields = line.split(REVIEW_FS)
    if (fields.length !== 4) continue
    const [persistentId, path, artist, name] = fields
    if (!/^[0-9A-F]{16}$/.test(persistentId) || !path) continue
    rows.push({ persistentId, path, label: `${artist} - ${name}` })
  }
  return rows
}

export function entriesForPaths(
  rows: { persistentId: string; path: string; label: string }[],
  paths: string[],
): Record<string, MusicFileEntry[]> {
  const byPath = new Map<string, MusicFileEntry[]>()
  for (const r of rows) {
    const key = r.path.normalize('NFC')
    byPath.set(key, [...(byPath.get(key) ?? []), { persistentId: r.persistentId, label: r.label }])
  }
  const out: Record<string, MusicFileEntry[]> = {}
  for (const path of paths) {
    const found = byPath.get(path.normalize('NFC'))
    if (found) out[path] = found
  }
  return out
}

export async function musicFileEntries(
  paths: string[],
  launch: boolean,
  run: typeof runOsascript = runOsascript,
): Promise<MusicFileLookup> {
  if (!launch && (await run(buildMusicRunningScript())).trim() !== 'true')
    return { consulted: false, entries: {} }
  const stdout = await run(buildFileEntriesScript(), { maxBuffer: 64 * 1024 * 1024 })
  return { consulted: true, entries: entriesForPaths(parseFileEntries(stdout), paths) }
}
```

`main/appleMusicIpc.ts`, tras `applemusic:reviewDump`:

```ts
  ipcMain.handle('applemusic:fileEntries', (_e, paths: string[], launch: boolean) =>
    process.platform === 'darwin'
      ? appleMusicLimiter.run(() => musicFileEntries(paths, launch))
      : { consulted: false, entries: {} },
  )
```

`preload/api.ts`: `appleMusicFileEntries: (paths: string[], launch: boolean) => Promise<MusicFileLookup>` con un comentario "Which loaded files Music holds. Not consulted off macOS, or when Music is closed and launch is false."; `preload/index.ts`: `appleMusicFileEntries: (paths, launch) => ipcRenderer.invoke('applemusic:fileEntries', paths, launch),`; `test/api.ts`: `appleMusicFileEntries: async () => ({ consulted: false, entries: {} }),`.

- [ ] **Step 4: Ver que pasan**

Run: `cd apps/desktop && npm test -- src/main/applemusic.test.ts` y el typecheck.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/applemusic.ts apps/desktop/src/main/applemusic.test.ts apps/desktop/src/main/appleMusicIpc.ts apps/desktop/src/preload apps/desktop/src/renderer/src/test/api.ts
git commit -m "Find which loaded files Apple Music holds in one read of the library"
```

---

### Task 5: Escribir una grafía en el fichero y después en Music

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`
- Create: `apps/desktop/src/main/listReviewApply.ts`, `apps/desktop/src/main/listReviewIpc.ts`
- Modify: `apps/desktop/src/main/index.ts` (llamar a `registerListReviewIpc` justo después del handler `library:replaceDuplicates`, ~línea 1160)
- Modify: `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/test/api.ts`
- Test: `apps/desktop/src/main/listReviewApply.test.ts`, `apps/desktop/src/main/listReviewIpc.test.ts`

**Interfaces:**
- Consumes: `ReviewFix`, `ReviewOutcome` (Task 1), `rewriteTagFields` (`musicFieldWrite.ts`), `setAppleMusicField`, `appleMusicLimiter` (`applemusic.ts`).
- Produces:

```ts
// shared/types.ts
export interface ListFixRequest {
  fixes: ReviewFix[]
  // Path → the one Music entry on that file. A path with none or several is left out.
  music: Record<string, string>
}

// main/listReviewApply.ts
export interface ListApplyDeps {
  allowed: (path: string) => boolean
  exists: (path: string) => Promise<boolean>
  rewrite: (file: string, changes: TagFieldChange[]) => Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }>
  // Undefined off macOS.
  setMusicField?: (persistentId: string, field: MusicReviewField, from: string, to: string) => Promise<MusicSetResult>
}
export function applyListFixes(req: ListFixRequest, deps: ListApplyDeps, hooks?: { isCancelled?: () => boolean; onProgress?: (p: MusicFixProgress) => void }): Promise<ReviewOutcome[]>

// main/listReviewIpc.ts
export interface ListReviewIpcDeps { apply: ListApplyDeps }
export function registerListReviewIpc(deps: ListReviewIpcDeps): void
```

  - IPC `listreview:applyFixes`, `listreview:cancelFixes`, evento `listreview:fixProgress`.
  - Preload: `applyListFixes(req: ListFixRequest): Promise<ReviewOutcome[]>`, `cancelListFixes(): Promise<void>`, `onListFixProgress(cb: (p: MusicFixProgress) => void): () => void`.

- [ ] **Step 1: Escribir los tests que fallan**

`main/listReviewApply.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ReviewFix } from '../shared/types'
import { type ListApplyDeps, applyListFixes } from './listReviewApply'

const fix = (id: string, field: ReviewFix['field'] = 'artist'): ReviewFix => ({
  id,
  field,
  from: 'Dj Lara',
  to: 'DJ Lara',
})

function deps(over: Partial<ListApplyDeps> = {}): ListApplyDeps {
  return {
    allowed: () => true,
    exists: vi.fn().mockResolvedValue(true),
    rewrite: vi.fn().mockResolvedValue({ outcomes: ['written'], backup: { id: 'b1' } }),
    setMusicField: vi.fn().mockResolvedValue('set'),
    ...over,
  }
}

describe('applyListFixes', () => {
  it('writes the file, then the Music entry on it, and keeps the backup for undo', async () => {
    const calls: string[] = []
    const d = deps({
      rewrite: vi.fn(async () => {
        calls.push('file')
        return { outcomes: ['written' as const], backup: { id: 'b1' } as never }
      }),
      setMusicField: vi.fn(async () => {
        calls.push('music')
        return 'set' as const
      }),
    })
    const [out] = await applyListFixes({ fixes: [fix('/m/a.aiff')], music: { '/m/a.aiff': 'PID' } }, d)
    expect(calls).toEqual(['file', 'music'])
    expect(out).toEqual({
      id: '/m/a.aiff',
      musicId: 'PID',
      path: '/m/a.aiff',
      fixes: [fix('/m/a.aiff')],
      music: ['set'],
      file: 'written',
      written: ['artist'],
      backupId: 'b1',
    })
    expect(d.setMusicField).toHaveBeenCalledWith('PID', 'artist', 'Dj Lara', 'DJ Lara')
  })

  // The file is the guard: another app retagged it since the list read it, so the review
  // no longer knows the right value and neither the file nor Music is touched.
  it('leaves Music alone for a field the file no longer held', async () => {
    const d = deps({ rewrite: vi.fn().mockResolvedValue({ outcomes: ['unchanged', 'written'] }) })
    const [out] = await applyListFixes(
      { fixes: [fix('/m/a.aiff'), fix('/m/a.aiff', 'genre')], music: { '/m/a.aiff': 'PID' } },
      d,
    )
    expect(out).toMatchObject({ music: ['none', 'set'], file: 'written', written: ['genre'] })
    expect(d.setMusicField).toHaveBeenCalledTimes(1)
  })

  it('reports a file that no longer held anything to change as unchanged', async () => {
    const d = deps({ rewrite: vi.fn().mockResolvedValue({ outcomes: ['unchanged'] }) })
    const [out] = await applyListFixes({ fixes: [fix('/m/a.aiff')], music: {} }, d)
    expect(out).toMatchObject({ file: 'unchanged', written: [], music: ['none'] })
    expect(out).not.toHaveProperty('backupId')
  })

  it('writes the file alone when it is not in Music, or off macOS', async () => {
    const d = deps({ setMusicField: undefined })
    const [out] = await applyListFixes({ fixes: [fix('/m/a.aiff')], music: { '/m/a.aiff': 'PID' } }, d)
    expect(out).toMatchObject({ file: 'written', music: ['none'] })
  })

  it('counts a Music entry that says something else, without failing the file', async () => {
    const d = deps({ setMusicField: vi.fn().mockResolvedValue('mismatch') })
    const [out] = await applyListFixes({ fixes: [fix('/m/a.aiff')], music: { '/m/a.aiff': 'PID' } }, d)
    expect(out).toMatchObject({ file: 'written', music: ['mismatch'] })
  })

  it('reports a missing file and a failed write and carries on', async () => {
    const d = deps({
      exists: vi.fn(async (p: string) => p !== '/m/gone.aiff'),
      rewrite: vi.fn(async (p: string) => {
        if (p === '/m/bad.aiff') throw new Error('locked')
        return { outcomes: ['written' as const] }
      }),
    })
    const out = await applyListFixes(
      { fixes: [fix('/m/gone.aiff'), fix('/m/bad.aiff'), fix('/m/ok.aiff')], music: {} },
      d,
    )
    expect(out.map((o) => o.file)).toEqual(['missing', 'failed', 'written'])
    expect(out[1].error).toBe('locked')
  })

  // A compromised renderer could otherwise rewrite any file the OS user can touch.
  it('refuses a path the app never handed to the renderer', async () => {
    const d = deps({ allowed: (p) => p !== '/etc/hosts' })
    const [out] = await applyListFixes({ fixes: [fix('/etc/hosts')], music: {} }, d)
    expect(out).toMatchObject({ file: 'failed', error: 'pathNotAllowed' })
    expect(d.rewrite).not.toHaveBeenCalled()
  })

  it('writes the fields of one file in one pass and stops at a cancel', async () => {
    let cancelled = false
    const d = deps({
      rewrite: vi.fn(async () => {
        cancelled = true
        return { outcomes: ['written' as const, 'written' as const] }
      }),
    })
    const out = await applyListFixes(
      { fixes: [fix('/m/a.aiff'), fix('/m/a.aiff', 'genre'), fix('/m/b.aiff')], music: {} },
      d,
      { isCancelled: () => cancelled },
    )
    expect(d.rewrite).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(1)
  })

  it('reports each file as it starts and as it finishes', async () => {
    const onProgress = vi.fn()
    await applyListFixes({ fixes: [fix('/m/a.aiff')], music: {} }, deps(), { onProgress })
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 1, current: 1 },
      { done: 1, total: 1, current: 1 },
    ])
  })
})
```

`main/listReviewIpc.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { ipcMain } from 'electron'
import { registerListReviewIpc } from './listReviewIpc'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => unknown {
  const call = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1]
}

const sender = { isDestroyed: () => false, send: vi.fn() }

beforeEach(() => vi.clearAllMocks())

describe('registerListReviewIpc', () => {
  it('sends progress to the window that asked and stops when told to', async () => {
    let release = () => {}
    const rewrite = vi.fn(
      () =>
        new Promise<{ outcomes: 'written'[] }>((resolve) => {
          release = () => resolve({ outcomes: ['written'] })
        }),
    )
    registerListReviewIpc({ apply: { allowed: () => true, exists: async () => true, rewrite } } as never)
    const fix = (id: string) => ({ id, field: 'artist', from: 'a', to: 'b' })
    const running = handlerFor('listreview:applyFixes')({ sender }, { fixes: [fix('/a'), fix('/b')], music: {} })
    await vi.waitFor(() => expect(rewrite).toHaveBeenCalledTimes(1))
    await handlerFor('listreview:cancelFixes')({})
    release()
    expect(await running).toHaveLength(1)
    expect(sender.send).toHaveBeenCalledWith('listreview:fixProgress', { done: 0, total: 2, current: 1 })
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/listReviewApply.test.ts src/main/listReviewIpc.test.ts`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: Implementar**

`shared/types.ts`: `ListFixRequest`.

`main/listReviewApply.ts`:

```ts
import type {
  ListFixRequest,
  MusicFieldOutcome,
  MusicFixProgress,
  MusicReviewField,
  ReviewFix,
  ReviewOutcome,
  TrashEntry,
} from '../shared/types'
import type { MusicSetResult } from './applemusic'
import type { FieldWrite, TagFieldChange } from './tagFieldSet'

export interface ListApplyDeps {
  allowed: (path: string) => boolean
  exists: (path: string) => Promise<boolean>
  rewrite: (
    file: string,
    changes: TagFieldChange[],
  ) => Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }>
  setMusicField?: (
    persistentId: string,
    field: MusicReviewField,
    from: string,
    to: string,
  ) => Promise<MusicSetResult>
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// The file is the guard here, the reverse of the Music review: a field reaches Music only
// once it reached the file, and Music is asked with the value the file held, so an entry
// that says something else is left as it is.
async function applyFile(
  path: string,
  fixes: ReviewFix[],
  musicId: string | undefined,
  deps: ListApplyDeps,
): Promise<ReviewOutcome> {
  const base = { id: path, path, fixes, ...(musicId ? { musicId } : {}) }
  const none = fixes.map(() => 'none' as const)
  if (!deps.allowed(path))
    return { ...base, music: none, file: 'failed', written: [], error: 'pathNotAllowed' }
  if (!(await deps.exists(path))) return { ...base, music: none, file: 'missing', written: [] }
  let result: { outcomes: FieldWrite[]; backup?: TrashEntry }
  try {
    result = await deps.rewrite(
      path,
      fixes.map(({ field, from, to }) => ({ field, from, to })),
    )
  } catch (e) {
    return { ...base, music: none, file: 'failed', written: [], error: message(e) }
  }
  const music: (MusicFieldOutcome | 'none')[] = []
  for (const [i, f] of fixes.entries())
    music.push(
      musicId && deps.setMusicField && result.outcomes[i] === 'written'
        ? await deps.setMusicField(musicId, f.field, f.from, f.to).catch(() => 'failed' as const)
        : 'none',
    )
  const written = fixes.filter((_, i) => result.outcomes[i] === 'written').map((f) => f.field)
  return {
    ...base,
    music,
    file: written.length ? 'written' : 'unchanged',
    written,
    ...(result.backup ? { backupId: result.backup.id } : {}),
  }
}

export async function applyListFixes(
  { fixes, music }: ListFixRequest,
  deps: ListApplyDeps,
  {
    isCancelled = () => false,
    onProgress,
  }: { isCancelled?: () => boolean; onProgress?: (p: MusicFixProgress) => void } = {},
): Promise<ReviewOutcome[]> {
  const byFile = new Map<string, ReviewFix[]>()
  for (const f of fixes) byFile.set(f.id, [...(byFile.get(f.id) ?? []), f])
  const outcomes: ReviewOutcome[] = []
  // Progress is a courtesy: a dead window must not lose the outcomes of files already written.
  const report = (current: number) => {
    try {
      onProgress?.({ done: outcomes.length, total: byFile.size, current })
    } catch {}
  }
  for (const [path, fileFixes] of byFile) {
    if (isCancelled()) break
    report(outcomes.length + 1)
    outcomes.push(await applyFile(path, fileFixes, music[path], deps))
    report(outcomes.length)
  }
  return outcomes
}
```

`main/listReviewIpc.ts`:

```ts
import { ipcMain } from 'electron'
import type { ListFixRequest } from '../shared/types'
import { type ListApplyDeps, applyListFixes } from './listReviewApply'

export interface ListReviewIpcDeps {
  apply: ListApplyDeps
}

// The list review's writes. Not limited to macOS: the list exists everywhere, and only the
// Music half of each step is left out where there is no Music.
export function registerListReviewIpc(deps: ListReviewIpcDeps): void {
  let cancelled = false
  ipcMain.handle('listreview:applyFixes', (e, req: ListFixRequest) => {
    cancelled = false
    return applyListFixes(req, deps.apply, {
      isCancelled: () => cancelled,
      onProgress: (progress) => {
        if (!e.sender.isDestroyed()) e.sender.send('listreview:fixProgress', progress)
      },
    })
  })
  ipcMain.handle('listreview:cancelFixes', () => {
    cancelled = true
  })
}
```

`main/index.ts`, tras el handler `library:replaceDuplicates` (importar `registerListReviewIpc`, `rewriteTagFields`, `setAppleMusicField`, `appleMusicLimiter`, y `access` de `node:fs/promises` si no están):

```ts
  registerListReviewIpc({
    apply: {
      allowed: (path) => mediaAccess.isAllowed(path),
      exists: (path) =>
        access(path).then(
          () => true,
          () => false,
        ),
      rewrite: (file, changes) =>
        rewriteTagFields(file, changes, { track: tmpManifest.track, untrack: tmpManifest.untrack }),
      ...(process.platform === 'darwin' && {
        setMusicField: (pid, field, from, to) =>
          appleMusicLimiter.run(() => setAppleMusicField(pid, field, from, to)),
      }),
    },
  })
```

Preload (`api.ts` con comentario de una línea, `index.ts` siguiendo `onMusicFixProgress`):

```ts
  applyListFixes: (req: ListFixRequest) => ipcRenderer.invoke('listreview:applyFixes', req),
  cancelListFixes: () => ipcRenderer.invoke('listreview:cancelFixes'),
  onListFixProgress: (cb: (p: MusicFixProgress) => void) => {
    const listener = (_e: unknown, p: MusicFixProgress): void => cb(p)
    ipcRenderer.on('listreview:fixProgress', listener)
    return () => ipcRenderer.removeListener('listreview:fixProgress', listener)
  },
```

`test/api.ts`: `applyListFixes: async () => []`, `cancelListFixes: async () => {}`, `onListFixProgress: unsubscribe`.

- [ ] **Step 4: Ver que pasan y mutación**

Run: `cd apps/desktop && npm test -- src/main/listReviewApply.test.ts src/main/listReviewIpc.test.ts` y el typecheck.
Expected: PASS. Mutación: quitar `result.outcomes[i] === 'written' &&` de la condición de Music, ver rojo "leaves Music alone…", deshacer.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/listReviewApply.ts apps/desktop/src/main/listReviewApply.test.ts apps/desktop/src/main/listReviewIpc.ts apps/desktop/src/main/listReviewIpc.test.ts apps/desktop/src/main/index.ts apps/desktop/src/preload apps/desktop/src/renderer/src/test/api.ts
git commit -m "Write a list review fix to the file first and then to its Apple Music entry"
```

---

### Task 6: Quitar una copia de la lista sin perder playlists ni el fichero que sigue en uso

Orden: bibliotecas DJ → Apple Music → Papelera recuperable. Se reutiliza `replaceDuplicates` con un paso de Music opcional; la revisión de Music no lo pasa y no cambia.

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (`DuplicateReplaceOutcome` y tipos nuevos)
- Modify: `apps/desktop/src/main/duplicateReplace.ts` (`ReplaceDuplicatesDeps`, `replaceDuplicates`)
- Modify: `apps/desktop/src/main/musicDuplicates.ts` (exportar `mayShareFile`, añadir `removeListCopyFromMusic`)
- Create: `apps/desktop/src/main/recoverableTrash.ts`
- Modify: `apps/desktop/src/main/shellIpc.ts` (`shell:trash` usa `trashRecoverably`)
- Modify: `apps/desktop/src/main/listReviewIpc.ts`, `apps/desktop/src/main/index.ts` (extraer `duplicateLibraryDeps`, quitar la limitación a macOS de `library:status` y `library:copyInfo`)
- Modify: `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/test/api.ts`
- Test: `main/duplicateReplace.test.ts`, `main/musicDuplicates.test.ts`, `main/recoverableTrash.test.ts` (nuevo), `main/listReviewIpc.test.ts`

**Interfaces:**
- Consumes: `replaceDuplicates`, `ReplacePair` (`duplicateReplace.ts`), `RemoveCopyDeps` (`musicDuplicates.ts`), `MusicFileEntry` (Task 4), `registerListReviewIpc` (Task 5).
- Produces:

```ts
// shared/types.ts
export interface ListMusicRef {
  removePid: string
  label: string
  // The kept copy's entry; absent when the kept file is not in Music (or is there twice).
  keep?: { persistentId: string; label: string }
}
export interface ListRemoval {
  from: string
  to: string
  music?: ListMusicRef | 'ambiguous'
}
export type ListMusicStep = 'none' | 'removed' | 'kept-no-entry' | 'ambiguous' | 'mismatch' | 'failed'
// DuplicateReplaceOutcome gains:
//   music?: ListMusicStep
//   // The file stayed on disk because Apple Music still holds it.
//   keptForMusic?: boolean

// duplicateReplace.ts
//   ReplaceDuplicatesDeps.musicStep?: (pair: ReplacePair) => Promise<ListMusicStep>

// musicDuplicates.ts
export function mayShareFile(a: string, b: string, deps: Pick<RemoveCopyDeps, 'realpath'>): Promise<boolean>
export function removeListCopyFromMusic(
  music: ListRemoval['music'],
  deps: Pick<RemoveCopyDeps, 'transferPlaylists' | 'deleteEntry'>,
): Promise<ListMusicStep>

// recoverableTrash.ts
export interface RecoverableTrashDeps {
  keepsTrash: (path: string) => boolean
  keep: (path: string) => Promise<unknown>
  trashItem: (path: string) => Promise<void>
}
export function trashRecoverably(path: string, deps?: RecoverableTrashDeps): Promise<void>

// listReviewIpc.ts
export interface ListRemovalDeps {
  replace: Omit<ReplaceDuplicatesDeps, 'trash' | 'musicStep'>
  realpath: (path: string) => Promise<string | null>
  trash: (path: string) => Promise<void>
  // Undefined off macOS.
  music?: Pick<RemoveCopyDeps, 'transferPlaylists' | 'deleteEntry'>
}
// ListReviewIpcDeps gains: isAllowed: (path: string) => boolean; removal: (sender: WebContents) => ListRemovalDeps
```

  - IPC `listreview:removeDuplicates(removals: ListRemoval[]): DuplicateReplaceOutcome[]`; preload `removeListDuplicates(removals: ListRemoval[]): Promise<DuplicateReplaceOutcome[]>`.

- [ ] **Step 1: Escribir los tests que fallan**

`duplicateReplace.test.ts`, dentro de `describe('replaceDuplicates')`:

```ts
  // List review order: the DJ libraries first, then Music lets go, and only then the Trash.
  it('lets Apple Music go between the libraries and the Trash', async () => {
    const calls: string[] = []
    const d = deps({
      libraries: {
        rekordbox: vi.fn(async () => {
          calls.push('rekordbox')
          return ['repointed' as const]
        }),
      },
      usedByLibrary: vi.fn(async () => {
        calls.push('used')
        return false
      }),
      musicStep: vi.fn(async () => {
        calls.push('music')
        return 'removed' as const
      }),
      trash: vi.fn(async () => {
        calls.push('trash')
      }),
    })
    expect(await replaceDuplicates([PAIR], d)).toEqual([
      { from: PAIR.from, rekordbox: 'repointed', music: 'removed', fileTrashed: true, keptForLibrary: false },
    ])
    expect(calls).toEqual(['rekordbox', 'used', 'music', 'trash'])
  })

  // A file Music still points at becomes a dead "!" entry with its playlists stranded.
  it.each(['kept-no-entry', 'ambiguous', 'mismatch', 'failed'] as const)(
    'keeps the file when Music answers %s',
    async (step) => {
      const d = deps({ musicStep: vi.fn().mockResolvedValue(step) })
      expect(await replaceDuplicates([PAIR], d)).toEqual([
        { from: PAIR.from, rekordbox: 'repointed', music: step, fileTrashed: false, keptForLibrary: false, keptForMusic: true },
      ])
      expect(d.trash).not.toHaveBeenCalled()
    },
  )

  it('trashes a file Music never held', async () => {
    const d = deps({ musicStep: vi.fn().mockResolvedValue('none') })
    expect((await replaceDuplicates([PAIR], d))[0]).toMatchObject({ music: 'none', fileTrashed: true })
  })

  it('keeps the file when the Music step throws', async () => {
    const d = deps({ musicStep: vi.fn().mockRejectedValue(new Error('osascript')) })
    expect((await replaceDuplicates([PAIR], d))[0]).toMatchObject({ music: 'failed', keptForMusic: true, fileTrashed: false })
  })

  // Music only lets go of a copy whose file is really leaving.
  it('never asks Music when a library keeps the file', async () => {
    const d = deps({ usedByLibrary: vi.fn().mockResolvedValue(true), musicStep: vi.fn() })
    await replaceDuplicates([PAIR], d)
    expect(d.musicStep).not.toHaveBeenCalled()
  })
```

`musicDuplicates.test.ts` (importar `removeListCopyFromMusic`):

```ts
describe('removeListCopyFromMusic', () => {
  const ref = { removePid: 'OLD', label: 'A - T', keep: { persistentId: 'KEEP', label: 'A - T (Remaster)' } }

  it('has nothing to do for a file Music does not hold', async () => {
    expect(await removeListCopyFromMusic(undefined, deps())).toBe('none')
  })

  it('moves the playlists to the kept entry and then deletes the removed one', async () => {
    const d = deps()
    expect(await removeListCopyFromMusic(ref, d)).toBe('removed')
    expect(d.transferPlaylists).toHaveBeenCalledWith('OLD', 'KEEP', 'A - T', 'A - T (Remaster)')
    expect(d.deleteEntry).toHaveBeenCalledWith('OLD', 'A - T')
  })

  // Its Music playlists would have nowhere to go.
  it('touches nothing when the kept file is not in Music', async () => {
    const d = deps()
    expect(await removeListCopyFromMusic({ removePid: 'OLD', label: 'A - T' }, d)).toBe('kept-no-entry')
    expect(d.transferPlaylists).not.toHaveBeenCalled()
  })

  it('touches nothing for a file Music holds twice', async () => {
    const d = deps()
    expect(await removeListCopyFromMusic('ambiguous', d)).toBe('ambiguous')
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it.each([
    ['mismatch', 'mismatch'],
    ['missing', 'failed'],
    ['2\t1', 'failed'],
    ['nonsense', 'failed'],
  ])('deletes nothing when the transfer answers %s', async (answer, step) => {
    const d = deps({ transferPlaylists: vi.fn().mockResolvedValue(answer) })
    expect(await removeListCopyFromMusic(ref, d)).toBe(step)
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('reports a label that changed between the transfer and the delete', async () => {
    const d = deps({ deleteEntry: vi.fn().mockRejectedValue(new Error('applemusic-delete-mismatch')) })
    expect(await removeListCopyFromMusic(ref, d)).toBe('mismatch')
  })
})
```

`main/recoverableTrash.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }))
vi.mock('./originalKeeper', () => ({ keepOriginal: vi.fn() }))

import { trashRecoverably } from './recoverableTrash'

const deps = (keepsTrash: boolean, kept: unknown) => ({
  keepsTrash: () => keepsTrash,
  keep: vi.fn().mockResolvedValue(kept),
  trashItem: vi.fn().mockResolvedValue(undefined),
})

describe('trashRecoverably', () => {
  // macOS deletes outright on a volume with no Trash (a NAS), where most crates live.
  it('keeps a file from a volume with no Trash in Surco backups instead', async () => {
    const d = deps(false, { id: 'b1' })
    await trashRecoverably('/Volumes/Public/a.aiff', d)
    expect(d.keep).toHaveBeenCalledWith('/Volumes/Public/a.aiff')
    expect(d.trashItem).not.toHaveBeenCalled()
  })

  it('uses the system Trash where there is one', async () => {
    const d = deps(true, null)
    await trashRecoverably('/Users/me/a.aiff', d)
    expect(d.keep).not.toHaveBeenCalled()
    expect(d.trashItem).toHaveBeenCalledWith('/Users/me/a.aiff')
  })

  it('falls back to the system Trash when the backup could not be kept', async () => {
    const d = deps(false, null)
    await trashRecoverably('/Volumes/Public/a.aiff', d)
    expect(d.trashItem).toHaveBeenCalled()
  })
})
```

`main/listReviewIpc.test.ts` (importar `vi` ya está; ampliar el mock de electron no hace falta):

```ts
describe('listreview:removeDuplicates', () => {
  const removal = (from: string, to: string, music?: unknown) => ({ from, to, ...(music ? { music } : {}) })
  function register(over: Record<string, unknown> = {}) {
    const d = {
      replace: {
        libraries: {},
        usedByLibrary: vi.fn().mockResolvedValue(false),
        serial: (task: () => Promise<unknown>) => task(),
        warn: vi.fn(),
      },
      realpath: vi.fn(async (p: string) => p),
      trash: vi.fn().mockResolvedValue(undefined),
      music: {
        transferPlaylists: vi.fn().mockResolvedValue('1\t0'),
        deleteEntry: vi.fn().mockResolvedValue('/m/old.aiff'),
      },
      ...over,
    }
    registerListReviewIpc({
      apply: {} as never,
      isAllowed: (p: string) => p.startsWith('/m/'),
      removal: () => d,
    } as never)
    return d
  }

  it('removes the Music entry and trashes the file of a copy that is really leaving', async () => {
    const d = register()
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff', { removePid: 'OLD', label: 'A - T', keep: { persistentId: 'K', label: 'A - T' } }),
    ])
    expect(out).toEqual([{ from: '/m/old.aiff', music: 'removed', fileTrashed: true, keptForLibrary: false }])
    expect(d.trash).toHaveBeenCalledWith('/m/old.aiff')
  })

  // Two paths to one file: trashing the "copy" would take the kept audio with it.
  it('touches nothing when both paths are the same real file', async () => {
    const d = register({ realpath: vi.fn().mockResolvedValue('/m/real.aiff') })
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [removal('/m/a.aiff', '/m/b.aiff')])
    expect(out).toEqual([{ from: '/m/a.aiff', fileTrashed: false, keptForLibrary: false }])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('fails closed when a path cannot be resolved', async () => {
    const d = register({ realpath: vi.fn(async (p: string) => (p === '/m/b.aiff' ? null : p)) })
    await handlerFor('listreview:removeDuplicates')({ sender }, [removal('/m/a.aiff', '/m/b.aiff')])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('never trashes a path the app never handed to the renderer', async () => {
    const d = register()
    await handlerFor('listreview:removeDuplicates')({ sender }, [removal('/Users/me/doc.pdf', '/m/b.aiff')])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('has no Music step off macOS', async () => {
    const d = register({ music: undefined })
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [removal('/m/old.aiff', '/m/keep.aiff')])
    expect(out).toEqual([{ from: '/m/old.aiff', fileTrashed: true, keptForLibrary: false }])
    expect(d.trash).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/duplicateReplace.test.ts src/main/musicDuplicates.test.ts src/main/recoverableTrash.test.ts src/main/listReviewIpc.test.ts`
Expected: FAIL (imports inexistentes, `musicStep` ignorado).

- [ ] **Step 3: Implementar main**

`shared/types.ts`: `ListMusicRef`, `ListRemoval`, `ListMusicStep`, y en `DuplicateReplaceOutcome` los campos opcionales `music?: ListMusicStep` y `keptForMusic?: boolean`.

`duplicateReplace.ts`: en `ReplaceDuplicatesDeps`:

```ts
  // The list review only: Apple Music lets go of the removed copy after the DJ libraries and
  // before the Trash, and a file Music still holds is not thrown away.
  musicStep?: (pair: ReplacePair) => Promise<ListMusicStep>
```

y en `replaceDuplicates`, entre el `continue` de `keptForLibrary` y el `try { await deps.trash(…) }`:

```ts
      if (deps.musicStep) {
        result.music = await deps.musicStep(pair).catch(() => 'failed' as const)
        if (result.music !== 'none' && result.music !== 'removed') {
          result.keptForMusic = true
          continue
        }
      }
```

`musicDuplicates.ts`: `export async function mayShareFile(a: string, b: string, deps: Pick<RemoveCopyDeps, 'realpath'>)` (solo la firma; `removeDuplicateCopy` sigue pasándole sus deps). Y al final:

```ts
// The list review's half of a removal in Music, run only once the file is really leaving.
// Fails closed like removeDuplicateCopy: no transfer target, two entries on one file or any
// doubt about the playlists leaves the entry, and the caller keeps the file.
export async function removeListCopyFromMusic(
  music: ListRemoval['music'],
  deps: Pick<RemoveCopyDeps, 'transferPlaylists' | 'deleteEntry'>,
): Promise<ListMusicStep> {
  if (music === undefined) return 'none'
  if (music === 'ambiguous') return 'ambiguous'
  if (!music.keep) return 'kept-no-entry'
  const answer = await deps.transferPlaylists(
    music.removePid,
    music.keep.persistentId,
    music.label,
    music.keep.label,
  )
  if (answer === 'mismatch') return 'mismatch'
  const parsed = /^(\d+)\t(\d+)$/.exec(answer)
  if (!parsed || Number(parsed[2]) > 0) return 'failed'
  try {
    await deps.deleteEntry(music.removePid, music.label)
  } catch (e) {
    if (e instanceof Error && e.message === 'applemusic-delete-mismatch') return 'mismatch'
    throw e
  }
  return 'removed'
}
```

`main/recoverableTrash.ts`:

```ts
import { shell } from 'electron'
import { keepOriginal } from './originalKeeper'
import { volumeKeepsTrash } from './trashSupport'

export interface RecoverableTrashDeps {
  keepsTrash: (path: string) => boolean
  keep: (path: string) => Promise<unknown>
  trashItem: (path: string) => Promise<void>
}

const live = (): RecoverableTrashDeps => ({
  keepsTrash: (path) => volumeKeepsTrash(path),
  keep: (path) => keepOriginal(path, 'deleted'),
  trashItem: (path) => shell.trashItem(path),
})

// A volume with no Trash of its own (a NAS: macOS deletes outright there) sends the file to
// Surco's backups instead, so a delete stays recoverable everywhere.
export async function trashRecoverably(path: string, deps: RecoverableTrashDeps = live()): Promise<void> {
  if (!deps.keepsTrash(path) && (await deps.keep(path))) return
  await deps.trashItem(path)
}
```

`shellIpc.ts`: `shell:trash` queda `if (!mediaAccess.isAllowed(path)) throw errorWithKey('pathNotAllowed'); return trashRecoverably(path)`, moviendo el comentario del NAS a `recoverableTrash.ts` y quitando los imports que queden sin uso. `shellIpc.test.ts` debe seguir verde sin cambios.

`listReviewIpc.ts`: `ListRemovalDeps` de **Interfaces**, `isAllowed` y `removal` en `ListReviewIpcDeps`, y:

```ts
  // Paths come from the renderer: one it was never handed, or a pair that may be one file,
  // is passed on as shared, which replaceDuplicates never touches.
  ipcMain.handle('listreview:removeDuplicates', async (e, removals: ListRemoval[]) => {
    if (removals.length === 0) return []
    const d = deps.removal(e.sender)
    const pairs = await Promise.all(
      removals.map(async ({ from, to }) => ({
        from,
        to,
        shared:
          !deps.isAllowed(from) || !deps.isAllowed(to) || (await mayShareFile(from, to, d)),
      })),
    )
    const music = new Map(removals.map((r) => [r.from, r.music]))
    const musicDeps = d.music
    return replaceDuplicates(pairs, {
      ...d.replace,
      trash: d.trash,
      ...(musicDeps && {
        musicStep: (pair: ReplacePair) => removeListCopyFromMusic(music.get(pair.from), musicDeps),
      }),
    })
  })
```

`index.ts`:
- Extraer del handler `library:replaceDuplicates` todo lo que no es `trash` a `const duplicateLibraryDeps = (win: BrowserWindow | null, sender: WebContents): Omit<ReplaceDuplicatesDeps, 'trash' | 'musicStep'> => { … }` (bibliotecas, `usedByLibrary`, `serial: serialLibraryFlush`, `warn`), y dejar el handler como:

```ts
    async (e, pairs: ReplacePair[]): Promise<DuplicateReplaceOutcome[]> => {
      if (process.platform !== 'darwin' || pairs.length === 0) return []
      return replaceDuplicates(pairs, {
        ...duplicateLibraryDeps(BrowserWindow.fromWebContents(e.sender), e.sender),
        trash: (path) => shell.trashItem(path),
      })
    },
```

- En `registerListReviewIpc` añadir:

```ts
    isAllowed: (path) => mediaAccess.isAllowed(path),
    removal: (sender) => ({
      replace: duplicateLibraryDeps(BrowserWindow.fromWebContents(sender), sender),
      realpath: (path) => realpath(path).catch(() => null),
      trash: (path) => trashRecoverably(path),
      ...(process.platform === 'darwin' && {
        music: {
          transferPlaylists: (...args) => appleMusicLimiter.run(() => transferPlaylists(...args)),
          deleteEntry: (pid, label) => appleMusicLimiter.run(() => deleteFromAppleMusic(pid, label)),
        },
      }),
    }),
```

- `library:status` devuelve `currentLibraryStatus()` en todas las plataformas y `library:copyInfo` solo corta con `paths.length === 0`: solo leen, y la lista existe también en Windows.

Preload: `removeListDuplicates: (removals) => ipcRenderer.invoke('listreview:removeDuplicates', removals)`; `test/api.ts`: `removeListDuplicates: async () => []`.

- [ ] **Step 4: Ver que pasan y mutación**

Run: `cd apps/desktop && npm test -- src/main` y el typecheck.
Expected: PASS, incluidos los tests de `library:replaceDuplicates` y `shell:trash` de antes sin tocar. Mutación: invertir el orden de `musicStep` y el `continue` de `keptForLibrary`, ver rojo "never asks Music when a library keeps the file", deshacer.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer/src/test/api.ts
git commit -m "Remove a duplicate from the list through the DJ libraries, Apple Music and a recoverable Trash"
```

---

### Task 7: Lo ignorado en la lista se guarda aparte y en esta máquina

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (`Settings`, junto a `musicReviewIgnored`)
- Modify: `apps/desktop/src/main/settings.ts` (defaults y `LOCAL_KEYS`, tras `'musicReviewIgnored'`)
- Modify: los fixtures completos de `Settings`: `renderer/src/test/api.ts`, `renderer/src/App.test.tsx`, `components/OnboardingWizard.test.tsx`, `components/SettingsModal.test.tsx`, `lib/onboarding.test.ts`, `lib/settingsDraft.test.ts` (añadir `listReviewIgnored: []` junto a `musicReviewIgnored: []`)
- Test: `apps/desktop/src/main/settings.test.ts`

**Interfaces:**
- Produces: `Settings.listReviewIgnored: string[]`, por defecto `[]`, local desde el primer día (mover una clave fuera de `LOCAL_KEYS` borra el dato, así que entra ya dentro).

- [ ] **Step 1: Escribir el test que falla** (junto a "keeps the ignored review groups on this machine")

```ts
  // Duplicate keys name file paths on this machine, and keeping them apart from the Music
  // review's means ignoring a group in one never hides it in the other unseen.
  it('keeps the ignored list review groups on this machine, apart from the Music ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-config-'))
    setConfigDir(dir)
    saveSettings({ listReviewIgnored: ['artist||case|djlara'] })
    expect(read(syncedFile(dir))).not.toHaveProperty('listReviewIgnored')
    expect(getSettings().listReviewIgnored).toEqual(['artist||case|djlara'])
    expect(getSettings().musicReviewIgnored).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
```

- [ ] **Step 2: Ver que falla**

Run: `cd apps/desktop && npm test -- src/main/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`shared/types.ts`: `listReviewIgnored: string[]` tras `musicReviewIgnored`. `main/settings.ts`: `listReviewIgnored: [],` en defaults y en `LOCAL_KEYS`:

```ts
  // Group keys of the list review; its duplicate keys are this machine's file paths.
  'listReviewIgnored',
```

Fixtures: `listReviewIgnored: [],` al lado de cada `musicReviewIgnored: [],` (`grep -rn "musicReviewIgnored: \[\]" src` los lista).

- [ ] **Step 4: Ver que pasa**

Run: `cd apps/desktop && npm test -- src/main/settings.test.ts` y el typecheck.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/settings.ts apps/desktop/src/main/settings.test.ts apps/desktop/src/renderer/src
git commit -m "Keep the list review's ignored groups on this machine, apart from the Music review's"
```

---

### Task 8: La fuente de la lista y lo que el hook necesita de ella

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/listReviewSource.ts`, `apps/desktop/src/renderer/src/lib/copyQuality.ts`
- Modify: `apps/desktop/src/renderer/src/lib/reviewSource.ts` (campos opcionales)
- Modify: `apps/desktop/src/renderer/src/hooks/useMusicReview.ts`
- Modify: `apps/desktop/src/renderer/src/components/MusicReview.test.tsx` (defaults del helper `review()`)
- Test: `lib/listReviewSource.test.ts`, `lib/copyQuality.test.ts`, `hooks/useMusicReview.test.tsx`

**Interfaces:**
- Consumes: `listReviewEntries`, `withListChanges` (Task 3); `appleMusicFileEntries` (Task 4); `applyListFixes`, `cancelListFixes`, `onListFixProgress` (Task 5); `removeListDuplicates`, `ListRemoval` (Task 6); `qualityVerdict`, `isTranscode`, `Verdict` (`lib/quality.ts`).
- Produces:

```ts
// lib/reviewSource.ts, additions
export interface ReviewLoad {
  entries: ReviewEntry[]
  skipped: number
  // Undefined where there is no Music; false when it was closed and not opened to ask.
  musicConsulted?: boolean
}
// ReviewSource gains, all optional:
//   inMusic?: (id: string) => boolean
//   facts?: (id: string) => TrackItem | undefined
//   settle?: (updates: LibraryTagUpdate[], trashed: string[]) => void

// lib/copyQuality.ts
export type CopyQuality = { verdict: Verdict; transcode: boolean; cutoffHz: number; hasKnee: boolean } | null
export function copyQuality(row: TrackItem | undefined): CopyQuality
export function qualityRank(quality: CopyQuality): number

// lib/listReviewSource.ts
export interface ListSourceDeps {
  rows: () => TrackItem[]
  mac: boolean
  launchMusic: () => boolean
  onRowsRemoved: (paths: string[]) => void
}
export function listReviewSource(deps: ListSourceDeps): ReviewSource

// hooks/useMusicReview.ts, MusicReview gains:
//   kind: 'music' | 'list'
//   skipped: number
//   musicConsulted?: boolean
//   inMusic: (id: string) => boolean
//   facts: (id: string) => TrackItem | undefined
```

- [ ] **Step 1: Escribir los tests que fallan**

`lib/copyQuality.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { copyQuality, qualityRank } from './copyQuality'

const at = (path: string, spectrum?: Partial<NonNullable<TrackItem['spectrum']>>) =>
  ({
    inputPath: path,
    spectrum: spectrum && { cutoffHz: 20500, sampleRateHz: 44100, processed: false, hasKnee: true, ...spectrum },
  }) as TrackItem

describe('copyQuality', () => {
  // The view must never invent a verdict for a copy nobody measured.
  it('has none for a copy not analyzed or whose analysis failed', () => {
    expect(copyQuality(at('/a.aiff'))).toBeNull()
    expect(copyQuality(at('/a.aiff', { cutoffHz: null }))).toBeNull()
    expect(copyQuality(undefined)).toBeNull()
  })

  it('reads the verdict the editor shows, on the container of the file', () => {
    expect(copyQuality(at('/a.aiff', { cutoffHz: 16000 }))).toEqual({ verdict: 'bad', transcode: true, cutoffHz: 16000, hasKnee: true })
    expect(copyQuality(at('/a.mp3', { cutoffHz: 16000 }))).toMatchObject({ verdict: 'good', transcode: false })
  })

  it('ranks good before doubtful, reprocessed, bad and unknown', () => {
    const ranks = [
      at('/a.aiff'),
      at('/a.aiff', { cutoffHz: 18500 }),
      at('/a.aiff', { processed: true }),
      at('/a.aiff', { cutoffHz: 16000 }),
      at('/a.aiff', undefined),
    ].map((r) => qualityRank(copyQuality(r)))
    expect(ranks).toEqual([0, 1, 2, 3, 4])
  })
})
```

`lib/listReviewSource.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { listReviewSource } from './listReviewSource'

const row = (path: string, artist: string, over: Partial<TrackItem> = {}): TrackItem => {
  const meta = { ...emptyMetadata(), title: 'Song', artist }
  return { id: path, inputPath: path, fileName: path, listLabel: 'Song', query: '', status: 'idle', meta, diskSignature: trackSignature({ meta }), ...over }
}
let api: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  api = {
    appleMusicFileEntries: vi.fn().mockResolvedValue({ consulted: true, entries: {} }),
    applyListFixes: vi.fn().mockResolvedValue([]),
    removeListDuplicates: vi.fn().mockResolvedValue([]),
    setMusicField: vi.fn().mockResolvedValue('set'),
  }
  ;(window as unknown as { api: unknown }).api = api
})
const source = (rows: TrackItem[], over = {}) =>
  listReviewSource({ rows: () => rows, mac: true, launchMusic: () => false, onRowsRemoved: vi.fn(), ...over })

describe('listReviewSource', () => {
  it('reviews the read rows, counts the rest and asks Music about the read ones only', async () => {
    const s = source([row('/m/a.aiff', 'A'), row('/m/b.aiff', 'B', { metaReadFailed: true })], { launchMusic: () => true })
    const load = await s.load()
    expect(load).toMatchObject({ skipped: 1, musicConsulted: true })
    expect(load.entries.map((e) => e.id)).toEqual(['/m/a.aiff'])
    expect(api.appleMusicFileEntries).toHaveBeenCalledWith(['/m/a.aiff'], true)
  })

  it('never asks Music where there is none', async () => {
    const load = await source([row('/m/a.aiff', 'A')], { mac: false }).load()
    expect(api.appleMusicFileEntries).not.toHaveBeenCalled()
    expect(load.musicConsulted).toBeUndefined()
  })

  // Several entries on one file: correcting one at random could leave the other wrong.
  it('names a Music entry for a write only when the file has exactly one', async () => {
    api.appleMusicFileEntries.mockResolvedValue({
      consulted: true,
      entries: { '/m/a.aiff': [{ persistentId: 'A1', label: 'x' }], '/m/b.aiff': [{ persistentId: 'B1', label: 'x' }, { persistentId: 'B2', label: 'x' }] },
    })
    const s = source([row('/m/a.aiff', 'Dj Lara'), row('/m/b.aiff', 'Dj Lara')])
    await s.load()
    const fix = (id: string) => ({ id, field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' })
    await s.applyFixes([fix('/m/a.aiff'), fix('/m/b.aiff')])
    expect(api.applyListFixes).toHaveBeenCalledWith({ fixes: [fix('/m/a.aiff'), fix('/m/b.aiff')], music: { '/m/a.aiff': 'A1' } })
    expect(s.inMusic?.('/m/b.aiff')).toBe(true)
  })

  it('tells main which Music entries a removed copy and its kept copy have', async () => {
    api.appleMusicFileEntries.mockResolvedValue({
      consulted: true,
      entries: {
        '/m/old.aiff': [{ persistentId: 'OLD', label: 'A - T' }],
        '/m/keep.aiff': [{ persistentId: 'KEEP', label: 'A - T' }],
        '/m/twice.aiff': [{ persistentId: 'T1', label: 'A - T' }, { persistentId: 'T2', label: 'A - T' }],
      },
    })
    const s = source([row('/m/old.aiff', 'A'), row('/m/keep.aiff', 'A'), row('/m/twice.aiff', 'A'), row('/m/free.aiff', 'A')])
    await s.load()
    const hooks = { isCancelled: () => false, onStep: vi.fn(), onDone: vi.fn(), onLibraries: vi.fn() }
    const r = (removeId: string, keepId: string) => ({ removeId, keepId, label: 'A - T', keepLabel: 'A - T' })
    await s.removeCopies([r('/m/old.aiff', '/m/keep.aiff'), r('/m/twice.aiff', '/m/keep.aiff'), r('/m/old.aiff', '/m/free.aiff'), r('/m/free.aiff', '/m/keep.aiff')], hooks)
    expect(api.removeListDuplicates).toHaveBeenCalledWith([
      { from: '/m/old.aiff', to: '/m/keep.aiff', music: { removePid: 'OLD', label: 'A - T', keep: { persistentId: 'KEEP', label: 'A - T' } } },
      { from: '/m/twice.aiff', to: '/m/keep.aiff', music: 'ambiguous' },
      { from: '/m/old.aiff', to: '/m/free.aiff', music: { removePid: 'OLD', label: 'A - T' } },
      { from: '/m/free.aiff', to: '/m/keep.aiff' },
    ])
  })

  // The list commits its patch a render later; the recount must already see the fix and
  // the trashed copies gone, and those rows must leave the list.
  it('reloads with what it wrote and without what it trashed, and drops those rows', async () => {
    const onRowsRemoved = vi.fn()
    const s = source([row('/m/a.aiff', 'Dj Lara'), row('/m/b.aiff', 'DJ Lara')], { onRowsRemoved })
    s.settle?.([{ path: '/m/a.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } }], ['/m/b.aiff'])
    expect(onRowsRemoved).toHaveBeenCalledWith(['/m/b.aiff'])
    expect((await s.load()).entries).toEqual([expect.objectContaining({ id: '/m/a.aiff', artist: 'DJ Lara' })])
  })

  it('puts Music back on the entry the write went to, and nowhere when there was none', async () => {
    const s = source([])
    const f = { id: '/m/a.aiff', field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' }
    const o = { id: '/m/a.aiff', fixes: [f], music: ['set' as const], file: 'written' as const, written: ['artist' as const] }
    await s.revertMusic({ ...o, musicId: 'PID' }, f)
    await s.revertMusic(o, f)
    expect(api.setMusicField).toHaveBeenCalledTimes(1)
    expect(api.setMusicField).toHaveBeenCalledWith('PID', 'artist', 'DJ Lara', 'Dj Lara')
  })
})
```

En `hooks/useMusicReview.test.tsx`, un `describe('with the list as source')` nuevo al final (importar `listReviewSource`, `emptyMetadata`, `trackSignature`, `TrackItem`, y reutilizar el `row` del test anterior copiándolo en el fichero):

```ts
describe('with the list as source', () => {
  const row = (path: string, artist: string, over: Partial<TrackItem> = {}): TrackItem => {
    const meta = { ...emptyMetadata(), title: 'Song', artist }
    return { id: path, inputPath: path, fileName: path, listLabel: 'Song', query: '', status: 'idle', meta, diskSignature: trackSignature({ meta }), ...over }
  }
  const listApi = (over = {}) =>
    setApi({
      appleMusicFileEntries: vi.fn().mockResolvedValue({ consulted: true, entries: { '/m/c.aiff': [{ persistentId: 'PID', label: 'Dj Lara - Song' }] } }),
      applyListFixes: vi.fn().mockResolvedValue([
        {
          id: '/m/c.aiff', musicId: 'PID', path: '/m/c.aiff',
          fixes: [{ id: '/m/c.aiff', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
          music: ['set'], file: 'written', written: ['artist'], backupId: 'b1',
        },
      ]),
      onListFixProgress: vi.fn(() => () => {}),
      cancelListFixes: vi.fn(),
      removeListDuplicates: vi.fn().mockResolvedValue([{ from: '/m/b.aiff', fileTrashed: true, keptForLibrary: false }]),
      ...over,
    })
  const listHook = (rows: TrackItem[], onRowsRemoved = vi.fn()) => {
    const source = listReviewSource({ rows: () => rows, mac: true, launchMusic: () => true, onRowsRemoved })
    return renderHook(() => useMusicReview(props({ source })))
  }

  it('writes the file, follows the libraries and recounts without the fixed group', async () => {
    const api = listApi()
    const onRowsRemoved = vi.fn()
    const { result } = listHook([row('/m/a.aiff', 'DJ Lara'), row('/m/b.aiff', 'DJ Lara'), row('/m/c.aiff', 'Dj Lara')], onRowsRemoved)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.kind).toBe('list')
    expect(result.current.inMusic('/m/c.aiff')).toBe(true)
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(api.applyListFixes).toHaveBeenCalledWith({ fixes: [{ id: '/m/c.aiff', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }], music: { '/m/c.aiff': 'PID' } })
    expect(api.syncLibraryTags).toHaveBeenCalledWith([{ path: '/m/c.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } }])
    expect(api.loadMusicReview).not.toHaveBeenCalled()
    expect(result.current.spelling).toEqual([])
    expect(result.current.lastRun).toMatchObject({ before: 1, after: 0 })
  })

  it('takes the trashed copy out of the list', async () => {
    const api = listApi()
    const onRowsRemoved = vi.fn()
    const { result } = listHook([row('/m/a.aiff', 'Ann'), row('/m/b.aiff', 'Ann')], onRowsRemoved)
    await waitFor(() => expect(result.current.duplicates).toHaveLength(1))
    act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
    await act(() => result.current.apply())
    expect(api.removeListDuplicates).toHaveBeenCalledWith([{ from: '/m/b.aiff', to: '/m/a.aiff' }])
    expect(onRowsRemoved).toHaveBeenCalledWith(['/m/b.aiff'])
    expect(result.current.duplicates).toEqual([])
  })

  it('undoes by restoring the backup and putting Music back on the entry it wrote', async () => {
    const api = listApi()
    const { result } = listHook([row('/m/a.aiff', 'DJ Lara'), row('/m/b.aiff', 'DJ Lara'), row('/m/c.aiff', 'Dj Lara')])
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    await act(() => result.current.undo())
    expect(api.trashRestore).toHaveBeenCalledWith('b1')
    expect(api.setMusicField).toHaveBeenCalledWith('PID', 'artist', 'DJ Lara', 'Dj Lara')
    expect(result.current.spelling).toHaveLength(1)
  })

  // Same format on both sides: the measured one that is not cut at 16 kHz is the one to keep.
  it('keeps the better analyzed copy when the format ties', async () => {
    listApi()
    const spectrum = (cutoffHz: number) => ({ cutoffHz, sampleRateHz: 44100, processed: false, hasKnee: true }) as TrackItem['spectrum']
    const { result } = listHook([
      row('/m/a.aiff', 'Ann', { spectrum: spectrum(16000) }),
      row('/m/b.aiff', 'Ann', { spectrum: spectrum(20500) }),
    ])
    await waitFor(() => expect(result.current.duplicates).toHaveLength(1))
    expect(result.current.choice(result.current.duplicates[0].group.key)).toBe('/m/b.aiff')
  })
})
```

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/copyQuality.test.ts src/renderer/src/lib/listReviewSource.test.ts src/renderer/src/hooks/useMusicReview.test.tsx`
Expected: FAIL (módulos inexistentes; `kind`, `inMusic`, `settle` no existen).

- [ ] **Step 3: `copyQuality`**

```ts
import type { TrackItem } from '../types'
import { isTranscode, qualityVerdict, type Verdict } from './quality'

export type CopyQuality = {
  verdict: Verdict
  transcode: boolean
  cutoffHz: number
  hasKnee: boolean
} | null

// The verdict the editor shows for this file, read from the analysis the list already holds.
// Null when nothing was measured: the review says so instead of guessing.
export function copyQuality(row: TrackItem | undefined): CopyQuality {
  const spectrum = row?.spectrum
  if (!row || !spectrum || spectrum.cutoffHz === null) return null
  const ext = row.inputPath.split('.').pop()?.toLowerCase() ?? ''
  return {
    verdict: qualityVerdict(spectrum.cutoffHz, spectrum.sampleRateHz, spectrum.processed, spectrum.hasKnee, ext),
    transcode: isTranscode(ext, spectrum.cutoffHz, spectrum.hasKnee, spectrum.processed),
    cutoffHz: spectrum.cutoffHz,
    hasKnee: spectrum.hasKnee !== false,
  }
}

const ORDER: Record<Verdict, number> = { good: 0, warn: 1, processed: 2, bad: 3 }

export function qualityRank(quality: CopyQuality): number {
  if (quality === null) return 4
  return quality.transcode ? ORDER.bad : ORDER[quality.verdict]
}
```

- [ ] **Step 4: `listReviewSource`**

En `reviewSource.ts`, `ReviewLoad.musicConsulted?` y los tres opcionales de `ReviewSource` (importar `TrackItem` de `../types` y `LibraryTagUpdate`). Después, `lib/listReviewSource.ts`:

```ts
import type { LibraryTagUpdate, ListRemoval, MusicFileEntry } from '../../../shared/types'
import type { TrackItem } from '../types'
import { listReviewEntries, withListChanges } from './listReviewEntries'
import type { ReviewSource } from './reviewSource'

export interface ListSourceDeps {
  rows: () => TrackItem[]
  mac: boolean
  // Whether Music may be opened to answer; otherwise it is asked only if already open.
  launchMusic: () => boolean
  onRowsRemoved: (paths: string[]) => void
}

export function listReviewSource(deps: ListSourceDeps): ReviewSource {
  let music: Record<string, MusicFileEntry[]> = {}
  const changes: LibraryTagUpdate[] = []
  const gone = new Set<string>()
  const only = (id: string) => (music[id]?.length === 1 ? music[id][0] : undefined)
  const musicOf = (removeId: string, keepId: string): ListRemoval['music'] => {
    const found = music[removeId]
    if (!found) return undefined
    if (found.length > 1) return 'ambiguous'
    const keep = only(keepId)
    return {
      removePid: found[0].persistentId,
      label: found[0].label,
      ...(keep && { keep: { persistentId: keep.persistentId, label: keep.label } }),
    }
  }
  return {
    kind: 'list',
    load: async () => {
      const { entries, skipped } = listReviewEntries(deps.rows())
      let musicConsulted: boolean | undefined
      if (deps.mac) {
        const lookup = await window.api
          .appleMusicFileEntries(
            entries.map((e) => e.id),
            deps.launchMusic(),
          )
          .catch(() => ({ consulted: false, entries: {} }))
        music = lookup.entries
        musicConsulted = lookup.consulted
      }
      return {
        entries: withListChanges(entries, changes, gone),
        skipped,
        ...(musicConsulted === undefined ? {} : { musicConsulted }),
      }
    },
    locate: async (id) => id,
    applyFixes: (fixes) =>
      window.api.applyListFixes({
        fixes,
        music: Object.fromEntries(
          fixes.flatMap((f) => {
            const entry = only(f.id)
            return entry ? [[f.id, entry.persistentId]] : []
          }),
        ),
      }),
    onProgress: (cb) => window.api.onListFixProgress(cb),
    cancel: () => {
      void window.api.cancelListFixes()
    },
    // One call does it all in main, in the order the libraries need: DJ libraries, Music,
    // then the Trash.
    removeCopies: async (removals, { isCancelled, onStep, onDone }) => {
      const run = { removed: [], replaced: [], librariesUntouched: false, replaceFailed: false }
      if (isCancelled()) return run
      onStep(1)
      let replaceFailed = false
      const replaced = await window.api
        .removeListDuplicates(
          removals.map((r) => {
            const ref = musicOf(r.removeId, r.keepId)
            return { from: r.removeId, to: r.keepId, ...(ref && { music: ref }) }
          }),
        )
        .catch(() => {
          replaceFailed = true
          return []
        })
      onDone(removals.length)
      return { ...run, replaced, replaceFailed }
    },
    revertMusic: async (outcome, fix) =>
      outcome.musicId
        ? window.api.setMusicField(outcome.musicId, fix.field, fix.to, fix.from)
        : undefined,
    inMusic: (id) => (music[id]?.length ?? 0) > 0,
    facts: (id) => deps.rows().find((r) => r.inputPath === id),
    settle: (updates, trashed) => {
      changes.push(...updates)
      for (const path of trashed) gone.add(path)
      if (trashed.length) deps.onRowsRemoved(trashed)
    },
  }
}
```

- [ ] **Step 5: El hook**

En `useMusicReview.ts`:
- Estado `const [loaded, setLoaded] = useState<{ skipped: number; musicConsulted?: boolean }>({ skipped: 0 })`; en `load`, tras `source.load()`: `setLoaded({ skipped: result.skipped, musicConsulted: result.musicConsulted })`.
- `const inMusic = useCallback((id: string) => source.inMusic?.(id) ?? source.kind === 'music', [source])`, `const facts = useCallback((id: string) => source.facts?.(id), [source])`.
- En `choice`, la reducción del duplicado pasa a comparar formato y, en empate, calidad (para Music `facts` es `undefined` y el empate se resuelve igual que hoy):

```ts
      const better = (a: string, b: string) =>
        rankOf(formats[a] ?? '') - rankOf(formats[b] ?? '') ||
        qualityRank(copyQuality(facts(a))) - qualityRank(copyQuality(facts(b)))
      return (withFile.length ? withFile : d.ids).reduce((best, id) =>
        better(id, best) < 0 ? id : best,
      )
```

  (deps de `choice` añaden `facts`).
- En `apply`, tras calcular `updates` y antes de `onFilesChanged`:

```ts
      const trashed = replaced.filter((r) => r.fileTrashed).map((r) => r.from)
      if (updates.length || trashed.length) source.settle?.(updates, trashed)
```

- En `undo`, antes de `onFilesChanged(back)`: `if (back.length) source.settle?.(back, [])`.
- El objeto devuelto (y su `useMemo`) añade `kind: source.kind`, `skipped: loaded.skipped`, `musicConsulted: loaded.musicConsulted`, `inMusic`, `facts`.

`components/MusicReview.test.tsx`, helper `review()`: añadir `kind: 'music', skipped: 0, inMusic: () => true, facts: () => undefined,`.

- [ ] **Step 6: Ver que pasan y mutación**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib src/renderer/src/hooks src/renderer/src/components/MusicReview.test.tsx` y el typecheck.
Expected: PASS, con los tests de Music del hook intactos. Mutación: en `musicOf`, quitar la rama `'ambiguous'`, ver rojo "tells main which Music entries…", deshacer.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/lib apps/desktop/src/renderer/src/hooks apps/desktop/src/renderer/src/components/MusicReview.test.tsx
git commit -m "Feed the metadata review from the tracks loaded in the list"
```

---

### Task 9: La vista dice lo de la lista con sus propias palabras

Todo texto que difiere entre fuentes sale de `REVIEW_COPY[review.kind]`. Lo que solo existe en la lista (alcance, filas sin leer, calidad, tamaño, Apple Music por copia) se pinta solo con `kind === 'list'`.

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/reviewSource.ts` (`ReviewCopy`, `REVIEW_COPY`)
- Modify: `apps/desktop/src/renderer/src/components/MusicReview.tsx` (estados de la columna, línea de alcance, `phaseLabel`, `Confirm`, `Done`)
- Modify: `apps/desktop/src/renderer/src/components/MusicReviewDetail.tsx` (`Where`, `DuplicateDetail`)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json` (bloque `listReview`)
- Test: `apps/desktop/src/renderer/src/components/MusicReview.test.tsx`

**Interfaces:**
- Consumes: `MusicReview.kind`, `skipped`, `musicConsulted`, `inMusic`, `facts` (Task 8); `copyQuality` (Task 8); `useTrackProperties` (`hooks/useTrackProperties.ts`); `formatFileSize` (`lib/properties.ts`); `formatKHz` (`lib/quality.ts`).
- Produces:

```ts
export interface ReviewCopy {
  loading: string
  empty: string
  error: string
  phaseWriting: string
  phaseVerifying: string
  confirmRemoved: string
  confirmPlaylists: string
  confirmTrash: string
  doneTitle: string
  applyError: string
  partial: string
  librarySkipped: string
  libraryReplaceFailed: string
  whereMusic: string
}
export const REVIEW_COPY: Record<'music' | 'list', ReviewCopy>
```

  - `MusicReview.reviewed: number` (las entradas revisadas, `entries.length`), para la línea de alcance.

- [ ] **Step 1: Escribir los tests que fallan**

En `MusicReview.test.tsx` (importar `QueryClientProvider` de `@tanstack/react-query` y `createQueryClient` de `../lib/queryClient`), un `describe('list review')` nuevo. Usa el helper `review()` con `kind: 'list'` y los componentes `MusicReview`, `MusicReviewDetail` y `Panes` que el fichero ya tiene:

```tsx
describe('list review', () => {
  const listReview = (over: Partial<Review> = {}) => review({ kind: 'list', ...over })
  const columnProps = {
    selectedKey: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    search: '',
    onSearch: vi.fn(),
    sort: 'default' as ReviewSort,
    onSort: vi.fn(),
    confirming: false,
    onConfirming: vi.fn(),
  }

  it('says how many list tracks it covers and how many it left out', () => {
    render(<MusicReview review={listReview({ skipped: 4, musicConsulted: false })} {...columnProps} />)
    const scope = screen.getByTestId('list-review-scope')
    expect(scope).toHaveTextContent('3 tracks in the list')
    expect(scope).toHaveTextContent('4 not read yet, left out')
    expect(scope).toHaveTextContent('Apple Music was not checked because it is closed.')
  })

  it('names the list, not the Music library, while loading and when empty', () => {
    const { rerender } = render(<MusicReview review={listReview({ status: 'loading' })} {...columnProps} />)
    expect(screen.getByTestId('music-review-loading')).toHaveTextContent('Reading the list…')
    rerender(<MusicReview review={listReview({ status: 'empty' })} {...columnProps} />)
    expect(screen.getByTestId('music-review-empty')).toHaveTextContent('No track in the list has its tags read.')
  })

  it('shows Music in the affected rows only for files Music holds', () => {
    const affected = () => [
      { id: '/m/a.aiff', title: 'A', field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' },
      { id: '/m/b.aiff', title: 'B', field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' },
    ]
    render(
      <MusicReviewDetail
        review={listReview({ affected, inMusic: (id) => id === '/m/a.aiff' })}
        selectedKey={group.key}
        sync={{ rekordbox: false, engineDj: false, traktor: false }}
      />,
    )
    const [a, b] = screen.getAllByTestId('music-review-affected')
    expect(within(a).getByText('Apple Music')).toBeInTheDocument()
    expect(within(b).queryByText('Apple Music')).not.toBeInTheDocument()
    expect(within(b).getByText('File')).toBeInTheDocument()
  })

  describe('copies', () => {
    const entry = (id: string, album: string) => ({ id, artist: 'DJ Ter', title: 'This Rap', albumArtist: '', album, genre: '', durationSec: 351 })
    const card = {
      group: { key: 'k#1', kind: 'duplicate' as const, ids: ['/m/a.aiff', '/m/b.aiff'] },
      entries: [entry('/m/a.aiff', 'This Rap'), entry('/m/b.aiff', 'Legacy Vol. 2')],
      formats: { '/m/a.aiff': 'AIFF', '/m/b.aiff': 'AIFF' },
      locations: { '/m/a.aiff': '/m/a.aiff', '/m/b.aiff': '/m/b.aiff' },
    }
    const spectrum = { cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: true }
    const facts = (id: string) =>
      (id === '/m/b.aiff' ? { inputPath: id, spectrum } : { inputPath: id }) as never

    beforeEach(() => {
      ;(window as unknown as { api: Api }).api = stubApi({
        properties: vi.fn(async (path: string) => ({ sizeBytes: path === '/m/a.aiff' ? 59_000_000 : 61_000_000 })) as never,
      })
    })

    // Which copy to keep is a quality call; the list already measured some of them, and a
    // copy nobody analyzed must say so rather than look clean.
    it('shows each copy quality, size and whether Music holds it', async () => {
      render(
        <QueryClientProvider client={createQueryClient()}>
          <MusicReviewDetail
            review={listReview({ spelling: [], duplicates: [card], choice: () => '/m/a.aiff', facts, inMusic: (id) => id === '/m/a.aiff' })}
            selectedKey="k#1"
            sync={{ rekordbox: false, engineDj: false, traktor: false }}
          />
        </QueryClientProvider>,
      )
      const [a, b] = screen.getAllByTestId('music-review-copy')
      expect(within(a).getByTestId('list-review-copy-quality')).toHaveTextContent('Not analyzed')
      expect(within(b).getByTestId('list-review-copy-quality')).toHaveTextContent('Lossy source')
      expect(within(b).getByTestId('list-review-copy-quality')).toHaveTextContent('16.0 kHz')
      expect(await within(a).findByTestId('list-review-copy-size')).toHaveTextContent(/MB/)
      expect(within(a).getByTestId('list-review-copy-music')).toHaveTextContent('Apple Music')
      expect(within(b).queryByTestId('list-review-copy-music')).not.toBeInTheDocument()
    })
  })

  describe('done sheet', () => {
    it('counts written files, copies trashed and what Music kept', () => {
      const lastRun = run({
        outcomes: [
          { id: '/m/a.aiff', fixes: [], music: ['set'], file: 'written', written: ['artist'], backupId: 'b1' },
          { id: '/m/b.aiff', fixes: [], music: ['mismatch'], file: 'written', written: ['artist'], backupId: 'b2' },
          { id: '/m/c.aiff', fixes: [], music: ['none'], file: 'unchanged', written: [] },
        ],
        replaced: [
          { from: '/m/d.aiff', music: 'removed', fileTrashed: true, keptForLibrary: false },
          { from: '/m/e.aiff', music: 'kept-no-entry', fileTrashed: false, keptForLibrary: false, keptForMusic: true },
        ],
      })
      render(<MusicReview review={listReview({ status: 'done', lastRun })} {...columnProps} />)
      const done = screen.getByTestId('music-review-done')
      expect(done).toHaveTextContent('List reviewed')
      expect(done).toHaveTextContent('3 tracks updated')
      expect(done).toHaveTextContent('1 file no longer said what was read and was left alone')
      expect(done).toHaveTextContent('1 Apple Music entry said something else and was left as it was')
      expect(done).toHaveTextContent('1 copy left Apple Music')
      expect(done).toHaveTextContent('1 file stays on disk because Apple Music still uses it.')
      expect(done).not.toHaveTextContent('could not be changed')
    })
  })
})
```

(El helper `review()` del fichero ya trae un grupo de tres pistas, de ahí "3 tracks in the list" una vez se cuenten las entradas: el alcance es `skipped` aparte y el número de pistas revisadas sale de `review.reviewed`. Añadir `reviewed: 3` a los defaults del helper y `reviewed: number` al hook, igual a `entries.length`.)

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/renderer/src/components/MusicReview.test.tsx`
Expected: FAIL (textos de Music, testids inexistentes).

- [ ] **Step 3: Copia por fuente**

`reviewSource.ts`:

```ts
export const REVIEW_COPY: Record<'music' | 'list', ReviewCopy> = {
  music: {
    loading: 'musicReview.loading',
    empty: 'musicReview.empty',
    error: 'musicReview.error',
    phaseWriting: 'musicReview.phase.writing',
    phaseVerifying: 'musicReview.phase.verifying',
    confirmRemoved: 'musicReview.confirm.removed',
    confirmPlaylists: 'musicReview.confirm.playlists',
    confirmTrash: 'musicReview.confirm.trash',
    doneTitle: 'musicReview.done.title',
    applyError: 'musicReview.done.applyError',
    partial: 'musicReview.done.musicOnly',
    librarySkipped: 'musicReview.done.librarySkipped',
    libraryReplaceFailed: 'musicReview.done.libraryReplaceFailed',
    whereMusic: 'musicReview.where.music',
  },
  list: {
    loading: 'listReview.loading',
    empty: 'listReview.empty',
    error: 'listReview.error',
    phaseWriting: 'listReview.phase.writing',
    phaseVerifying: 'listReview.phase.verifying',
    confirmRemoved: 'listReview.confirm.removed',
    confirmPlaylists: 'listReview.confirm.playlists',
    confirmTrash: 'listReview.confirm.trash',
    doneTitle: 'listReview.done.title',
    applyError: 'listReview.done.applyError',
    partial: 'listReview.done.partial',
    librarySkipped: 'listReview.done.librarySkipped',
    libraryReplaceFailed: 'listReview.done.libraryReplaceFailed',
    whereMusic: 'listReview.where.music',
  },
}
```

Hook: `reviewed: entries.length` en el objeto devuelto (y en el `useMemo`).

- [ ] **Step 4: Columna, hoja de confirmación y hoja final**

En `MusicReview.tsx`, con `const copy = REVIEW_COPY[review.kind]`:
- `t('musicReview.loading' | 'musicReview.empty' | 'musicReview.error')` → `t(copy.loading)` etc.
- Tras el `FilterBar`, dentro de la cabecera fija:

```tsx
        {review.kind === 'list' && review.status !== 'loading' && (
          <p data-testid="list-review-scope" className="px-2 pb-2 text-xs text-fg-faint">
            {[
              t('listReview.scope', { count: review.reviewed }),
              ...(review.skipped > 0 ? [t('listReview.skipped', { count: review.skipped })] : []),
            ].join(' · ')}
            {review.musicConsulted === false && <> {t('listReview.musicUnchecked')}</>}
          </p>
        )}
```

- `phaseLabel(t, phase, copy)`: `null` y `verifying` → `t(copy.phaseVerifying)`; `writing` → `t(copy.phaseWriting, { current, total })`; el resto como hoy. `MusicReviewAction` le pasa `REVIEW_COPY[review.kind]`.
- `Confirm`: `t(copy.confirmRemoved)`, `t(copy.confirmPlaylists)`, `t(copy.confirmTrash)`.
- `Done`: `t(copy.doneTitle)`, `t(copy.applyError)`, `copy.librarySkipped` y `copy.libraryReplaceFailed` en `libraryLines`, y los recuentos por fuente:

```ts
  const list = review.kind === 'list'
  const trashed = run.replaced.filter((r) => r.fileTrashed).length
  const removed = list ? trashed : run.removed.filter((r) => r.outcome === 'removed').length
  const updated = list
    ? run.outcomes.filter((o) => o.file === 'written').length + removed
    : run.outcomes.filter((o) => o.music.includes('set')).length + removed
  const partial = list
    ? run.outcomes.filter((o) => o.file === 'unchanged').length
    : run.outcomes.filter((o) => o.music.includes('set') && (o.file === 'unchanged' || o.file === 'missing')).length
  const musicMismatch = list ? run.outcomes.filter((o) => o.music.includes('mismatch')).length : 0
  const musicRemoved = run.replaced.filter((r) => r.music === 'removed').length
  const keptForMusic = run.replaced.filter((r) => r.keptForMusic).length
  const failed =
    run.outcomes.filter((o) =>
      list
        ? o.file === 'failed' || o.file === 'missing' || o.music.includes('failed')
        : o.file === 'failed' || o.music.some((m) => m === 'failed' || m === 'mismatch'),
    ).length + failedRemovals
```

  `musicOnly` pasa a llamarse `partial` y su línea usa `t(copy.partial, { count: partial })`. Líneas nuevas, solo cuando su número es mayor que cero: `listReview.done.musicMismatch`, `listReview.done.musicRemoved`, `listReview.done.keptForMusic` (esta junto a `keptForLibrary`). Para Music todos son 0, así que su hoja no cambia.

- [ ] **Step 5: Detalle**

`MusicReviewDetail.tsx`:
- `Where` recibe `places: ('music' | 'file')[]` y `musicLabel: string`; la fila de `affected` le pasa `review.kind === 'music' ? ['music', 'file'] : ['file', ...(review.inMusic(f.id) ? ['music' as const] : [])]` y `t(REVIEW_COPY[review.kind].whereMusic)`. Para Music el orden y los textos son los de hoy.
- En `DuplicateDetail`, cuando `review.kind === 'list'`, las celdas son calidad, tamaño, álbum y duración (sin género), y bajo `CopyLibraries` va la marca de Music:

```tsx
function CopyQualityCell({ row }: { row: TrackItem | undefined }) {
  const { t, i18n } = useTranslation()
  const q = copyQuality(row)
  if (q === null)
    return <span data-testid="list-review-copy-quality" className="text-fg-faint">{t('listReview.detail.unanalyzed')}</span>
  const label = q.transcode ? 'editor.qualityTranscode' : QUALITY_LABEL[q.verdict]
  const tone = q.verdict === 'good' && !q.transcode ? 'text-[var(--color-good)]' : 'text-[var(--color-warn)]'
  return (
    <span data-testid="list-review-copy-quality" className={tone}>
      {t(label)}
      {q.hasKnee && ` · ${formatKHz(q.cutoffHz, i18n.language)}`}
    </span>
  )
}

const QUALITY_LABEL: Record<Verdict, string> = {
  good: 'editor.qualityGood',
  warn: 'editor.qualitySuspect',
  bad: 'editor.qualityBad',
  processed: 'editor.qualityProcessed',
}

function CopySizeCell({ path }: { path: string }) {
  const { i18n } = useTranslation()
  const { data } = useTrackProperties(path, true)
  return (
    <span data-testid="list-review-copy-size">
      {data ? formatFileSize(data.sizeBytes, i18n.language) : ''}
    </span>
  )
}
```

  y en la tarjeta, si `review.kind === 'list' && review.inMusic(e.id)`:

```tsx
<span data-testid="list-review-copy-music" className="w-fit rounded bg-[var(--color-panel-2)] px-1.5 text-[11px] text-fg-dim">
  {t('listReview.where.music')}
</span>
```

- [ ] **Step 6: Textos en las cinco lenguas**

Bloque `listReview` en cada locale (las claves con `_one`/`_other` llevan las dos formas):

| clave | es | en | de | fr | pt-BR |
|---|---|---|---|---|---|
| `loading` | Leyendo la lista… | Reading the list… | Liste wird gelesen… | Lecture de la liste… | Lendo a lista… |
| `empty` | Ninguna pista de la lista tiene sus etiquetas leídas. | No track in the list has its tags read. | Bei keinem Titel der Liste wurden die Tags gelesen. | Aucune piste de la liste n’a ses tags lus. | Nenhuma faixa da lista teve as tags lidas. |
| `error` | No se pudo preparar la revisión de la lista. | Couldn't prepare the list review. | Die Prüfung der Liste konnte nicht vorbereitet werden. | Impossible de préparer la vérification de la liste. | Não foi possível preparar a revisão da lista. |
| `scope_one` / `_other` | {{count}} pista de la lista / {{count}} pistas de la lista | {{count}} track in the list / {{count}} tracks in the list | {{count}} Titel der Liste / {{count}} Titel der Liste | {{count}} piste de la liste / {{count}} pistes de la liste | {{count}} faixa da lista / {{count}} faixas da lista |
| `skipped_one` / `_other` | {{count}} sin leer, fuera de la revisión (ambas) | {{count}} not read yet, left out (both) | {{count}} nicht gelesen, nicht geprüft (beide) | {{count}} non lue, laissée de côté / {{count}} non lues, laissées de côté | {{count}} não lida, fora da revisão / {{count}} não lidas, fora da revisão |
| `musicUnchecked` | Apple Music no se ha consultado porque está cerrada. | Apple Music was not checked because it is closed. | Apple Music wurde nicht abgefragt, weil es geschlossen ist. | Apple Music n’a pas été consulté car il est fermé. | O Apple Music não foi consultado porque está fechado. |
| `where.music` | Apple Music | Apple Music | Apple Music | Apple Music | Apple Music |
| `phase.writing` | Escribiendo en los ficheros {{current}} de {{total}} | Writing files {{current}} of {{total}} | Dateien werden geschrieben {{current}} von {{total}} | Écriture des fichiers {{current}} sur {{total}} | Gravando arquivos {{current}} de {{total}} |
| `phase.verifying` | Comprobando la lista | Checking the list | Liste wird geprüft | Vérification de la liste | Verificando a lista |
| `confirm.removed` | Copias quitadas | Copies removed | Entfernte Kopien | Copies retirées | Cópias removidas |
| `confirm.playlists` | Sus playlists de rekordbox, Engine DJ y Traktor pasan a la copia que se queda, y si está en Apple Music sale de Music | Their rekordbox, Engine DJ and Traktor playlists move to the copy you keep, and if it is in Apple Music it leaves Music | Ihre Playlists in rekordbox, Engine DJ und Traktor gehen an die behaltene Kopie, und ist sie in Apple Music, wird sie dort entfernt | Leurs playlists rekordbox, Engine DJ et Traktor passent à la copie conservée, et si elle est dans Apple Music elle en sort | As playlists do rekordbox, Engine DJ e Traktor passam para a cópia que fica e, se estiver no Apple Music, ela sai do Music |
| `confirm.trash` | Sus ficheros van a la Papelera, salvo los que rekordbox, Engine DJ, Traktor o Apple Music sigan usando | Their files go to the Trash, except those rekordbox, Engine DJ, Traktor or Apple Music still use | Ihre Dateien kommen in den Papierkorb, außer denen, die rekordbox, Engine DJ, Traktor oder Apple Music noch nutzen | Leurs fichiers vont à la Corbeille, sauf ceux que rekordbox, Engine DJ, Traktor ou Apple Music utilisent encore | Os arquivos vão para o Lixo, exceto os que rekordbox, Engine DJ, Traktor ou Apple Music ainda usam |
| `done.title` | Lista revisada | List reviewed | Liste geprüft | Liste vérifiée | Lista revisada |
| `done.applyError` | No se pudo escribir en los ficheros. | Couldn't write to the files. | In die Dateien konnte nicht geschrieben werden. | Impossible d’écrire dans les fichiers. | Não foi possível gravar nos arquivos. |
| `done.partial_one` / `_other` | {{count}} fichero ya no decía lo que se leyó y no se tocó / {{count}} ficheros ya no decían lo que se leyó y no se tocaron | {{count}} file no longer said what was read and was left alone / {{count}} files no longer said what was read and were left alone | {{count}} Datei enthielt nicht mehr den gelesenen Wert und blieb unverändert / {{count}} Dateien enthielten nicht mehr den gelesenen Wert und blieben unverändert | {{count}} fichier ne disait plus ce qui avait été lu et n’a pas été touché / {{count}} fichiers ne disaient plus ce qui avait été lu et n’ont pas été touchés | {{count}} arquivo já não dizia o que foi lido e não foi alterado / {{count}} arquivos já não diziam o que foi lido e não foram alterados |
| `done.librarySkipped` | {{library}} no se actualizó porque estaba abierto o no se pudo leer. Las copias siguen en el disco. | {{library}} was not updated because it was open or could not be read. The copies are still on disk. | {{library}} wurde nicht aktualisiert, weil es geöffnet war oder nicht gelesen werden konnte. Die Kopien sind noch auf der Festplatte. | {{library}} n’a pas été mis à jour car il était ouvert ou illisible. Les copies sont toujours sur le disque. | {{library}} não foi atualizado porque estava aberto ou não pôde ser lido. As cópias continuam no disco. |
| `done.libraryReplaceFailed` | {{library}} no se pudo actualizar. Las copias siguen en el disco. | {{library}} could not be updated. The copies are still on disk. | {{library}} konnte nicht aktualisiert werden. Die Kopien sind noch auf der Festplatte. | {{library}} n’a pas pu être mis à jour. Les copies sont toujours sur le disque. | {{library}} não pôde ser atualizado. As cópias continuam no disco. |
| `done.musicRemoved_one` / `_other` | {{count}} copia salió de Apple Music / {{count}} copias salieron de Apple Music | {{count}} copy left Apple Music / {{count}} copies left Apple Music | {{count}} Kopie aus Apple Music entfernt / {{count}} Kopien aus Apple Music entfernt | {{count}} copie retirée d’Apple Music / {{count}} copies retirées d’Apple Music | {{count}} cópia saiu do Apple Music / {{count}} cópias saíram do Apple Music |
| `done.keptForMusic_one` / `_other` | {{count}} fichero se queda en disco porque Apple Music lo sigue usando. / {{count}} ficheros se quedan en disco porque Apple Music los sigue usando. | {{count}} file stays on disk because Apple Music still uses it. / {{count}} files stay on disk because Apple Music still uses them. | {{count}} Datei bleibt auf der Festplatte, weil Apple Music sie noch nutzt. / {{count}} Dateien bleiben auf der Festplatte, weil Apple Music sie noch nutzt. | {{count}} fichier reste sur le disque car Apple Music l’utilise encore. / {{count}} fichiers restent sur le disque car Apple Music les utilise encore. | {{count}} arquivo fica no disco porque o Apple Music ainda o usa. / {{count}} arquivos ficam no disco porque o Apple Music ainda os usa. |
| `done.musicMismatch_one` / `_other` | {{count}} entrada de Apple Music decía otra cosa y se quedó como estaba / {{count}} entradas de Apple Music decían otra cosa y se quedaron como estaban | {{count}} Apple Music entry said something else and was left as it was / {{count}} Apple Music entries said something else and were left as they were | {{count}} Eintrag in Apple Music hatte einen anderen Wert und blieb unverändert / {{count}} Einträge in Apple Music hatten einen anderen Wert und blieben unverändert | {{count}} entrée d’Apple Music disait autre chose et est restée telle quelle / {{count}} entrées d’Apple Music disaient autre chose et sont restées telles quelles | {{count}} entrada do Apple Music dizia outra coisa e ficou como estava / {{count}} entradas do Apple Music diziam outra coisa e ficaram como estavam |
| `detail.quality` | Calidad | Quality | Qualität | Qualité | Qualidade |
| `detail.size` | Tamaño | Size | Größe | Taille | Tamanho |
| `detail.unanalyzed` | Sin analizar | Not analyzed | Nicht analysiert | Non analysée | Não analisada |

`detail.quality` y `detail.size` son las etiquetas `dt` de las celdas nuevas.

- [ ] **Step 7: Ver que pasan**

Run: `cd apps/desktop && npm test -- src/renderer/src/components/MusicReview.test.tsx src/renderer/src/i18n` y el typecheck.
Expected: PASS; los tests de Music del fichero sin cambios y `keys.test.ts`/`usedKeys.test.ts` en verde.

- [ ] **Step 8: Lint y commit**

Run: `cd apps/desktop && npm run lint`. Expected: sin avisos.

```bash
git add apps/desktop/src/renderer/src/lib/reviewSource.ts apps/desktop/src/renderer/src/hooks/useMusicReview.ts apps/desktop/src/renderer/src/components apps/desktop/src/renderer/src/i18n/locales
git commit -m "Show the list review in its own words, with each copy's quality, size and Apple Music presence"
```

---

### Task 10: Entradas por el menú Pistas y ⌘K, y la revisión de la lista en la app

**Files:**
- Modify: `apps/desktop/src/main/appMenu.ts` (submenú `tracks`, tras `fillAll`), `apps/desktop/src/main/i18n.ts` (`MenuStrings.reviewList` en las cinco lenguas)
- Modify: `apps/desktop/src/renderer/src/lib/commands.ts` (`CommandDeps.openListReview`, comando `list-review` tras los de Music), locales (`commands.listReview`)
- Modify: `apps/desktop/src/renderer/src/components/MusicReviewColumn.tsx` (`source` en `Options`, `Owner` con `key`)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (estado de la revisión, fuente de la lista, filas que salen)
- Test: `apps/desktop/src/main/appMenu.test.ts`, `apps/desktop/src/renderer/src/lib/commands.test.ts`, `apps/desktop/src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: `listReviewSource`, `ListSourceDeps` (Task 8), `useMusicReview({ source })` (Tasks 1 y 8), `removeTracks`, `tracksRef` (`useTrackLibrary`), `tracksView` (`useTracksView`), `Settings.listReviewIgnored` (Task 7).
- Produces: comando `list-review`; `CommandDeps.openListReview: () => void`; `MusicReviewProvider` acepta `source?: ReviewSource`.

- [ ] **Step 1: Escribir los tests que fallan**

`appMenu.test.ts`:

```ts
  it('reviews the list from the Tracks menu on every platform', () => {
    for (const mac of [true, false]) {
      const { template, run } = build('en', mac)
      click(itemFor(menu(template, 'Tracks'), 'Review metadata in the list…'))
      expect(run).toHaveBeenCalledWith('list-review')
    }
  })
```

`commands.test.ts`:

```ts
  // The review works on the loaded tracks and writes the same files a conversion does.
  it('offers the list review only with tracks loaded and no conversion running', () => {
    const open = vi.fn()
    const find = (deps: Partial<CommandDeps>) =>
      buildCommands(makeDeps({ openListReview: open, ...deps })).find((c) => c.id === 'list-review')
    expect(find({ tracks: [] })?.enabled).toBe(false)
    expect(find({ tracks: [track()], batching: true })?.enabled).toBe(false)
    const ready = buildCommands(makeDeps({ openListReview: open, tracks: [track()], platform: 'win32' }))
    runCommand(ready, 'list-review')
    expect(open).toHaveBeenCalledTimes(1)
  })
```

(`makeDeps` gana `openListReview: vi.fn()` en sus defaults; `track()` es el helper del fichero.)

`App.test.tsx`, un `describe('App list review')` nuevo, con un helper local:

```tsx
const listApi = (over: Record<string, unknown> = {}) => {
  const artists: Record<string, string> = { '/music/a.wav': 'DJ Lara', '/music/b.wav': 'DJ Lara', '/music/c.wav': 'Dj Lara' }
  setApi({
    pickFiles: vi.fn().mockResolvedValue(Object.keys(artists)),
    readTags: vi.fn(async (path: string) => ({ title: 'T', artist: artists[path] })),
    properties: vi.fn().mockResolvedValue(null),
    applyListFixes: vi.fn().mockResolvedValue([
      {
        id: '/music/c.wav',
        path: '/music/c.wav',
        fixes: [{ id: '/music/c.wav', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
        music: ['none'],
        file: 'written',
        written: ['artist'],
        backupId: 'b1',
      },
    ]),
    onListFixProgress: () => () => {},
    cancelListFixes: vi.fn(),
    removeListDuplicates: vi.fn().mockResolvedValue([]),
    syncLibraryTags: vi.fn().mockResolvedValue(undefined),
    ...over,
  })
}

const addThree = async () => {
  fireEvent.click(await screen.findByTestId('add-files'))
  await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
  return screen.getAllByTestId('track-row')
}

describe('App list review', () => {
  // Windows has no Music, but it has the list and the DJ libraries.
  it('opens over the list on Windows and gives the list back as it was', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    await addThree()
    runMenu('list-review')
    expect(await screen.findByTestId('list-review-scope')).toHaveTextContent('3 tracks in the list')
    expect(screen.queryByTestId('track-row')).not.toBeInTheDocument()
    expect(window.api.appleMusicFileEntries).toBeUndefined()
    fireEvent.click(screen.getByTestId('music-review-close'))
    expect(await screen.findAllByTestId('track-row')).toHaveLength(3)
  })

  it('does nothing with an empty list', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    runMenu('list-review')
    expect(screen.queryByTestId('music-review')).not.toBeInTheDocument()
  })

  // The row shows the fixed artist straight away, so a later Update cannot write the old
  // spelling back over the fix.
  it('fixes a spelling in the file and shows it on the row', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    const rows = await addThree()
    runMenu('list-review')
    fireEvent.click(await screen.findByTestId('music-review-stage'))
    fireEvent.click(screen.getByTestId('music-review-apply'))
    fireEvent.click(screen.getByTestId('music-review-confirm-apply'))
    await screen.findByTestId('music-review-done')
    expect(window.api.applyListFixes).toHaveBeenCalledWith({
      fixes: [{ id: '/music/c.wav', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      music: {},
    })
    fireEvent.click(screen.getByTestId('music-review-continue'))
    fireEvent.click(screen.getByTestId('music-review-close'))
    fireEvent.click(rows[2])
    await waitFor(() =>
      expect((screen.getByTestId('field-artist') as HTMLInputElement).value).toBe('DJ Lara'),
    )
  })

  it('takes a trashed duplicate out of the list', async () => {
    vi.resetModules()
    listApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Ann' }),
      removeListDuplicates: vi
        .fn()
        .mockResolvedValue([{ from: '/music/b.wav', fileTrashed: true, keptForLibrary: false }]),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    runMenu('list-review')
    fireEvent.click(await screen.findByTestId('music-review-stage'))
    fireEvent.click(screen.getByTestId('music-review-apply'))
    fireEvent.click(screen.getByTestId('music-review-confirm-apply'))
    await screen.findByTestId('music-review-done')
    expect(window.api.removeListDuplicates).toHaveBeenCalledWith([{ from: '/music/b.wav', to: '/music/a.wav' }])
    fireEvent.click(screen.getByTestId('music-review-continue'))
    fireEvent.click(screen.getByTestId('music-review-close'))
    expect(await screen.findAllByTestId('track-row')).toHaveLength(1)
  })

  it('saves what is ignored in the list apart from Music', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    await addThree()
    runMenu('list-review')
    await screen.findByTestId('music-review-stage')
    fireEvent.click(screen.getByTestId('music-review-more'))
    fireEvent.click(screen.getByTestId('music-review-ignore'))
    await waitFor(() =>
      expect(window.api.saveSettings).toHaveBeenCalledWith({
        listReviewIgnored: [expect.stringContaining('artist')],
      }),
    )
  })
})
```

Si el arnés no cuenta `appleMusicFileEntries` como `undefined` (porque `stubApi` lo trae), cambiar esa línea por `expect(window.api.appleMusicFileEntries).not.toHaveBeenCalled()` tras espiarlo con `vi.fn()` en `listApi`.

- [ ] **Step 2: Ver que fallan**

Run: `cd apps/desktop && npm test -- src/main/appMenu.test.ts src/renderer/src/lib/commands.test.ts src/renderer/src/App.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Menú y comando**

`main/i18n.ts`, `MenuStrings.reviewList` y las cinco lenguas: es `Revisar metadatos de la lista…`, en `Review metadata in the list…`, de `Metadaten der Liste prüfen…`, fr `Vérifier les métadonnées de la liste…`, pt-BR `Revisar metadados da lista…`.

`main/appMenu.ts`, en el submenú `tracks` tras `fillAll`:

```ts
        keymapItem(t('reviewList'), 'list-review'),
```

`lib/commands.ts`: en `CommandDeps`, junto a `openMusicReview`:

```ts
  // Opens the review of the loaded tracks. Every platform: it reads the list, not Music.
  openListReview: () => void
```

y tras el bloque de `openMusicReview`:

```ts
    {
      id: 'list-review',
      group: 'library',
      title: tr('commands.listReview'),
      hint: hintFor('list-review'),
      enabled: tracks.length > 0 && !batching,
      run: openListReview,
    },
```

Locales `commands.listReview`: los mismos textos del menú.

- [ ] **Step 4: Proveedor y App**

`MusicReviewColumn.tsx`: `Options` gana `source?: ReviewSource`; `Owner` lo pasa a `useMusicReview`; en `MusicReviewProvider`, `<Owner key={options.source?.kind ?? 'music'} … />`, para que pasar de una revisión a otra sin cerrar no herede el estado de la anterior.

`App.tsx`:
- `const [review, setReview] = useState<{ source: 'music' | 'list'; filter: ReviewFilter } | null>(null)` en lugar de `musicReview`; cada `musicReview !== null` pasa a `review !== null` (líneas ~595, 1855, 1866, 1886, 1986, 1988, 2125).
- Deps de comandos: `openMusicReview: isMac ? (filter) => setReview({ source: 'music', filter }) : undefined`, `openListReview: () => setReview({ source: 'list', filter: 'all' })`.
- `const tracksViewRef = useRef(tracksView); tracksViewRef.current = tracksView` junto a `libraryIndexRef.current = libraryIndex`.
- La fuente, una por apertura:

```ts
  // One source per opening: it remembers what it wrote and trashed until the review closes.
  const listSource = useMemo(
    () =>
      review?.source === 'list'
        ? listReviewSource({
            rows: () => tracksViewRef.current,
            mac: isMac,
            launchMusic: () =>
              !!settingsRef.current?.addToAppleMusic ||
              tracksRef.current.some((t) => t.fromAppleMusic || t.musicPersistentId),
            onRowsRemoved: (paths) =>
              removeTracks(
                tracksRef.current.filter((t) => paths.includes(t.inputPath)).map((t) => t.id),
              ),
          })
        : undefined,
    [review, removeTracks],
  )
```

  (si App no tiene `settingsRef`, leer `settings` por un ref nuevo al lado de `tracksViewRef`).
- `MusicReviewProvider`:

```tsx
            <MusicReviewProvider
              open={review !== null}
              filter={review?.filter ?? 'all'}
              source={listSource}
              ignored={
                (review?.source === 'list' ? settings?.listReviewIgnored : settings?.musicReviewIgnored) ?? []
              }
              saveIgnored={(keys) =>
                void saveSettings(
                  review?.source === 'list' ? { listReviewIgnored: keys } : { musicReviewIgnored: keys },
                )
              }
              onFilesChanged={onReviewFilesChanged}
            >
```

- `MusicReviewColumn onClose={() => setReview(null)}`.

`onReviewFilesChanged` ya parchea las filas por ruta (`patchReviewedFields` + `refreshTrackFromDisk`), así que la lista muestra el valor nuevo sin cambios ahí.

- [ ] **Step 5: Ver que pasan y la suite completa**

Run: `cd apps/desktop && npm test` y el typecheck.
Expected: todo verde, incluidos los `App Music review` de siempre. Si algo falla fuera de estos ficheros, comprobar si también falla en `worktree-revisar-metadatos-music` antes de tocar nada.

- [ ] **Step 6: Lint y commit**

Run: `cd apps/desktop && npm run lint`. Expected: sin avisos.

```bash
git add apps/desktop/src/main/appMenu.ts apps/desktop/src/main/appMenu.test.ts apps/desktop/src/main/i18n.ts apps/desktop/src/renderer/src/lib/commands.ts apps/desktop/src/renderer/src/lib/commands.test.ts apps/desktop/src/renderer/src/components/MusicReviewColumn.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx apps/desktop/src/renderer/src/i18n/locales
git commit -m "Open the metadata review of the list from the Tracks menu and the palette"
```

---

### Task 11: Verificación en la app real, sobre una copia desechable

**Files:** ninguno. Si aparece un fallo, se vuelve a la tarea dueña con un test rojo primero.

Nunca sobre las bibliotecas reales: ni `~/Library/Pioneer`, ni la `Engine Library` del usuario, ni su `collection.nml`, ni su carpeta de música original.

- [ ] **Step 1: Preparar la copia**

```bash
SRC="<carpeta que indique el usuario>"
DEST="$HOME/Music/surco-prueba-lista"
mkdir -p "$DEST/libs"
cp -R "$SRC"/. "$DEST/"            # copia, nunca mover
cp ~/Library/Pioneer/rekordbox/master.db "$DEST/libs/master.db"   # solo si el usuario lo autoriza
```

Romper a propósito dos grafías en la copia (`Dj Lara` en una pista, un espacio doble en otra) y duplicar una pista con otro nombre (`cp "a.aiff" "a (Original Mix).aiff"`), dejando una tercera en MP3 para que la calidad difiera.

- [ ] **Step 2: Arrancar con bibliotecas apuntando a copias**

Con la skill `run-desktop` desde este worktree (ojo a que el driver abre el `out/` del árbol desde el que se lanza), userData aislado, y en Ajustes: `rekordboxDbPath` → `$DEST/libs/master.db`, `engineLibraryDir` → una copia en `$DEST/libs`, `traktorNmlPath` → una copia del `.nml` en `$DEST/libs`, sincronizaciones activas. "Añadir a Apple Music" apagado y Music cerrada.

- [ ] **Step 3: Revisar**

Arrastrar `$DEST`, esperar a que terminen las lecturas, analizar la calidad de dos de los duplicados y dejar uno sin analizar. Pistas → "Revisar metadatos de la lista…". Comprobar: línea de alcance con el número de pistas y "Apple Music no se ha consultado"; los grupos rotos a propósito; en el duplicado, calidad medida, "Sin analizar", tamaño, y la copia por defecto la de mejor calidad.

- [ ] **Step 4: Aplicar y deshacer**

Unificar y quitar el duplicado; confirmar. Verificar:
- en el fichero, con `snapshotTags`, solo el campo cambiado y los cues intactos;
- en Copias de seguridad, una entrada por fichero escrito;
- en la copia de rekordbox, el artista nuevo y las playlists del duplicado en la copia que se queda;
- el fichero quitado en la Papelera (o en Copias de seguridad si `$DEST` está en un volumen sin Papelera) y su fila fuera de la lista;
- Deshacer devuelve fichero y bibliotecas; el duplicado no vuelve y la hoja lo dice.

- [ ] **Step 5: Apple Music, solo con permiso explícito**

Si el usuario lo autoriza: añadir dos ficheros de `$DEST` a Music, repetir con Music abierta y comprobar la marca "Apple Music", la corrección de su entrada, y que el duplicado sale de Music con sus playlists pasadas a la copia que se queda. Borrar después esas entradas de prueba de Music a mano.

- [ ] **Step 6: Informe**

Qué se probó, qué no y lo que se vio, con capturas. Sin merge hasta el visto bueno del usuario.

---

## Self-Review

- **Cobertura del spec**: entrada y plataformas (Task 10); fuente desde la lista, filas fuera y su cuenta (Tasks 3, 8, 9); guarda en el fichero (Task 5); motor y vista generalizados con la copia por fuente (Tasks 1, 9); grafía al fichero, bibliotecas y Music (Tasks 5, 8); filas parcheadas (Task 10); duplicados con calidad, tamaño, álbum, duración, fichero y presencia (Task 9); orden de borrado y reglas de cierre (Task 6); ignorados aparte (Task 7); Deshacer (Task 8); coste (Task 2); textos (Task 9); verificación manual (Task 11).
- **Placeholders**: ninguno; el único condicional es la línea alternativa del test de App sobre `appleMusicFileEntries`, con el código para cada caso.
- **Tipos**: `ReviewEntry`, `ReviewFix`, `ReviewOutcome` (Task 1); `MusicFileEntry`, `MusicFileLookup` (Task 4); `ListFixRequest` (Task 5); `ListMusicRef`, `ListRemoval`, `ListMusicStep` (Task 6); `ReviewSource` con `inMusic`, `facts`, `settle` (Task 8) y `REVIEW_COPY` (Task 9). Los nombres coinciden entre tareas.
- **Review Focus**: cada línea tiene su test en la tarea dueña (3, 6, 6 y 8, 5, 6).
