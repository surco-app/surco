import { Disc3, ListMusic, Music } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistSource } from '../../../shared/types'

const ICON: Record<PlaylistSource, typeof Music> = { appleMusic: Music, rekordbox: Disc3 }

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
  const item = (key: string, label: string, Icon: typeof Music, on: boolean, pick: () => void) => (
    <button
      key={key}
      type="button"
      data-testid={`source-rail-${key}`}
      aria-pressed={on}
      onClick={pick}
      className={`flex w-[50px] flex-col items-center gap-[3px] rounded-lg pt-[7px] pb-[5px] text-[10px] ${
        on ? 'bg-[var(--color-accent-soft)] text-fg' : 'text-fg-faint hover:bg-[var(--color-hover)]'
      }`}
    >
      <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
      {label}
    </button>
  )
  return (
    <nav
      data-testid="source-rail"
      aria-label={tr('sources.rail')}
      className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-line)] bg-[var(--color-ink)] pt-2.5"
    >
      {item('tracks', tr('sources.workingList'), ListMusic, active === null, () => onSelect(null))}
      {sources.map((s) => item(s, tr(`sources.${s}`), ICON[s], active === s, () => onSelect(s)))}
    </nav>
  )
}
