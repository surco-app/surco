import type React from 'react'
import { bytesDone, bytesToCopy, exportCounts, isRunning } from '../lib/usbExport'
import { type UsbExportStore, usbExportStore, useUsbExportState } from '../lib/usbExportStore'
import { TopProgressBar } from './TopProgressBar'

// The thin line on top while the export runs in the background, the one the conversions
// use. Rounded to whole percents so a byte tick that does not move it renders nothing.
export function UsbTopProgress({
  store = usbExportStore,
}: {
  store?: UsbExportStore
}): React.JSX.Element | null {
  const percent = useUsbExportState((s) => {
    if (!isRunning(s)) return null
    const toCopy = bytesToCopy(s)
    const c = exportCounts(s)
    const f = toCopy > 0 ? bytesDone(s) / toCopy : c.total > 0 ? c.done / c.total : 0
    return Math.round(f * 100)
  }, store)
  return percent === null ? null : <TopProgressBar fraction={percent / 100} />
}
