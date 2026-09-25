// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GROUPING_TAGS } from '../lib/bulkEdit'
import type { FieldSpec } from '../lib/fieldSpecs'
import type { TrackItem } from '../types'
import { MetadataForm } from './MetadataForm'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count != null ? `${o.count} filled` : k),
  }),
}))

// The Field/CoverPicker/StarRating children pull in heavy deps and aren't under test here;
// stub them to plain nodes so the test exercises only MetadataForm's grouping/fold logic.
vi.mock('./Field', () => ({
  Field: ({
    name,
    value,
    inline,
    trailing,
  }: {
    name: string
    value: string
    inline?: boolean
    trailing?: React.ReactNode
  }) => (
    <div data-testid={`field-${name}`} data-inline={inline ? 'true' : undefined}>
      {value}
      {trailing}
    </div>
  ),
}))
vi.mock('./CoverPicker', () => ({ CoverPicker: () => <div data-testid="cover" /> }))
vi.mock('./StarRating', () => ({
  StarRating: ({ labelledBy }: { labelledBy?: string }) => (
    <fieldset data-testid="stars" aria-labelledby={labelledBy} />
  ),
}))
vi.mock('./TagListBulkField', () => ({
  TagListBulkField: ({ presets }: { presets: string[] }) => (
    <div data-testid="grouping-bulk">{presets.join(',')}</div>
  ),
}))

const spec = (key: string, value = ''): FieldSpec =>
  ({ key, label: key, value, placeholder: '', onChange: vi.fn() }) as unknown as FieldSpec

const item = { meta: {} } as unknown as TrackItem

function renderForm(fields: FieldSpec[]): void {
  render(
    <MetadataForm
      item={item}
      isMulti={false}
      selectedTracks={undefined}
      release={null}
      coverDims={null}
      setCoverDims={vi.fn()}
      onChange={vi.fn()}
      onRate={vi.fn()}
      fields={fields}
    />,
  )
}

describe('MetadataForm', () => {
  // The form is a flat list now: every shown field renders in the order it arrives
  // (the user's own field order), with no group headers or collapse toggles between
  // them. Grouping the fields into collapsible sections fought the user's manual
  // ordering — a field dragged across a group boundary snapped back — so it's gone.
  // It renders inline in the editor's single scroll too — no capped inner scroller,
  // so a long field set never traps the wheel in a second scroll region.
  it('renders every field in the order received, with no group headers or inner scroller', () => {
    renderForm([spec('catalogNumber', 'C'), spec('title', 'X'), spec('bpm')])
    expect(screen.getByTestId('field-catalogNumber')).toBeInTheDocument()
    expect(screen.getByTestId('field-title')).toBeInTheDocument()
    expect(screen.getByTestId('field-bpm')).toBeInTheDocument()
    expect(screen.queryByTestId('field-group-catalog')).toBeNull()
    expect(screen.queryByTestId('field-group-body-identity')).toBeNull()
    expect(screen.queryByTestId('metadata-fields')).toBeNull()
  })

  it('keeps the field order verbatim across group boundaries', () => {
    // catalogNumber (a Catalog field) placed between title and artist (Identity)
    // stays exactly where the user put it — no re-bucketing.
    renderForm([spec('title', 'X'), spec('catalogNumber', 'C'), spec('artist', 'A')])
    const nodes = screen.getAllByTestId(/^field-/)
    expect(nodes.map((n) => n.getAttribute('data-testid'))).toEqual([
      'field-title',
      'field-catalogNumber',
      'field-artist',
    ])
  })

  it('renders a per-track spec as the bulk grouping field, full width, instead of a text field', () => {
    renderForm([
      spec('genre', 'Techno'),
      {
        ...spec('grouping'),
        suggestions: ['Bases', 'Vocals'],
        perTrack: { list: GROUPING_TAGS, tracks: [], onChangeTracks: vi.fn() },
      },
    ])
    expect(screen.getByTestId('grouping-bulk')).toHaveTextContent('Bases,Vocals')
    expect(screen.queryByTestId('field-grouping')).toBeNull()
    expect(screen.getByTestId('grouping-bulk').parentElement?.className).toContain('col-span-2')
  })

  // A selection where only some tracks are compilations showed a plain empty box, which
  // reads as "none of them is"; ticking it then stamps every track. The box has to say
  // "mixed" the way the text fields say "multiple values".
  it('shows the compilation box as mixed when the selection disagrees', () => {
    renderForm([{ ...spec('compilation'), mixed: true }])
    expect(screen.getByTestId('field-compilation')).toBePartiallyChecked()
  })

  it('shows the compilation box as a plain unticked box when no track is one', () => {
    renderForm([spec('compilation')])
    expect(screen.getByTestId('field-compilation')).not.toBePartiallyChecked()
    expect(screen.getByTestId('field-compilation')).not.toBeChecked()
  })

  // With the labels beside the inputs, every input stretched to the panel's far edge: on a
  // 1270px panel "2007" sat in a 1000px box and the eye crossed the whole row to read it.
  // The fields column stops at a readable measure however wide the user drags the panel.
  it('caps the fields column at a readable width on a wide panel', () => {
    renderForm([spec('title', 'Illusion'), spec('year', '2007')])
    expect(screen.getByTestId('field-title').parentElement?.className).toContain('max-w-[48rem]')
  })

  // A year, a BPM and a key each took a full row in boxes as wide as the title. Bounded
  // fields that follow each other in the user's order share one row instead; a longer field
  // between them breaks the row, so the user's order is never rearranged to pack them.
  it('joins consecutive bounded fields into one row, in the user order', () => {
    renderForm([
      spec('title', 'Illusion'),
      { ...spec('year', '2007'), width: 'short' },
      { ...spec('bpm', '145'), width: 'short' },
      { ...spec('isrc'), width: 'medium' },
      spec('genre', 'Electronic'),
      { ...spec('key', '4A'), width: 'short' },
    ])
    const year = screen.getByTestId('field-year')
    expect(year).not.toHaveAttribute('data-inline')
    expect(year).toContainElement(screen.getByTestId('field-bpm'))
    expect(year).toContainElement(screen.getByTestId('field-isrc'))
    expect(screen.getByTestId('field-bpm')).toHaveAttribute('data-inline', 'true')
    expect(year).not.toContainElement(screen.getByTestId('field-key'))
    expect(screen.getByTestId('field-key')).not.toHaveAttribute('data-inline')
    expect(screen.getAllByTestId(/^field-/).map((n) => n.getAttribute('data-testid'))).toEqual([
      'field-title',
      'field-year',
      'field-bpm',
      'field-isrc',
      'field-genre',
      'field-key',
    ])
  })

  // The rating is a fact about the record, like its artwork, and above the form it cost a
  // whole row before the first field. Under the cover it rides the artwork column, so the
  // fields column opens straight on the first field the user edits.
  it('keeps the rating in the artwork column, apart from the fields', () => {
    renderForm([spec('title', 'In My Dreams')])
    const artwork = screen.getByTestId('cover').parentElement
    expect(artwork).toContainElement(screen.getByTestId('stars'))
    expect(artwork).not.toContainElement(screen.getByTestId('field-title'))
  })

  // The stars are only meaningful next to the "Rating" caption the form draws; the caption
  // has to be their group's name, or a screen reader reads bare star counts.
  it('names the star group by the rating caption', () => {
    renderForm([])
    expect(screen.getByRole('group', { name: 'fields.rating' })).toBe(screen.getByTestId('stars'))
  })
})
