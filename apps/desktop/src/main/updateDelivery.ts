// The slice of BrowserWindow the delivery needs, so tests can hand in plain fakes.
export interface UpdateTarget {
  webContents: { send: (channel: string, version: string) => void }
}

interface DownloadEvents {
  on(event: 'update-downloaded', cb: (info: { version: string }) => void): unknown
}

// Routes the updater's downloaded event to whichever window is alive when it fires.
// Capturing the launch window broke on macOS: ⌘W destroys it while the app (and the
// updater) keep running, so every later "restart to update" toast went to a destroyed
// webContents and releases passed silently. A version that lands while no window
// exists is remembered and replayed to the next window that loads, so a re-check
// that fires with the window closed still surfaces once the user comes back.
export function wireUpdateDelivery(
  updater: DownloadEvents,
  liveWindow: () => UpdateTarget | undefined,
  onWindowLoaded: (cb: (win: UpdateTarget) => void) => void,
): void {
  let pending: string | null = null
  updater.on('update-downloaded', (info) => {
    pending = info.version
    liveWindow()?.webContents.send('update:downloaded', info.version)
  })
  onWindowLoaded((win) => {
    if (pending) win.webContents.send('update:downloaded', pending)
  })
}
