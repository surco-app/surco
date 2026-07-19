import type React from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { csvHas, toggleCsv } from '../lib/csv'
import { FieldInsertMenu, type InsertSource } from './FieldInsertMenu'
import { Tooltip } from './Tooltip'

// How long typing pauses before the edit is committed to the global track array. Each
// keystroke that reaches that array re-runs an O(number of tracks) derived pipeline
// (duplicate scan, quality/format tallies, filter+sort), so on a big crate committing
// per keystroke is what made typing lag. Buffering here and committing on a pause keeps
// the field instant and runs that walk once per edit instead of once per keypress.
const COMMIT_DEBOUNCE_MS = 200

interface FieldProps {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  wide?: boolean
  invalid?: boolean
  placeholder?: string
  suggestions?: string[]
  multiSuggestions?: boolean
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
  wide,
  invalid,
  placeholder,
  suggestions,
  multiSuggestions,
  suggesting,
  insertSources,
  cleanResult,
  formatResult,
}: FieldProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
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
  return (
    <label className={`group block ${wide ? 'col-span-1 @[26rem]:col-span-2' : ''}`}>
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-dim">
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
      </span>
      <span className="relative block">
        <input
          ref={inputRef}
          data-testid={`field-${name}`}
          aria-invalid={invalid}
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
          className={`w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)]/30 px-3 py-2 text-sm outline-none transition-colors placeholder:text-fg-faint hover:border-[var(--color-line-strong)] hover:bg-[var(--color-panel-2)]/50 focus:border-[var(--color-accent)] focus:bg-[var(--color-field)] ${
            hasMenu ? 'pr-8' : ''
          }`}
        />
        {/* The input can't host the themed Tooltip as a child, so it lives on this wrapper
            (the Tooltip anchors to its parentElement): hovering the field still reveals the
            full value when it's clipped, now in the app's own tooltip rather than the
            OS-native one. An empty field gets none — there's nothing to reveal, and an
            open ⋯ menu suppresses it: the menu sits inside this same wrapper, so the
            value tooltip would float over its rows. */}
        {draft && !menuOpen && <Tooltip label={draft} hoverOnly />}
        {hasMenu && (
          <FieldInsertMenu
            fieldName={name}
            sources={insertable}
            value={draft}
            cleanResult={cleanResult}
            formatResult={formatResult}
            inputRef={inputRef}
            onChange={commit}
            onOpenChange={setMenuOpen}
          />
        )}
      </span>
      {/* Detecting the audio suggestion (BPM/Key): a placeholder chip in the exact shape
          of the real one, so the detected value swaps in without popping into empty space.
          Drops out the moment a real suggestion arrives (or the probe fails → no chip). */}
      {suggesting && !(suggestions && suggestions.length > 0) && (
        <span className="mt-1.5 flex">
          <span
            data-testid={`suggestion-loading-${name}`}
            aria-hidden="true"
            className="h-[18px] w-11 animate-pulse rounded-full border border-[var(--color-line-strong)] bg-[var(--color-panel-2)]"
          />
        </span>
      )}
      {suggestions && suggestions.length > 0 && (
        <span
          data-testid="field-suggestions"
          className="mt-1.5 flex gap-1.5 overflow-x-auto"
        >
          {suggestions.map((s) => {
            const on = multiSuggestions ? csvHas(draft, s) : draft === s
            return (
              <button
                key={s}
                type="button"
                data-testid={`chip-${s}`}
                onClick={() => commit(multiSuggestions ? toggleCsv(draft, s) : on ? '' : s)}
                className={`press shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  on
                    ? 'border-transparent bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                    : 'border-[var(--color-line-strong)] text-fg-muted hover:bg-[var(--color-panel-2)]'
                }`}
              >
                {s}
              </button>
            )
          })}
        </span>
      )}
    </label>
  )
})
