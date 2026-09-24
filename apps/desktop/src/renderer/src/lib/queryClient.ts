import { QueryClient } from '@tanstack/react-query'
import type { SpectrumResult } from '../../../shared/types'
import { spectrumVerdictKey } from '../hooks/useSpectrogram'

// The app's only async source is the main process over IPC: file probes (ffprobe,
// taglib) and Discogs lookups. A given input path probes to the same facts for the
// whole session, so queries never go stale and are kept indefinitely — the renderer
// used to mirror these results into track state precisely to avoid re-probing, and
// the cache preserves that "measure once per input" guarantee. A failed probe is
// surfaced as an error the UI renders as "unavailable" rather than retried, since a
// file ffprobe cannot read will not start reading on a retry.
//
// Every spectrogram that lands, fetched or seeded, also files its verdict (the result
// minus its image) under its own key. The image-carrying entry is collected minutes
// after the editor stops showing it, and the list's quality dot must not go with it.
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    const [name, path] = event.query.queryKey as [string, string]
    if (name !== 'spectrogram') return
    const data = event.query.state.data as SpectrumResult | undefined
    if (!data) return
    const { image: _image, ...verdict } = data
    client.setQueryData(spectrumVerdictKey(path), verdict)
  })
  return client
}
