import { describe, expect, it } from 'vitest'
import { markersFromArmored, markersFromGeob } from './seratoMarkers'
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
