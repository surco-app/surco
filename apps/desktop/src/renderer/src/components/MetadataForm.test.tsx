// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  Field: ({ name, value }: { name: string; value: string }) => (
    <div data-testid={`field-${name}`}>{value}</div>
  ),
}))
vi.mock('./CoverPicker', () => ({ CoverPicker: () => <div data-testid="cover" /> }))
vi.mock('./StarRating', () => ({ StarRating: () => <div data-testid="stars" /> }))

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
  it('renders every field in the order received, with no group headers', () => {
    renderForm([spec('catalogNumber', 'C'), spec('title', 'X'), spec('bpm')])
    expect(screen.getByTestId('field-catalogNumber')).toBeInTheDocument()
    expect(screen.getByTestId('field-title')).toBeInTheDocument()
    expect(screen.getByTestId('field-bpm')).toBeInTheDocument()
    expect(screen.queryByTestId('field-group-catalog')).toBeNull()
    expect(screen.queryByTestId('field-group-body-identity')).toBeNull()
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
})
