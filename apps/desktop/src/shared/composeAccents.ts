export function composeMeta<T extends object>(meta: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string') out[key] = value.normalize('NFC')
    else if (key === 'custom' && value && typeof value === 'object') out[key] = composeMeta(value)
    else out[key] = value
  }
  return out as T
}
