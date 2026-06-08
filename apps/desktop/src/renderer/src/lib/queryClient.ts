import { QueryClient } from '@tanstack/react-query'

// The app's only async source is the main process over IPC: file probes (ffprobe,
// taglib) and Discogs lookups. A given input path probes to the same facts for the
// whole session, so queries never go stale and are kept indefinitely — the renderer
// used to mirror these results into track state precisely to avoid re-probing, and
// the cache preserves that "measure once per input" guarantee. A failed probe is
// surfaced as an error the UI renders as "unavailable" rather than retried, since a
// file ffprobe cannot read will not start reading on a retry.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
}
