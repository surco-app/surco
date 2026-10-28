import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import type React from 'react'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistLibrary, RekordboxPlaylistTarget, SourceNode } from '../../../shared/types'
import { type PopoverPlacement, popoverPlacement } from '../lib/popoverPlacement'
import {
  canCreate,
  matchingOptions,
  type PlaylistOption,
  targetKey,
} from '../lib/rekordboxPlaylists'
import { foldersHolding, playlistIdsUnder } from './CheckTree'
import { LIBRARY_ICON } from './SourceIcons'

const fieldTestId = (library: PlaylistLibrary, testId: string): string =>
  library === 'rekordbox' ? testId : `${library}-${testId}`

interface Token {
  target: RekordboxPlaylistTarget
  state: 'all' | 'some'
}

type Row =
  | { kind: 'folder'; node: SourceNode; depth: number; open: boolean }
  | { kind: 'playlist'; target: RekordboxPlaylistTarget; depth: number; count?: number }
  | { kind: 'create'; name: string }

const ROW =
  'flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left text-xs outline-none hover:bg-[var(--color-hover)] focus:bg-[var(--color-hover)]'

const POPOVER_GAP = 12

function visibleAreaOf(el: HTMLElement): { top: number; bottom: number } {
  for (let at = el.parentElement; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at.getBoundingClientRect()
  }
  return { top: 0, bottom: window.innerHeight }
}

const chosenIdsOf = (tokens: readonly Token[]): Set<string> =>
  new Set(tokens.flatMap((t) => (t.target.id ? [t.target.id] : [])))

function treeRows(
  tree: readonly SourceNode[],
  opened: ReadonlySet<string>,
  hits: ReadonlySet<string> | null,
): Row[] {
  const walk = (nodes: readonly SourceNode[], depth: number): Row[] =>
    nodes.flatMap((node): Row[] => {
      if (node.kind === 'playlist')
        return !hits || hits.has(node.id)
          ? [
              {
                kind: 'playlist',
                target: { id: node.id, name: node.name },
                depth,
                count: node.count,
              },
            ]
          : []
      const inner = walk(node.children ?? [], depth + 1)
      if (hits)
        return inner.length > 0 ? [{ kind: 'folder', node, depth, open: true }, ...inner] : []
      const open = opened.has(node.id)
      return [{ kind: 'folder', node, depth, open }, ...(open ? inner : [])]
    })
  return walk(tree, 0)
}

function whereParts(
  tree: readonly SourceNode[],
  tokens: readonly Token[],
): { key: string; text: string; pending: boolean }[] {
  const ids = chosenIdsOf(tokens)
  const folders = tree.flatMap((node) => {
    if (node.kind !== 'folder') return []
    const k = playlistIdsUnder(node).filter((id) => ids.has(id)).length
    if (k === 0) return []
    return [{ key: node.id, text: k > 1 ? `${node.name} (${k})` : node.name, pending: false }]
  })
  const roots = tree.flatMap((node) =>
    node.kind === 'playlist' && ids.has(node.id)
      ? [{ key: node.id, text: node.name, pending: false }]
      : [],
  )
  const pending = tokens.flatMap((t) =>
    t.target.id ? [] : [{ key: targetKey(t.target), text: t.target.name, pending: true }],
  )
  return [...folders, ...roots, ...pending]
}

function TreePopover({
  app,
  tree,
  options,
  tokens,
  onToggle,
  onClose,
}: {
  app: string
  tree: readonly SourceNode[]
  options: readonly PlaylistOption[]
  tokens: readonly Token[]
  onToggle: (target: RekordboxPlaylistTarget, on: boolean) => void
  onClose: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<ReadonlySet<string>>(
    () => new Set(foldersHolding([...tree], chosenIdsOf(tokens))),
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<(HTMLElement | null)[]>([])
  const boxRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<PopoverPlacement | null>(null)
  useLayoutEffect(() => {
    const box = boxRef.current
    const field = box?.parentElement
    if (!box || !field) return
    const at = field.getBoundingClientRect()
    const area = visibleAreaOf(field)
    setPlace(
      popoverPlacement({
        above: at.top - area.top - POPOVER_GAP,
        below: area.bottom - at.bottom - POPOVER_GAP,
        height: box.offsetHeight,
      }),
    )
  }, [])
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const stateOf = (target: RekordboxPlaylistTarget): Token['state'] | 'none' =>
    tokens.find((t) => targetKey(t.target) === targetKey(target))?.state ?? 'none'
  const hits =
    query.trim() === '' ? null : new Set(matchingOptions(options, query, []).map((o) => o.id))
  const rows: Row[] = [
    ...treeRows(tree, opened, hits),
    ...(hits
      ? []
      : tokens.flatMap((t): Row[] =>
          t.target.id ? [] : [{ kind: 'playlist', target: t.target, depth: 0 }],
        )),
    ...(canCreate(
      options,
      query,
      tokens.map((t) => t.target),
    )
      ? [{ kind: 'create' as const, name: query.trim() }]
      : []),
  ]
  rowRefs.current = []

  const toggle = (target: RekordboxPlaylistTarget): void =>
    onToggle(target, stateOf(target) !== 'all')
  const create = (name: string): void => {
    onToggle({ name }, true)
    setQuery('')
  }
  const setFolder = (id: string, open: boolean): void =>
    setOpened((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const at = rowRefs.current.indexOf(document.activeElement as HTMLElement)
    const row = at > 0 ? rows[at - 1] : undefined
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const to = Math.max(0, Math.min(rows.length, at + (e.key === 'ArrowDown' ? 1 : -1)))
      rowRefs.current[to]?.focus()
    } else if (row?.kind === 'folder' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      setFolder(row.node.id, e.key === 'ArrowRight')
    } else if (row?.kind === 'playlist' && e.key === ' ') {
      e.preventDefault()
      toggle(row.target)
    } else if (at === 0 && hits && e.key === 'Enter') {
      const found = rows.flatMap((r) => (r.kind === 'playlist' ? [r.target] : []))
      const offer = rows.find((r) => r.kind === 'create')
      if (found.length === 1) toggle(found[0])
      else if (found.length === 0 && offer?.kind === 'create') create(offer.name)
      e.preventDefault()
    }
  }

  const keep = (i: number) => (el: HTMLElement | null) => {
    rowRefs.current[i] = el
  }

  const draw = (row: Row, i: number): React.JSX.Element => {
    if (row.kind === 'create')
      return (
        <button
          key="create"
          ref={keep(i)}
          type="button"
          tabIndex={-1}
          data-testid="playlists-create"
          onClick={() => create(row.name)}
          className={`${ROW} pl-2 text-[var(--color-accent)]`}
        >
          <Plus size={12} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {tr('editor.playlists.create', { name: row.name })}
          </span>
        </button>
      )
    if (row.kind === 'folder') {
      const ids = playlistIdsUnder(row.node)
      const k = ids.filter((id) => stateOf({ id, name: '' }) !== 'none').length
      const Chevron = row.open ? ChevronDown : ChevronRight
      return (
        <button
          key={row.node.id}
          ref={keep(i)}
          type="button"
          tabIndex={-1}
          data-testid={`playlists-folder-${row.node.id}`}
          aria-expanded={row.open}
          onClick={() => setFolder(row.node.id, !row.open)}
          style={{ paddingLeft: 8 + row.depth * 18 }}
          className={`${ROW} ${k > 0 ? 'text-fg' : 'text-fg-muted'}`}
        >
          <Chevron size={12} className="shrink-0 text-fg-faint" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium">{row.node.name}</span>
          <span
            data-testid={`playlists-folder-count-${row.node.id}`}
            className="shrink-0 text-[11px] tabular-nums text-fg-faint"
          >
            {k > 0 ? tr('editor.playlists.ofTotal', { chosen: k, total: ids.length }) : ids.length}
          </span>
        </button>
      )
    }
    const state = stateOf(row.target)
    const pending = !row.target.id
    return (
      <label
        key={targetKey(row.target)}
        data-testid={`playlists-row-${targetKey(row.target)}`}
        title={
          pending
            ? tr('editor.playlists.pending')
            : state === 'some'
              ? tr('editor.playlists.some')
              : undefined
        }
        style={{ paddingLeft: 8 + row.depth * 18 }}
        className={`${ROW} cursor-pointer focus-within:bg-[var(--color-hover)] ${state === 'none' ? 'text-fg-muted' : 'text-fg'}`}
      >
        <span className="w-3 shrink-0" />
        <input
          ref={(el) => {
            rowRefs.current[i] = el
            if (el) el.indeterminate = state === 'some'
          }}
          type="checkbox"
          tabIndex={-1}
          data-testid={`playlists-check-${targetKey(row.target)}`}
          checked={state === 'all'}
          onChange={() => toggle(row.target)}
          className="h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)] outline-none"
        />
        <span className={`min-w-0 flex-1 truncate ${pending ? 'text-[var(--color-accent)]' : ''}`}>
          {row.target.name}
        </span>
        {row.count !== undefined && (
          <span className="shrink-0 text-[11px] tabular-nums text-fg-faint">{row.count}</span>
        )}
      </label>
    )
  }

  return (
    <div
      ref={boxRef}
      data-testid="playlists-popover"
      data-side={place?.side ?? 'down'}
      role="dialog"
      aria-label={tr('editor.playlists.options', { app })}
      onKeyDown={onKeyDown}
      style={{ maxHeight: place?.maxHeight }}
      className={`absolute right-0 left-0 z-20 flex flex-col overflow-hidden rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] shadow-[var(--shadow-float)] ${
        place?.side === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
      }`}
    >
      <label className="m-2 flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-2 text-xs focus-within:border-[var(--color-accent)]">
        <Search size={13} className="shrink-0 text-fg-faint" aria-hidden="true" />
        <input
          ref={(el) => {
            searchRef.current = el
            rowRefs.current[0] = el
          }}
          data-testid="playlists-search"
          aria-label={tr('editor.playlists.search')}
          placeholder={tr('editor.playlists.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-fg outline-none focus-visible:shadow-none placeholder:text-fg-faint"
        />
      </label>
      <div className="max-h-[300px] min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {rows.map((row, i) => draw(row, i + 1))}
      </div>
    </div>
  )
}

function TreeField({
  library,
  disabled,
  label,
  testId,
  tree,
  options,
  tokens,
  onToggle,
}: {
  library: PlaylistLibrary
  disabled: boolean
  label: string
  testId: string
  tree: readonly SourceNode[]
  options: readonly PlaylistOption[]
  tokens: readonly Token[]
  onToggle: (target: RekordboxPlaylistTarget, on: boolean) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const buttonId = useId()
  const countId = useId()
  const whereId = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const parts = whereParts(tree, tokens)
  const app = tr(`sources.${library}`)
  const Icon = LIBRARY_ICON[library]
  return (
    <div data-testid={fieldTestId(library, testId)} className="group block @[24rem]:contents">
      <label
        htmlFor={buttonId}
        className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-dim @[24rem]:col-start-1 @[24rem]:mb-0 @[24rem]:min-h-[34px] @[24rem]:max-w-32 @[24rem]:flex-row-reverse @[24rem]:justify-start @[24rem]:text-right"
      >
        {label}
        <Icon size={12} />
        <span className="sr-only">{app}</span>
      </label>
      <div ref={rootRef} className="relative min-w-0 @[24rem]:col-start-2">
        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          data-testid="playlists-summary"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-describedby={tokens.length > 0 ? `${countId} ${whereId}` : countId}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={`flex h-[34px] w-full items-center gap-2 rounded-lg border bg-[var(--color-panel-2)]/30 px-3 text-left text-sm outline-none focus-visible:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
            open ? 'border-[var(--color-accent)]' : 'border-[var(--color-line-strong)]'
          }`}
        >
          {disabled ? (
            <span id={countId} className="min-w-0 flex-1 truncate text-fg-faint">
              {tr('editor.playlists.notIn', { app })}
            </span>
          ) : tokens.length > 0 ? (
            <>
              <span
                id={countId}
                data-testid="playlists-count"
                className="shrink-0 font-medium text-fg"
              >
                {tr('editor.playlists.count', { count: tokens.length })}
              </span>
              <span
                id={whereId}
                data-testid="playlists-where"
                className="min-w-0 flex-1 truncate text-xs text-fg-faint"
              >
                {parts.map((p, i) => (
                  <Fragment key={p.key}>
                    {i > 0 && ' · '}
                    {p.pending ? (
                      <span
                        data-testid={`playlists-pending-${p.text}`}
                        data-pending="true"
                        title={tr('editor.playlists.pending')}
                        className="text-[var(--color-accent)]"
                      >
                        {p.text}
                      </span>
                    ) : (
                      p.text
                    )}
                  </Fragment>
                ))}
              </span>
            </>
          ) : (
            <span id={countId} className="min-w-0 flex-1 truncate text-fg-faint">
              {tr('editor.playlists.placeholder')}
            </span>
          )}
          <ChevronDown size={12} className="shrink-0 text-fg-faint" aria-hidden="true" />
        </button>
        {open && (
          <TreePopover
            app={app}
            tree={tree}
            options={options}
            tokens={tokens}
            onToggle={onToggle}
            onClose={() => {
              setOpen(false)
              buttonRef.current?.focus()
            }}
          />
        )}
      </div>
    </div>
  )
}

export function PlaylistsField({
  library = 'rekordbox',
  disabled = false,
  label,
  tree,
  options,
  value,
  onChange,
}: {
  library?: PlaylistLibrary
  disabled?: boolean
  label: string
  tree: SourceNode[]
  options: PlaylistOption[]
  value: RekordboxPlaylistTarget[]
  onChange: (next: RekordboxPlaylistTarget[]) => void
}): React.JSX.Element {
  return (
    <TreeField
      library={library}
      disabled={disabled}
      label={label}
      testId="playlists-field"
      tree={tree}
      options={options}
      tokens={value.map((target) => ({ target, state: 'all' }))}
      onToggle={(target, on) =>
        onChange(on ? [...value, target] : value.filter((t) => targetKey(t) !== targetKey(target)))
      }
    />
  )
}

export function PlaylistsBulkField({
  library = 'rekordbox',
  disabled = false,
  label,
  tree,
  options,
  states,
  onToggle,
}: {
  library?: PlaylistLibrary
  disabled?: boolean
  label: string
  tree: SourceNode[]
  options: PlaylistOption[]
  states: Token[]
  onToggle: (target: RekordboxPlaylistTarget, on: boolean) => void
}): React.JSX.Element {
  return (
    <TreeField
      library={library}
      disabled={disabled}
      label={label}
      testId="playlists-bulk"
      tree={tree}
      options={options}
      tokens={states}
      onToggle={onToggle}
    />
  )
}
