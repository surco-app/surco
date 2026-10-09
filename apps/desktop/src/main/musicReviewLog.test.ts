import { describe, expect, it } from 'vitest'
import type { MusicFixOutcome } from '../shared/types'
import { createMusicReviewLog } from './musicReviewLog'

const outcome = (persistentId: string, backupId?: string): MusicFixOutcome => ({
  persistentId,
  fixes: [],
  music: [],
  file: 'written',
  written: [],
  backupId,
})

describe('createMusicReviewLog', () => {
  // Main only gets persistent ids; the rows have to name the track the user saw.
  it('names a track by the title the review read', () => {
    const log = createMusicReviewLog()
    log.rememberTitles([{ persistentId: 'A', title: 'Funk Freak' }])
    expect(log.titleOf('A')).toBe('Funk Freak')
    expect(log.titleOf('Z')).toBe('Z')
  })

  it('gives each run its own group', () => {
    const log = createMusicReviewLog()
    expect(log.beginRun()).not.toBe(log.beginRun())
  })

  // An undo's rows land under the run they undo, so the panel reads as one story.
  it('finds the run and the track a later undo belongs to', () => {
    const log = createMusicReviewLog()
    log.rememberTitles([{ persistentId: 'A', title: 'Funk Freak' }])
    const run = log.beginRun()
    log.rememberRun(run, [outcome('A', 'b1'), outcome('B')])
    expect(log.groupOf('A')).toBe(run)
    expect(log.backup('b1')).toEqual({ group: run, title: 'Funk Freak' })
    expect(log.backup('other')).toBeUndefined()
  })
})
