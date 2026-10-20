import { afterEach, describe, expect, it } from 'vitest'
import { startDraft } from './cueDraft'
import {
  forgetDraft,
  keepDraft,
  keepPlayhead,
  keptDraft,
  keptPlayhead,
  resetCueSession,
} from './cueSession'

afterEach(resetCueSession)

describe('cue session', () => {
  it('gives back the draft kept for the same track and read, and none for another', () => {
    const draft = startDraft([{ ms: 1000, kind: 1, color: 22 }], 'mine')
    keepDraft('103|f0|null', draft)
    expect(keptDraft('103|f0|null')).toBe(draft)
    expect(keptDraft('104|f0|null')).toBeUndefined()
    expect(keptDraft('103|f1|null')).toBeUndefined()
  })

  it('keeps one draft only, so an older track never comes back', () => {
    keepDraft('103|f0|null', startDraft([], 'mine'))
    keepDraft('104|f0|null', startDraft([], 'mine'))
    expect(keptDraft('103|f0|null')).toBeUndefined()
  })

  it('forgets the draft on Descartar cambios', () => {
    keepDraft('103|f0|null', startDraft([], 'mine'))
    forgetDraft()
    expect(keptDraft('103|f0|null')).toBeUndefined()
  })

  it('keeps the playhead of the track and starts any other track at 0', () => {
    keepPlayhead('103', 64000)
    expect(keptPlayhead('103')).toBe(64000)
    expect(keptPlayhead('104')).toBe(0)
  })
})
