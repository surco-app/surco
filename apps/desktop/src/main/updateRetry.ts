// Backoff for failed update checks: quick retries so a GitHub blip costs minutes
// instead of a whole 2h recheck cycle, then a single user-facing notice once the
// outage has survived the entire ladder (agreed in the 2026-07-24 spec).
export const UPDATE_RETRY_DELAYS_MS = [60_000, 300_000, 900_000]

export interface UpdateRetry {
  onFailure(kind: 'transient' | 'offline', status: number | null): void
  onSuccess(): void
}

export function createUpdateRetry(
  retry: () => void,
  notify: (status: number | null) => void,
  delaysMs: number[] = UPDATE_RETRY_DELAYS_MS,
): UpdateRetry {
  let failures = 0
  let notified = false
  let pending: ReturnType<typeof setTimeout> | null = null
  const cancel = (): void => {
    if (pending) clearTimeout(pending)
    pending = null
  }
  return {
    onFailure(kind, status) {
      cancel()
      if (failures < delaysMs.length) {
        const delay = delaysMs[failures]
        failures += 1
        pending = setTimeout(() => {
          pending = null
          retry()
        }, delay)
        return
      }
      // Past the ladder the 2h recheck owns the cadence. One notice per incident,
      // and never for offline: no wifi is normal life, not an outage.
      if (!notified && kind !== 'offline') {
        notified = true
        notify(status)
      }
    },
    onSuccess() {
      cancel()
      failures = 0
      notified = false
    },
  }
}
