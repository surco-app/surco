import { ListMusic } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistSource } from '../../../shared/types'
import { AppleMusicIcon, EngineIcon, RekordboxIcon, TraktorIcon } from './SourceIcons'
import { Tooltip } from './Tooltip'

// Each program's own mark, the thing a DJ already recognises from the Dock, with its name
// in small type under it. Drawn in the rail's colour, not the apps' own.
export const SOURCE_ICON: Record<PlaylistSource, typeof AppleMusicIcon> = {
  appleMusic: AppleMusicIcon,
  rekordbox: RekordboxIcon,
  engine: EngineIcon,
  traktor: TraktorIcon,
}

// The column of places tracks come from, as rekordbox's own side panel has it. The first
// entry is the working list every import has always landed in; the rest are the DJ
// libraries found on this machine. A source this machine lacks is not drawn at all — the
// same rule the Apple Music destination follows off macOS.
export function SourceRail({
  sources,
  active,
  onSelect,
  onHide,
}: {
  sources: PlaylistSource[]
  active: PlaylistSource | null
  onSelect: (source: PlaylistSource | null) => void
  onHide: (source: PlaylistSource) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [menu, setMenu] = useState<{ source: PlaylistSource; x: number; y: number } | null>(null)
  const itemRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!menu) return
    openerRef.current = document.activeElement as HTMLElement | null
    itemRef.current?.focus()
    return () => openerRef.current?.focus?.()
  }, [menu])

  function hide(source: PlaylistSource): void {
    if (active === source) onSelect(null)
    onHide(source)
    setMenu(null)
  }

  const item = (
    key: string,
    label: string,
    icon: React.ReactNode,
    on: boolean,
    pick: () => void,
    hideable?: PlaylistSource,
  ) => (
    <button
      key={key}
      type="button"
      data-testid={`source-rail-${key}`}
      aria-pressed={on}
      aria-label={label}
      onClick={pick}
      onContextMenu={
        hideable
          ? (e) => {
              e.preventDefault()
              setMenu({ source: hideable, x: e.clientX, y: e.clientY })
            }
          : undefined
      }
      onKeyDown={
        hideable
          ? (e) => {
              if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
              e.preventDefault()
              const box = e.currentTarget.getBoundingClientRect()
              setMenu({ source: hideable, x: box.right, y: box.top })
            }
          : undefined
      }
      className={`flex w-[64px] flex-col items-center justify-center gap-0.5 rounded-lg pt-1.5 pb-1 ${
        on ? 'bg-[var(--color-accent-soft)] text-fg' : 'text-fg-faint hover:bg-[var(--color-hover)]'
      }`}
    >
      {icon}
      <span
        data-testid={`source-rail-label-${key}`}
        className="max-w-full truncate px-0.5 text-[11px] leading-tight"
      >
        {label}
      </span>
      <Tooltip label={label} />
    </button>
  )
  return (
    <nav
      data-testid="source-rail"
      aria-label={tr('sources.rail')}
      className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-line)] bg-[var(--color-ink)] pt-2.5"
    >
      {item(
        'tracks',
        tr('sources.workingList'),
        <ListMusic size={22} strokeWidth={1.6} aria-hidden="true" />,
        active === null,
        () => onSelect(null),
      )}
      {sources.map((s) => {
        const Icon = SOURCE_ICON[s]
        return item(
          s,
          tr(`sources.${s}`),
          <Icon size={22} data-testid={`source-rail-icon-${s}`} />,
          active === s,
          () => onSelect(s),
          s,
        )
      })}
      {menu && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            data-testid="source-rail-menu-backdrop"
            aria-label={tr('common.close')}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
            className="absolute inset-0"
          />
          <div
            role="menu"
            aria-label={tr('sources.rail')}
            data-testid="source-rail-menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault()
                e.stopPropagation()
                setMenu(null)
              }
            }}
            style={{ top: menu.y, left: menu.x }}
            className="absolute min-w-[180px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
          >
            <button
              ref={itemRef}
              type="button"
              role="menuitem"
              data-testid="source-rail-hide"
              onClick={() => hide(menu.source)}
              className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-fg hover:bg-[var(--color-hover)]"
            >
              {tr(`sources.hide.${menu.source}`)}
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
