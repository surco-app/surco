// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PlaylistTrackRef,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
} from '../../../shared/types'
import { djReads } from '../test/api'
import { useSessionWrite } from './useSessionWrite'

afterEach(cleanup)

const tracks: PlaylistTrackRef[] = [
  { contentId: 'a', paths: ['/m/a.mp3'] },
  { contentId: 'b', paths: ['/m/b.mp3'] },
]

const applied = (createdId?: string): RekordboxEditResult => ({ applied: true, createdId })
const queued = (opId: string): RekordboxEditResult => ({ applied: false, queued: true, opId })
const refused: RekordboxEditResult = { applied: false, reason: 'write-failed' }

type Edit = (edit: RekordboxPlaylistEdit, name: string) => Promise<RekordboxEditResult>

function setup(script: (edit: RekordboxPlaylistEdit) => RekordboxEditResult) {
  const calls: string[] = []
  const askToApply = vi.fn(async () => {
    calls.push('ask')
    return {}
  })
  ;(window as unknown as { api: unknown }).api = { dj: { ...djReads({}), askToApply } }
  const edit = vi.fn<Edit>(async (e) => {
    calls.push(e.kind)
    return script(e)
  })
  const { result } = renderHook(() => useSessionWrite(edit, 'engine'))
  return { edit, askToApply, calls, writer: result.current }
}

const kinds = (edit: ReturnType<typeof setup>['edit']): string[] =>
  edit.mock.calls.map(([e]) => e.kind)

describe('useSessionWrite', () => {
  it('writes nothing until it is asked to', () => {
    const { edit } = setup(() => applied('new'))
    expect(edit).not.toHaveBeenCalled()
  })

  describe('asking to close the program', () => {
    it('asks once for a session that creates, fills and deletes playlists, not once per write', async () => {
      const { askToApply, calls, writer } = setup((e) =>
        e.kind === 'create' ? applied('new') : applied(),
      )

      await writer.replace('folder', 'old', 'Sesión', tracks)

      expect(askToApply).toHaveBeenCalledExactlyOnceWith(['engine'])
      expect(calls).toEqual(['ask', 'create', 'delete'])
    })

    it('asks before filling an existing playlist, since the DJ may want it written now', async () => {
      const { askToApply, calls, writer } = setup(() => applied())

      await writer.fill('empty', 'Session', tracks)

      expect(askToApply).toHaveBeenCalledExactlyOnceWith(['engine'])
      expect(calls).toEqual(['ask', 'add'])
    })

    it('asks before creating a playlist', async () => {
      const { askToApply, calls, writer } = setup(() => applied('new'))

      await writer.create('folder', 'Session', tracks)

      expect(askToApply).toHaveBeenCalledExactlyOnceWith(['engine'])
      expect(calls).toEqual(['ask', 'create'])
    })
  })

  describe('create', () => {
    it('makes the playlist with its tracks in one edit that may wait for the program to close', async () => {
      const { edit, writer } = setup(() => applied('new'))

      expect(await writer.create('folder', 'Sesión del 9/11', tracks)).toEqual({ id: 'new' })
      expect(edit).toHaveBeenCalledExactlyOnceWith(
        { kind: 'create', parentId: 'folder', name: 'Sesión del 9/11', folder: false, tracks },
        'Sesión del 9/11',
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
      expect(edit.mock.calls[1]).toEqual([{ kind: 'delete', playlistId: 'old' }, 'Sesión'])
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
