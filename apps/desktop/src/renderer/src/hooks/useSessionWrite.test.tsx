// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PlaylistEditMode,
  PlaylistTrackRef,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
} from '../../../shared/types'
import { useSessionWrite } from './useSessionWrite'

afterEach(cleanup)

const tracks: PlaylistTrackRef[] = [
  { contentId: 'a', paths: ['/m/a.mp3'] },
  { contentId: 'b', paths: ['/m/b.mp3'] },
]

const applied = (createdId?: string): RekordboxEditResult => ({ applied: true, createdId })
const queued = (opId: string): RekordboxEditResult => ({ applied: false, queued: true, opId })
const refused: RekordboxEditResult = { applied: false, reason: 'write-failed' }

type Edit = (
  edit: RekordboxPlaylistEdit,
  name: string,
  mode?: PlaylistEditMode,
) => Promise<RekordboxEditResult>

function setup(script: (edit: RekordboxPlaylistEdit) => RekordboxEditResult) {
  const edit = vi.fn<Edit>(async (e) => script(e))
  const { result } = renderHook(() => useSessionWrite(edit))
  return { edit, writer: result.current }
}

const kinds = (edit: ReturnType<typeof setup>['edit']): string[] =>
  edit.mock.calls.map(([e]) => e.kind)

describe('useSessionWrite', () => {
  it('writes nothing until it is asked to', () => {
    const { edit } = setup(() => applied('new'))
    expect(edit).not.toHaveBeenCalled()
  })

  describe('create', () => {
    it('makes the playlist with its tracks in one edit that may wait for the program to close', async () => {
      const { edit, writer } = setup(() => applied('new'))

      expect(await writer.create('folder', 'Sesión del 9/11', tracks)).toEqual({ id: 'new' })
      expect(edit).toHaveBeenCalledExactlyOnceWith(
        { kind: 'create', parentId: 'folder', name: 'Sesión del 9/11', folder: false, tracks },
        'Sesión del 9/11',
        'queue',
      )
    })

    it('says the playlist waits in the queue while the program is open', async () => {
      const { writer } = setup(() => queued('op1'))
      expect(await writer.create('folder', 'S', tracks)).toEqual({ queued: 'op1' })
    })

    it('says it could not when the program refuses', async () => {
      const { writer } = setup(() => refused)
      expect(await writer.create('folder', 'S', tracks)).toBeNull()
    })
  })

  describe('replace', () => {
    it('builds the new playlist first and only then deletes the old one, both able to wait', async () => {
      const { edit, writer } = setup((e) => (e.kind === 'create' ? applied('new') : applied()))

      expect(await writer.replace('folder', 'old', 'Sesión', tracks)).toEqual({ id: 'new' })
      expect(kinds(edit)).toEqual(['create', 'delete'])
      expect(edit.mock.calls[1]).toEqual([{ kind: 'delete', playlistId: 'old' }, 'Sesión', 'queue'])
    })

    it('queues the delete behind the new playlist when the program is open', async () => {
      const { edit, writer } = setup((e) => (e.kind === 'create' ? queued('op1') : queued('op2')))

      expect(await writer.replace('folder', 'old', 'Sesión', tracks)).toEqual({ queued: 'op1' })
      expect(kinds(edit)).toEqual(['create', 'delete'])
    })

    it('leaves the old playlist alone when the new one cannot be created', async () => {
      const { edit, writer } = setup(() => refused)

      expect(await writer.replace('folder', 'old', 'Sesión', tracks)).toBeNull()
      expect(kinds(edit)).toEqual(['create'])
    })

    it('still hands over the new playlist when the old one could not be deleted', async () => {
      const { writer } = setup((e) => (e.kind === 'create' ? applied('new') : refused))
      expect(await writer.replace('folder', 'old', 'Sesión', tracks)).toEqual({ id: 'new' })
    })
  })

  describe('fill', () => {
    it('adds the tracks in session order to the playlist that already exists, and creates nothing', async () => {
      const { edit, writer } = setup(() => applied())

      expect(await writer.fill('empty', 'Session 11-9', tracks)).toBe('written')
      expect(edit).toHaveBeenCalledExactlyOnceWith(
        { kind: 'add', playlistId: 'empty', tracks },
        'Session 11-9',
        'queue',
      )
    })

    it('says the tracks wait in the queue while the program is open', async () => {
      const { writer } = setup(() => queued('op1'))
      expect(await writer.fill('empty', 'Session 11-9', tracks)).toBe('queued')
    })

    it('says it could not when the program refuses, and never deletes the playlist', async () => {
      const { edit, writer } = setup(() => refused)

      expect(await writer.fill('empty', 'Session 11-9', tracks)).toBe('refused')
      expect(kinds(edit)).toEqual(['add'])
    })
  })
})
