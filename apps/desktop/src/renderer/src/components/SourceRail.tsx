import { ListMusic } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistSource } from '../../../shared/types'
import { AppleMusicIcon, RekordboxIcon } from './SourceIcons'
import { Tooltip } from './Tooltip'

// Each program's own mark, the thing a DJ already recognises from the Dock, so the rail
// needs no words under it. Drawn in the rail's colour, not the apps' own.
const ICON: Record<PlaylistSource, typeof AppleMusicIcon> = {
  appleMusic: AppleMusicIcon,
  rekordbox: RekordboxIcon,
}

// The column of places tracks come from, as rekordbox's own side panel has it. The first
// entry is the working list every import has always landed in; the rest are the DJ
// libraries found on this machine. A source this machine lacks is not drawn at all — the
// same rule the Apple Music destination follows off macOS.
export function SourceRail({
  sources,
  active,
  onSelect,
}: {
  sources: PlaylistSource[]
  active: PlaylistSource | null
  onSelect: (source: PlaylistSource | null) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const item = (
    key: string,
    label: string,
    icon: React.ReactNode,
    on: boolean,
    pick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      data-testid={`source-rail-${key}`}
      aria-pressed={on}
      aria-label={label}
      onClick={pick}
      className={`flex size-[44px] items-center justify-center rounded-lg ${
        on ? 'bg-[var(--color-accent-soft)] text-fg' : 'text-fg-faint hover:bg-[var(--color-hover)]'
      }`}
    >
      {icon}
      <Tooltip label={label} />
    </button>
  )
  return (
    <nav
      data-testid="source-rail"
      aria-label={tr('sources.rail')}
      className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-line)] bg-[var(--color-ink)] pt-2.5"
    >
      {item(
        'tracks',
        tr('sources.workingList'),
        <ListMusic size={22} strokeWidth={1.6} aria-hidden="true" />,
        active === null,
        () => onSelect(null),
      )}
      {sources.map((s) => {
        const Icon = ICON[s]
        return item(
          s,
          tr(`sources.${s}`),
          <Icon size={22} data-testid={`source-rail-icon-${s}`} />,
          active === s,
          () => onSelect(s),
        )
      })}
    </nav>
  )
}
