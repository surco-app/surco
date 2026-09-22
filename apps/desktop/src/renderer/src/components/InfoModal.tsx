import { X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { useTrackProperties } from '../hooks/useTrackProperties'
import type { TrackItem } from '../types'
import { ModalShell } from './ModalShell'
import { PropertiesReadout } from './PropertiesReadout'
import { PropertiesSkeleton } from './PropertiesSkeleton'

interface Props {
  track: TrackItem
  onClose: () => void
}

// The read-only technical facts of one file, opened on demand (⌘I, the track menu,
// the palette) the way Finder's Get Info is: the same readout as the editor's
// Properties section, reachable with that section folded, hidden or off screen.
export function InfoModal({ track, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { data: properties, isError } = useTrackProperties(track.inputPath, true)
  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="info-backdrop"
      dialogTestId="info-modal"
      labelledBy="info-title"
      className="flex max-h-[80vh] w-[640px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <div className="-mx-6 -mt-6 flex items-center justify-between border-b border-[var(--color-line)] px-6 pt-5 pb-3">
        <h2 id="info-title" className="text-base font-semibold">
          {tr('info.title')}
        </h2>
        <button
          type="button"
          data-testid="info-close"
          onClick={onClose}
          aria-label={tr('common.close')}
          className="press flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="-mx-2 overflow-y-auto px-2 pb-1">
        {properties ? (
          <PropertiesReadout
            properties={properties}
            fileName={track.fileName}
            inputPath={track.inputPath}
            duration={track.duration}
          />
        ) : properties === null || isError ? (
          <p className="mt-4 text-xs text-fg-dim">{tr('editor.propertiesUnavailable')}</p>
        ) : (
          <PropertiesSkeleton />
        )}
      </div>
    </ModalShell>
  )
}
