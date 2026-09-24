import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  GripVertical,
  Info,
  Wand2,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type CustomKeyProblem,
  customKeyProblem,
  suggestCustomKey,
} from '../../../shared/customFields'
import type { CustomField, MetaTextKey } from '../../../shared/types'
import { IMPORTABLE_FIELDS, labeledFields, moveItem, sortFieldsByGroup } from '../lib/fields'
import {
  COLUMN_HEAD,
  COLUMN_HEAD_CELL,
  TOGGLE_BOX,
  TOGGLE_OFF,
  TOGGLE_ON,
} from '../lib/settingsRows'
import { SegmentedControl } from './SegmentedControl'
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

// What can join the tags of Genre and Grouping: the three a tag reader expects, or the
// user's own typed under Other.
const SEPARATORS = { comma: ', ', semicolon: '; ', slash: '/' } as const
type SeparatorOption = keyof typeof SEPARATORS | 'custom'
const SEPARATOR_OPTIONS: readonly SeparatorOption[] = ['comma', 'semicolon', 'slash', 'custom']
type TagListKey = 'genre' | 'grouping'

function separatorOption(separator: string): SeparatorOption {
  const found = (Object.keys(SEPARATORS) as (keyof typeof SEPARATORS)[]).find(
    (option) => SEPARATORS[option].trim() === separator.trim(),
  )
  return found ?? 'custom'
}

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
  // The user's own fields, listed among the others and added from the row at the bottom.
  customFields: CustomField[]
  onChangeVisible: (next: string[]) => void
  onChangeRequired: (next: string[]) => void
  onChangeImport: (next: string[]) => void
  onChangeCustom: (next: CustomField[]) => void
  // What joins the tags of Genre and Grouping. Settings passes both; the onboarding wizard
  // leaves them out and its rows show none.
  separators?: Record<TagListKey, string>
  onChangeSeparator?: (key: TagListKey, separator: string) => void
}

// The editor's field list: which tags show (and in what order) and which must be filled
// before a track converts. Shared by Settings → Fields and the onboarding wizard so the
// two can't drift. Required implies shown, so hiding a field also drops it from required.
export function FieldsEditor({
  visibleFields,
  requiredFields,
  importFields,
  customFields,
  onChangeVisible,
  onChangeRequired,
  onChangeImport,
  onChangeCustom,
  separators,
  onChangeSeparator,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // Other stays picked while its box is empty, before the user has typed a separator.
  const [otherOpen, setOtherOpen] = useState<Partial<Record<TagListKey, boolean>>>({})
  const fields = labeledFields(customFields, tr)
  const labelOf = (key: string): string => fields.find((f) => f.key === key)?.label ?? key
  const hidden = fields
    .filter((f) => !visibleFields.includes(f.key))
    .sort((a, b) => a.label.localeCompare(b.label))
  // Required implies shown, so hiding a field drops it from required too.
  const hide = (key: string): void => {
    onChangeVisible(visibleFields.filter((k) => k !== key))
    onChangeRequired(requiredFields.filter((k) => k !== key))
  }
  // Deleting a custom field also drops it from every list that names it, so no stale key
  // is left behind in the shown or required fields.
  const deleteCustom = (key: string): void => {
    onChangeCustom(customFields.filter((f) => f.key !== key))
    hide(key)
  }
  const deleteButton = (key: string): React.JSX.Element | null =>
    customFields.some((f) => f.key === key) ? (
      <button
        type="button"
        data-testid={`field-delete-${key}`}
        aria-label={tr('settings.customFieldDeleteLabel', { name: labelOf(key) })}
        onClick={() => deleteCustom(key)}
        className="ml-auto rounded px-1.5 py-0.5 text-xs text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg"
      >
        {tr('settings.customFieldDelete')}
      </button>
    ) : null
  // A row's name with its {key} hint, the hint kept off the Delete button beside it. The
  // tooltip only answers a pointer, so the token is also there in words for a screen reader.
  const nameCell = (key: string): React.JSX.Element => (
    <>
      <span>
        {labelOf(key)}
        <Tooltip label={`{${key}}`} />
      </span>
      <span className="sr-only">{tr('fields.rowToken', { token: `{${key}}` })}</span>
      {deleteButton(key)}
    </>
  )
  const separatorPicker = (key: string): React.JSX.Element | null => {
    if (!separators || !onChangeSeparator || (key !== 'genre' && key !== 'grouping')) return null
    const separator = separators[key]
    const option = otherOpen[key] ? 'custom' : separatorOption(separator)
    return (
      <span data-testid={`field-separator-${key}`} className="ml-auto flex items-center gap-1.5">
        {option === 'custom' && (
          <input
            data-testid={`field-separator-${key}-input`}
            value={separatorOption(separator) === 'custom' ? separator : ''}
            maxLength={3}
            onChange={(e) => onChangeSeparator(key, e.target.value)}
            aria-label={tr('settings.separatorCustomLabel', { name: labelOf(key) })}
            className="w-12 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-1.5 py-0.5 text-center font-mono text-sm text-fg"
          />
        )}
        <SegmentedControl
          options={SEPARATOR_OPTIONS}
          value={option}
          onChange={(next) => {
            setOtherOpen((open) => ({ ...open, [key]: next === 'custom' }))
            if (next !== 'custom') onChangeSeparator(key, SEPARATORS[next])
          }}
          testidPrefix={`field-separator-${key}`}
          labelFor={(o) => (o === 'custom' ? tr('settings.separatorCustom') : SEPARATORS[o].trim())}
          label={tr('settings.separatorLabel', { name: labelOf(key) })}
        />
      </span>
    )
  }
  // The auto-fill toggle, shown on both the visible and hidden lists. Rendered only for a
  // field a release can actually carry: offering it on bpm/key/mood would be a switch that
  // never does anything. A hidden field keeps its toggle — it isn't shown in the form, but
  // it is still written to the file, so it has to be configurable without unhiding it.
  const autoToggle = (key: string): React.JSX.Element => {
    // A field no provider fills gets an empty slot of the same width rather than nothing,
    // so Required/Hide stay on one vertical line down the list instead of jumping left on
    // every row without a toggle.
    if (!IMPORTABLE_FIELDS.includes(key as MetaTextKey)) return <span aria-hidden="true" />
    const on = importFields.includes(key)
    return (
      <button
        type="button"
        data-testid={`field-auto-${key}`}
        aria-pressed={on}
        // The word lives in the column heading, so the cell carries no text of its own —
        // which leaves a screen reader nothing to announce unless the label says it. The
        // field goes in the name too, or thirty rows of "Auto" can't be told apart.
        aria-label={tr('fields.rowAutoFill', { name: labelOf(key) })}
        onClick={() =>
          onChangeImport(on ? importFields.filter((k) => k !== key) : [...importFields, key])
        }
        className={`${TOGGLE_BOX} ${on ? TOGGLE_ON : TOGGLE_OFF}`}
      >
        {on ? (
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
        ) : (
          <CircleDashed className="h-4 w-4" aria-hidden="true" />
        )}
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
  const organizeHintId = useId()
  const organizedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(organizedTimer.current), [])
  // An arrow that moves its field to either end disables itself, and a disabled button
  // drops keyboard focus to the body; once the list re-renders, focus moves to the same
  // row's other arrow so the user keeps their place.
  const listRef = useRef<HTMLDivElement>(null)
  const refocusArrow = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reordered list is the trigger to refocus, not a value read in the body.
  useEffect(() => {
    if (refocusArrow.current === null) return
    listRef.current?.querySelector<HTMLElement>(`[data-arrow="${refocusArrow.current}"]`)?.focus()
    refocusArrow.current = null
  }, [visibleFields])
  function move(i: number, delta: -1 | 1): void {
    const to = i + delta
    if (to === 0) refocusArrow.current = `down-${visibleFields[i]}`
    else if (to === visibleFields.length - 1) refocusArrow.current = `up-${visibleFields[i]}`
    onChangeVisible(moveItem(visibleFields, i, delta))
  }
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
          <p className="text-xs font-medium text-fg-dim">{tr('settings.shown')}</p>
          <button
            type="button"
            data-testid="auto-organize-fields"
            aria-describedby={organizeHintId}
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
          <span id={organizeHintId} className="sr-only">
            {tr('settings.autoOrganizeHint')}
          </span>
          {/* The button's own flip is only seen; this region, mounted empty from the
              start so assistive tech is already listening, says the reorder happened. */}
          <span data-testid="auto-organize-status" role="status" className="sr-only">
            {organized ? tr('settings.autoOrganized') : ''}
          </span>
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
        <div data-testid="fields-columns" className={`${ROW_GRID} ${COLUMN_HEAD}`}>
          <span />
          <span data-testid="fields-column-auto" role="note" className={COLUMN_HEAD_CELL}>
            {tr('settings.autoFill')}
            <Info className="h-3 w-3" aria-hidden="true" />
            {/* The sentence is the note's content for a screen reader and the tooltip's
                label for a pointer — one source, both audiences (as SectionHeader does). */}
            <span className="sr-only">{tr('settings.autoFillHint')}</span>
            <Tooltip label={tr('settings.autoFillHint')} />
          </span>
          <span data-testid="fields-column-required" role="note" className={COLUMN_HEAD_CELL}>
            {tr('settings.required')}
            <Info className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{tr('settings.requiredHint')}</span>
            <Tooltip label={tr('settings.requiredHint')} />
          </span>
          <span />
          <span />
          <span />
        </div>
        <div ref={listRef} className="space-y-1.5">
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
                {nameCell(key)}
                {separatorPicker(key)}
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
                aria-label={tr('fields.rowRequired', { name: labelOf(key) })}
                className={`${TOGGLE_BOX} ${requiredFields.includes(key) ? TOGGLE_ON : TOGGLE_OFF}`}
              >
                {requiredFields.includes(key) ? (
                  <CircleCheck className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <CircleDashed className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                data-arrow={`up-${key}`}
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                aria-label={tr('fields.rowMoveUp', { name: labelOf(key) })}
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                data-arrow={`down-${key}`}
                onClick={() => move(i, 1)}
                disabled={i === visibleFields.length - 1}
                className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                aria-label={tr('fields.rowMoveDown', { name: labelOf(key) })}
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => hide(key)}
                aria-label={tr('fields.rowHide', { name: labelOf(key) })}
                className="ml-1 rounded px-2 py-0.5 text-xs text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
              >
                {tr('settings.hide')}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-fg-dim">{tr('settings.hidden')}</p>
        <div className="space-y-1.5">
          {/* The visible list keeps the user's order (it IS the editor's order); the
              hidden list has none of its own, so it sorts by label for scanning. */}
          {hidden.map(({ key }) => (
            <div
              key={key}
              data-testid={`hidden-field-${key}`}
              // The row grid, not one of its own: both lists sit under the same column
              // headings, so a hidden field's Auto mark has to land in the Auto column.
              // On a narrower grid of its own it drifted under Required instead, reading
              // as if the field were required. The empty spans hold the tracks a hidden
              // row has no control for (required, both arrows).
              className={`${ROW_GRID} rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-1.5 pl-3 pr-2`}
            >
              <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                {nameCell(key)}
              </span>
              {autoToggle(key)}
              <span />
              <span />
              <span />
              <button
                type="button"
                onClick={() => onChangeVisible([...visibleFields, key])}
                aria-label={tr('fields.rowShow', { name: labelOf(key) })}
                className="rounded px-2 py-0.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-panel-2)]"
              >
                {tr('settings.show')}
              </button>
            </div>
          ))}
          {hidden.length === 0 && (
            <p className="text-xs text-fg-faint">{tr('settings.allVisible')}</p>
          )}
        </div>
      </div>

      <AddCustomField
        customFields={customFields}
        onAdd={(field) => {
          onChangeCustom([...customFields, field])
          onChangeVisible([...visibleFields, field.key])
        }}
      />
    </div>
  )
}

const PROBLEM_MESSAGE: Record<CustomKeyProblem, string> = {
  invalid: 'settings.customFieldInvalid',
  taken: 'settings.customFieldTaken',
}

// The row that adds one of the user's own fields: the name the editor shows and the key
// that names it everywhere else, proposed from the name until the user types their own.
function AddCustomField({
  customFields,
  onAdd,
}: {
  customFields: CustomField[]
  onAdd: (field: CustomField) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [label, setLabel] = useState('')
  const [typedKey, setTypedKey] = useState<string | null>(null)
  const key = typedKey ?? suggestCustomKey(label)
  const problem = key ? customKeyProblem(key, customFields) : null
  const blocked = !label.trim() || !key || problem !== null
  const error = problem && tr(PROBLEM_MESSAGE[problem])
  const errorId = useId()
  const add = (): void => {
    if (blocked) return
    onAdd({ key, label: label.trim() })
    setLabel('')
    setTypedKey(null)
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-fg-dim">{tr('settings.customFieldName')}</span>
          <input
            type="text"
            data-testid="custom-field-name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
            className="h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="flex w-44 flex-col gap-1">
          <span
            data-testid="custom-field-key-note"
            role="note"
            className="flex items-center gap-1 text-xs text-fg-dim"
          >
            {tr('settings.customFieldKey')}
            <Info className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{tr('settings.customFieldKeyHint')}</span>
            <Tooltip label={tr('settings.customFieldKeyHint')} />
          </span>
          <input
            type="text"
            data-testid="custom-field-key"
            value={key}
            onChange={(e) => setTypedKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
            aria-invalid={problem !== null}
            aria-describedby={error ? errorId : undefined}
            className={`h-8 rounded-lg border bg-[var(--color-field)] px-2.5 font-mono text-sm outline-none ${
              problem
                ? 'border-[var(--color-danger)]'
                : 'border-[var(--color-line)] focus:border-[var(--color-accent)]'
            }`}
          />
        </label>
        <button
          type="button"
          data-testid="custom-field-add"
          onClick={add}
          disabled={blocked}
          className="press h-8 rounded-lg bg-[var(--color-accent)] px-3 text-sm text-[var(--color-on-accent)] disabled:cursor-not-allowed disabled:bg-[var(--color-panel-2)] disabled:text-fg-faint"
        >
          {tr('settings.customFieldAdd')}
        </button>
      </div>
      {error && (
        // The key field points here for the reason it's invalid; alert says it aloud the
        // moment a typed key collides, without the user having to go looking for it.
        <p
          id={errorId}
          data-testid="custom-field-hint"
          role="alert"
          className="text-xs text-[var(--color-danger)]"
        >
          {error}
        </p>
      )}
    </div>
  )
}
