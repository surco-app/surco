import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RekordboxPlaylistTarget, SourceNode } from '../../../shared/types'
import {
  canCreate,
  matchingOptions,
  type PlaylistOption,
  targetKey,
} from '../lib/rekordboxPlaylists'
import { foldersHolding, playlistIdsUnder } from './CheckTree'
import { Tooltip } from './Tooltip'

export interface Token {
  target: RekordboxPlaylistTarget
  state: 'all' | 'some'
}

type Row =
  | { kind: 'folder'; node: SourceNode; depth: number; open: boolean }
  | {
      kind: 'playlist'
      target: RekordboxPlaylistTarget
      depth: number
      count?: number
      open?: boolean
      context?: true
    }
  | { kind: 'create'; name: string }

const ROW =
  'flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left text-xs outline-none hover:bg-[var(--color-hover)] focus:bg-[var(--color-hover)]'

export const chosenIdsOf = (tokens: readonly Token[]): Set<string> =>
  new Set(tokens.flatMap((t) => (t.target.id ? [t.target.id] : [])))

function treeRows(
  tree: readonly SourceNode[],
  opened: ReadonlySet<string>,
  hits: ReadonlySet<string> | null,
): Row[] {
  const walk = (nodes: readonly SourceNode[], depth: number): Row[] =>
    nodes.flatMap((node): Row[] => {
      if (node.kind === 'playlist') {
        const own = !hits || hits.has(node.id)
        const row: Row = {
          kind: 'playlist',
          target: { id: node.id, name: node.name },
          depth,
          count: node.count,
        }
        if (!node.children?.length) return own ? [row] : []
        const inner = walk(node.children, depth + 1)
        if (hits)
          return own || inner.length > 0
            ? [{ ...row, open: true, ...(!own && { context: true as const }) }, ...inner]
            : []
        const open = opened.has(node.id)
        return [{ ...row, open }, ...(open ? inner : [])]
      }
      const inner = walk(node.children ?? [], depth + 1)
      if (hits)
        return inner.length > 0 ? [{ kind: 'folder', node, depth, open: true }, ...inner] : []
      const open = opened.has(node.id)
      return [{ kind: 'folder', node, depth, open }, ...(open ? inner : [])]
    })
  return walk(tree, 0)
}

export function PlaylistTree({
  tree,
  options,
  tokens,
  onToggle,
  onEscape,
  control,
  allowCreate = true,
  autoFocus = true,
  emptyText,
  searchLabel,
  onlyIds,
  folderControl,
  onRowKey,
}: {
  tree: readonly SourceNode[]
  options: readonly PlaylistOption[]
  tokens: readonly Token[]
  onToggle: (target: RekordboxPlaylistTarget, on: boolean) => void
  onEscape?: () => void
  control?: (target: RekordboxPlaylistTarget) => React.ReactNode
  allowCreate?: boolean
  autoFocus?: boolean
  emptyText?: string
  searchLabel?: string
  onlyIds?: ReadonlySet<string>
  folderControl?: (node: SourceNode) => React.ReactNode
  onRowKey?: (
    key: string,
    row: { target: RekordboxPlaylistTarget } | { node: SourceNode },
  ) => boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<ReadonlySet<string>>(
    () => new Set(foldersHolding([...tree], chosenIdsOf(tokens))),
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    if (autoFocus) searchRef.current?.focus()
  }, [autoFocus])

  const stateOf = (target: RekordboxPlaylistTarget): Token['state'] | 'none' =>
    tokens.find((t) => targetKey(t.target) === targetKey(target))?.state ?? 'none'
  const matched =
    query.trim() === '' ? null : new Set(matchingOptions(options, query, []).map((o) => o.id))
  const hits = onlyIds
    ? new Set(matched ? [...matched].filter((id) => onlyIds.has(id)) : onlyIds)
    : matched
  const rows: Row[] = [
    ...treeRows(tree, opened, hits),
    ...(hits
      ? []
      : tokens.flatMap((t): Row[] =>
          t.target.id ? [] : [{ kind: 'playlist', target: t.target, depth: 0 }],
        )),
    ...(allowCreate &&
    canCreate(
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
      if (!onEscape) return
      e.preventDefault()
      e.stopPropagation()
      onEscape()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const to = Math.max(0, Math.min(rows.length, at + (e.key === 'ArrowDown' ? 1 : -1)))
      rowRefs.current[to]?.focus()
    } else if (row?.kind === 'folder' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      setFolder(row.node.id, e.key === 'ArrowRight')
    } else if (
      row?.kind === 'playlist' &&
      row.open !== undefined &&
      row.target.id &&
      (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
    ) {
      e.preventDefault()
      setFolder(row.target.id, e.key === 'ArrowRight')
    } else if (
      onRowKey &&
      (row?.kind === 'playlist' || row?.kind === 'folder') &&
      onRowKey(e.key, row.kind === 'playlist' ? { target: row.target } : { node: row.node })
    ) {
      e.preventDefault()
    } else if (row?.kind === 'playlist' && e.key === ' ' && !control) {
      e.preventDefault()
      toggle(row.target)
    } else if (at === 0 && hits && e.key === 'Enter' && !control) {
      const found = rows.flatMap((r) => (r.kind === 'playlist' && !r.context ? [r.target] : []))
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
      const toggler = (
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
        </button>
      )
      if (!folderControl) return toggler
      return (
        <div key={row.node.id} className="flex items-center gap-2 pr-2">
          <div className="min-w-0 flex-1">{toggler}</div>
          {folderControl(row.node)}
        </div>
      )
    }
    const state = stateOf(row.target)
    const pending = !row.target.id
    const label = control ? (
      <div
        key={targetKey(row.target)}
        ref={keep(i)}
        tabIndex={-1}
        data-testid={`playlists-row-${targetKey(row.target)}`}
        style={{ paddingLeft: 8 + row.depth * 18 }}
        className={`${ROW} h-auto min-h-7 flex-wrap justify-between gap-y-1 py-1 outline-none focus:bg-[var(--color-hover)] ${state === 'none' ? 'text-fg-muted' : 'text-fg'}`}
      >
        <span className="w-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{row.target.name}</span>
        {row.count !== undefined && (
          <span className="shrink-0 text-[11px] tabular-nums text-fg-faint">{row.count}</span>
        )}
        {control(row.target)}
      </div>
    ) : (
      <label
        key={targetKey(row.target)}
        data-testid={`playlists-row-${targetKey(row.target)}`}
        style={{ paddingLeft: 8 + row.depth * 18 }}
        className={`${ROW} cursor-pointer focus-within:bg-[var(--color-hover)] ${state === 'none' ? 'text-fg-muted' : 'text-fg'}`}
      >
        {(pending || state === 'some') && (
          <Tooltip label={pending ? tr('editor.playlists.pending') : tr('editor.playlists.some')} />
        )}
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
    if (row.open === undefined) return label
    return (
      <div key={targetKey(row.target)} className="relative">
        {label}
        <button
          type="button"
          tabIndex={-1}
          data-testid={`playlists-expand-${targetKey(row.target)}`}
          aria-label={tr('sources.tree.subcrates', { name: row.target.name })}
          aria-expanded={row.open}
          onClick={() => {
            if (row.target.id) setFolder(row.target.id, !row.open)
          }}
          style={{ left: 8 + row.depth * 18 }}
          className="absolute top-0 flex h-7 w-3 items-center text-fg-faint"
        >
          {row.open ? (
            <ChevronDown size={12} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" />
          )}
        </button>
      </div>
    )
  }

  return (
    <fieldset onKeyDown={onKeyDown} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <label className="m-2 flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-2 text-xs focus-within:border-[var(--color-accent)]">
        <Search size={13} className="shrink-0 text-fg-faint" aria-hidden="true" />
        <input
          ref={(el) => {
            searchRef.current = el
            rowRefs.current[0] = el
          }}
          data-testid="playlists-search"
          aria-label={searchLabel ?? tr('editor.playlists.search')}
          placeholder={searchLabel ?? tr('editor.playlists.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-fg outline-none focus-visible:shadow-none placeholder:text-fg-faint"
        />
      </label>
      <div className="max-h-[300px] min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {rows.map((row, i) => draw(row, i + 1))}
        {hits && rows.length === 0 && emptyText && (
          <p data-testid="playlists-empty" className="px-2 py-2 text-xs text-fg-dim">
            {emptyText}
          </p>
        )}
      </div>
    </fieldset>
  )
}
