// The host OS, read from the preload bridge at call time so this module never touches
// window.api at import. The two checks the UI gates on — macOS for the Apple Music and
// Finder integrations, Windows for its Explorer wording — live here so components read
// one helper instead of reaching into window.api.platform themselves.
export function isMacOS(): boolean {
  return window.api.platform === 'darwin'
}

export function isWindows(): boolean {
  return window.api.platform === 'win32'
}
