import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistSource, SourceNode } from '../../../shared/types'

// The folders on the way to a node, so the tree can open them for the selected playlist.
function pathTo(nodes: SourceNode[], id: string, trail: SourceNode[] = []): SourceNode[] | null {
  for (const n of nodes) {
    if (n.id === id) return trail
    if (n.children) {
      const found = pathTo(n.children, id, [...trail, n])
      if (found) return found
    }
  }
  return null
}

// Every playlist with the folder names above it. Search lists these flat: with names
// repeated across folders (the measured collection has five "Todas"), the path is what
// tells the hits apart.
function flatten(
  nodes: SourceNode[],
  folders: string[] = [],
): { node: SourceNode; folders: string[] }[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder' ? flatten(n.children ?? [], [...folders, n.name]) : [{ node: n, folders }],
  )
}

export function SourceTree({
  title,
  source,
  nodes,
  failed,
  selectedId,
  onSelect,
}: {
  title: string
  source: PlaylistSource
  nodes: SourceNode[] | undefined
  failed: boolean
  selectedId: string | null
  onSelect: (node: SourceNode, folders: string[]) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  // The folders holding the selected playlist are opened once per selection, during render
  // so the selection is never drawn hidden for a frame. Once, not on every render: the
  // user can still close them, and a refocus re-read of the tree must not reopen them.
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  if (selectedId && nodes && openedFor !== selectedId) {
    const trail = pathTo(nodes, selectedId)
    if (trail) {
      setOpenedFor(selectedId)
      setOpened((prev) => new Set([...prev, ...trail.map((n) => n.id)]))
    }
  }
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q && nodes ? flatten(nodes).filter((h) => h.node.name.toLowerCase().includes(q)) : null
  }, [nodes, query])

  const toggle = (id: string): void =>
    setOpened((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const row = (
    node: SourceNode,
    depth: number,
    folders: string[],
    trail?: string,
  ): React.JSX.Element => {
    const isFolder = node.kind === 'folder'
    const open = opened.has(node.id)
    const selected = node.id === selectedId
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <li key={node.id}>
        <button
          type="button"
          data-testid={`source-node-${node.id}`}
          aria-expanded={isFolder ? open : undefined}
          aria-current={selected || undefined}
          onClick={() => (isFolder ? toggle(node.id) : onSelect(node, folders))}
          style={{ paddingLeft: 10 + depth * 18 }}
          className={`flex h-[27px] w-full items-center gap-1.5 rounded-md pr-2.5 text-left text-[11.5px] ${
            selected
              ? 'bg-[var(--color-row-selected)] text-[var(--color-on-row-selected)]'
              : `${isFolder ? 'text-fg' : 'text-fg-muted'} hover:bg-[var(--color-hover)]`
          } ${isFolder ? 'font-semibold' : ''}`}
        >
          {isFolder && <Chevron size={12} className="shrink-0 text-fg-faint" aria-hidden="true" />}
          <span className="min-w-0 truncate">{node.name}</span>
          {trail && <span className="min-w-0 truncate text-[11px] text-fg-faint">{trail}</span>}
          <span className="ml-auto text-[11px] tabular-nums text-fg-faint">{node.count}</span>
        </button>
        {isFolder && open && (
          <ul>{(node.children ?? []).map((c) => row(c, depth + 1, [...folders, node.name]))}</ul>
        )}
      </li>
    )
  }

  let body: React.ReactNode
  if (failed)
    body = (
      <p data-testid="source-tree-failed" className="px-3 text-xs text-fg-faint">
        {tr(`sources.failed.${source}`)}
      </p>
    )
  else if (!nodes) body = <p className="px-3 text-xs text-fg-faint">{tr('sources.loading')}</p>
  else if (nodes.length === 0)
    body = <p className="px-3 text-xs text-fg-faint">{tr('sources.empty')}</p>
  else if (hits && hits.length === 0)
    body = <p className="px-3 text-xs text-fg-faint">{tr('sources.noMatch')}</p>
  else if (hits) body = <ul>{hits.map((h) => row(h.node, 0, h.folders, h.folders.join(' › ')))}</ul>
  else body = <ul>{nodes.map((n) => row(n, 0, []))}</ul>

  return (
    <div
      data-testid="source-tree"
      className="flex w-[236px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-ink)]"
    >
      <div className="px-3 pt-3 pb-2 font-semibold">{title}</div>
      <label className="mx-2.5 mb-2 flex h-[30px] items-center gap-1.5 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-2 text-xs">
        <Search size={13} className="text-fg-faint" aria-hidden="true" />
        <input
          data-testid="source-tree-search"
          aria-label={tr('sources.search')}
          placeholder={tr('sources.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">{body}</div>
    </div>
  )
}
