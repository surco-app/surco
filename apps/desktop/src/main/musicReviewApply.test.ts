import { describe, expect, it, vi } from 'vitest'
import type { MusicFieldFix } from '../shared/types'
import { type ApplyDeps, applyMusicFixes } from './musicReviewApply'

const fix = (persistentId: string, field: MusicFieldFix['field'] = 'artist'): MusicFieldFix => ({
  persistentId,
  field,
  from: 'Dj Lara',
  to: 'DJ Lara',
})

function deps(over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    setField: vi.fn().mockResolvedValue('set'),
    locate: vi.fn().mockResolvedValue('/m/a.mp3'),
    exists: vi.fn().mockResolvedValue(true),
    rewrite: vi.fn().mockResolvedValue({ outcomes: ['written'], backup: { id: 'b1' } }),
    ...over,
  }
}

describe('applyMusicFixes', () => {
  it('sets Music, then the file, and keeps the backup id for undo', async () => {
    const d = deps()
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({
      persistentId: 'A',
      path: '/m/a.mp3',
      music: ['set'],
      file: 'written',
      written: ['artist'],
      backupId: 'b1',
    })
    expect(d.rewrite).toHaveBeenCalledWith('/m/a.mp3', [
      { field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
  })

  it('writes the fields of one track in a single pass', async () => {
    const d = deps({ rewrite: vi.fn().mockResolvedValue({ outcomes: ['written', 'written'] }) })
    await applyMusicFixes([fix('A'), fix('A', 'genre')], d)
    expect(d.rewrite).toHaveBeenCalledTimes(1)
  })

  // The entry changed in Music after the review read it: the review no longer knows what
  // the right value is, so neither Music nor the file is touched for that field.
  it('touches nothing on disk when Music no longer holds the value', async () => {
    const d = deps({ setField: vi.fn().mockResolvedValue('mismatch') })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({ music: ['mismatch'], file: 'skipped', written: [] })
    expect(d.rewrite).not.toHaveBeenCalled()
  })

  it('reports a Music-only fix when the entry has no file on disk', async () => {
    const d = deps({ exists: vi.fn().mockResolvedValue(false) })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({ music: ['set'], file: 'missing', written: [] })
  })

  it('reports a failed file write and carries on with the next track', async () => {
    const rewrite = vi
      .fn()
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValue({ outcomes: ['written'] })
    const outs = await applyMusicFixes([fix('A'), fix('B')], deps({ rewrite }))
    expect(outs.map((o) => o.file)).toEqual(['failed', 'written'])
    expect(outs[0].error).toBe('EACCES')
  })

  it('stops before the next track when cancelled and leaves the rest untouched', async () => {
    let cancelled = false
    const d = deps({
      setField: vi.fn().mockImplementation(async () => {
        cancelled = true
        return 'set'
      }),
    })
    const outs = await applyMusicFixes([fix('A'), fix('B')], d, { isCancelled: () => cancelled })
    expect(outs.map((o) => o.persistentId)).toEqual(['A'])
  })

  // A track takes seconds (Music, then the file and its check); reporting only when one
  // finished left the first seconds of a run looking like nothing had started.
  it('reports each track when it starts and when it finishes', async () => {
    const onProgress = vi.fn()
    await applyMusicFixes([fix('A'), fix('B')], deps(), { onProgress })
    expect(onProgress.mock.calls).toEqual([
      [{ done: 0, total: 2, current: 1 }],
      [{ done: 1, total: 2, current: 1 }],
      [{ done: 1, total: 2, current: 2 }],
      [{ done: 2, total: 2, current: 2 }],
    ])
  })

  it('reports the first track before Music answers for it', async () => {
    const onProgress = vi.fn()
    let answer: (v: 'set') => void = () => {}
    const setField = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const run = applyMusicFixes([fix('A')], deps({ setField }), { onProgress })
    await Promise.resolve()
    expect(onProgress).toHaveBeenCalledWith({ done: 0, total: 1, current: 1 })
    answer('set')
    await run
  })

  it('keeps every outcome when the progress hook throws', async () => {
    const onProgress = vi.fn().mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    const outs = await applyMusicFixes([fix('A'), fix('B')], deps(), { onProgress })
    expect(outs.map((o) => o.file)).toEqual(['written', 'written'])
  })

  it('marks a rejected Music write as failed and skips the file', async () => {
    const d = deps({ setField: vi.fn().mockRejectedValue(new Error('osascript')) })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({ music: ['failed'], file: 'skipped' })
    expect(d.rewrite).not.toHaveBeenCalled()
  })

  it('writes only the fields Music accepted and reports only those written', async () => {
    const setField = vi.fn().mockResolvedValueOnce('mismatch').mockResolvedValueOnce('set')
    const rewrite = vi.fn().mockResolvedValue({ outcomes: ['written'] })
    const [out] = await applyMusicFixes([fix('A'), fix('A', 'genre')], deps({ setField, rewrite }))
    expect(rewrite).toHaveBeenCalledWith('/m/a.mp3', [
      { field: 'genre', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(out).toMatchObject({ music: ['mismatch', 'set'], written: ['genre'] })
  })

  it('lists as written only the fields the file reported written', async () => {
    const rewrite = vi.fn().mockResolvedValue({ outcomes: ['written', 'unchanged'] })
    const [out] = await applyMusicFixes([fix('A'), fix('A', 'genre')], deps({ rewrite }))
    expect(out.written).toEqual(['artist'])
  })

  it('reports a missing file with no path when the location cannot be read', async () => {
    const d = deps({ locate: vi.fn().mockRejectedValue(new Error('gone')) })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({ file: 'missing' })
    expect(out.path).toBeUndefined()
  })
})
