import { useEffect, useState } from 'react'
import type { UsbVolumeList } from '../../../shared/types'

// The mounted removable volumes, live: main re-reads them when /Volumes changes (macOS) or
// a drive letter comes or goes (Windows). The first call is what starts that watch. A
// change event can beat the first answer; that answer is then older and is dropped.
export function useUsbVolumes(enabled: boolean): { list: UsbVolumeList | null } {
  const [list, setList] = useState<UsbVolumeList | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    let changed = false
    void window.api.usbVolumes().then((l) => {
      if (live && !changed) setList(l)
    })
    const off = window.api.onUsbVolumesChanged((l) => {
      changed = true
      setList(l)
    })
    return () => {
      live = false
      off()
    }
  }, [enabled])
  return { list }
}
