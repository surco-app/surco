import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceNode } from '../../../shared/types'
import { isWindows } from '../lib/platform'
import type { TrackItem } from '../types'

// What the menu offers for the open rekordbox crate. Present only while rekordbox is the
// source; openName is the playlist on screen, null when the list is not one.
export interface TrackPlaylistMenu {
  targets: { node: SourceNode; folders: string[] }[]
  openName: string | null
  canInsertSeparator: boolean
  onAddTo: (node: SourceNode) => void
  onInsertSeparator: () => void
  onRemove: () => void
}

interface Props {
  track: TrackItem
  x: number
  y: number
  onClose: () => void
  onSearch: (id: string) => void
  onSearchWeb: (track: TrackItem) => void
  onStartOver: (track: TrackItem) => void
  onCopyMeta: (track: TrackItem) => void
  onCopyPath: (track: TrackItem) => void
  onPasteMeta: (track: TrackItem) => void
  // Whether a track's metadata has been copied and is available to paste. False hides
  // the paste item so the menu never offers a no-op.
  canPasteMeta: boolean
  onRemove: (id: string) => void
  onTrash: (track: TrackItem) => void
  onInfo: (track: TrackItem) => void
  // Whether Surco keeps a backup of this track's file, and what opens it. The entry only
  // shows for a track that has one: the keyboard's way to the row's backup mark.
  hasBackup?: boolean
  onOpenBackup?: (track: TrackItem) => void
  playlist?: TrackPlaylistMenu
}

function MenuItem({
  label,
  testid,
  danger,
  disabled,
  hint,
  onClick,
}: {
  label: string
  testid: string
  danger?: boolean
  disabled?: boolean
  // Why the item cannot be used, in words under it: a greyed item with no reason reads as
  // broken.
  hint?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      // One Tab stop for the whole menu: the arrows move between items, Tab leaves.
      tabIndex={-1}
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      className={`block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)] disabled:opacity-60 disabled:hover:bg-transparent ${
        danger ? 'text-danger' : 'text-fg'
      }`}
    >
      {label}
      {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
    </button>
  )
}

// Right-click menu for a single track, grouped by workflow priority: metadata work (the
// app's core loop) first, file utilities second, destructive actions last. Reveal/open talk
// to the OS directly through window.api; the list-level actions (search, copy, remove,
// trash) are delegated to App so the trash flow can route through its confirm dialog and
// the copies can confirm with a toast. Labels switch on platform because the OS file
// manager and recycle location differ between macOS and Windows.
export function TrackContextMenu({
  track,
  x,
  y,
  onClose,
  onSearch,
  onSearchWeb,
  onStartOver,
  onCopyMeta,
  onCopyPath,
  onPasteMeta,
  canPasteMeta,
  onRemove,
  onTrash,
  onInfo,
  hasBackup = false,
  onOpenBackup,
  playlist,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const isWin = isWindows()
  const [picking, setPicking] = useState(false)

  // Keep the menu fully on screen — flip it back inside the viewport once we know its size.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    })
  }, [x, y])

  // The menu can be opened from the keyboard (Shift+F10 / the context-menu key), so move
  // focus to the first item on open and hand it back to the opener once it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => opener?.focus?.()
  }, [])

  // The open menu owns its keys: each handled press stops propagating so the
  // window-level shortcut handler can't also move the track selection behind the
  // menu, or toggle the player when Space was meant to activate the focused item.
  // Focus always sits inside the menu (moved there on open), so Escape is caught
  // here too rather than by a window listener.
  function onMenuKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // Let the focused item's own activation run; just keep the press contained.
      e.stopPropagation()
      return
    }
    // Tab leaves the menu, so it closes like a native one and the focus goes back to the
    // opener instead of wandering off behind an orphaned menu.
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    // A disabled item cannot take focus; counted as a stop, it would trap the arrows.
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
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

  function run(action: () => void): void {
    action()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        data-testid="track-menu-backdrop"
        aria-label={tr('common.close')}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
        className="absolute inset-0"
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={tr('common.trackActions')}
        data-testid="track-menu"
        onKeyDown={onMenuKeyDown}
        style={{ top: pos.y, left: pos.x }}
        className="absolute min-w-[210px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
      >
        <MenuItem
          testid="track-menu-search"
          label={tr('trackList.context.search')}
          onClick={() => run(() => onSearch(track.id))}
        />
        <MenuItem
          testid="track-menu-search-web"
          label={tr('trackList.context.searchWeb')}
          onClick={() => run(() => onSearchWeb(track))}
        />
        <MenuItem
          testid="track-menu-copy-meta"
          label={tr('trackList.context.copyMeta')}
          onClick={() => run(() => onCopyMeta(track))}
        />
        {canPasteMeta && (
          <MenuItem
            testid="track-menu-paste-meta"
            label={tr('trackList.context.pasteMeta')}
            onClick={() => run(() => onPasteMeta(track))}
          />
        )}
        <MenuItem
          testid="track-menu-startover"
          label={tr('trackList.context.startOver')}
          onClick={() => run(() => onStartOver(track))}
        />
        {playlist && (
          <>
            <hr className="my-1 h-px border-0 bg-[var(--color-line)]" />
            <div className="relative">
              <MenuItem
                testid="track-menu-add-to"
                label={`${tr('sources.menu.addTo')} ›`}
                onClick={() => setPicking((p) => !p)}
              />
              {picking && (
                <div
                  data-testid="track-menu-playlists"
                  className="absolute top-0 left-full ml-1 max-h-[60vh] min-w-[220px] overflow-y-auto rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
                >
                  {playlist.targets.map(({ node, folders }) => (
                    <MenuItem
                      key={node.id}
                      testid={`track-menu-playlist-${node.id}`}
                      label={[...folders, node.name].join(' › ')}
                      onClick={() => run(() => playlist.onAddTo(node))}
                    />
                  ))}
                </div>
              )}
            </div>
            {playlist.openName !== null && (
              <MenuItem
                testid="track-menu-insert-separator"
                label={tr('sources.menu.insertSeparator')}
                disabled={!playlist.canInsertSeparator}
                hint={
                  playlist.canInsertSeparator ? undefined : tr('sources.edit.refused.noSeparator')
                }
                onClick={() => run(playlist.onInsertSeparator)}
              />
            )}
          </>
        )}
        <hr className="my-1 h-px border-0 bg-[var(--color-line)]" />
        <MenuItem
          testid="track-menu-info"
          label={tr('trackList.context.info')}
          onClick={() => run(() => onInfo(track))}
        />
        <MenuItem
          testid="track-menu-reveal"
          label={tr(isWin ? 'trackList.context.revealWin' : 'trackList.context.reveal')}
          onClick={() => run(() => window.api.reveal(track.inputPath))}
        />
        <MenuItem
          testid="track-menu-open"
          label={tr('trackList.context.open')}
          onClick={() => run(() => window.api.openFile(track.inputPath))}
        />
        <MenuItem
          testid="track-menu-copy"
          label={tr('trackList.context.copyPath')}
          onClick={() => run(() => onCopyPath(track))}
        />
        <hr className="my-1 h-px border-0 bg-[var(--color-line)]" />
        {hasBackup && onOpenBackup && (
          <>
            <MenuItem
              testid="track-menu-backup"
              label={tr('trackList.context.backup')}
              onClick={() => run(() => onOpenBackup(track))}
            />
            <hr className="my-1 h-px border-0 bg-[var(--color-line)]" />
          </>
        )}
        {playlist && playlist.openName !== null && (
          <MenuItem
            testid="track-menu-remove-from"
            danger
            label={tr('sources.menu.removeFrom', { name: playlist.openName })}
            onClick={() => run(playlist.onRemove)}
          />
        )}
        <MenuItem
          testid="track-menu-remove"
          label={tr('trackList.context.remove')}
          onClick={() => run(() => onRemove(track.id))}
        />
        <MenuItem
          testid="track-menu-trash"
          danger
          label={tr(isWin ? 'trackList.context.trashWin' : 'trackList.context.trash')}
          onClick={() => run(() => onTrash(track))}
        />
      </div>
    </div>
  )
}
