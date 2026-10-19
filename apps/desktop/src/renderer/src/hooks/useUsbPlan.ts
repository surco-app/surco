import { useEffect, useState } from 'react'
import type { UsbExportRequest, UsbFailure, UsbPlan } from '../../../shared/types'

// The summary under the chooser. Each request runs baken's dry run (and stages the
// analysis), so it waits until the ticking has paused, and a late answer to an old
// selection is dropped.
const SETTLE_MS = 300

export function useUsbPlan(req: UsbExportRequest | null): {
  plan: UsbPlan | null
  failure: UsbFailure | null
  loading: boolean
} {
  const [answer, setAnswer] = useState<{ plan: UsbPlan | null; failure: UsbFailure | null }>({
    plan: null,
    failure: null,
  })
  const [loading, setLoading] = useState(false)
  const key = req ? JSON.stringify(req) : ''
  useEffect(() => {
    if (!key) {
      setAnswer({ plan: null, failure: null })
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    const timer = setTimeout(() => {
      void window.api.usbPlan(JSON.parse(key) as UsbExportRequest).then((r) => {
        if (!live) return
        setAnswer(r.ok ? { plan: r.plan, failure: null } : { plan: null, failure: r.reason })
        setLoading(false)
      })
    }, SETTLE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [key])
  return { ...answer, loading }
}
