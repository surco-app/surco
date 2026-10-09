import { describe, expect, it } from 'vitest'
import type { ActivityEvent, MusicFixOutcome } from '../shared/types'
import { createActivity } from './activity'
import { createMusicReviewLog, restoreLogged, setFieldLogged } from './musicReviewLog'

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

  it('keeps the row a removed copy opened for its file to join', () => {
    const log = createMusicReviewLog()
    log.rememberCopy('/m/old.mp3', { group: 'duplicate-OLD', label: 'Old' })
    expect(log.copyOf('/m/old.mp3')).toEqual({ group: 'duplicate-OLD', label: 'Old' })
    expect(log.copyOf('/m/other.mp3')).toBeUndefined()
  })
})

// Undo used to leave no trace: each field put back in Music and each file restored gets a
// row under the run it undoes.
describe('the undo in Activity', () => {
  function setup() {
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))
    const log = createMusicReviewLog()
    log.rememberTitles([{ persistentId: 'A', title: 'Funk Freak' }])
    const run = log.beginRun()
    log.rememberRun(run, [outcome('A', 'b1')])
    return { events, log, run, track: activity.track }
  }

  it('says a field went back in Music, under the run', async () => {
    const { events, log, run, track } = setup()
    const result = await setFieldLogged('A', 'artist', async () => 'set', { track, log })
    expect(result).toBe('set')
    expect(events[0]).toMatchObject({
      phase: 'start',
      kind: 'applemusic',
      labelKey: 'activity.reviewFix.artist',
      labelParams: { title: 'Funk Freak' },
      group: run,
      groupLabelKey: 'activity.reviewUndoRun',
    })
    expect(events[1]).toMatchObject({ phase: 'done', detailKey: 'activity.reviewUndoMusic' })
  })

  it.each([
    ['mismatch', 'activity.reviewUndoMusicMismatch'],
    ['missing', 'activity.reviewUndoMusicMissing'],
  ] as const)('warns when Music answers %s', async (answer, detailKey) => {
    const { events, log, track } = setup()
    await setFieldLogged('A', 'artist', async () => answer, { track, log })
    expect(events[1]).toMatchObject({ phase: 'warn', detailKey })
  })

  it('says a file came back from its backup', async () => {
    const { events, log, run, track } = setup()
    const result = await restoreLogged('b1', async () => ({ restoredTo: '/m/a.mp3' }), {
      track,
      log,
    })
    expect(result).toEqual({ restoredTo: '/m/a.mp3' })
    expect(events.map((e) => [e.phase, e.labelKey, e.detailKey, e.group])).toEqual([
      ['start', 'activity.reviewUndoFile', undefined, run],
      ['done', 'activity.reviewUndoFile', 'activity.reviewUndoFileRestored', run],
    ])
    expect(events[0].labelParams).toEqual({ title: 'Funk Freak' })
  })

  // The Backups panel restores through the same call; those are not the review's.
  it('logs nothing for a backup the review did not make', async () => {
    const { events, log, track } = setup()
    await restoreLogged('other', async () => ({ restoredTo: '/x' }), { track, log })
    expect(events).toEqual([])
  })
})
