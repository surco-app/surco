import type { TFunction } from 'i18next'
import { useEffect, useRef } from 'react'
import type { UsbVolume, UsbVolumeList } from '../../../shared/types'
import type { AppStore } from '../lib/appStore'
import { pushToast } from '../lib/toastQueue'
import { formatSpan, newlyMounted } from '../lib/usbExport'
import { usbExportStore } from '../lib/usbExportStore'

interface UsbExportToastsInput {
  store: AppStore
  usbVolumes: UsbVolumeList | null
  usbModal: object | null
  usbRunning: boolean
  usbPhase: string
  openUsbExport: (preselect?: string | null) => void
  tr: TFunction
}

export function useUsbExportToasts({
  store,
  usbVolumes,
  usbModal,
  usbRunning,
  usbPhase,
  openUsbExport,
  tr,
}: UsbExportToastsInput): void {
  // A stick plugged in while Surco runs, holding an export, is offered in one click. Not
  // while the chooser is open (it lists it already) or an export runs.
  const prevVolumes = useRef<UsbVolume[] | null>(null)
  useEffect(() => {
    if (!usbVolumes) return
    const appeared = newlyMounted(prevVolumes.current, usbVolumes.volumes)
    prevVolumes.current = usbVolumes.volumes
    if (usbModal || usbRunning) return
    for (const v of appeared.filter((x) => x.holder.by !== 'empty'))
      pushToast(store, {
        key: `usb-connected-${v.uuid}`,
        tone: 'neutral',
        message: { key: 'usbExport.connected', values: { name: v.name } },
        action: {
          label: { key: 'usbExport.connectedAction' },
          onAction: () => openUsbExport(v.uuid),
        },
        duration: 8000,
        testid: 'usb-connected',
      })
  }, [usbVolumes, usbModal, usbRunning, store, openUsbExport])
  // An export that ends with its modal closed says so in a notice; with the modal open, the
  // modal says it.
  const lastUsbPhase = useRef(usbPhase)
  useEffect(() => {
    const was = lastUsbPhase.current
    lastUsbPhase.current = usbPhase
    if (usbModal || was === usbPhase) return
    const s = usbExportStore.getState()
    if (usbPhase === 'done' && s.result) {
      pushToast(store, {
        tone: 'neutral',
        message: {
          key: 'usbExport.progress.done',
          values: { count: s.result.tracks, time: formatSpan(s.result.ms, tr) },
        },
        duration: 10000,
        testid: 'usb-done-notice',
      })
      if (!s.result.syncFiles)
        pushToast(store, {
          tone: 'danger',
          message: { key: 'usbExport.errors.sync-files' },
          testid: 'usb-sync-files-notice',
        })
    }
    if (usbPhase === 'error' && s.reason)
      pushToast(store, {
        tone: 'danger',
        message: { key: `usbExport.errors.${s.reason}` },
        testid: 'usb-error-notice',
      })
  }, [usbPhase, usbModal, store, tr])
}
