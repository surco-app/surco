import { useEffect, useState } from 'react'
import type { UsbVolumeList } from '../../../shared/types'

// The mounted removable volumes, live: main re-reads them when /Volumes changes (macOS) or
// a drive letter comes or goes (Windows). The first call is what starts that watch.
export function useUsbVolumes(enabled: boolean): { list: UsbVolumeList | null } {
  const [list, setList] = useState<UsbVolumeList | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void window.api.usbVolumes().then((l) => {
      if (live) setList(l)
    })
    const off = window.api.onUsbVolumesChanged((l) => setList(l))
    return () => {
      live = false
      off()
    }
  }, [enabled])
  return { list }
}
