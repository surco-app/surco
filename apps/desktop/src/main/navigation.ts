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

// Whether a navigation target stays on the app's own origin. The SPA never
// navigates the top frame itself, so anything off-origin is unexpected and gets
// blocked. file:// URLs have an opaque ('null') origin that compares equal to
// itself, so the packaged build's index.html still counts as internal.
export function isInternalNavigation(target: string, appUrl: string): boolean {
  try {
    return new URL(target).origin === new URL(appUrl).origin
  } catch {
    return false
  }
}
