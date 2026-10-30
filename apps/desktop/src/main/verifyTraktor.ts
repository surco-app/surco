import { extname } from 'node:path'
import type { PlaceCheck, VerifyDetailKey } from '../shared/verification'
import { findEntries, locationKey, type NmlPatch } from './traktorNml'
import { formatOf } from './verifyFile'

// before is the FILE of the entry the patch matched in the collection read ahead of the
// write (matchedEntryFiles), null when Traktor had no entry for the track. stranded marks a
// patch that could not follow its file (it landed in another folder, see redirectNmlPatch):
// Traktor rewrites FILE only, so its entry stays on the old name.
export interface TraktorExpect {
  patch: NmlPatch
  before: string | null
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
// no rename was asked of it. bootVolume names the internal disk, which Traktor stores by
// name and a patch leaves empty.
export function checkTraktor(
  nml: string,
  list: TraktorExpect[],
  bootVolume: string,
): (PlaceCheck | null)[] {
  const at = new Map<string, number>()
  const atAnyCase = new Map<string, number>()
  for (const e of findEntries(nml)) {
    const k = locationKey(e.volume, e.dir, e.file)
    at.set(k, (at.get(k) ?? 0) + 1)
    atAnyCase.set(k.toLowerCase(), (atAnyCase.get(k.toLowerCase()) ?? 0) + 1)
  }
  return list.map((e) => judge(at, atAnyCase, e, bootVolume))
}

function judge(
  at: Map<string, number>,
  atAnyCase: Map<string, number>,
  e: TraktorExpect,
  bootVolume: string,
): PlaceCheck | null {
  const { patch, before } = e
  if (before === null) return null
  if (!patch.newFile && !e.stranded) return null
  const volume = patch.volume || bootVolume
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
