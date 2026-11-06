export const CACHE_GB_DEFAULT = 10
export const CACHE_GB_MIN = 2
export const CACHE_GB_MAX = 100
const MB_PER_TRACK = 1

export function sanitizeCacheGb(value: unknown): number {
  const n = Number(value)
  if (value === null || value === '' || !Number.isFinite(n)) return CACHE_GB_DEFAULT
  return Math.min(CACHE_GB_MAX, Math.max(CACHE_GB_MIN, Math.round(n)))
}

export function tracksThatFit(gb: number): number {
  return Math.round((gb * 1000) / MB_PER_TRACK / 100) * 100
}

export function cacheBytesOf(gb: number): number {
  return gb * 1024 ** 3
}
