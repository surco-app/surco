// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDraft } from './cueDraft'
import {
  autoMarkOf,
  autoMarks,
  draftsToSave,
  forgetAutoMark,
  forgetDraft,
  keepAutoMark,
  keepDraft,
  keepPlayhead,
  keptDraft,
  keptPlayhead,
  resetCueSession,
  subscribeCueDrafts,
  unsavedCueTracks,
  useCueSessionFor,
} from './cueSession'

const TARGET = { path: '/m/g.wav', label: 'Gowan', fingerprint: 'f0' }

afterEach(resetCueSession)

describe('cue session', () => {
  it('gives back the draft kept for the same track and read, and none for another', () => {
    const draft = startDraft([{ ms: 1000, kind: 1, color: 22 }], 'mine')
    keepDraft('103', '103|f0|null', draft, TARGET)
    expect(keptDraft('103', '103|f0|null')).toBe(draft)
    expect(keptDraft('104', '104|f0|null')).toBeUndefined()
  })

  it('never gives back a draft built on another read or another queued save, so cues changed in rekordbox are never overwritten', () => {
    keepDraft('103', '103|f0|null', startDraft([], 'mine'), TARGET)
    expect(keptDraft('103', '103|f1|null')).toBeUndefined()
    expect(keptDraft('103', '103|f0|{"wanted":[],"fingerprint":"f0"}')).toBeUndefined()
  })

  it('keeps the draft of every track apart, so opening another track never drops the first', () => {
    const first = startDraft([], 'mine')
    const second = startDraft([], 'mine')
    keepDraft('103', '103|f0|null', first, TARGET)
    keepDraft('104', '104|f0|null', second, TARGET)
    expect(keptDraft('103', '103|f0|null')).toBe(first)
    expect(keptDraft('104', '104|f0|null')).toBe(second)
  })

  it('forgets only the draft of the track that is saved or discarded', () => {
    keepDraft('103', '103|f0|null', startDraft([], 'mine'), TARGET)
    keepDraft('104', '104|f0|null', startDraft([], 'mine'), TARGET)
    forgetDraft('103')
    expect(keptDraft('103', '103|f0|null')).toBeUndefined()
    expect(keptDraft('104', '104|f0|null')).toBeDefined()
  })

  it('names the tracks with an unsaved draft and calls back only when that list changes, so the list does not repaint on every edit', () => {
    const listener = vi.fn<() => void>()
    const stop = subscribeCueDrafts(listener)
    keepDraft('103', '103|f0|null', startDraft([], 'mine'), TARGET)
    keepDraft('103', '103|f0|null', startDraft([], 'mine'), TARGET)
    keepDraft('104', '104|f0|null', startDraft([], 'mine'), TARGET)
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

  it('keeps what Auto marcar found for each track apart, so a whole playlist can be reviewed one track at a time', () => {
    keepAutoMark('103', { kind: 'proposed', ms: [128000, 256000] })
    keepAutoMark('104', { kind: 'unanalysed' })
    expect(autoMarkOf('103')).toEqual({ kind: 'proposed', ms: [128000, 256000] })
    expect(autoMarkOf('104')).toEqual({ kind: 'unanalysed' })
    expect(autoMarkOf('105')).toBeUndefined()
    forgetAutoMark('103')
    expect(autoMarkOf('103')).toBeUndefined()
    expect(autoMarks().get('104')).toEqual({ kind: 'unanalysed' })
  })

  it('never counts pending proposals as unsaved, so quitting with nothing accepted does not ask', () => {
    keepAutoMark('103', { kind: 'proposed', ms: [128000] })
    expect([...unsavedCueTracks()]).toEqual([])
  })

  it('calls back only when a track’s proposals really change, so the list does not repaint for the same result', () => {
    const listener = vi.fn<() => void>()
    const stop = subscribeCueDrafts(listener)
    keepAutoMark('103', { kind: 'proposed', ms: [128000] })
    keepAutoMark('103', { kind: 'proposed', ms: [128000] })
    forgetAutoMark('104')
    expect(listener).toHaveBeenCalledTimes(1)
    keepAutoMark('103', { kind: 'proposed', ms: [] })
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
  })

  it('drops the proposals with the rest of the session', () => {
    keepAutoMark('103', { kind: 'none' })
    resetCueSession()
    expect(autoMarkOf('103')).toBeUndefined()
  })

  it('lists every unsaved draft as the save rekordbox needs, so several tracks are saved in one go', () => {
    keepDraft(
      '103',
      '103|f0|null',
      startDraft([{ ms: 1000, kind: 0, color: null }], 'mine'),
      TARGET,
    )
    keepDraft('104', '104|f1|null', startDraft([], 'mine'), {
      path: '/m/h.wav',
      label: 'Other',
      fingerprint: 'f1',
    })
    keepAutoMark('105', { kind: 'proposed', ms: [128000] })
    expect(draftsToSave()).toEqual([
      {
        contentId: '103',
        path: '/m/g.wav',
        label: 'Gowan',
        fingerprint: 'f0',
        wanted: [{ ms: 1000, kind: 0, color: null }],
      },
      { contentId: '104', path: '/m/h.wav', label: 'Other', fingerprint: 'f1', wanted: [] },
    ])
  })

  it('starts the session over when the rekordbox collection changes, so a draft or proposal is never saved onto another collection’s track with the same id', () => {
    const { rerender } = renderHook(({ at }) => useCueSessionFor(at), {
      initialProps: { at: '/a/master.db' as string | undefined },
    })
    keepDraft('103', '103|f0|null', startDraft([], 'mine'), TARGET)
    keepAutoMark('104', { kind: 'proposed', ms: [128000] })
    rerender({ at: '/a/master.db' })
    expect([...unsavedCueTracks()]).toEqual(['103'])
    rerender({ at: '/b/master.db' })
    expect([...unsavedCueTracks()]).toEqual([])
    expect(autoMarkOf('104')).toBeUndefined()
  })

  it('keeps the session while the settings are still loading, since no collection was left', () => {
    const { rerender } = renderHook(({ at }) => useCueSessionFor(at), {
      initialProps: { at: undefined as string | undefined },
    })
    keepDraft('103', '103|f0|null', startDraft([], 'mine'), TARGET)
    rerender({ at: '/a/master.db' })
    expect([...unsavedCueTracks()]).toEqual(['103'])
  })
})
