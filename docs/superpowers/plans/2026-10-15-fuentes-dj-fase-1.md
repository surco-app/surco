# Fuentes DJ, fase 1: navegar playlists de rekordbox (y Music) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un carril de fuentes y un árbol de playlists a la izquierda de la lista; al elegir una playlist de rekordbox (o de Apple Music) la lista enseña sus pistas en su orden, con los separadores como una línea, y todo Surco funciona sobre ellas.

**Architecture:** main lee `master.db` en solo lectura (`rekordboxPlaylists.ts`) y lo expone por tres IPC `rekordbox:*`. El renderer adapta rekordbox y Music a un contrato común (`SourceNode`, `SourcePlaylistEntry`), un hook (`useSourceBrowser`) guarda qué fuente y playlist están abiertas, y `useTrackLibrary.openSourcePlaylist` carga las pistas por el mismo `addPaths` de siempre. La lista visible se acota con `playlistView` ANTES del pipeline de filtros/orden que ya existe, así ningún flujo de después sabe de dónde vino la pista.

**Tech Stack:** Electron + React 19 + TS, TanStack Query, Tailwind v4, vitest + Testing Library, `better-sqlite3-multiple-ciphers` (SQLCipher), biome.

**Spec:** `docs/superpowers/specs/2026-10-15-fuentes-dj-playlists-design.md` (fase 1).

## Global Constraints

- rekordbox se abre SIEMPRE con `openRekordboxDb(path, { readonly: true })` y se cierra en `finally`. Fase 1 no escribe nada en ninguna colección.
- Playlists: `djmdPlaylist.Attribute` 0 = playlist, 1 = carpeta, cualquier otro valor se excluye (el −128 "Trial playlist - Cloud Library Sync"). Filas con `rb_local_deleted = 1` se excluyen en `djmdPlaylist`, `djmdSongPlaylist` y `djmdContent`. Raíz: `ParentID = 'root'`. Orden de hermanos por `Seq`; orden de pistas por `TrackNo`.
- Separador = fila de `djmdContent` con `Length <= 2` y título vacío o solo espacios. Regla por contenido, nunca por ruta.
- Streaming = `FileType = 25`: entra como entrada sin fichero (`path: null`).
- BPM en rekordbox es ×100 (`15000` → `"150"`, `13807` → `"138.07"`). Rating en rekordbox 0..5; en el contrato viaja en la escala de Music 0..100 (×20) para reutilizar `fillFromAppleMusic`. Tono: `djmdKey.ScaleName` tal cual.
- Regla de datos: el fichero gana; rekordbox solo rellena huecos (bpm, key, rating). Nada más se rellena en fase 1.
- Textos de UI en los 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`); sin guion largo ni dos puntos explicativos en los textos.
- Selectores de test: `data-testid` siempre.
- Comentarios: el repo documenta el PORQUÉ con comentarios en casi cada bloque (ver `rekordboxDb.ts`, `appleMusicPlaylists.ts`). Se sigue esa convención del repo, que choca con el "zero comments" de las reglas globales: conformidad con el código existente gana, y se señala aquí para que nadie la "arregle".
- Tests desde `apps/desktop` del worktree: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <ruta>` (el worktree no tiene `node_modules` propio; NO filtrar desde la raíz, se salta el setup). Tipos: `npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit` y `... -p tsconfig.node.json --noEmit` (el `tsc` pelado no comprueba nada). Lint: `npm exec --workspace apps/desktop -- biome lint src`.
- Commits: título descriptivo en inglés, sin cuerpo, sin `feat:`. Uno por tarea.

## Desviaciones conscientes respecto a la spec

1. **IPC por fuente en vez de genéricos.** Music ya tiene sus IPC (`loadAppleMusicPlaylists`, `loadAppleMusicPlaylistTracks`); adaptarlos en el renderer evita tocar su main. El contrato común vive en el renderer. rekordbox estrena `rekordbox:available|tree|playlist`.
2. **Refresco al recuperar el foco, sin vigilar el mtime.** Mismo patrón que `useLibraryMembership` (`useWindowFocus` + invalidar). Cambiar algo en rekordbox implica estar en rekordbox, y volver a Surco es un foco. Si hiciera falta, el watcher se añade después.
3. **Cambiar de playlist no pierde ediciones**: verificado en el código. Las pistas se acumulan en la lista de trabajo (`tracks`, indexadas por `inputPath`) y `playlistView` solo acota y ordena; "Pistas" en el carril enseña la lista entera, como hoy.

## Review Focus

1. **La misma pista dos veces en una playlist**: se ve una vez, en su primera posición; nunca dos filas con el mismo id.
2. **Una playlist cuyas pistas ya estaban cargadas** (abrir Factory después de "Todas"): no sale el aviso de "N pistas ya estaban en la lista" ni se reinician sus ediciones.
3. **Ruta con distinta normalización Unicode** (NAS en NFD, Surco en NFC): la pista de la playlist se encuentra igual en la lista.
4. **Playlist vacía o solo con separadores**: lista vacía con el estado vacío, sin error ni separadores huérfanos.
5. **rekordbox no instalado o colección ilegible**: el carril no enseña rekordbox; en Windows sin rekordbox no hay carril.

Cada línea tiene su test en la tarea dueña (Tareas 1, 3 y 6).

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `src/shared/types.ts` (mod) | `PlaylistSource`, `SourceNode`, `SourcePlaylistEntry`; `key?` en `AppleMusicTrackMeta` |
| `src/main/rekordboxPlaylistsFixture.ts` (nuevo) | construye un `master.db` cifrado mínimo con playlists para tests |
| `src/main/rekordboxPlaylists.ts` (nuevo) | lee árbol y entradas de una playlist |
| `src/main/rekordboxPlaylistsIpc.ts` (nuevo) | `withCollection` + registro de los 3 IPC |
| `src/main/index.ts` (mod) | registra el IPC |
| `src/preload/api.ts`, `src/preload/index.ts` (mod) | `rekordboxAvailable`, `loadRekordboxTree`, `loadRekordboxPlaylist` |
| `src/renderer/src/lib/appleMusicFill.ts` (mod) | rellena también `key` |
| `src/renderer/src/lib/playlistView.ts` (nuevo) | acota y ordena la lista a una playlist, calcula separadores |
| `src/renderer/src/lib/appleMusicSource.ts` (nuevo) | Music → `SourceNode[]` y `SourcePlaylistEntry[]` |
| `src/renderer/src/components/SourceRail.tsx` (nuevo) | carril de fuentes |
| `src/renderer/src/components/SourceTree.tsx` (nuevo) | árbol de carpetas y playlists con buscador |
| `src/renderer/src/components/PlaylistHeading.tsx` (nuevo) | cabecera "rekordbox › COMBOS / Factory · 76 pistas · 28 separadores" |
| `src/renderer/src/hooks/useSourceBrowser.ts` (nuevo) | fuente/playlist abiertas + consultas |
| `src/renderer/src/hooks/useTrackLibrary.ts` (mod) | `openSourcePlaylist`; en la Tarea 8 se va `importApplePlaylist` |
| `src/renderer/src/components/TrackList.tsx` (mod) | línea discontinua antes de las filas marcadas |
| `src/renderer/src/App.tsx` (mod) | carril + árbol + cabecera, lista acotada |
| `src/renderer/src/i18n/locales/*.json` (mod) | textos `sources.*` |

---

### Task 1: Leer playlists de rekordbox

**Files:**
- Modify: `src/shared/types.ts` (junto a `AppleMusicTrackMeta`, ~línea 964)
- Create: `src/main/rekordboxPlaylistsFixture.ts`
- Create: `src/main/rekordboxPlaylists.ts`
- Test: `src/main/rekordboxPlaylists.test.ts`

**Interfaces:**
- Produces:
  - `type PlaylistSource = 'appleMusic' | 'rekordbox'`
  - `interface SourceNode { id: string; name: string; kind: 'folder' | 'playlist'; count: number; children?: SourceNode[] }` (playlist: pistas reales sin separadores; carpeta: hijos directos)
  - `interface SourcePlaylistEntry { path: string | null; separator: boolean; meta: AppleMusicTrackMeta; musicPersistentId?: string }`
  - `AppleMusicTrackMeta.key?: string`
  - `readRekordboxTree(db: RekordboxDb): SourceNode[]`
  - `readRekordboxPlaylist(db: RekordboxDb, id: string): SourcePlaylistEntry[]`
  - `writeRekordboxPlaylistFixture(path: string, data: PlaylistFixture): void`

- [ ] **Step 1: Tipos del contrato**

En `src/shared/types.ts`, dentro de `AppleMusicTrackMeta` añade tras `bpm?: string`:

```ts
  // The musical key, as the source spells it ("4B", "Am"). Only rekordbox supplies one:
  // Music has no key field.
  key?: string
```

Y justo después de la interfaz `AppleMusicPlaylistTracks`:

```ts
// Where a crate of playlists comes from. Engine DJ and Traktor join in a later phase with
// the same shapes.
export type PlaylistSource = 'appleMusic' | 'rekordbox'

// One row of a source's playlist tree. A playlist counts its real tracks, separators left
// out, because that is the number the user sees in the list; a folder counts its direct
// children, as rekordbox's own tree does.
export interface SourceNode {
  id: string
  name: string
  kind: 'folder' | 'playlist'
  count: number
  children?: SourceNode[]
}

// One row of a playlist, in the playlist's own order. A separator is a placeholder file the
// DJ drops between blocks (measured: one blank 1 s MP3 linked 345 times), kept so the list
// can draw the break but never loaded as a track. A null path is a row with no file
// (streaming), counted but not loadable.
export interface SourcePlaylistEntry {
  path: string | null
  separator: boolean
  // What the source knows that the file may not. Same shape and scale as Music's (rating
  // 0-100), so one fill rule serves every source.
  meta: AppleMusicTrackMeta
  musicPersistentId?: string
}
```

- [ ] **Step 2: Fixture**

Crea `src/main/rekordboxPlaylistsFixture.ts`:

```ts
import Database from 'better-sqlite3-multiple-ciphers'
import { REKORDBOX_KEY } from './rekordboxDb'

// A miniature master.db with the tables and columns the playlist reader touches, encrypted
// like the real one. The column names come from a live rekordbox 7 collection; the shapes
// worth reproducing are the ones measured there: nested folders whose children repeat names,
// one blank separator file linked many times, a streaming row, soft-deleted rows, and the
// −128 cloud-sync trial playlist.
export interface FixtureContent {
  ID: string
  FolderPath: string
  FileType: number
  Title: string
  Length: number
  BPM?: number
  Rating?: number
  KeyID?: string
  deleted?: boolean
}

export interface FixturePlaylist {
  ID: string
  Name: string
  Attribute: number
  ParentID: string
  Seq: number
  deleted?: boolean
}

export interface FixtureLink {
  PlaylistID: string
  ContentID: string
  TrackNo: number
  deleted?: boolean
}

export interface PlaylistFixture {
  content: FixtureContent[]
  keys: { ID: string; ScaleName: string }[]
  playlists: FixturePlaylist[]
  links: FixtureLink[]
}

export function writeRekordboxPlaylistFixture(path: string, data: PlaylistFixture): void {
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  db.exec(`
    CREATE TABLE djmdContent (ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255),
      FileType INTEGER, Title VARCHAR(255), Length INTEGER, BPM INTEGER, Rating INTEGER,
      KeyID VARCHAR(255), rb_local_deleted INTEGER DEFAULT 0);
    CREATE TABLE djmdKey (ID VARCHAR(255) PRIMARY KEY, ScaleName VARCHAR(255));
    CREATE TABLE djmdPlaylist (ID VARCHAR(255) PRIMARY KEY, Seq INTEGER, Name VARCHAR(255),
      Attribute INTEGER, ParentID VARCHAR(255), rb_local_deleted INTEGER DEFAULT 0);
    CREATE TABLE djmdSongPlaylist (ID VARCHAR(255) PRIMARY KEY, PlaylistID VARCHAR(255),
      ContentID VARCHAR(255), TrackNo INTEGER, rb_local_deleted INTEGER DEFAULT 0);
  `)
  const content = db.prepare(
    'INSERT INTO djmdContent VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  for (const c of data.content) {
    content.run(c.ID, c.FolderPath, c.FileType, c.Title, c.Length, c.BPM ?? 0, c.Rating ?? 0,
      c.KeyID ?? null, c.deleted ? 1 : 0)
  }
  const key = db.prepare('INSERT INTO djmdKey VALUES (?, ?)')
  for (const k of data.keys) key.run(k.ID, k.ScaleName)
  const playlist = db.prepare('INSERT INTO djmdPlaylist VALUES (?, ?, ?, ?, ?, ?)')
  for (const p of data.playlists) {
    playlist.run(p.ID, p.Seq, p.Name, p.Attribute, p.ParentID, p.deleted ? 1 : 0)
  }
  const link = db.prepare('INSERT INTO djmdSongPlaylist VALUES (?, ?, ?, ?, ?)')
  data.links.forEach((l, i) => {
    link.run(`link-${i}`, l.PlaylistID, l.ContentID, l.TrackNo, l.deleted ? 1 : 0)
  })
  db.close()
}
```

- [ ] **Step 3: Test que falla**

Crea `src/main/rekordboxPlaylists.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { readRekordboxPlaylist, readRekordboxTree } from './rekordboxPlaylists'
import { writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

// Shapes measured on a real 2067-track collection (15/10): folders nested two deep whose
// playlists repeat names ("Todas" under CANTADITAS › 90s and BASES › 90s), one blank
// separator MP3 linked hundreds of times, and a −128 cloud-sync trial playlist.
const SEP = { ID: 'sep', FolderPath: '/Users/dj/Music/PioneerDJ/Blank Audio/_.mp3', FileType: 1, Title: ' ', Length: 1, KeyID: 'k1' }
const NIGHT = { ID: 'c1', FolderPath: '/Volumes/Public/Music/Rebel Vision/Night Train.aiff', FileType: 12, Title: 'Night Train (Extended Mix)', Length: 256, BPM: 15000, Rating: 0, KeyID: 'k1' }
const PLAY = { ID: 'c2', FolderPath: '/Volumes/Public/Music/2 Fabiola/Play This Song.wav', FileType: 11, Title: 'Play This Song (Transformix)', Length: 338, BPM: 13807, Rating: 5, KeyID: 'k2' }
const SPOTIFY = { ID: 'c3', FolderPath: 'spotify:track:0OTO8ZF2YqFQVw9hnZylTd', FileType: 25, Title: 'Streamed', Length: 200 }
const GONE = { ID: 'c4', FolderPath: '/Volumes/Public/Music/gone.wav', FileType: 11, Title: 'Gone', Length: 300, deleted: true }

let db: NonNullable<ReturnType<typeof openRekordboxDb>>

beforeAll(async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbpl-')), 'master.db')
  writeRekordboxPlaylistFixture(path, {
    content: [SEP, NIGHT, PLAY, SPOTIFY, GONE],
    keys: [{ ID: 'k1', ScaleName: '4B' }, { ID: 'k2', ScaleName: '8A' }],
    playlists: [
      { ID: 'combos', Name: 'COMBOS', Attribute: 1, ParentID: 'root', Seq: 2 },
      { ID: 'factory', Name: 'Factory', Attribute: 0, ParentID: 'combos', Seq: 2 },
      { ID: 'nineties', Name: '90s', Attribute: 0, ParentID: 'combos', Seq: 1 },
      { ID: 'cant', Name: 'CANTADITAS', Attribute: 1, ParentID: 'root', Seq: 1 },
      { ID: 'cant90', Name: '90s', Attribute: 1, ParentID: 'cant', Seq: 1 },
      { ID: 'cant90todas', Name: 'Todas', Attribute: 0, ParentID: 'cant90', Seq: 1 },
      { ID: 'house', Name: 'House', Attribute: 0, ParentID: 'root', Seq: 3 },
      { ID: 'trial', Name: 'Trial playlist - Cloud Library Sync', Attribute: -128, ParentID: 'root', Seq: 4 },
      { ID: 'old', Name: 'Borrada', Attribute: 0, ParentID: 'root', Seq: 5, deleted: true },
    ],
    links: [
      { PlaylistID: 'factory', ContentID: 'c1', TrackNo: 1 },
      { PlaylistID: 'factory', ContentID: 'sep', TrackNo: 2 },
      { PlaylistID: 'factory', ContentID: 'c2', TrackNo: 3 },
      { PlaylistID: 'factory', ContentID: 'c3', TrackNo: 4 },
      { PlaylistID: 'factory', ContentID: 'c4', TrackNo: 5 },
      { PlaylistID: 'factory', ContentID: 'c2', TrackNo: 6, deleted: true },
      { PlaylistID: 'cant90todas', ContentID: 'c2', TrackNo: 1 },
    ],
  })
  const opened = openRekordboxDb(path, { readonly: true })
  if (!opened) throw new Error('fixture did not open')
  db = opened
})

afterAll(() => db.close())

describe('readRekordboxTree', () => {
  it('nests folders and orders siblings by Seq, as rekordbox shows them', () => {
    const tree = readRekordboxTree(db)
    expect(tree.map((n) => n.name)).toEqual(['CANTADITAS', 'COMBOS', 'House'])
    const combos = tree[1]
    expect(combos.kind).toBe('folder')
    expect(combos.children?.map((n) => n.name)).toEqual(['90s', 'Factory'])
    expect(tree[0].children?.[0].children?.[0]).toMatchObject({ id: 'cant90todas', name: 'Todas', kind: 'playlist' })
  })

  it('counts only real tracks, so the number matches the rows the list will show', () => {
    // Factory links a track, a separator, another track, a streaming row, a deleted track
    // and a deleted link: the user sees the two tracks and the streaming row's absence.
    const factory = readRekordboxTree(db)[1].children?.[1]
    expect(factory?.count).toBe(3)
  })

  it('leaves out the cloud-sync trial row and deleted playlists, which rekordbox does not list', () => {
    const names = readRekordboxTree(db).map((n) => n.name)
    expect(names).not.toContain('Trial playlist - Cloud Library Sync')
    expect(names).not.toContain('Borrada')
  })
})

describe('readRekordboxPlaylist', () => {
  it('returns the rows in TrackNo order with the separator in place', () => {
    const rows = readRekordboxPlaylist(db, 'factory')
    expect(rows.map((r) => [r.path, r.separator])).toEqual([
      [NIGHT.FolderPath, false],
      [SEP.FolderPath, true],
      [PLAY.FolderPath, false],
      [null, false],
    ])
  })

  it('carries what rekordbox knows in the shared scale: bpm unscaled, key as spelled, rating ×20', () => {
    const [night, , play] = readRekordboxPlaylist(db, 'factory')
    expect(night.meta).toEqual({ bpm: '150', key: '4B' })
    expect(play.meta).toEqual({ bpm: '138.07', key: '8A', rating: 100 })
  })

  it('returns nothing for a playlist that is not there, rather than throwing', () => {
    expect(readRekordboxPlaylist(db, 'missing')).toEqual([])
  })
})
```

- [ ] **Step 4: Verlo fallar**

Run (desde `apps/desktop` del worktree): `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylists.test.ts`
Expected: FAIL, `Failed to resolve import "./rekordboxPlaylists"`.

- [ ] **Step 5: Implementación**

Crea `src/main/rekordboxPlaylists.ts`:

```ts
import type { openRekordboxDb } from './rekordboxDb'
import type { AppleMusicTrackMeta, SourceNode, SourcePlaylistEntry } from '../shared/types'

// Reads the user's rekordbox playlists as a source of tracks: the folder tree and one
// playlist's rows. Read-only by construction — every caller opens the collection with
// { readonly: true } — so browsing can never be what damages a collection.

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

// Same streaming marker rekordboxDb.ts excludes from lookups.
const STREAMING_FILE_TYPE = 25

// A separator is recognised by what it is, not where it lives: the user's is a blank
// 1 s MP3 under PioneerDJ/Imported from Device, linked 345 times, and another DJ's will
// sit anywhere. Length is in whole seconds.
const IS_SEPARATOR = `(c.Length <= 2 AND trim(coalesce(c.Title, '')) = '')`
const LIVE_LINK = `s.rb_local_deleted = 0 AND coalesce(c.rb_local_deleted, 0) = 0`

interface PlaylistRow {
  ID: string
  Name: string
  Attribute: number
  ParentID: string
  n: number
}

export function readRekordboxTree(db: RekordboxDb): SourceNode[] {
  const rows = db
    .prepare(
      `SELECT p.ID, p.Name, p.Attribute, p.ParentID,
              (SELECT count(*) FROM djmdSongPlaylist s JOIN djmdContent c ON c.ID = s.ContentID
                WHERE s.PlaylistID = p.ID AND ${LIVE_LINK} AND NOT ${IS_SEPARATOR}) AS n
         FROM djmdPlaylist p
        WHERE coalesce(p.rb_local_deleted, 0) = 0 AND p.Attribute IN (0, 1)
        ORDER BY p.Seq`,
    )
    .all() as PlaylistRow[]
  const byParent = new Map<string, PlaylistRow[]>()
  for (const r of rows) {
    const siblings = byParent.get(String(r.ParentID)) ?? []
    siblings.push(r)
    byParent.set(String(r.ParentID), siblings)
  }
  const build = (parent: string): SourceNode[] =>
    (byParent.get(parent) ?? []).map((r) => {
      if (r.Attribute === 1) {
        const children = build(String(r.ID))
        return { id: String(r.ID), name: r.Name, kind: 'folder', count: children.length, children }
      }
      return { id: String(r.ID), name: r.Name, kind: 'playlist', count: r.n }
    })
  return build('root')
}

interface EntryRow {
  FolderPath: string
  FileType: number
  BPM: number | null
  Rating: number | null
  ScaleName: string | null
  sep: number
}

// rekordbox stores BPM ×100 (13807 is 138.07). Trailing zeros are dropped so a whole
// tempo reads "150", the way Surco's own bpm field holds it.
function bpmText(raw: number | null): string | undefined {
  return raw && raw > 0 ? String(Number((raw / 100).toFixed(2))) : undefined
}

function metaOf(row: EntryRow): AppleMusicTrackMeta {
  const meta: AppleMusicTrackMeta = {}
  const bpm = bpmText(row.BPM)
  if (bpm) meta.bpm = bpm
  if (row.ScaleName?.trim()) meta.key = row.ScaleName.trim()
  // 0..5 stars in rekordbox; the shared shape uses Music's 0..100 so one fill rule serves
  // both sources.
  if (row.Rating && row.Rating > 0) meta.rating = row.Rating * 20
  return meta
}

export function readRekordboxPlaylist(db: RekordboxDb, id: string): SourcePlaylistEntry[] {
  const rows = db
    .prepare(
      `SELECT c.FolderPath, c.FileType, c.BPM, c.Rating, k.ScaleName, ${IS_SEPARATOR} AS sep
         FROM djmdSongPlaylist s
         JOIN djmdContent c ON c.ID = s.ContentID
         LEFT JOIN djmdKey k ON k.ID = c.KeyID
        WHERE s.PlaylistID = ? AND ${LIVE_LINK}
        ORDER BY s.TrackNo`,
    )
    .all(id) as EntryRow[]
  return rows.map((row) => {
    if (row.sep) return { path: row.FolderPath, separator: true, meta: {} }
    if (row.FileType === STREAMING_FILE_TYPE) return { path: null, separator: false, meta: {} }
    return { path: row.FolderPath, separator: false, meta: metaOf(row) }
  })
}
```

- [ ] **Step 6: Verlo pasar**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylists.test.ts`
Expected: PASS (6 tests). El 3 de Factory incluye la fila de streaming a propósito: rekordbox la cuenta en su playlist y la cabecera la cuenta como pista (sin fichero), igual que Music cuenta las suyas.

- [ ] **Step 7: Mutación** (regla del repo: un test no vale hasta verlo matar una mutación)

Cambia temporalmente `c.Length <= 2` por `c.Length <= 0`, corre el test: debe FALLAR el de orden con separador. Restaura. Cambia `p.Attribute IN (0, 1)` por `p.Attribute IN (0, 1, -128)`: debe fallar el de la fila de prueba. Restaura.

- [ ] **Step 8: Tipos y commit**

Run: `npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit` → sin errores.

```bash
git add src/shared/types.ts src/main/rekordboxPlaylists.ts src/main/rekordboxPlaylists.test.ts src/main/rekordboxPlaylistsFixture.ts
git commit -m "Read rekordbox playlists and their rows from the collection, read-only"
```

---

### Task 2: IPC y preload de rekordbox

**Files:**
- Create: `src/main/rekordboxPlaylistsIpc.ts`
- Test: `src/main/rekordboxPlaylistsIpc.test.ts`
- Modify: `src/main/index.ts` (junto a `registerAppleMusicIpc`, ~línea 845)
- Modify: `src/preload/api.ts` (junto a `loadAppleMusicPlaylistTracks`, ~línea 178), `src/preload/index.ts` (~línea 163)

**Interfaces:**
- Consumes: `readRekordboxTree`, `readRekordboxPlaylist`, `writeRekordboxPlaylistFixture` (Tarea 1); `openRekordboxDb` y `findRekordboxCollection` existentes.
- Produces: `window.api.rekordboxAvailable(): Promise<boolean>`, `window.api.loadRekordboxTree(): Promise<SourceNode[]>`, `window.api.loadRekordboxPlaylist(id: string): Promise<SourcePlaylistEntry[]>`; `withCollection<T>(path, read, fallback): T`.

- [ ] **Step 1: Test que falla**

`src/main/rekordboxPlaylistsIpc.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { withCollection } from './rekordboxPlaylistsIpc'
import { writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

describe('withCollection', () => {
  it('falls back when there is no collection, the normal case for a user without rekordbox', () => {
    expect(withCollection('', () => 'read', 'none')).toBe('none')
  })

  it('falls back when the file is not a rekordbox database instead of throwing at the renderer', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    await writeFile(path, 'not a database')
    expect(withCollection(path, () => 'read', 'none')).toBe('none')
  })

  it('reads a real collection', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { content: [], keys: [], playlists: [], links: [] })
    expect(withCollection(path, () => 'read', 'none')).toBe('read')
  })

  it('falls back when the read itself fails, so a schema rekordbox changed does not crash the tree', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { content: [], keys: [], playlists: [], links: [] })
    expect(withCollection(path, () => { throw new Error('no such column') }, 'none')).toBe('none')
  })
})
```

- [ ] **Step 2: Verlo fallar**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistsIpc.test.ts`
Expected: FAIL, no resuelve `./rekordboxPlaylistsIpc`.

- [ ] **Step 3: Implementación**

`src/main/rekordboxPlaylistsIpc.ts`:

```ts
import { ipcMain } from 'electron'
import log from 'electron-log/main'
import { openRekordboxDb } from './rekordboxDb'
import { readRekordboxPlaylist, readRekordboxTree } from './rekordboxPlaylists'

// Opens the collection read-only for one read and always closes it: rekordbox may be
// running, and a handle left open is a lock it never asked for. Every way the read can
// fail — no collection, not decryptable, a column a future rekordbox renamed — answers
// with the fallback, because the renderer shows "no rekordbox" for all of them and a
// throw would only reach it as an unhandled IPC rejection.
export function withCollection<T>(
  path: string,
  read: (db: NonNullable<ReturnType<typeof openRekordboxDb>>) => T,
  fallback: T,
): T {
  if (!path) return fallback
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) return fallback
  try {
    return read(db)
  } catch (err) {
    log.warn(`rekordbox playlist read failed: ${String(err)}`)
    return fallback
  } finally {
    db.close()
  }
}

// The collection path is resolved on every call, not captured once: the user can change
// the override in Settings while Surco runs.
export function registerRekordboxPlaylistsIpc(collection: () => string): void {
  ipcMain.handle('rekordbox:available', () => withCollection(collection(), () => true, false))
  ipcMain.handle('rekordbox:tree', () => withCollection(collection(), readRekordboxTree, []))
  ipcMain.handle('rekordbox:playlist', (_e, id: string) =>
    withCollection(collection(), (db) => readRekordboxPlaylist(db, id), []),
  )
}
```

En `src/main/index.ts`, junto a los imports de `./appleMusicIpc` añade `import { registerRekordboxPlaylistsIpc } from './rekordboxPlaylistsIpc'`, y tras la línea `registerAppleMusicIpc({ ... })`:

```ts
  registerRekordboxPlaylistsIpc(() =>
    findRekordboxCollection({ configured: getSettings().rekordboxDbPath }),
  )
```

(`findRekordboxCollection` y `getSettings` ya están importados en `index.ts`; compruébalo con `grep -n "findRekordboxCollection\|getSettings" src/main/index.ts | head -3`.)

En `src/preload/api.ts`, tras `loadAppleMusicPlaylistTracks`:

```ts
  // Whether this machine has a rekordbox collection Surco can read. False for a user
  // without rekordbox, the normal case: the source then simply is not offered.
  rekordboxAvailable: () => Promise<boolean>
  // The collection's folder and playlist tree, read-only. Empty when unreadable.
  loadRekordboxTree: () => Promise<SourceNode[]>
  // One playlist's rows in order, separators and file-less rows included.
  loadRekordboxPlaylist: (id: string) => Promise<SourcePlaylistEntry[]>
```

(añade `SourceNode` y `SourcePlaylistEntry` al `import type` de `../shared/types` de ese fichero.) En `src/preload/index.ts`, tras `loadAppleMusicPlaylistTracks`:

```ts
  rekordboxAvailable: (): Promise<boolean> => ipcRenderer.invoke('rekordbox:available'),
  loadRekordboxTree: (): Promise<SourceNode[]> => ipcRenderer.invoke('rekordbox:tree'),
  loadRekordboxPlaylist: (id: string): Promise<SourcePlaylistEntry[]> =>
    ipcRenderer.invoke('rekordbox:playlist', id),
```

(mismos tipos al `import type` de ese fichero.)

- [ ] **Step 4: Verlo pasar**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistsIpc.test.ts` → PASS (4).
Run: los dos `tsc` (node y web) → sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/main/rekordboxPlaylistsIpc.ts src/main/rekordboxPlaylistsIpc.test.ts src/main/index.ts src/preload/api.ts src/preload/index.ts
git commit -m "Expose the rekordbox playlist tree and rows to the renderer"
```

---

### Task 3: Vista de una playlist sobre la lista, y relleno del tono

**Files:**
- Modify: `src/renderer/src/lib/appleMusicFill.ts` (array `FILLABLE`)
- Test: `src/renderer/src/lib/appleMusicFill.test.ts` (existe; añade casos)
- Create: `src/renderer/src/lib/playlistView.ts`
- Test: `src/renderer/src/lib/playlistView.test.ts`

**Interfaces:**
- Consumes: `SourcePlaylistEntry` (Tarea 1), `TrackItem` (`../types`).
- Produces: `playlistView(tracks: TrackItem[], entries: SourcePlaylistEntry[]): { tracks: TrackItem[]; separatorBefore: ReadonlySet<string> }`; `playlistCounts(entries): { tracks: number; separators: number }`.

- [ ] **Step 1: Test que falla del tono**

En `src/renderer/src/lib/appleMusicFill.test.ts`, dentro del `describe` de `fillFromAppleMusic` (usa el helper de metadatos que ya usa ese fichero; si construye con `emptyMetadata()`, igual):

```ts
  it('fills the key from the source when the file has none, so the converted file carries it', () => {
    // rekordbox keys every track (2067 of 2067 measured) while files often carry none, and
    // Engine and Traktor read the key from the tag.
    expect(fillFromAppleMusic({ ...emptyMetadata(), key: '' }, { key: '4B' }).key).toBe('4B')
  })

  it('keeps the file key over the source one: the file is what every other tool reads', () => {
    expect(fillFromAppleMusic({ ...emptyMetadata(), key: '8A' }, { key: '4B' }).key).toBe('8A')
  })
```

- [ ] **Step 2: Verlo fallar**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/appleMusicFill.test.ts`
Expected: FAIL el primero (`''` en vez de `'4B'`).

- [ ] **Step 3: Implementación**

En `appleMusicFill.ts` añade `'key',` al final de `FILLABLE` (tras `'bpm',`). Corre el test → PASS.

- [ ] **Step 4: Test que falla de la vista**

`src/renderer/src/lib/playlistView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SourcePlaylistEntry } from '../../../shared/types'
import type { TrackItem } from '../types'
import { playlistCounts, playlistView } from './playlistView'

function track(id: string, inputPath: string): TrackItem {
  return { id, inputPath } as TrackItem
}

function entry(path: string | null, separator = false): SourcePlaylistEntry {
  return { path, separator, meta: {} }
}

const A = track('a', '/m/A.wav')
const B = track('b', '/m/B.wav')
const C = track('c', '/m/C.wav')
const SEP = '/m/Blank Audio/_.mp3'

describe('playlistView', () => {
  it('shows only the playlist tracks, in the playlist order, not the order they were loaded', () => {
    const view = playlistView([A, B, C], [entry('/m/C.wav'), entry('/m/A.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['c', 'a'])
  })

  it('marks the track after each separator, so the list can draw the break', () => {
    const view = playlistView([A, B], [entry('/m/A.wav'), entry(SEP, true), entry('/m/B.wav')])
    expect([...view.separatorBefore]).toEqual(['b'])
  })

  it('collapses runs of separators and drops a trailing one: a break is a break', () => {
    const view = playlistView(
      [A, B],
      [entry(SEP, true), entry('/m/A.wav'), entry(SEP, true), entry(SEP, true), entry('/m/B.wav'), entry(SEP, true)],
    )
    expect([...view.separatorBefore].sort()).toEqual(['a', 'b'])
  })

  it('shows a track the playlist holds twice only once, at its first place', () => {
    const view = playlistView([A, B], [entry('/m/A.wav'), entry('/m/B.wav'), entry('/m/A.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('finds a track whose path the NAS spells decomposed', () => {
    const composed = track('n', '/m/Niña.wav')
    const view = playlistView([composed], [entry('/m/Niña.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['n'])
  })

  it('is empty for a playlist of only separators, with no orphan break', () => {
    const view = playlistView([A], [entry(SEP, true), entry(SEP, true)])
    expect(view.tracks).toEqual([])
    expect(view.separatorBefore.size).toBe(0)
  })

  it('skips rows not loaded yet instead of holding a gap', () => {
    const view = playlistView([B], [entry('/m/A.wav'), entry('/m/B.wav'), entry(null)])
    expect(view.tracks.map((t) => t.id)).toEqual(['b'])
  })
})

describe('playlistCounts', () => {
  it('counts real tracks apart from separators, file-less rows included as tracks', () => {
    expect(playlistCounts([entry('/m/A.wav'), entry(SEP, true), entry(null)])).toEqual({ tracks: 2, separators: 1 })
  })
})
```

- [ ] **Step 5: Verlo fallar**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/playlistView.test.ts` → FAIL (no resuelve el módulo).

- [ ] **Step 6: Implementación**

`src/renderer/src/lib/playlistView.ts`:

```ts
import type { SourcePlaylistEntry } from '../../../shared/types'
import type { TrackItem } from '../types'

// The crate narrowed to one playlist and put in the playlist's order. The crate itself is
// untouched — every loaded track keeps its edits whichever playlist is on screen — so this
// is a view, applied before the filters and sort the list already has.
//
// Paths are compared composed: the NAS stores names decomposed while Surco works composed
// (same rule as appleMusicPlaylists.entryForFile).
export function playlistView(
  tracks: TrackItem[],
  entries: SourcePlaylistEntry[],
): { tracks: TrackItem[]; separatorBefore: ReadonlySet<string> } {
  const byPath = new Map(tracks.map((t) => [t.inputPath.normalize('NFC'), t]))
  const shown: TrackItem[] = []
  const seen = new Set<string>()
  const separatorBefore = new Set<string>()
  let pendingBreak = false
  for (const e of entries) {
    if (e.separator) {
      pendingBreak = true
      continue
    }
    const t = e.path ? byPath.get(e.path.normalize('NFC')) : undefined
    if (!t || seen.has(t.id)) continue
    seen.add(t.id)
    shown.push(t)
    if (pendingBreak) separatorBefore.add(t.id)
    pendingBreak = false
  }
  return { tracks: shown, separatorBefore }
}

export function playlistCounts(entries: SourcePlaylistEntry[]): { tracks: number; separators: number } {
  const separators = entries.filter((e) => e.separator).length
  return { tracks: entries.length - separators, separators }
}
```

Nota: con un separador al principio (`[SEP, A, …]`) el test marca `a`; está bien, rekordbox lo pinta igual.

- [ ] **Step 7: Verlo pasar y mutar**

Run el test → PASS (8). Mutación: quita `.normalize('NFC')` de la clave del `Map` → debe fallar el test del NAS. Restaura.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/appleMusicFill.ts src/renderer/src/lib/appleMusicFill.test.ts src/renderer/src/lib/playlistView.ts src/renderer/src/lib/playlistView.test.ts
git commit -m "Narrow the list to a playlist in its own order and fill the key from the source"
```

---

### Task 4: Adaptador de Apple Music al contrato común

**Files:**
- Create: `src/renderer/src/lib/appleMusicSource.ts`
- Test: `src/renderer/src/lib/appleMusicSource.test.ts`

**Interfaces:**
- Consumes: `AppleMusicPlaylist`, `AppleMusicPlaylistTracks`, `SourceNode`, `SourcePlaylistEntry`.
- Produces: `musicTree(lists: AppleMusicPlaylist[]): SourceNode[]`, `musicEntries(t: AppleMusicPlaylistTracks): SourcePlaylistEntry[]`.

- [ ] **Step 1: Test que falla**

```ts
import { describe, expect, it } from 'vitest'
import { musicEntries, musicTree } from './appleMusicSource'

describe('musicTree', () => {
  it('puts root playlists first and groups the rest under their folder, the only thing telling repeated names apart', () => {
    const tree = musicTree([
      { name: '95', count: 10, persistentId: 'AAAAAAAAAAAAAAA1', folder: 'Bases' },
      { name: 'House', count: 32, persistentId: 'AAAAAAAAAAAAAAA2' },
      { name: '95', count: 4, persistentId: 'AAAAAAAAAAAAAAA3', folder: 'Cantaditas' },
    ])
    expect(tree.map((n) => [n.kind, n.name])).toEqual([
      ['playlist', 'House'],
      ['folder', 'Bases'],
      ['folder', 'Cantaditas'],
    ])
    expect(tree[1].children?.[0]).toEqual({ id: 'AAAAAAAAAAAAAAA1', name: '95', kind: 'playlist', count: 10 })
  })
})

describe('musicEntries', () => {
  it('carries the Music identity with each file, so converting updates that library copy', () => {
    const rows = musicEntries({
      paths: ['/m/a.wav'],
      persistentIds: { '/m/a.wav': 'PID0000000000001' },
      meta: { '/m/a.wav': { grouping: 'Bases' } },
      missing: 2,
    })
    expect(rows[0]).toEqual({
      path: '/m/a.wav',
      separator: false,
      meta: { grouping: 'Bases' },
      musicPersistentId: 'PID0000000000001',
    })
  })

  it('keeps the file-less rows as entries, so the count still says how many Music holds', () => {
    const rows = musicEntries({ paths: [], persistentIds: {}, meta: {}, missing: 2 })
    expect(rows).toEqual([
      { path: null, separator: false, meta: {} },
      { path: null, separator: false, meta: {} },
    ])
  })
})
```

- [ ] **Step 2: Verlo fallar** → `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/appleMusicSource.test.ts`, FAIL.

- [ ] **Step 3: Implementación**

```ts
import type {
  AppleMusicPlaylist,
  AppleMusicPlaylistTracks,
  SourceNode,
  SourcePlaylistEntry,
} from '../../../shared/types'

// Music's playlists in the shape every source shares. Music only reports the folder a
// playlist sits in, not the whole path, so the tree is one level deep; root playlists
// come first, as the old import dialog showed them, so none reads as belonging to the
// folder above it.
export function musicTree(lists: AppleMusicPlaylist[]): SourceNode[] {
  const root: SourceNode[] = []
  const folders = new Map<string, SourceNode[]>()
  for (const p of lists) {
    const node: SourceNode = { id: p.persistentId, name: p.name, kind: 'playlist', count: p.count }
    if (!p.folder) {
      root.push(node)
      continue
    }
    const children = folders.get(p.folder) ?? []
    children.push(node)
    folders.set(p.folder, children)
  }
  const grouped = [...folders].map(
    ([name, children]): SourceNode => ({ id: `folder:${name}`, name, kind: 'folder', count: children.length, children }),
  )
  return [...root, ...grouped]
}

// Music returns the files and, apart, how many rows had none; the shared shape keeps those
// as file-less entries so the heading can count them. Music has no separators.
export function musicEntries(t: AppleMusicPlaylistTracks): SourcePlaylistEntry[] {
  const rows: SourcePlaylistEntry[] = t.paths.map((path) => ({
    path,
    separator: false,
    meta: t.meta[path] ?? {},
    ...(t.persistentIds[path] ? { musicPersistentId: t.persistentIds[path] } : {}),
  }))
  for (let i = 0; i < t.missing; i++) rows.push({ path: null, separator: false, meta: {} })
  return rows
}
```

- [ ] **Step 4: Verlo pasar** → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/appleMusicSource.ts src/renderer/src/lib/appleMusicSource.test.ts
git commit -m "Adapt Apple Music playlists to the shared source shapes"
```

---

### Task 5: Carril de fuentes y árbol

**Files:**
- Create: `src/renderer/src/components/SourceRail.tsx`, `SourceRail.test.tsx`
- Create: `src/renderer/src/components/SourceTree.tsx`, `SourceTree.test.tsx`
- Modify: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json` (bloque nuevo `sources` al nivel de `applePlaylist`)

**Interfaces:**
- Consumes: `PlaylistSource`, `SourceNode`.
- Produces:
  - `SourceRail({ sources: PlaylistSource[]; active: PlaylistSource | null; onSelect: (s: PlaylistSource | null) => void })`
  - `SourceTree({ title: string; nodes: SourceNode[] | undefined; failed: boolean; selectedId: string | null; onSelect: (node: SourceNode, folders: string[]) => void })`

- [ ] **Step 1: Textos**

En `es.json`:

```json
  "sources": {
    "rail": "Fuentes",
    "workingList": "Pistas",
    "appleMusic": "Music",
    "rekordbox": "rekordbox",
    "search": "Buscar playlist",
    "loading": "Leyendo playlists…",
    "failed": "No se pudo leer la colección. Si acabas de cambiar algo, vuelve a Surco en unos segundos.",
    "empty": "No hay playlists.",
    "noMatch": "Ninguna playlist coincide.",
    "tracks_one": "{{count}} pista",
    "tracks_other": "{{count}} pistas",
    "separators_one": "{{count}} separador",
    "separators_other": "{{count}} separadores",
    "separator": "separador"
  },
```

`en.json`: `"rail": "Sources"`, `"workingList": "Tracks"`, `"appleMusic": "Music"`, `"rekordbox": "rekordbox"`, `"search": "Search playlists"`, `"loading": "Reading playlists…"`, `"failed": "Couldn't read the collection. If you just changed something, come back to Surco in a few seconds."`, `"empty": "No playlists."`, `"noMatch": "No playlist matches."`, `"tracks_one": "{{count}} track"`, `"tracks_other": "{{count}} tracks"`, `"separators_one": "{{count}} separator"`, `"separators_other": "{{count}} separators"`, `"separator": "separator"`.
`de` (mismo orden de claves que en): Quellen / Titel / Music / rekordbox / Playlist suchen / Playlists werden gelesen… / Die Sammlung konnte nicht gelesen werden. Wenn du gerade etwas geändert hast, kehre in ein paar Sekunden zu Surco zurück. / Keine Playlists. / Keine Playlist passt. / {{count}} Titel (one y other) / {{count}} Trenner (one y other) / Trenner.
`fr`: Sources / Morceaux / Music / rekordbox / Rechercher une playlist / Lecture des playlists… / Impossible de lire la collection. Si tu viens de modifier quelque chose, reviens dans Surco dans quelques secondes. / Aucune playlist. / Aucune playlist ne correspond. / {{count}} morceau, {{count}} morceaux / {{count}} séparateur, {{count}} séparateurs / séparateur.
`pt-BR`: Fontes / Faixas / Music / rekordbox / Buscar playlist / Lendo playlists… / Não foi possível ler a coleção. Se você acabou de mudar algo, volte ao Surco em alguns segundos. / Nenhuma playlist. / Nenhuma playlist corresponde. / {{count}} faixa, {{count}} faixas / {{count}} separador, {{count}} separadores / separador.

- [ ] **Step 2: Tests que fallan**

`SourceRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceRail } from './SourceRail'

afterEach(cleanup)

describe('SourceRail', () => {
  it('offers the working list plus each source found on this machine', () => {
    render(<SourceRail sources={['rekordbox']} active={null} onSelect={vi.fn()} />)
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('source-rail-appleMusic')).not.toBeInTheDocument()
  })

  it('picks a source, and the working list with null', () => {
    const onSelect = vi.fn()
    render(<SourceRail sources={['appleMusic', 'rekordbox']} active="rekordbox" onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('source-rail-appleMusic'))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(onSelect.mock.calls).toEqual([['appleMusic'], [null]])
  })
})
```

`SourceTree.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import { SourceTree } from './SourceTree'

afterEach(cleanup)

const TODAS_CANT: SourceNode = { id: 'ct', name: 'Todas', kind: 'playlist', count: 448 }
const TODAS_BASES: SourceNode = { id: 'bt', name: 'Todas', kind: 'playlist', count: 336 }
const NODES: SourceNode[] = [
  { id: 'cant', name: 'CANTADITAS', kind: 'folder', count: 1, children: [
    { id: 'c90', name: '90s', kind: 'folder', count: 1, children: [TODAS_CANT] },
  ] },
  { id: 'bases', name: 'BASES', kind: 'folder', count: 1, children: [TODAS_BASES] },
  { id: 'house', name: 'House', kind: 'playlist', count: 32 },
]

function setup(selectedId: string | null = null) {
  const onSelect = vi.fn()
  render(<SourceTree title="rekordbox" nodes={NODES} failed={false} selectedId={selectedId} onSelect={onSelect} />)
  return onSelect
}

describe('SourceTree', () => {
  it('starts with folders closed and opens one on click', () => {
    setup()
    expect(screen.queryByTestId('source-node-ct')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('source-node-cant'))
    fireEvent.click(screen.getByTestId('source-node-c90'))
    expect(screen.getByTestId('source-node-ct')).toHaveTextContent('448')
  })

  it('opens the folders holding the selected playlist, so the selection is never hidden', () => {
    setup('ct')
    expect(screen.getByTestId('source-node-ct')).toHaveAttribute('aria-current', 'true')
  })

  it('hands back the folder path with the playlist, the only thing telling two "Todas" apart', () => {
    const onSelect = setup()
    fireEvent.click(screen.getByTestId('source-node-bases'))
    fireEvent.click(screen.getByTestId('source-node-bt'))
    expect(onSelect).toHaveBeenCalledWith(TODAS_BASES, ['BASES'])
  })

  it('searches playlists by name and shows each hit with its folder path', () => {
    setup()
    fireEvent.change(screen.getByTestId('source-tree-search'), { target: { value: 'todas' } })
    expect(screen.getByTestId('source-node-ct')).toHaveTextContent('CANTADITAS › 90s')
    expect(screen.getByTestId('source-node-bt')).toHaveTextContent('BASES')
    expect(screen.queryByTestId('source-node-house')).not.toBeInTheDocument()
  })

  it('says when the collection could not be read instead of looking empty', () => {
    render(<SourceTree title="rekordbox" nodes={undefined} failed selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByTestId('source-tree-failed')).toBeInTheDocument()
  })
})
```

Los tests de componentes usan i18n real: comprueba cómo lo inicializan los vecinos (`grep -n "i18n" src/renderer/src/components/ApplePlaylistModal.test.tsx src/renderer/src/test/*.ts | head`) y haz lo mismo; si el setup global ya lo carga, no hace falta nada.

- [ ] **Step 3: Verlos fallar** → ambos FAIL (módulo inexistente).

- [ ] **Step 4: Implementación**

`SourceRail.tsx`:

```tsx
import { Disc3, ListMusic, Music } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistSource } from '../../../shared/types'

const ICON: Record<PlaylistSource, typeof Music> = { appleMusic: Music, rekordbox: Disc3 }

// The column of places tracks come from, as rekordbox's own side panel has it. The first
// entry is the working list every import has always landed in; the rest are the DJ
// libraries found on this machine. A source this machine lacks is not drawn at all — the
// same rule the Apple Music destination follows off macOS.
export function SourceRail({
  sources,
  active,
  onSelect,
}: {
  sources: PlaylistSource[]
  active: PlaylistSource | null
  onSelect: (source: PlaylistSource | null) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const item = (key: string, label: string, Icon: typeof Music, on: boolean, pick: () => void) => (
    <button
      key={key}
      type="button"
      data-testid={`source-rail-${key}`}
      aria-pressed={on}
      onClick={pick}
      className={`flex w-[50px] flex-col items-center gap-[3px] rounded-lg pt-[7px] pb-[5px] text-[10px] ${
        on ? 'bg-[var(--color-accent-soft)] text-fg' : 'text-fg-faint hover:bg-hover'
      }`}
    >
      <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
      {label}
    </button>
  )
  return (
    <nav
      data-testid="source-rail"
      aria-label={tr('sources.rail')}
      className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-line bg-[var(--color-ink)] pt-2.5"
    >
      {item('tracks', tr('sources.workingList'), ListMusic, active === null, () => onSelect(null))}
      {sources.map((s) => item(s, tr(`sources.${s}`), ICON[s], active === s, () => onSelect(s)))}
    </nav>
  )
}
```

`SourceTree.tsx`:

```tsx
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceNode } from '../../../shared/types'

// The folders on the way to a node, so the tree can open them for the selected playlist.
function pathTo(nodes: SourceNode[], id: string, trail: SourceNode[] = []): SourceNode[] | null {
  for (const n of nodes) {
    if (n.id === id) return trail
    if (n.children) {
      const found = pathTo(n.children, id, [...trail, n])
      if (found) return found
    }
  }
  return null
}

// Every playlist with the folder names above it. Search lists these flat: with names
// repeated across folders (the measured collection has five "Todas"), the path is what
// tells the hits apart.
function flatten(nodes: SourceNode[], folders: string[] = []): { node: SourceNode; folders: string[] }[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder' ? flatten(n.children ?? [], [...folders, n.name]) : [{ node: n, folders }],
  )
}

export function SourceTree({
  title,
  nodes,
  failed,
  selectedId,
  onSelect,
}: {
  title: string
  nodes: SourceNode[] | undefined
  failed: boolean
  selectedId: string | null
  onSelect: (node: SourceNode, folders: string[]) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const forced = useMemo(
    () => new Set((selectedId && nodes ? pathTo(nodes, selectedId) : null)?.map((n) => n.id) ?? []),
    [nodes, selectedId],
  )
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q && nodes ? flatten(nodes).filter((h) => h.node.name.toLowerCase().includes(q)) : null
  }, [nodes, query])

  const toggle = (id: string): void =>
    setOpened((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const row = (node: SourceNode, depth: number, folders: string[], trail?: string): React.JSX.Element => {
    const isFolder = node.kind === 'folder'
    const open = opened.has(node.id) || forced.has(node.id)
    const selected = node.id === selectedId
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <li key={node.id}>
        <button
          type="button"
          data-testid={`source-node-${node.id}`}
          aria-expanded={isFolder ? open : undefined}
          aria-current={selected || undefined}
          onClick={() => (isFolder ? toggle(node.id) : onSelect(node, folders))}
          style={{ paddingLeft: 10 + depth * 18 }}
          className={`flex h-[27px] w-full items-center gap-1.5 rounded-md pr-2.5 text-left ${
            selected ? 'bg-[var(--color-row-selected)] text-[var(--color-on-row-selected)]' : 'text-fg-muted hover:bg-hover'
          } ${isFolder ? 'text-[11.5px] font-semibold text-fg' : ''}`}
        >
          {isFolder && <Chevron size={12} className="shrink-0 text-fg-faint" aria-hidden="true" />}
          <span className="min-w-0 truncate">{node.name}</span>
          {trail && <span className="min-w-0 truncate text-[11px] text-fg-faint">{trail}</span>}
          <span className="ml-auto text-[11px] tabular-nums text-fg-faint">{node.count}</span>
        </button>
        {isFolder && open && (
          <ul>{(node.children ?? []).map((c) => row(c, depth + 1, [...folders, node.name]))}</ul>
        )}
      </li>
    )
  }

  let body: React.ReactNode
  if (failed) body = <p data-testid="source-tree-failed" className="px-3 text-xs text-fg-faint">{tr('sources.failed')}</p>
  else if (!nodes) body = <p className="px-3 text-xs text-fg-faint">{tr('sources.loading')}</p>
  else if (nodes.length === 0) body = <p className="px-3 text-xs text-fg-faint">{tr('sources.empty')}</p>
  else if (hits && hits.length === 0) body = <p className="px-3 text-xs text-fg-faint">{tr('sources.noMatch')}</p>
  else if (hits) body = <ul>{hits.map((h) => row(h.node, 0, h.folders, h.folders.join(' › ')))}</ul>
  else body = <ul>{nodes.map((n) => row(n, 0, []))}</ul>

  return (
    <div data-testid="source-tree" className="flex w-[236px] shrink-0 flex-col border-r border-line bg-[var(--color-ink)]">
      <div className="px-3 pt-3 pb-2 font-semibold">{title}</div>
      <label className="mx-2.5 mb-2 flex h-[30px] items-center gap-1.5 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-2 text-xs">
        <Search size={13} className="text-fg-faint" aria-hidden="true" />
        <input
          data-testid="source-tree-search"
          aria-label={tr('sources.search')}
          placeholder={tr('sources.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">{body}</div>
    </div>
  )
}
```

Comprueba que `bg-hover`, `border-line`, `text-fg-faint`, `text-fg-muted` existen como utilidades (`grep -rn "bg-hover\|border-line" src/renderer/src/components | head -3`); si el repo usa la forma `bg-[var(--color-hover)]`, usa esa.

- [ ] **Step 5: Verlos pasar** → PASS. Corre también `src/renderer/src/i18n` (keys/usedKeys) para comprobar que no hay claves huérfanas.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SourceRail.tsx src/renderer/src/components/SourceRail.test.tsx src/renderer/src/components/SourceTree.tsx src/renderer/src/components/SourceTree.test.tsx src/renderer/src/i18n/locales
git commit -m "Draw the source rail and a searchable playlist tree"
```

---

### Task 6: Abrir una playlist en la lista de trabajo

**Files:**
- Modify: `src/renderer/src/hooks/useTrackLibrary.ts` (junto a `importApplePlaylist`, ~línea 699; tipo de retorno ~línea 142; objeto devuelto ~línea 858)
- Test: `src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx` (añade un `describe`)
- Create: `src/renderer/src/hooks/useSourceBrowser.ts`, `useSourceBrowser.test.tsx`

**Interfaces:**
- Consumes: `musicTree`, `musicEntries` (Tarea 4), IPC de la Tarea 2.
- Produces:
  - `useTrackLibrary(...).openSourcePlaylist(entries: SourcePlaylistEntry[], source: PlaylistSource): Promise<void>`
  - `useSourceBrowser(): SourceBrowser` con
    ```ts
    interface SourceBrowser {
      sources: PlaylistSource[]
      source: PlaylistSource | null
      playlist: { id: string; name: string; folders: string[] } | null
      tree: SourceNode[] | undefined
      treeFailed: boolean
      entries: SourcePlaylistEntry[] | undefined
      selectSource: (s: PlaylistSource | null) => void
      selectPlaylist: (node: SourceNode, folders: string[]) => void
    }
    ```

- [ ] **Step 1: Test que falla de `openSourcePlaylist`**

Al final de `useTrackLibraryPlaylist.test.tsx`:

```tsx
describe('opening a source playlist', () => {
  const entries = (paths: string[]) => paths.map((path) => ({ path, separator: false, meta: {} }))

  it('loads the playlist files and leaves separators and file-less rows out', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.openSourcePlaylist(
        [...entries(['/m/a.aiff']), { path: '/m/_.mp3', separator: true, meta: {} }, { path: null, separator: false, meta: {} }],
        'rekordbox',
      )
    })
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.aiff'])
  })

  it('does not report already-loaded tracks as skipped: browsing back to a playlist is not a re-import', async () => {
    const onDuplicatesSkipped = vi.fn()
    const { result } = setup({}, { onDuplicatesSkipped })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'rekordbox')
    })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff', '/m/b.aiff']), 'rekordbox')
    })
    expect(onDuplicatesSkipped).not.toHaveBeenCalled()
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.aiff', '/m/b.aiff'])
  })

  it('fills bpm and key from rekordbox when the file has none', async () => {
    const { result } = setup({
      readMeta: vi.fn().mockResolvedValue({ tags: tags({ title: 'Night Train' }), duration: 256, cover: null, foreignTags: [] }),
    })
    await act(async () => {
      await result.current.openSourcePlaylist([{ path: '/m/a.aiff', separator: false, meta: { bpm: '150', key: '4B' } }], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0].meta.key).toBe('4B'))
    expect(result.current.tracks[0].meta.bpm).toBe('150')
  })

  it('stamps a Music row with its library identity, so converting updates that copy', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.aiff', separator: false, meta: {}, musicPersistentId: 'PID0000000000001' }],
        'appleMusic',
      )
    })
    expect(result.current.tracks[0]).toMatchObject({ fromAppleMusic: true, musicPersistentId: 'PID0000000000001' })
  })
})
```

`setup` hoy acepta `over` para `window.api`; amplíalo con un segundo parámetro opcional `opts: Record<string, unknown> = {}` que se mezcla en el objeto que recibe `useTrackLibrary` (`onDuplicatesSkipped: vi.fn(), …, ...opts`). Es un cambio de fixture, no de comportamiento.

- [ ] **Step 2: Verlo fallar**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx` → FAIL, `openSourcePlaylist is not a function`.

- [ ] **Step 3: Implementación en `useTrackLibrary.ts`**

Tras `importApplePlaylist` (no lo toques todavía; se va en la Tarea 8):

```ts
  // A playlist opened from a source is browsing, not importing: the files go through the
  // same expand-and-add path as a drop so every filter and analysis behaves alike, but only
  // the ones not already in the crate are passed on. That keeps a track loaded from another
  // playlist with its edits, and keeps addPaths from reporting it as a skipped duplicate —
  // going back to a playlist is not something the user did twice.
  async function openSourcePlaylist(
    entries: SourcePlaylistEntry[],
    source: PlaylistSource,
  ): Promise<void> {
    const loaded = new Set(tracksRef.current.map((t) => t.inputPath))
    const fresh = entries.filter(
      (e): e is SourcePlaylistEntry & { path: string } =>
        !e.separator && e.path !== null && !loaded.has(e.path),
    )
    for (const e of fresh) {
      appleMusicMeta.current.set(e.path, e.meta)
      if (source === 'appleMusic') {
        pendingSeed.current.set(e.path, {
          fromAppleMusic: true,
          ...(e.musicPersistentId ? { musicPersistentId: e.musicPersistentId } : {}),
        })
      }
    }
    if (fresh.length === 0) return
    await addPaths(await window.api.expandPaths([...new Set(fresh.map((e) => e.path))]))
  }
```

Añade `openSourcePlaylist: (entries: SourcePlaylistEntry[], source: PlaylistSource) => Promise<void>` al tipo de retorno y `openSourcePlaylist,` al objeto devuelto; `SourcePlaylistEntry` y `PlaylistSource` al `import type` de `../../../shared/types`.

- [ ] **Step 4: Verlo pasar** → PASS (los 4 nuevos y los existentes).

- [ ] **Step 5: Test que falla de `useSourceBrowser`**

`useSourceBrowser.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSourceBrowser } from './useSourceBrowser'

afterEach(cleanup)

function setup(api: Record<string, unknown>, platform = 'darwin') {
  let focus: (focused: boolean) => void = () => {}
  ;(window as unknown as { api: unknown }).api = {
    platform,
    rekordboxAvailable: vi.fn().mockResolvedValue(true),
    loadRekordboxTree: vi.fn().mockResolvedValue([{ id: 'house', name: 'House', kind: 'playlist', count: 1 }]),
    loadRekordboxPlaylist: vi.fn().mockResolvedValue([{ path: '/m/a.wav', separator: false, meta: {} }]),
    loadAppleMusicPlaylists: vi.fn().mockResolvedValue([]),
    loadAppleMusicPlaylistTracks: vi.fn(),
    onWindowFocus: vi.fn((cb: (f: boolean) => void) => { focus = cb; return () => {} }),
    ...api,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useSourceBrowser(), { wrapper })
  return { ...hook, focus: () => focus(true) }
}

describe('useSourceBrowser', () => {
  it('offers Music on macOS and rekordbox when a collection is readable', async () => {
    const { result } = setup({})
    await waitFor(() => expect(result.current.sources).toEqual(['appleMusic', 'rekordbox']))
  })

  it('offers nothing on Windows without rekordbox, so no rail is drawn', async () => {
    const { result } = setup({ rekordboxAvailable: vi.fn().mockResolvedValue(false) }, 'win32')
    await waitFor(() => expect(window.api.rekordboxAvailable).toHaveBeenCalled())
    expect(result.current.sources).toEqual([])
  })

  it('loads the picked playlist rows', async () => {
    const { result } = setup({})
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree).toHaveLength(1))
    act(() => result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []))
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    expect(window.api.loadRekordboxPlaylist).toHaveBeenCalledWith('house')
  })

  it('re-reads the tree and the open playlist when Surco gets the focus back, to show what changed in rekordbox', async () => {
    const { result, focus } = setup({})
    act(() => result.current.selectSource('rekordbox'))
    act(() => result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []))
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    const treeCalls = vi.mocked(window.api.loadRekordboxTree).mock.calls.length
    act(() => focus())
    await waitFor(() => expect(vi.mocked(window.api.loadRekordboxTree).mock.calls.length).toBeGreaterThan(treeCalls))
  })

  it('closes a playlist deleted in rekordbox once the refreshed tree no longer has it', async () => {
    const loadRekordboxTree = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'house', name: 'House', kind: 'playlist', count: 1 }])
      .mockResolvedValue([])
    const { result, focus } = setup({ loadRekordboxTree })
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree).toHaveLength(1))
    act(() => result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []))
    act(() => focus())
    await waitFor(() => expect(result.current.playlist).toBeNull())
  })

  it('closes the playlist when switching source, so another source never shows its rows', async () => {
    const { result } = setup({})
    act(() => result.current.selectSource('rekordbox'))
    act(() => result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []))
    act(() => result.current.selectSource('appleMusic'))
    expect(result.current.playlist).toBeNull()
  })
})
```

Comprueba cómo sabe hoy el renderer que está en macOS (`grep -rn "isMac" src/renderer/src/App.tsx | head -2`) y usa esa misma fuente en el hook y en el test (si es `window.api.platform`, el mock de arriba vale; si es otra, ajusta el mock, no la lógica). Los mocks tipados con `vi.fn<Api['metodo']>()` donde el compilador lo pida.

- [ ] **Step 6: Verlo fallar** → FAIL, módulo inexistente.

- [ ] **Step 7: Implementación**

`useSourceBrowser.ts`:

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { PlaylistSource, SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import { musicEntries, musicTree } from '../lib/appleMusicSource'
import { useWindowFocus } from './useWindowFocus'

export interface SourceBrowser {
  sources: PlaylistSource[]
  source: PlaylistSource | null
  playlist: { id: string; name: string; folders: string[] } | null
  tree: SourceNode[] | undefined
  treeFailed: boolean
  entries: SourcePlaylistEntry[] | undefined
  selectSource: (source: PlaylistSource | null) => void
  selectPlaylist: (node: SourceNode, folders: string[]) => void
}

function containsNode(nodes: SourceNode[], id: string): boolean {
  return nodes.some((n) => n.id === id || (n.children ? containsNode(n.children, id) : false))
}

function readTree(source: PlaylistSource): Promise<SourceNode[]> {
  return source === 'rekordbox'
    ? window.api.loadRekordboxTree()
    : window.api.loadAppleMusicPlaylists().then(musicTree)
}

function readPlaylist(source: PlaylistSource, id: string): Promise<SourcePlaylistEntry[]> {
  return source === 'rekordbox'
    ? window.api.loadRekordboxPlaylist(id)
    : window.api.loadAppleMusicPlaylistTracks(id).then(musicEntries)
}

// Which source and playlist the list is showing, and their data. The DJ library is the
// single truth, so nothing here is kept beyond the session: the tree and the open playlist
// are re-read whenever Surco gets the focus back, which is when a change made in rekordbox
// can have happened. Null source is the working list every import has always used.
export function useSourceBrowser(): SourceBrowser {
  const queryClient = useQueryClient()
  const [source, setSource] = useState<PlaylistSource | null>(null)
  const [playlist, setPlaylist] = useState<SourceBrowser['playlist']>(null)
  const isMac = window.api.platform === 'darwin'

  const { data: rekordbox = false } = useQuery({
    queryKey: ['source-available', 'rekordbox'],
    queryFn: () => window.api.rekordboxAvailable(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const sources: PlaylistSource[] = [
    ...(isMac ? (['appleMusic'] as const) : []),
    ...(rekordbox ? (['rekordbox'] as const) : []),
  ]

  const tree = useQuery({
    queryKey: ['source-tree', source],
    queryFn: () => readTree(source as PlaylistSource),
    enabled: source !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const entries = useQuery({
    queryKey: ['source-playlist', source, playlist?.id],
    queryFn: () => readPlaylist(source as PlaylistSource, playlist?.id as string),
    enabled: source !== null && playlist !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })

  // A playlist deleted in rekordbox while it was open: once the re-read tree no longer
  // holds it, the list goes back to the tree instead of showing rows of a playlist that is
  // gone. The tree stays open where it was, which is the "back to the folder" of the spec.
  const openId = playlist?.id
  useEffect(() => {
    if (openId && tree.data && !containsNode(tree.data, openId)) setPlaylist(null)
  }, [openId, tree.data])

  useWindowFocus((focused) => {
    if (!focused) return
    queryClient.invalidateQueries({ queryKey: ['source-available'] })
    queryClient.invalidateQueries({ queryKey: ['source-tree'] })
    queryClient.invalidateQueries({ queryKey: ['source-playlist'] })
  })

  return {
    sources,
    source,
    playlist,
    tree: tree.data,
    treeFailed: tree.isError,
    entries: entries.data,
    selectSource: (next) => {
      setSource(next)
      setPlaylist(null)
    },
    selectPlaylist: (node, folders) => setPlaylist({ id: node.id, name: node.name, folders }),
  }
}
```

- [ ] **Step 8: Verlo pasar** → PASS (6). Mutación: quita la invalidación de `['source-tree']` → debe fallar el test del foco. Restaura.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/hooks/useTrackLibrary.ts src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx src/renderer/src/hooks/useSourceBrowser.ts src/renderer/src/hooks/useSourceBrowser.test.tsx
git commit -m "Open a source playlist into the working list without re-importing what is loaded"
```

---

### Task 7: Montarlo en la app

**Files:**
- Create: `src/renderer/src/components/PlaylistHeading.tsx`, `PlaylistHeading.test.tsx`
- Modify: `src/renderer/src/components/TrackList.tsx` (prop nueva y línea antes de la fila)
- Test: `src/renderer/src/components/TrackList.test.tsx` (añade un caso)
- Modify: `src/renderer/src/App.tsx` (~líneas 1136-1200 para la lista acotada; ~2077 para el carril y el árbol)
- Test: `src/renderer/src/App.test.tsx` o el fichero de escenarios de App que cubre la barra lateral (búscalo con `grep -ln "data-testid=\"sidebar\"\|getByTestId('sidebar')" src/renderer/src/*.test.tsx src/renderer/src/test/*`)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `PlaylistHeading({ source: PlaylistSource; folders: string[]; name: string; entries: SourcePlaylistEntry[] | undefined })`; `TrackList` prop `separatorBefore?: ReadonlySet<string>`.

- [ ] **Step 1: Tests que fallan**

`PlaylistHeading.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlaylistHeading } from './PlaylistHeading'

afterEach(cleanup)

describe('PlaylistHeading', () => {
  it('names the playlist with its path and counts tracks apart from separators', () => {
    render(
      <PlaylistHeading
        source="rekordbox"
        folders={['COMBOS']}
        name="Factory"
        entries={[
          { path: '/m/a.wav', separator: false, meta: {} },
          { path: '/m/_.mp3', separator: true, meta: {} },
        ]}
      />,
    )
    expect(screen.getByTestId('playlist-heading-path')).toHaveTextContent('rekordbox › COMBOS')
    expect(screen.getByTestId('playlist-heading')).toHaveTextContent('Factory')
    expect(screen.getByTestId('playlist-heading-counts')).toHaveTextContent('1 pista · 1 separador')
  })
})
```

(El idioma del setup de tests decide si sale "pista" o "track": mira qué espera `ApplePlaylistModal.test.tsx` y escribe la aserción en ese idioma.)

En `TrackList.test.tsx`, usando el render helper de ese fichero:

```tsx
  it('draws a separator line above the rows a playlist breaks before', () => {
    // render the list with two tracks a and b and separatorBefore={new Set(['b'])}
    // using the file's own renderList/setup helper
    expect(screen.getByTestId('track-separator-b')).toBeInTheDocument()
    expect(screen.queryByTestId('track-separator-a')).not.toBeInTheDocument()
  })
```

Escribe el render con el helper que ya usa `TrackList.test.tsx` (lee sus primeras 80 líneas); la aserción es la de arriba.

Test de App (en el fichero de escenarios que ya monta `App` con `window.api` mockeado): con `rekordboxAvailable` → `true`, `loadRekordboxTree` → `[{ id: 'f', name: 'Factory', kind: 'playlist', count: 2 }]`, `loadRekordboxPlaylist` → dos entradas `/m/a.wav`, separador, `/m/b.wav`, y `expandPaths` identidad:

```tsx
  it('shows a rekordbox playlist in the list, in its order, with the break drawn', async () => {
    // mount App the way the neighbouring tests do
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getByTestId('playlist-heading')).toHaveTextContent('Factory'))
    expect(await screen.findByTestId('track-separator-<id of b>')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(screen.queryByTestId('playlist-heading')).not.toBeInTheDocument()
  })
```

Para el id de `b`, lee el `data-testid` de las filas en `TrackList.tsx` y localiza la fila por su título.

- [ ] **Step 2: Verlos fallar** → FAIL.

- [ ] **Step 3: Implementación**

`PlaylistHeading.tsx`:

```tsx
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistSource, SourcePlaylistEntry } from '../../../shared/types'
import { playlistCounts } from '../lib/playlistView'

// Which playlist the list is showing, with the folders above it — the measured collection
// repeats "Todas", "Top" and "Fijas" across folders, so the name alone does not say which.
export function PlaylistHeading({
  source,
  folders,
  name,
  entries,
}: {
  source: PlaylistSource
  folders: string[]
  name: string
  entries: SourcePlaylistEntry[] | undefined
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const counts = entries ? playlistCounts(entries) : null
  return (
    <div data-testid="playlist-heading" className="px-3 pt-3 pb-1">
      <div data-testid="playlist-heading-path" className="truncate text-[11px] text-fg-faint">
        {[tr(`sources.${source}`), ...folders].join(' › ')}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[15px] font-semibold">{name}</span>
        {counts && (
          <span data-testid="playlist-heading-counts" className="shrink-0 text-xs text-fg-faint">
            {tr('sources.tracks', { count: counts.tracks })}
            {counts.separators > 0 && ` · ${tr('sources.separators', { count: counts.separators })}`}
          </span>
        )}
      </div>
    </div>
  )
}
```

`TrackList.tsx`: añade a `Props`

```ts
  // Rows a playlist breaks before (lib/playlistView), drawn with a dashed line above them.
  // Only passed while the list shows a playlist in its own order: under any other sort the
  // breaks would land between unrelated rows.
  separatorBefore?: ReadonlySet<string>
```

y donde se pinta cada fila (dentro del `map` de `tracks`), antes del elemento de la fila:

```tsx
            {separatorBefore?.has(track.id) && (
              <div
                data-testid={`track-separator-${track.id}`}
                aria-hidden="true"
                className="mx-4 flex h-[22px] items-center gap-2 text-[10.5px] text-fg-faint before:flex-1 before:border-t before:border-dashed before:border-line-strong before:content-[''] after:flex-1 after:border-t after:border-dashed after:border-line-strong after:content-['']"
              >
                {tr('sources.separator')}
              </div>
            )}
```

(Si el `map` devuelve un único elemento con `key`, envuélvelo en `<Fragment key={track.id}>` y quita el `key` del hijo. Si `TrackList` no tiene `tr`, usa el `useTranslation` que ya tenga o añádelo.)

`App.tsx`:

1. Junto a los demás hooks: `const browser = useSourceBrowser()`.
2. Abrir la playlist en la lista cuando lleguen sus filas (junto a los demás efectos de la librería):

```ts
  useEffect(() => {
    if (browser.entries && browser.source) void openSourcePlaylist(browser.entries, browser.source)
  }, [browser.entries, browser.source, openSourcePlaylist])
```

(`openSourcePlaylist` sale de `useTrackLibrary` como el resto de funciones; si no es estable entre renders, envuélvelo en `useStableCallback` como hace App con otros callbacks.)

3. La lista acotada, justo después de `const { tracksView, ... } = useTracksView(...)`:

```ts
  const playlistScope = useMemo(
    () => (browser.playlist && browser.entries ? playlistView(tracksView, browser.entries) : null),
    [browser.playlist, browser.entries, tracksView],
  )
  const scopeTracks = playlistScope?.tracks ?? tracksView
```

y sustituye `tracksView` por `scopeTracks` SOLO en: `qualityCounts(...)`, `formatBuckets(...)` y `filterWithSticky(tracksView, …)` dentro de `visibleTracks` (más su array de dependencias). `tracksViewRef` y el resto siguen con `tracksView`: la lista de trabajo entera sigue siendo la que se analiza y persiste.

4. Delante del `<aside data-testid="sidebar" …>`:

```tsx
                {browser.sources.length > 0 && (
                  <SourceRail sources={browser.sources} active={browser.source} onSelect={browser.selectSource} />
                )}
                {browser.source && (
                  <SourceTree
                    title={tr(`sources.${browser.source}`)}
                    nodes={browser.tree}
                    failed={browser.treeFailed}
                    selectedId={browser.playlist?.id ?? null}
                    onSelect={browser.selectPlaylist}
                  />
                )}
```

5. Dentro del `<aside>`, encima de la cabecera de la lista actual:

```tsx
                  {browser.source && browser.playlist && (
                    <PlaylistHeading
                      source={browser.source}
                      folders={browser.playlist.folders}
                      name={browser.playlist.name}
                      entries={browser.entries}
                    />
                  )}
```

6. En `<TrackList …>`: `separatorBefore={playlistScope && sortBy === 'import' ? playlistScope.separatorBefore : undefined}`.

- [ ] **Step 4: Verlos pasar** → los tres tests nuevos PASS; corre TODA la suite de `apps/desktop` (`node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run`) y los dos `tsc` y `biome lint`. Todo verde; si algo falla, se arregla aquí, no se salta.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/PlaylistHeading.tsx src/renderer/src/components/PlaylistHeading.test.tsx src/renderer/src/components/TrackList.tsx src/renderer/src/components/TrackList.test.tsx src/renderer/src/App.tsx <fichero de test de App tocado>
git commit -m "Browse DJ library playlists from a source rail beside the track list"
```

---

### Task 8: Apple Music solo por el carril (adiós al modal)

**Files:**
- Modify: `src/renderer/src/App.tsx` (líneas ~1838, ~2138, ~2340: las tres entradas que hoy llaman a `overlays.openApplePlaylist`; el toast de `onPlaylistImported` ~585)
- Modify: `src/renderer/src/hooks/useOverlays.ts` (tipo `'applePlaylist'`, `openApplePlaylist`)
- Modify: `src/renderer/src/components/Overlays.tsx` (lazy import y bloque del modal)
- Modify: `src/renderer/src/hooks/useTrackLibrary.ts` (quita `importApplePlaylist` y `onPlaylistImported`)
- Delete: `src/renderer/src/components/ApplePlaylistModal.tsx`, `ApplePlaylistModal.test.tsx`
- Modify: `src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx` (los `describe('importing an Apple Music playlist')` pasan a `openSourcePlaylist`)
- Modify: `src/renderer/src/i18n/locales/*.json` (borra las claves `applePlaylist.*` que queden sin uso)

**Interfaces:**
- Consumes: `browser.selectSource` (Tarea 6).
- Produces: nada nuevo.

- [ ] **Step 1: Test que falla**

En el test de App de la Tarea 7, añade:

```tsx
  it('opens Music in the rail from the "import playlist" entry, where the dialog used to open', async () => {
    // mount App on macOS as the neighbouring tests do, with loadAppleMusicPlaylists resolving one playlist
    // trigger the empty-state "import from Apple Music" action (find its testid in EmptyActions.tsx)
    expect(await screen.findByTestId('source-rail-appleMusic')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
```

Localiza el `data-testid` de la acción en `EmptyActions.tsx` (`grep -n "onImportApplePlaylist" -A6 src/renderer/src/components/EmptyActions.tsx`).

- [ ] **Step 2: Verlo fallar** → FAIL (se abre el diálogo).

- [ ] **Step 3: Implementación**

1. En `App.tsx`, las tres entradas: `openApplePlaylist: isMac ? overlays.openApplePlaylist : undefined` → `openApplePlaylist: isMac ? () => browser.selectSource('appleMusic') : undefined`; ídem `onImportApplePlaylist` y `onImportPlaylist`. El id de comando `import-apple-playlist` se queda (es un atajo que el usuario puede tener reasignado).
2. Quita el bloque del modal y su `lazy` de `Overlays.tsx`, la prop `importApplePlaylist`, el tipo `{ type: 'applePlaylist' }` y `openApplePlaylist` de `useOverlays.ts`.
3. Quita `importApplePlaylist`, su entrada en el tipo de retorno, `onPlaylistImported` (opción y tipo) de `useTrackLibrary.ts`, y el manejador de `onPlaylistImported` en `App.tsx`. El contador "N sin fichero" vive ahora en `PlaylistHeading` (las entradas sin ruta cuentan como pistas, como Music las cuenta).
4. Borra `ApplePlaylistModal.tsx` y su test.
5. En `useTrackLibraryPlaylist.test.tsx`, reescribe los tests del `describe('importing an Apple Music playlist')` que sigan teniendo sentido sobre `openSourcePlaylist(musicEntries(...), 'appleMusic')` (expand de rutas, persistentId, meta de Music) y borra los que comprueban el toast de importación. Antes de borrar o invertir una aserción, apúntala en el informe de la tarea con qué deja de hacer la app (regla del repo: avisar antes de cambiar un test).
6. Borra de los 5 locales las claves `applePlaylist.*` que ya no se usen (`usedKeys.test.ts` lo dirá).

- [ ] **Step 4: Verlo pasar** → test nuevo PASS; suite completa, dos `tsc` y `biome lint` en verde.

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/src
git commit -m "Open Apple Music playlists from the source rail instead of the import dialog"
```

---

### Task 9: Verificación sobre una copia de la colección real

**Files:** ninguno del repo (scripts en el scratchpad).

- [ ] **Step 1: Copia**

```bash
cp ~/Library/Pioneer/rekordbox/master.db "$SCRATCH/rb-verify/master.db"
```

(`$SCRATCH` = el directorio scratchpad de la sesión.) NUNCA apuntes la app al `master.db` real.

- [ ] **Step 2: Lector contra la copia**

Script en el scratchpad que importe `readRekordboxTree`/`readRekordboxPlaylist` del worktree (vía `vite-node` o compilando el módulo) y compruebe: 81 playlists y 13 carpetas en el árbol; COMBOS › Factory devuelve 104 filas, 28 con `separator: true`, y la heading contaría 76; "Night Train (Extended Mix)" trae `{ bpm: '150', key: '4B' }`. Si un número no cuadra, se investiga antes de seguir.

- [ ] **Step 3: En la app con el driver**

Usa la skill `run` (o `.claude/skills/run-desktop`, que necesita `npm install` dentro del worktree). Apunta `rekordboxDbPath` en `~/Library/Application Support/Electron/settings.json` a la copia, ANOTANDO el valor previo. Abre rekordbox › COMBOS › Factory en el carril y captura: cabecera "76 pistas · 28 separadores", líneas discontinuas, BPM y tono en el editor de una pista sin esos tags. Vuelve a "Pistas" y comprueba que las pistas siguen ahí con sus ediciones. Restaura el ajuste al valor anotado.

- [ ] **Step 4: Informe**

Las capturas y los números medidos van al resumen final para Vicent. Nada se da por bueno sin esta tarea.
