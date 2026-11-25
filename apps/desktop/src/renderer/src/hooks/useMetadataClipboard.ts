import { useTranslation } from 'react-i18next'
import { effectiveMeta } from '../../../shared/customFields'
import type { CustomField } from '../../../shared/types'
import { BULK_FIELDS } from '../lib/bulkEdit'
import { renderOutputName } from '../lib/outputName'
import type { CopiedTags, TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

const PASTE_ALL_FIELDS = BULK_FIELDS.filter((key) => key !== 'comment')

interface Params {
  // The one copied tag set (App's store slice): the hook reads it to paste and to
  // gate the menu's paste item, App keeps ownership so a session restore can seed it.
  copiedMeta: CopiedTags | null
  setCopiedMeta: (m: CopiedTags | null) => void
  tracksRef: { current: TrackItem[] }
  // The rows an apply-to-all stamps (the current selection).
  selectedIds: string[]
  // The editor's track, whose Settings-pattern name the copy-filename action renders.
  selected: TrackItem | null
  filenameFormat: string
  customFields: readonly CustomField[]
  recordMetaUndo: (ids: string[], opts?: { cover?: boolean }) => void
  updateTracksMeta: (ids: string[], meta: Partial<CopiedTags['meta']>) => void
  patchTracks: (ids: string[], patch: Partial<TrackItem>) => void
  setNotice: (message: string) => void
}

interface MetadataClipboard {
  onCopyMeta: (track: TrackItem) => void
  onPasteMeta: (track: TrackItem) => void
  onPasteMetaAll: (ids: string[]) => void
  onCopyPath: (track: TrackItem) => void
  onApplyCoverAll: (coverUrl: string, coverPath?: string) => void
  onCopyFilename: () => void
}

// The metadata clipboard: copy a track's whole tag set and stamp it elsewhere, plus
// the smaller copies that share its toast surface (path, Settings-pattern file name)
// and the apply-cover-to-selection stamp. Split from App on the useConfirmFlows
// pattern — injected list mutators in, stable handlers out.
export function useMetadataClipboard({
  copiedMeta,
  setCopiedMeta,
  tracksRef,
  selectedIds,
  selected,
  filenameFormat,
  customFields,
  recordMetaUndo,
  updateTracksMeta,
  patchTracks,
  setNotice,
}: Params): MetadataClipboard {
  const { t: tr } = useTranslation()
  // Copy a track's whole tag set, then stamp it onto whichever track the user pastes
  // onto — the fast way to share release-level metadata across a crate.
  const onCopyMeta = useStableCallback((track: TrackItem) => {
    setCopiedMeta({ meta: track.meta, coverUrl: track.coverUrl, coverPath: track.coverPath })
    setNotice(tr('notices.copiedMeta'))
  })
  // A hand-picked cover is a blob: URL that is freed once no row shows it; if the
  // source row left the list since the copy, paste the tags but skip the dead image. A
  // pasted cover is the DJ's choice, which a library copy found later leaves alone.
  const aliveCover = (copied: CopiedTags) => {
    const { coverUrl, coverPath } = copied
    const coverAlive =
      !!coverUrl &&
      (!coverUrl.startsWith('blob:') || tracksRef.current.some((t) => t.coverUrl === coverUrl))
    return coverAlive ? { coverUrl, coverPath, coverPicked: true } : null
  }
  const onPasteMeta = useStableCallback((track: TrackItem) => {
    if (!copiedMeta) return
    recordMetaUndo([track.id], { cover: true })
    updateTracksMeta([track.id], copiedMeta.meta)
    const cover = aliveCover(copiedMeta)
    // The displaced cover is NOT revoked here: the undo snapshot above may restore
    // it, and revoking would hand ⌘Z a dead blob URL.
    if (cover) patchTracks([track.id], cover)
    setNotice(tr('notices.pastedMeta'))
  })
  // On a selection only the release-level fields travel: a title or track number
  // stamped on every row would flatten the album into copies of one song. The comment
  // stays too: it opens with each track's own rekordbox phrase count. No
  // confirmation, because one ⌘Z gives every row back.
  const onPasteMetaAll = useStableCallback((ids: string[]) => {
    if (!copiedMeta) return
    recordMetaUndo(ids, { cover: true })
    const release: Partial<CopiedTags['meta']> = {}
    for (const key of PASTE_ALL_FIELDS)
      if (key in copiedMeta.meta) release[key] = copiedMeta.meta[key]
    updateTracksMeta(ids, release)
    const cover = aliveCover(copiedMeta)
    if (cover) patchTracks(ids, cover)
    setNotice(tr('notices.pastedMeta'))
  })
  // Copies the source path to the clipboard. Routed through here (rather than the menu's
  // own window.api call) so it can confirm with the same toast the other copies show.
  const onCopyPath = useStableCallback((track: TrackItem) => {
    void window.api.copyText(track.inputPath)
    setNotice(tr('notices.copiedPath'))
  })
  const onApplyCoverAll = useStableCallback((coverUrl: string, coverPath?: string) => {
    recordMetaUndo(selectedIds, { cover: true })
    patchTracks(selectedIds, { coverUrl, coverPath, coverPicked: true })
  })
  // Copies the Settings-pattern name to the OS clipboard so the user can paste the track
  // into Google or Soulseek. A "/" in the pattern means a subfolder, so drop everything but
  // the last segment — the file name, not its directory, is what you search for.
  const onCopyFilename = useStableCallback(() => {
    if (!selected) return
    const name = renderOutputName(filenameFormat, effectiveMeta(selected, customFields))
    if (name) {
      void window.api.copyText(name.split('/').pop() ?? name)
      setNotice(tr('notices.copiedFilename'))
    }
  })
  return { onCopyMeta, onPasteMeta, onPasteMetaAll, onCopyPath, onApplyCoverAll, onCopyFilename }
}
