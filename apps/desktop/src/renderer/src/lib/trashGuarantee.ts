// Whether "you can restore it from the Trash" is a promise this path can keep.
//
// Measured 15/09 on the user's own machine: their music lives on a NAS mounted as
//   //GUEST:@MyCloud._smb._tcp.local/Public on /Volumes/Public (smbfs, noowners)
// with no .Trashes folder. macOS cannot move a file to a Trash there, so a delete is
// permanent — while the confirm dialog promised it was recoverable. A file was lost that
// way. The action is unchanged; only the wording stops claiming what the volume cannot
// honour.
//
// Deliberately conservative and path-shaped rather than a live filesystem probe: the
// renderer cannot inspect mounts, and a wrong "recoverable" is the costly error while a
// wrong "may be permanent" only makes the user pause. Everything under /Volumes (macOS)
// and the usual mount roots (Linux) is treated as unable to promise, local paths as able.
export function trashIsRecoverable(path: string, platform: NodeJS.Platform): boolean {
  if (!path) return false
  // Windows keeps a Recycle Bin per drive, mapped network drives included, so the promise
  // holds wherever the file sits.
  if (platform === 'win32') return true
  if (platform === 'darwin') return !path.startsWith('/Volumes/')
  return !path.startsWith('/mnt/') && !path.startsWith('/media/')
}
