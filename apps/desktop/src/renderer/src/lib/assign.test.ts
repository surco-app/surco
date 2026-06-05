import { describe, expect, it } from 'vitest'
import type { DiscogsTrack } from '../../../shared/types'
import { type AssignInput, assignTracks, reassign } from './assign'

const t = (position: string, title: string, duration: string): DiscogsTrack => ({
  position,
  title,
  duration,
})

describe('assignTracks', () => {
  it('matches each file to the tracklist entry closest in duration', () => {
    const tracklist = [t('A', 'Radio Edit', '3:00'), t('B', 'Extended Mix', '6:00')]
    const files: AssignInput[] = [
      { id: 'short', target: { title: 'radio edit', durationSec: 181 } },
      { id: 'long', target: { title: 'extended mix', durationSec: 359 } },
    ]
    const out = assignTracks(files, tracklist)
    expect(out.find((a) => a.id === 'short')?.track?.position).toBe('A')
    expect(out.find((a) => a.id === 'long')?.track?.position).toBe('B')
  })

  it('never assigns one tracklist entry to two files', () => {
    // Two rips that both look most like track A must not both grab it — the loser takes
    // its next-best entry instead, which is the whole reason for a 1:1 assignment.
    const tracklist = [t('A', 'aaa', '5:00'), t('B', 'bbb', '5:01')]
    const files: AssignInput[] = [
      { id: 'one', target: { title: 'aaa', durationSec: 300 } },
      { id: 'two', target: { title: 'aaa', durationSec: 300 } },
    ]
    const out = assignTracks(files, tracklist)
    expect(out[0].track).toBeDefined()
    expect(out[1].track).toBeDefined()
    expect(out[0].track).not.toBe(out[1].track)
  })

  it('lets duration win when the title points at a track of the wrong length', () => {
    // Album rips often carry the release name as every file's title, so a title that
    // matches A1 means little when the file's length is exactly B2's — the duration is
    // the real fingerprint of which cut this is, and must decide.
    const tracklist = [t('A1', 'Extended Mix', '5:00'), t('B2', 'Radio Edit', '4:00')]
    const files: AssignInput[] = [
      { id: 'rip', target: { title: 'Extended Mix', durationSec: 240 } },
    ]
    expect(assignTracks(files, tracklist)[0].track?.position).toBe('B2')
  })

  it('leaves a file with no usable signal unassigned rather than guessing', () => {
    const tracklist = [t('A', 'Some Song', '4:00')]
    const files: AssignInput[] = [{ id: 'mystery', target: { title: '', durationSec: undefined } }]
    expect(assignTracks(files, tracklist)[0].track).toBeUndefined()
  })

  it('returns one entry per file, in input order', () => {
    const tracklist = [t('A', 'x', '3:00')]
    const out = assignTracks(
      [
        { id: 'first', target: { title: 'x', durationSec: 180 } },
        { id: 'second', target: { title: 'y', durationSec: 999 } },
      ],
      tracklist,
    )
    expect(out.map((a) => a.id)).toEqual(['first', 'second'])
  })
})

describe('reassign', () => {
  const tracklist = [t('A', 'Radio', '3:00'), t('B', 'Extended', '6:00')]
  const initial = assignTracks(
    [
      { id: 'short', target: { title: 'radio', durationSec: 180 } },
      { id: 'long', target: { title: 'extended', durationSec: 360 } },
    ],
    tracklist,
  )

  it('moves a file onto a free track', () => {
    const cleared = reassign(initial, 'long', undefined)
    const out = reassign(cleared, 'short', tracklist[1])
    expect(out.find((a) => a.id === 'short')?.track?.position).toBe('B')
  })

  it('swaps entries when the chosen track is already held by another file', () => {
    // Picking long's track for short must hand short's old track to long, so the two
    // simply trade rather than leaving them both pointed at the same entry.
    const out = reassign(initial, 'short', tracklist[1])
    expect(out.find((a) => a.id === 'short')?.track?.position).toBe('B')
    expect(out.find((a) => a.id === 'long')?.track?.position).toBe('A')
  })

  it('unassigns a file when given no track', () => {
    const out = reassign(initial, 'short', undefined)
    const short = out.find((a) => a.id === 'short')
    expect(short?.track).toBeUndefined()
    expect(short?.confidence).toBe(0)
  })
})
