import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceNode } from '../../../shared/types'
import { flattenPlaylists } from './SourceTree'

// The rekordbox tree with a checkbox per playlist and per folder, for choosing what goes on
// the stick. Only playlist IDs are held: a folder is a shortcut for everything under it, so
// a playlist later added to the folder in rekordbox is never exported without being ticked.

export function playlistIdsUnder(node: SourceNode): string[] {
  return node.kind === 'playlist' ? [node.id] : (node.children ?? []).flatMap(playlistIdsUnder)
}

export function folderState(
  node: SourceNode,
  checked: ReadonlySet<string>,
): 'all' | 'some' | 'none' {
  const ids = playlistIdsUnder(node)
  const on = ids.filter((id) => checked.has(id)).length
  return ids.length > 0 && on === ids.length ? 'all' : on > 0 ? 'some' : 'none'
}

export function foldersHolding(nodes: SourceNode[], checked: ReadonlySet<string>): string[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder' && folderState(n, checked) !== 'none'
      ? [n.id, ...foldersHolding(n.children ?? [], checked)]
      : [],
  )
}

export function CheckTree({
  nodes,
  checked,
  onChange,
}: {
  nodes: SourceNode[]
  checked: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  // The folders holding something ticked open on their own (a stick's remembered selection
  // must be visible), during render, so it never draws closed for a frame. After the first
  // pass only newly ticked playlists open their way: a folder the user closed stays closed
  // when something elsewhere is ticked.
  const tickedKey = [...checked].sort().join('\n')
  const [openedFor, setOpenedFor] = useState<{
    key: string
    ids: ReadonlySet<string>
  } | null>(null)
  if (openedFor?.key !== tickedKey && nodes.length > 0) {
    const fresh = openedFor ? new Set([...checked].filter((id) => !openedFor.ids.has(id))) : checked
    setOpenedFor({ key: tickedKey, ids: checked })
    const holding = foldersHolding(nodes, fresh)
    if (holding.some((id) => !opened.has(id))) setOpened((prev) => new Set([...prev, ...holding]))
  }
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? flattenPlaylists(nodes).filter((h) => h.node.name.toLowerCase().includes(q)) : null
  }, [nodes, query])

  const toggle = (node: SourceNode): void => {
    const next = new Set(checked)
    const clear =
      node.kind === 'folder' ? folderState(node, checked) === 'all' : checked.has(node.id)
    for (const id of playlistIdsUnder(node)) {
      if (clear) next.delete(id)
      else next.add(id)
    }
    onChange(next)
  }

  const row = (node: SourceNode, depth: number, trail?: string): React.JSX.Element => {
    const isFolder = node.kind === 'folder'
    const state = isFolder ? folderState(node, checked) : checked.has(node.id) ? 'all' : 'none'
    const open = opened.has(node.id)
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <li key={node.id}>
        <div
          data-testid={`check-row-${node.id}`}
          style={{ paddingLeft: 8 + depth * 18 }}
          className="flex h-[27px] items-center gap-1.5 pr-2 text-[11.5px]"
        >
          {isFolder ? (
            <button
              type="button"
              aria-label={node.name}
              aria-expanded={open}
              onClick={() =>
                setOpened((prev) => {
                  const next = new Set(prev)
                  if (next.has(node.id)) next.delete(node.id)
                  else next.add(node.id)
                  return next
                })
              }
              className="text-fg-faint"
            >
              <Chevron size={12} aria-hidden="true" />
            </button>
          ) : (
            <span className="w-3" />
          )}
          <input
            type="checkbox"
            data-testid={`check-node-${node.id}`}
            aria-label={tr('usbExport.choose.tick', { name: node.name })}
            checked={state === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = state === 'some'
            }}
            onChange={() => toggle(node)}
          />
          <span className={`min-w-0 truncate ${isFolder ? 'font-semibold' : ''}`}>{node.name}</span>
          {trail && <span className="min-w-0 truncate text-[11px] text-fg-faint">{trail}</span>}
          {!isFolder && (
            <span className="ml-auto text-[11px] tabular-nums text-fg-faint">{node.count}</span>
          )}
        </div>
        {isFolder && open && <ul>{(node.children ?? []).map((c) => row(c, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      <label className="mb-2 flex h-[30px] items-center gap-1.5 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-2 text-xs">
        <Search size={13} className="text-fg-faint" aria-hidden="true" />
        <input
          data-testid="check-tree-search"
          aria-label={tr('sources.search')}
          placeholder={tr('sources.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {hits?.length === 0 && (
          <li data-testid="check-tree-no-match" className="px-2 text-xs text-fg-faint">
            {tr('sources.noMatch')}
          </li>
        )}
        {hits
          ? hits.map((h) => row(h.node, 0, h.folders.join(' › ')))
          : nodes.map((n) => row(n, 0))}
      </ul>
    </div>
  )
}
