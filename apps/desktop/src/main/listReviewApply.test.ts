import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, ReviewFix } from '../shared/types'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { createActivity } from './activity'
import { applyListFixes, type ListApplyDeps } from './listReviewApply'
import { rewriteTagFields } from './musicFieldWrite'

const fix = (id: string, field: ReviewFix['field'] = 'artist'): ReviewFix => ({
  id,
  field,
  from: 'Dj Lara',
  to: 'DJ Lara',
})

function deps(over: Partial<ListApplyDeps> = {}): ListApplyDeps {
  return {
    allowed: () => true,
    exists: vi.fn().mockResolvedValue(true),
    rewrite: vi.fn().mockResolvedValue({ outcomes: ['written'], backup: { id: 'b1' } }),
    setMusicField: vi.fn().mockResolvedValue('set'),
    ...over,
  }
}

describe('applyListFixes', () => {
  it('writes the file, then the Music entry on it, and keeps the backup for undo', async () => {
    const calls: string[] = []
    const d = deps({
      rewrite: vi.fn(async () => {
        calls.push('file')
        return { outcomes: ['written' as const], backup: { id: 'b1' } as never }
      }),
      setMusicField: vi.fn(async () => {
        calls.push('music')
        return 'set' as const
      }),
    })
    const [out] = await applyListFixes(
      { fixes: [fix('/m/a.aiff')], music: { '/m/a.aiff': 'PID' } },
      d,
    )
    expect(calls).toEqual(['file', 'music'])
    expect(out).toEqual({
      id: '/m/a.aiff',
      musicId: 'PID',
      path: '/m/a.aiff',
      fixes: [fix('/m/a.aiff')],
      music: ['set'],
      file: 'written',
      written: ['artist'],
      backupId: 'b1',
    })
    expect(d.setMusicField).toHaveBeenCalledWith('PID', 'artist', 'Dj Lara', 'DJ Lara', '/m/a.aiff')
  })

  // The file is the guard: another app retagged it since the list read it, so the review
  // no longer knows the right value and neither the file nor Music is touched.
  it('leaves Music alone for a field the file no longer held', async () => {
    const d = deps({ rewrite: vi.fn().mockResolvedValue({ outcomes: ['unchanged', 'written'] }) })
    const [out] = await applyListFixes(
      { fixes: [fix('/m/a.aiff'), fix('/m/a.aiff', 'genre')], music: { '/m/a.aiff': 'PID' } },
      d,
    )
    expect(out).toMatchObject({ music: ['none', 'set'], file: 'written', written: ['genre'] })
    expect(d.setMusicField).toHaveBeenCalledTimes(1)
  })

  it('reports a file that no longer held anything to change as unchanged', async () => {
    const d = deps({ rewrite: vi.fn().mockResolvedValue({ outcomes: ['unchanged'] }) })
    const [out] = await applyListFixes({ fixes: [fix('/m/a.aiff')], music: {} }, d)
    expect(out).toMatchObject({ file: 'unchanged', written: [], music: ['none'] })
    expect(out).not.toHaveProperty('backupId')
  })

  it('writes the file alone when it is not in Music, or off macOS', async () => {
    const d = deps({ setMusicField: undefined })
    const [out] = await applyListFixes(
      { fixes: [fix('/m/a.aiff')], music: { '/m/a.aiff': 'PID' } },
      d,
    )
    expect(out).toMatchObject({ file: 'written', music: ['none'] })
  })

  it('counts a Music entry that says something else, without failing the file', async () => {
    const d = deps({ setMusicField: vi.fn().mockResolvedValue('mismatch') })
    const [out] = await applyListFixes(
      { fixes: [fix('/m/a.aiff')], music: { '/m/a.aiff': 'PID' } },
      d,
    )
    expect(out).toMatchObject({ file: 'written', music: ['mismatch'] })
  })

  it('counts a Music write that threw as failed, keeping the file written', async () => {
    const d = deps({ setMusicField: vi.fn().mockRejectedValue(new Error('osascript')) })
    const [out] = await applyListFixes(
      { fixes: [fix('/m/a.aiff')], music: { '/m/a.aiff': 'PID' } },
      d,
    )
    expect(out).toMatchObject({ file: 'written', music: ['failed'], backupId: 'b1' })
  })

  it('reports a missing file and a failed write and carries on', async () => {
    const d = deps({
      exists: vi.fn(async (p: string) => p !== '/m/gone.aiff'),
      rewrite: vi.fn(async (p: string) => {
        if (p === '/m/bad.aiff') throw new Error('locked')
        return { outcomes: ['written' as const] }
      }),
    })
    const out = await applyListFixes(
      { fixes: [fix('/m/gone.aiff'), fix('/m/bad.aiff'), fix('/m/ok.aiff')], music: {} },
      d,
    )
    expect(out.map((o) => o.file)).toEqual(['missing', 'failed', 'written'])
    expect(out[1].error).toBe('locked')
  })

  // A compromised renderer could otherwise rewrite any file the OS user can touch.
  it('refuses a path the app never handed to the renderer', async () => {
    const d = deps({ allowed: (p) => p !== '/etc/hosts' })
    const [out] = await applyListFixes({ fixes: [fix('/etc/hosts')], music: {} }, d)
    expect(out).toMatchObject({ file: 'failed', error: 'pathNotAllowed' })
    expect(d.rewrite).not.toHaveBeenCalled()
  })

  it('writes the fields of one file in one pass and stops at a cancel', async () => {
    let cancelled = false
    const d = deps({
      rewrite: vi.fn(async () => {
        cancelled = true
        return { outcomes: ['written' as const, 'written' as const] }
      }),
    })
    const out = await applyListFixes(
      { fixes: [fix('/m/a.aiff'), fix('/m/a.aiff', 'genre'), fix('/m/b.aiff')], music: {} },
      d,
      { isCancelled: () => cancelled },
    )
    expect(d.rewrite).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(1)
  })

  it('reports each file as it starts and as it finishes', async () => {
    const onProgress = vi.fn()
    await applyListFixes({ fixes: [fix('/m/a.aiff')], music: {} }, deps(), { onProgress })
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 1, current: 1 },
      { done: 1, total: 1, current: 1 },
    ])
  })

  // The list shows a file-name guess where the file has no tag. That guess is not what the
  // file holds, so the fix must stop at the file and never reach the disk or Music.
  it('writes nothing for a value the list guessed from the file name', async () => {
    const FF = ffmpegStatic as unknown as string
    const file = join(mkdtempSync(join(tmpdir(), 'surco-list-apply-')), 'Dj Lara - Song.aiff')
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'pcm_s16be',
      '-map_metadata',
      '-1',
      file,
    ])
    const before = readFileSync(file)
    const d = deps({ rewrite: (f, changes) => rewriteTagFields(f, changes) })
    const [out] = await applyListFixes({ fixes: [fix(file)], music: { [file]: 'PID' } }, d)
    expect(out).toMatchObject({ file: 'unchanged', written: [], music: ['none'] })
    expect(d.setMusicField).not.toHaveBeenCalled()
    expect(readFileSync(file).equals(before)).toBe(true)
  }, 60000)
})

// The list review left Activity empty too. Every field it touches gets a row under the
// run's group, ended with what happened in the file and then in Music.
describe('applyListFixes in Activity', () => {
  function logged() {
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))
    return {
      events,
      log: { track: activity.track, group: 'list-1', titleOf: (path: string) => `Title ${path}` },
    }
  }
  const ends = (events: ActivityEvent[]) => events.filter((e) => e.phase !== 'start')
  const inMusic = { '/m/a.aiff': 'PID' }

  it('names each field of each file and groups them under the run', async () => {
    const { events, log } = logged()
    await applyListFixes(
      { fixes: [fix('/m/a.aiff'), fix('/m/a.aiff', 'genre'), fix('/m/b.aiff')], music: {} },
      deps(),
      { log },
    )
    const starts = events.filter((e) => e.phase === 'start')
    expect(starts.map((e) => [e.labelKey, e.labelParams])).toEqual([
      ['activity.reviewFix.artist', { title: 'Title /m/a.aiff' }],
      ['activity.reviewFix.genre', { title: 'Title /m/a.aiff' }],
      ['activity.reviewFix.artist', { title: 'Title /m/b.aiff' }],
    ])
    expect(starts[0]).toMatchObject({
      kind: 'applemusic',
      group: 'list-1',
      groupLabelKey: 'activity.listReviewRun',
      groupLabelParams: { count: 2 },
    })
  })

  it.each([
    [
      'written and set in Music, with a backup',
      {},
      inMusic,
      'done',
      'activity.reviewFixWrittenBackup',
    ],
    [
      'written and set in Music, without a backup',
      { rewrite: vi.fn().mockResolvedValue({ outcomes: ['written'] }) },
      inMusic,
      'done',
      'activity.reviewFixWritten',
    ],
    [
      'written to a file Music does not hold',
      {},
      {},
      'done',
      'activity.listReviewFixWrittenBackup',
    ],
    [
      'written to a file Music does not hold, without a backup',
      { rewrite: vi.fn().mockResolvedValue({ outcomes: ['written'] }) },
      {},
      'done',
      'activity.listReviewFixWritten',
    ],
    [
      'left alone because the file held another value',
      { rewrite: vi.fn().mockResolvedValue({ outcomes: ['unchanged'] }) },
      inMusic,
      'warn',
      'activity.listReviewFixFileDiffers',
    ],
    [
      'left alone because the file is gone',
      { exists: vi.fn().mockResolvedValue(false) },
      inMusic,
      'warn',
      'activity.listReviewFixNoFile',
    ],
    [
      'written but refused by Music',
      { setMusicField: vi.fn().mockResolvedValue('mismatch') },
      inMusic,
      'warn',
      'activity.listReviewFixMusicMismatch',
    ],
    [
      'written but gone from Music',
      { setMusicField: vi.fn().mockResolvedValue('missing') },
      inMusic,
      'warn',
      'activity.listReviewFixMusicMissing',
    ],
    [
      'written but unanswered by Music',
      { setMusicField: vi.fn().mockRejectedValue(new Error('timeout')) },
      inMusic,
      'error',
      'activity.listReviewFixMusicFailed',
    ],
  ] as const)('ends a field %s', async (_name, over, music, phase, detailKey) => {
    const { events, log } = logged()
    await applyListFixes({ fixes: [fix('/m/a.aiff')], music }, deps(over), { log })
    expect(ends(events)).toEqual([expect.objectContaining({ phase, detailKey })])
  })

  it('carries the error of a file that could not be written', async () => {
    const { events, log } = logged()
    await applyListFixes(
      { fixes: [fix('/m/a.aiff')], music: {} },
      deps({ rewrite: vi.fn().mockRejectedValue(new Error('no-backup')) }),
      { log },
    )
    expect(ends(events)).toEqual([
      expect.objectContaining({
        phase: 'error',
        detailKey: 'activity.listReviewFixFileFailed',
        detailParams: { error: 'no-backup' },
      }),
    ])
  })
})
