// Requests still in flight, keyed like their stored counterparts. The stored copy only
// helps the NEXT page: the buttons sharing a page all run their effects in the
// same tick, before any response has landed, so without this the first render still spends
// one request per mount. Measured on the home page: 3 installer lookups.
const inFlight = new Map<string, Promise<unknown>>()

// Reads `key` from sessionStorage, and otherwise runs `request` — joining an identical one
// already in flight rather than starting a second. Only a success is stored: caching a
// failure would pin an outage to the rest of the session, long after GitHub recovered.
// sessionStorage is reached through globalThis because it is absent in the SSG prerender
// and throws in private-mode Safari.
async function cachedBySession<T>(key: string, request: () => Promise<T>): Promise<T> {
  try {
    const raw = globalThis.sessionStorage?.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    // A corrupt entry throws on parse; falling through to the request is the answer.
  }
  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T>

  const started = request().then((value) => {
    try {
      globalThis.sessionStorage?.setItem(key, JSON.stringify(value))
    } catch {
      // Storage blocked or full: the page still works, it just costs a request again on
      // the next one. Caching must never break the thing it exists to speed up.
    }
    return value
  })

  // The shared promise is the one handed back, not a `.finally` branch off it: that branch
  // would be a second, unobserved chain, and a rejected request would surface as an
  // unhandled rejection in the visitor's browser. The eviction rides on a swallowed copy
  // instead, and drops the entry either way so a failure stays retryable.
  inFlight.set(key, started)
  void started.then(
    () => inFlight.delete(key),
    () => inFlight.delete(key),
  )
  return started
}

export interface InstallerRelease {
  tag_name: string
  draft?: boolean
  // size rides in the same payload the download URL comes from, so showing the
  // installer weight costs no extra request against the 60/hour rate limit.
  assets?: { name: string; browser_download_url: string; size?: number }[]
}

// The button asking for the installer is mounted on every page — three times on the home
// page alone (hero, closing CTA, install section) — and each mount used to spend its own
// request against the same 60/hour-per-IP budget. A visit through home →
// features → guide → changelog cost a dozen, which is how a shared office or CGNAT address
// reaches the 403 that drops visitors onto a raw asset list. The installer URL only changes
// when a release ships, so one request per session is enough.
export function fetchInstallerReleasesCached(repo: string): Promise<InstallerRelease[]> {
  return cachedBySession(`surco:installers:${repo}`, async () => {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`)
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
    return (await res.json()) as InstallerRelease[]
  })
}

// The newest release whose installer for `suffix` (e.g. "arm64.dmg", ".exe") is actually
// uploaded. During a release CI creates the new release before it finishes uploading its
// assets, so /releases/latest would point at a build with no installer yet; walking the
// list and skipping it falls back to the previous build that still downloads, instead of
// reporting no installer. GitHub returns releases newest-first, so the first match wins.
export function pickInstallerRelease(
  releases: InstallerRelease[],
  suffix: string,
): InstallerRelease | undefined {
  return releases.find((r) => !r.draft && (r.assets ?? []).some((a) => a.name.endsWith(suffix)))
}
