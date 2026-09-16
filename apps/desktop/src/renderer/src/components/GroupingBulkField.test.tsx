// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { GroupingBulkField } from './GroupingBulkField'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

function track(id: string, meta: Partial<TrackMetadata>, listLabel = id): TrackItem {
  return {
    id,
    inputPath: `/${id}.flac`,
    fileName: `${id}.flac`,
    listLabel,
    query: '',
    meta: { grouping: '', ...meta } as TrackMetadata,
    status: 'idle',
  }
}

const a1 = track('a1', { trackNumber: 'A1', title: 'All I Want', grouping: 'Cantaditas, Discazos' })
const a2 = track('a2', { trackNumber: 'A2', title: 'Funk The Beat', grouping: 'Cantaditas' })
const b1 = track('b1', { title: '', grouping: 'Bases' }, 'jungle.flac')

function renderField(tracks: TrackItem[] = [a1, a2, b1]) {
  const onChangeTracks = vi.fn()
  render(
    <GroupingBulkField
      label="Grouping"
      presets={['Bases', 'Cantaditas']}
      tracks={tracks}
      onChangeTracks={onChangeTracks}
    />,
  )
  return { onChangeTracks }
}

describe('GroupingBulkField', () => {
  // WHY: the old bulk field showed "multiple values" and a chip click stamped one tag on
  // every track, wiping what each had. The summary row must tell all/some/none apart so
  // the user sees a partial tag before touching it.
  it('summarises each tag across the selection as on, partial or off', () => {
    renderField()
    expect(screen.getByTestId('chip-Cantaditas')).toHaveAttribute('data-state', 'some')
    expect(screen.getByTestId('chip-Bases')).toHaveAttribute('data-state', 'some')
    expect(screen.getByTestId('chip-Discazos')).toHaveAttribute('data-state', 'some')
  })

  it('completes a partial tag on the tracks missing it without touching the rest', () => {
    const { onChangeTracks } = renderField()
    fireEvent.click(screen.getByTestId('chip-Cantaditas'))
    expect(onChangeTracks).toHaveBeenCalledWith([
      { id: 'b1', meta: { grouping: 'Bases, Cantaditas' } },
    ])
  })

  it('removes a tag every track carries from all of them', () => {
    const { onChangeTracks } = renderField([a1, a2])
    expect(screen.getByTestId('chip-Cantaditas')).toHaveAttribute('data-state', 'on')
    fireEvent.click(screen.getByTestId('chip-Cantaditas'))
    expect(onChangeTracks).toHaveBeenCalledWith([
      { id: 'a1', meta: { grouping: 'Discazos' } },
      { id: 'a2', meta: { grouping: '' } },
    ])
  })

  it('toggles a tag on one track from its own row and leaves the others alone', () => {
    const { onChangeTracks } = renderField()
    expect(screen.getByTestId('chip-a2-Cantaditas')).toHaveAttribute('data-state', 'on')
    fireEvent.click(screen.getByTestId('chip-a2-Bases'))
    expect(onChangeTracks).toHaveBeenCalledWith([
      { id: 'a2', meta: { grouping: 'Cantaditas, Bases' } },
    ])
  })

  it('names each row by track number and title, falling back to the list label', () => {
    renderField()
    expect(screen.getByTestId('grouping-track-a1')).toHaveTextContent('A1')
    expect(screen.getByTestId('grouping-track-a1')).toHaveTextContent('All I Want')
    expect(screen.getByTestId('grouping-track-b1')).toHaveTextContent('jungle.flac')
  })

  // WHY: a tag typed by hand on one track (not a preset) must still show up, or the
  // bulk view would hide it and offer no way to take it off.
  it('offers tags the selection already carries even when they are not presets', () => {
    renderField()
    expect(screen.getByTestId('chip-a1-Discazos')).toHaveAttribute('data-state', 'on')
    expect(screen.getByTestId('chip-b1-Discazos')).toHaveAttribute('data-state', 'off')
  })
})
