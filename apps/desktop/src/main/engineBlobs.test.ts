import { describe, expect, it } from 'vitest'
import {
  decodeBeatGrid,
  decodeOverview,
  decodeQuickCues,
  decodeTrackData,
  deflateEngineBlob,
  encodeQuickCues,
  inflateEngineBlob,
  quickCueSlotBytes,
} from './engineBlobs'

const REAL_TRACK_DATA =
  '00000044789C7378DAD1C000030F2540A4A8FD439FD8054086FD5DD7F52049FB933296090CB80100CE5E09F2'
const REAL_BEAT_DATA =
  '0000008A789C7378DAD1C000048E39CA1F403423030430818886F5AF0FFCF90F0102CC0C30D050A19EE3C883E033702298E4EA636000003F501D7F'
const REAL_QUICK_CUES =
  '0000008B789C636000030E56E7D254054347A77D5740DCFF5F2E5B80458C1C93EAAC1A4022EF1B0D18F67F6040004A393093191D2E958205000B8019FA'

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
})
