import { extname } from 'node:path'
import type { PlaceCheck, VerifyDetailKey } from '../shared/verification'
import { entryCues, findEntries, locationKey, type NmlPatch } from './traktorNml'
import { formatOf } from './verifyFile'

// before is the FILE of the entry the patch matched in the collection read ahead of the
// write (matchedEntryFiles), null when Traktor had no entry for the track. stranded marks a
// patch that could not follow its file (it landed in another folder, see redirectNmlPatch):
// Traktor rewrites FILE only, so its entry stays on the old name. cues are that entry's cues
// as the same read found them (matchedEntryCues).
export interface TraktorExpect {
  patch: NmlPatch
  before: string | null
  cues?: string | null
  stranded: boolean
}

const check = (
  state: PlaceCheck['state'],
  detailKey: VerifyDetailKey,
  params?: Record<string, string | number>,
): PlaceCheck => ({
  place: 'traktor',
  state,
  detail: params ? { key: detailKey, params } : { key: detailKey },
})

// One read of the collection for the whole batch, after its write. One result per
// expectation, in order; null where Traktor is not listed: it had no entry for the track, or
// no rename was asked of it and the write read no cues to hold it to. bootVolume names the
// internal disk, which Traktor stores by name and a patch leaves empty.
export function checkTraktor(
  nml: string,
  list: TraktorExpect[],
  bootVolume: string,
): (PlaceCheck | null)[] {
  const at = new Map<string, number>()
  const atAnyCase = new Map<string, number>()
  const cuesAt = new Map<string, string>()
  for (const e of findEntries(nml)) {
    const k = locationKey(e.volume, e.dir, e.file)
    at.set(k, (at.get(k) ?? 0) + 1)
    atAnyCase.set(k.toLowerCase(), (atAnyCase.get(k.toLowerCase()) ?? 0) + 1)
    if (!cuesAt.has(k)) cuesAt.set(k, entryCues(nml.slice(e.start, e.end)))
  }
  return list.map((e) => judge(at, atAnyCase, cuesAt, e, bootVolume))
}

function judge(
  at: Map<string, number>,
  atAnyCase: Map<string, number>,
  cuesAt: Map<string, string>,
  e: TraktorExpect,
  bootVolume: string,
): PlaceCheck | null {
  const { patch, before } = e
  if (before === null) return null
  const volume = patch.volume || bootVolume
  // The output went to another folder and the entry stays on the source, whose audio did
  // not change: the write was to leave its cues exactly as they were. A conversion in place
  // under the same name rewrote the source itself, cues included, so there is nothing to hold.
  if (!patch.newFile && !e.stranded) {
    if (e.cues == null || !patch.outputDir || !patch.outputFile) return null
    const output = locationKey(patch.outputVolume || bootVolume, patch.outputDir, patch.outputFile)
    if (output === locationKey(volume, patch.dir, patch.file)) return null
    const now = cuesAt.get(locationKey(volume, patch.dir, before))
    if (now === undefined) return check('mismatch', 'traktorMissing')
    if (now !== e.cues) return check('mismatch', 'traktorCuesChanged')
    return check('ok', 'traktorOk', { format: formatOf(extname(before)) })
  }
  // The old name in any casing: on a case-insensitive volume an entry spelled Title.AIFF is
  // still on the replaced file.
  const oldKey = locationKey(volume, patch.dir, before).toLowerCase()
  const old = atAnyCase.get(oldKey) ?? 0
  const stillOld = check('mismatch', 'traktorStillOld', { format: formatOf(extname(before)) })
  if (!patch.newFile) return old > 0 ? stillOld : check('mismatch', 'traktorMissing')

  const newKey = locationKey(volume, patch.dir, patch.newFile)
  const on = at.get(newKey) ?? 0
  if (on > 1) return check('mismatch', 'traktorAmbiguous', { count: on })
  // A rename that only recomposed or recased the name leaves one entry that is both the old
  // name and the new one.
  if (old > 0 && oldKey !== newKey.toLowerCase()) return stillOld
  if (on === 1) return check('ok', 'traktorOk', { format: formatOf(extname(patch.newFile)) })
  return check('mismatch', 'traktorMissing')
}
