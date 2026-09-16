// What the download CTA should say once the releases fetch has run its course.
//
// The button used to keep a single boolean ("did an href resolve?"), so a failed
// request and a successful one carrying no build for this OS were indistinguishable —
// both fell through to the same pre-launch copy. They call for opposite answers: an
// outage is temporary and has a working way around it (/releases/latest stays up when
// the releases LISTING is down), while a missing build is a real gap. Keeping the
// failure lets the page say which one happened.
export type DownloadState = 'ready' | 'pending' | 'unreachable' | 'unsupported'

export function downloadState({
  href,
  failed,
  settled = true,
}: {
  href: string | null
  failed: boolean
  // Defaults true so callers asking about a resolved href don't have to say so.
  settled?: boolean
}): DownloadState {
  // A usable download outranks a failure: the cache may have answered, or one of the
  // requests may have won after another lost. Nothing to apologise for.
  if (href !== null) return 'ready'
  if (!settled) return 'pending'
  return failed ? 'unreachable' : 'unsupported'
}
