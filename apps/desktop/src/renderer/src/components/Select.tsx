import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface SelectOption {
  value: string
  label: string
  // Optional leading glyph, so a menu (e.g. the track sort) reads at a glance like the
  // quality filter's buckets. Options without one stay text-only.
  icon?: LucideIcon
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  label: string
  testid: string
}

// A themed replacement for the native <select>, whose dropdown is drawn by the OS
// and ignores the app's palette. Same interaction pattern as TrackContextMenu:
// focus lands on the current option when it opens (so arrows continue from the
// choice, like a native select), Escape or a click outside closes without picking,
// and focus hands back to the trigger.
export function Select({ value, options, onChange, label, testid }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
    const idx = options.findIndex((o) => o.value === value)
    items?.[Math.max(idx, 0)]?.focus()
  }, [open, options, value])

  function close(): void {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function choose(next: string): void {
    onChange(next)
    close()
  }

  // The open dropdown owns its keys: each handled press stops propagating so the
  // window-level shortcut handler can't also move the track selection (or close an
  // outer modal) behind the popover.
  function onListKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // Let the focused option's own activation run; just keep the press contained.
      e.stopPropagation()
      return
    }
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
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
    e.stopPropagation()
    items[next].focus()
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-testid={testid}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-field)] pr-1.5 pl-2 text-xs text-fg-dim outline-none focus:border-[var(--color-accent)]"
      >
        {selected?.icon && <selected.icon aria-hidden="true" className="size-3.5 shrink-0" />}
        {selected?.label}
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
      {open && (
        <>
          <button
            type="button"
            data-testid={`${testid}-backdrop`}
            aria-label={tr('common.close')}
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            ref={listRef}
            role="listbox"
            data-testid={`${testid}-listbox`}
            aria-label={label}
            onKeyDown={onListKeyDown}
            className="animate-pop absolute right-0 z-50 mt-1 min-w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-xl"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                data-testid={`${testid}-option-${o.value}`}
                onClick={() => choose(o.value)}
                className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-xs text-fg transition-colors hover:bg-[var(--color-panel-2)]"
              >
                <Check
                  aria-hidden="true"
                  className={`size-3 shrink-0 ${o.value === value ? '' : 'invisible'}`}
                />
                {o.icon && <o.icon aria-hidden="true" className="size-3.5 shrink-0" />}
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
