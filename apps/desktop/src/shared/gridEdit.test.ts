import { describe, expect, it } from 'vitest'
import {
  autoFitGrid,
  carryOntoGrid,
  detectedBeatNear,
  downbeatAt,
  type EditableGrid,
  editAt,
  editableGridOf,
  fitGrid,
  gridAnchors,
  gridBeats,
  gridFingerprint,
  gridOffsets,
  pinGrid,
  retempoGrid,
  sameGrid,
  scaleGrid,
  shiftGrid,
  toggleAnchor,
} from './gridEdit'

const drawn = (grid: EditableGrid, durationMs: number) =>
  gridBeats(grid, durationMs).map((b) => b.ms)

const constantBeats = (bpm: number, from: number, count: number, firstBeat = 1) =>
  Array.from({ length: count }, (_, i) => ({
    ms: Math.round(from + (i * 60000) / bpm),
    beat: ((firstBeat - 1 + i) % 4) + 1,
  }))

describe('editableGridOf', () => {
  it('reads a constant rekordbox grid as its BPM and the first downbeat, so every edit starts from what the DJ has', () => {
    const grid = editableGridOf(constantBeats(150, 46, 400))
    expect(grid?.bpm).toBeCloseTo(150, 3)
    expect(grid?.anchorMs).toBe(46)
  })

  it('keeps the hundredth of a BPM that rekordbox stores, because a 0.01 error is the drift the DJ came to fix', () => {
    expect(editableGridOf(constantBeats(150.04, 46, 400))?.bpm).toBeCloseTo(150.04, 3)
  })

  it('keeps the fractions of a BPM that Traktor and Engine store, since rounding them drifts the grid 10 ms over a track', () => {
    expect(editableGridOf(constantBeats(127.9966, 46, 760))?.bpm).toBeCloseTo(127.9966, 3)
  })

  it('keeps bars that restart mid-track as a second zone, so the DJ downbeat is never renumbered', () => {
    const beats = constantBeats(150, 46, 400)
    const restarted = beats.map((b, i) => (i < 200 ? b : { ...b, beat: ((i + 1) % 4) + 1 }))
    const grid = editableGridOf(restarted)
    expect(grid?.zones).toHaveLength(1)
    expect(gridBeats(grid as EditableGrid, 400 * 400).map((b) => b.beat)).toEqual(
      restarted.map((b) => b.beat),
    )
  })

  it('anchors on the first downbeat even when the grid starts mid-bar', () => {
    expect(editableGridOf(constantBeats(150, 46, 400, 3))?.anchorMs).toBe(846)
  })

  it('keeps a grid with two tempos as two zones, because flattening it would erase work the DJ did by hand', () => {
    const first = constantBeats(150, 46, 200)
    const last = first[first.length - 1].ms
    const second = constantBeats(140, last + 60000 / 140, 200, 1)
    const grid = editableGridOf([...first, ...second])
    expect(grid?.bpm).toBeCloseTo(150, 2)
    expect(grid?.zones?.[0].bpm).toBeCloseTo(140, 2)
  })

  it('refuses fewer than two beats, since there is no tempo to read', () => {
    expect(editableGridOf([{ ms: 46, beat: 1 }])).toBeNull()
    expect(editableGridOf([])).toBeNull()
  })
})

describe('gridBeats', () => {
  it('draws the beats the program would draw, numbered within the bar', () => {
    const beats = gridBeats({ bpm: 150, anchorMs: 46 }, 2000)
    expect(beats.map((b) => b.ms)).toEqual([46, 446, 846, 1246, 1646])
    expect(beats.map((b) => b.beat)).toEqual([1, 2, 3, 4, 1])
  })

  it('keeps the bar numbering when the anchor is moved before the start of the track', () => {
    const beats = gridBeats({ bpm: 150, anchorMs: -354 }, 1000)
    expect(beats[0]).toEqual({ ms: 46, beat: 2 })
  })
})

describe('shiftGrid', () => {
  it('moves the whole grid without touching the tempo', () => {
    expect(shiftGrid({ bpm: 150, anchorMs: 46 }, -10)).toEqual({ bpm: 150, anchorMs: 36 })
  })
})

describe('retempoGrid', () => {
  it('keeps the beat nearest the playhead where it is, so what the DJ is looking at does not jump', () => {
    const grid = retempoGrid({ bpm: 150, anchorMs: 0 }, 149.99, 4000)
    expect(grid).not.toBeNull()
    const nearest = gridBeats(grid as NonNullable<typeof grid>, 10000).reduce((a, b) =>
      Math.abs(b.ms - 4000) < Math.abs(a.ms - 4000) ? b : a,
    )
    expect(Math.abs(nearest.ms - 4000)).toBeLessThanOrEqual(0.5)
    expect(nearest.beat).toBe(3)
  })

  it('refuses a tempo outside 40 to 300 BPM', () => {
    expect(retempoGrid({ bpm: 150, anchorMs: 0 }, 301, 0)).toBeNull()
    expect(retempoGrid({ bpm: 150, anchorMs: 0 }, 39, 0)).toBeNull()
  })
})

describe('downbeatAt', () => {
  it('puts a downbeat exactly at the playhead', () => {
    const beats = gridBeats(downbeatAt({ bpm: 150, anchorMs: 46 }, 1000), 3000)
    expect(beats).toContainEqual({ ms: 1000, beat: 1 })
  })
})

describe('fitGrid', () => {
  it('lands on the detected beats but keeps the DJ downbeat nearest the old one, since the detector cannot find the bar', () => {
    expect(fitGrid({ bpm: 150, anchorMs: 46 }, { bpm: 150, firstMs: 10 })).toEqual({
      bpm: 150,
      anchorMs: 10,
    })
    expect(fitGrid({ bpm: 150, anchorMs: 1246 }, { bpm: 150, firstMs: 10 }).anchorMs).toBe(1210)
  })

  it('takes the detected BPM when it is within 1% of the DJ one', () => {
    expect(fitGrid({ bpm: 150, anchorMs: 46 }, { bpm: 150.04, firstMs: 10 }).bpm).toBe(150.04)
  })

  it('keeps the DJ BPM when the detector found double or half, and only fixes the phase', () => {
    const grid = fitGrid({ bpm: 150, anchorMs: 46 }, { bpm: 300, firstMs: 10 })
    expect(grid.bpm).toBe(150)
    expect(grid.anchorMs).toBe(10)
  })
})

describe('gridOffsets', () => {
  it('shows the same offset here and at the end for a shifted grid, the common case', () => {
    expect(
      gridOffsets(
        drawn({ bpm: 150, anchorMs: 46 }, 345000),
        { bpm: 150, firstMs: 0 },
        26500,
        345000,
      ),
    ).toEqual({
      hereMs: 46,
      endMs: 46,
    })
  })

  it('shows the offset growing towards the end when the BPM is a hundredth off, so the DJ knows to touch the tempo', () => {
    const { hereMs, endMs } = gridOffsets(
      drawn({ bpm: 150.01, anchorMs: 0 }, 345000),
      { bpm: 150, firstMs: 0 },
      0,
      345000,
    )
    expect(hereMs).toBe(0)
    expect(Math.abs(endMs + 23)).toBeLessThanOrEqual(1)
  })
})

describe('scaleGrid', () => {
  it('keeps the old downbeat a downbeat when doubling, so the bar stays where the DJ had it', () => {
    expect(scaleGrid({ bpm: 120, anchorMs: 0 }, 2)).toEqual({ bpm: 240, anchorMs: 0 })
  })

  it('turns the old beats 1 and 3 into the new 1 and 2 when halving', () => {
    const half = scaleGrid({ bpm: 120, anchorMs: 0 }, 0.5)
    expect(half).toEqual({ bpm: 60, anchorMs: 0 })
    expect(gridBeats(half as NonNullable<typeof half>, 4100).map((b) => b.ms)).toEqual([
      0, 1000, 2000, 3000, 4000,
    ])
  })

  it('refuses to leave 40 to 300 BPM', () => {
    expect(scaleGrid({ bpm: 175, anchorMs: 0 }, 2)).toBeNull()
    expect(scaleGrid({ bpm: 70, anchorMs: 0 }, 0.5)).toBeNull()
  })
})

describe('sameGrid', () => {
  it('treats a nudge and its reverse as no change, though the float sum is off by a hair', () => {
    expect(sameGrid({ bpm: 150, anchorMs: 0.1 + 1 - 1 }, { bpm: 150, anchorMs: 0.1 })).toBe(true)
    expect(sameGrid({ bpm: 150, anchorMs: 1 }, { bpm: 150, anchorMs: 0 })).toBe(false)
    expect(sameGrid(null, null)).toBe(true)
    expect(sameGrid({ bpm: 150, anchorMs: 0 }, null)).toBe(false)
  })
})

describe('gridFingerprint', () => {
  const beats = [
    { ms: 46, beat: 1 },
    { ms: 446, beat: 2 },
  ]

  it('stays the same for the same grid and changes when a beat moves a millisecond or is renumbered', () => {
    expect(gridFingerprint(beats)).toBe(gridFingerprint(beats.map((b) => ({ ...b }))))
    expect(gridFingerprint(beats)).not.toBe(gridFingerprint([beats[0], { ms: 447, beat: 2 }]))
    expect(gridFingerprint(beats)).not.toBe(gridFingerprint([beats[0], { ms: 446, beat: 3 }]))
  })

  it('is empty when there is no grid', () => {
    expect(gridFingerprint([])).toBe('')
  })
})

const windows = (fromMs: number, toMs: number, firstMs: number) =>
  Array.from({ length: Math.floor((toMs - fromMs) / 6400) + 1 }, (_, i) => ({
    ms: fromMs + i * 6400,
    firstMs,
  }))

describe('gridOffsets with the phase measured along the track', () => {
  const fit = {
    bpm: 150,
    firstMs: 0,
    phases: [...windows(3200, 60000, 25), ...windows(66400, 345000, 0)],
  }

  it('compares the grid with the beats near the playhead, not with one fit of the whole track', () => {
    expect(gridOffsets(drawn({ bpm: 150, anchorMs: 0 }, 345000), fit, 12000, 345000)).toEqual({
      hereMs: -25,
      endMs: 0,
    })
  })
})

describe('fitting around the playhead', () => {
  const fit = {
    bpm: 150,
    firstMs: 0,
    phases: [
      ...windows(3200, 60000, 25),
      ...windows(66400, 280000, 0),
      ...windows(286400, 345000, 200),
    ],
  }

  // Auto used to fit the five stretches nearest the playhead, so each press from another place
  // gave another grid (Miracle, 09/11). One tempo gets one answer from the whole track; a
  // spliced intro is fixed by opening a zone there and pressing Auto inside it.
  it('gives a grid of one tempo the same answer wherever the playhead is', () => {
    expect(fitGrid({ bpm: 150, anchorMs: 46 }, fit, 31000)).toEqual({ bpm: 150, anchorMs: 0 })
    expect(fitGrid({ bpm: 150, anchorMs: 46 }, fit, 199000)).toEqual({ bpm: 150, anchorMs: 0 })
  })

  it('fits a zone from the stretches inside it, so a spliced intro is fixed once a zone opens there', () => {
    const zoned = toggleAnchor({ bpm: 150, anchorMs: 46 }, 63000)
    const intro = fitGrid(zoned, fit, 31000)
    expect(intro.anchorMs).toBe(25)
    expect(fitGrid(intro, fit, 199000).zones?.[0].anchorMs).toBeCloseTo(0, 6)
  })

  it('ignores a stretch where the detector locked half a beat away, and uses the whole-track fit there', () => {
    expect(fitGrid({ bpm: 150, anchorMs: 46 }, fit, 300000).anchorMs).toBe(0)
    expect(gridOffsets(drawn({ bpm: 150, anchorMs: 0 }, 300000), fit, 300000, 300000)).toEqual({
      hereMs: 0,
      endMs: 0,
    })
  })
})

describe('zones', () => {
  const spliced = () => [
    ...constantBeats(150, 46, 300),
    ...constantBeats(150, 46 + 300 * 400 + 25, 500),
  ]

  it('reads a grid spliced in two as two zones instead of refusing it, so an edit with a moved intro can be fixed', () => {
    const grid = editableGridOf(spliced())
    expect(grid?.anchorMs).toBe(46)
    expect(grid?.zones).toHaveLength(1)
    expect(grid?.zones?.[0].fromMs).toBe(46 + 300 * 400 + 25)
    expect(grid?.zones?.[0].bpm).toBeCloseTo(150, 2)
  })

  it('draws each zone from its own anchor and ends a zone where the next begins', () => {
    const grid = editableGridOf(spliced())
    const beats = gridBeats(grid as EditableGrid, 800 * 400).map((b) => b.ms)
    expect(beats.slice(298, 302).map(Math.round)).toEqual([119246, 119646, 120071, 120471])
    expect(beats).toHaveLength(800)
  })

  it('straightens a grid rekordbox bent a few ms along the track, so a track the bad-grid filter flags can be fixed', () => {
    const bent = Array.from({ length: 694 }, (_, i) => ({
      ms: Math.round(425 + i * 457.47 + 14 * Math.cos((i / 693) * 2 * Math.PI)),
      beat: ((2 + i) % 4) + 1,
    }))
    const grid = editableGridOf(bent)
    expect(grid?.zones).toBeUndefined()
    expect(grid?.bpm).toBeCloseTo(60000 / 457.47, 2)
  })

  it('measures the offset against the lines drawn, so a bent grid shows where its beats really are', () => {
    const bent = Array.from({ length: 694 }, (_, i) =>
      Math.round(425 + i * 457.47 + 14 * Math.sin((i / 694) * 2 * Math.PI)),
    )
    const fit = { bpm: 60000 / 457.47, firstMs: 425 }
    expect(gridOffsets(bent, fit, 425 + 173 * 457.47, 320000).hereMs).toBe(14)
  })

  it('still refuses a grid too irregular to split into a few zones, like a live drummer analysed beat by beat', () => {
    const drifting = Array.from({ length: 200 }, (_, i) => ({
      ms: i * 400 + (i % 2) * 7,
      beat: (i % 4) + 1,
    }))
    expect(editableGridOf(drifting)).toBeNull()
  })

  it('opens a zone at the beat nearest the playhead without moving any beat, and closes it again there', () => {
    const one = { bpm: 150, anchorMs: 46 }
    const two = toggleAnchor(one, 40010)
    expect(gridAnchors(two)).toEqual([40046])
    expect(gridBeats(two, 80000)).toEqual(gridBeats(one, 80000))
    expect(toggleAnchor(two, 40100)).toEqual(one)
  })

  it('applies an edit only to the zone under the playhead', () => {
    const two = toggleAnchor({ bpm: 150, anchorMs: 46 }, 40046)
    const moved = editAt(two, 60000, (z) => shiftGrid(z, 25))
    const beats = gridBeats(moved as EditableGrid, 80000)
    expect(beats.find((b) => b.ms > 20000 && b.ms < 20400)?.ms).toBe(20046)
    expect(beats.find((b) => b.ms > 60000 && b.ms < 60400)?.ms).toBe(60071)
  })

  it('compares zones too when deciding whether the grid changed', () => {
    const two = toggleAnchor({ bpm: 150, anchorMs: 46 }, 40046)
    expect(sameGrid(two, { bpm: 150, anchorMs: 46 })).toBe(false)
    expect(sameGrid(two, toggleAnchor({ bpm: 150, anchorMs: 46 }, 40046))).toBe(true)
  })

  it('measures the offset against the zone under each point', () => {
    const two = editAt(toggleAnchor({ bpm: 150, anchorMs: 0 }, 40000), 60000, (z) =>
      shiftGrid(z, 25),
    )
    expect(
      gridOffsets(drawn(two as EditableGrid, 100000), { bpm: 150, firstMs: 0 }, 10000, 100000),
    ).toEqual({
      hereMs: 0,
      endMs: 25,
    })
  })
})

describe('a stretch that disagrees with its neighbours', () => {
  const fit = {
    bpm: 150,
    firstMs: 0,
    phases: [{ ms: 6900, firstMs: 338 }, ...windows(34300, 345000, 0)],
  }

  it('does not anchor Auto on one stretch that disagrees with the ones around it, since the detector misreads quiet intros', () => {
    expect(fitGrid({ bpm: 150, anchorMs: 46 }, fit, 0).anchorMs).toBe(0)
  })

  it('does not bend the tempo Auto picks because of that stretch, so the end of the track stays on the beat', () => {
    expect(fitGrid({ bpm: 150, anchorMs: 46 }, fit, 0).bpm).toBe(150)
  })

  it('reads the offset at the playhead from the stretches around it, not from that one', () => {
    expect(gridOffsets(drawn({ bpm: 150, anchorMs: 46 }, 345000), fit, 0, 345000).hereMs).toBe(46)
  })
})

describe('fitting the tempo from the drift along the track', () => {
  const drifting = {
    bpm: 124,
    firstMs: 0,
    phases: Array.from({ length: 40 }, (_, i) => {
      const ms = 3200 + i * 7500
      return { ms, firstMs: (ms * 15) / 300000 }
    }),
  }

  it('corrects the BPM the detector guessed when its beats drift steadily, so Auto never opens the end of the track', () => {
    const fitted = fitGrid({ bpm: 124, anchorMs: 0 }, drifting, 25000)
    const { hereMs, endMs } = gridOffsets(drawn(fitted, 300000), drifting, 25000, 300000)
    expect(Math.abs(hereMs)).toBeLessThanOrEqual(1)
    expect(Math.abs(endMs)).toBeLessThanOrEqual(1)
  })
})

describe('pinGrid', () => {
  const TRUE_BPM = 150
  const kick = (k: number) => 24 + (k * 60000) / TRUE_BPM
  const nearest = (grid: EditableGrid, ms: number) =>
    Math.min(...drawn(grid, 345000).map((b) => Math.abs(b - ms)))
  const shifted = { bpm: 149.95, anchorMs: 24 + 46 }

  // The usual bad grid is only shifted: one pin on a kick has to put the whole grid there
  // without touching a tempo that was already right.
  it('moves the whole grid onto the first pinned beat and keeps its tempo', () => {
    const pinned = pinGrid(shifted, [], kick(75), true) as EditableGrid
    expect(nearest(pinned, kick(75))).toBeLessThan(0.01)
    expect(pinned.bpm).toBe(149.95)
  })

  // A wrong tempo opens the grid along the track. Counting the beats between two pins far
  // apart gives the tempo exactly, so the DJ never nudges ±0.01 and checks the end again.
  it('takes the tempo from the beats between two pins, so the grid lands on every kick between and beyond', () => {
    const first = pinGrid(shifted, [], kick(75), true) as EditableGrid
    const second = pinGrid(first, [kick(75)], kick(825), true) as EditableGrid
    expect(second.bpm).toBeCloseTo(TRUE_BPM, 6)
    for (const k of [0, 75, 400, 825, 850]) expect(nearest(second, kick(k))).toBeLessThan(0.01)
  })

  it('opens a zone at the last pin when a third one lands on another tempo, keeping the part already fixed', () => {
    const first = pinGrid(shifted, [], kick(75), true) as EditableGrid
    const second = pinGrid(first, [kick(75)], kick(825), true) as EditableGrid
    const third = pinGrid(second, [kick(75), kick(825)], kick(825) + 20 * 405, true) as EditableGrid
    expect(third.zones).toHaveLength(1)
    expect(third.zones?.[0].fromMs).toBeCloseTo(kick(825), 6)
    expect(third.zones?.[0].bpm).toBeCloseTo(60000 / 405, 6)
    expect(third.bpm).toBeCloseTo(TRUE_BPM, 6)
  })

  it('keeps one tempo where the program has no zones, bending around the nearest pin instead', () => {
    const first = pinGrid(shifted, [], kick(75), false) as EditableGrid
    const second = pinGrid(first, [kick(75)], kick(825), false) as EditableGrid
    const third = pinGrid(
      second,
      [kick(75), kick(825)],
      kick(825) + 20 * 405,
      false,
    ) as EditableGrid
    expect(third.zones).toBeUndefined()
  })

  it('refuses a second pin on the beat of the first, which gives no tempo', () => {
    const first = pinGrid(shifted, [], kick(75), true) as EditableGrid
    expect(pinGrid(first, [kick(75)], kick(75) + 3, true)).toBeNull()
  })
})

describe('detectedBeatNear', () => {
  it('gives the beat the detector heard nearest a moment, so a pin lands on the kick and not where the click fell', () => {
    expect(detectedBeatNear({ bpm: 120, firstMs: 130 }, 10400, [])).toBe(10630)
    expect(detectedBeatNear({ bpm: 120, firstMs: 130 }, 10100, [])).toBe(10130)
  })

  // On Onirik the detector hears the offbeat, so pinning the beat it heard put the grid half
  // a beat off the kick. Of the beat heard and the one half a beat away, the one nearer the
  // grid is the kick the grid already follows.
  it('gives the beat half a beat away when that one sits nearer the grid, since the detector cannot tell kick from offbeat', () => {
    const grid = Array.from({ length: 100 }, (_, i) => 3 + i * 500)
    expect(detectedBeatNear({ bpm: 120, firstMs: 253 }, 10000, grid)).toBe(10003)
    expect(detectedBeatNear({ bpm: 120, firstMs: 63 }, 10000, grid)).toBe(10063)
  })
})

describe('Auto on a detector that hears two phases a few ms apart', () => {
  const period = 60000 / 142
  const phases = Array.from({ length: 56 }, (_, i) => ({
    ms: 6762 * (i + 1),
    firstMs: i % 3 === 0 ? 4.2 : period - 0.19,
  }))
  const fit = { bpm: 142, firstMs: period - 0.19, phases }

  it('gives the same grid from every place in the track, so pressing it again changes nothing', () => {
    const grid = { bpm: 142, anchorMs: 0 }
    const answers = [0, 30000, 120000, 250000, 380000].map((ms) => fitGrid(grid, fit, ms))
    for (const a of answers) expect(sameGrid(a, answers[0])).toBe(true)
    expect(sameGrid(fitGrid(answers[0], fit, 200000), answers[0])).toBe(true)
  })
})

describe('the first beat', () => {
  // Auto put Miracle's first beat 0.19 ms before the track began. rekordbox keeps whole ms, so
  // it is the beat at 0, and dropping it lost the line under hot cue A.
  it('keeps a beat that falls less than half a millisecond before the start, at the start', () => {
    const beats = gridBeats({ bpm: 142, anchorMs: -0.19 }, 10000)
    expect(beats[0]).toEqual({ ms: 0, beat: 1 })
    expect(beats[1].ms).toBeCloseTo(-0.19 + 60000 / 142, 6)
  })

  it('still leaves out a beat that is really before the start', () => {
    expect(gridBeats({ bpm: 142, anchorMs: -3 }, 10000)[0].beat).toBe(2)
  })
})

describe('carrying a cue on the first beat', () => {
  // After Auto, Miracle's hot cue A went to −0.19 ms with its beat and stopped being drawn.
  it('keeps a cue on the first beat at the start when that beat moves a fraction of a ms before it', () => {
    expect(carryOntoGrid({ bpm: 142, anchorMs: 0 }, { bpm: 142, anchorMs: -0.19 }, 0, 20)).toBe(0)
  })

  it('does not carry a cue onto a beat that is really before the start', () => {
    expect(carryOntoGrid({ bpm: 142, anchorMs: 0 }, { bpm: 142, anchorMs: -3 }, 0, 20)).toBeNull()
  })
})

describe('a detector locked on the offbeat', () => {
  // Onirik (09/11): rekordbox's grid sat on the kick at 3 ms, the detector heard the offbeat in
  // 46 of 50 stretches, and Auto moved the grid half a beat. The detector cannot tell kick
  // from offbeat, so it only ever moves the grid by less than a quarter beat.
  const period = 60000 / 140
  const offbeat = (ms: number) => ({ ms, firstMs: 3 + period / 2 })
  const fit = {
    bpm: 140,
    firstMs: 3 + period / 2,
    phases: Array.from({ length: 50 }, (_, i) => offbeat(6800 * (i + 1))),
  }

  it('keeps a grid on the kick where it is when the detector heard the offbeat', () => {
    const fitted = fitGrid({ bpm: 140, anchorMs: 3 }, fit, 0)
    expect(Math.abs(fitted.anchorMs - 3)).toBeLessThan(0.01)
  })

  it('still moves a grid a little off the kick onto it, reading the offbeat half a beat away', () => {
    const fitted = fitGrid({ bpm: 140, anchorMs: 63 }, fit, 0)
    expect(Math.abs(fitted.anchorMs - 3)).toBeLessThan(0.01)
  })

  it('reads a grid on the kick as on the beat, so Auto is not offered to break it', () => {
    const { hereMs, endMs } = gridOffsets(
      drawn({ bpm: 140, anchorMs: 3 }, 300000),
      fit,
      30000,
      300000,
    )
    expect(Math.abs(hereMs)).toBeLessThanOrEqual(1)
    expect(Math.abs(endMs)).toBeLessThanOrEqual(1)
  })
})

describe('telling the kick by the grid the program analysed', () => {
  // Onirik (09/11): an earlier Auto left the draft half a beat off, on the offbeat. Folding the
  // detector toward that draft kept the error and read it as 0 ms. The program's own grid is
  // what tells kick from offbeat.
  const period = 60000 / 140
  const fit = {
    bpm: 140,
    firstMs: 3 + period / 2,
    phases: Array.from({ length: 50 }, (_, i) => ({ ms: 6800 * (i + 1), firstMs: 3 + period / 2 })),
  }
  const program = drawn({ bpm: 140, anchorMs: 3 }, 300000)
  const offbeatDraft = { bpm: 140, anchorMs: 3 + period / 2 }

  it('puts a draft left on the offbeat back on the kick the program analysed', () => {
    const fitted = fitGrid(offbeatDraft, fit, 0, program)
    const phase = (((fitted.anchorMs - 3) % period) + period) % period
    expect(Math.min(phase, period - phase)).toBeLessThan(0.01)
  })

  it('reads a draft on the offbeat as half a beat off, so Auto is offered', () => {
    const { hereMs } = gridOffsets(drawn(offbeatDraft, 300000), fit, 30000, 300000, program)
    expect(Math.abs(hereMs)).toBeGreaterThan(200)
  })

  it('pins on the kick the program analysed, not on the offbeat the draft follows', () => {
    expect(detectedBeatNear(fit, 30000, program)).toBeCloseTo(3 + 70 * period, 6)
  })
})

const BPM_142 = 142.104
const P_142 = 60000 / BPM_142
const stretchesEvery = (fromMs: number, toMs: number, phaseAt: (ms: number) => number) =>
  Array.from({ length: Math.floor((toMs - fromMs) / 6757) + 1 }, (_, i) => {
    const ms = fromMs + i * 6757
    return { ms, firstMs: 244 + phaseAt(ms) }
  })

describe('a detector that hears sixteenths in a break', () => {
  const fit = {
    bpm: BPM_142,
    firstMs: 244,
    phases: [
      ...stretchesEvery(6800, 196000, () => 0),
      ...stretchesEvery(202700, 223000, () => -P_142 / 4 + 9),
      ...stretchesEvery(229700, 257000, () => -P_142 / 2 + 13),
      ...stretchesEvery(263500, 372000, () => 0),
    ],
  }

  it('reads a grid on the kick as on the beat inside the break, so the readout does not ask to fix what is right', () => {
    const { hereMs } = gridOffsets(
      drawn({ bpm: BPM_142, anchorMs: 244 }, 381000),
      fit,
      220000,
      381000,
    )
    expect(Math.abs(hereMs)).toBeLessThanOrEqual(13)
  })
})

describe('Auto over the whole track', () => {
  const DURATION = 381000
  const steadyThenFaster = {
    bpm: BPM_142,
    firstMs: 244,
    phases: stretchesEvery(6800, 372000, (ms) =>
      ms < 264000 ? 0 : (-(ms - 264000) * 50) / 108000,
    ),
  }
  const offsetsAlong = (grid: EditableGrid, fit: typeof steadyThenFaster) =>
    [20000, 90000, 150000, 230000, 280000, 320000, 360000].map(
      (ms) => gridOffsets(drawn(grid, DURATION), fit, ms, DURATION).hereMs,
    )

  it('opens a zone where the outro speeds up, so the grid stays on the kick to the very end', () => {
    const auto = autoFitGrid({ bpm: 142.13, anchorMs: 270 }, steadyThenFaster, 0, [], true)
    expect(auto.zones).toHaveLength(1)
    expect(Math.abs((auto.zones?.[0].fromMs ?? 0) - 264000)).toBeLessThan(7000)
    for (const off of offsetsAlong(auto, steadyThenFaster))
      expect(Math.abs(off)).toBeLessThanOrEqual(3)
  })

  it('keeps the bars counting across the new zone, so the downbeats after it are still beat 1', () => {
    for (const downbeat of [0, 1, 2, 3]) {
      const grid = { bpm: 142.13, anchorMs: 270 + downbeat * P_142 }
      const auto = autoFitGrid(grid, steadyThenFaster, 0, [], true)
      const beats = gridBeats(auto, DURATION)
      const at = beats.findIndex((b) => b.ms >= (auto.zones?.[0].fromMs ?? 0))
      expect(beats.slice(at - 2, at + 2).map((b) => b.beat)).toEqual(
        [0, 1, 2, 3].map((i) => ((beats[at - 2].beat - 1 + i) % 4) + 1),
      )
    }
  })

  it('leaves a track of one tempo in one zone, though each stretch reads a few ms either way', () => {
    const jitter = {
      bpm: BPM_142,
      firstMs: 244,
      phases: stretchesEvery(
        6800,
        372000,
        (ms) => [4, -9, 0, 9, -4, 13, -9][Math.round(ms / 6757) % 7],
      ),
    }
    expect(autoFitGrid({ bpm: 142.13, anchorMs: 270 }, jitter, 0, [], true).zones).toBeUndefined()
  })

  it('opens no zone for a stretch the detector hears early and then leaves, since a real change of tempo never comes back', () => {
    const wandering = {
      bpm: 140.015,
      firstMs: 244,
      phases: stretchesEvery(6800, 330000, (ms) =>
        (ms > 180000 && ms < 220000) || (ms > 258000 && ms < 272000) ? -36 : 0,
      ),
    }
    expect(
      autoFitGrid({ bpm: 140.015, anchorMs: 250 }, wandering, 0, [], true).zones,
    ).toBeUndefined()
  })

  it('keeps one tempo where the program has no zones', () => {
    const auto = autoFitGrid({ bpm: 142.13, anchorMs: 270 }, steadyThenFaster, 0, [], false)
    expect(auto.zones).toBeUndefined()
  })

  it('keeps the DJ downbeat in the first zone, since the detector cannot find the bar', () => {
    const auto = autoFitGrid(
      { bpm: 142.13, anchorMs: 270 + 2 * P_142 },
      steadyThenFaster,
      0,
      [],
      true,
    )
    expect(Math.abs(auto.anchorMs - (244 + 2 * P_142))).toBeLessThan(5)
  })
})

describe('Auto on the fine measurements', () => {
  const BPM = 140
  const DURATION = 380000
  const fineEvery = (fromMs: number, toMs: number, phaseAt: (ms: number) => number) =>
    Array.from({ length: Math.floor((toMs - fromMs) / 1714) + 1 }, (_, i) => {
      const ms = fromMs + i * 1714
      return { ms, firstMs: 100 + phaseAt(ms) }
    })
  const fitOf = (fine: { ms: number; firstMs: number }[]) => ({ bpm: BPM, firstMs: 100, fine })
  const worstAlong = (grid: EditableGrid, fit: ReturnType<typeof fitOf>) =>
    Math.max(
      ...Array.from({ length: 36 }, (_, i) =>
        Math.abs(gridOffsets(drawn(grid, DURATION), fit, 10000 + i * 10000, DURATION).hereMs),
      ),
    )

  it('follows a master whose tempo breathes with as many zones as it takes, more than eight if it must', () => {
    const fit = fitOf(fineEvery(1000, 378000, (ms) => 10 * Math.sin((2 * Math.PI * ms) / 60000)))
    const auto = autoFitGrid({ bpm: BPM, anchorMs: 120 }, fit, 0, [], true)
    expect(auto.zones?.length).toBeGreaterThan(8)
    expect(worstAlong(auto, fit)).toBeLessThanOrEqual(5)
  })

  it('keeps one zone on a steady track whose readings wobble a bin either way', () => {
    const fit = fitOf(
      fineEvery(1000, 378000, (ms) => [0, 2.2, 0, -2.2, 2.2][Math.round(ms / 1714) % 5]),
    )
    expect(autoFitGrid({ bpm: BPM, anchorMs: 120 }, fit, 0, [], true).zones).toBeUndefined()
  })

  it('ignores a build the detector hears 12 ms late for twenty seconds and then leaves, since a tempo never jumps and jumps back', () => {
    const fit = fitOf(fineEvery(1000, 378000, (ms) => (ms > 200000 && ms < 220000 ? 12 : 0)))
    const auto = autoFitGrid({ bpm: BPM, anchorMs: 120 }, fit, 0, [], true)
    expect(auto.zones).toBeUndefined()
    expect(worstAlong(auto, fit)).toBeLessThanOrEqual(1)
  })

  it('reads the grid as on the beat through a run of scattered misreadings', () => {
    const junk = [-18, 14, -44, 9, 15, -12, -8]
    const fit = fitOf(
      fineEvery(1000, 378000, (ms) =>
        ms > 140000 && ms < 152000 ? junk[Math.round(ms / 1714) % junk.length] : 0,
      ),
    )
    expect(worstAlong({ bpm: BPM, anchorMs: 100 }, fit)).toBeLessThanOrEqual(1)
  })
})
