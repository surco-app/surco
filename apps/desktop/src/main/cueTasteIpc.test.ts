import { describe, expect, it, vi } from 'vitest'
import type { CueProfile } from '../shared/cueProfile'
import type { TasteTrack } from '../shared/dropTaste'
import type { CueTaste } from './cueTaste'
import { registerCueTasteIpc } from './cueTasteIpc'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}))

const PROFILE = { learnedAt: '2026-10-28T10:00:00.000Z' } as CueProfile

function taste(): CueTaste {
  return {
    profile: () => PROFILE,
    edits: () => ({ count: 3, sinceLearn: 2 }),
    record: vi.fn(),
    learn: vi.fn(async () => PROFILE),
  }
}

const track: TasteTrack = { key: '103', candidates: [{ bar: 8, features: [1] }], drops: [8] }

describe('registerCueTasteIpc', () => {
  it('answers the profile with the edits and the marked rekordbox tracks it could learn from', async () => {
    registerCueTasteIpc({ taste: taste(), marked: () => 1576, learnFromEdits: () => true })
    expect(await handlers.get('cues:profile')?.({})).toEqual({
      profile: PROFILE,
      edits: { count: 3, sinceLearn: 2 },
      marked: 1576,
    })
  })

  it('learns when asked', async () => {
    const t = taste()
    registerCueTasteIpc({ taste: t, marked: () => 0, learnFromEdits: () => true })
    expect(await handlers.get('cues:learn')?.({})).toBe(PROFILE)
    expect(t.learn).toHaveBeenCalled()
  })

  it('records an edit and lets it start a learning only while the DJ allows learning from edits', () => {
    const t = taste()
    let allowed = true
    registerCueTasteIpc({ taste: t, marked: () => 0, learnFromEdits: () => allowed })
    handlers.get('cues:recordEdit')?.({}, track)
    allowed = false
    handlers.get('cues:recordEdit')?.({}, track)
    expect(vi.mocked(t.record).mock.calls).toEqual([
      [track, true],
      [track, false],
    ])
  })
})
