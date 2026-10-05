import { describe, expect, it } from 'vitest'
import {
  BATCH_QUEUE,
  batchFrame,
  DROP_TOTAL,
  DROP_TRACKS,
  declickFrame,
  dropFrame,
  NORMALIZE_TARGET,
  NORMALIZE_TRACKS,
  normalizeFrame,
  REPLACE_PLAYLISTS,
  replaceFrame,
  spectrumFrame,
  TAG_ARTIST,
  TAG_FIELDS,
  TAG_JUNK_ARTIST,
  TAG_MATCHES,
  TAG_QUERY,
  TRIM_CUT,
  tagFrame,
  trimFrame,
} from './scenes'
import { DECLICK_MARKS } from './waveforms'

// Every scene is frozen mid-action in the static version — "12/40", "Converting
// 11/40", the cut already placed. These check that each frame function actually
// travels from nothing-done to done, because a scene that starts finished is the
// bug the animation exists to fix.

describe('tagFrame', () => {
  // One field, overwritten, which is what the app does. A before panel and an after
  // panel explain the swap; a single field being rewritten in place *is* the swap.
  it('starts on the junk name and ends on the real one', () => {
    expect(tagFrame(0).artist).toBe(TAG_JUNK_ARTIST)
    expect(tagFrame(1).artist).toBe(TAG_ARTIST)
  })

  // The junk clears before the good name arrives, rather than the two crossfading
  // into a frame that shows a value belonging to neither.
  it('never shows a name that is neither the junk nor the real one', () => {
    for (let i = 0; i <= 60; i++) {
      const { artist } = tagFrame(i / 60)
      const valid =
        TAG_JUNK_ARTIST.startsWith(artist) || TAG_ARTIST.startsWith(artist) || artist === ''
      expect(valid).toBe(true)
    }
  })

  it('types the name in progressively', () => {
    const partials = Array.from({ length: 60 }, (_, i) => tagFrame(i / 60).artist).filter(
      (a) => a.length > 0 && a.length < TAG_ARTIST.length && TAG_ARTIST.startsWith(a),
    )
    expect(partials.length).toBeGreaterThan(0)
  })

  it('holds the junk name until the release is applied', () => {
    for (let i = 0; i <= 60; i++) {
      const f = tagFrame(i / 60)
      if (!f.picked) expect(f.artist).toBe(TAG_JUNK_ARTIST)
    }
  })

  it('fills every metadata field by the end, none at the start', () => {
    expect(tagFrame(0).fields.filter(Boolean)).toHaveLength(0)
    expect(tagFrame(1).fields).toEqual(TAG_FIELDS)
  })

  // The section claims tags arrive "in one click", so the scene has to show the search
  // that precedes the click.
  it('types the query in before any result arrives', () => {
    expect(tagFrame(0).query).toBe('')
    expect(tagFrame(0).results).toBe(0)
    const early = tagFrame(0.1)
    expect(early.query.length).toBeGreaterThan(0)
    expect(TAG_QUERY.startsWith(early.query)).toBe(true)
    expect(tagFrame(1).query).toBe(TAG_QUERY)
  })

  it('brings the results in one at a time, after the query is typed', () => {
    const counts = Array.from({ length: 30 }, (_, i) => tagFrame(i / 30).results)
    expect(new Set(counts).size).toBeGreaterThan(2)
    expect(tagFrame(1).results).toBe(TAG_MATCHES.length)
  })

  // In the app a release opens to list its tracks, and the click that applies the tags
  // lands on one of them. Picking before the tracks are on screen skips that step.
  it('opens the release to its tracks before one is picked', () => {
    const frames = Array.from({ length: 81 }, (_, i) => tagFrame(i / 80))
    const opened = frames.findIndex((f) => f.open)
    const picked = frames.findIndex((f) => f.picked)
    expect(opened).toBeGreaterThan(frames.findIndex((f) => f.results === TAG_MATCHES.length) - 1)
    expect(opened).toBeLessThan(picked)
  })

  // Nothing is applied until a release is picked: the artwork and the fields are the
  // consequence of the click.
  it('applies nothing before the pick', () => {
    for (let i = 0; i <= 40; i++) {
      const f = tagFrame(i / 40)
      if (!f.picked) {
        expect(f.artwork).toBe(0)
        expect(f.fields.filter(Boolean)).toHaveLength(0)
      }
    }
  })

  it('drops the artwork in after the pick and settles it', () => {
    expect(tagFrame(1).artwork).toBe(1)
    let prev = -1
    for (let i = 0; i <= 40; i++) {
      const { artwork } = tagFrame(i / 40)
      expect(artwork).toBeGreaterThanOrEqual(prev)
      prev = artwork
    }
  })
})

describe('declickFrame', () => {
  // A click only counts as "found" once the playhead has reached it, and it stays
  // found — the scene claims Surco located them, so they must accumulate rather
  // than blink out behind the playhead.
  it('finds each click as the playhead passes it, and keeps it', () => {
    expect(declickFrame(0).found).toBe(0)
    const firstMark = DECLICK_MARKS[0]
    expect(declickFrame(firstMark - 0.01).found).toBe(0)
    expect(declickFrame(firstMark + 0.01).found).toBe(1)
    expect(declickFrame(1).found).toBe(DECLICK_MARKS.length)
  })

  it('never un-finds a click', () => {
    let prev = -1
    for (let i = 0; i <= 40; i++) {
      const { found } = declickFrame(i / 40)
      expect(found).toBeGreaterThanOrEqual(prev)
      prev = found
    }
  })

  // The copy promises you can hear both versions, so the toggle has to actually
  // move at some point instead of sitting on one side.
  it('switches to the original at least once mid-run', () => {
    const states = Array.from({ length: 40 }, (_, i) => declickFrame(i / 40).hearingOriginal)
    expect(states).toContain(true)
    expect(states).toContain(false)
  })
})

describe('trimFrame', () => {
  it('starts with nothing trimmed and ends locked on the beat', () => {
    expect(trimFrame(0).cut).toBeCloseTo(1, 2)
    expect(trimFrame(1).cut).toBeCloseTo(TRIM_CUT, 2)
    expect(trimFrame(0).locked).toBe(false)
    expect(trimFrame(1).locked).toBe(true)
  })

  // The magnet is the claim: the cut overshoots and settles back onto the last
  // beat. Without the overshoot it is just a bar sliding, which the copy oversells.
  // A 60-step sweep of the whole run missed it — the overshoot lives in a narrow
  // window right after the slide ends, so the check has to sample there.
  it('overshoots past the final cut before settling', () => {
    const settling = Array.from({ length: 60 }, (_, i) => trimFrame(0.72 + (i / 60) * 0.28).cut)
    expect(Math.min(...settling)).toBeLessThan(TRIM_CUT)
  })

  // ...and comes back. An overshoot that never recovers is a miscalculated cut, not
  // a magnet snapping onto the beat.
  it('settles back onto the beat after overshooting', () => {
    expect(trimFrame(1).cut).toBeCloseTo(TRIM_CUT, 3)
  })

  it('never lets the cut leave the waveform', () => {
    for (let i = 0; i <= 60; i++) {
      const { cut } = trimFrame(i / 60)
      expect(cut).toBeGreaterThanOrEqual(0)
      expect(cut).toBeLessThanOrEqual(1)
    }
  })
})

describe('batchFrame', () => {
  it('walks the queue from untouched to every track done', () => {
    expect(batchFrame(0).states.every((s) => s === 'idle')).toBe(true)
    expect(batchFrame(1).states.every((s) => s === 'done')).toBe(true)
  })

  // One track converts at a time in the mock, mirroring what the row states show.
  it('never has more than one track working at once', () => {
    for (let i = 0; i <= 40; i++) {
      const working = batchFrame(i / 40).states.filter((s) => s === 'working')
      expect(working.length).toBeLessThanOrEqual(1)
    }
  })

  it('leaves no track behind the one that is working', () => {
    const { states } = batchFrame(0.5)
    const workingAt = states.indexOf('working')
    if (workingAt > 0) {
      expect(states.slice(0, workingAt).every((s) => s === 'done')).toBe(true)
    }
  })

  // Destinations are only reachable once files exist to send, which is the order
  // the real app works in — lighting them early would misdescribe the product.
  // Checking only t=0 and t=1 let a "lit from the very start" version through, so
  // this pins the middle of the run too: nothing lights while the queue is young.
  it('lights the destinations only after conversions are under way', () => {
    expect(batchFrame(0).destinationsLit).toBe(0)
    expect(batchFrame(0.25).destinationsLit).toBe(0)
    expect(batchFrame(0.5).destinationsLit).toBe(0)
    expect(batchFrame(1).destinationsLit).toBe(4)
  })

  it('brings the destinations in one at a time, not all at once', () => {
    const counts = Array.from({ length: 40 }, (_, i) => batchFrame(i / 40).destinationsLit)
    expect(new Set(counts).size).toBeGreaterThan(2)
  })

  it('covers the whole queue', () => {
    expect(batchFrame(1).states).toHaveLength(BATCH_QUEUE.length)
  })
})

describe('dropFrame', () => {
  const frames = Array.from({ length: 121 }, (_, i) => dropFrame(i / 120))
  const firstAt = (pred: (f: (typeof frames)[number]) => boolean) => frames.findIndex(pred)

  // The step is called "drop them in and they're there". It has to open on the window
  // the app shows with nothing loaded, or it shows the aftermath of an import.
  it('opens on the empty window, with no tracks in it', () => {
    expect(dropFrame(0).stage).toBe('empty')
    expect(dropFrame(0).rows).toHaveLength(0)
  })

  it('drags the files in before any track appears', () => {
    const dragging = firstAt((f) => f.stage === 'dragging')
    expect(dragging).toBeGreaterThan(0)
    expect(dragging).toBeLessThan(firstAt((f) => f.rows.length > 0))
  })

  // The app lists the whole drop at once with placeholder rows, then reads each file.
  it('lists the whole crate on the drop and reads the tracks one after another', () => {
    const dropped = frames[firstAt((f) => f.rows.length > 0)]
    expect(dropped.rows).toHaveLength(DROP_TRACKS.length)
    expect(dropped.rows.every((r) => r.state === 'loading')).toBe(true)

    const done = frames.map((f) => f.rows.filter((r) => r.state === 'done').length)
    for (let i = 1; i < done.length; i++) {
      expect(done[i]).toBeGreaterThanOrEqual(done[i - 1])
      expect(done[i] - done[i - 1]).toBeLessThanOrEqual(1)
    }
    expect(dropFrame(1).rows.every((r) => r.state === 'done')).toBe(true)
  })

  it('counts the files it reads up to the whole folder, never backwards', () => {
    const reads = frames.map((f) => f.read)
    for (let i = 1; i < reads.length; i++) expect(reads[i]).toBeGreaterThanOrEqual(reads[i - 1])
    expect(dropFrame(1).read).toBe(DROP_TOTAL)
    for (const f of frames) if (f.rows.length === 0) expect(f.read).toBe(0)
  })

  // The convert button only offers the whole folder once every file has been read, as
  // the toolbar does in the app.
  it('finishes only when every track has been read', () => {
    for (const f of frames)
      if (f.stage === 'done') expect(f.rows.every((r) => r.state === 'done')).toBe(true)
    expect(dropFrame(1).stage).toBe('done')
  })

  // A real crate is not seven identical FLACs. A single-format queue reads as
  // placeholder data and undersells taking the folder exactly as it is.
  it('carries a mix of formats, not one repeated', () => {
    expect(new Set(DROP_TRACKS.map((tr) => tr.format)).size).toBeGreaterThan(2)
  })
})

describe('spectrumFrame', () => {
  // The verdict is the product of a scan, so the scan has to happen: a sweep crosses
  // the spectrum and the verdict only lands once it has passed the cutoff it is
  // judging. Showing both badges from frame one states conclusions nobody watched
  // Surco reach.
  it('sweeps across the spectrum and settles at the end', () => {
    expect(spectrumFrame(0).sweep).toBe(0)
    expect(spectrumFrame(1).sweep).toBe(1)

    let prev = -1
    for (let i = 0; i <= 20; i++) {
      const { sweep } = spectrumFrame(i / 20)
      expect(sweep).toBeGreaterThanOrEqual(prev)
      prev = sweep
    }
  })

  it('withholds both verdicts until the sweep has passed them', () => {
    expect(spectrumFrame(0).goodVerdict).toBe(false)
    expect(spectrumFrame(0).fakeVerdict).toBe(false)
    expect(spectrumFrame(1).goodVerdict).toBe(true)
    expect(spectrumFrame(1).fakeVerdict).toBe(true)
  })

  // The wall is the evidence for the fake verdict, so it cannot be drawn before the
  // sweep reaches it — the picture would be making the claim ahead of the analysis.
  it('draws the wall only once the sweep has reached the cutoff', () => {
    for (let i = 0; i <= 40; i++) {
      const f = spectrumFrame(i / 40)
      if (f.wall > 0) expect(f.sweep).toBeGreaterThan(0)
    }
    expect(spectrumFrame(1).wall).toBe(1)
  })
})

describe('normalizeFrame', () => {
  // The scene sells one idea: three tracks that arrive at different volumes and
  // leave matched. If they start level there is nothing to show, and if they end
  // ragged the section is lying about what normalization does.
  it('starts with tracks at their own levels and ends with them matched', () => {
    const start = normalizeFrame(0).bars.map((b) => b.level)
    expect(new Set(start).size).toBe(NORMALIZE_TRACKS.length)

    const end = normalizeFrame(1).bars.map((b) => Math.round(b.level * 1000))
    expect(new Set(end).size).toBe(1)
  })

  // Each track carries its own gain, positive or negative: the quiet one comes up
  // and the loud one comes down. A frame where every bar moved the same direction
  // would describe a volume knob, not normalization.
  it('moves the quiet track up and the loud one down', () => {
    const [quiet, , loud] = NORMALIZE_TRACKS
    expect(quiet.lufs).toBeLessThan(NORMALIZE_TARGET)
    expect(loud.lufs).toBeGreaterThan(NORMALIZE_TARGET)

    const bars = normalizeFrame(1).bars
    expect(bars[0].gain).toBeGreaterThan(0)
    expect(bars[2].gain).toBeLessThan(0)
  })

  it('never overshoots the target on the way there', () => {
    const settled = normalizeFrame(1).bars
    for (let i = 0; i <= 20; i++) {
      const { bars } = normalizeFrame(i / 20)
      expect(bars[0].level).toBeLessThanOrEqual(settled[0].level + 1e-9)
      expect(bars[2].level).toBeGreaterThanOrEqual(settled[2].level - 1e-9)
    }
  })

  it('holds every bar inside the meter', () => {
    for (let i = 0; i <= 20; i++) {
      for (const bar of normalizeFrame(i / 20).bars) {
        expect(bar.level).toBeGreaterThan(0)
        expect(bar.level).toBeLessThanOrEqual(1)
      }
    }
  })
})

// The replace flow as the app runs it: the button, its stages, the converted footer,
// then rekordbox. A visitor who later opens Surco should meet the same steps in the
// same order, so the scene is checked against the app's order, not only for motion.
describe('replaceFrame', () => {
  const frames = Array.from({ length: 201 }, (_, i) => replaceFrame(i / 200))
  const STAGES = ['idle', 'converting', 'appleMusic', 'done'] as const
  const firstAt = (pred: (f: (typeof frames)[number]) => boolean) => frames.findIndex(pred)

  it('opens on the replace button, before anything has run', () => {
    const start = replaceFrame(0)
    expect(start.stage).toBe('idle')
    expect(start.repointed).toBe(false)
    expect(start.playlistsConfirmed).toBe(0)
  })

  it('presses the button before the conversion starts', () => {
    expect(firstAt((f) => f.pressed)).toBeGreaterThan(0)
    expect(firstAt((f) => f.pressed)).toBeLessThan(firstAt((f) => f.stage !== 'idle'))
  })

  it('runs the stages in the order the app shows them, never going back', () => {
    const order = frames.map((f) => STAGES.indexOf(f.stage))
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1])
    expect(new Set(order)).toEqual(new Set([0, 1, 2, 3]))
  })

  // The bar fills to the app's own stage marks, so the fill means what it means there.
  it('fills the button to the app stage marks and never empties it mid-run', () => {
    const busy = frames.filter((f) => f.stage === 'converting' || f.stage === 'appleMusic')
    for (let i = 1; i < busy.length; i++)
      expect(busy[i].progress).toBeGreaterThanOrEqual(busy[i - 1].progress)
    expect(new Set(busy.map((f) => f.progress))).toEqual(new Set([20, 55, 85]))
  })

  // Surco writes rekordbox once the conversion is over, and the Activity row is where it
  // says so. Repointing earlier would show the collection changing before the file exists.
  it('repoints rekordbox only after the track is in Apple Music and Activity reports it', () => {
    const done = firstAt((f) => f.stage === 'done')
    const reported = firstAt((f) => f.activity === 'done')
    expect(firstAt((f) => f.activity !== 'hidden')).toBeGreaterThan(done)
    expect(reported).toBeGreaterThan(done)
    expect(firstAt((f) => f.repointed)).toBeGreaterThanOrEqual(reported)
  })

  // The playlists are the point: confirmed after the path changes, one at a time, and
  // never taken back.
  it('confirms every playlist one by one after the repoint', () => {
    const counts = frames.map((f) => f.playlistsConfirmed)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
      expect(counts[i] - counts[i - 1]).toBeLessThanOrEqual(1)
    }
    expect(firstAt((f) => f.playlistsConfirmed > 0)).toBeGreaterThan(firstAt((f) => f.repointed))
  })

  // Reduced motion jumps straight to t = 1, so the last frame has to tell the whole story.
  it('ends with everything done and the cursor gone', () => {
    const end = replaceFrame(1)
    expect(end.stage).toBe('done')
    expect(end.activity).toBe('done')
    expect(end.repointed).toBe(true)
    expect(end.playlistsConfirmed).toBe(REPLACE_PLAYLISTS.length)
    expect(end.saved).toBe(true)
    expect(end.cursor).toBe('hidden')
  })
})
