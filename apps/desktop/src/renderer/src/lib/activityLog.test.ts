import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../../shared/types'
import {
  type ActivityRow,
  applyActivity,
  type LocalActivityReport,
  MAX_ROWS,
  reportRow,
} from './activityLog'

const start = (id: string, labelKey = 'activity.searchDiscogs'): ActivityEvent => ({
  id,
  kind: 'discogs',
  phase: 'start',
  labelKey,
})
const done = (id: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id,
  kind: 'discogs',
  phase: 'done',
  labelKey: 'activity.searchDiscogs',
  ms: 12,
  ...extra,
})

describe('applyActivity', () => {
  it('prepends a started step as a running row carrying its key and params', () => {
    const rows = applyActivity([], { ...start('a'), labelParams: { query: 'bonobo' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'a',
      status: 'running',
      labelKey: 'activity.searchDiscogs',
      labelParams: { query: 'bonobo' },
    })
  })

  it('resolves the matching row in place on done, keeping its position', () => {
    // The user is watching a specific row; its done must update *that* row, not add a
    // second one — otherwise a search would show as two lines (pending + finished).
    let rows = applyActivity([], start('a'))
    rows = applyActivity(rows, start('b'))
    rows = applyActivity(
      rows,
      done('a', { detailKey: 'activity.resultCount', detailParams: { count: 12 } }),
    )

    const a = rows.find((r) => r.id === 'a')
    expect(rows).toHaveLength(2)
    expect(a).toMatchObject({
      status: 'done',
      detailKey: 'activity.resultCount',
      detailParams: { count: 12 },
      ms: 12,
    })
  })

  it('marks the row errored and carries the raw message into detail', () => {
    let rows = applyActivity([], start('a'))
    rows = applyActivity(rows, {
      id: 'a',
      kind: 'discogs',
      phase: 'error',
      labelKey: 'activity.searchDiscogs',
      detail: 'Discogs devolvió 429',
      ms: 5,
    })
    expect(rows[0]).toMatchObject({ status: 'error', detail: 'Discogs devolvió 429' })
  })

  it('keeps the running row url through its done so the open link survives completion', () => {
    // Regression: a release row's "open in browser" link must not vanish when the load
    // finishes and the title replaces the detail.
    let rows = applyActivity([], {
      ...start('a', 'activity.loadBandcampRelease'),
      url: 'https://x.bandcamp.com/album/y',
    })
    rows = applyActivity(rows, {
      id: 'a',
      kind: 'bandcamp',
      phase: 'done',
      labelKey: 'activity.loadBandcampRelease',
      url: 'https://x.bandcamp.com/album/y',
      detail: 'Funky Feelings',
      ms: 9,
    })
    expect(rows[0].url).toBe('https://x.bandcamp.com/album/y')
  })

  it('drops a terminal event whose start was already evicted, leaving no orphan row', () => {
    // Past the cap the start is gone; a late done must not resurrect a statusless row.
    const rows = applyActivity([], done('ghost'))
    expect(rows).toEqual([])
  })

  it('caps the list so a long session never grows it without bound', () => {
    let rows: ActivityRow[] = []
    for (let i = 0; i < MAX_ROWS + 50; i++) rows = applyActivity(rows, start(`s${i}`))
    expect(rows).toHaveLength(MAX_ROWS)
    // Newest kept, oldest dropped.
    expect(rows[0].id).toBe(`s${MAX_ROWS + 49}`)
  })
})

const analyze = (
  id: string,
  phase: ActivityEvent['phase'],
  labelKey: string,
  extra: Partial<ActivityEvent> = {},
): ActivityEvent => ({
  id,
  kind: 'analyze',
  phase,
  labelKey,
  group: '/music/kerala.wav',
  groupLabel: 'kerala.wav',
  ...extra,
})

describe('applyActivity grouping', () => {
  it('folds many probes of one track into a single group row titled by groupLabel', () => {
    // An analyze sweep fires six probes per track; as flat rows they'd bury the feed.
    // They must collapse onto one row titled by the raw file name instead.
    let rows = applyActivity([], analyze('p1', 'start', 'activity.probeSpectrogram'))
    rows = applyActivity(rows, analyze('p2', 'start', 'activity.probeLoudness'))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'group:/music/kerala.wav', label: 'kerala.wav' })
    expect(rows[0].children).toHaveLength(2)
    expect(rows[0].children?.map((c) => c.labelKey)).toEqual([
      'activity.probeSpectrogram',
      'activity.probeLoudness',
    ])
  })

  it('keeps the group running until every probe finishes, then marks it done', () => {
    let rows = applyActivity([], analyze('p1', 'start', 'activity.probeSpectrogram'))
    rows = applyActivity(rows, analyze('p2', 'start', 'activity.probeLoudness'))
    rows = applyActivity(rows, analyze('p1', 'done', 'activity.probeSpectrogram', { ms: 1200 }))
    expect(rows[0].status).toBe('running')

    rows = applyActivity(rows, analyze('p2', 'done', 'activity.probeLoudness', { ms: 400 }))
    expect(rows[0].status).toBe('done')
    // The child carries its own timing for the expanded breakdown.
    expect(rows[0].children?.find((c) => c.id === 'p1')).toMatchObject({ status: 'done', ms: 1200 })
  })

  it('marks the group errored when any probe fails, even if others succeed', () => {
    // One failed probe (an unreadable file) must surface on the group, not hide behind
    // the successful ones — that's the whole point of seeing what went wrong.
    let rows = applyActivity([], analyze('p1', 'start', 'activity.probeSpectrogram'))
    rows = applyActivity(rows, analyze('p2', 'start', 'activity.probeBpm'))
    rows = applyActivity(rows, analyze('p1', 'done', 'activity.probeSpectrogram', { ms: 900 }))
    rows = applyActivity(
      rows,
      analyze('p2', 'error', 'activity.probeBpm', { detail: 'ffmpeg: invalid data', ms: 5 }),
    )

    expect(rows[0].status).toBe('error')
  })

  it('separates tracks into their own group rows by path', () => {
    let rows = applyActivity([], analyze('p1', 'start', 'activity.probeSpectrogram'))
    rows = applyActivity(
      rows,
      analyze('q1', 'start', 'activity.probeSpectrogram', { group: '/music/other.wav' }),
    )
    expect(rows).toHaveLength(2)
  })
})

describe('reportRow', () => {
  const verdict: LocalActivityReport = {
    kind: 'match',
    labelKey: 'activity.autoMatchApplied',
    labelParams: { track: 'My Song' },
    detailKey: 'activity.autoMatchAppliedDetail',
    ms: 120,
  }

  // A renderer-side verdict (the auto-match decision) has no start event to stream — the
  // decision only exists once made — so it lands directly as a finished row on top.
  it('prepends a completed row carrying the report', () => {
    const rows = reportRow([{ id: 'a', kind: 'discogs', status: 'running' }], 'local-0', verdict)
    expect(rows[0]).toMatchObject({
      id: 'local-0',
      kind: 'match',
      status: 'done',
      labelKey: 'activity.autoMatchApplied',
      ms: 120,
    })
    expect(rows[1].id).toBe('a')
  })

  it('respects the feed cap like streamed events do', () => {
    let rows: ActivityRow[] = []
    for (let i = 0; i <= MAX_ROWS; i++) rows = reportRow(rows, `local-${i}`, verdict)
    expect(rows).toHaveLength(MAX_ROWS)
    expect(rows[0].id).toBe(`local-${MAX_ROWS}`)
  })
})
