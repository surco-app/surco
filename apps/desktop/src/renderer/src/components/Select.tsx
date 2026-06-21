import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  // Stretch the trigger to fill its container (and truncate a long label) instead of
  // sizing to content — for a field-like use such as the album-match track picker. In this
  // mode the menu is portaled to the body so it can grow to its widest option without being
  // clipped by a scrolling ancestor (the Discogs column), rather than cramped to the field.
  fullWidth?: boolean
}

// A themed replacement for the native <select>, whose dropdown is drawn by the OS
// and ignores the app's palette. Same interaction pattern as TrackContextMenu:
// focus lands on the current option when it opens (so arrows continue from the
// choice, like a native select), Escape or a click outside closes without picking,
// and focus hands back to the trigger.
export function Select({
  value,
  options,
  onChange,
  label,
  testid,
  fullWidth = false,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  // Where the portaled (full-width) menu sits, measured from the trigger when it opens.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
    const idx = options.findIndex((o) => o.value === value)
    items?.[Math.max(idx, 0)]?.focus()
  }, [open, options, value])

  function toggle(): void {
    if (open) {
      close()
      return
    }
    // Anchor the portaled menu under the trigger before it opens, so it renders in place
    // with no first-frame jump.
    if (fullWidth) {
      const r = triggerRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpen(true)
  }

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

  const list = (
    <div
      ref={listRef}
      role="listbox"
      data-testid={`${testid}-listbox`}
      aria-label={label}
      onKeyDown={onListKeyDown}
      // Full-width: fixed and body-portaled, sized to content (min the trigger width) and
      // capped to the viewport so a long tracklist scrolls. Otherwise: absolute, right-
      // aligned and at least the trigger width.
      className={`animate-pop z-50 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-xl ${
        fullWidth
          ? 'fixed max-h-[60vh] max-w-[calc(100vw-1rem)] overflow-auto'
          : 'absolute right-0 mt-1 min-w-full'
      }`}
      style={fullWidth && pos ? { top: pos.top, left: pos.left, minWidth: pos.width } : undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === value}
          data-testid={`${testid}-option-${o.value}`}
          onClick={() => choose(o.value)}
          className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-xs text-fg transition-colors hover:bg-[var(--color-panel-2)]"
        >
          {o.icon && <o.icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
          <span className="flex-1">{o.label}</span>
          <Check
            aria-hidden="true"
            className={`size-3 shrink-0 ${o.value === value ? '' : 'invisible'}`}
          />
        </button>
      ))}
    </div>
  )

  return (
    <div className={`relative min-w-0 ${fullWidth ? 'w-full' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testid}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        className={`flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-field)] pr-1.5 pl-2 text-xs text-fg-dim outline-none focus:border-[var(--color-accent)] ${fullWidth ? 'w-full' : ''}`}
      >
        {selected?.icon && <selected.icon aria-hidden="true" className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
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
          {fullWidth ? pos && createPortal(list, document.body) : list}
        </>
      )}
    </div>
  )
}
