// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
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
const refused: RekordboxEditResult = { applied: false, reason: 'rekordbox-running' }

type Edit = (edit: RekordboxPlaylistEdit, name: string) => Promise<RekordboxEditResult>

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
    it('makes the playlist and adds the tracks in session order, then names it', async () => {
      const { edit, writer } = setup((e) => (e.kind === 'create' ? applied('new') : applied()))

      const id = await writer.create('folder', 'Sesión del 9/11', tracks)

      expect(id).toBe('new')
      expect(edit.mock.calls[0][0]).toEqual({
        kind: 'create',
        parentId: 'folder',
        name: 'Sesión del 9/11',
        folder: false,
      })
      expect(edit.mock.calls[1][0]).toEqual({ kind: 'add', playlistId: 'new', tracks })
    })

    it('adds nothing when the playlist could not be created', async () => {
      const { edit, writer } = setup(() => refused)

      const id = await writer.create('folder', 'S', tracks)

      expect(id).toBeNull()
      expect(kinds(edit)).toEqual(['create'])
    })

    it('removes the empty playlist it made when the tracks could not be added', async () => {
      const { edit, writer } = setup((e) =>
        e.kind === 'create' ? applied('new') : e.kind === 'add' ? refused : applied(),
      )

      const id = await writer.create('folder', 'S', tracks)

      expect(id).toBeNull()
      expect(kinds(edit)).toEqual(['create', 'add', 'delete'])
      expect(edit.mock.calls[2][0]).toEqual({ kind: 'delete', playlistId: 'new' })
    })
  })

  describe('replace', () => {
    it('builds the new playlist first and only then deletes the old one', async () => {
      const { edit, writer } = setup((e) => (e.kind === 'create' ? applied('new') : applied()))

      const id = await writer.replace('folder', 'old', 'Sesión', tracks)

      expect(id).toBe('new')
      expect(kinds(edit)).toEqual(['create', 'add', 'delete'])
      expect(edit.mock.calls[2][0]).toEqual({ kind: 'delete', playlistId: 'old' })
    })

    it('leaves the old playlist alone when the new one cannot be created', async () => {
      const { edit, writer } = setup(() => refused)

      const id = await writer.replace('folder', 'old', 'Sesión', tracks)

      expect(id).toBeNull()
      expect(edit.mock.calls.some(([e]) => e.kind === 'delete')).toBe(false)
    })

    it('leaves the old playlist alone when the new one cannot be filled', async () => {
      const { edit, writer } = setup((e) =>
        e.kind === 'create' ? applied('new') : e.kind === 'add' ? refused : applied(),
      )

      const id = await writer.replace('folder', 'old', 'Sesión', tracks)

      expect(id).toBeNull()
      const deleted = edit.mock.calls
        .map(([e]) => e)
        .filter((e) => e.kind === 'delete')
        .map((e) => (e.kind === 'delete' ? e.playlistId : ''))
      expect(deleted).toEqual(['new'])
    })

    it('still hands over the new playlist when the old one could not be deleted', async () => {
      const { writer } = setup((e) =>
        e.kind === 'create' ? applied('new') : e.kind === 'delete' ? refused : applied(),
      )

      expect(await writer.replace('folder', 'old', 'Sesión', tracks)).toBe('new')
    })
  })
})
