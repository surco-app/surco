import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from './Tooltip'

const ROW_CLASS =
  'flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-xs text-fg transition-colors hover:bg-[var(--color-hover)]'

export function FilterOption({
  testid,
  Icon,
  dot,
  label,
  count,
  selected,
  onClick,
}: {
  testid: string
  Icon: LucideIcon
  dot?: string | null
  label: string
  count: number
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-testid={testid}
      onClick={onClick}
      className={ROW_CLASS}
    >
      <span className="relative">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {dot && <span className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${dot}`} />}
      </span>
      <span className="flex-1">{label}</span>
      <span className="tabular-nums text-fg-dim">{count}</span>
      <Check aria-hidden="true" className={`size-3 shrink-0 ${selected ? '' : 'invisible'}`} />
    </button>
  )
}

export function FilterDivider(): React.JSX.Element {
  return (
    // A hidden div, not an <hr>: a listbox may own only options, and the divider is
    // decoration, so it stays out of the accessibility tree.
    <div
      aria-hidden="true"
      data-testid="quality-filter-separator"
      className="my-1 border-0 border-t border-[var(--color-line)]"
    />
  )
}

interface Props {
  testid: string
  filterRef?: React.RefObject<HTMLDivElement | null>
  trigger: { Icon: LucideIcon; label: string; count: number; dot?: string | null }
  listLabel: string
  multiselectable?: boolean
  // The option the open menu focuses first, so the arrows continue from the current choice.
  focusTestId: string
  options: (close: () => void) => React.ReactNode
  // Controls that share the row, between the filter trigger and the position counter.
  children?: React.ReactNode
  counterTestId: string
  visibleCount: number
  selectedPosition: number | null
  selectedCount: number
  onRevealSelected: () => void
}

// A column header's filter row: the dropdown trigger with its menu, the controls that share
// the row, and the "x/total" position counter. The menu's options come from the caller;
// this owns opening, focus and the keys, mirroring Select's interaction.
export function FilterBar({
  testid,
  filterRef,
  trigger,
  listLabel,
  multiselectable,
  focusTestId,
  options,
  children,
  counterTestId,
  visibleCount,
  selectedPosition,
  selectedCount,
  onRevealSelected,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-testid="${focusTestId}"]`)?.focus()
  }, [open, focusTestId])

  function close(): void {
    setOpen(false)
    triggerRef.current?.focus()
  }

  // The open menu owns its keys: each handled press stops propagating so the window-level
  // shortcut handler can't also move the track selection behind the popover.
  function onListKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
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
    <div ref={filterRef} data-testid={testid} className="flex items-center gap-1.5 px-1.5 py-2">
      <div className="relative min-w-0 flex-1">
        <button
          ref={triggerRef}
          type="button"
          data-testid={`${testid}-trigger`}
          aria-haspopup="listbox"
          aria-expanded={open}
          // Carries the filter and count it shows: a fixed "Filter" hid which view the list
          // is in and didn't match the words on screen.
          aria-label={tr('sidebar.filter.current', { filter: trigger.label, count: trigger.count })}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pr-1.5 pl-2 text-xs font-medium text-fg-dim outline-none hover:bg-[var(--color-hover)] hover:text-fg"
        >
          <span className="relative shrink-0">
            <trigger.Icon className="h-4 w-4" aria-hidden="true" />
            {trigger.dot && (
              <span
                className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${trigger.dot}`}
              />
            )}
          </span>
          <span className="min-w-0 truncate text-left">{trigger.label}</span>
          <span className="shrink-0 tabular-nums opacity-70">{trigger.count}</span>
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
            <div
              ref={listRef}
              role="listbox"
              aria-multiselectable={multiselectable || undefined}
              data-testid={`${testid}-listbox`}
              aria-label={listLabel}
              onKeyDown={onListKeyDown}
              className="animate-pop-flat origin-top-left absolute left-0 z-50 mt-1 min-w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
            >
              {options(close)}
            </div>
          </>
        )}
      </div>
      {children}
      {selectedCount > 1 ? (
        <span
          data-testid={`${counterTestId}-selected-count`}
          className="relative ml-auto self-center pr-0.5 pl-1 text-xs tabular-nums text-fg-dim"
        >
          {tr('sidebar.selectedCount', { count: selectedCount })}
        </span>
      ) : (
        visibleCount > 0 &&
        (selectedPosition !== null ? (
          <button
            type="button"
            data-testid={`${counterTestId}-position`}
            onClick={onRevealSelected}
            // Bare digits say neither what they count nor that a press scrolls back to it.
            aria-label={tr('sidebar.positionReveal', {
              current: selectedPosition,
              total: visibleCount,
            })}
            className="press relative ml-auto self-center rounded pr-0.5 pl-1 text-xs tabular-nums text-fg-faint outline-none hover:text-fg"
          >
            {`${selectedPosition}/${visibleCount}`}
            <Tooltip label={tr('header.revealSelected')} />
          </button>
        ) : (
          <span
            data-testid={`${counterTestId}-position`}
            className="relative ml-auto self-center pr-0.5 pl-1 text-xs tabular-nums text-fg-faint"
          >
            {`‒/${visibleCount}`}
          </span>
        ))
      )}
    </div>
  )
}
