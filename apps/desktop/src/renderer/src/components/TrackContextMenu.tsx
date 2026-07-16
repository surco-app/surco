import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isWindows } from '../lib/platform'
import type { TrackItem } from '../types'

interface Props {
  track: TrackItem
  x: number
  y: number
  onClose: () => void
  onSearch: (id: string) => void
  onStartOver: (track: TrackItem) => void
  onCopyMeta: (track: TrackItem) => void
  onCopyPath: (track: TrackItem) => void
  onPasteMeta: (track: TrackItem) => void
  // Whether a track's metadata has been copied and is available to paste. False hides
  // the paste item so the menu never offers a no-op.
  canPasteMeta: boolean
  onRemove: (id: string) => void
  onTrash: (track: TrackItem) => void
}

function MenuItem({
  label,
  testid,
  danger,
  onClick,
}: {
  label: string
  testid: string
  danger?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testid}
      onClick={onClick}
      className={`block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-panel-2)] ${
        danger ? 'text-danger' : 'text-fg'
      }`}
    >
      {label}
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
  onStartOver,
  onCopyMeta,
  onCopyPath,
  onPasteMeta,
  canPasteMeta,
  onRemove,
  onTrash,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const isWin = isWindows()

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
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
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
        data-testid="track-menu"
        onKeyDown={onMenuKeyDown}
        style={{ top: pos.y, left: pos.x }}
        className="animate-pop absolute min-w-[210px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-xl"
      >
        <MenuItem
          testid="track-menu-search"
          label={tr('trackList.context.search')}
          onClick={() => run(() => onSearch(track.id))}
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
        <div className="my-1 h-px bg-[var(--color-line)]" />
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
        <div className="my-1 h-px bg-[var(--color-line)]" />
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
