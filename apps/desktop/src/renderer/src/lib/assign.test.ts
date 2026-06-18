import { describe, expect, it } from 'vitest'
import type { ReleaseTrack } from '../../../shared/types'
import { type AssignInput, assignTracks, reassign } from './assign'

const t = (position: string, title: string, duration: string): ReleaseTrack => ({
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

  it('lets two copies of the same cut both land on the same track', () => {
    // A repeated file (same title and length) is the same recording twice, so both must
    // map to the same entry — forcing one onto a different track was the old bug.
    const tracklist = [t('A', 'aaa', '5:00'), t('B', 'bbb', '5:01')]
    const files: AssignInput[] = [
      { id: 'one', target: { title: 'aaa', durationSec: 300 } },
      { id: 'two', target: { title: 'aaa', durationSec: 300 } },
    ]
    const out = assignTracks(files, tracklist)
    expect(out[0].track?.position).toBe('A')
    expect(out[1].track?.position).toBe('A')
  })

  it('leaves a file unassigned when no track is within the duration margin', () => {
    // The file's length is the fingerprint: if the closest track is far off, a matching
    // title is not enough to claim it — better unassigned than wrong.
    const tracklist = [t('A1', 'Still Cant (Extended Mix)', '5:42')]
    const files: AssignInput[] = [
      { id: 'rip', target: { title: 'Still Cant (Extended Mix)', durationSec: 252 } },
    ]
    expect(assignTracks(files, tracklist)[0].track).toBeUndefined()
  })

  it('tolerates a few seconds of vinyl drift instead of demanding an exact length', () => {
    const tracklist = [t('A1', 'Some Mix', '4:00')]
    const files: AssignInput[] = [{ id: 'rip', target: { title: 'x', durationSec: 247 } }]
    expect(assignTracks(files, tracklist)[0].track?.position).toBe('A1')
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

  it('changes only the chosen file, leaving others even on the same track', () => {
    // Reassigning short to long's track must not move long: duplicates are allowed, so a
    // manual pick touches one file and never quietly reshuffles the rest.
    const out = reassign(initial, 'short', tracklist[1])
    expect(out.find((a) => a.id === 'short')?.track?.position).toBe('B')
    expect(out.find((a) => a.id === 'long')?.track?.position).toBe('B')
  })

  it('unassigns a file when given no track', () => {
    const out = reassign(initial, 'short', undefined)
    const short = out.find((a) => a.id === 'short')
    expect(short?.track).toBeUndefined()
    expect(short?.confidence).toBe(0)
  })
})
