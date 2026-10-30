export type VerifyPlace = 'file' | 'appleMusic' | 'rekordbox' | 'engine' | 'traktor'
export type CheckState = 'checking' | 'ok' | 'mismatch' | 'pending' | 'unreadable'

// Every detail a check can come back with, each a string under `verify.detail.*` in every
// locale. A runtime list with the type derived from it, like ERROR_KEYS: a checker that
// sends a key not listed here does not compile, and the renderer's locale test walks the
// list so none of them reaches the screen raw.
export const VERIFY_DETAIL_KEYS = [
  'pending',
  'checking',
  'fileIdentical',
  'fileReencoded',
  'fileMissing',
  'fileWrongFormat',
  'fileTruncated',
  'filePcmDiffers',
  'fileTagDiffers',
  'fileNoCover',
  'fileCoverKept',
  'fileUnreadable',
  'fileSourceGone',
  'musicOne',
  'musicOneNoPlaylists',
  'musicMissing',
  'musicNoFile',
  'musicOtherFile',
  'musicWrongFile',
  'musicDuplicate',
  'musicTagDiffers',
  'musicNoArtwork',
  'musicPlaylistLost',
  'musicUnreadable',
  'rekordboxOk',
  'rekordboxStillOld',
  'rekordboxMissing',
  'rekordboxAmbiguous',
  'rekordboxOtherRow',
  'rekordboxSizeDiffers',
  'rekordboxCuesLost',
  'rekordboxCuesChanged',
  'rekordboxAnalysisEmptied',
  'rekordboxUnreadable',
  'engineOk',
  'engineStillOld',
  'engineMissing',
  'engineAmbiguous',
  'engineOtherRow',
  'engineNoFileType',
  'engineSizeDiffers',
  'enginePerformanceChanged',
  'engineCuesMisplaced',
  'engineUnreadable',
  'traktorOk',
  'traktorStillOld',
  'traktorMissing',
  'traktorAmbiguous',
  'traktorCuesChanged',
  'traktorUnreadable',
] as const

export type VerifyDetailKey = (typeof VERIFY_DETAIL_KEYS)[number]

export interface CheckDetail {
  key: VerifyDetailKey
  params?: Record<string, string | number | string[]>
}

export interface PlaceCheck {
  place: VerifyPlace
  state: CheckState
  detail: CheckDetail
  // No retry can change this answer (a library row with no photo from before the write):
  // reading again would only say the same.
  final?: true
}

export interface Verification {
  status: 'checking' | 'ok' | 'mismatch' | 'pending'
  checks: PlaceCheck[]
  job?: string
  seq?: number
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
