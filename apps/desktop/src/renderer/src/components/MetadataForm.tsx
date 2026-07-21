import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { Release } from '../../../shared/types'
import { buildFieldSpecs, type FieldSpec } from '../lib/fieldSpecs'
import type { TrackItem } from '../types'
import { useScrollAffordance } from '../hooks/useScrollAffordance'
import { CoverPicker } from './CoverPicker'
import { Field } from './Field'
import { StarRating } from './StarRating'

// Re-exported from lib so the form and its callers keep a single import site for the
// spec shape while the builder (buildFieldSpecs) stays a pure, testable lib function.
export type { FieldSpec }
export { buildFieldSpecs }

// One field: the compilation checkbox writes the exact '1' the TCMP/COMPILATION tag needs
// (a yes/no fact, not free text; in a mixed selection value '' shows unticked and ticking
// stamps '1' on every track); every other field is a text Field. Pulled out so both the
// group render and any future caller draw a field the same way.
function renderField(f: FieldSpec): React.JSX.Element {
  if (f.key === 'compilation') {
    return (
      <label className="flex items-center gap-2 self-end pb-2">
        <input
          type="checkbox"
          data-testid="field-compilation"
          checked={f.value === '1'}
          onChange={(e) => f.onChange(e.target.checked ? '1' : '')}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className="text-xs font-medium text-fg-dim">{f.label}</span>
      </label>
    )
  }
  return (
    <Field
      name={f.key}
      label={f.label}
      value={f.value}
      placeholder={f.placeholder}
      onChange={f.onChange}
      insertSources={f.insertSources}
      cleanResult={f.cleanResult}
      formatResult={f.formatResult}
      wide={f.wide}
      invalid={f.invalid}
      suggestions={f.suggestions}
      multiSuggestions={f.multiSuggestions}
      suggesting={f.suggesting}
    />
  )
}

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
// fields — a flat list in the user's own order, capped to a scrollable height so a long
// field set never pushes the sections below it out of view, fed pre-resolved field specs.
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
  const { ref: scrollRef, moreBelow } = useScrollAffordance([fields])
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

        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollRef}
            data-testid="metadata-fields"
            className="max-h-[420px] overflow-y-auto"
          >
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 @[26rem]:grid-cols-2">
              {fields.map((f) => (
                <div
                  key={f.key}
                  className={f.wide || f.key === 'compilation' ? '@[26rem]:col-span-2' : ''}
                >
                  {renderField(f)}
                </div>
              ))}
            </div>
          </div>
          {/* Fades the cut-off field into the panel while more sit below the fold,
              then clears at the very bottom — the same cue Settings' tabs use. */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--color-panel)] to-transparent transition-opacity duration-200 ${
              moreBelow ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>
      </div>
    </div>
  )
}
