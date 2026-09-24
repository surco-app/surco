import type React from 'react'
import { Fragment, useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { Release } from '../../../shared/types'
import { buildFieldSpecs, type FieldSpec } from '../lib/fieldSpecs'
import type { TrackItem } from '../types'
import { CoverPicker } from './CoverPicker'
import { Field } from './Field'
import { StarRating } from './StarRating'
import { TagListBulkField } from './TagListBulkField'

// Re-exported from lib so the form and its callers keep a single import site for the
// spec shape while the builder (buildFieldSpecs) stays a pure, testable lib function.
export type { FieldSpec }
export { buildFieldSpecs }

// One field: the compilation checkbox writes the exact '1' the TCMP/COMPILATION tag needs
// (a yes/no fact, not free text; in a mixed selection the box shows indeterminate and
// ticking stamps '1' on every track); every other field is a text Field. Pulled out so both the
// group render and any future caller draw a field the same way.
function renderField(f: FieldSpec): React.JSX.Element {
  if (f.perTrack) {
    return (
      <TagListBulkField
        label={f.label}
        list={f.perTrack.list}
        presets={f.suggestions ?? []}
        tracks={f.perTrack.tracks}
        onChangeTracks={f.perTrack.onChangeTracks}
      />
    )
  }
  if (f.key === 'compilation') {
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          data-testid="field-compilation"
          // indeterminate exists only as a DOM property, so it is set through the ref.
          ref={(el) => {
            if (el) el.indeterminate = !!f.mixed
          }}
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
      required={f.required}
      invalid={f.invalid}
      mixed={f.mixed}
      suggestions={f.suggestions}
      tagList={f.tagList}
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

// The metadata form body: the cover well with the rating under it (single-track only) and
// the fields — a flat list in the user's own order, rendered inline in the editor's single
// scroll (no inner scroller) so browsing never fights a second scroll region, fed
// pre-resolved field specs.
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
  const ratingLabelId = useId()
  return (
    <div className="mt-4 @container">
      <div className="flex flex-col gap-5 @[26rem]:flex-row @[26rem]:gap-7">
        {/* The artwork column: the cover and, under it, the rating, both facts about the
            record rather than fields to type, so the fields column opens on the first one. */}
        <div className="flex shrink-0 flex-col items-start gap-3 @[26rem]:items-center">
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
          {!isMulti && (
            <div className="flex items-center">
              <span id={ratingLabelId} className="sr-only">
                {tr('fields.rating')}
              </span>
              <StarRating
                value={item.meta.rating ?? ''}
                onChange={onRate}
                labelledBy={ratingLabelId}
              />
            </div>
          )}
        </div>

        {/* One column in the user's order, labels to the left of their inputs the way a
            macOS inspector lays out a form, so a value gets the column's full width instead of
            half of it ("Head Horny's & Migu"). The label track is as wide as the longest
            label, capped so a long custom name wraps instead of starving the inputs. Below
            18rem there is no room for both, and the labels go back on top. */}
        <div className="@container min-w-0 flex-1">
          <div className="grid grid-cols-1 gap-y-4 @[18rem]:grid-cols-[auto_minmax(0,1fr)] @[18rem]:gap-x-3 @[18rem]:gap-y-2">
            {fields.map((f) =>
              f.perTrack ? (
                <div key={f.key} className="@[18rem]:col-span-2">
                  {renderField(f)}
                </div>
              ) : f.key === 'compilation' ? (
                <div key={f.key} className="flex @[18rem]:col-start-2">
                  {renderField(f)}
                </div>
              ) : (
                <Fragment key={f.key}>{renderField(f)}</Fragment>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
