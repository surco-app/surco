import { describe, expect, it } from 'vitest'
import { type ExistingCue, validWantedSet, type WantedCue } from './cueRules'

const HAND: ExistingCue[] = [
  { id: 'i', ms: 9000, kind: 10, color: 0 },
  { id: 'm', ms: 12000, kind: 0, color: 5 },
]

const check = (wanted: unknown, existing: ExistingCue[] = []) =>
  validWantedSet(wanted as WantedCue[], existing)

describe('validWantedSet, the only gate before a hand-edited set reaches master.db', () => {
  it('accepts a countdown with its drop', () => {
    expect(
      check([
        { ms: 128000, kind: 0, color: null },
        { ms: 32000, kind: 1, color: 42 },
        { ms: 32000, kind: 0, color: null },
      ]),
    ).toEqual({ ok: true })
  })

  it('accepts cues rekordbox already holds with a letter or colour Surco would never write', () => {
    expect(
      check(
        [
          { id: 'i', ms: 9000, kind: 10, color: 0 },
          { id: 'm', ms: 12000, kind: 0, color: 5 },
        ],
        HAND,
      ),
    ).toEqual({ ok: true })
  })

  it('refuses something that is not a list of cues', () => {
    expect(check(null)).toEqual({ ok: false, reason: 'shape' })
    expect(check([null])).toEqual({ ok: false, reason: 'shape' })
  })

  it('refuses two hot cues with the same letter, since rekordbox shows only one pad per letter', () => {
    expect(
      check([
        { ms: 1000, kind: 1, color: 1 },
        { ms: 2000, kind: 1, color: 1 },
      ]),
    ).toEqual({ ok: false, reason: 'duplicate-letter' })
  })

  it('refuses a new letter outside A..H or a kind rekordbox does not have', () => {
    expect(check([{ ms: 1000, kind: 4, color: 1 }])).toEqual({ ok: false, reason: 'kind' })
    expect(check([{ ms: 1000, kind: 10, color: 1 }])).toEqual({ ok: false, reason: 'kind' })
    expect(check([{ id: 'i', ms: 9000, kind: 11, color: 0 }], HAND)).toEqual({
      ok: false,
      reason: 'kind',
    })
  })

  it('refuses a position that is not a real time, as a NaN arrives as null through JSON', () => {
    expect(check([{ ms: null, kind: 0, color: null }])).toEqual({ ok: false, reason: 'ms' })
    expect(check([{ ms: Number.POSITIVE_INFINITY, kind: 0, color: null }])).toEqual({
      ok: false,
      reason: 'ms',
    })
    expect(check([{ ms: -1, kind: 0, color: null }])).toEqual({ ok: false, reason: 'ms' })
  })

  it('refuses a hot cue colour outside the rekordbox table', () => {
    expect(check([{ ms: 1000, kind: 1, color: 63 }])).toEqual({ ok: false, reason: 'color' })
    expect(check([{ ms: 1000, kind: 1, color: 0 }])).toEqual({ ok: false, reason: 'color' })
    expect(check([{ ms: 1000, kind: 1, color: 1.5 }])).toEqual({ ok: false, reason: 'color' })
  })

  it('refuses a new memory cue with a colour, since Surco writes them as rekordbox does', () => {
    expect(check([{ ms: 1000, kind: 0, color: 1 }])).toEqual({ ok: false, reason: 'color' })
    expect(check([{ id: 'm', ms: 12000, kind: 0, color: 6 }], HAND)).toEqual({
      ok: false,
      reason: 'color',
    })
  })

  it('refuses a hot cue turned into a CALL that keeps its colour, since a CALL never has one', () => {
    const live: ExistingCue[] = [{ id: 'h', ms: 4000, kind: 1, color: 5 }]
    expect(check([{ id: 'h', ms: 4000, kind: 0, color: 5 }], live)).toEqual({
      ok: false,
      reason: 'color',
    })
    expect(check([{ id: 'h', ms: 4000, kind: 0, color: null }], live)).toEqual({ ok: true })
  })

  it('refuses the same rekordbox cue twice', () => {
    expect(
      check(
        [
          { id: 'i', ms: 9000, kind: 10, color: 0 },
          { id: 'i', ms: 9500, kind: 10, color: 0 },
        ],
        HAND,
      ),
    ).toEqual({ ok: false, reason: 'duplicate-id' })
  })

  it('refuses an id that is not a string, but takes an unknown id as a new cue', () => {
    expect(check([{ id: 7, ms: 1000, kind: 0, color: null }])).toEqual({ ok: false, reason: 'id' })
    expect(check([{ id: 'gone', ms: 1000, kind: 0, color: null }])).toEqual({ ok: true })
  })
})
