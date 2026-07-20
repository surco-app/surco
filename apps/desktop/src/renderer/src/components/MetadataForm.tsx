import { ChevronRight } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Release } from '../../../shared/types'
import { buildFieldSpecs, type FieldSpec } from '../lib/fieldSpecs'
import { type FieldGroupBucket, groupFields } from '../lib/fields'
import type { TrackItem } from '../types'
import { CoverPicker } from './CoverPicker'
import { Field } from './Field'
import { SECTION_SUBHEAD } from './SectionSubhead'
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

// One collapsible category. Identity opens by default (defaultOpen), the rest start closed —
// a track's catalog/DJ/order tags are usually reviewed, not edited, so they stay one click
// away and the panel stays short even with every field turned on. The header shows how many
// of the group's fields carry a value, so the user knows whether opening it is worth it
// without opening it. Fold state is local: MetadataForm is remounted per track (the editor is
// keyed by track id), so each track opens fresh with only Identity expanded.
function FieldGroup({
  group,
  defaultOpen,
}: {
  group: FieldGroupBucket<FieldSpec>
  defaultOpen: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const filled = group.items.filter((f) => f.value.trim() !== '').length
  const label = group.id === 'other' ? tr('fieldGroups.other') : tr(`fieldGroups.${group.id}`)
  return (
    <div className="border-t border-[var(--color-line)] first:border-t-0">
      <button
        type="button"
        data-testid={`field-group-${group.id}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="press flex w-full items-center gap-1.5 py-2.5 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 text-fg-dim transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className={SECTION_SUBHEAD}>{label}</span>
        {filled > 0 && (
          <span
            data-testid={`field-group-count-${group.id}`}
            className="ml-auto text-[10px] font-normal tracking-normal text-fg-faint tabular-nums"
          >
            {tr('fields.groupFilled', { count: filled })}
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid={`field-group-body-${group.id}`}
          className="grid grid-cols-1 gap-x-4 gap-y-3 pb-3 @[26rem]:grid-cols-2"
        >
          {group.items.map((f) => (
            <div
              key={f.key}
              className={f.wide || f.key === 'compilation' ? '@[26rem]:col-span-2' : ''}
            >
              {renderField(f)}
            </div>
          ))}
        </div>
      )}
    </div>
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
// fields — grouped into one collapsible section per category (Identity / Catalog / DJ /
// Order), each shown once, fed pre-resolved field specs.
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

        <div className="min-w-0 flex-1">
          {groupFields(fields).map((group, gi) => (
            <FieldGroup key={group.id} group={group} defaultOpen={gi === 0} />
          ))}
        </div>
      </div>
    </div>
  )
}
