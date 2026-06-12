import type React from 'react'
import { useRef } from 'react'
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
}

export function Field({
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
}: FieldProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  // A field never offers itself, and an empty field has nothing to insert.
  const insertable = (insertSources ?? []).filter((s) => s.key !== name && s.value.trim() !== '')
  // The menu also formats the field's own text, so on fields that host it
  // (insertSources provided) it appears whenever there is something to insert OR
  // text to format — not only when another field has a value.
  const hasMenu = insertSources !== undefined && (insertable.length > 0 || value.trim() !== '')
  return (
    <label className={`group block ${wide ? 'col-span-1 @[26rem]:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-fg-dim">{label}</span>
      <span className="relative block">
        <input
          ref={inputRef}
          data-testid={`field-${name}`}
          aria-invalid={invalid}
          title={value}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border bg-[var(--color-field)] px-3 py-2 text-sm outline-none ${
            hasMenu ? 'pr-8' : ''
          } ${
            invalid
              ? 'border-danger focus:border-danger'
              : 'border-[var(--color-line)] focus:border-[var(--color-accent)]'
          }`}
        />
        {hasMenu && (
          <FieldInsertMenu
            fieldName={name}
            sources={insertable}
            value={value}
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
}
