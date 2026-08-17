import { Check, ChevronDown, ChevronUp, GripVertical, Info, Wand2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import { FIELD_DEFS, IMPORTABLE_FIELDS, moveItem, sortFieldsByGroup } from '../lib/fields'
import { Tooltip } from './Tooltip'

// How long the auto-organize button holds its "done" confirmation before reverting.
const ORGANIZED_FEEDBACK_MS = 1500

// The row's column track: name (takes the slack), the two toggles, the two arrows, Hide.
// A grid rather than a flex row because the toggles repeat down every row and read as
// columns — and only declared tracks let a heading line up with them. Sizing a control by
// its own text drifts per language (German's "Ausblenden" is twice the width of "Hide"),
// which no hand-tuned heading offset can follow. Every track is therefore given an explicit
// width: the heading is a separate grid, so an `auto` track would resolve from ITS contents
// (empty) rather than the row's and land the labels in the wrong place — 143px off, as an
// auto-sized first attempt did. Hide's track fits the longest translation.
const ROW_GRID = 'grid grid-cols-[1fr_4.75rem_4.75rem_1.75rem_1.75rem_5.5rem] items-center gap-1'

// Moves fromKey to toKey's slot: dragging down lands it after the target, dragging up
// before it — how every list DnD reads, so the row stays where the user dropped it.
function reorder(list: string[], fromKey: string, toKey: string): string[] {
  const from = list.indexOf(fromKey)
  const to = list.indexOf(toKey)
  if (from === -1 || to === -1 || from === to) return list
  const next = [...list]
  next.splice(from, 1)
  next.splice(to, 0, fromKey)
  return next
}

interface Props {
  visibleFields: string[]
  requiredFields: string[]
  // Which fields a match may fill. A property of the field, like `required` — not a
  // provider setting: it governs Discogs, Bandcamp and Deezer alike.
  importFields: string[]
  onChangeVisible: (next: string[]) => void
  onChangeRequired: (next: string[]) => void
  onChangeImport: (next: string[]) => void
}

// The editor's field list: which tags show (and in what order) and which must be filled
// before a track converts. Shared by Settings → Fields and the onboarding wizard so the
// two can't drift. Required implies shown, so hiding a field also drops it from required.
export function FieldsEditor({
  visibleFields,
  requiredFields,
  importFields,
  onChangeVisible,
  onChangeRequired,
  onChangeImport,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The auto-fill toggle, shown on both the visible and hidden lists. Rendered only for a
  // field a release can actually carry: offering it on bpm/key/mood would be a switch that
  // never does anything. A hidden field keeps its toggle — it isn't shown in the form, but
  // it is still written to the file, so it has to be configurable without unhiding it.
  const autoToggle = (key: string): React.JSX.Element => {
    // A field no provider fills gets an empty slot of the same width rather than nothing,
    // so Required/Hide stay on one vertical line down the list instead of jumping left on
    // every row without a toggle.
    if (!IMPORTABLE_FIELDS.includes(key as keyof TrackMetadata))
      return <span aria-hidden="true" />
    const on = importFields.includes(key)
    return (
      <button
        type="button"
        data-testid={`field-auto-${key}`}
        aria-pressed={on}
        onClick={() =>
          onChangeImport(on ? importFields.filter((k) => k !== key) : [...importFields, key])
        }
        className={`rounded py-0.5 text-xs ${
          on
            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
            : 'text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg-muted'
        }`}
      >
        {tr('settings.autoFill')}
      </button>
    )
  }
  // Reordering a scrolling (and possibly already-tidy) list gives no visible sign it ran,
  // so the button confirms in place, then reverts. The timer is cleared on unmount so a
  // late revert can't fire after the modal closes.
  const [organized, setOrganized] = useState(false)
  // Drag-to-reorder state: the row being dragged (armed from its grip handle, so the
  // row's buttons stay plain clicks) and the row currently hovered as the drop target.
  // The arrow buttons remain as the keyboard-accessible path.
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const organizedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(organizedTimer.current), [])
  function autoOrganize(): void {
    onChangeVisible(sortFieldsByGroup(visibleFields))
    setOrganized(true)
    clearTimeout(organizedTimer.current)
    organizedTimer.current = setTimeout(() => setOrganized(false), ORGANIZED_FEEDBACK_MS)
  }
  return (
    // No own height cap or scroll: the settings tab panel scrolls, so the list fills the
    // panel's full height and a long field list scrolls there instead of inside a short
    // 340px window that left the panel half-empty below it.
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-dim">
            {tr('settings.shown')}
          </p>
          <button
            type="button"
            data-testid="auto-organize-fields"
            onClick={autoOrganize}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              organized
                ? 'text-[var(--color-accent)]'
                : 'text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg'
            }`}
          >
            {organized ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {tr(organized ? 'settings.autoOrganized' : 'settings.autoOrganize')}
            <Tooltip label={tr('settings.autoOrganizeHint')} />
          </button>
        </div>
        {/* Column headings, laid out on the row's own grid so each label resolves to the
            same track as the buttons under it — no measured offsets, and nothing to drift
            when a translation makes a button wider. The empty spans hold the name, arrow
            and Hide tracks. Each heading carries what its column MEANS: a label alone
            doesn't say that Auto fills from a release or that Required blocks converting,
            and hanging that off every one of the thirty-plus buttons put the same paragraph
            over the rows below, again and again, long after it had been read. Asked for
            once, in one place, it stays out of the way — hence the button, which is
            focusable so the hint is reachable by keyboard as well as hover. */}
        <div
          data-testid="fields-columns"
          className={`${ROW_GRID} mb-1 px-2 text-[10px] uppercase tracking-wide text-fg-faint`}
        >
          <span />
          <span
            data-testid="fields-column-auto"
            role="note"
            className="relative flex cursor-help items-center justify-center gap-1 text-fg-dim hover:text-fg-muted"
          >
            {tr('settings.autoFill')}
            <Info className="h-3 w-3" aria-hidden="true" />
            {/* The sentence is the note's content for a screen reader and the tooltip's
                label for a pointer — one source, both audiences (as SectionHeader does). */}
            <span className="sr-only">{tr('settings.autoFillHint')}</span>
            <Tooltip label={tr('settings.autoFillHint')} />
          </span>
          <span
            data-testid="fields-column-required"
            role="note"
            className="relative flex cursor-help items-center justify-center gap-1 text-fg-dim hover:text-fg-muted"
          >
            {tr('settings.required')}
            <Info className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{tr('settings.requiredHint')}</span>
            <Tooltip label={tr('settings.requiredHint')} />
          </span>
          <span />
          <span />
          <span />
        </div>
        <div className="space-y-1.5">
          {visibleFields.map((key, i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: the drag handlers are a pointer-only enhancement — the arrow buttons inside remain the keyboard-accessible way to reorder.
            <div
              key={key}
              data-testid={`field-row-${key}`}
              draggable={dragKey === key}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', key)
              }}
              onDragOver={(e) => {
                if (dragKey && dragKey !== key) {
                  e.preventDefault()
                  setDropKey(key)
                }
              }}
              onDragLeave={() => setDropKey((k) => (k === key ? null : k))}
              onDrop={(e) => {
                e.preventDefault()
                if (dragKey && dragKey !== key)
                  onChangeVisible(reorder(visibleFields, dragKey, key))
                setDragKey(null)
                setDropKey(null)
              }}
              onDragEnd={() => {
                setDragKey(null)
                setDropKey(null)
              }}
              onMouseUp={() => setDragKey(null)}
              className={`${ROW_GRID} rounded-lg border bg-[var(--color-field)] py-1.5 pl-2 pr-2 ${
                dropKey === key ? 'border-[var(--color-accent)]' : 'border-[var(--color-line)]'
              } ${dragKey === key ? 'opacity-40' : ''}`}
            >
              <span className="flex items-center gap-1.5 text-sm">
                <GripVertical
                  data-testid={`field-grip-${key}`}
                  onMouseDown={() => setDragKey(key)}
                  className="h-4 w-4 cursor-grab text-fg-dim"
                  aria-hidden="true"
                />
                {tr(`fields.${key}`)}
                <Tooltip label={`{${key}}`} />
              </span>
              {autoToggle(key)}
                <button
                  type="button"
                  data-testid={`field-required-${key}`}
                  aria-pressed={requiredFields.includes(key)}
                  onClick={() =>
                    onChangeRequired(
                      requiredFields.includes(key)
                        ? requiredFields.filter((k) => k !== key)
                        : [...requiredFields, key],
                    )
                  }
                  className={`rounded py-0.5 text-xs ${
                    requiredFields.includes(key)
                      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg-muted'
                  }`}
                >
                  {tr('settings.required')}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeVisible(moveItem(visibleFields, i, -1))}
                  disabled={i === 0}
                  className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                  aria-label={tr('settings.moveUp')}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onChangeVisible(moveItem(visibleFields, i, 1))}
                  disabled={i === visibleFields.length - 1}
                  className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                  aria-label={tr('settings.moveDown')}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangeVisible(visibleFields.filter((k) => k !== key))
                    onChangeRequired(requiredFields.filter((k) => k !== key))
                  }}
                  className="ml-1 rounded px-2 py-0.5 text-xs text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
                >
                  {tr('settings.hide')}
                </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-dim">
          {tr('settings.hidden')}
        </p>
        <div className="space-y-1.5">
          {/* The visible list keeps the user's order (it IS the editor's order); the
              hidden list has none of its own, so it sorts by label for scanning. */}
          {FIELD_DEFS.filter((d) => !visibleFields.includes(d.key))
            .sort((a, b) => tr(`fields.${a.key}`).localeCompare(tr(`fields.${b.key}`)))
            .map((d) => (
              <div
                key={d.key}
                data-testid={`hidden-field-${d.key}`}
                className="grid grid-cols-[1fr_4.75rem_5.5rem] items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-1.5 pl-3 pr-2"
              >
                <span className="text-sm text-fg-muted">
                  {tr(`fields.${d.key}`)}
                  <Tooltip label={`{${d.key}}`} />
                </span>
                {autoToggle(d.key)}
                <button
                  type="button"
                  onClick={() => onChangeVisible([...visibleFields, d.key])}
                  className="rounded px-2 py-0.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-panel-2)]"
                >
                  {tr('settings.show')}
                </button>
              </div>
            ))}
          {FIELD_DEFS.every((d) => visibleFields.includes(d.key)) && (
            <p className="text-xs text-fg-faint">{tr('settings.allVisible')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
