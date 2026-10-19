import { describe, expect, it } from 'vitest'
import type { UsbPlanTrack } from '../../../shared/types'
import {
  bytesDone,
  bytesToCopy,
  exportCounts,
  formatSpan,
  IDLE_EXPORT,
  isRunning,
  speed,
  timeLeft,
  type UsbExportAction,
  usbExportReducer,
  wavePath,
} from './usbExport'

const t = (id: string, size: number, onStick = false, separator = false): UsbPlanTrack => ({
  id,
  title: id,
  artist: 'A',
  size,
  onStick,
  separator,
  cover: null,
  wave: null,
})
const TRACKS = [t('a', 100), t('b', 50, true), t('c', 200)]
const STARTED: UsbExportAction = {
  type: 'started',
  tracks: TRACKS,
  targetName: 'Surco',
  startedAt: 0,
}

const run = (...steps: [UsbExportAction, number][]) =>
  steps.reduce((s, [e, now]) => usbExportReducer(s, e, now), IDLE_EXPORT)

describe('usbExportReducer', () => {
  it('queues every track when the export starts', () => {
    const s = run([STARTED, 0])
    expect(s.phase).toBe('copying')
    expect(isRunning(s)).toBe(true)
    expect(s.rows.map((r) => r.state)).toEqual(['queued', 'queued', 'queued'])
  })

  it('follows a track from copying to done, and one already there to kept', () => {
    const s = run(
      [STARTED, 0],
      [{ type: 'progress', index: 0, bytes: 40 }, 1000],
      [{ type: 'track', index: 0, state: 'done' }, 2000],
      [{ type: 'track', index: 1, state: 'kept' }, 2000],
      [{ type: 'progress', index: 2, bytes: 20 }, 3000],
    )
    expect(s.rows.map((r) => [r.state, r.bytes])).toEqual([
      ['done', 100],
      ['kept', 0],
      ['copying', 20],
    ])
    expect(exportCounts(s)).toEqual({ done: 2, total: 3 })
    // only what had to be copied counts: the kept track is not bytes the stick is waiting for
    expect(bytesToCopy(s)).toBe(300)
    expect(bytesDone(s)).toBe(120)
  })

  // The separator is a track on the stick but never a number the user reads.
  it('never counts separators', () => {
    const s = run(
      [
        {
          type: 'started',
          tracks: [t('a', 1), t('sep', 1, false, true), t('c', 1)],
          targetName: 'S',
          startedAt: 0,
        },
        0,
      ],
      [{ type: 'track', index: 1, state: 'done' }, 1],
    )
    expect(exportCounts(s)).toEqual({ done: 0, total: 2 })
  })

  // A failed track, or one baken found already there although the plan expected to copy it,
  // will never land its bytes: left in the total, the line would stop short and the time
  // left would wait for them.
  it('drops from the bytes to copy what will never be copied', () => {
    const s = run(
      [STARTED, 0],
      [{ type: 'failed', index: 0, reason: 'missing-file' }, 10],
      [{ type: 'track', index: 2, state: 'kept' }, 20],
    )
    expect(bytesToCopy(s)).toBe(0)
  })

  it('records a failed track with its reason code and goes on', () => {
    const s = run([STARTED, 0], [{ type: 'failed', index: 1, reason: 'missing-file' }, 10])
    expect(s.rows[1]).toMatchObject({ state: 'failed', failure: 'missing-file' })
    expect(s.phase).toBe('copying')
  })

  it('knows a cancel was asked, then ends done, cancelled or with a reason', () => {
    expect(run([STARTED, 0], [{ type: 'cancelling' }, 1]).cancelling).toBe(true)
    expect(run([STARTED, 0], [{ type: 'database' }, 1]).phase).toBe('database')
    expect(
      run(
        [STARTED, 0],
        [
          { type: 'finished', outcome: 'done', tracks: 3, failed: 0, ms: 64000, syncFiles: true },
          1,
        ],
      ).result,
    ).toEqual({ tracks: 3, failed: 0, ms: 64000, syncFiles: true })
    expect(run([STARTED, 0], [{ type: 'finished', outcome: 'cancelled' }, 1]).phase).toBe(
      'cancelled',
    )
    expect(
      run([STARTED, 0], [{ type: 'finished', outcome: 'error', reason: 'volume-gone' }, 1]).reason,
    ).toBe('volume-gone')
  })

  // The done notice must still say rekordbox may not see the playlists when the .sync files
  // could not be written, so the store keeps that flag past the event.
  it('keeps whether the sync files were written', () => {
    const s = run(
      [STARTED, 0],
      [{ type: 'finished', outcome: 'done', tracks: 3, failed: 0, ms: 1, syncFiles: false }, 1],
    )
    expect(s.result?.syncFiles).toBe(false)
  })

  it('goes back to idle on reset', () => {
    expect(run([STARTED, 0], [{ type: 'reset' }, 1])).toEqual(IDLE_EXPORT)
  })
})

describe('speed and time left', () => {
  // Measured over the last few seconds, not since the start: the first tracks may have
  // been on the stick already, and the NAS warms up.
  it('measures the recent rate and what is left at that rate', () => {
    const s = run(
      [STARTED, 0],
      [{ type: 'progress', index: 0, bytes: 50 }, 1000],
      [{ type: 'progress', index: 0, bytes: 100 }, 2000],
    )
    expect(speed(s)).toBe(50)
    expect(timeLeft(s)).toBe(4000)
  })

  it('knows nothing before two samples', () => {
    const s = run([STARTED, 0])
    expect(speed(s)).toBeNull()
    expect(timeLeft(s)).toBeNull()
  })

  // A track that fails mid-copy takes its partial bytes out of what is done, but those
  // bytes did move: counting the drop as negative transfer showed a negative speed (or
  // none) for the next five seconds.
  it('never goes backwards when a track fails mid-copy', () => {
    const s = run(
      [STARTED, 0],
      [{ type: 'progress', index: 0, bytes: 50 }, 6000],
      [{ type: 'progress', index: 0, bytes: 90 }, 7000],
      [{ type: 'failed', index: 0, reason: 'unreadable' }, 7500],
      [{ type: 'progress', index: 2, bytes: 10 }, 8000],
    )
    expect(speed(s)).toBe(25)
  })

  // baken's size check said the track was on the stick, but it wrote it after all: its
  // bytes must count on both sides, or the line passes 100% and the time left goes
  // negative.
  it('counts a track planned as on the stick once it is written after all', () => {
    const s = run(
      [STARTED, 0],
      [{ type: 'track', index: 0, state: 'done' }, 1000],
      [{ type: 'track', index: 1, state: 'done' }, 2000],
      [{ type: 'progress', index: 2, bytes: 180 }, 3000],
    )
    expect(bytesDone(s)).toBeLessThanOrEqual(bytesToCopy(s))
    expect(timeLeft(s)).toBeGreaterThanOrEqual(0)
    const all = usbExportReducer(s, { type: 'track', index: 2, state: 'done' }, 4000)
    expect(bytesDone(all)).toBe(bytesToCopy(all))
  })
})

describe('formatSpan', () => {
  const tr = (k: string, o?: Record<string, unknown>) => `${k}:${JSON.stringify(o)}`
  it('says minutes and seconds, or seconds alone', () => {
    expect(formatSpan(64000, tr)).toBe('usbExport.span.minSec:{"min":1,"sec":4}')
    expect(formatSpan(9400, tr)).toBe('usbExport.span.sec:{"sec":9}')
  })
})

describe('wavePath', () => {
  it('draws one bar per value, mirrored around the middle', () => {
    const d = wavePath([0, 1])
    expect(d.match(/M/g)).toHaveLength(2)
    // two bars split the 100-wide box: the second starts at 50, full height from the top
    expect(d).toContain('M50 0h35v16')
  })
})
