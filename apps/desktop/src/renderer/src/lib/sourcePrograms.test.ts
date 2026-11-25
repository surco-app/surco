// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { PROGRAM_TABLE } from '../../../../../web/src/lib/programTable'
import type { Api } from '../../../preload/api'
import { DJ_PROGRAMS, type DjProgram, RAIL_PROGRAMS } from '../../../shared/djProgram'
import type { RekordboxPlaylistEdit, Settings, SourceNode } from '../../../shared/types'
import { djReads, installApi } from '../test/api'
import { CUE_PROGRAMS } from './cuePrograms'
import {
  canEdit,
  openProgramOf,
  type ProgramEditsContext,
  programEditsOf,
  SOURCE_PROGRAMS,
  SOURCE_READ,
} from './sourcePrograms'

describe('SOURCE_READ reads each DJ program’s tab through window.api.dj, naming the program', () => {
  it.each([
    ['rekordbox', 'available', []],
    ['rekordbox', 'tree', []],
    ['rekordbox', 'recentCount', []],
    ['rekordbox', 'trackCount', []],
    ['rekordbox', 'playlist', ['house']],
    ['rekordbox', 'membership', [['/m/a.wav']]],
    ['rekordbox', 'collection', []],
    ['traktor', 'available', []],
    ['traktor', 'tree', []],
    ['traktor', 'recentCount', []],
    ['traktor', 'trackCount', []],
    ['traktor', 'playlist', ['u1']],
    ['traktor', 'membership', [['/m/a.wav']]],
    ['traktor', 'collection', []],
    ['engine', 'available', []],
    ['engine', 'tree', []],
    ['engine', 'recentCount', []],
    ['engine', 'trackCount', []],
    ['engine', 'collection', []],
    ['engine', 'playlist', ['7']],
    ['engine', 'membership', [['/m/a.wav']]],
    ['serato', 'available', []],
    ['serato', 'tree', []],
    ['serato', 'recentCount', []],
    ['serato', 'trackCount', []],
    ['serato', 'playlist', ['Sets%%Friday']],
    ['serato', 'membership', [['/m/a.wav']]],
    ['serato', 'collection', []],
    ['virtualdj', 'available', []],
    ['virtualdj', 'tree', []],
    ['virtualdj', 'recentCount', []],
    ['virtualdj', 'trackCount', []],
    ['virtualdj', 'playlist', ['Carpeta/Dentro']],
    ['virtualdj', 'membership', [['/m/a.wav']]],
    ['virtualdj', 'collection', []],
  ] as const)('reads %s’s %s through window.api.dj at call time', async (program, read, args) => {
    const answer = Symbol(read)
    const spy = vi.fn(async () => answer)
    installApi({ dj: { ...djReads(), [read]: spy } as unknown as Api['dj'] })
    const call = SOURCE_READ[program][read] as (...a: unknown[]) => Promise<unknown>
    await expect(call(...args)).resolves.toBe(answer)
    expect(spy).toHaveBeenCalledWith(program, ...args)
  })

  it('gives Engine DJ a collection read, so a pasted tracklist finds its tracks there too', () => {
    expect(SOURCE_READ.engine.collection).toBeDefined()
  })
})

describe('RAIL_PROGRAMS', () => {
  it('draws rekordbox, then Engine DJ, then Traktor, after Music, as the rail always has, then Serato and VirtualDJ last', () => {
    expect(RAIL_PROGRAMS).toEqual(['rekordbox', 'engine', 'traktor', 'serato', 'virtualdj'])
  })
})

describe('SOURCE_PROGRAMS says what each DJ program allows in its tab', () => {
  const shape = (program: DjProgram) => {
    const { separator, edit, fixedNode, ...rest } = SOURCE_PROGRAMS[program]
    return {
      ...rest,
      separator: separator !== null,
      edit: edit && { messagePrefix: edit.messagePrefix, gate: edit.gate },
      fixedNode: fixedNode !== null,
    }
  }

  it('lets rekordbox be edited at any time, export to USB, fill loaded rows and add tracks it lacks', () => {
    expect(shape('rekordbox')).toEqual({
      separator: true,
      edit: { messagePrefix: 'sources.edit.', gate: 'none' },
      fixedNode: false,
      usb: true,
      missingLibraryCheck: false,
      marksOrigin: true,
      fillsLoaded: true,
      addsUncollected: true,
      fieldTestIdPrefix: '',
      membershipKey: 'rekordbox-membership',
      invalidatesOnEdit: true,
      crates: false,
      idJoin: null,
    })
  })

  it('lets Traktor be edited once its collection is confirmed, with its own built-in lists fixed, and export to USB', () => {
    expect(shape('traktor')).toEqual({
      separator: true,
      edit: { messagePrefix: 'sources.editTraktor.', gate: 'traktorCollection' },
      fixedNode: true,
      usb: true,
      missingLibraryCheck: false,
      marksOrigin: true,
      fillsLoaded: false,
      addsUncollected: false,
      fieldTestIdPrefix: 'traktor-',
      membershipKey: 'traktor-membership',
      invalidatesOnEdit: true,
      crates: false,
      idJoin: null,
    })
  })

  it('lets Engine DJ make playlists, fill and delete them, export to USB and say when its library is missing', () => {
    expect(shape('engine')).toEqual({
      separator: false,
      edit: { messagePrefix: 'sources.editEngine.', gate: 'none' },
      fixedNode: false,
      usb: true,
      missingLibraryCheck: true,
      marksOrigin: false,
      fillsLoaded: false,
      addsUncollected: false,
      fieldTestIdPrefix: 'engine-',
      membershipKey: 'engine-membership',
      invalidatesOnEdit: true,
      crates: false,
      idJoin: null,
    })
  })

  it('offers on Engine DJ only the edits its writer can do, so no menu leads to a refusal', () => {
    const edit = SOURCE_PROGRAMS.engine.edit
    expect(edit && [...(edit.kinds ?? [])].sort()).toEqual(['add', 'create', 'delete'])
    expect(edit?.folders).toBe(false)
    for (const program of ['rekordbox', 'traktor', 'serato'] as const) {
      expect(SOURCE_PROGRAMS[program].edit?.kinds).toBeUndefined()
      expect(SOURCE_PROGRAMS[program].edit?.folders).toBeUndefined()
    }
  })

  it('saves an Engine DJ edit through window.api.dj', async () => {
    const editPlaylist = vi.fn<Api['dj']['editPlaylist']>().mockResolvedValue({ applied: true })
    installApi({ dj: { ...djReads(), editPlaylist } as unknown as Api['dj'] })
    await SOURCE_PROGRAMS.engine.edit?.save({ kind: 'delete', playlistId: '7' }, 'Sesion')
    expect(editPlaylist).toHaveBeenCalledWith(
      'engine',
      { kind: 'delete', playlistId: '7' },
      'Sesion',
    )
  })

  it('lets the Serato tab edit crates with no separator, no folders and no gate, and export to USB', () => {
    expect(shape('serato')).toEqual({
      separator: false,
      edit: { messagePrefix: 'sources.editSerato.', gate: 'none' },
      fixedNode: false,
      usb: true,
      missingLibraryCheck: false,
      marksOrigin: true,
      fillsLoaded: false,
      addsUncollected: true,
      fieldTestIdPrefix: 'serato-',
      membershipKey: 'serato-membership',
      invalidatesOnEdit: true,
      crates: true,
      idJoin: '%%',
    })
  })

  it('lets the VirtualDJ tab edit its lists and folders with no separator and no gate, marking its tracks so none is converted, and export them to a USB', () => {
    expect(shape('virtualdj')).toEqual({
      separator: false,
      edit: { messagePrefix: 'sources.editVirtualdj.', gate: 'none' },
      fixedNode: false,
      usb: true,
      missingLibraryCheck: false,
      marksOrigin: true,
      fillsLoaded: false,
      addsUncollected: true,
      fieldTestIdPrefix: 'virtualdj-',
      membershipKey: 'virtualdj-membership',
      invalidatesOnEdit: true,
      crates: false,
      idJoin: '/',
    })
  })

  it('saves a Serato edit through editSeratoPlaylist with the crate name for the queue', async () => {
    const editPlaylist = vi.fn<Api['dj']['editPlaylist']>().mockResolvedValue({ applied: true })
    installApi({ dj: { ...djReads(), editPlaylist } as unknown as Api['dj'] })
    await SOURCE_PROGRAMS.serato.edit?.save({ kind: 'rename', playlistId: 'A', name: 'B' }, 'A')
    expect(editPlaylist).toHaveBeenCalledWith(
      'serato',
      { kind: 'rename', playlistId: 'A', name: 'B' },
      'A',
    )
  })

  it.each(['rekordbox', 'traktor'] as const)(
    'asks %s for a separator through window.api.dj.hasSeparator naming it',
    async (program) => {
      const spy = vi.fn(async () => true)
      installApi({ dj: { ...djReads(), hasSeparator: spy } as unknown as Api['dj'] })
      await expect(SOURCE_PROGRAMS[program].separator?.()).resolves.toBe(true)
      expect(spy).toHaveBeenCalledWith(program)
    },
  )

  it.each(['rekordbox', 'traktor'] as const)(
    'saves an edit to %s through window.api.dj.editPlaylist naming it',
    async (program) => {
      const edit: RekordboxPlaylistEdit = { kind: 'rename', playlistId: 'p', name: 'B' }
      const spy = vi.fn(async () => ({ applied: true as const }))
      installApi({ dj: { ...djReads(), editPlaylist: spy } as unknown as Api['dj'] })
      await expect(SOURCE_PROGRAMS[program].edit?.save(edit, 'A')).resolves.toEqual({
        applied: true,
      })
      expect(spy).toHaveBeenCalledWith(program, edit, 'A')
    },
  )

  it.each([
    ['HISTORY', true, 'locked'],
    ['Preparation', true, 'tracks-only'],
    ['_LOOPS', true, 'tracks-only'],
    ['_RECORDINGS', true, 'tracks-only'],
    ['HISTORY', false, null],
    ['Saturday', true, null],
  ] as const)('fixes Traktor’s %s at the root (%s) as %s', (name, atRoot, fixed) => {
    const node: SourceNode = { id: 'n', name, kind: 'playlist', count: 0 }
    expect(SOURCE_PROGRAMS.traktor.fixedNode?.(node, atRoot)).toBe(fixed)
  })
})

describe('the features page table says where pasting a tracklist and the automatic session work', () => {
  const cellOf = (row: 'paste' | 'session', program: DjProgram) =>
    PROGRAM_TABLE.flatMap((group) => group.rows).find((r) => r.id === row)?.cells[program]

  it.each(DJ_PROGRAMS)(
    'offers pasting a tracklist into %s only where Surco reads the whole collection to find each line',
    (program) => {
      expect(cellOf('paste', program)?.yes).toBe(SOURCE_READ[program].collection !== undefined)
    },
  )

  it.each(DJ_PROGRAMS)(
    'offers the automatic session in %s wherever Surco can create a playlist there and add tracks to it',
    (program) => {
      const edit = SOURCE_PROGRAMS[program].edit
      const can = (kind: 'create' | 'add') => edit !== null && (!edit.kinds || edit.kinds.has(kind))
      expect(cellOf('session', program)?.yes).toBe(can('create') && can('add'))
    },
  )
})

describe('canEdit', () => {
  // Engine DJ's database has no playlist order, no folders and no rename Surco can write
  // safely: offering a move or a rename there would hand the DJ an edit that never lands,
  // or one that breaks the library Engine reads on the decks.
  it.each(['move', 'rename', 'moveNode', 'remove', 'insertSeparator'] as const)(
    'refuses %s in Engine DJ, which only takes creating, adding and deleting',
    (kind) => {
      expect(canEdit(SOURCE_PROGRAMS.engine.edit, kind)).toBe(false)
    },
  )

  it.each(['create', 'add', 'delete'] as const)('lets Engine DJ take %s', (kind) => {
    expect(canEdit(SOURCE_PROGRAMS.engine.edit, kind)).toBe(true)
  })

  // rekordbox, Traktor, Serato and VirtualDJ name no kinds: every organising action the
  // tree and the list offer is one their writer knows.
  it.each(['rekordbox', 'traktor', 'serato', 'virtualdj'] as const)(
    'lets %s take every edit',
    (program) => {
      const kinds = [
        'add',
        'move',
        'remove',
        'insertSeparator',
        'create',
        'rename',
        'delete',
        'moveNode',
      ] as const
      for (const kind of kinds) {
        expect(canEdit(SOURCE_PROGRAMS[program].edit, kind)).toBe(true)
      }
    },
  )
})

describe('openProgramOf', () => {
  const stored = (over: Partial<Settings>): Settings => over as Settings
  const open = (source: Parameters<typeof openProgramOf>[0]['browser']['source']) =>
    openProgramOf({ browser: { source }, settings: null })

  // Apple Music is a source to read and tag, not a DJ program Surco organises: it must not
  // reach the DJ edits, cue editors or USB export as if it were one.
  it('opens no DJ program on the Apple Music tab nor on the files', () => {
    expect(open('appleMusic').sourceProgram).toBeNull()
    expect(open(null).sourceProgram).toBeNull()
    expect(open('appleMusic').sourceEdit).toBeNull()
    expect(open(null).sourceEdit).toBeNull()
  })

  it.each(['rekordbox', 'traktor', 'engine', 'serato', 'virtualdj'] as const)(
    'opens %s with its own writer',
    (program) => {
      const opened = open(program)
      expect(opened.sourceProgram).toBe(program)
      expect(opened.sourceEdit).toBe(SOURCE_PROGRAMS[program].edit)
    },
  )

  // Surco writes Traktor's playlists only once its collection is confirmed in Settings: the
  // check of that collection is asked for there alone, so the other programs never wait on it.
  it('asks whether Traktor can save only while Traktor is open', () => {
    expect(open('traktor').checksTraktorCollection).toBe(true)
    for (const source of [
      'rekordbox',
      'engine',
      'serato',
      'virtualdj',
      'appleMusic',
      null,
    ] as const)
      expect(open(source).checksTraktorCollection).toBe(false)
  })

  // The check is cached per collection file: a new path in Settings must ask again.
  it('keys the Traktor check on the collection path, empty while there is none', () => {
    expect(open('traktor').traktorNmlPath).toBe('')
    expect(
      openProgramOf({
        browser: { source: 'traktor' },
        settings: stored({ traktorNmlPath: '/m/collection.nml' }),
      }).traktorNmlPath,
    ).toBe('/m/collection.nml')
  })

  // Each tab remembers whether its results are folded; the files have their own tab.
  it('reads the folded results of the open tab, unfolded until saved', () => {
    expect(open('serato').resultsTab).toBe('serato')
    expect(open(null).resultsTab).toBe('tracks')
    expect(open('appleMusic').resultsTab).toBe('appleMusic')
    expect(open('serato').resultsFolded).toBe(false)
    const settings = stored({ foldedResults: { serato: true } })
    expect(openProgramOf({ browser: { source: 'serato' }, settings }).resultsFolded).toBe(true)
    expect(openProgramOf({ browser: { source: null }, settings }).resultsFolded).toBe(false)
  })
})

describe('programEditsOf', () => {
  const ctx = (
    sourceProgram: DjProgram | null,
    over: Partial<ProgramEditsContext> = {},
  ): ProgramEditsContext => ({
    sourceProgram,
    sourceEdit: sourceProgram && SOURCE_PROGRAMS[sourceProgram].edit,
    traktorCanSave: false,
    browser: {
      sources: ['rekordbox', 'traktor', 'engine', 'serato', 'virtualdj'],
      libraryMissing: false,
    },
    platform: 'darwin',
    ...over,
  })

  // rekordbox, Engine DJ, Serato and VirtualDJ take Surco's playlist edits as soon as their
  // tab is open: the tree and the list offer organising them.
  it.each(['rekordbox', 'engine', 'serato', 'virtualdj'] as const)(
    'lets the DJ organise %s as soon as it is open',
    (program) => {
      const edits = programEditsOf(ctx(program))
      expect(edits.editableSource).toBe(program)
      expect(edits.editProgram).toBe(program)
    },
  )

  // Traktor rewrites its collection file on quit: Surco writes it only once that file is the
  // one confirmed in Settings, or Traktor would overwrite the DJ's playlists, or Surco would
  // write a file Traktor no longer reads.
  it('lets the DJ organise Traktor only once its collection can be saved', () => {
    expect(programEditsOf(ctx('traktor')).editableSource).toBeNull()
    expect(programEditsOf(ctx('traktor', { traktorCanSave: true })).editableSource).toBe('traktor')
  })

  // The edit hooks need a program even when nothing is editable; they stay on rekordbox,
  // which every edit then refuses because no tree offers it.
  it('hands the edit hooks rekordbox while nothing is editable', () => {
    expect(programEditsOf(ctx(null)).editableSource).toBeNull()
    expect(programEditsOf(ctx(null)).editProgram).toBe('rekordbox')
    expect(programEditsOf(ctx('traktor')).editProgram).toBe('rekordbox')
  })

  // Apple Music and the files are no DJ library: nothing there may be renamed, moved,
  // pasted into or exported to a stick as if it were one.
  it('offers no tree edit and no stick on Apple Music or the files', () => {
    const edits = programEditsOf(ctx(null))
    expect(edits.treeUsbProgram).toBeNull()
    expect(edits.runningNote).toBeNull()
    expect(edits.idJoin).toBeNull()
    expect(edits.fixedNode).toBeNull()
    expect(edits.readsCollection).toBe(false)
  })

  // Engine DJ keeps flat playlists and no order Surco can write: renaming, moving a
  // playlist or making folders would leave Engine's database in a shape the decks misread.
  it('keeps Engine DJ’s tree flat, without renaming or moving playlists', () => {
    const edits = programEditsOf(ctx('engine'))
    expect(edits.canRename).toBe(false)
    expect(edits.canMoveNode).toBe(false)
    expect(edits.noFolders).toBe(true)
  })

  it.each(['rekordbox', 'traktor', 'serato', 'virtualdj'] as const)(
    'lets the DJ rename and move playlists and folders in %s',
    (program) => {
      const edits = programEditsOf(ctx(program))
      expect(edits.canRename).toBe(true)
      expect(edits.canMoveNode).toBe(true)
      expect(edits.noFolders).toBe(false)
    },
  )

  // Traktor's built-in playlists (History, Preparation…) are its own: History is never
  // touched and the others take tracks but no rename or delete.
  it('fixes Traktor’s built-in playlists and no other program’s', () => {
    expect(programEditsOf(ctx('traktor')).fixedNode).toBe(SOURCE_PROGRAMS.traktor.fixedNode)
    for (const program of ['rekordbox', 'engine', 'serato', 'virtualdj'] as const)
      expect(programEditsOf(ctx(program)).fixedNode).toBeNull()
  })

  // Serato and VirtualDJ name a playlist by its path: a rename or a move has to reopen it
  // under the new name joined the way that program joins it, or the open crate is lost.
  it('joins the playlist path the way Serato and VirtualDJ name it', () => {
    expect(programEditsOf(ctx('serato')).idJoin).toBe('%%')
    expect(programEditsOf(ctx('virtualdj')).idJoin).toBe('/')
    expect(programEditsOf(ctx('rekordbox')).idJoin).toBeNull()
  })

  // Serato and VirtualDJ rewrite their files on quit: while open, the tree says Surco is
  // waiting, so the DJ does not take an edit for lost.
  it('notes in the tree that Serato and VirtualDJ must be closed to take edits', () => {
    expect(programEditsOf(ctx('serato')).runningNote).toBe(CUE_PROGRAMS.serato.runningNote)
    expect(programEditsOf(ctx('virtualdj')).runningNote).toBe(CUE_PROGRAMS.virtualdj.runningNote)
    expect(programEditsOf(ctx('rekordbox')).runningNote).toBeNull()
  })

  // Pasting a tracklist finds each line in the whole collection: offered only where Surco
  // reads it.
  it.each(['rekordbox', 'traktor', 'engine', 'serato', 'virtualdj'] as const)(
    'offers pasting a tracklist in %s, whose collection Surco reads',
    (program) => {
      expect(programEditsOf(ctx(program)).readsCollection).toBe(true)
    },
  )

  describe('the USB export', () => {
    // A stick is written on macOS and Windows only; on Linux there is no export to offer.
    it('is offered from the rekordbox collection on macOS and Windows only', () => {
      expect(programEditsOf(ctx(null)).usbAvailable).toBe(true)
      expect(programEditsOf(ctx(null, { platform: 'win32' })).usbAvailable).toBe(true)
      expect(programEditsOf(ctx(null, { platform: 'linux' })).usbAvailable).toBe(false)
      const noRekordbox = { sources: ['engine' as const], libraryMissing: false }
      expect(programEditsOf(ctx(null, { browser: noRekordbox })).usbAvailable).toBe(false)
    })

    it.each(['rekordbox', 'traktor', 'engine', 'serato', 'virtualdj'] as const)(
      'is offered from %s’s tree on macOS',
      (program) => {
        expect(programEditsOf(ctx(program)).treeUsbProgram).toBe(program)
      },
    )

    // Serato's and VirtualDJ's stick formats are written on macOS only.
    it('is offered from the tree on Windows for rekordbox, Traktor and Engine DJ only', () => {
      const on = (program: DjProgram) =>
        programEditsOf(ctx(program, { platform: 'win32' })).treeUsbProgram
      expect(on('rekordbox')).toBe('rekordbox')
      expect(on('traktor')).toBe('traktor')
      expect(on('engine')).toBe('engine')
      expect(on('serato')).toBeNull()
      expect(on('virtualdj')).toBeNull()
      expect(programEditsOf(ctx('rekordbox', { platform: 'linux' })).treeUsbProgram).toBeNull()
    })

    // A library that is not there has nothing to copy to a stick.
    it('is not offered from a missing library', () => {
      const missing = { sources: ['rekordbox' as const], libraryMissing: true }
      expect(programEditsOf(ctx('rekordbox', { browser: missing })).treeUsbProgram).toBeNull()
      expect(programEditsOf(ctx('engine', { browser: missing })).treeUsbProgram).toBeNull()
    })

    // Engine DJ's tab stays open when its library is gone and says so: its own check
    // decides, not the source list, which names the other programs only once found.
    it('is offered from Engine DJ’s tree before the sources list it, and from no other', () => {
      const none = { sources: [], libraryMissing: false }
      expect(programEditsOf(ctx('engine', { browser: none })).treeUsbProgram).toBe('engine')
      expect(programEditsOf(ctx('rekordbox', { browser: none })).treeUsbProgram).toBeNull()
      expect(programEditsOf(ctx('serato', { browser: none })).treeUsbProgram).toBeNull()
    })
  })
})
