import { Check, ChevronDown, type LucideIcon, Search } from 'lucide-react'
import type React from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { foldText } from '../lib/normalizeText'
import { type MenuPlacement, placeMenu, useCloseOnMove } from './menuPlacement'
import { showOption } from './Select'
import { Tooltip } from './Tooltip'

const ROW_CLASS =
  'flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-xs text-fg transition-colors hover:bg-[var(--color-hover)] group data-[empty]:text-fg-faint'

export interface MeasureProgress {
  fraction: number
  title: string
}

const RING_RADIUS = 10
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

// How far a filter's background measuring got, as a ring that closes as it goes: it sits
// round the filter's own icon and costs the row no width, where a percentage read as a
// second count beside the real one.
function ProgressRing({
  testid,
  progress,
  className,
}: {
  testid: string
  progress: MeasureProgress
  className: string
}): React.JSX.Element {
  return (
    <span
      data-testid={testid}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(progress.fraction * 100)}
      aria-label={progress.title}
      className={className}
    >
      <svg viewBox="0 0 22 22" className="size-full -rotate-90" aria-hidden="true">
        <circle
          cx="11"
          cy="11"
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-line-strong)"
          strokeWidth="1.8"
        />
        <circle
          cx="11"
          cy="11"
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - progress.fraction)}
        />
      </svg>
      <Tooltip label={progress.title} />
    </span>
  )
}

export function FilterOption({
  testid,
  Icon,
  dot,
  label,
  count,
  progress,
  unknown,
  selected,
  onClick,
}: {
  testid: string
  Icon: LucideIcon
  dot?: string | null
  label: string
  count: number
  progress?: MeasureProgress
  // Not measured yet: the count is shown as unknown, never as a 0 it has not found.
  unknown?: boolean
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-testid={testid}
      data-empty={count === 0 && !selected && !progress && !unknown ? '' : undefined}
      onClick={onClick}
      className={ROW_CLASS}
    >
      <span className="relative group-data-[empty]:opacity-50">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {progress && (
          <ProgressRing
            testid={`${testid}-progress`}
            progress={progress}
            className="absolute -inset-[3px]"
          />
        )}
        {dot && !progress && (
          <span
            data-testid={`${testid}-dot`}
            className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${dot}`}
          />
        )}
      </span>
      <span className="flex-1">{label}</span>
      <span className="tabular-nums text-fg-dim group-data-[empty]:text-fg-faint">
        {unknown ? '–' : count}
      </span>
      <Check aria-hidden="true" className={`size-3 shrink-0 ${selected ? '' : 'invisible'}`} />
    </button>
  )
}

export interface PaneOption {
  id: string
  Icon: LucideIcon
  dot?: string | null
  label: string
  count: number
  progress?: MeasureProgress
  unknown?: boolean
  // The heading the filter sits under inside its section, for a section that groups them.
  group?: string
  selected: boolean
  onPick: () => void
}

export interface PaneSection {
  key: string
  label: string
  options: PaneOption[]
  // What the pane says when the section has no options to offer.
  empty?: string
}

// How long the pointer rests on a section before its options replace the pane. Crossing
// the column on the way to an option passes over other sections; switching on the first
// touch swapped the pane out from under the pointer.
export const SECTION_HOVER_DELAY = 120

// A filter menu too long for one list: the sections down the left, always the same ones in
// the same order, and the chosen section's filters on the right. The menu keeps its height
// however many filters a section grows. ↑↓ walk the sections, → steps into the filters and
// ← steps back. Typing searches every section at once, for whoever knows the filter's name
// and not where it lives; Escape drops the search before it closes the menu.
export function FilterPanes({
  testid,
  sections,
  sectionsLabel,
  shown,
  clearLabel,
  canClear,
  onClear,
  searching,
  noMatch,
  lastSection,
  onSectionShown,
}: {
  testid: string
  sections: PaneSection[]
  // The section shown when the menu last closed, where it opens again while nothing is picked.
  lastSection?: string | null
  onSectionShown?: (key: string) => void
  sectionsLabel: string
  shown: string
  clearLabel: string
  canClear: boolean
  onClear: () => void
  searching: (query: string) => string
  noMatch: (query: string) => string
}): React.JSX.Element {
  const id = useId()
  const firstPicked = sections.find((s) => s.options.some((o) => o.selected))
  const remembered = sections.find((s) => s.key === lastSection)?.key
  const [current, setCurrent] = useState(firstPicked?.key ?? remembered ?? sections[0]?.key)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reports the section shown, the caller's callback is not a trigger
  useEffect(() => {
    if (current) onSectionShown?.(current)
  }, [current])
  const section = sections.find((s) => s.key === current) ?? sections[0]
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const tabs = (): HTMLElement[] =>
    Array.from(tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
  const options = (): HTMLElement[] =>
    Array.from(paneRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
  const tabOf = (key: string): HTMLElement | undefined =>
    tabs().find((t) => t.dataset.section === key)

  // Opening lands on the picked filter, so the arrows continue from the current choice;
  // with nothing picked it lands on the first section.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only where the menu opens
  useLayoutEffect(() => {
    const picked = options().find((o) => o.getAttribute('aria-selected') === 'true')
    if (picked) showOption(paneRef.current, picked)
    else {
      const tab = tabOf(current)
      if (tab) showOption(tabsRef.current, tab)
    }
  }, [])
  useEffect(() => () => clearTimeout(hoverTimer.current), [])

  const folded = foldText(query.trim())
  const groups = folded
    ? sections
        .map((s) => ({
          section: s,
          options: foldText(s.label).includes(folded)
            ? s.options
            : s.options.filter((o) => foldText(o.label).includes(folded)),
        }))
        .filter((g) => g.options.length > 0)
    : [{ section, options: section.options }]

  // What the pane lists: the matches section by section while searching, else the chosen
  // section, split under its own headings where its filters come in groups.
  const blocks: { key: string; label?: string; options: PaneOption[] }[] = query
    ? groups.map((g) => ({ key: g.section.key, label: g.section.label, options: g.options }))
    : section.options.reduce<{ key: string; label?: string; options: PaneOption[] }[]>((acc, o) => {
        const last = acc[acc.length - 1]
        if (last && last.label === o.group) last.options.push(o)
        else acc.push({ key: o.group ?? o.id, label: o.group, options: [o] })
        return acc
      }, [])

  // Each keystroke lands on the first match, so Enter picks it and the arrows walk the rest.
  // With nothing matching the menu itself keeps the focus, or the next key would reach the
  // list behind it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus only when the search changes
  useLayoutEffect(() => {
    if (!query) return
    const first = options()[0]
    if (first) showOption(paneRef.current, first)
    else rootRef.current?.focus({ preventScroll: true })
  }, [query])

  function pickSection(key: string): void {
    clearTimeout(hoverTimer.current)
    setQuery('')
    setCurrent(key)
  }

  function onSearchKey(e: React.KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false
    if (e.key === 'Escape' && query) {
      setQuery('')
      const tab = tabOf(current)
      if (tab) showOption(tabsRef.current, tab)
    } else if (e.key === 'Backspace' && query) setQuery(query.slice(0, -1))
    else if (e.key.length === 1 && e.key !== ' ') setQuery(query + e.key)
    else return false
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (onSearchKey(e)) return
    const target = e.target as HTMLElement
    const onTab = target.getAttribute('role') === 'tab'
    const list = onTab ? tabs() : options()
    const idx = list.indexOf(target)
    let next: HTMLElement | undefined
    if (e.key === 'ArrowDown') next = list[idx < list.length - 1 ? idx + 1 : 0]
    else if (e.key === 'ArrowUp') next = list[idx > 0 ? idx - 1 : list.length - 1]
    else if (e.key === 'Home') next = list[0]
    else if (e.key === 'End') next = list[list.length - 1]
    else if (e.key === 'ArrowRight' && onTab) next = options()[0]
    else if (e.key === 'ArrowLeft' && !onTab) next = tabOf(current)
    else return
    e.preventDefault()
    e.stopPropagation()
    if (!next) return
    if (next.getAttribute('role') === 'tab') {
      if (onTab && next.dataset.section) pickSection(next.dataset.section)
      showOption(tabsRef.current, next)
    } else showOption(paneRef.current, next)
  }

  const tabId = (key: string): string => `${id}-tab-${key}`
  const paneId = `${id}-pane`

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys belong to the tabs and options inside
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex w-[26rem] max-w-[calc(100vw-1rem)] flex-col outline-none"
    >
      <div className="grid min-h-0 flex-1 grid-cols-[10rem_minmax(0,1fr)]">
        <div
          ref={tabsRef}
          role="tablist"
          aria-orientation="vertical"
          aria-label={sectionsLabel}
          className="flex flex-col gap-px border-r border-[var(--color-line)] p-1"
        >
          {sections.map((s) => {
            const picked = s.options.filter((o) => o.selected).length
            const flagged = s.options.some((o) => o.dot && !o.progress)
            const measuring = s.options.find((o) => o.progress)?.progress
            const empty =
              !picked && !measuring && s.options.every((o) => o.count === 0 && !o.unknown)
            const current = s.key === section.key
            const selected = current && !query
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                id={tabId(s.key)}
                data-section={s.key}
                data-testid={`${testid}-section-${s.key}`}
                aria-selected={selected}
                aria-controls={paneId}
                tabIndex={current ? 0 : -1}
                data-empty={empty ? '' : undefined}
                onClick={() => pickSection(s.key)}
                onMouseEnter={() => {
                  clearTimeout(hoverTimer.current)
                  hoverTimer.current = setTimeout(() => pickSection(s.key), SECTION_HOVER_DELAY)
                }}
                onMouseLeave={() => clearTimeout(hoverTimer.current)}
                className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none hover:bg-[var(--color-hover)] hover:text-fg data-[empty]:text-fg-faint ${selected ? 'bg-[var(--color-hover)] text-fg' : 'text-fg-dim'}`}
              >
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {picked > 0 ? (
                  <span
                    data-testid={`${testid}-section-${s.key}-picked`}
                    className="grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-bold tabular-nums text-[var(--color-on-accent)]"
                  >
                    {picked}
                  </span>
                ) : measuring ? (
                  <ProgressRing
                    testid={`${testid}-section-${s.key}-progress`}
                    progress={measuring}
                    className="relative size-3.5 shrink-0"
                  />
                ) : (
                  flagged && (
                    <span
                      data-testid={`${testid}-section-${s.key}-dot`}
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                    />
                  )
                )}
              </button>
            )
          })}
        </div>
        <div
          role="tabpanel"
          id={paneId}
          {...(query
            ? { 'aria-label': searching(query) }
            : { 'aria-labelledby': tabId(section.key) })}
          className="relative min-h-0"
        >
          <div className="absolute inset-0 flex flex-col">
            {query && (
              <p
                data-testid={`${testid}-search`}
                className="flex shrink-0 items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-semibold text-fg-faint"
              >
                <Search className="size-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{searching(query)}</span>
              </p>
            )}
            {groups.length > 0 && groups[0].options.length > 0 ? (
              <div
                ref={paneRef}
                role="listbox"
                aria-multiselectable="true"
                aria-label={query ? searching(query) : section.label}
                data-testid={`${testid}-listbox`}
                className="min-h-0 flex-1 overflow-y-auto p-1"
              >
                {blocks.map((block) => {
                  const rows = block.options.map((o) => (
                    <FilterOption
                      key={o.id}
                      testid={`${testid}-${o.id}`}
                      Icon={o.Icon}
                      dot={o.dot}
                      label={o.label}
                      count={o.count}
                      progress={o.progress}
                      unknown={o.unknown}
                      selected={o.selected}
                      onClick={o.onPick}
                    />
                  ))
                  return block.label ? (
                    // biome-ignore lint/a11y/useSemanticElements: a listbox groups its options with role group; a fieldset groups form controls
                    <div key={block.key} role="group" aria-label={block.label}>
                      <div
                        aria-hidden="true"
                        className="px-2 pt-1.5 pb-1 text-[11px] font-semibold text-fg-faint"
                      >
                        {block.label}
                      </div>
                      {rows}
                    </div>
                  ) : (
                    rows
                  )
                })}
              </div>
            ) : (
              <p data-testid={`${testid}-empty`} className="px-3 py-2 text-xs text-fg-faint">
                {query ? noMatch(query) : section.empty}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-line)] py-1 pr-1 pl-3 text-[11px] tabular-nums text-fg-faint">
        <span data-testid={`${testid}-shown`}>{shown}</span>
        <button
          type="button"
          data-testid={`${testid}-clear`}
          disabled={!canClear}
          onClick={onClear}
          className="rounded px-2 py-1 text-xs text-[var(--color-accent)] outline-none hover:bg-[var(--color-hover)] disabled:text-fg-faint disabled:hover:bg-transparent"
        >
          {clearLabel}
        </button>
      </div>
    </div>
  )
}

interface Props {
  testid: string
  filterRef?: React.RefObject<HTMLDivElement | null>
  trigger: { Icon: LucideIcon; label: string; count: number; dot?: string | null }
  listLabel: string
  multiselectable?: boolean
  // The option the open menu focuses first, so the arrows continue from the current choice.
  // Left out when the menu is not one listbox: its contents then place focus and move it.
  focusTestId?: string
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

  // The menu is portaled out of the sticky header, whose layer would trap it and its
  // backdrop under the controls around the list, and placed in the window from the
  // trigger, so it gets the room the window has under it instead of what the list leaves
  // above the player. Focus never scrolls anything but the menu itself.
  const [pos, setPos] = useState<MenuPlacement | null>(null)
  useCloseOnMove(open, listRef, setOpen)
  useLayoutEffect(() => {
    if (!open || !focusTestId) return
    const list = listRef.current
    if (!list) return
    const item = list.querySelector<HTMLElement>(`[data-testid="${focusTestId}"]`)
    if (item) showOption(list, item)
  }, [open, focusTestId])

  function toggle(): void {
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect()
      if (r) setPos(placeMenu(r))
    }
    setOpen(!open)
  }

  function close(): void {
    setOpen(false)
    triggerRef.current?.focus()
  }

  // The open menu owns its keys: each handled press stops propagating so the window-level
  // shortcut handler can't also move the track selection behind the popover.
  function onListKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
      return
    }
    if (!focusTestId) return
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
    showOption(listRef.current, items[next])
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
          // Carries the filter it shows and the count the list's counter shows: a fixed "Filter"
          // hid which view the list is in and didn't match the words on screen.
          aria-label={tr('sidebar.filter.current', { filter: trigger.label, count: trigger.count })}
          onClick={toggle}
          className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pr-1.5 pl-2 text-xs font-medium text-fg-dim outline-none hover:bg-[var(--color-hover)] hover:text-fg"
        >
          <span className="relative shrink-0">
            <trigger.Icon className="h-4 w-4" aria-hidden="true" />
            {trigger.dot && (
              <span
                data-testid={`${testid}-trigger-dot`}
                className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${trigger.dot}`}
              />
            )}
          </span>
          <span className="min-w-0 truncate text-left">{trigger.label}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
        </button>
        {open &&
          pos &&
          createPortal(
            <>
              <button
                type="button"
                data-testid={`${testid}-backdrop`}
                aria-label={tr('common.close')}
                onClick={close}
                className="fixed inset-0 z-50 cursor-default"
              />
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the menu's own controls take the keys, this only closes it */}
              <div
                ref={listRef}
                {...(focusTestId
                  ? {
                      role: 'listbox',
                      'aria-multiselectable': multiselectable || undefined,
                      'aria-label': listLabel,
                    }
                  : {})}
                data-menu
                data-testid={focusTestId ? `${testid}-listbox` : `${testid}-menu`}
                onKeyDown={onListKeyDown}
                style={{
                  top: pos.top,
                  bottom: pos.bottom,
                  left: pos.left,
                  minWidth: pos.minWidth,
                  maxHeight: pos.maxHeight,
                }}
                className={`animate-pop-flat fixed z-50 overflow-y-auto rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] ${focusTestId ? 'p-1' : ''} shadow-[var(--shadow-float)] ${pos.bottom !== undefined ? 'origin-bottom-left' : 'origin-top-left'}`}
              >
                {options(close)}
              </div>
            </>,
            document.body,
          )}
      </div>
      {children}
      {selectedCount > 1 ? (
        <button
          type="button"
          data-testid={`${counterTestId}-selected-count`}
          onClick={onRevealSelected}
          className="press relative ml-auto self-center rounded pr-0.5 pl-1 text-xs tabular-nums text-fg-dim outline-none hover:text-fg"
        >
          {tr('sidebar.selectedCount', { count: selectedCount })}
          <Tooltip label={tr('header.revealSelected')} />
        </button>
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
