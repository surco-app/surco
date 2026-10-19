import { Usb } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { exportCounts, isRunning } from '../lib/usbExport'
import { type UsbExportStore, usbExportStore, useUsbExportState } from '../lib/usbExportStore'

// The USB export running with its modal closed: a pill like the sweeps', which reopens it.
// It subscribes to two numbers, so the toolbar around it does not re-render with the bytes.
export function UsbExportPill({
  hidden,
  onOpen,
  store = usbExportStore,
}: {
  hidden: boolean
  onOpen: () => void
  store?: UsbExportStore
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const running = useUsbExportState(isRunning, store)
  const done = useUsbExportState((s) => exportCounts(s).done, store)
  const total = useUsbExportState((s) => exportCounts(s).total, store)
  if (!running || hidden) return null
  const label = tr('usbExport.pill', { done, total })
  return (
    <button
      type="button"
      data-testid="usb-export-progress"
      onClick={onOpen}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-[var(--color-accent)] tabular-nums hover:bg-[var(--color-hover)]"
    >
      <Usb size={14} aria-hidden="true" />
      {label}
    </button>
  )
}
