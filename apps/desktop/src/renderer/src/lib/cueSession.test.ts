import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDraft } from './cueDraft'
import {
  forgetDraft,
  keepDraft,
  keepPlayhead,
  keptDraft,
  keptPlayhead,
  resetCueSession,
  subscribeCueDrafts,
  unsavedCueTracks,
} from './cueSession'

afterEach(resetCueSession)

describe('cue session', () => {
  it('gives back the draft kept for the same track and read, and none for another', () => {
    const draft = startDraft([{ ms: 1000, kind: 1, color: 22 }], 'mine')
    keepDraft('103', '103|f0|null', draft)
    expect(keptDraft('103', '103|f0|null')).toBe(draft)
    expect(keptDraft('104', '104|f0|null')).toBeUndefined()
  })

  it('never gives back a draft built on another read or another queued save, so cues changed in rekordbox are never overwritten', () => {
    keepDraft('103', '103|f0|null', startDraft([], 'mine'))
    expect(keptDraft('103', '103|f1|null')).toBeUndefined()
    expect(keptDraft('103', '103|f0|{"wanted":[],"fingerprint":"f0"}')).toBeUndefined()
  })

  it('keeps the draft of every track apart, so opening another track never drops the first', () => {
    const first = startDraft([], 'mine')
    const second = startDraft([], 'mine')
    keepDraft('103', '103|f0|null', first)
    keepDraft('104', '104|f0|null', second)
    expect(keptDraft('103', '103|f0|null')).toBe(first)
    expect(keptDraft('104', '104|f0|null')).toBe(second)
  })

  it('forgets only the draft of the track that is saved or discarded', () => {
    keepDraft('103', '103|f0|null', startDraft([], 'mine'))
    keepDraft('104', '104|f0|null', startDraft([], 'mine'))
    forgetDraft('103')
    expect(keptDraft('103', '103|f0|null')).toBeUndefined()
    expect(keptDraft('104', '104|f0|null')).toBeDefined()
  })

  it('names the tracks with an unsaved draft and calls back only when that list changes, so the list does not repaint on every edit', () => {
    const listener = vi.fn<() => void>()
    const stop = subscribeCueDrafts(listener)
    keepDraft('103', '103|f0|null', startDraft([], 'mine'))
    keepDraft('103', '103|f0|null', startDraft([], 'mine'))
    keepDraft('104', '104|f0|null', startDraft([], 'mine'))
    expect([...unsavedCueTracks()]).toEqual(['103', '104'])
    expect(listener).toHaveBeenCalledTimes(2)
    forgetDraft('103')
    forgetDraft('103')
    expect([...unsavedCueTracks()]).toEqual(['104'])
    expect(listener).toHaveBeenCalledTimes(3)
    stop()
  })

  it('keeps the playhead of every track and starts a track never opened at 0', () => {
    keepPlayhead('103', 64000)
    keepPlayhead('104', 32000)
    expect(keptPlayhead('103')).toBe(64000)
    expect(keptPlayhead('104')).toBe(32000)
    expect(keptPlayhead('105')).toBe(0)
  })
})
