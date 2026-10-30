// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { PlaceCheck } from '../../../shared/verification'
import i18n from '../i18n'
import { VerifiedPopover } from './VerifiedPopover'

afterEach(cleanup)
beforeAll(() => i18n.changeLanguage('es'))
afterAll(() => i18n.changeLanguage('en'))

const fileOk: PlaceCheck = {
  place: 'file',
  state: 'ok',
  detail: { key: 'fileIdentical', params: { format: 'WAV' } },
}
const rekordboxOk: PlaceCheck = {
  place: 'rekordbox',
  state: 'ok',
  detail: { key: 'rekordboxOk', params: { format: 'WAV', cues: 13 } },
}
const rekordboxPending: PlaceCheck = {
  place: 'rekordbox',
  state: 'pending',
  detail: { key: 'pending', params: { program: 'rekordbox' } },
}

function open(checks: PlaceCheck[]): HTMLElement[] {
  render(<VerifiedPopover checks={checks} />)
  fireEvent.click(screen.getByTestId('verify-shield'))
  return within(screen.getByTestId('verify-popover')).getAllByTestId('verify-line')
}

describe('VerifiedPopover', () => {
  // Only what Surco touched is worth a line: a Music row for a track that never went to
  // Music would read as a check that passed on something that was never written.
  it('the popover lists one verify-line per touched place, in place order', () => {
    const lines = open([rekordboxOk, fileOk])
    expect(lines.map((l) => l.dataset.place)).toEqual(['file', 'rekordbox'])
    expect(lines[0]).toHaveTextContent('Fichero')
    expect(lines[0]).toHaveTextContent('WAV · audio idéntico al original')
    expect(lines[1]).toHaveTextContent('rekordbox')
    expect(lines[1]).toHaveTextContent('Apunta al WAV · 13 cues')
  })

  // An icon-only button is announced by its name or not at all.
  it('the shield button has an accessible name', () => {
    render(<VerifiedPopover checks={[fileOk]} />)
    expect(screen.getByTestId('verify-shield')).toHaveAccessibleName(i18n.t('verify.shieldLabel'))
  })

  // A queued write is not a failure and not a pass: the DJ has to know it lands only once
  // the program closes, so the line says when, behind a clock instead of a check mark.
  it('the popover marks the pending place with the clock and its text', () => {
    const [file, rekordbox] = open([fileOk, rekordboxPending])
    expect(within(rekordbox).getByTestId('verify-line-pending')).toBeInTheDocument()
    expect(rekordbox).toHaveTextContent('Pendiente, se aplica al cerrar rekordbox')
    expect(within(file).queryByTestId('verify-line-pending')).toBeNull()
    expect(file).toHaveTextContent('WAV · audio idéntico al original')
  })

  // Playlists are names the DJ chose; they read as a list in the UI language, not as an
  // array dump.
  it('names the Music playlists as a list in the UI language', () => {
    const [music] = open([
      {
        place: 'appleMusic',
        state: 'ok',
        detail: { key: 'musicOne', params: { playlists: ['24', 'All', 'Warm up'] } },
      },
    ])
    expect(music).toHaveTextContent('Una sola entrada · en 24, All y Warm up')
  })

  it('says only the single entry when the track is in no playlist', () => {
    const [music] = open([
      { place: 'appleMusic', state: 'ok', detail: { key: 'musicOneNoPlaylists' } },
    ])
    expect(music).toHaveTextContent('Una sola entrada')
    expect(music).not.toHaveTextContent(' en ')
  })

  // A re-encode cannot promise identical samples, so it says what it does promise: the
  // planned rate and depth, and that it decodes whole. The rate in the language's mark.
  it('reads a re-encoded file with its rate and depth', () => {
    const [file] = open([
      {
        place: 'file',
        state: 'ok',
        detail: { key: 'fileReencoded', params: { format: 'FLAC', rate: 44100, bits: 24 } },
      },
    ])
    expect(file).toHaveTextContent('FLAC · 44,1 kHz · 24 bits · decodifica entero')
  })

  // MP3 has no bit depth; "0 bits" would be a claim about nothing.
  it('leaves the depth out of a lossy file', () => {
    const [file] = open([
      {
        place: 'file',
        state: 'ok',
        detail: { key: 'fileReencoded', params: { format: 'MP3', rate: 44100, bits: 0 } },
      },
    ])
    expect(file).toHaveTextContent('MP3 · 44,1 kHz · decodifica entero')
    expect(file).not.toHaveTextContent('bits')
  })

  // The editor can be 460 px wide: the result is what the DJ opened this for, so it wraps
  // rather than ending in an ellipsis.
  it('never cuts a line short at the narrowest editor', () => {
    const lines = open([fileOk, rekordboxPending])
    for (const line of lines) {
      for (const el of [line, ...line.querySelectorAll('*')]) {
        expect(el.getAttribute('class') ?? '').not.toMatch(/\btruncate\b|line-clamp|text-ellipsis/)
      }
    }
    expect(screen.getByTestId('verify-popover').className).toMatch(/max-w-\[calc\(100vw/)
  })

  // The footer's amber line names one place; here every place shows, the ones that did
  // not add up marked in amber instead of the check mark that would vouch for them.
  it('marks each place that does not add up and still lists the rest', () => {
    const [file, rekordbox, engine] = open([
      fileOk,
      {
        place: 'rekordbox',
        state: 'mismatch',
        detail: { key: 'rekordboxStillOld', params: { format: 'AIFF' } },
      },
      { place: 'engine', state: 'unreadable', detail: { key: 'engineUnreadable' } },
    ])
    expect(within(file).queryByTestId('verify-line-mismatch')).toBeNull()
    expect(within(rekordbox).getByTestId('verify-line-mismatch')).toBeInTheDocument()
    expect(rekordbox).toHaveTextContent('rekordbox sigue en el AIFF')
    expect(within(engine).getByTestId('verify-line-mismatch')).toBeInTheDocument()
    expect(engine).toHaveTextContent('No se pudo comprobar Engine DJ')
  })

  // A tag that did not stick is named the way the form names the field.
  it('names a tag that differs by its field label', () => {
    const [file] = open([
      {
        place: 'file',
        state: 'mismatch',
        detail: { key: 'fileTagDiffers', params: { field: 'albumArtist' } },
      },
    ])
    expect(file).toHaveTextContent(`${i18n.t('fields.albumArtist')} distinto en el fichero`)
  })

  // Focus moves in on open, so a keyboard user's Escape lands on the popover that
  // handles it, and closing hands it back.
  it('closes with Escape and hands focus back to the shield', () => {
    open([fileOk])
    expect(screen.getByTestId('verify-popover')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('verify-popover'), { key: 'Escape' })
    expect(screen.queryByTestId('verify-popover')).toBeNull()
    expect(screen.getByTestId('verify-shield')).toHaveFocus()
  })
})
