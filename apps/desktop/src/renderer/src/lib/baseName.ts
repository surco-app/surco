export function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut >= 0 ? path.slice(cut + 1) : path
}
