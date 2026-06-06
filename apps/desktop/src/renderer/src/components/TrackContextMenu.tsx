import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackItem } from '../types'

interface Props {
  track: TrackItem
  x: number
  y: number
  onClose: () => void
  onSearch: (id: string) => void
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

// Right-click menu for a single track. Reveal/open/copy talk to the OS directly through
// window.api; the list-level actions (search, remove, trash) are delegated to App so the
// trash flow can route through its confirm dialog. Labels switch on platform because the
// OS file manager and recycle location differ between macOS and Windows.
export function TrackContextMenu({
  track,
  x,
  y,
  onClose,
  onSearch,
  onRemove,
  onTrash,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const isWin = window.api.platform === 'win32'

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
        style={{ top: pos.y, left: pos.x }}
        className="animate-pop absolute min-w-[210px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-xl"
      >
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
          onClick={() => run(() => window.api.copyText(track.inputPath))}
        />
        <MenuItem
          testid="track-menu-search"
          label={tr('trackList.context.search')}
          onClick={() => run(() => onSearch(track.id))}
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
