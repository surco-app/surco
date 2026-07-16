// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TrackProperties } from '../../../shared/types'
import '../i18n'
import { PropertiesReadout } from './PropertiesReadout'

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
        properties={props}
        fileName="20. Dj Isaac - On The Edge (Original Mix)"
        inputPath="/music/bases buenas/20. Dj Isaac - On The Edge (Original Mix).flac"
        duration={413}
      />,
    )
    const ext = screen.getByTestId('property-extension')
    expect(ext).toHaveTextContent('FLAC')
    expect(ext).not.toHaveTextContent(/ISAAC/i)
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
  // shows an empty half-cell next to it. Dropping only Bitrate leaves AUDIO's shorts at 7
  // (kind, codec, sampleRate, bitDepth, channels, channelMode, duration) — odd — so its
  // last short (Duration) stretches. A 6-short even group leaves none stretched.
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
    // Full props → AUDIO shorts = 8 (even), so none of them is stretched.
    render(
      <PropertiesReadout
        properties={props}
        fileName="x"
        inputPath="/x/x.flac"
        duration={404}
      />,
    )
    expect(screen.getByTestId('property-duration').className).not.toContain('col-span-2')
  })
})
