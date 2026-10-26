import { ChevronDown, ChevronRight, Clock, FolderPlus, ListPlus, Search, Usb } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { PlaylistSource, SourceNode } from '../../../shared/types'
import type { NewPlaylist } from '../lib/commands'
import { subtreeCounts } from '../lib/playlistEdits'
import { carriesOnlyFiles, draggedRows } from '../lib/reorderDrag'
import { ConfirmDialog } from './ConfirmDialog'
import { Tooltip } from './Tooltip'

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
export function flattenPlaylists(
  nodes: SourceNode[],
  folders: string[] = [],
): { node: SourceNode; folders: string[] }[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder'
      ? flattenPlaylists(n.children ?? [], [...folders, n.name])
      : [{ node: n, folders }],
  )
}

export function SourceTree({
  width,
  title,
  source,
  nodes,
  failed,
  missing = false,
  selectedId,
  onSelect,
  edit,
  fixed,
  onExportUsb,
  newPlaylistRef,
}: {
  width: number
  title: string
  source: PlaylistSource
  nodes: SourceNode[] | undefined
  failed: boolean
  missing?: boolean
  selectedId: string | null
  onSelect: (node: SourceNode, folders: string[]) => void
  // Organising, offered only where the source can be written (rekordbox): creating playlists
  // and folders, and taking tracks dropped on a playlist (rows dragged from the list, known
  // from lib/reorderDrag, or files from Finder). Without it the tree only browses.
  edit?: {
    onCreate: (parentId: string, name: string, folder: boolean) => void
    onDropTracks: (node: SourceNode, files: File[]) => void
    onRename: (node: SourceNode, name: string) => void
    onDelete: (node: SourceNode) => void
  }
  // Playlists the library keeps for itself (Traktor's Preparation, HISTORY…): 'tracks-only'
  // takes tracks but is never renamed or deleted; 'locked' takes nothing.
  fixed?: (node: SourceNode) => 'locked' | 'tracks-only' | null
  // The USB export, offered where it exists: rekordbox's tree on macOS and Windows.
  onExportUsb?: () => void
  newPlaylistRef?: { current: NewPlaylist | null }
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
    return q && nodes
      ? flattenPlaylists(nodes).filter((h) => h.node.name.toLowerCase().includes(q))
      : null
  }, [nodes, query])

  const toggle = (id: string): void =>
    setOpened((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // The name field for a playlist or folder being created, and where it goes. Enter and
  // leaving the field both keep the name (Finder's rule); Escape and an empty name drop it.
  const [creating, setCreating] = useState<{ parentId: string; folder: boolean } | null>(null)
  // Enter removes the field and a browser may still blur it on the way out; the ref makes the
  // second commit of the same field find nothing to create.
  const pending = useRef<{ parentId: string; folder: boolean } | null>(null)
  const startCreating = (parentId: string, folder: boolean): void => {
    pending.current = { parentId, folder }
    setCreating(pending.current)
    // A search shows only its hits, which would hide the field being typed in.
    setQuery('')
  }
  useEffect(() => {
    if (!newPlaylistRef) return
    newPlaylistRef.current = edit ? { source, run: () => startCreating('root', false) } : null
    return () => {
      newPlaylistRef.current = null
    }
  })
  const commit = (value: string): void => {
    const target = pending.current
    pending.current = null
    setCreating(null)
    const name = value.trim()
    if (target && name) edit?.onCreate(target.parentId, name, target.folder)
  }
  const cancel = (): void => {
    pending.current = null
    setCreating(null)
  }
  const [renaming, setRenaming] = useState<string | null>(null)
  const renameTarget = useRef<string | null>(null)
  const [deleting, setDeleting] = useState<SourceNode | null>(null)
  const startRename = (node: SourceNode): void => {
    setMenu(null)
    renameTarget.current = node.id
    setRenaming(node.id)
  }
  const commitRename = (node: SourceNode, value: string): void => {
    if (renameTarget.current !== node.id) return
    renameTarget.current = null
    setRenaming(null)
    const name = value.trim()
    if (name && name !== node.name) edit?.onRename(node, name)
  }
  const cancelRename = (): void => {
    renameTarget.current = null
    setRenaming(null)
  }
  const deleteMessage = (node: SourceNode): string => {
    if (node.kind === 'playlist') return tr('sources.tree.deletePlaylist', { name: node.name })
    const { playlists, folders } = subtreeCounts(node)
    const contents = [
      ...(playlists > 0 ? [tr('sources.tree.playlists', { count: playlists })] : []),
      ...(folders > 0 ? [tr('sources.tree.folders', { count: folders })] : []),
    ].join(tr('sources.tree.and'))
    return contents
      ? tr('sources.tree.deleteFolder', { name: node.name, contents })
      : tr('sources.tree.deleteFolderEmpty', { name: node.name })
  }
  const focusField = useCallback((el: HTMLInputElement | null) => el?.focus(), [])
  const [menu, setMenu] = useState<{ node: SourceNode; x: number; y: number } | null>(null)
  // Opened at the click, then pulled back inside the window once its size is known: from a
  // folder low in a long tree its items ran past the bottom, as the track menu's did.
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuAt, setMenuAt] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!menu || !el) return
    const { width, height } = el.getBoundingClientRect()
    setMenuAt({
      x: Math.min(menu.x, window.innerWidth - width - 8),
      y: Math.min(menu.y, window.innerHeight - height - 8),
    })
  }, [menu])
  const createInside = (node: SourceNode, folder: boolean): void => {
    setMenu(null)
    setOpened((prev) => new Set([...prev, node.id]))
    startCreating(node.id, folder)
  }
  // Which playlist a drag of tracks is over, and how many it carries: the list's own rows
  // when a drag from the list is in progress, otherwise the files of a drag from Finder.
  const [dropOn, setDropOn] = useState<{ id: string; count: number } | null>(null)
  const carriesTracks = (e: React.DragEvent): boolean =>
    e.dataTransfer.types.includes('Files') || (draggedRows() !== null && carriesOnlyFiles(e))
  // Files the drag shows are what lands, so a stale record never inflates the count; the
  // record counts only when the OS brings no files back.
  const dropCount = (e: React.DragEvent): number =>
    Array.from(e.dataTransfer.items).filter((i) => i.kind === 'file').length ||
    (draggedRows()?.length ?? 0)

  const nameField = (parentId: string, depth: number): React.ReactNode =>
    creating?.parentId === parentId && (
      <li key="creating" style={{ paddingLeft: 10 + depth * 18 }} className="pr-2.5">
        <input
          ref={focusField}
          data-testid="source-tree-name"
          aria-label={tr('sources.tree.name')}
          placeholder={tr('sources.tree.name')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
            if (e.key === 'Escape') cancel()
          }}
          onBlur={(e) => {
            // Cmd-Tab or a click on another app blurs the field with the user mid-name; the
            // field stays open for when they come back instead of writing half a name.
            if (!document.hasFocus()) return
            commit(e.currentTarget.value)
          }}
          className="h-[27px] w-full rounded-md border border-[var(--color-accent)] bg-[var(--color-field)] px-2 text-[11.5px] outline-none"
        />
      </li>
    )

  const row = (
    node: SourceNode,
    depth: number,
    folders: string[],
    trail?: string,
  ): React.JSX.Element => {
    const isFolder = node.kind === 'folder'
    const recent = node.id === RECENTLY_ADDED_ID
    const nodeEdit = recent ? undefined : edit
    const fixedAs = fixed?.(node) ?? null
    const dropEdit = fixedAs === 'locked' ? undefined : nodeEdit
    const menuEdit = fixedAs === null ? nodeEdit : undefined
    const open = opened.has(node.id)
    const selected = node.id === selectedId
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <li key={node.id}>
        {renaming === node.id ? (
          <div style={{ paddingLeft: 10 + depth * 18 }} className="pr-2.5">
            <input
              ref={focusField}
              data-testid="source-tree-rename-field"
              aria-label={tr('sources.tree.name')}
              defaultValue={node.name}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(node, e.currentTarget.value)
                if (e.key === 'Escape') cancelRename()
              }}
              onBlur={(e) => {
                if (!document.hasFocus()) return
                commitRename(node, e.currentTarget.value)
              }}
              className="h-[27px] w-full rounded-md border border-[var(--color-accent)] bg-[var(--color-field)] px-2 text-[11.5px] outline-none"
            />
          </div>
        ) : (
          <button
            type="button"
            data-testid={`source-node-${node.id}`}
            aria-expanded={isFolder ? open : undefined}
            aria-current={selected || undefined}
            onClick={() => (isFolder ? toggle(node.id) : onSelect(node, folders))}
            onContextMenu={(e) => {
              if (!menuEdit) return
              e.preventDefault()
              setMenu({ node, x: e.clientX, y: e.clientY })
            }}
            data-drop-target={dropOn?.id === node.id || undefined}
            onDragOver={(e) => {
              if (!dropEdit || isFolder || !carriesTracks(e)) return
              e.preventDefault()
              setDropOn({ id: node.id, count: dropCount(e) })
            }}
            onDragLeave={(e) => {
              // Moving onto the row's own name or count fires a leave on the row itself.
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setDropOn((d) => (d?.id === node.id ? null : d))
            }}
            onDrop={(e) => {
              if (!dropEdit || isFolder || !carriesTracks(e)) return
              e.preventDefault()
              e.stopPropagation()
              setDropOn(null)
              dropEdit.onDropTracks(node, Array.from(e.dataTransfer.files))
            }}
            style={{ paddingLeft: 10 + depth * 18 }}
            className={`flex h-[28px] w-full items-center gap-1.5 rounded-md pr-2.5 text-left text-[13px] ${
              selected
                ? 'bg-[var(--color-row-selected)] text-[var(--color-on-row-selected)]'
                : `${isFolder ? 'text-fg' : 'text-fg-muted'} hover:bg-[var(--color-hover)]`
            } ${isFolder ? 'font-medium' : ''} ${
              dropOn?.id === node.id
                ? 'outline-dashed outline-1 -outline-offset-1 outline-[var(--color-accent)]'
                : ''
            }`}
          >
            {isFolder && (
              <Chevron size={12} className="shrink-0 text-fg-faint" aria-hidden="true" />
            )}
            {recent && (
              <Clock
                size={13}
                data-testid="source-node-recent-icon"
                className="shrink-0 text-fg-faint"
                aria-hidden="true"
              />
            )}
            <span className="min-w-0 truncate">{node.name}</span>
            {trail && <span className="min-w-0 truncate text-xs text-fg-faint">{trail}</span>}
            {dropOn?.id === node.id ? (
              <span
                data-testid="source-drop-count"
                className="ml-auto text-xs text-[var(--color-accent)]"
              >
                {tr('sources.tree.dropCount', { count: dropOn.count })}
              </span>
            ) : (
              !isFolder && (
                <span className="ml-auto text-xs tabular-nums text-fg-faint">{node.count}</span>
              )
            )}
          </button>
        )}
        {isFolder && open && (
          <ul>
            {(node.children ?? []).map((c) => row(c, depth + 1, [...folders, node.name]))}
            {nameField(node.id, depth + 1)}
          </ul>
        )}
      </li>
    )
  }

  let body: React.ReactNode
  if (missing)
    body = (
      <p data-testid="source-tree-missing" className="px-3 text-xs text-fg-faint">
        {tr(`sources.notFound.${source}`)}
      </p>
    )
  // Only a tree never read says it failed; a failed re-read keeps the one already shown.
  else if (failed && !nodes)
    body = (
      <p data-testid="source-tree-failed" className="px-3 text-xs text-fg-faint">
        {tr(`sources.failed.${source}`)}
      </p>
    )
  else if (!nodes) body = <p className="px-3 text-xs text-fg-faint">{tr('sources.loading')}</p>
  else if (nodes.length === 0 && !creating)
    body = <p className="px-3 text-xs text-fg-faint">{tr('sources.empty')}</p>
  else if (hits && hits.length === 0)
    body = <p className="px-3 text-xs text-fg-faint">{tr('sources.noMatch')}</p>
  else if (hits) body = <ul>{hits.map((h) => row(h.node, 0, h.folders, h.folders.join(' › ')))}</ul>
  else
    body = (
      <ul>
        {nodes.map((n) => row(n, 0, []))}
        {nameField('root', 0)}
      </ul>
    )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: swallows drops that miss a playlist; nothing to operate here
    <div
      data-testid="source-tree"
      onDrop={(e) => {
        // A drop that misses a playlist (a folder, the gaps, the title, the search box) must
        // not fall through to the window, whose drop imports the files into the list.
        if (!edit) return
        e.preventDefault()
        e.stopPropagation()
        setDropOn(null)
      }}
      style={{ width }}
      className="flex shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-ink)]"
    >
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <span className="text-sm font-semibold">{title}</span>
        {(edit || onExportUsb) && (
          <span className="ml-auto flex gap-0.5">
            {onExportUsb && (
              <button
                type="button"
                data-testid="source-tree-export-usb"
                aria-label={tr('sources.tree.exportUsb')}
                onClick={onExportUsb}
                className="rounded p-1 text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
              >
                <Usb size={14} aria-hidden="true" />
                <Tooltip label={tr('sources.tree.exportUsb')} />
              </button>
            )}
            {edit && (
              <>
                <button
                  type="button"
                  data-testid="source-tree-new-playlist"
                  aria-label={tr('sources.tree.newPlaylist')}
                  onClick={() => startCreating('root', false)}
                  className="rounded p-1 text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
                >
                  <ListPlus size={14} aria-hidden="true" />
                  <Tooltip label={tr('sources.tree.newPlaylist')} />
                </button>
                <button
                  type="button"
                  data-testid="source-tree-new-folder"
                  aria-label={tr('sources.tree.newFolder')}
                  onClick={() => startCreating('root', true)}
                  className="rounded p-1 text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
                >
                  <FolderPlus size={14} aria-hidden="true" />
                  <Tooltip label={tr('sources.tree.newFolder')} />
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <label className="mx-2.5 mb-2 flex h-[30px] items-center gap-1.5 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-2 text-[13px]">
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
      {menu && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label={tr('common.close')}
            onClick={() => setMenu(null)}
            className="absolute inset-0"
          />
          <div
            ref={(el) => {
              menuRef.current = el
              el?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
            }}
            role="menu"
            aria-label={tr(
              menu.node.kind === 'folder' ? 'sources.tree.folderMenu' : 'sources.tree.menu',
            )}
            data-testid="source-tree-menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMenu(null)
            }}
            style={{ top: menuAt.y, left: menuAt.x }}
            className="absolute min-w-[190px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
          >
            {menu.node.kind === 'folder' && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="source-tree-new-playlist-inside"
                  onClick={() => createInside(menu.node, false)}
                  className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
                >
                  {tr('sources.tree.newPlaylistInside')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="source-tree-new-folder-inside"
                  onClick={() => createInside(menu.node, true)}
                  className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
                >
                  {tr('sources.tree.newFolderInside')}
                </button>
              </>
            )}
            <button
              type="button"
              role="menuitem"
              data-testid="source-tree-rename"
              onClick={() => startRename(menu.node)}
              className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
            >
              {tr('sources.tree.rename')}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="source-tree-delete"
              onClick={() => {
                setDeleting(menu.node)
                setMenu(null)
              }}
              className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-danger hover:bg-[var(--color-hover)]"
            >
              {tr('sources.tree.delete')}
            </button>
          </div>
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title={tr('sources.tree.deleteTitle')}
          message={deleteMessage(deleting)}
          confirmLabel={tr('sources.tree.delete')}
          destructive
          onConfirm={() => edit?.onDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
