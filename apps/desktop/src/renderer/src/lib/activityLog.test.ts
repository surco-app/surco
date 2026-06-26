import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../../shared/types'
import { type ActivityRow, applyActivity, MAX_ROWS } from './activityLog'

const start = (id: string, label = 'x'): ActivityEvent => ({
  id,
  kind: 'discogs',
  phase: 'start',
  label,
})
const done = (id: string, detail?: string): ActivityEvent => ({
  id,
  kind: 'discogs',
  phase: 'done',
  label: 'x',
  detail,
  ms: 12,
})

describe('applyActivity', () => {
  it('prepends a started step as a running row so the newest work is on top', () => {
    const rows = applyActivity([], start('a', 'Buscando: bonobo'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'a', status: 'running', label: 'Buscando: bonobo' })
  })

  it('resolves the matching row in place on done, keeping its position', () => {
    // The user is watching a specific row; its done must update *that* row, not add a
    // second one — otherwise a search would show as two lines (pending + finished).
    let rows = applyActivity([], start('a'))
    rows = applyActivity(rows, start('b'))
    rows = applyActivity(rows, done('a', '12 resultados'))

    const a = rows.find((r) => r.id === 'a')
    expect(rows).toHaveLength(2)
    expect(a).toMatchObject({ status: 'done', detail: '12 resultados', ms: 12 })
  })

  it('marks the row errored and carries the raw message into detail', () => {
    let rows = applyActivity([], start('a'))
    rows = applyActivity(rows, {
      id: 'a',
      kind: 'discogs',
      phase: 'error',
      label: 'x',
      detail: 'Discogs devolvió 429',
      ms: 5,
    })
    expect(rows[0]).toMatchObject({ status: 'error', detail: 'Discogs devolvió 429' })
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
  label: string,
  extra: Partial<ActivityEvent> = {},
): ActivityEvent => ({
  id,
  kind: 'analyze',
  phase,
  label,
  group: '/music/kerala.wav',
  groupLabel: 'Bonobo — Kerala',
  ...extra,
})

describe('applyActivity grouping', () => {
  it('folds many probes of one track into a single group row titled by groupLabel', () => {
    // An analyze sweep fires six probes per track; as flat rows they'd bury the feed.
    // They must collapse onto one "Analizando «Bonobo — Kerala»" row instead.
    let rows = applyActivity([], analyze('p1', 'start', 'Espectrograma'))
    rows = applyActivity(rows, analyze('p2', 'start', 'Loudness'))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'group:/music/kerala.wav', label: 'Bonobo — Kerala' })
    expect(rows[0].children).toHaveLength(2)
    expect(rows[0].children?.map((c) => c.label)).toEqual(['Espectrograma', 'Loudness'])
  })

  it('keeps the group running until every probe finishes, then marks it done', () => {
    let rows = applyActivity([], analyze('p1', 'start', 'Espectrograma'))
    rows = applyActivity(rows, analyze('p2', 'start', 'Loudness'))
    rows = applyActivity(rows, analyze('p1', 'done', 'Espectrograma', { ms: 1200 }))
    expect(rows[0].status).toBe('running')

    rows = applyActivity(rows, analyze('p2', 'done', 'Loudness', { ms: 400 }))
    expect(rows[0].status).toBe('done')
    // The child carries its own timing for the expanded breakdown.
    expect(rows[0].children?.find((c) => c.id === 'p1')).toMatchObject({ status: 'done', ms: 1200 })
  })

  it('marks the group errored when any probe fails, even if others succeed', () => {
    // One failed probe (an unreadable file) must surface on the group, not hide behind
    // the successful ones — that's the whole point of seeing what went wrong.
    let rows = applyActivity([], analyze('p1', 'start', 'Espectrograma'))
    rows = applyActivity(rows, analyze('p2', 'start', 'BPM'))
    rows = applyActivity(rows, analyze('p1', 'done', 'Espectrograma', { ms: 900 }))
    rows = applyActivity(
      rows,
      analyze('p2', 'error', 'BPM', { detail: 'ffmpeg: invalid data', ms: 5 }),
    )

    expect(rows[0].status).toBe('error')
  })

  it('separates tracks into their own group rows by path', () => {
    let rows = applyActivity([], analyze('p1', 'start', 'Espectrograma'))
    rows = applyActivity(
      rows,
      analyze('q1', 'start', 'Espectrograma', { group: '/music/other.wav' }),
    )
    expect(rows).toHaveLength(2)
  })
})
