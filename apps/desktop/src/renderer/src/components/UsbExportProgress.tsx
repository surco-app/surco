import type React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsbFilesystem } from '../../../shared/types'
import { formatFileSize } from '../lib/properties'
import { bytesDone, bytesToCopy, exportCounts, formatSpan, speed, timeLeft } from '../lib/usbExport'
import { type UsbExportStore, usbExportStore, useUsbExportState } from '../lib/usbExportStore'
import { ExportTrackRow } from './ExportTrackRow'

// The modal while exporting and when done: one column, the export's tracks in order, a thin
// overall line with the count, speed and time left on top, the stick in the footer. The
// header and footer read the store once per tick; the rows read their own row.
export function UsbExportProgress({
  footer,
  onBackground,
  onCancel,
  onClose,
  store = usbExportStore,
}: {
  footer: { name: string; freeBytes: number | null; filesystem: UsbFilesystem | null }
  onBackground: () => void
  onCancel: () => void
  onClose: () => void
  store?: UsbExportStore
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const state = useUsbExportState((s) => s, store)
  const counts = exportCounts(state)
  const toCopy = bytesToCopy(state)
  const fraction =
    toCopy > 0 ? bytesDone(state) / toCopy : counts.total > 0 ? counts.done / counts.total : 0
  const rate = speed(state)
  const left = timeLeft(state)
  const running = state.phase === 'copying' || state.phase === 'database'
  // Speed and time left describe the copy: frozen during the database or a cancel, they
  // read as a hang.
  const measuring = state.phase === 'copying' && !state.cancelling
  const copying = state.rows.findIndex((r) => r.state === 'copying')
  const list = useRef<HTMLOListElement>(null)
  // The row being copied stays in view, without moving the list when it already is.
  useEffect(() => {
    if (copying < 0) return
    list.current
      ?.querySelector(`[data-testid="export-row-${copying}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [copying])
  return (
    <div className="flex max-h-[80vh] min-h-0 flex-col">
      <header className="px-4 pt-4 pb-2">
        <div className="h-0.5 w-full overflow-hidden rounded bg-[var(--color-line)]">
          <div
            data-testid="usb-overall"
            className="h-full bg-[var(--color-accent)]"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
        <p className="mt-2 flex gap-3 text-xs text-fg-muted tabular-nums">
          <span data-testid="usb-counter">
            {tr('usbExport.progress.counter', { done: counts.done, total: counts.total })}
          </span>
          {measuring && rate !== null && (
            <span data-testid="usb-speed">
              {tr('usbExport.progress.speed', { value: formatFileSize(rate, i18n.language) })}
            </span>
          )}
          {measuring && left !== null && (
            <span data-testid="usb-left">
              {tr('usbExport.progress.left', { time: formatSpan(left, tr) })}
            </span>
          )}
        </p>
      </header>
      <ol ref={list} data-testid="usb-rows" className="min-h-0 flex-1 overflow-y-auto">
        {state.rows.map((row, i) => (
          <ExportTrackRow key={row.track.id} index={i} store={store} />
        ))}
      </ol>
      {state.phase === 'done' && state.result && (
        <p data-testid="usb-done" role="status" className="px-4 pt-3 text-sm">
          {tr('usbExport.progress.done', {
            count: state.result.tracks,
            time: formatSpan(state.result.ms, tr),
          })}
          {state.result.failed > 0 &&
            ` ${tr('usbExport.progress.failedCount', { count: state.result.failed })}`}
        </p>
      )}
      {state.phase === 'cancelled' && (
        <p data-testid="usb-cancelled" role="status" className="px-4 pt-3 text-sm">
          {tr('usbExport.progress.cancelled')}
        </p>
      )}
      {state.phase === 'error' && state.reason && (
        <p data-testid="usb-error" role="alert" className="px-4 pt-3 text-sm text-danger">
          {tr(`usbExport.errors.${state.reason}`)}
        </p>
      )}
      <footer className="flex items-center gap-3 border-t border-[var(--color-line)] px-4 py-3 text-xs text-fg-muted">
        <span data-testid="usb-footer" className="min-w-0 truncate">
          {[
            footer.name,
            footer.freeBytes !== null
              ? tr('usbExport.progress.free', {
                  size: formatFileSize(footer.freeBytes, i18n.language),
                })
              : null,
            footer.filesystem ? tr(`usbExport.fs.${footer.filesystem}`) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="ml-auto flex gap-2">
          {state.phase === 'copying' && !state.cancelling && (
            <button
              type="button"
              data-testid="usb-cancel"
              onClick={onCancel}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]"
            >
              {tr('usbExport.progress.cancel')}
            </button>
          )}
          {state.phase === 'copying' && state.cancelling && (
            <span data-testid="usb-cancelling" role="status" className="px-3 py-1.5 text-sm">
              {tr('usbExport.progress.cancelling')}
            </span>
          )}
          {state.phase === 'database' && (
            <span data-testid="usb-finishing" className="px-3 py-1.5 text-sm">
              {tr('usbExport.progress.finishing')}
            </span>
          )}
          {running ? (
            <button
              type="button"
              data-testid="usb-background"
              onClick={onBackground}
              className="rounded-md bg-[var(--color-hover)] px-3 py-1.5 text-sm"
            >
              {tr('usbExport.progress.background')}
            </button>
          ) : (
            <button
              type="button"
              data-testid="usb-close"
              onClick={onClose}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-on-accent)]"
            >
              {tr('usbExport.progress.close')}
            </button>
          )}
        </span>
      </footer>
    </div>
  )
}
