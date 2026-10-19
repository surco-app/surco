import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistDot } from '../lib/rekordboxPlaylists'
import { Tooltip } from './Tooltip'

export function PlaylistDots({ dot }: { dot: PlaylistDot }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const names = dot.names.join(', ')
  const label = `${tr('trackList.playlists', { count: dot.names.length, names })}${
    dot.pending ? `. ${tr('trackList.playlistsPending')}` : ''
  }`
  return (
    <span
      data-testid="track-playlist-dots"
      data-pending={dot.pending ? 'true' : undefined}
      className="group/dot relative flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--color-accent)]"
    >
      {dot.names.length > 4
        ? '5+'
        : dot.names.map((name, at) => (
            <span
              key={`${name}-${dot.names.slice(0, at).filter((n) => n === name).length}`}
              data-dot
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full border border-[var(--color-accent)] ${
                dot.pending ? '' : 'bg-[var(--color-accent)]'
              }`}
            />
          ))}
      <Tooltip label={names} align="end" scope="dot" />
      <span className="sr-only">{label}</span>
    </span>
  )
}
