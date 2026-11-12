// @vitest-environment jsdom
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app } from 'electron'
import { afterEach, beforeAll, describe, expect, it, type Mock, vi } from 'vitest'

const usb = vi.hoisted(() => ({ stick: '', volume: null as unknown, events: [] as unknown[] }))

vi.mock('electron', async () => ({
  ...(await import('../electronFake')).electronFake(),
  BrowserWindow: {
    fromWebContents: () => null,
    getAllWindows: () => [
      {
        webContents: {
          isDestroyed: () => false,
          send: (channel: string, payload: unknown) => {
            if (channel === 'usb:event') usb.events.push(payload)
          },
        },
      },
    ],
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}))
vi.mock('../../main/usbVolumes', () => ({
  systemVolumeSource: () => ({ idAt: async () => 'BATTERY-STICK' }),
  readVolumes: async () => [usb.volume],
  watchVolumes: () => {},
  stickHolder: async () => ({ by: 'empty', at: null }),
}))
vi.mock('../../main/rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))
vi.mock('../../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('../../main/traktorProcess', () => ({ isTraktorRunning: vi.fn(async () => false) }))
vi.mock('../../main/seratoProcess', () => ({ isSeratoRunning: vi.fn(async () => false) }))
vi.mock('../../main/virtualdjProcess', () => ({
  isVirtualdjRunning: vi.fn(async () => false),
  waitForVirtualdjExit: vi.fn(async () => true),
}))

import { isEngineDjRunning } from '../../main/engineProcess'
import { serialLibraryFlush } from '../../main/libraryTagSync'
import { isRekordboxRunning } from '../../main/rekordboxProcess'
import { isSeratoRunning } from '../../main/seratoProcess'
import { isTraktorRunning } from '../../main/traktorProcess'
import { isVirtualdjRunning } from '../../main/virtualdjProcess'
import { USB_PROGRAM_VIEW } from '../../renderer/src/components/UsbExportModal'
import { fromDestination } from '../../renderer/src/lib/destination'
import { SOURCE_PROGRAMS, SOURCE_READ } from '../../renderer/src/lib/sourcePrograms'
import { HOT_KINDS } from '../../shared/cueRules'
import {
  DJ_PROGRAMS,
  type DjProgram,
  PROGRAM_CAN,
  USB_PROGRAMS,
  type UsbProgram,
} from '../../shared/djProgram'
import type {
  CollectionTrack,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  SaveCuesRequest,
  Settings,
  SourceNode,
  SourcePlaylistEntry,
  TrackCues,
  UsbExportEvent,
} from '../../shared/types'
import { makeTrack, scenarioDir } from '../fixtures'
import {
  type DjAsk,
  followLibrariesSize,
  invokeMain,
  openSurco,
  type Scenario,
} from '../harness'
import {
  CONVERSION_MOVE_MS,
  type ConvertedFormat,
  STICK_CUES_LEFT_OUT,
  STICK_MOVE_MS,
  STORED_MINUS_READ_MS,
} from './clocks'
import { registerDoor } from './door'
import { TEST_LIBRARIES } from './libraries'
import type { BatteryFormat, BatteryTrack } from './testLibrary'
import { registerUsb, STICK_FORMAT, sticks, stickVolume } from './usb'

const LIST = 'Batería'
const CUE_MS = 3000
const CLOCK_TOLERANCE_MS = 2
const FORMATS: BatteryFormat[] = ['wav', 'aiff', 'flac', 'mp3', 'm4a']
const CONVERTED: ConvertedFormat[] = ['mp3', 'flac']
const QUALITY: Partial<Settings> = { keepMp3Sources: false }
const RETAGGED: BatteryFormat = 'wav'
const NEW_TITLE = 'Pista wav retitulada'
const UPDATED: BatteryFormat = 'aiff'
const UPDATED_TITLE = 'Pista aiff actualizada'
const RUNNING: Record<DjProgram, Mock<() => Promise<boolean>>> = {
  rekordbox: vi.mocked(isRekordboxRunning),
  traktor: vi.mocked(isTraktorRunning),
  engine: vi.mocked(isEngineDjRunning),
  serato: vi.mocked(isSeratoRunning),
  virtualdj: vi.mocked(isVirtualdjRunning),
}
const QUEUES_THE_TITLE: Record<DjProgram, boolean> = {
  rekordbox: true,
  traktor: true,
  engine: false,
  serato: true,
  virtualdj: true,
}
const FOLLOWS_SIZE: ReadonlySet<DjProgram> = new Set(['engine', 'virtualdj'])
const UPDATE_CARRIES_TITLE: Record<DjProgram, boolean> = {
  rekordbox: true,
  traktor: true,
  engine: true,
  serato: true,
  virtualdj: true,
}

let root = ''
let output = ''
let tracks: Record<BatteryFormat, BatteryTrack>
let fresh: BatteryTrack
let settings: Partial<Settings> = {}
let surco: Scenario
let door: ReturnType<typeof registerDoor>

const formatOf = (file: string): BatteryFormat =>
  extname(file).slice(1).toLowerCase() as BatteryFormat

const dj = <T,>(op: string, program: DjProgram, ...args: unknown[]) =>
  invokeMain<T>(`dj:${op}`, program, ...args)

function makeBatteryTrack(dir: string, stem: string, format: BatteryFormat): BatteryTrack {
  const path = makeTrack(join(dir, `${stem}.${format}`), {
    title: stem,
    artist: 'Surco Batería',
    signal: 'kick',
  })
  return { format, path, title: stem, artist: 'Surco Batería', durationSec: 8 }
}

async function open(extra: Partial<Settings>, djAsk?: DjAsk): Promise<void> {
  surco?.close()
  surco = await openSurco({ settings: { ...settings, outputDir: output, ...extra }, djAsk })
}

function flat(nodes: SourceNode[]): SourceNode[] {
  return nodes.flatMap((n) => [n, ...flat(n.children ?? [])])
}

async function nodeNamed(program: DjProgram, name: string): Promise<SourceNode | undefined> {
  return flat(await dj<SourceNode[]>('tree', program)).find((n) => n.name === name)
}

async function listId(program: DjProgram): Promise<string> {
  const node = await nodeNamed(program, LIST)
  if (!node) throw new Error(`${program} has no ${LIST} list`)
  return node.id
}

async function entries(program: DjProgram, id: string): Promise<SourcePlaylistEntry[]> {
  return dj<SourcePlaylistEntry[]>('playlist', program, id)
}

async function contentIdOf(program: DjProgram, path: string): Promise<string> {
  const entry = (await entries(program, await listId(program))).find((e) => e.path === path)
  if (entry?.contentId) return entry.contentId
  if (SOURCE_READ[program].collection) {
    const track = (await dj<CollectionTrack[]>('collection', program)).find((t) => t.path === path)
    if (track) return track.contentId
  }
  throw new Error(`${program} has no content id for ${path}`)
}

async function cuesOf(program: DjProgram, path: string): Promise<TrackCues | null> {
  return invokeMain<TrackCues | null>('cues:trackCues', await contentIdOf(program, path))
}

async function save(program: DjProgram, edit: RekordboxPlaylistEdit): Promise<RekordboxEditResult> {
  return dj<RekordboxEditResult>('editPlaylist', program, edit, 'Batería')
}

async function titleOf(program: DjProgram, path: string): Promise<string | undefined> {
  if (SOURCE_READ[program].collection)
    return (await dj<CollectionTrack[]>('collection', program)).find((t) => t.path === path)?.title
  return (await entries(program, await listId(program))).find((e) => e.path === path)?.preview
    ?.title
}

const formatsIntact = (): void => {
  for (const program of DJ_PROGRAMS)
    expect(TEST_LIBRARIES[program].formatProblems(settings), program).toEqual([])
}

const editKinds = (program: DjProgram): ReadonlySet<RekordboxPlaylistEdit['kind']> | null => {
  const edit = SOURCE_PROGRAMS[program].edit
  if (!edit) return new Set()
  return edit.kinds ?? null
}

const canEdit = (program: DjProgram, kind: RekordboxPlaylistEdit['kind']): boolean => {
  const kinds = editKinds(program)
  return kinds === null || kinds.has(kind)
}

beforeAll(async () => {
  root = realpathSync(scenarioDir('dj-programs'))
  output = join(root, 'Salida')
  mkdirSync(output, { recursive: true })
  const music = join(root, 'Música')
  tracks = Object.fromEntries(
    FORMATS.map((format) => [format, makeBatteryTrack(music, `Pista ${format}`, format)]),
  ) as Record<BatteryFormat, BatteryTrack>
  fresh = makeBatteryTrack(join(root, 'Nuevas'), 'Pista nueva', 'flac')
  const home = app.getPath('home')
  for (const program of DJ_PROGRAMS)
    settings = {
      ...settings,
      ...TEST_LIBRARIES[program].build(
        { root: join(root, program), home },
        Object.values(tracks),
        LIST,
      ),
    }
  await open(fromDestination('folder'))
  door = registerDoor(() => surco.queues)
}, 120_000)

describe.each(DJ_PROGRAMS)('%s, por la puerta común', (program) => {
  afterEach(formatsIntact)

  it('lee el árbol, la lista, la colección y la pertenencia', async () => {
    const id = await listId(program)
    const paths = (await entries(program, id)).map((e) => e.path)
    expect(paths.sort()).toEqual(
      Object.values(tracks)
        .map((t) => t.path)
        .sort(),
    )
    if (SOURCE_READ[program].collection) {
      const collection = await dj<CollectionTrack[]>('collection', program)
      expect(collection.map((t) => t.path).sort()).toEqual(paths.sort())
    }
    const membership = await dj<Record<string, string[]>>('membership', program, [tracks.wav.path])
    expect(Object.values(membership).flat()).toContain(id)
  })

  it.skipIf(!SOURCE_PROGRAMS[program].edit)(
    'crea, renombra, añade, quita y borra una lista donde el programa edita',
    async () => {
      const created = await save(program, {
        kind: 'create',
        parentId: 'root',
        name: 'Batería nueva',
        folder: false,
      })
      expect(created).toMatchObject({ applied: true })
      let id = (await nodeNamed(program, 'Batería nueva'))?.id
      expect(id).toBeDefined()
      expect(
        await save(program, {
          kind: 'add',
          playlistId: id as string,
          tracks: [{ paths: [tracks.aiff.path] }],
        }),
      ).toMatchObject({ applied: true })
      expect((await entries(program, id as string)).map((e) => e.path)).toEqual([tracks.aiff.path])
      if (canEdit(program, 'rename')) {
        expect(
          await save(program, { kind: 'rename', playlistId: id as string, name: 'Batería otra' }),
        ).toMatchObject({ applied: true })
        id = (await nodeNamed(program, 'Batería otra'))?.id
        expect(id).toBeDefined()
        expect(await nodeNamed(program, 'Batería nueva')).toBeUndefined()
      }
      if (canEdit(program, 'remove')) {
        const [row] = await entries(program, id as string)
        expect(
          await save(program, {
            kind: 'remove',
            playlistId: id as string,
            linkIds: [row.linkId as string],
          }),
        ).toMatchObject({ applied: true })
        expect(await entries(program, id as string)).toEqual([])
      }
      expect(await save(program, { kind: 'delete', playlistId: id as string })).toMatchObject({
        applied: true,
      })
      expect(flat(await dj<SourceNode[]>('tree', program)).map((n) => n.id)).not.toContain(id)
    },
  )

  it.each(FORMATS)('guarda un cue en %s y lo lee en el mismo sitio del reloj', async (format) => {
    const path = tracks[format].path
    const before = await cuesOf(program, path)
    expect(before).not.toBeNull()
    const request: SaveCuesRequest = {
      contentId: await contentIdOf(program, path),
      path,
      label: basename(path),
      wanted: [{ ms: CUE_MS, kind: HOT_KINDS[0], color: null }],
      fingerprint: (before as TrackCues).fingerprint,
    }
    await expect(invokeMain('cues:save', [request])).resolves.toBeUndefined()
    await door.settled()
    const stored = TEST_LIBRARIES[program].storedCuesMs(settings, path)
    expect(stored).toHaveLength(1)
    expect(
      Math.abs(stored[0] - CUE_MS - STORED_MINUS_READ_MS[program][format]),
    ).toBeLessThanOrEqual(CLOCK_TOLERANCE_MS)
    const after = await cuesOf(program, path)
    expect(after?.cues.map((c) => c.ms)).toHaveLength(1)
    expect(Math.abs((after?.cues[0]?.ms ?? 0) - CUE_MS)).toBeLessThanOrEqual(CLOCK_TOLERANCE_MS)
  })

  it('deja cada biblioteca en su formato de fichero tras leer, editar y guardar cues', () => {
    formatsIntact()
  })
})

describe('Convertir', () => {
  const converted = (format: BatteryFormat) => tracks[format].path.replace(/\.[^.]+$/, '.aiff')
  const before = new Map<string, { id: string; cues: TrackCues }>()
  const key = (program: DjProgram, format: BatteryFormat) => `${program} ${format}`

  beforeAll(async () => {
    for (const program of DJ_PROGRAMS)
      for (const format of CONVERTED) {
        const id = await contentIdOf(program, tracks[format].path)
        const cues = await invokeMain<TrackCues | null>('cues:trackCues', id)
        if (cues) before.set(key(program, format), { id, cues })
      }
    await open({
      ...fromDestination('beside'),
      ...QUALITY,
      outputFormat: 'aiff',
      autoApplyFilename: false,
    })
    await surco.drop(...CONVERTED.map((f) => tracks[f].path))
    await surco.convertAll('confirm', 'aiff')
    await door.settled()
  }, 120_000)

  it('sin errores que vea el usuario', () => {
    expect(surco.errors).toEqual([])
  })

  describe.each(DJ_PROGRAMS)('%s', (program) => {
    const afterOf = async (format: BatteryFormat): Promise<TrackCues | null> => {
      const was = before.get(key(program, format))
      if (!was) throw new Error(`${program} had no cues for ${format} before converting`)
      if (PROGRAM_CAN[program].write)
        return invokeMain<TrackCues | null>(
          'cues:trackCues',
          await contentIdOf(program, converted(format)),
        )
      const carried = was.id.replace(tracks[format].path, converted(format))
      expect(carried).not.toBe(was.id)
      return invokeMain<TrackCues | null>('cues:trackCues', carried)
    }

    it.each(CONVERTED)('lleva el cue de %s al fichero nuevo', async (format) => {
      const was = before.get(key(program, format))?.cues as TrackCues
      const after = await afterOf(format)
      expect(after?.cues).toHaveLength(1)
      const moved = (after?.cues[0]?.ms ?? 0) - (was.cues[0]?.ms ?? 0)
      expect(Math.abs(moved - CONVERSION_MOVE_MS[program][format])).toBeLessThanOrEqual(
        CLOCK_TOLERANCE_MS,
      )
    })

    it.skipIf(!PROGRAM_CAN[program].write)('repunta la lista al fichero nuevo', async () => {
      const paths = (await entries(program, await listId(program))).map((e) => e.path)
      for (const format of CONVERTED) {
        expect(paths).toContain(converted(format))
        expect(paths).not.toContain(tracks[format].path)
      }
    })

    it.skipIf(PROGRAM_CAN[program].write)(
      'deja la lista en el original, que Surco conserva',
      async () => {
        const paths = (await entries(program, await listId(program))).map((e) => e.path)
        for (const format of CONVERTED) {
          expect(paths).toContain(tracks[format].path)
          expect(existsSync(tracks[format].path)).toBe(true)
        }
      },
    )
  })

  it('deja cada biblioteca en su formato de fichero', () => {
    formatsIntact()
  })
})

describe('Etiquetas y añadir', () => {
  const counts: Partial<Record<DjProgram, number>> = {}

  beforeAll(async () => {
    await open(fromDestination('folder'))
    await window.api.syncLibraryTags([
      {
        path: tracks[RETAGGED].path,
        fields: { title: { from: tracks[RETAGGED].title, to: NEW_TITLE } },
      },
    ])
    await door.settled()
    await open({ ...fromDestination('overwrite'), outputFormat: 'aiff', autoApplyFilename: false })
    await surco.drop(tracks[UPDATED].path)
    surco.editMeta(basename(tracks[UPDATED].path), { title: UPDATED_TITLE })
    await surco.convertAll('confirm', 'aiff')
    await door.settled()
    for (const program of DJ_PROGRAMS) counts[program] = await dj<number>('trackCount', program)
    await open({ ...fromDestination('folder'), outputFormat: 'aiff', autoApplyFilename: false })
    await surco.drop(fresh.path)
    await surco.convertAll('confirm', 'aiff')
    await door.settled()
  }, 120_000)

  it('sin errores que vea el usuario', () => {
    expect(surco.errors).toEqual([])
  })

  describe.each(DJ_PROGRAMS)('%s', (program) => {
    it.skipIf(!PROGRAM_CAN[program].reach)('lleva el título nuevo a la biblioteca', async () => {
      expect(await titleOf(program, tracks[RETAGGED].path)).toBe(NEW_TITLE)
    })

    it(
      UPDATE_CARRIES_TITLE[program]
        ? 'lleva a la biblioteca el título de un Actualizar en su sitio'
        : 'deja el título de un Actualizar en su sitio fuera de la biblioteca, que solo lo toma de la revisión',
      async () => {
        expect(await titleOf(program, tracks[UPDATED].path)).toBe(
          UPDATE_CARRIES_TITLE[program] ? UPDATED_TITLE : tracks[UPDATED].title,
        )
      },
    )

    it.skipIf(!PROGRAM_CAN[program].reach)('añade la pista convertida', async () => {
      expect(await dj<number>('trackCount', program)).toBe((counts[program] ?? 0) + 1)
      if (SOURCE_READ[program].collection)
        expect((await dj<CollectionTrack[]>('collection', program)).map((t) => t.path)).toContain(
          join(output, 'Pista nueva.aiff'),
        )
    })
  })

  it('deja cada biblioteca en su formato de fichero', () => {
    formatsIntact()
  })
})

describe('Con el programa abierto', () => {
  const closing: DjAsk['close'] = (program) => RUNNING[program].mockResolvedValue(false)
  const applyWhenClosed = (program: DjProgram) =>
    serialLibraryFlush(() => surco.queues[program].apply(async () => true))

  const updateTitle = async (program: DjProgram, answer: DjAsk['answer'], title: string) => {
    RUNNING[program].mockResolvedValue(true)
    await open(
      { ...fromDestination('overwrite'), outputFormat: 'aiff', autoApplyFilename: false },
      { open: [program], answer, close: closing },
    )
    await surco.drop(tracks[UPDATED].path)
    surco.editMeta(basename(tracks[UPDATED].path), { title })
    await surco.convertAll('confirm', 'aiff')
  }

  afterEach(() => {
    for (const program of DJ_PROGRAMS) RUNNING[program].mockResolvedValue(false)
  })

  describe.each(DJ_PROGRAMS)('%s', (program) => {
    it('leaves the change waiting when the DJ picks Apply when it closes, and writes it once the program closes', async () => {
      const title = `${program} aplicado después ${'y más '.repeat(25).trim()}`
      const was = await titleOf(program, tracks[UPDATED].path)
      await updateTitle(program, 'later', title)
      expect(surco.asked()).toEqual([[program]])
      expect(await titleOf(program, tracks[UPDATED].path)).toBe(was)
      expect(surco.queues[program].isEmpty()).toBe(false)
      RUNNING[program].mockResolvedValue(false)
      await applyWhenClosed(program)
      expect(surco.queues[program].isEmpty()).toBe(true)
      if (QUEUES_THE_TITLE[program])
        expect(await titleOf(program, tracks[UPDATED].path)).toBe(title)
      expect(surco.asked()).toEqual([[program]])
    })

    it('writes at once when the DJ picks Close and apply', async () => {
      const title = `${program} aplicado al cerrar`
      await updateTitle(program, 'now', title)
      expect(surco.asked()).toEqual([[program]])
      expect(await titleOf(program, tracks[UPDATED].path)).toBe(title)
      expect(surco.queues[program].isEmpty()).toBe(true)
    })

    it.skipIf(!FOLLOWS_SIZE.has(program))(
      'never asks for a write that follows on its own',
      async () => {
        RUNNING[program].mockResolvedValue(true)
        await open(fromDestination('folder'), { open: [program], answer: 'later', close: closing })
        followLibrariesSize(tracks[UPDATED].path, 1)
        expect(surco.asked()).toEqual([])
        expect(surco.queues[program].isEmpty()).toBe(false)
      },
    )
  })

  it('keeps a review rename waiting for Traktor when the DJ will not close it, and applies it once Traktor closes', async () => {
    const title = 'Pista wav renombrada con Traktor abierto'
    const was = await titleOf('traktor', tracks[RETAGGED].path)
    RUNNING.traktor.mockResolvedValue(true)
    await open(fromDestination('folder'), { open: ['traktor'], answer: 'later', close: closing })
    await window.api.syncLibraryTags([
      { path: tracks[RETAGGED].path, fields: { title: { from: was ?? '', to: title } } },
    ])
    expect(await titleOf('traktor', tracks[RETAGGED].path)).toBe(was)
    expect(surco.queues.traktor.isEmpty()).toBe(false)
    RUNNING.traktor.mockResolvedValue(false)
    await applyWhenClosed('traktor')
    expect(await titleOf('traktor', tracks[RETAGGED].path)).toBe(title)
  })

  it('deja cada biblioteca en su formato de fichero', () => {
    formatsIntact()
  })
})

describe('USB', () => {
  const stickOf = (program: UsbProgram) =>
    sticks(usb.events as UsbExportEvent[])[STICK_FORMAT[program]]

  afterEach(formatsIntact)

  beforeAll(() => {
    usb.stick = join(root, 'USB')
    usb.volume = stickVolume(usb.stick)
    mkdirSync(usb.stick, { recursive: true })
    registerUsb(root)
  })

  describe.each(USB_PROGRAMS)('%s', (program) => {
    it('lleva la lista al USB con cada pista y su cue donde el programa lo tiene', async () => {
      const id = await listId(program)
      const stick = stickOf(program)
      const leftOut = await stick.write(
        USB_PROGRAM_VIEW[program].request(
          [id],
          { kind: 'volume', uuid: 'BATTERY-STICK' },
          { prune: false, settings: false },
        ),
      )
      const list = await stick.read(usb.stick, LIST)
      const library = (await entries(program, id)).map((e) => e.path ?? '')
      expect(list?.tracks.map((t) => t.file)).toEqual(library.map((path) => basename(path)))
      for (const [i, track] of (list?.tracks ?? []).entries()) {
        if (STICK_CUES_LEFT_OUT[program].has(formatOf(track.file))) {
          expect(track.cuesMs, track.file).toEqual([])
          expect(leftOut, track.file).toContain(track.title)
          continue
        }
        expect(leftOut, track.file).not.toContain(track.title)
        expect(track.cuesMs, track.file).toHaveLength(1)
        const move = STICK_MOVE_MS[program][formatOf(track.file)]
        expect(move, `${track.file}: no known clock rule`).toBeDefined()
        const cues = await cuesOf(program, library[i])
        expect(
          Math.abs(track.cuesMs[0] - (cues?.cues[0]?.ms ?? 0) - (move ?? 0)),
          track.file,
        ).toBeLessThanOrEqual(CLOCK_TOLERANCE_MS)
      }
    })
  })

  it('deja cada biblioteca en su formato de fichero', () => {
    formatsIntact()
  })
})
