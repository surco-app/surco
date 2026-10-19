import { useEffect, useState } from 'react'
import type { UsbExportRequest, UsbFailure, UsbPlan } from '../../../shared/types'

// The summary under the chooser. Each request runs baken's dry run (and stages the
// analysis), so it waits until the ticking has paused, and a late answer to an old
// selection is dropped. A request that fails outright (no reason code came back) settles
// as broken, so the summary never stays at "Calculando…".
const SETTLE_MS = 300

interface Answer {
  plan: UsbPlan | null
  failure: UsbFailure | null
  broken: boolean
}

const NONE: Answer = { plan: null, failure: null, broken: false }

export function useUsbPlan(req: UsbExportRequest | null): Answer & { loading: boolean } {
  const [answer, setAnswer] = useState<Answer>(NONE)
  const [loading, setLoading] = useState(false)
  const key = req ? JSON.stringify(req) : ''
  useEffect(() => {
    if (!key) {
      setAnswer(NONE)
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    const timer = setTimeout(() => {
      void window.api.usbPlan(JSON.parse(key) as UsbExportRequest).then(
        (r) => {
          if (!live) return
          setAnswer(r.ok ? { ...NONE, plan: r.plan } : { ...NONE, failure: r.reason })
          setLoading(false)
        },
        () => {
          if (!live) return
          setAnswer({ ...NONE, broken: true })
          setLoading(false)
        },
      )
    }, SETTLE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [key])
  return { ...answer, loading }
}
