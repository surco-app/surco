// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Api } from '../../../preload/api'
import type { TrackProperties } from '../../../shared/types'
import i18n from '../i18n'
import { stubApi } from '../test/api'
import { PropertiesReadout } from './PropertiesReadout'

beforeEach(() => {
  ;(window as unknown as { api: Api }).api = stubApi()
})

afterEach(cleanup)

const props: TrackProperties = {
  codec: 'flac',
  container: 'flac',
  sampleRateHz: 44100,
  bitDepth: 16,
  channels: 2,
  bitrateKbps: 812,
  sizeBytes: 40_000_000,
  createdMs: null,
  modifiedMs: null,
  tagFormats: ['Vorbis comment'],
}

describe('PropertiesReadout extension', () => {
  // The bug from the field: the panel derived the extension from the parsed file NAME,
  // which has already lost its ".flac" and carries a track-number dot ("20. Title").
  // Splitting that on '.' printed the title, uppercased, as the "extension". The row must
  // read the real container off the source path instead.
  it('shows the container from the path, not the dotted title', () => {
    render(
      <PropertiesReadout
        properties={{ ...props, codec: 'pcm_s16be', container: 'aiff' }}
        fileName="20. Dj Isaac - On The Edge (Original Mix)"
        inputPath="/music/bases buenas/20. Dj Isaac - On The Edge (Original Mix).aif"
        duration={413}
      />,
    )
    const ext = screen.getByTestId('property-extension')
    expect(ext).toHaveTextContent('AIF')
    expect(ext).not.toHaveTextContent(/ISAAC/i)
  })
})

describe('PropertiesReadout repeated facts', () => {
  // Kind already says FLAC and Channel mode already says Stereo, so a Codec "flac", an
  // Extension "FLAC" and a Channels "2" beside them only repeat what the panel just said.
  it('drops the rows that repeat the kind or the channel mode', () => {
    render(
      <PropertiesReadout properties={props} fileName="x" inputPath="/x/x.flac" duration={404} />,
    )
    expect(screen.getByTestId('property-kind')).toHaveTextContent('FLAC')
    expect(screen.getByTestId('property-channelMode')).toHaveTextContent('Stereo')
    expect(screen.queryByTestId('property-codec')).toBeNull()
    expect(screen.queryByTestId('property-extension')).toBeNull()
    expect(screen.queryByTestId('property-channels')).toBeNull()
  })

  // An .m4a can hold AAC or ALAC; there the codec is the one fact Kind cannot tell.
  it('keeps the codec when it tells something the kind does not', () => {
    render(
      <PropertiesReadout
        properties={{ ...props, codec: 'alac', container: 'm4a' }}
        fileName="x"
        inputPath="/x/x.m4a"
        duration={404}
      />,
    )
    expect(screen.getByTestId('property-codec')).toHaveTextContent('alac')
  })
})

describe('PropertiesReadout two-column grid', () => {
  // The long free-text rows (file name, folder) span both columns; a half-width cell would
  // clip them. The short fixed facts stay single-cell so they pack two-up.
  it('spans the wide rows and keeps the short facts in a single cell', () => {
    render(
      <PropertiesReadout
        properties={props}
        fileName="Blutonium Boy - Make It Loud (Original Mix)"
        inputPath="/music/bases buenas/x.flac"
        duration={404}
      />,
    )
    expect(screen.getByTestId('property-fileName').className).toContain('col-span-2')
    expect(screen.getByTestId('property-path').className).toContain('col-span-2')
    expect(screen.getByTestId('property-kind').className).not.toContain('col-span-2')
  })

  // With an odd number of short facts the last one stretches full-width, so the grid never
  // shows an empty half-cell next to it. Dropping only Bitrate leaves AUDIO's shorts at 5
  // (kind, sampleRate, bitDepth, channelMode, duration) — odd — so its last short
  // (Duration) stretches. A 6-short even group leaves none stretched.
  it('stretches the last short row when the shorts come out odd', () => {
    render(
      <PropertiesReadout
        properties={{ ...props, bitrateKbps: null }}
        fileName="x"
        inputPath="/x/x.flac"
        duration={404}
      />,
    )
    expect(screen.getByTestId('property-duration').className).toContain('col-span-2')
  })

  it('leaves every short row single-cell when the shorts come out even', () => {
    // Full props → AUDIO shorts = 6 (even), so none of them is stretched.
    render(
      <PropertiesReadout properties={props} fileName="x" inputPath="/x/x.flac" duration={404} />,
    )
    expect(screen.getByTestId('property-duration').className).not.toContain('col-span-2')
  })
})

describe('PropertiesReadout path', () => {
  it('names File Explorer on Windows, the place the click actually opens', () => {
    ;(window as unknown as { api: Api }).api = stubApi({ platform: 'win32' })
    render(
      <PropertiesReadout
        properties={props}
        fileName="Song"
        inputPath={'C:\\Music\\Song.flac'}
        duration={200}
      />,
    )
    expect(screen.getByTestId('property-reveal')).toHaveAccessibleName(
      'Show in File Explorer: Music',
    )
  })
})

describe('PropertiesReadout dates', () => {
  afterEach(() => void i18n.changeLanguage('en'))

  // The dates followed the OS locale instead of the app's language, so a Spanish UI on
  // an English macOS printed "Jan 25, 2026, 1:47 PM" amid Spanish labels.
  it('formats the file dates in the app language, not the system one', async () => {
    await i18n.changeLanguage('es')
    const ms = Date.UTC(2026, 0, 25, 13, 47)
    render(
      <PropertiesReadout
        properties={{ ...props, createdMs: ms }}
        fileName="Pray"
        inputPath="/music/Pray.wav"
        duration={428}
      />,
    )
    const spanish = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' })
    expect(screen.getByTestId('property-created')).toHaveTextContent(spanish.format(ms))
  })
})
