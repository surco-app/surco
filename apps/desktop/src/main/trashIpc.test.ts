import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrashEntry } from '../shared/types'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  shell: { showItemInFolder: vi.fn() },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))
vi.mock('./activity', () => ({ activity: { track: vi.fn() } }))
vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))

import type { SurcoTrash } from './surcoTrash'
import { registerTrashIpc } from './trashIpc'

const displaced: TrashEntry = {
  id: 'over',
  name: 'c.aiff',
  originalPath: '/m/c.aiff',
  storedPath: '/t/over-c.aiff',
  bytes: 5678,
  trashedAt: 0,
  reason: 'restored-over',
}

// Restoring an original over the file that replaced it (a review's Undo, or the Originals
// panel) rewrites that path, so Engine DJ's row follows it from the size it held.
describe('trash:restore', () => {
  const restore = vi.fn()
  const followEngineSize = vi.fn()

  beforeEach(() => {
    handlers.clear()
    followEngineSize.mockReset()
    registerTrashIpc({ restore } as unknown as SurcoTrash, { allow: vi.fn() } as never, {
      followEngineSize,
    })
  })

  it('tells Engine DJ the size of the file the original was restored over', async () => {
    restore.mockResolvedValue({ restoredTo: '/m/c.aiff', displaced })
    await handlers.get('trash:restore')?.(null, 'b1', 'undo')
    expect(followEngineSize).toHaveBeenCalledWith('/m/c.aiff', 5678)
  })

  // The conversion that replaced it cut or resampled the audio under Engine's positions: the
  // original goes back with the way back it was kept with.
  it('hands Engine DJ the way back an original was kept with', async () => {
    const shift = { trimmedMs: -1900, sampleCount: 882000 }
    const engine = { shift, over: 5678, undo: { trimmedMs: 1900 } }
    restore.mockResolvedValue({ restoredTo: '/m/c.aiff', displaced, engine })
    await handlers.get('trash:restore')?.(null, 'b1')
    expect(followEngineSize).toHaveBeenCalledWith('/m/c.aiff', 5678, shift)
  })

  // Cut twice, or retagged after the cut: the file set aside is not the one the way back was
  // measured from, and half a move is worse than none.
  it('leaves Engine DJ alone when the file set aside is not the one its way back was for', async () => {
    const engine = { shift: { trimmedMs: -1900 }, over: 4000, undo: { trimmedMs: 1900 } }
    restore.mockResolvedValue({ restoredTo: '/m/c.aiff', displaced, engine })
    await handlers.get('trash:restore')?.(null, 'b1')
    expect(followEngineSize).not.toHaveBeenCalled()
  })

  it('tells Engine DJ nothing when the original came back to an empty path', async () => {
    restore.mockResolvedValue({ restoredTo: '/m/c.aiff', displaced: null })
    await handlers.get('trash:restore')?.(null, 'b1')
    expect(followEngineSize).not.toHaveBeenCalled()
  })
})
