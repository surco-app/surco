import { describe, expect, it } from 'vitest'
import { anlzSections, beatGrid, maskVocals, wavePreview } from './anlz'

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

// A section as rekordbox lays it out: tag, header length, total length, then the rest of
// the header and the body.
function section(tag: string, headerRest: Buffer, body: Buffer): Buffer {
  const header = 12 + headerRest.length
  return Buffer.concat([
    Buffer.from(tag, 'latin1'),
    u32(header),
    u32(header + body.length),
    headerRest,
    body,
  ])
}

function file(...sections: Buffer[]): Buffer {
  const head = Buffer.concat([
    Buffer.from('PMAI'),
    u32(28),
    u32(0),
    Buffer.from('00000001000100000001000000000000', 'hex'),
  ])
  const out = Buffer.concat([head, ...sections])
  out.writeUInt32BE(out.length, 8)
  return out
}

const ppth = section('PPTH', u32(4), Buffer.from('?/a\0', 'latin1'))

function pqtz(beats: [number, number, number][]): Buffer {
  const body = Buffer.concat(
    beats.map(([beat, bpm100, ms]) => {
      const e = Buffer.alloc(8)
      e.writeUInt16BE(beat, 0)
      e.writeUInt16BE(bpm100, 2)
      e.writeUInt32BE(ms, 4)
      return e
    }),
  )
  return section('PQTZ', Buffer.concat([u32(0), u32(0x80000), u32(beats.length)]), body)
}

describe('anlzSections', () => {
  it('walks the sections after the PMAI header', () => {
    const f = file(ppth, pqtz([[1, 15400, 50]]))
    expect(anlzSections(f).map((s) => s.tag)).toEqual(['PPTH', 'PQTZ'])
  })

  // A truncated file (rekordbox mid-write, a copy cut short) must not throw or loop.
  it('stops at a section that runs past the end', () => {
    const f = file(ppth, pqtz([[1, 15400, 50]]))
    expect(anlzSections(f.subarray(0, f.length - 3)).map((s) => s.tag)).toEqual(['PPTH'])
    expect(anlzSections(Buffer.from('nope'))).toEqual([])
  })
})

describe('beatGrid', () => {
  // The XML's TEMPO lines come from this: a tempo change at 50 s (Hands Of Fate) must
  // survive, or the grid drifts off the beats after it.
  it('reads every beat with its tempo and time', () => {
    const f = file(
      ppth,
      pqtz([
        [1, 15400, 50],
        [2, 15400, 440],
        [3, 15000, 830],
      ]),
    )
    expect(beatGrid(f)).toEqual([
      { beat: 1, bpm: 154, ms: 50 },
      { beat: 2, bpm: 154, ms: 440 },
      { beat: 3, bpm: 150, ms: 830 },
    ])
  })

  it('has no grid without a PQTZ', () => {
    expect(beatGrid(file(ppth))).toEqual([])
  })
})

describe('wavePreview', () => {
  const pwav = (heights: number[]): Buffer =>
    section(
      'PWAV',
      Buffer.concat([u32(heights.length), u32(0x10000)]),
      Buffer.from(heights.map((h) => 0xa0 | h)),
    )

  // 400 columns become 100 bars by taking each group's highest, so a short peak still shows;
  // the top three bits are rekordbox's whiteness, not height.
  it('keeps the highest column of each group, scaled to 0..1', () => {
    const heights = Array.from({ length: 400 }, (_, i) => (i === 5 ? 31 : 0))
    const bars = wavePreview(file(ppth, pwav(heights)))
    expect(bars).toHaveLength(100)
    expect(bars?.[1]).toBe(1)
    expect(bars?.[0]).toBe(0)
  })

  it('answers null without a preview, so the row draws a flat bar', () => {
    expect(wavePreview(file(ppth))).toBeNull()
  })
})

describe('maskVocals', () => {
  // A real PVDI header (rekordbox 7.2.19, Hands Of Fate) shortened to 40 bytes of data, all
  // zero as that track's first bytes are: rekordbox's export sets 0x80 at byte 12 and the
  // data becomes the key itself.
  const plain = Buffer.concat([
    Buffer.from('505644490000001800000040000004005622000100000028', 'hex'),
    Buffer.alloc(40),
  ])
  const masked = Buffer.concat([
    Buffer.from('505644490000001800000040800004005622000100000028', 'hex'),
    Buffer.from(
      '1edd1e1902191b11192318192411fb111e2a151edd1e1902191b11192318192411fb111e2a151edd',
      'hex',
    ),
  ])

  it('masks the vocal section as rekordbox does when it exports', () => {
    const out = maskVocals(file(ppth, plain))
    expect(anlzSections(out).map((s) => s.tag)).toEqual(['PPTH', 'PVDI'])
    const s = anlzSections(out)[1]
    expect(out.subarray(s.start, s.start + s.length)).toEqual(masked)
  })

  // A staged copy masked twice would come out plain again: XOR undoes itself.
  it('leaves an already masked section alone', () => {
    const once = maskVocals(file(ppth, plain))
    expect(maskVocals(once)).toEqual(once)
  })

  // rekordbox writes an empty 24-byte PVDI for a track without vocal data, last in the file,
  // and the file's total length has to grow with it.
  it('appends the empty section when there is none', () => {
    const before = file(ppth)
    const out = maskVocals(before)
    expect(out.subarray(before.length).toString('hex')).toBe(
      '505644490000001800000018000004005622000100000000',
    )
    expect(out.readUInt32BE(8)).toBe(before.length + 24)
  })

  it('never changes the buffer it was given', () => {
    const input = file(ppth, plain)
    const copy = Buffer.from(input)
    maskVocals(input)
    expect(input).toEqual(copy)
  })
})
