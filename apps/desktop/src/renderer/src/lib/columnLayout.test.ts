import { describe, expect, it } from 'vitest'
import {
  COLUMN_LIMITS,
  columnWidths,
  DIVIDERS_WIDTH,
  FORM_MIN,
  RAIL_WIDTH,
  shareFor,
} from './columnLayout'

const RAIL = 60

function total(w: { tree: number; list: number; results: number; form: number }): number {
  return w.tree + w.list + w.results + w.form
}

describe('columnWidths', () => {
  it.each([
    [1280, { tree: 207, list: 300, results: 253, form: 460 }],
    [1440, { tree: 235, list: 331, results: 304, form: 510 }],
    [1728, { tree: 280, list: 400, results: 367, form: 621 }],
  ])(
    'gives the form the room the old fixed widths starved at a %i px window with a source open',
    (window, expected) => {
      expect(columnWidths(window - RAIL, true, undefined)).toEqual(expected)
    },
  )

  it.each([
    [1280, { tree: 0, list: 353, results: 323, form: 544 }],
    [1440, { tree: 0, list: 399, results: 366, form: 615 }],
    [1728, { tree: 0, list: 480, results: 442, form: 746 }],
  ])(
    'hands the tree its share back in proportion in Files at a %i px window',
    (window, expected) => {
      expect(columnWidths(window - RAIL, false, undefined)).toEqual(expected)
    },
  )

  it('leaves the form at least 460 px by default whenever the window allows it, so the folded Cues section has room', () => {
    expect(FORM_MIN).toBe(460)
    for (const available of [1380, 1500, 1668, 2500])
      expect(columnWidths(available, true, undefined).form).toBeGreaterThanOrEqual(460)
  })

  it('hands the share the results column gives up to the form at a common 1440 px window', () => {
    const w = columnWidths(1440 - RAIL, true, undefined)
    expect(w.results).toBe(Math.round(1380 * 0.22))
    expect(w.form).toBe(1380 - w.tree - w.list - w.results)
    expect(w.form).toBeGreaterThan(500)
  })

  it('keeps the width a DJ dragged the results column to, over the new default', () => {
    expect(columnWidths(1440 - RAIL, true, { results: 0.25 }).results).toBe(Math.round(1380 * 0.25))
  })

  it('always fills exactly the available width, so no gap or overflow opens beside the form', () => {
    for (const available of [1020, 1220, 1380, 1668, 2500]) {
      expect(total(columnWidths(available, true, undefined))).toBe(available)
      expect(total(columnWidths(available, false, undefined))).toBe(available)
    }
  })

  it('takes the room the form is short of from the results column first', () => {
    const w = columnWidths(1668, true, { list: 0.3, results: 0.4 })
    expect(w.list).toBe(480)
    expect(w.form).toBe(FORM_MIN)
    expect(w.results).toBe(1668 - w.tree - w.list - FORM_MIN)
  })

  it('takes it from the list once the results column is down to its minimum', () => {
    const w = columnWidths(1280, true, { list: 0.35, results: 0.4 })
    expect(w.results).toBe(240)
    expect(w.form).toBe(FORM_MIN)
    expect(w.list).toBe(1280 - w.tree - 240 - FORM_MIN)
  })

  it('lets the search results give way below 300 px at the 1080 px minimum window, so the editor form is the column that keeps its room', () => {
    const available = 1080 - RAIL_WIDTH - DIVIDERS_WIDTH
    const files = columnWidths(available, false, undefined)
    expect(files.results).toBeLessThan(300)
    expect(files.form).toBe(FORM_MIN)
    const source = columnWidths(available, true, undefined)
    expect(source.results).toBe(COLUMN_LIMITS.results.min)
    expect(source.form).toBe(available - source.tree - source.list - COLUMN_LIMITS.results.min)
    expect(source.form).toBeGreaterThan(available - 200 - 300 - 300)
  })

  it('leaves every column at its minimum once even that is too wide for the window', () => {
    expect(columnWidths(1020, true, undefined)).toEqual({
      tree: 200,
      list: 300,
      results: 240,
      form: 280,
    })
  })

  it('sizes a column from its saved share', () => {
    expect(columnWidths(1668, true, { list: 0.2, results: 0.3 })).toMatchObject({
      list: 334,
      results: 500,
    })
  })

  it('clamps a saved share to the column limits, so a share saved on a big screen cannot swallow a small one', () => {
    expect(columnWidths(2500, true, { list: 0.9, results: 0.01 })).toMatchObject({
      list: 480,
      results: 240,
    })
  })

  it('falls back to the default share when a settings file carries a nonsense one', () => {
    const fallback = columnWidths(1668, true, undefined)
    expect(columnWidths(1668, true, { list: -1, results: Number.NaN, tree: 4 })).toEqual(fallback)
  })
})

describe('shareFor', () => {
  it('is the fraction of the available width, so the same share returns the same width', () => {
    const share = shareFor('results', 420, 1668, true, undefined)
    expect(share).toBeCloseTo(420 / 1668)
    expect(columnWidths(1668, true, { results: share }).results).toBe(420)
  })

  it('round-trips in Files, where the tree share is spread over the other columns', () => {
    const share = shareFor('list', 380, 1220, false, undefined)
    expect(columnWidths(1220, false, { list: share }).list).toBe(380)
  })

  it('clamps the width first, so a drag past a limit saves the limit', () => {
    expect(shareFor('list', 900, 1380, true, undefined)).toBeCloseTo(480 / 1380)
    expect(shareFor('list', 10, 1380, true, undefined)).toBeCloseTo(300 / 1380)
  })
})
