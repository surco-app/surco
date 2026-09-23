// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import { GROUPING_TAGS } from '../lib/bulkEdit'
import type { TrackItem } from '../types'
import { TagListBulkField } from './TagListBulkField'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count != null ? `${k}:${o.count}` : k),
  }),
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
  const { rerender } = render(
    <TagListBulkField
      label="Grouping"
      list={GROUPING_TAGS}
      presets={['Bases', 'Cantaditas']}
      tracks={tracks}
      onChangeTracks={onChangeTracks}
    />,
  )
  return {
    onChangeTracks,
    rerender: (next: TrackItem[]) =>
      rerender(
        <TagListBulkField
          label="Grouping"
          list={GROUPING_TAGS}
          presets={['Bases', 'Cantaditas']}
          tracks={next}
          onChangeTracks={onChangeTracks}
        />,
      ),
  }
}

function summaryOrder(): string[] {
  return screen
    .getAllByTestId(/^chip-(Bases|Cantaditas|Discazos)$/)
    .map((c) => c.getAttribute('data-testid')?.replace('chip-', '') ?? '')
}

function rowOrder(id: string): string[] {
  return screen
    .getAllByTestId(new RegExp(`^chip-${id}-`))
    .map((c) => c.getAttribute('data-testid')?.replace(`chip-${id}-`, '') ?? '')
}

function openRows(): void {
  fireEvent.click(screen.getByTestId('grouping-per-track-toggle'))
}

describe('TagListBulkField', () => {
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
    openRows()
    expect(screen.getByTestId('chip-a2-Cantaditas')).toHaveAttribute('data-state', 'on')
    fireEvent.click(screen.getByTestId('chip-a2-Bases'))
    expect(onChangeTracks).toHaveBeenCalledWith([
      { id: 'a2', meta: { grouping: 'Cantaditas, Bases' } },
    ])
  })

  it('names each row by track number and title, falling back to the list label', () => {
    renderField()
    openRows()
    expect(screen.getByTestId('grouping-track-a1')).toHaveTextContent('A1')
    expect(screen.getByTestId('grouping-track-a1')).toHaveTextContent('All I Want')
    expect(screen.getByTestId('grouping-track-b1')).toHaveTextContent('jungle.flac')
  })

  // WHY: a tag typed by hand on one track (not a preset) must still show up, or the
  // bulk view would hide it and offer no way to take it off.
  it('offers tags the selection already carries even when they are not presets', () => {
    renderField()
    openRows()
    expect(screen.getByTestId('chip-a1-Discazos')).toHaveAttribute('data-state', 'on')
    expect(screen.getByTestId('chip-b1-Discazos')).toHaveAttribute('data-state', 'off')
  })

  // WHY: four tracks already cost a third of the column in chips; a twelve-cut release
  // would push every field below out of sight. The summary row stays put and says how
  // many tags differ, and the per-track rows open only when the user asks.
  it('starts folded, with the summary row visible and a count of the tags that vary', () => {
    renderField()
    expect(screen.getByTestId('chip-Cantaditas')).toBeInTheDocument()
    expect(screen.queryByTestId('grouping-track-a1')).toBeNull()
    expect(screen.getByTestId('grouping-per-track-toggle')).toHaveTextContent(
      'editor.groupingPerTrack:3',
    )
    expect(screen.getByTestId('grouping-per-track-toggle')).toHaveTextContent(
      'editor.groupingVarying:3',
    )
  })

  it('says there are no differences instead of "0 vary" when every track matches', () => {
    renderField([a2, track('a3', { grouping: 'Cantaditas' })])
    expect(screen.getByTestId('grouping-per-track-toggle')).toHaveTextContent('editor.groupingSame')
    expect(screen.getByTestId('grouping-per-track-toggle')).not.toHaveTextContent(
      'editor.groupingVarying',
    )
  })

  it('opens the per-track rows on demand and keeps them open', () => {
    renderField()
    openRows()
    expect(screen.getByTestId('grouping-track-a1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('chip-a1-Bases'))
    expect(screen.getByTestId('grouping-track-b1')).toBeInTheDocument()
  })

  // WHY: the rows collapse to one line with a measured "+N", and the indent makes them
  // narrower than the summary row. A tag the track carries must never fall behind that
  // "+N", or the row would read as untagged. Active tags go first, then the rest in
  // preset order.
  it('orders each row with its active tags first, and the summary with all before some before none', () => {
    renderField([a1, a2])
    openRows()
    const row = screen
      .getAllByTestId(/^chip-a1-/)
      .map((c) => c.getAttribute('data-testid')?.replace('chip-a1-', ''))
    expect(row).toEqual(['Cantaditas', 'Discazos', 'Bases'])
    const summary = screen
      .getAllByTestId(/^chip-(Bases|Cantaditas|Discazos)$/)
      .map((c) => c.getAttribute('data-testid')?.replace('chip-', ''))
    expect(summary).toEqual(['Cantaditas', 'Discazos', 'Bases'])
  })

  it('keeps the pills where they are while the same selection is being edited', () => {
    const { rerender } = renderField([a1, a2])
    openRows()
    expect(summaryOrder()).toEqual(['Cantaditas', 'Discazos', 'Bases'])
    rerender([
      track('a1', { ...a1.meta, grouping: 'Cantaditas, Discazos, Bases' }),
      track('a2', { ...a2.meta, grouping: 'Cantaditas, Bases' }),
    ])
    expect(summaryOrder()).toEqual(['Cantaditas', 'Discazos', 'Bases'])
    expect(rowOrder('a1')).toEqual(['Cantaditas', 'Discazos', 'Bases'])
  })

  it('re-sorts the pills when a different selection comes in', () => {
    const { rerender } = renderField([a1, a2])
    expect(summaryOrder()).toEqual(['Cantaditas', 'Discazos', 'Bases'])
    rerender([b1])
    expect(summaryOrder()).toEqual(['Bases', 'Cantaditas'])
  })

  // Every track row repeats the same chips ("Bases", "Cantaditas"), so out of their
  // visual row a screen reader heard a dozen identical toggles with no track attached.
  // Each row is a group named by its track, and the summary one by the field's label.
  it('groups each row of chips under the name of the track it edits', () => {
    renderField()
    expect(
      within(screen.getByRole('group', { name: /^Grouping/ })).getByTestId('chip-Bases'),
    ).toBeInTheDocument()
    openRows()
    const row = screen.getByRole('group', { name: /All I Want/ })
    expect(within(row).getByTestId('chip-a1-Bases')).toBeInTheDocument()
    expect(within(row).queryByTestId('chip-a2-Bases')).toBeNull()
  })

  // aria-expanded says the toggle opens something; aria-controls says what, so assistive
  // tech can take the user straight to the rows it revealed.
  it('points the per-track toggle at the rows it opens', () => {
    renderField()
    openRows()
    const toggle = screen.getByTestId('grouping-per-track-toggle')
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(body).not.toBeNull()
    expect(within(body as HTMLElement).getByTestId('grouping-track-a1')).toBeInTheDocument()
  })
})
