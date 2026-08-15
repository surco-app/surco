import { describe, expect, it } from 'vitest'
import {
  BATCH_QUEUE,
  batchFrame,
  declickFrame,
  TAG_FIELDS,
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
  it('replaces the junk artist with the real one as it runs', () => {
    expect(tagFrame(0).artist).toBe('')
    expect(tagFrame(1).artist).toBe('Lil Suzy')
  })

  // The name types in rather than appearing: the swap is the whole point of the
  // scene, and a cut that lands in one frame reads as a page glitch.
  it('types the name in progressively', () => {
    const mid = tagFrame(0.3).artist
    expect(mid.length).toBeGreaterThan(0)
    expect(mid.length).toBeLessThan('Lil Suzy'.length)
    expect('Lil Suzy'.startsWith(mid)).toBe(true)
  })

  it('fills every metadata field by the end, none at the start', () => {
    expect(tagFrame(0).fields.filter(Boolean)).toHaveLength(0)
    expect(tagFrame(1).fields).toEqual(TAG_FIELDS)
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
