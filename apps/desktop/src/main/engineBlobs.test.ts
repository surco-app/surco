import { describe, expect, it } from 'vitest'
import {
  decodeBeatGrid,
  decodeLoops,
  decodeOverview,
  decodeQuickCues,
  decodeTrackData,
  deflateEngineBlob,
  encodeLoops,
  encodeQuickCues,
  inflateEngineBlob,
  quickCueSlotBytes,
} from './engineBlobs'
import { shiftEnginePerformance } from './engineRepoint'

const REAL_TRACK_DATA =
  '00000044789C7378DAD1C000030F2540A4A8FD439FD8054086FD5DD7F52049FB933296090CB80100CE5E09F2'
const REAL_BEAT_DATA =
  '0000008A789C7378DAD1C000048E39CA1F403423030430818886F5AF0FFCF90F0102CC0C30D050A19EE3C883E033702298E4EA636000003F501D7F'
const REAL_QUICK_CUES =
  '0000008B789C636000030E56E7D254054347A77D5740DCFF5F2E5B80458C1C93EAAC1A4022EF1B0D18F67F6040004A393093191D2E958205000B8019FA'

const EMPTY_LOOP = `00${'000000000000F0BF'.repeat(2)}000000000000`
const REAL_LOOPS = `0800000000000000${EMPTY_LOOP.repeat(8)}`

const real = (hex: string): Buffer => inflateEngineBlob(Buffer.from(hex, 'hex'))

function overviewOf(entries: [number, number, number][], max: [number, number, number]): Buffer {
  const head = Buffer.alloc(24)
  head.writeBigInt64BE(BigInt(entries.length), 0)
  head.writeBigInt64BE(BigInt(entries.length), 8)
  head.writeDoubleBE(14407.875, 16)
  return Buffer.concat([head, Buffer.from(entries.flat()), Buffer.from(max)])
}

describe('Engine DJ performance blobs', () => {
  it('reads blobs copied byte for byte from a real Engine DJ 4 library, so the layout Surco writes back is the one Engine stores', () => {
    expect(decodeTrackData(real(REAL_TRACK_DATA))).toEqual({
      sampleRate: 44100,
      sampleCount: 14751744,
    })
    expect(decodeBeatGrid(real(REAL_BEAT_DATA))).toEqual({
      sampleRate: 44100,
      markers: [
        { sample: -56700, beat: -4 },
        { sample: 14760900, beat: 780 },
      ],
    })
    const cues = decodeQuickCues(real(REAL_QUICK_CUES))
    expect(cues?.slots.map((s) => s.cue)).toEqual([
      { label: 'Cue 1', sample: 2457000, argb: 0xfff4d338 },
      { label: 'Cue 2', sample: 9695700, argb: 0xffef8130 },
      null,
      null,
      null,
      null,
      null,
      null,
    ])
    expect(cues?.tail.toString('hex')).toBe('41627e3a800000000140d2750000000000')
  })

  it('keeps every slot’s own bytes, so a slot nobody touched can be written back exactly as Engine stored it', () => {
    const raw = real(REAL_QUICK_CUES)
    const cues = decodeQuickCues(raw)
    if (!cues) throw new Error('real quick cues did not decode')
    expect(
      Buffer.concat([raw.subarray(0, 8), ...cues.slots.map((s) => s.bytes), cues.tail]),
    ).toEqual(raw)
  })

  it('reads the adjusted grid, not the default one, because that is the grid the DJ corrected in Engine', () => {
    const grid = (markers: [number, number][]): Buffer[] => {
      const count = Buffer.alloc(8)
      count.writeBigInt64BE(BigInt(markers.length))
      return [
        count,
        ...markers.map(([sample, beat]) => {
          const m = Buffer.alloc(24)
          m.writeDoubleLE(sample, 0)
          m.writeBigInt64LE(BigInt(beat), 8)
          return m
        }),
      ]
    }
    const head = Buffer.alloc(17)
    head.writeDoubleBE(48000, 0)
    head.writeDoubleBE(480000, 8)
    head[16] = 1
    const raw = Buffer.concat([
      head,
      ...grid([[0, 0]]),
      ...grid([
        [1200, 0],
        [481200, 16],
      ]),
    ])
    expect(decodeBeatGrid(raw)).toEqual({
      sampleRate: 48000,
      markers: [
        { sample: 1200, beat: 0 },
        { sample: 481200, beat: 16 },
      ],
    })
  })

  it('reads the overview’s three bands per entry and the peak entry after them', () => {
    expect(
      decodeOverview(
        overviewOf(
          [
            [10, 20, 30],
            [40, 50, 60],
          ],
          [40, 50, 60],
        ),
      ),
    ).toEqual({
      entries: [
        [10, 20, 30],
        [40, 50, 60],
      ],
      max: [40, 50, 60],
    })
  })

  it('reads a blob too short for its layout as nothing rather than throwing, so one damaged row never breaks the playlist', () => {
    expect(decodeTrackData(Buffer.alloc(4))).toBeNull()
    expect(decodeBeatGrid(Buffer.alloc(10))).toBeNull()
    expect(decodeOverview(Buffer.alloc(10))).toBeNull()
    expect(decodeQuickCues(Buffer.alloc(3))).toBeNull()
  })

  it('compresses a blob as Qt does, its length first, so Engine reads back what Surco writes', () => {
    const raw = Buffer.from('quick cues as Engine keeps them')
    const blob = deflateEngineBlob(raw)
    expect(blob.readUInt32BE(0)).toBe(raw.length)
    expect(inflateEngineBlob(blob)).toEqual(raw)
  })

  it('writes quick cues byte for byte as Engine does, empty slots included, so Engine loads a set Surco wrote like its own', () => {
    const raw = real(REAL_QUICK_CUES)
    const cues = decodeQuickCues(raw)
    if (!cues) throw new Error('real quick cues did not decode')
    expect(
      encodeQuickCues(
        cues.slots.map((s) => quickCueSlotBytes(s.cue)),
        cues.tail,
      ),
    ).toEqual(raw)
  })

  it('reads loops as Engine stores them, uncompressed and little-endian, eight unset slots on a track nobody looped', () => {
    const loops = decodeLoops(Buffer.from(REAL_LOOPS, 'hex'))
    expect(loops?.loops).toHaveLength(8)
    expect(loops?.loops[0]).toMatchObject({
      label: '',
      start: -1,
      end: -1,
      startSet: false,
      endSet: false,
      argb: 0,
    })
    expect(encodeLoops(loops?.loops ?? [], loops?.tail)).toEqual(Buffer.from(REAL_LOOPS, 'hex'))
  })

  it('writes a set loop back byte for byte, label and colour included', () => {
    const loop = {
      label: 'Break',
      start: 220500,
      end: 573300.5,
      startSet: true,
      endSet: true,
      argb: 0xff00cc00,
    }
    expect(decodeLoops(encodeLoops([loop]))?.loops).toMatchObject([loop])
  })

  // Like the main cue after the quick cues, whatever a later Engine keeps after the loops,
  // or a flag byte it sets to something other than 1, has to survive a rewrite of them.
  it('writes loops back with the bytes after them and their own flag bytes', () => {
    const flagged = `${SET_LOOP.slice(0, -12)}0201${SET_LOOP.slice(-8)}`
    const raw = Buffer.from(`0100000000000000${flagged}cafe`, 'hex')
    const loops = decodeLoops(raw)
    expect(loops?.loops[0]).toMatchObject({ startSet: true, endSet: true, start: 8 * 44100 })
    expect(encodeLoops(loops?.loops ?? [], loops?.tail)).toEqual(raw)
    const shifted = shiftEnginePerformance(
      {
        trackData: Buffer.from(REAL_TRACK_DATA, 'hex'),
        overviewWaveFormData: null,
        beatData: null,
        quickCues: null,
        loops: raw,
      },
      { trimmedMs: 1000 },
    ).loops
    const after = Buffer.from(shifted ?? [])
    expect(after.subarray(-2).toString('hex')).toBe('cafe')
    expect(after[8 + 6 + 16]).toBe(2)
    expect(decodeLoops(after)?.loops[0].start).toBe(7 * 44100)
  })

  it('reads a loops blob that does not fit its layout as nothing', () => {
    expect(decodeLoops(Buffer.from('0000000801020304', 'hex'))).toBeNull()
  })
})

const SET_LOOP = `05${Buffer.from('Break').toString('hex')}000000008088154100000000A0EA1A410101FF00CC00`
const REAL_SHAPED_LOOPS = `0800000000000000${SET_LOOP}${EMPTY_LOOP.repeat(7)}`

// The byte ranges that hold a position or a rate, walked straight off the bytes rather
// than through the decoders under test.
function positionRanges(blob: 'trackData' | 'beatData' | 'quickCues' | 'loops', raw: Buffer) {
  const ranges: [number, number][] = []
  if (blob === 'trackData') ranges.push([0, 16])
  if (blob === 'beatData') {
    ranges.push([0, 16])
    let at = 17
    for (let g = 0; g < 2; g++) {
      const count = Number(raw.readBigInt64BE(at))
      for (let i = 0; i < count; i++) ranges.push([at + 8 + i * 24, at + 16 + i * 24])
      at += 8 + count * 24
    }
  }
  if (blob === 'quickCues') {
    let at = 8
    for (let i = 0; i < Number(raw.readBigInt64BE(0)); i++) {
      const labelEnd = at + 1 + raw[at]
      ranges.push([labelEnd, labelEnd + 8])
      at = labelEnd + 12
    }
    ranges.push([at, at + 8], [at + 9, at + 17])
  }
  if (blob === 'loops') {
    let at = 8
    for (let i = 0; i < Number(raw.readBigInt64LE(0)); i++) {
      const labelEnd = at + 1 + raw[at]
      ranges.push([labelEnd, labelEnd + 16])
      at = labelEnd + 22
    }
  }
  return ranges
}

const UNSET: Record<string, string> = {
  quickCues: 'bff0000000000000',
  loops: '000000000000f0bf000000000000f0bf',
}

function masked(raw: Buffer, ranges: [number, number][]): Buffer {
  const copy = Buffer.from(raw)
  for (const [start, end] of ranges) copy.fill(0, start, end)
  return copy
}

describe('shifting real Engine DJ blobs', () => {
  it('reads the set loop laid out as the real blob lays out its slots', () => {
    expect(decodeLoops(Buffer.from(REAL_SHAPED_LOOPS, 'hex'))?.loops[0]).toMatchObject({
      label: 'Break',
      start: 8 * 44100,
      end: 10 * 44100,
      startSet: true,
      endSet: true,
      argb: 0xff00cc00,
    })
  })

  // Engine reads these blobs back with no checksum and no tolerance: a flag, a label byte or
  // the padding after the grid moved by the rewrite is a library Engine may refuse or misread.
  // Only the positions and the rate may change, and every one of them must.
  it('changes only the positions and the rate, byte for byte everywhere else', () => {
    const before = {
      trackData: Buffer.from(REAL_TRACK_DATA, 'hex'),
      overviewWaveFormData: null,
      beatData: Buffer.from(REAL_BEAT_DATA, 'hex'),
      quickCues: Buffer.from(REAL_QUICK_CUES, 'hex'),
      loops: Buffer.from(REAL_SHAPED_LOOPS, 'hex'),
    }
    const after = shiftEnginePerformance(before, { trimmedMs: 1900, sampleRateHz: 48000 })
    for (const blob of ['trackData', 'beatData', 'quickCues', 'loops'] as const) {
      const raw = (b: Uint8Array | null) =>
        blob === 'loops' ? Buffer.from(b ?? []) : inflateEngineBlob(b ?? new Uint8Array(5))
      const was = raw(before[blob])
      const now = raw(after[blob])
      const ranges = positionRanges(blob, was)
      expect(now.length, blob).toBe(was.length)
      expect(masked(now, ranges).equals(masked(was, ranges)), blob).toBe(true)
      const moved = ranges.filter(([s, e]) => !now.subarray(s, e).equals(was.subarray(s, e)))
      const unset = ranges.filter(([s, e]) => was.subarray(s, e).toString('hex') === UNSET[blob])
      expect(moved.length + unset.length, blob).toBe(ranges.length)
    }
  })
})
