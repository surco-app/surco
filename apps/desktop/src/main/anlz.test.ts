import { describe, expect, it } from 'vitest'
import { anlzSections, beatGrid, colorWave, maskVocals, phrases, wavePreview } from './anlz'
import { anlzFile, pqtzSection, pssiSection, pwv5Section, section, u32 } from './anlzFixture'

const ppth = section('PPTH', u32(4), Buffer.from('?/a\0', 'latin1'))

describe('anlzSections', () => {
  it('walks the sections after the PMAI header', () => {
    const f = anlzFile(ppth, pqtzSection([50], 154))
    expect(anlzSections(f).map((s) => s.tag)).toEqual(['PPTH', 'PQTZ'])
  })

  // A truncated file (rekordbox mid-write, a copy cut short) must not throw or loop.
  it('stops at a section that runs past the end', () => {
    const f = anlzFile(ppth, pqtzSection([50], 154))
    expect(anlzSections(f.subarray(0, f.length - 3)).map((s) => s.tag)).toEqual(['PPTH'])
    expect(anlzSections(Buffer.from('nope'))).toEqual([])
  })
})

describe('beatGrid', () => {
  // The XML's TEMPO lines come from this: a tempo change at 50 s (Hands Of Fate) must
  // survive, or the grid drifts off the beats after it.
  it('reads every beat with its tempo and time', () => {
    const f = anlzFile(ppth, pqtzSection([50, 440, 830], [154, 154, 150]))
    expect(beatGrid(f)).toEqual([
      { beat: 1, bpm: 154, ms: 50 },
      { beat: 2, bpm: 154, ms: 440 },
      { beat: 3, bpm: 150, ms: 830 },
    ])
  })

  it('has no grid without a PQTZ', () => {
    expect(beatGrid(anlzFile(ppth))).toEqual([])
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
    const bars = wavePreview(anlzFile(ppth, pwav(heights)))
    expect(bars).toHaveLength(100)
    expect(bars?.[1]).toBe(1)
    expect(bars?.[0]).toBe(0)
  })

  it('answers null without a preview, so the row draws a flat bar', () => {
    expect(wavePreview(anlzFile(ppth))).toBeNull()
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
    const out = maskVocals(anlzFile(ppth, plain))
    expect(anlzSections(out).map((s) => s.tag)).toEqual(['PPTH', 'PVDI'])
    const s = anlzSections(out)[1]
    expect(out.subarray(s.start, s.start + s.length)).toEqual(masked)
  })

  // A staged copy masked twice would come out plain again: XOR undoes itself.
  it('leaves an already masked section alone', () => {
    const once = maskVocals(anlzFile(ppth, plain))
    expect(maskVocals(once)).toEqual(once)
  })

  // rekordbox writes an empty 24-byte PVDI for a track without vocal data, last in the file,
  // and the file's total length has to grow with it.
  it('appends the empty section when there is none', () => {
    const before = anlzFile(ppth)
    const out = maskVocals(before)
    expect(out.subarray(before.length).toString('hex')).toBe(
      '505644490000001800000018000004005622000100000000',
    )
    expect(out.readUInt32BE(8)).toBe(before.length + 24)
  })

  it('never changes the buffer it was given', () => {
    const input = anlzFile(ppth, plain)
    const copy = Buffer.from(input)
    maskVocals(input)
    expect(input).toEqual(copy)
  })
})

describe('phrases', () => {
  const PHRASES = [
    { beat: 1, kind: 1 },
    { beat: 33, kind: 5 },
    { beat: 65, kind: 3 },
  ]

  it('reads mood and phrases from a local analysis, which rekordbox leaves in the clear', () => {
    expect(phrases(anlzFile(pssiSection(1, PHRASES)))).toEqual({
      mood: 1,
      masked: false,
      entries: PHRASES,
    })
  })

  it('unmasks a masked section so the strong parts do not depend on where it came from', () => {
    expect(phrases(anlzFile(pssiSection(2, PHRASES, true)))).toEqual({
      mood: 2,
      masked: true,
      entries: PHRASES,
    })
  })

  it('is null without a PSSI', () => {
    expect(phrases(anlzFile())).toBeNull()
  })

  it('is null for a mood rekordbox does not define, so no strong part is guessed', () => {
    expect(phrases(anlzFile(pssiSection(7, PHRASES)))).toBeNull()
    expect(phrases(anlzFile(pssiSection(7, PHRASES, true)))).toBeNull()
  })
})

describe('colorWave', () => {
  it('keeps the tallest entry of each column with its colour, as the CDJ draws it', () => {
    const wave = colorWave(
      anlzFile(
        pwv5Section([
          { r: 7, g: 0, b: 0, h: 31 },
          { r: 0, g: 7, b: 0, h: 10 },
          { r: 0, g: 0, b: 7, h: 0 },
          { r: 0, g: 0, b: 7, h: 16 },
        ]),
      ),
      2,
    )
    expect(wave).toEqual([
      { h: 1, rgb: [255, 0, 0] },
      { h: 16 / 31, rgb: [0, 0, 255] },
    ])
  })

  it('is null without a PWV5', () => {
    expect(colorWave(anlzFile())).toBeNull()
  })
})
