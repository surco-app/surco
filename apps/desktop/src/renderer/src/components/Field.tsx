import type React from 'react'
import { memo, useRef } from 'react'
import { csvHas, toggleCsv } from '../lib/csv'
import { FieldInsertMenu, type InsertSource } from './FieldInsertMenu'

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
  insertSources?: InsertSource[]
  cleanResult?: string
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
  insertSources,
  cleanResult,
}: FieldProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  // A field never offers itself, and an empty field has nothing to insert.
  const insertable = (insertSources ?? []).filter((s) => s.key !== name && s.value.trim() !== '')
  // The menu also formats the field's own text and can offer a "without version"
  // result, so on fields that host it (insertSources provided) it appears whenever
  // there is something to insert, text to format, OR a clean-up to apply.
  const hasMenu =
    insertSources !== undefined && (insertable.length > 0 || value.trim() !== '' || !!cleanResult)
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
          title={value}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] ${
            hasMenu ? 'pr-8' : ''
          }`}
        />
        {hasMenu && (
          <FieldInsertMenu
            fieldName={name}
            sources={insertable}
            value={value}
            cleanResult={cleanResult}
            inputRef={inputRef}
            onChange={onChange}
          />
        )}
      </span>
      {suggestions && suggestions.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => {
            const on = multiSuggestions ? csvHas(value, s) : value === s
            return (
              <button
                key={s}
                type="button"
                data-testid={`chip-${s}`}
                onClick={() => onChange(multiSuggestions ? toggleCsv(value, s) : on ? '' : s)}
                className={`press rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  on
                    ? 'border-transparent bg-[var(--color-accent)] text-white'
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
