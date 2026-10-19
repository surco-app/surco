import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatFileSize } from '../lib/properties'
import { type UsbExportStore, usbExportStore, useUsbExportState } from '../lib/usbExportStore'
import { TrackWave } from './TrackWave'

// A row of the export list. It subscribes to its own row: a progress tick replaces one row
// object, so only that row renders again.
export const ExportTrackRow = memo(function ExportTrackRow({
  index,
  store = usbExportStore,
}: {
  index: number
  store?: UsbExportStore
}): React.JSX.Element | null {
  const { t: tr, i18n } = useTranslation()
  const row = useUsbExportState((s) => s.rows[index], store)
  if (!row) return null
  const { track, state } = row
  const label =
    state === 'queued'
      ? tr('usbExport.progress.queued')
      : state === 'copying'
        ? tr('usbExport.progress.copying')
        : state === 'kept'
          ? tr('usbExport.progress.kept')
          : state === 'failed'
            ? tr(`usbExport.trackFailure.${row.failure ?? 'unreadable'}`)
            : formatFileSize(track.size, i18n.language)
  return (
    <li
      data-testid={`export-row-${index}`}
      data-state={state}
      className="grid grid-cols-[32px_minmax(0,1fr)_minmax(80px,30%)_auto] items-center gap-3 px-4 py-1.5"
    >
      {track.cover ? (
        <img src={track.cover} alt="" className="size-8 rounded object-cover" />
      ) : (
        <div aria-hidden="true" className="size-8 rounded bg-[var(--color-hover)]" />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm">{track.title}</p>
        <p className="truncate text-xs text-fg-faint">{track.artist}</p>
      </div>
      <TrackWave
        bars={track.wave}
        state={state}
        fraction={track.size > 0 ? row.bytes / track.size : 0}
      />
      <span
        className={`w-32 truncate text-right text-xs tabular-nums ${state === 'failed' ? 'text-danger' : 'text-fg-muted'}`}
      >
        {label}
      </span>
    </li>
  )
})
