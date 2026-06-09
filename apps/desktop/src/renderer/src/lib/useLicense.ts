import { useCallback, useEffect, useState } from 'react'
import type { LicenseSnapshot } from '../../../shared/license'

// Loads the licensing snapshot from the main process and re-checks the license with
// the server once on mount (refreshing the offline grace window for paying users).
// `reload` re-reads the local snapshot after an activation/deactivation or after a
// conversion spends part of the free allowance.
export function useLicense(): {
  snapshot: LicenseSnapshot | null
  reload: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<LicenseSnapshot | null>(null)

  const reload = useCallback(async () => {
    setSnapshot(await window.api.licenseStatus())
  }, [])

  useEffect(() => {
    reload()
    // A background re-validation keeps a real (non-beta) Pro license alive offline;
    // it silently no-ops when there's no key or the network is down.
    window.api.validateLicense().then((r) => setSnapshot(r.snapshot))
  }, [reload])

  return { snapshot, reload }
}
