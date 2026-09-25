import type React from 'react'
import { memo, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TagList } from '../lib/bulkEdit'
import { csvHas, toggleCsv } from '../lib/csv'
import type { FieldWidth } from '../lib/fields'
import { FieldInsertMenu, type InsertSource } from './FieldInsertMenu'
import { SuggestionChips } from './SuggestionChips'

// How long typing pauses before the edit is committed to the global track array. Each
// keystroke that reaches that array re-runs an O(number of tracks) derived pipeline
// (duplicate scan, quality/format tallies, filter+sort), so on a big crate committing
// per keystroke is what made typing lag. Buffering here and committing on a pause keeps
// the field instant and runs that walk once per edit instead of once per keypress.
const COMMIT_DEBOUNCE_MS = 200

// Sized for the longest value each tag holds: "128.5" or "10A" in a short box, a hyphenated
// ISRC in a medium one.
const WIDTH_CLASS: Record<FieldWidth, string> = { short: 'w-[4.5rem]', medium: 'w-36' }

interface FieldProps {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  width?: FieldWidth
  // Joined onto a row after another bounded field: the label sits beside the box instead of
  // in the form's label column.
  inline?: boolean
  // The bounded fields that follow this one on its row.
  trailing?: React.ReactNode
  required?: boolean
  // Required and still empty: drawn as the amber dot, read out as a description.
  invalid?: boolean
  // The selection's tracks disagree: described in words, since the placeholder saying so
  // is dropped by screen readers once the field has focus.
  mixed?: boolean
  placeholder?: string
  suggestions?: string[]
  tagList?: TagList
  // An audio-derived suggestion (BPM/Key) is still being detected — show a placeholder
  // chip until the real one lands, so it doesn't pop into empty space.
  suggesting?: boolean
  insertSources?: InsertSource[]
  cleanResult?: string
  formatResult?: string
}

// Memoized so a keystroke in one field doesn't re-render every other visible field:
// the editor hands each Field a stable onChange (setField is identity-stable) and a
// primitive value, so only the field whose value changed re-renders.
export const Field = memo(function Field({
  name,
  label,
  value,
  onChange,
  width,
  inline,
  trailing,
  required,
  invalid,
  mixed,
  placeholder,
  suggestions,
  tagList,
  suggesting,
  insertSources,
  cleanResult,
  formatResult,
}: FieldProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const { t: tr } = useTranslation()
  const inputId = useId()
  const requiredNoteId = useId()
  const mixedNoteId = useId()
  const describedBy =
    [invalid && requiredNoteId, mixed && mixedNoteId].filter(Boolean).join(' ') || undefined
  // The text the input shows while the user types, kept local so a keystroke doesn't
  // touch the global track array (and its O(n) pipeline) until they pause or leave.
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Whether the user has an edit in flight the global state hasn't caught up to yet
  // (typed but the debounce hasn't fired). The Editor remounts per track (key={track.id}),
  // so a new track selected arrives as a fresh mount, not a `value` prop change — which
  // leaves exactly one reason `value` changes under a mounted field: the state moved on
  // its own (an undo, a landed auto-match, an applied Discogs release). We adopt that only
  // when the field is clean; if the user is mid-edit their words win, so a match landing on
  // the very row they're typing into can't silently revert it a few seconds later.
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setDraft(value)
  }, [value])
  // Commit now: flush any pending debounce and push the buffered text up. Used by the
  // debounce, by blur, and by the chips/menu so every path funnels through one place.
  function commit(next: string): void {
    clearTimeout(timer.current)
    dirty.current = false
    setDraft(next)
    onChange(next)
  }
  function onType(next: string): void {
    dirty.current = true
    setDraft(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(next), COMMIT_DEBOUNCE_MS)
  }
  // The form is keyboard-first, so Enter commits what's typed at once (no waiting on the
  // pause-debounce) and moves to the next field — type→Enter→type walks a whole release
  // in without the mouse. The "next field" is the following field-* input in DOM order, the
  // same set Tab steps through; the last field just commits with nowhere to advance. Any
  // modifier (⌘/Ctrl/Alt/Shift, and the IME composition Enter) is left alone so it can't
  // steal ⌘⏎ (convert) or an insert-menu selection.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (
      e.key !== 'Enter' ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.shiftKey ||
      e.nativeEvent.isComposing
    )
      return
    e.preventDefault()
    commit(draft)
    const fields = Array.from(
      document.querySelectorAll<HTMLElement>('input[data-testid^="field-"]'),
    )
    const next = fields[fields.indexOf(e.currentTarget) + 1]
    next?.focus()
  }
  // A late debounce firing after the field unmounts (track deselected mid-edit) would
  // commit into a gone editor; clear it on unmount. Blur already flushes the common case.
  useEffect(() => () => clearTimeout(timer.current), [])
  // A field never offers itself, and an empty field has nothing to insert.
  const insertable = (insertSources ?? []).filter((s) => s.key !== name && s.value.trim() !== '')
  // The menu also formats the field's own text and can offer a "without version"
  // result, so on fields that host it (insertSources provided) it appears whenever
  // there is something to insert, text to format, OR a clean-up to apply.
  const hasMenu =
    insertSources !== undefined &&
    (insertable.length > 0 || draft.trim() !== '' || !!cleanResult || !!formatResult)
  const labelEl = (
    <label
      htmlFor={inputId}
      className={`flex items-center gap-1.5 text-xs font-medium text-fg-dim ${
        inline
          ? 'min-h-[34px] flex-row-reverse whitespace-nowrap'
          : width
            ? 'min-h-[34px] @[28rem]:col-start-1 @[28rem]:self-start @[28rem]:max-w-32 @[28rem]:flex-row-reverse @[28rem]:justify-start @[28rem]:text-right'
            : 'mb-1.5 @[28rem]:col-start-1 @[28rem]:mb-0 @[28rem]:min-h-[34px] @[28rem]:max-w-32 @[28rem]:flex-row-reverse @[28rem]:justify-start @[28rem]:text-right'
      }`}
    >
      {label}
      {/* A required field that's still empty isn't an error the user made — it's a
            calm "you'll need this before converting" cue. Reserve danger-red for true
            mistakes and mark the gap with an amber dot, the app's own attention colour. */}
      {invalid && (
        <span
          data-testid={`field-required-${name}`}
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-warn"
        />
      )}
    </label>
  )
  const control = (
    <>
      <span className={`relative block ${width ? '' : '@[28rem]:col-start-2'}`}>
        <input
          ref={inputRef}
          id={inputId}
          data-testid={`field-${name}`}
          // Empty-but-required is not a wrong entry, so it isn't aria-invalid: the field
          // says it is required and, while empty, describes why the dot is there.
          aria-required={required || undefined}
          aria-describedby={describedBy}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          // An empty field should recede, not punch a dark hole in the panel: the fill
          // sits a hair above the panel (not the heavy near-black --color-field), the
          // border defines the input, and focus brings the accent ring + surface up.
          // A column of empty Album/Year/Genre boxes used to read as heavy black slabs
          // that dominated the form; now they wait quietly until you engage one.
          className={`w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)]/30 px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-fg-faint hover:border-[var(--color-line-strong)] hover:bg-[var(--color-panel-2)]/50 focus:border-[var(--color-accent)] focus:bg-[var(--color-field)] ${
            hasMenu ? 'pr-8' : ''
          }`}
        />
        {hasMenu && (
          <FieldInsertMenu
            fieldName={name}
            sources={insertable}
            value={draft}
            cleanResult={cleanResult}
            formatResult={formatResult}
            inputRef={inputRef}
            onChange={commit}
          />
        )}
      </span>
      {invalid && (
        <span id={requiredNoteId} className="sr-only">
          {tr('editor.requiredEmpty')}
        </span>
      )}
      {mixed && (
        <span id={mixedNoteId} className="sr-only">
          {tr('editor.multipleValues')}
        </span>
      )}
      {/* Detecting the audio suggestion (BPM/Key): a placeholder chip in the exact shape
          of the real one, so the detected value swaps in without popping into empty space.
          Drops out the moment a real suggestion arrives (or the probe fails → no chip). */}
      {suggesting && !(suggestions && suggestions.length > 0) && (
        <span className={`mt-1.5 flex ${width ? '' : '@[28rem]:col-start-2 @[28rem]:mt-0'}`}>
          <span
            data-testid={`suggestion-loading-${name}`}
            aria-hidden="true"
            className="skeleton-sweep h-[18px] w-11 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-panel-2)]"
          />
        </span>
      )}
      {suggestions && suggestions.length > 0 && (
        <div className={width ? '' : '@[28rem]:col-start-2 @[28rem]:-mt-1.5'}>
          <SuggestionChips
            suggestions={suggestions}
            isOn={(s) =>
              tagList ? csvHas(draft, s, tagList.whole, tagList.separator) : draft === s
            }
            onPick={(s) =>
              commit(
                tagList
                  ? toggleCsv(draft, s, tagList.whole, tagList.separator)
                  : draft === s
                    ? ''
                    : s,
              )
            }
          />
        </div>
      )}
    </>
  )
  if (!width) {
    return (
      // A wrapping <label> would fold the { } menu button and every chip into the input's
      // accessible name, so the label points at the input by id and the rest sits beside it.
      // From 28rem the field's parts join the form's two-track grid directly (contents), so
      // every label shares one column and every input the other; the chips sit under their
      // input.
      <div className="group block @[28rem]:contents">
        {labelEl}
        {control}
      </div>
    )
  }
  // A bounded field keeps its box and chips in one column of its own width, so a detected
  // BPM chip stays under the BPM box when other short fields follow it on the row.
  const column = (
    <div
      data-testid={`field-column-${name}`}
      className={`relative flex shrink-0 flex-col ${WIDTH_CLASS[width]}`}
    >
      {control}
    </div>
  )
  if (inline) {
    return (
      <div className="group flex items-start gap-2">
        {labelEl}
        {column}
      </div>
    )
  }
  // The first field of a row: its label takes the form's label column and the fields that
  // follow it (trailing) line up beside its box, wrapping when the column runs out.
  return (
    <div className="group flex items-start gap-2 @[28rem]:contents">
      {labelEl}
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 @[28rem]:col-start-2">
        {column}
        {trailing}
      </div>
    </div>
  )
})
