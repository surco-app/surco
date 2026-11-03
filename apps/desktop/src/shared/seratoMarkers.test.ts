import { describe, expect, it } from 'vitest'
import {
  markersFromArmored,
  markersFromGeob,
  readSeratoTempoMap,
  readSeratoTempoMapArmored,
  seratoArmored,
  seratoGeobBody,
  seratoPayloadOf,
  withSeratoCues,
} from './seratoMarkers'
import {
  SERATO_AIFF as AIFF,
  SERATO_FLAC as FLAC,
  SERATO_M4A as M4A,
  SERATO_MP3 as MP3,
  SERATO_WAV as WAV,
} from './seratoMarkersFixture'

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const geobOf = (text: string) => Uint8Array.from(`\x01\x01${text}`, (c) => c.charCodeAt(0))
const positions = (m: ReturnType<typeof markersFromGeob>) => m?.cues.map((c) => c.ms)
const colors = (m: ReturnType<typeof markersFromGeob>) => m?.cues.map((c) => c.color)

describe('markersFromGeob', () => {
  it('reads every hot cue and loop Serato saved in an MP3, so the editor shows what the DJ set', () => {
    expect(markersFromGeob(bytes(MP3))).toEqual({
      cues: [
        { index: 0, ms: 57606, color: 0xcc0000, name: 'A' },
        { index: 1, ms: 71553, color: 0xcc8800, name: '' },
        { index: 2, ms: 77329, color: 0x0000cc, name: '' },
        { index: 3, ms: 82467, color: 0xcccc00, name: '' },
        { index: 4, ms: 88003, color: 0x00cc00, name: '' },
        { index: 5, ms: 93439, color: 0xcc00cc, name: '' },
        { index: 6, ms: 102387, color: 0x00cccc, name: '' },
        { index: 7, ms: 109558, color: 0x8800cc, name: '' },
      ],
      loops: [
        { index: 0, startMs: 57612, endMs: 71941, name: '' },
        { index: 1, startMs: 64777, endMs: 79105, name: '' },
      ],
    })
  })

  it('reads the same tag from the ID3 chunk of an AIFF and a WAV', () => {
    const aiff = markersFromGeob(bytes(AIFF))
    const wav = markersFromGeob(bytes(WAV))
    expect(positions(aiff)).toEqual([45012, 49974, 54874])
    expect(positions(wav)).toEqual([3834, 9192, 16367])
    expect(colors(aiff)).toEqual([0xcc0000, 0xcc8800, 0x0000cc])
    expect(colors(wav)).toEqual([0xcc0000, 0xcc8800, 0x0000cc])
    expect(wav?.loops).toEqual([])
  })

  it('returns null for data that is not a Markers2 tag instead of throwing', () => {
    expect(markersFromGeob(new Uint8Array())).toBeNull()
    expect(markersFromGeob(Uint8Array.from([1, 1]))).toBeNull()
    expect(markersFromGeob(Uint8Array.from([0xff, 0x00, 0x12, 0x34, 0x56]))).toBeNull()
    expect(markersFromGeob(geobOf('%%%%not base64%%%%'))).toBeNull()
  })

  it('keeps the cues read before a cut, so a damaged tag still shows what survived', () => {
    const text = atob(MP3).slice(2).split('\0')[0].replace(/\n/g, '')
    const cut = markersFromGeob(geobOf(text.slice(0, 150)))
    expect(cut?.cues.length).toBeGreaterThan(0)
    expect(cut?.cues.length).toBeLessThan(8)
    expect(cut?.cues[0]).toEqual({ index: 0, ms: 57606, color: 0xcc0000, name: 'A' })
    for (let n = 0; n < text.length; n++)
      expect(() => markersFromGeob(geobOf(text.slice(0, n)))).not.toThrow()
  })
})

describe('markersFromArmored', () => {
  it('reads the cues from the FLAC Vorbis comment and the M4A freeform atom', () => {
    const flac = markersFromArmored(FLAC)
    const m4a = markersFromArmored(M4A)
    expect(positions(flac)).toEqual([3838, 9204, 14567])
    expect(positions(m4a)).toEqual([7444, 12756, 19019])
    expect(colors(flac)).toEqual([0xcc0000, 0xcc8800, 0x0000cc])
    expect(colors(m4a)).toEqual([0xcc0000, 0xcc8800, 0x0000cc])
  })

  it('returns null for a value that is not an armored Markers2 tag', () => {
    expect(markersFromArmored('')).toBeNull()
    expect(markersFromArmored('not base64 at all ***')).toBeNull()
    expect(
      markersFromArmored(btoa('application/octet-stream\0\0Serato Markers\0\x01\x01AQE=')),
    ).toBeNull()
  })

  it('does not throw on a truncated value', () => {
    for (let n = 0; n < FLAC.length; n += 7)
      expect(() => markersFromArmored(FLAC.slice(0, n))).not.toThrow()
  })
})

const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16))
const PRAY_MP3_TEMPO = hex(
  '02000001404689a229cf79f60000000100000000000000004060bfefabfa4db03fd0000000000000010000000000000000',
)
const PRAY_AIFF_TEMPO = hex(
  '0200000140468314ec81fdea0000000100000000000000004060bfefe42a9f173fd0000000000000010000000000000000',
)
const ascii = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0))
const entry = (name: string, body: number[]) =>
  Uint8Array.from([...ascii(`${name}\0`), 0, 0, 0, body.length, ...body])
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]))
const entriesOf = (payload: Uint8Array) => {
  const out: { name: string; body: Uint8Array }[] = []
  let at = 2
  while (at < payload.length) {
    const end = payload.indexOf(0, at)
    if (end === at || end === -1) break
    const len = new DataView(payload.buffer, payload.byteOffset).getUint32(end + 1)
    out.push({
      name: String.fromCharCode(...payload.subarray(at, end)),
      body: payload.subarray(end + 5, end + 5 + len),
    })
    at = end + 5 + len
  }
  return out
}
const cue = (index: number, ms: number, color: number, name = '') => ({ index, ms, color, name })

describe('seratoPayloadOf', () => {
  it('returns the raw payload from a GEOB body and from an armored value', () => {
    const fromGeob = seratoPayloadOf(bytes(MP3))
    const fromArmored = seratoPayloadOf(FLAC)
    expect(fromGeob?.slice(0, 2)).toEqual(Uint8Array.from([1, 1]))
    expect(entriesOf(fromGeob as Uint8Array).map((e) => e.name)).toContain('CUE')
    expect(entriesOf(fromArmored as Uint8Array).map((e) => e.name)).toContain('CUE')
  })

  it('returns null when the data is not a Markers2 tag', () => {
    expect(seratoPayloadOf(new Uint8Array())).toBeNull()
    expect(seratoPayloadOf('not base64 at all ***')).toBeNull()
  })
})

describe('withSeratoCues', () => {
  const cues = [
    cue(0, 1234, 0xcc0000, 'Intro'),
    cue(1, 90000, 0x00cc00),
    cue(2, 4000000000, 0x0000cc, 'Ñandú'),
  ]

  it('round-trips the cues through the GEOB body Serato reads', () => {
    const payload = seratoPayloadOf(bytes(MP3))
    const back = markersFromGeob(seratoGeobBody(withSeratoCues(payload, cues)))
    expect(back?.cues).toEqual(cues)
    expect(back?.loops).toEqual(markersFromGeob(bytes(MP3))?.loops)
  })

  it('keeps every entry that is not a cue byte for byte and in order, so Serato data we do not understand survives', () => {
    const odd = [
      entry('FLIP', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      entry('BPMLOCK', [1]),
      entry(
        'LOOP',
        [
          0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0x6e, 0x61, 0x6d,
          0x65, 0,
        ],
      ),
    ]
    const payload = concat(
      Uint8Array.from([1, 1]),
      entry('COLOR', [0, 1, 2, 3]),
      entry('CUE', [0, 0, 0, 0, 0, 5, 0, 9, 9, 9, 0, 0, 0]),
      odd[0],
      entry('CUE', [0, 1, 0, 0, 0, 6, 0, 9, 9, 9, 0, 0, 0]),
      odd[2],
      odd[1],
      Uint8Array.from([0]),
    )
    const result = withSeratoCues(payload, [cue(3, 10, 0xff0000)])
    const kept = entriesOf(result).filter((e) => e.name !== 'CUE')
    const original = entriesOf(payload).filter((e) => e.name !== 'CUE')
    expect(kept).toEqual(original)
    expect(entriesOf(result).filter((e) => e.name === 'CUE')).toHaveLength(1)
    expect(result[result.length - 1]).toBe(0)
  })

  it('removes all cues when given none', () => {
    const result = withSeratoCues(seratoPayloadOf(bytes(MP3)), [])
    expect(entriesOf(result).some((e) => e.name === 'CUE')).toBe(false)
    expect(entriesOf(result).some((e) => e.name === 'LOOP')).toBe(true)
  })

  it('builds a fresh payload with a white COLOR, the cues and an unlocked BPMLOCK when the file had none', () => {
    const result = withSeratoCues(null, [cue(0, 500, 0xcc0000, 'A')])
    expect(entriesOf(result).map((e) => e.name)).toEqual(['COLOR', 'CUE', 'BPMLOCK'])
    expect(entriesOf(result)[0].body).toEqual(Uint8Array.from([0, 255, 255, 255]))
    expect(entriesOf(result)[2].body).toEqual(Uint8Array.from([0]))
    expect(result).toHaveLength(51)
    expect(Array.from(entriesOf(result)[1].body)).toEqual([
      0, 0, 0, 0, 1, 244, 0, 204, 0, 0, 0, 0, 65, 0,
    ])
    expect(result[result.length - 1]).toBe(0)
  })
})

describe('seratoGeobBody', () => {
  it('pads to at least 470 bytes with NUL and wraps the base64 in lines of 72', () => {
    const body = seratoGeobBody(
      withSeratoCues(null, [cue(0, 500, 0xcc0000), cue(1, 900, 0x00cc00), cue(2, 1300, 0x0000cc)]),
    )
    expect(body.length).toBeGreaterThanOrEqual(470)
    expect(body.slice(0, 2)).toEqual(Uint8Array.from([1, 1]))
    const text = String.fromCharCode(...body.subarray(2)).split('\0')[0]
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(72)
    expect(text.split('\n').length).toBeGreaterThan(1)
    expect(String.fromCharCode(...body.subarray(2 + text.length))).toMatch(/^\0+$/)
  })

  it('grows past 470 when the payload needs it', () => {
    const many = Array.from({ length: 40 }, (_, i) => cue(i, i * 1000, 0xcc0000, 'name'))
    const body = seratoGeobBody(withSeratoCues(null, many))
    expect(body.length).toBeGreaterThan(470)
    expect(markersFromGeob(body)?.cues).toHaveLength(40)
  })
})

describe('byte-for-byte parity with what Serato wrote', () => {
  const geobFixtures = { MP3, AIFF, WAV }
  const armoredFixtures = { FLAC, M4A }

  for (const [name, fixture] of Object.entries(geobFixtures))
    it(`re-encodes the ${name} GEOB body exactly, with its padding and wrapping`, () => {
      const original = bytes(fixture)
      const payload = seratoPayloadOf(original) as Uint8Array
      expect(seratoGeobBody(payload)).toEqual(original)
      const cues = markersFromGeob(original)?.cues ?? []
      expect(withSeratoCues(payload, cues)).toEqual(payload)
    })

  for (const [name, fixture] of Object.entries(armoredFixtures))
    it(`re-encodes the ${name} armored value exactly`, () => {
      const payload = seratoPayloadOf(fixture) as Uint8Array
      expect(seratoArmored(payload)).toBe(fixture)
      const cues = markersFromArmored(fixture)?.cues ?? []
      expect(withSeratoCues(payload, cues)).toEqual(payload)
    })

  it('ends a fresh payload on the BPMLOCK body, like the payloads Serato wrote', () => {
    const fixturePayload = seratoPayloadOf(bytes(AIFF)) as Uint8Array
    const fresh = withSeratoCues(null, [])
    expect(Array.from(fresh.slice(-6))).toEqual(Array.from(fixturePayload.slice(-6)))
  })
})

describe('seratoArmored', () => {
  it('produces the FLAC and M4A value that markersFromArmored reads back, wrapped at 72 characters', () => {
    const cues = [cue(0, 1234, 0xcc0000, 'A'), cue(1, 5678, 0x00cc00)]
    const value = seratoArmored(withSeratoCues(null, cues))
    expect(markersFromArmored(value)?.cues).toEqual(cues)
    for (const line of value.split('\n')) expect(line.length).toBeLessThanOrEqual(72)
  })
})

describe('readSeratoTempoMap', () => {
  it('reads the first beat and the BPM from a one-marker grid', () => {
    const mp3 = readSeratoTempoMap(PRAY_MP3_TEMPO)
    expect(mp3?.firstBeatMs).toBeCloseTo(45075.26, 1)
    expect(mp3?.bpm).toBeCloseTo(133.998, 3)
    expect(readSeratoTempoMap(PRAY_AIFF_TEMPO)?.firstBeatMs).toBeCloseTo(45024.08, 1)
  })

  it('returns null for a grid with several markers because a constant tempo cannot describe it', () => {
    const two = Uint8Array.from(PRAY_MP3_TEMPO)
    two[3] = 2
    expect(readSeratoTempoMap(two)).toBeNull()
  })

  it('returns null when the position or the BPM is not a usable number', () => {
    const withF64 = (at: number, value: number) => {
      const data = Uint8Array.from(PRAY_MP3_TEMPO)
      new DataView(data.buffer).setFloat64(at, value)
      return data
    }
    expect(readSeratoTempoMap(withF64(24, 0))).toBeNull()
    expect(readSeratoTempoMap(withF64(24, -120))).toBeNull()
    expect(readSeratoTempoMap(withF64(24, Number.NaN))).toBeNull()
    expect(readSeratoTempoMap(withF64(24, Number.POSITIVE_INFINITY))).toBeNull()
    expect(readSeratoTempoMap(withF64(4, Number.NaN))).toBeNull()
    expect(readSeratoTempoMap(withF64(4, Number.POSITIVE_INFINITY))).toBeNull()
  })

  it('returns null for data that is not a tempo map', () => {
    expect(readSeratoTempoMap(new Uint8Array())).toBeNull()
    expect(readSeratoTempoMap(PRAY_MP3_TEMPO.subarray(0, 20))).toBeNull()
    expect(
      readSeratoTempoMap(Uint8Array.from([1, 0, 0, 1, ...PRAY_MP3_TEMPO.subarray(4)])),
    ).toBeNull()
  })
})

describe('readSeratoTempoMapArmored', () => {
  it('reads the tempo map from the FLAC and M4A form', () => {
    const raw = concat(ascii('application/octet-stream\0\0Serato Tempo Map\0'), PRAY_MP3_TEMPO)
    const value = btoa(String.fromCharCode(...raw))
    expect(readSeratoTempoMapArmored(value)?.bpm).toBeCloseTo(133.998, 3)
    expect(readSeratoTempoMapArmored(FLAC)).toBeNull()
    expect(readSeratoTempoMapArmored('')).toBeNull()
  })
})
