import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { type MenuPlacement, placeMenu, useCloseOnMove } from './menuPlacement'

interface SelectOption {
  value: string
  label: string
  // Optional leading glyph, so a menu (e.g. the track sort) reads at a glance like the
  // quality filter's buckets. Options without one stay text-only.
  icon?: LucideIcon
  // Optional example shown after the label in the menu only, such as what a separator
  // writes ("Pop; House"), so a terse label still says what picking it does.
  hint?: string
  // What the trigger shows instead of the label, for a menu in a row too narrow for it;
  // empty leaves the chevron alone. The accessible name keeps the full label.
  short?: string
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
  // A trigger the height of a line of text, for a menu that sits inside a list row
  // without making the row taller.
  compact?: boolean
  // Repeats the label as a title at the top of the open menu, for a menu whose options
  // are too terse to say what they choose.
  heading?: boolean
  // Text and a chevron with no box, for a filter or sort in a column header, where the
  // header is chrome around the list rather than a form. The hover tint shows it is a control.
  bare?: boolean
  // Portal the menu and its backdrop to the body like a full-width one, without stretching
  // the trigger, for a select inside a layered container (the track list's sticky header)
  // that would otherwise trap both below the controls around it.
  portal?: boolean
  split?: boolean
  onClosed?: () => void
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
  compact = false,
  heading = false,
  bare = false,
  portal = false,
  split = false,
  onClosed,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  // Where the portaled (full-width) menu sits, measured from the trigger when it opens.
  const [pos, setPos] = useState<MenuPlacement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLButtonElement>(null)
  const openIndex = useRef(0)
  const selected = options.find((o) => o.value === value)
  // In a menu with examples, an option without one sets its label like them, in their
  // column and type, instead of starting in the narrow label column, so it reads as part of
  // the same list.
  const hinted = options.some((o) => o.hint)
  const portaled = fullWidth || portal
  const look = split
    ? 'rounded-r-lg border-l border-[var(--color-on-accent)]/25 bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]'
    : bare
      ? 'rounded-md text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg'
      : 'rounded-md border border-[var(--color-line)] bg-[var(--color-field)] text-fg-dim focus:border-[var(--color-accent)]'

  // The focus lands on the chosen option once, when the menu opens: callers rebuild their
  // options on every render, and following them would yank the focus, and the list, back
  // to the chosen one while the user scrolls away from it.
  useEffect(() => {
    if (!open) return
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
    const item = items?.[openIndex.current]
    if (item) showOption(listRef.current, item)
  }, [open])

  // An inline menu hangs from its trigger and moves with it, so it has nothing to dismiss.
  useCloseOnMove(open && portaled, listRef, setOpen)

  function toggle(): void {
    if (open) {
      close()
      return
    }
    // Anchor the portaled menu against the trigger before it opens, so it renders in place
    // with no first-frame jump.
    openIndex.current = Math.max(
      options.findIndex((o) => o.value === value),
      0,
    )
    if (portaled) {
      const r = triggerRef.current?.getBoundingClientRect()
      if (r) setPos(placeMenu(r))
    }
    setOpen(true)
  }

  function close(): void {
    setOpen(false)
    if (onClosed) onClosed()
    else triggerRef.current?.focus()
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
    // Every other key stays in the menu too: j/k and friends would otherwise reach the
    // global shortcuts and move the track list behind it.
    e.stopPropagation()
    if (next === -1) return
    e.preventDefault()
    showOption(listRef.current, items[next])
  }

  const list = (
    <div
      ref={listRef}
      role="listbox"
      data-testid={`${testid}-listbox`}
      aria-label={label}
      onKeyDown={onListKeyDown}
      // Tab (or any move of the focus to another control) closes the menu, like a native
      // select; the focus stays where the user sent it. The trigger and the backdrop are
      // left to their own clicks, which close and hand the focus back to the trigger.
      onBlur={(e) => {
        const to = e.relatedTarget
        if (!to || e.currentTarget.contains(to)) return
        if (to === triggerRef.current || to === backdropRef.current) return
        setOpen(false)
      }}
      // Portaled: fixed and in the body, sized to content (min the trigger width) and
      // capped to the room on the side it opens toward so a long tracklist scrolls.
      // Otherwise: absolute, right-aligned and at least the trigger width.
      className={`animate-pop-flat z-50 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)] ${
        portaled
          ? `fixed max-w-[calc(100vw-1rem)] overflow-auto ${pos?.bottom !== undefined ? 'origin-bottom-left' : 'origin-top-left'}`
          : 'absolute right-0 mt-1 min-w-full origin-top-right'
      }`}
      style={
        portaled && pos
          ? {
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              minWidth: pos.minWidth,
              maxHeight: pos.maxHeight,
            }
          : undefined
      }
    >
      {heading && (
        <div
          aria-hidden="true"
          className="whitespace-nowrap px-2 pt-1 pb-1.5 text-[11px] text-fg-faint"
        >
          {label}
        </div>
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === value}
          data-testid={`${testid}-option-${o.value}`}
          onClick={() => choose(o.value)}
          className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-[var(--color-hover)]"
        >
          {o.icon && <o.icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
          {hinted ? (
            <>
              <span className="w-3 shrink-0">{o.hint && o.label}</span>
              <span className="flex-1 font-mono text-fg-faint">{o.hint ?? o.label}</span>
            </>
          ) : (
            <span className="flex-1">{o.label}</span>
          )}
          <Check
            aria-hidden="true"
            className={`size-3 shrink-0 ${o.value === value ? '' : 'invisible'}`}
          />
        </button>
      ))}
    </div>
  )

  // Out of the Tab order: a Shift+Tab from the first option landed on this invisible
  // full-window button and kept the menu open behind it. In the body it sits beside any
  // open dialog, so it takes the menu's own layer to stay over the dialog's overlay.
  const backdrop = (
    <button
      ref={backdropRef}
      type="button"
      tabIndex={-1}
      data-testid={`${testid}-backdrop`}
      aria-label={tr('common.close')}
      onClick={close}
      className={`fixed inset-0 cursor-default ${portaled ? 'z-50' : 'z-40'}`}
    />
  )

  return (
    <div className={`relative min-w-0 ${fullWidth ? 'w-full' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testid}
        aria-haspopup="listbox"
        aria-expanded={open}
        // The label alone hid the visible value from VoiceOver; a native select announces
        // both, so this one does too.
        aria-label={selected ? `${label}: ${selected.label}` : label}
        onClick={toggle}
        // ↑/↓ open a closed select like a native one, and stay here: left to bubble, they
        // drove the keyboard roving of whatever list the select sits in.
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          e.preventDefault()
          e.stopPropagation()
          if (!open) toggle()
        }}
        className={`flex min-w-0 items-center gap-1.5 pr-1.5 pl-2 text-xs outline-none ${look} ${compact ? 'h-6' : 'h-8'} ${fullWidth ? 'w-full' : ''}`}
      >
        {selected?.icon && <selected.icon aria-hidden="true" className="size-3.5 shrink-0" />}
        {(selected?.short ?? selected?.label) && (
          <span className="min-w-0 flex-1 truncate text-left">
            {selected?.short ?? selected?.label}
          </span>
        )}
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
      </button>
      {open &&
        (portaled ? (
          pos &&
          createPortal(
            <>
              {backdrop}
              {list}
            </>,
            document.body,
          )
        ) : (
          <>
            {backdrop}
            {list}
          </>
        ))}
    </div>
  )
}

// A plain focus scrolls every ancestor to show the option, and an ancestor's scroll closes
// the menu; only the list itself is scrolled, which leaves it open.
export function showOption(list: HTMLElement | null, item: HTMLElement): void {
  item.focus({ preventScroll: true })
  if (!list) return
  const top = item.offsetTop
  const bottom = top + item.offsetHeight
  if (top < list.scrollTop) list.scrollTop = top
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
}
