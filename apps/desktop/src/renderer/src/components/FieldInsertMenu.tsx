import { Ellipsis } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { titleCase } from '../lib/textCase'

export interface InsertSource {
  key: string
  label: string
  value: string
}

interface Props {
  fieldName: string
  sources: InsertSource[]
  // The field's current value, for the case transforms and their previews.
  value: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (value: string) => void
}

// In-field actions menu: inserts the current value of another metadata field at
// the caret ("add the year to the title" without retyping), and fixes the value's
// case (rip tags often arrive ALL CAPS). It inserts the resolved value — never a
// live {token} — because tags must store final strings; template behaviour stays
// in the filename's RenameModal. Same interaction pattern as Select: backdrop
// click or Escape closes, arrows cycle, focus hands back to the input. The caret
// is captured on the trigger's mousedown, while the input still has focus (the
// click itself blurs it); when the input wasn't focused at all the value appends
// at the end, which matches the common intent.
export function FieldInsertMenu({
  fieldName,
  sources,
  value,
  inputRef,
  onChange,
}: Props): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<{ start: number; end: number } | null>(null)
  const fromMouseRef = useRef(false)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  // Only the transforms that change something: offering "UPPERCASE" on an
  // already-uppercase field would be a dead action that makes the menu feel
  // broken. The labels themselves demonstrate each effect, so no preview is
  // redundant with them.
  const transforms = [
    { key: 'case-title', label: tr('editor.caseTitle'), result: titleCase(value) },
    { key: 'case-lower', label: tr('editor.caseLower'), result: value.toLocaleLowerCase() },
    { key: 'case-upper', label: tr('editor.caseUpper'), result: value.toLocaleUpperCase() },
  ].filter((t) => t.result !== value)

  if (sources.length === 0 && transforms.length === 0) return null

  function captureCaret(): void {
    const el = inputRef.current
    if (!el) return
    caretRef.current =
      document.activeElement === el
        ? { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length }
        : { start: el.value.length, end: el.value.length }
  }

  function close(): void {
    setOpen(false)
    const el = inputRef.current
    el?.focus()
    const caret = caretRef.current
    if (caret) el?.setSelectionRange(caret.start, caret.end)
  }

  function pick(value: string): void {
    const el = inputRef.current
    if (!el) return
    const caret = caretRef.current ?? { start: el.value.length, end: el.value.length }
    onChange(el.value.slice(0, caret.start) + value + el.value.slice(caret.end))
    setOpen(false)
    const at = caret.start + value.length
    // The controlled value lands on the next render; focus and place the caret
    // after it so the inserted text is not left selected or out of view.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(at, at)
    })
  }

  // Unlike an insert, a transform replaces the whole value; the caret lands at
  // the end, like after typing.
  function applyTransform(result: string): void {
    onChange(result)
    setOpen(false)
    requestAnimationFrame(() => {
      const el = inputRef.current
      el?.focus()
      el?.setSelectionRange(result.length, result.length)
    })
  }

  function onMenuKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      close()
      return
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    if (items.length === 0) return
    const idx = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = idx < items.length - 1 ? idx + 1 : 0
    else if (e.key === 'ArrowUp') next = idx > 0 ? idx - 1 : items.length - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next === -1) return
    e.preventDefault()
    items[next].focus()
  }

  return (
    <>
      <button
        type="button"
        data-testid={`field-insert-${fieldName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={tr('editor.fieldActions')}
        title={tr('editor.fieldActions')}
        onMouseDown={() => {
          fromMouseRef.current = true
          captureCaret()
        }}
        onClick={() => {
          if (!fromMouseRef.current) captureCaret()
          fromMouseRef.current = false
          setOpen((v) => !v)
        }}
        className={`absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-fg-faint transition-opacity hover:text-fg-dim focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Ellipsis className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <>
          <button
            type="button"
            data-testid="field-insert-backdrop"
            aria-label={tr('common.close')}
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            ref={menuRef}
            role="menu"
            data-testid="field-insert-menu"
            aria-label={tr('editor.fieldActions')}
            onKeyDown={onMenuKeyDown}
            className="animate-pop absolute top-full right-0 z-50 mt-1 max-h-64 min-w-[220px] overflow-y-auto rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-xl"
          >
            {sources.map((s) => (
              <button
                key={s.key}
                type="button"
                role="menuitem"
                data-testid={`field-insert-option-${s.key}`}
                onClick={() => pick(s.value)}
                className="flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-panel-2)]"
              >
                <span className="shrink-0 text-fg">{s.label}</span>
                <span className="max-w-[11rem] truncate text-fg-faint">{s.value}</span>
              </button>
            ))}
            {sources.length > 0 && transforms.length > 0 && (
              <div className="my-1 border-t border-[var(--color-line)]" />
            )}
            {transforms.map((t) => (
              <button
                key={t.key}
                type="button"
                role="menuitem"
                data-testid={`field-insert-option-${t.key}`}
                onClick={() => applyTransform(t.result)}
                className="flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-panel-2)]"
              >
                <span className="shrink-0 text-fg">{t.label}</span>
                <span className="max-w-[11rem] truncate text-fg-faint">{t.result}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
