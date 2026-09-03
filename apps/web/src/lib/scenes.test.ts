import { describe, expect, it } from 'vitest'
import {
  BATCH_QUEUE,
  batchFrame,
  declickFrame,
  DROP_TRACKS,
  dropFrame,
  spectrumFrame,
  NORMALIZE_TARGET,
  NORMALIZE_TRACKS,
  normalizeFrame,
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
  // One field, overwritten — which is what the app does. A before panel and an after
  // panel explain the swap; a single field being rewritten in place *is* the swap,
  // and it is the whole argument of the step.
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

  // The name types in rather than appearing: a cut that lands in one frame reads as
  // a page glitch instead of as a field being rewritten.
  it('types the name in progressively', () => {
    const partials = Array.from({ length: 60 }, (_, i) => tagFrame(i / 60).artist).filter(
      (a) => a.length > 0 && a.length < TAG_ARTIST.length && TAG_ARTIST.startsWith(a),
    )
    expect(partials.length).toBeGreaterThan(0)
  })

  // Nothing is overwritten until a release is picked: the field still holds its
  // original value while the visitor is choosing.
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

  // The section claims tags arrive "in one click", so the scene has to show the
  // search that precedes the click. Starting with results already on screen states
  // the outcome and skips the act the copy is selling.
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

  // Nothing is applied until a release is picked: the artwork and the fields are the
  // consequence of the click, and showing them land before it would misdescribe how
  // the app works.
  it('picks a release only once the results are in, and applies nothing before', () => {
    expect(tagFrame(0.2).picked).toBe(false)
    const atPick = Array.from({ length: 40 }, (_, i) => tagFrame(i / 40)).find((f) => f.picked)
    expect(atPick).toBeDefined()
    expect(atPick?.results).toBe(TAG_MATCHES.length)

    for (let i = 0; i <= 40; i++) {
      const f = tagFrame(i / 40)
      if (!f.picked) {
        expect(f.artwork).toBe(0)
        expect(f.fields.filter(Boolean)).toHaveLength(0)
      }
    }
  })

  it('drops the artwork in after the pick and settles it', () => {
    expect(tagFrame(0).artwork).toBe(0)
    expect(tagFrame(1).artwork).toBe(1)

    let prev = -1
    for (let i = 0; i <= 40; i++) {
      const { artwork } = tagFrame(i / 40)
      expect(artwork).toBeGreaterThanOrEqual(prev)
      expect(artwork).toBeLessThanOrEqual(1)
      prev = artwork
    }
  })

  it('counts up without ever going backwards', () => {
    let prev = -1
    for (let i = 0; i <= 20; i++) {
      const { done } = tagFrame(i / 20)
      expect(done).toBeGreaterThanOrEqual(prev)
      prev = done
    }
    expect(tagFrame(1).done).toBe(40)
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
  // The step is called "drop them in and they're there". A queue that starts full
  // shows the aftermath of an import, not an import — the tracks have to arrive.
  it('starts empty and ends with the whole crate in', () => {
    expect(dropFrame(0).rows).toHaveLength(0)
    expect(dropFrame(1).rows).toHaveLength(DROP_TRACKS.length)
  })

  it('lands the tracks one after another, never losing one', () => {
    let prev = -1
    for (let i = 0; i <= 40; i++) {
      const n = dropFrame(i / 40).rows.length
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
  })

  // Each row reads its tags after it lands, so the queue shows work in flight rather
  // than a list that was complete the moment it appeared.
  it('reads each track after it arrives, and finishes them all', () => {
    const mid = dropFrame(0.5).rows
    expect(mid.some((r) => r.state === 'loading')).toBe(true)
    expect(dropFrame(1).rows.every((r) => r.state === 'done')).toBe(true)
  })

  it('counts only what has actually landed', () => {
    for (let i = 0; i <= 20; i++) {
      const f = dropFrame(i / 20)
      expect(f.read).toBeLessThanOrEqual(f.total)
    }
    expect(dropFrame(1).read).toBe(dropFrame(1).total)
  })

  // A real crate is not seven identical FLACs — it is whatever the shops and the rips
  // left behind. A single-format queue reads as placeholder data and undersells the
  // one thing this step does: take the folder exactly as it is.
  it('carries a mix of formats, not one repeated', () => {
    const formats = new Set(DROP_TRACKS.map((tr) => tr.format))
    expect(formats.size).toBeGreaterThan(2)
  })

  // The lede promises Surco reads length as it goes, so the length has to arrive with
  // the row rather than being absent from the thing the copy points at.
  it('reads a length for every track it finishes', () => {
    for (const row of dropFrame(1).rows) {
      expect(row.duration).toMatch(/^\d+:\d{2}$/)
    }
  })

  // Lengths are only known once the file has been read, so a row still loading cannot
  // already display one.
  it('shows no length on a track it is still reading', () => {
    for (let i = 0; i <= 40; i++) {
      for (const row of dropFrame(i / 40).rows) {
        if (row.state === 'loading') expect(row.duration).toBe('')
      }
    }
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
