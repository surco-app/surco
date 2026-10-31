import { describe, expect, it, vi } from 'vitest'
import { errorWithKey } from '../shared/errorKeys'
import type { ActivityEvent, MusicFieldFix, TrashEntry } from '../shared/types'
import { createActivity } from './activity'
import type { PreparedRewrite, TagFieldChange } from './musicFieldWrite'
import { type ApplyDeps, applyMusicFixes } from './musicReviewApply'

const fix = (persistentId: string, field: MusicFieldFix['field'] = 'artist'): MusicFieldFix => ({
  persistentId,
  field,
  from: 'Dj Lara',
  to: 'DJ Lara',
})

type Rewrite = (file: string, changes: TagFieldChange[]) => ReturnType<PreparedRewrite['write']>

function deps({
  rewrite = vi.fn().mockResolvedValue({ outcomes: ['written'], backup: { id: 'b1' } }),
  ...over
}: Partial<ApplyDeps> & { rewrite?: Rewrite } = {}) {
  const abandon = vi.fn().mockResolvedValue(undefined)
  return {
    setField: vi.fn().mockResolvedValue('set'),
    locate: vi.fn().mockResolvedValue('/m/a.mp3'),
    exists: vi.fn().mockResolvedValue(true),
    prepare: vi.fn(async (file: string) => ({
      write: (changes: TagFieldChange[]) => rewrite(file, changes),
      abandon,
      keep: async () => undefined,
      backup: () => undefined,
    })),
    ...over,
    rewrite,
    abandon,
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
    await vi.waitFor(() => expect(setField).toHaveBeenCalled())
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

  // Music rewrites its copy of the file the moment the tag is set, so the backup the
  // review's Undo restores has to exist before Music is asked.
  it('backs up the file before Music is asked', async () => {
    const order: string[] = []
    const d = deps({
      setField: vi.fn(async () => {
        order.push('music')
        return 'set' as const
      }),
      prepare: async () => {
        order.push('backup')
        return {
          write: async () => ({ outcomes: ['written'] }),
          abandon: async () => {},
          keep: async () => undefined,
          backup: () => undefined,
        }
      },
    })
    await applyMusicFixes([fix('A')], d)
    expect(order).toEqual(['backup', 'music'])
  })

  // A timeout says nothing about whether Music wrote first: the copy stays, and Undo gets it.
  it('keeps the backup when Music did not answer, since it may have written', async () => {
    const abandon = vi.fn(async () => {})
    const d = deps({
      setField: vi.fn().mockRejectedValue(new Error('AppleEvent timed out (-1712)')),
      prepare: async () => ({
        write: async () => ({ outcomes: ['written'] }),
        abandon,
        keep: async () => ({ id: 'b1' }) as TrashEntry,
        backup: () => ({ id: 'b1' }) as TrashEntry,
      }),
    })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(abandon).not.toHaveBeenCalled()
    expect(out).toMatchObject({ music: ['failed'], file: 'skipped', backupId: 'b1' })
  })

  it('drops the backup when Music refused every field', async () => {
    const d = deps({ setField: vi.fn().mockResolvedValue('mismatch') })
    await applyMusicFixes([fix('A')], d)
    expect(d.abandon).toHaveBeenCalledTimes(1)
  })

  // Asking Music anyway would let it rewrite the file with no copy to go back to.
  it('leaves Music alone when the file could not be backed up', async () => {
    const d = deps({ prepare: vi.fn().mockRejectedValue(new Error('no-backup')) })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(d.setField).not.toHaveBeenCalled()
    expect(out).toMatchObject({ file: 'failed', error: 'no-backup', written: [] })
  })

  it('carries the backup of a failed write that kept it, so Undo can restore it', async () => {
    const d = deps({
      prepare: async () => ({
        write: async () => {
          throw new Error('EACCES')
        },
        abandon: async () => {},
        keep: async () => undefined,
        backup: () => ({ id: 'b1' }) as TrashEntry,
      }),
    })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({ file: 'failed', error: 'EACCES', backupId: 'b1' })
  })

  it('reports a missing file with no path when Music holds no file for the entry', async () => {
    const d = deps({ locate: vi.fn().mockResolvedValue('') })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(out).toMatchObject({ music: ['set'], file: 'missing' })
    expect(out.path).toBeUndefined()
  })

  // A location Music did not answer may well be a file: asked anyway, Music would rewrite
  // it with no backup taken.
  it('leaves Music alone when the location could not be read', async () => {
    const d = deps({ locate: vi.fn().mockRejectedValue(new Error('osascript timed out')) })
    const [out] = await applyMusicFixes([fix('A')], d)
    expect(d.setField).not.toHaveBeenCalled()
    expect(out).toMatchObject({ file: 'failed', error: 'osascript timed out', written: [] })
  })
})

// The user applied fixes and Activity showed nothing. Every field the review touches gets
// a row under the run's group, started when its track starts and ended with what happened
// in Music and in the file.
describe('applyMusicFixes in Activity', () => {
  function logged() {
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))
    return {
      events,
      log: { track: activity.track, group: 'review-1', titleOf: (pid: string) => `Title ${pid}` },
    }
  }
  const ends = (events: ActivityEvent[]) => events.filter((e) => e.phase !== 'start')

  it('names each field of each track and groups them under the run', async () => {
    const { events, log } = logged()
    await applyMusicFixes([fix('A'), fix('A', 'genre'), fix('B')], deps(), { log })
    const starts = events.filter((e) => e.phase === 'start')
    expect(starts.map((e) => [e.labelKey, e.labelParams])).toEqual([
      ['activity.reviewFix.artist', { title: 'Title A' }],
      ['activity.reviewFix.genre', { title: 'Title A' }],
      ['activity.reviewFix.artist', { title: 'Title B' }],
    ])
    expect(starts[0]).toMatchObject({
      kind: 'applemusic',
      group: 'review-1',
      groupLabelKey: 'activity.reviewRun',
      groupLabelParams: { count: 2 },
    })
  })

  // Rows appear while the run goes: a track's rows start before the next track's work.
  it('starts a track row before that track is written and ends it after', async () => {
    const { events, log } = logged()
    const seen: string[] = []
    const rewrite = vi.fn(async () => {
      seen.push(events.map((e) => e.phase).join(','))
      return { outcomes: ['written' as const], backup: { id: 'b1' } as TrashEntry }
    })
    await applyMusicFixes([fix('A'), fix('B')], deps({ rewrite }), { log })
    expect(seen).toEqual(['start', 'start,done,start'])
  })

  it.each([
    ['written with a backup', {}, 'done', 'activity.reviewFixWrittenBackup'],
    [
      'written without a backup',
      { rewrite: vi.fn().mockResolvedValue({ outcomes: ['written'] }) },
      'done',
      'activity.reviewFixWritten',
    ],
    [
      'left alone because the file held another value',
      { rewrite: vi.fn().mockResolvedValue({ outcomes: ['unchanged'] }) },
      'warn',
      'activity.reviewFixFileDiffers',
    ],
    [
      'changed in Music only, with no file',
      { exists: vi.fn().mockResolvedValue(false) },
      'warn',
      'activity.reviewFixNoFile',
    ],
    [
      'refused by Music',
      { setField: vi.fn().mockResolvedValue('mismatch') },
      'warn',
      'activity.reviewFixMusicMismatch',
    ],
    [
      'gone from Music',
      { setField: vi.fn().mockResolvedValue('missing') },
      'warn',
      'activity.reviewFixMusicMissing',
    ],
    [
      'unanswered by Music',
      { setField: vi.fn().mockRejectedValue(new Error('timeout')) },
      'error',
      'activity.reviewFixMusicFailed',
    ],
  ] as const)('ends a field %s', async (_name, over, phase, detailKey) => {
    const { events, log } = logged()
    await applyMusicFixes([fix('A')], deps(over), { log })
    expect(ends(events)).toEqual([expect.objectContaining({ phase, detailKey })])
  })

  it('carries the error of a file that could not be written', async () => {
    const { events, log } = logged()
    await applyMusicFixes(
      [fix('A')],
      deps({ rewrite: vi.fn().mockRejectedValue(new Error('no-backup')) }),
      { log },
    )
    expect(ends(events)).toEqual([
      expect.objectContaining({
        phase: 'error',
        detailKey: 'activity.reviewFixFileFailed',
        detailParams: { error: 'no-backup' },
      }),
    ])
  })

  // The backup is taken before Music is asked, so a refused one leaves Music and the file as
  // they were. Saying "changed in Music" there sends the DJ looking for a change never made.
  it('says nothing changed when the backup was refused before Music was asked', async () => {
    const { events, log } = logged()
    const refused = errorWithKey('noBackup', '/m/A.mp3').message
    await applyMusicFixes(
      [fix('A')],
      deps({ prepare: vi.fn().mockRejectedValue(new Error(refused)) }),
      { log },
    )
    expect(ends(events)).toEqual([
      expect.objectContaining({
        phase: 'error',
        detailKey: 'activity.reviewFixUntouched',
        detailParams: { error: refused },
      }),
    ])
  })

  // One field of a track written and the other refused by the file guard: each row says
  // its own field's fate, not the track's.
  it('says each field of one track apart', async () => {
    const { events, log } = logged()
    await applyMusicFixes(
      [fix('A'), fix('A', 'genre')],
      deps({ rewrite: vi.fn().mockResolvedValue({ outcomes: ['written', 'unchanged'] }) }),
      { log },
    )
    expect(ends(events).map((e) => [e.phase, e.detailKey])).toEqual([
      ['done', 'activity.reviewFixWritten'],
      ['warn', 'activity.reviewFixFileDiffers'],
    ])
  })
})
