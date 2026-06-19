import { type UseQueryResult, useQuery } from '@tanstack/react-query'

// The file's own embedded artwork at full resolution, re-extracted from the source for
// the cover lightbox (the editor only holds a 512px thumbnail, and scaling that up would
// lie about the art's real quality). Keyed by the source path so reopening the lightbox,
// or revisiting the same file, never re-extracts. Idle when the displayed cover is not
// the file's own art — a release image is already full-size and has nothing to pull.
export function useCoverFull(fullResFrom?: string): UseQueryResult<string | null> {
  return useQuery({
    queryKey: ['coverFull', fullResFrom],
    queryFn: () => (fullResFrom ? window.api.readCoverFull(fullResFrom) : null),
    enabled: !!fullResFrom,
  })
}
