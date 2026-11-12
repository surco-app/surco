const DRIVE = /^[A-Za-z]:[\\/]/
const DRIVE_ROOT = /^[A-Za-z]:[\\/]?$/
const SPELLED = /(?:FilePath|path)="([A-Za-z]):([\\/])/

export const isVirtualdjDrivePath = (path: string): boolean => DRIVE.test(path)

export const isWindowsDriveRoot = (root: string): boolean => DRIVE_ROOT.test(root)

export function virtualdjWindowsPath(path: string, letter = path[0]): string {
  return `${letter}:\\${path.slice(3).replaceAll('/', '\\')}`
}

export const virtualdjListPath = (path: string): string =>
  isVirtualdjDrivePath(path) ? virtualdjWindowsPath(path) : path

export function virtualdjPathKey(path: string): string {
  const nfc = path.normalize('NFC')
  return isVirtualdjDrivePath(nfc)
    ? `${nfc[0].toUpperCase()}:/${nfc.slice(3).replaceAll('\\', '/')}`
    : nfc
}

export const virtualdjSpelledLetter = (text: string): string | undefined => text.match(SPELLED)?.[1]

export function virtualdjSpelling(path: string, text: string, letter = path[0]): string {
  if (!isVirtualdjDrivePath(path)) return path
  const sep = text.match(SPELLED)?.[2] ?? '\\'
  return `${letter}:${sep}${path.slice(3).split(/[\\/]/).join(sep)}`
}
