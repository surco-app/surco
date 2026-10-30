export type VerifyPlace = 'file' | 'appleMusic' | 'rekordbox' | 'engine' | 'traktor'
export type CheckState = 'checking' | 'ok' | 'mismatch' | 'pending' | 'unreadable'

export interface CheckDetail {
  key: string
  params?: Record<string, string | number | string[]>
}

export interface PlaceCheck {
  place: VerifyPlace
  state: CheckState
  detail: CheckDetail
}

export interface Verification {
  status: 'checking' | 'ok' | 'mismatch' | 'pending'
  checks: PlaceCheck[]
}

export const PLACE_ORDER: VerifyPlace[] = ['file', 'appleMusic', 'rekordbox', 'engine', 'traktor']

export function verificationStatus(checks: PlaceCheck[]): Verification['status'] {
  if (checks.length === 0) return 'checking'
  if (checks.some((c) => c.state === 'mismatch' || c.state === 'unreadable')) return 'mismatch'
  if (checks.some((c) => c.state === 'checking')) return 'checking'
  if (checks.some((c) => c.state === 'pending')) return 'pending'
  return 'ok'
}

export function withChecks(v: Verification, replace: PlaceCheck[]): Verification {
  const replaced = new Set(replace.map((c) => c.place))
  const checks = [...v.checks.filter((c) => !replaced.has(c.place)), ...replace].sort(
    (a, b) => PLACE_ORDER.indexOf(a.place) - PLACE_ORDER.indexOf(b.place),
  )
  return { status: verificationStatus(checks), checks }
}
