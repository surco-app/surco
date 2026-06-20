// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { OutputNameSection } from './OutputNameSection'

afterEach(cleanup)

const meta: TrackMetadata = {
  title: 'Title',
  artist: 'Artist',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

const item: TrackItem = {
  id: 'a',
  inputPath: '/m/a.wav',
  fileName: 'a.wav',
  listLabel: 'a.wav',
  query: '',
  status: 'idle',
  meta,
}

function renderSection(autoApply: boolean): void {
  render(
    <OutputNameSection
      item={item}
      format="aiff"
      defaultOutputName="a"
      autoApply={autoApply}
      willEditInPlace={false}
      open={true}
      onToggle={vi.fn()}
      onChangeName={vi.fn()}
      onRegenerateName={vi.fn()}
      onOpenRename={vi.fn()}
    />,
  )
}

describe('OutputNameSection', () => {
  // In manual mode the name only updates on demand, so the Regenerate button is the user's
  // way to pull the metadata-derived name in — it must be there to press.
  it('shows the Regenerate button in manual mode', () => {
    renderSection(false)
    expect(screen.getByTestId('regenerate-output-name')).toBeInTheDocument()
    expect(screen.getByTestId('customize-output-name')).toBeInTheDocument()
  })

  // With auto-apply on the pattern already fills the name, so a manual Regenerate is
  // redundant and is hidden — the pencil (custom pattern) stays for one-off tweaks.
  it('hides the Regenerate button when auto-apply is on, keeping the pencil', () => {
    renderSection(true)
    expect(screen.queryByTestId('regenerate-output-name')).not.toBeInTheDocument()
    expect(screen.getByTestId('customize-output-name')).toBeInTheDocument()
  })
})
