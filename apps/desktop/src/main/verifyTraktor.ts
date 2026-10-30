import { extname } from 'node:path'
import type { PlaceCheck } from '../shared/verification'
import { findEntries, key, type NmlPatch } from './traktorNml'
import { formatOf } from './verifyFile'

// oldFile is the name the entry had in the patch's folder before the batch. stranded marks a
// patch that could not follow its file (it landed in another folder, see redirectNmlPatch):
// Traktor rewrites FILE only, so its entry stays on the old name.
export interface TraktorExpect {
  patch: NmlPatch
  oldFile: string
  stranded?: boolean
}

const check = (
  state: PlaceCheck['state'],
  detailKey: string,
  params?: Record<string, string | number>,
): PlaceCheck => ({
  place: 'traktor',
  state,
  detail: params ? { key: detailKey, params } : { key: detailKey },
})

// One read of the collection for the whole batch, after its write. One result per
// expectation, in order; null where Traktor is not listed: no rename was asked of it, or it
// has no entry for the track at either name. bootVolume names the internal disk, which
// Traktor stores by name and a patch leaves empty.
export function checkTraktor(
  nml: string,
  list: TraktorExpect[],
  bootVolume = '',
): (PlaceCheck | null)[] {
  const at = new Map<string, number>()
  for (const e of findEntries(nml)) {
    const k = key(e.volume, e.dir, e.file)
    at.set(k, (at.get(k) ?? 0) + 1)
  }
  return list.map((e) => judge(at, e, bootVolume))
}

function judge(at: Map<string, number>, e: TraktorExpect, bootVolume: string): PlaceCheck | null {
  const { patch } = e
  if (!patch.newFile && !e.stranded) return null
  const volume = patch.volume || bootVolume
  const oldKey = key(volume, patch.dir, e.oldFile)
  const old = at.get(oldKey) ?? 0
  const stillOld = check('mismatch', 'traktorStillOld', { format: formatOf(extname(e.oldFile)) })
  if (!patch.newFile) return old > 0 ? stillOld : null

  const newKey = key(volume, patch.dir, patch.newFile)
  const on = at.get(newKey) ?? 0
  if (on > 1) return check('mismatch', 'traktorAmbiguous', { count: on })
  // A rename that only recomposed the name (Finder's NFD against Traktor's NFC) leaves one
  // entry that is both the old name and the new one.
  if (old > 0 && oldKey !== newKey) return stillOld
  if (on === 1) return check('ok', 'traktorOk', { format: formatOf(extname(patch.newFile)) })
  return null
}
