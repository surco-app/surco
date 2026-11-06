import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTracklist } from './tracklistParse'

const SETS = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'docs',
  'superpowers',
  'specs',
  '2026-11-06-pegar-tracklist',
)
const set = (name: string): string => readFileSync(join(SETS, name), 'utf8')

const one = (text: string) => {
  const parsed = parseTracklist(text)
  expect(parsed.lines).toHaveLength(1)
  return parsed.lines[0]
}

describe('parseTracklist', () => {
  it('reads time, artist and title from a tracklist line', () => {
    expect(one('  - 00:00 Rave Allstars - Bitte Anschnallen (Charter Mix)')).toEqual({
      at: '00:00',
      artist: 'Rave Allstars',
      title: 'Bitte Anschnallen (Charter Mix)',
      suggested: false,
      raw: 'Rave Allstars - Bitte Anschnallen (Charter Mix)',
    })
  })

  it('keeps an hour-long time as written', () => {
    expect(one("  - 1:05:36 Javi Pirata's & Domene DJ - On My Own (Extended Mix)").at).toBe(
      '1:05:36',
    )
  })

  it('counts an unidentified stretch as a gap, not a line', () => {
    const parsed = parseTracklist('  - 02:24 ????? (unidentified, until 04:09)')
    expect(parsed.lines).toEqual([])
    expect(parsed.gaps).toBe(1)
  })

  it('marks a line ending in (?) as suggested and drops the mark from the title', () => {
    const line = one('  - 04:09 DJ Blyatman - Kamaz (feat. dlb) (?)')
    expect(line.suggested).toBe(true)
    expect(line.title).toBe('Kamaz (feat. dlb)')
    expect(line.raw).toBe('DJ Blyatman - Kamaz (feat. dlb)')
  })

  it('accepts an en dash between artist and title', () => {
    expect(one('  - 1:13:45 Nick Kamen – I Promised Myself').artist).toBe('Nick Kamen')
  })

  it('reads a line without a time and folds a second dash into the mix', () => {
    const line = one('Absolom - Secret - Extended Vocal Mix')
    expect(line.at).toBeNull()
    expect(line.title).toBe('Secret (Extended Vocal Mix)')
  })

  it('keeps a timed line without a separator as a title alone', () => {
    expect(one('  - 57:36 Dancer (Spacio Mix)')).toMatchObject({
      artist: '',
      title: 'Dancer (Spacio Mix)',
    })
    expect(one('  - 1:15:00 P.I.K')).toMatchObject({ artist: '', title: 'P.I.K' })
  })

  it('ignores a URL, a summary line and a header, and does not count blank lines', () => {
    const parsed = parseTracklist(
      [
        'https://www.youtube.com/watch?v=3TIb5Yin3Fw',
        '',
        '18 identified, 1 suggested, 2 gaps (13:19 unidentified of 1:10:17)',
        'DJ Sagy & DJ Vicent — XTV Remember | Sesión Remember 90s y 2000s',
      ].join('\n'),
    )
    expect(parsed.lines).toEqual([])
    expect(parsed.ignored).toBe(3)
  })

  it('reads the whole XTV set', () => {
    const parsed = parseTracklist(set('set3-xtv-remember.txt'))
    expect(parsed.lines).toHaveLength(31)
    expect(parsed.gaps).toBe(0)
  })

  it('reads the whole YouTube set with its two gaps', () => {
    const parsed = parseTracklist(set('set1-youtube.txt'))
    expect(parsed.lines).toHaveLength(19)
    expect(parsed.gaps).toBe(2)
  })
})
