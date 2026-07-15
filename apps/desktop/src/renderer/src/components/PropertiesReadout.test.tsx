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
