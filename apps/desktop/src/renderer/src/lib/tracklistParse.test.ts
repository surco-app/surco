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

  it('drops the dash YouTube descriptions put after the time', () => {
    expect(one('00:00 - Rave Allstars - Bitte Anschnallen')).toMatchObject({
      at: '00:00',
      artist: 'Rave Allstars',
      raw: 'Rave Allstars - Bitte Anschnallen',
    })
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

describe('parseTracklist on a hand-written YouTube description', () => {
  it('ignores untimed lines once the paste has timed ones, so the video title is not a track', () => {
    const parsed = parseTracklist(
      'Ismael Lora - Sesión en directo #QuédateEnCasa 4.0\n- 00:00 Tukan - Light a rainbow',
    )
    expect(parsed.lines.map((l) => l.artist)).toEqual(['Tukan'])
    expect(parsed.ignored).toBe(1)
  })

  it('reads a timed line in lowercase without separator as a gap, the way the DJ marks an unknown', () => {
    const parsed = parseTracklist(
      '- 28:25 base?\n- 44:20 cantadita?\n- 1:18:40 base la tengo\n- 47:15 ',
    )
    expect(parsed.lines).toEqual([])
    expect(parsed.gaps).toBe(4)
  })

  it('keeps a title-only line that is written like a title', () => {
    expect(one('- 13:55 E.X.E.L Wonderland').title).toBe('E.X.E.L Wonderland')
    expect(one('- 09:00 The day will come').title).toBe('The day will come')
  })

  it('drops the notes the DJ writes after the track', () => {
    expect(one('- 1:36:40 Sunniva - Feelings =< PAra la fiesta?').title).toBe('Feelings')
    expect(one('- 1:11:00 DJ Frank – The Inside <<== FIESTA FIJO').title).toBe('The Inside')
    expect(one("- 1:15:30 Di Carlo - Damn (I'm Fucking Mix)  <== FIESTA FIJO").title).toBe(
      "Damn (I'm Fucking Mix)",
    )
    expect(one('- 2:05:24 Dj Marta - Stranger in My House CANTADO BRUTAL').title).toBe(
      'Stranger in My House',
    )
    expect(one('- 50:29 Mindwalkers – The Future DESCARGAR + COMPRAR').title).toBe('The Future')
    expect(one('- 40:45 Luis Junior - Right (You Understand) DESCARGAR').title).toBe(
      'Right (You Understand)',
    )
    expect(
      one(
        '- 29:20 Justin Bourne - My House (Paul Glazby Remix) - https://www.toolboxdigitalshop.com/x',
      ).title,
    ).toBe('My House (Paul Glazby Remix)')
  })

  it('keeps an all-caps title whole', () => {
    expect(one('- 59:10 SILENZI - EMPTY HOUSES').title).toBe('EMPTY HOUSES')
  })

  it('splits on a dash glued to the artist when the line has no spaced one', () => {
    expect(one('- 1:02:43 Kadoc- The Nighttrain (Original)')).toMatchObject({
      artist: 'Kadoc',
      title: 'The Nighttrain (Original)',
    })
    expect(one('- 47:55 Itty Bitty, DJ BoozyWoozy- Tempo Fiesta (Roll Fiesta Mix)').artist).toBe(
      'Itty Bitty, DJ BoozyWoozy',
    )
    expect(one('- 1:01:22 DJ Temple - Pinkert-on').title).toBe('Pinkert-on')
  })
})
