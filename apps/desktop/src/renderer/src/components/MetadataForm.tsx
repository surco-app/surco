import type React from 'react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import type { Release } from '../../../shared/types'
import { buildFieldSpecs, type FieldSpec } from '../lib/fieldSpecs'
import { groupHeaderBefore } from '../lib/fields'
import type { TrackItem } from '../types'
import { CoverPicker } from './CoverPicker'
import { Field } from './Field'
import { StarRating } from './StarRating'

// Re-exported from lib so the form and its callers keep a single import site for the
// spec shape while the builder (buildFieldSpecs) stays a pure, testable lib function.
export type { FieldSpec }
export { buildFieldSpecs }

interface MetadataFormProps {
  item: TrackItem
  isMulti: boolean
  selectedTracks: TrackItem[] | undefined
  release: Release | null
  coverDims: { w: number; h: number } | null
  setCoverDims: (dims: { w: number; h: number } | null) => void
  onChange: (patch: Partial<TrackItem>) => void
  onApplyCoverAll?: (coverUrl: string, coverPath?: string) => void
  onRate: (value: string) => void
  fields: FieldSpec[]
}

// The metadata form body: the rating row (single-track only), the cover well and the
// field grid, fed pre-resolved field specs.
export function MetadataForm({
  item,
  isMulti,
  selectedTracks,
  release,
  coverDims,
  setCoverDims,
  onChange,
  onApplyCoverAll,
  onRate,
  fields,
}: MetadataFormProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="mt-4 @container">
      {!isMulti && (
        <div className="mb-4 flex items-center gap-3">
          <span className="text-xs font-medium text-fg-dim">{tr('fields.rating')}</span>
          <StarRating value={item.meta.rating ?? ''} onChange={onRate} />
        </div>
      )}
      <div className="flex flex-col gap-5 @[26rem]:flex-row @[26rem]:gap-6">
        <CoverPicker
          item={item}
          isMulti={isMulti}
          selectedTracks={selectedTracks}
          release={release}
          coverDims={coverDims}
          setCoverDims={setCoverDims}
          onChange={onChange}
          onApplyCoverAll={onApplyCoverAll}
        />

        <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-3 @[26rem]:grid-cols-2">
          {fields.map((f, i) => {
            // A group header spans the full row and forces the field after it back to
            // column 1, so the two-column grid never straddles a section boundary.
            const header = groupHeaderBefore(
              fields.map((s) => s.key),
              i,
            )
            const field =
              f.key === 'compilation' ? (
                // Compilation is a yes/no fact, not free text: a checkbox writes the
                // exact '1' the TCMP/COMPILATION tag needs. In a mixed selection
                // (value '') it shows unticked, and ticking it stamps '1' onto every
                // selected track.
                <label key={f.key} className="flex items-center gap-2 self-end pb-2">
                  <input
                    type="checkbox"
                    data-testid="field-compilation"
                    checked={f.value === '1'}
                    onChange={(e) => f.onChange(e.target.checked ? '1' : '')}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="text-xs font-medium text-fg-dim">{f.label}</span>
                </label>
              ) : (
                <Field
                  key={f.key}
                  name={f.key}
                  label={f.label}
                  value={f.value}
                  placeholder={f.placeholder}
                  onChange={f.onChange}
                  insertSources={f.insertSources}
                  cleanResult={f.cleanResult}
                  wide={f.wide}
                  invalid={f.invalid}
                  suggestions={f.suggestions}
                  multiSuggestions={f.multiSuggestions}
                />
              )
            return (
              <Fragment key={f.key}>
                {header && (
                  <h3
                    data-testid={`field-group-${header}`}
                    className="col-span-1 mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-fg-faint first:mt-0 @[26rem]:col-span-2"
                  >
                    {tr(`fieldGroups.${header}`)}
                  </h3>
                )}
                {field}
              </Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
