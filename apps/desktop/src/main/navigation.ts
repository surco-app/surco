// Navigation guards for the single window. The renderer is local, trusted code,
// but these bound the blast radius if it is ever compromised (an XSS, a bad
// dependency): external links may only open web URLs, and the top frame may not
// be navigated off the app's own origin to a remote page that would escape the
// local CSP.

// Whether a URL is safe to hand to shell.openExternal. Anything but http/https —
// file://, smb://, a registered custom-protocol handler, javascript: — could be
// launched outside the browser, so only web URLs are allowed through.
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

// Whether a remote URL must NOT be fetched by the main process. The cover-download
// path lets the (potentially compromised) renderer name an arbitrary URL, which is an
// SSRF primitive: a fetch to http://169.254.169.254/ (cloud metadata) or a loopback
// service would reach it from the trusted main process and hand the bytes back to the
// renderer. We refuse non-web schemes and any host that is a private, loopback or
// link-local address literal; a cover dragged from a public site is an ordinary public
// host and still goes through. Residual gap: a DNS name that resolves to a private IP
// isn't caught here (that needs a resolve-then-connect check) — this stops the
// direct-literal vector, the one a renderer can aim at a metadata service.
export function isBlockedFetchUrl(url: string): boolean {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
    host = parsed.hostname.toLowerCase()
  } catch {
    return true
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  // URL.hostname keeps an IPv6 literal's brackets ("[::1]"); strip them to classify it.
  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1)
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6)
    if (!mapped) return v6 === '::1' || v6 === '::' || /^(fe80|fc|fd)/.test(v6)
    const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)]
    host = [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.')
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

// Whether a navigation target stays on the app's own origin. The SPA never
// navigates the top frame itself, so anything off-origin is unexpected and gets
// blocked. file:// URLs all share the opaque ('null') origin, so any local HTML
// would pass that check and load with the preload: for file: only the app's own
// index.html (any hash) counts as internal.
export function isInternalNavigation(target: string, appUrl: string): boolean {
  try {
    const to = new URL(target)
    const app = new URL(appUrl)
    if (app.protocol === 'file:' || to.protocol === 'file:')
      return to.protocol === app.protocol && to.pathname === app.pathname
    return to.origin === app.origin
  } catch {
    return false
  }
}
