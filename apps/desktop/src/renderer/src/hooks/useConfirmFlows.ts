import { useTranslation } from 'react-i18next'
import type {
  DeclickMode,
  NormalizeConfig,
  OutputFormat,
  Settings,
  TrackMetadata,
} from '../../../shared/types'
import type { StaleLibraryCopy } from '../lib/appleMusicLibrary'
import { eligibleForBatch } from '../lib/batch'
import { deriveTagPatches } from '../lib/deriveTags'
import type { Destination } from '../lib/destination'
import { DEFAULT_REQUIRED_FIELDS } from '../lib/fields'
import type { TrackItem } from '../types'
import type { ConfirmModal } from './useOverlays'

interface Params {
  settings: Settings | null
  removeTrack: (id: string) => void
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  // Empties the given rows: App routes the whole-list case to clearTracks (start over, drops
  // the folder watch) and the filtered-visible subset to removeTracks, so a format filter never
  // sweeps in the hidden rows.
  emptyTracks: (targets: TrackItem[]) => void
  deriveTracks: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  processAll: (
    targets: TrackItem[],
    format?: OutputFormat,
    normalize?: NormalizeConfig,
    destination?: Destination,
    declick?: DeclickMode,
  ) => Promise<void>
  openConfirm: (confirm: ConfirmModal) => void
  // A trash/delete IPC failure surfaced to the user — the action was confirmed, so a
  // silent failure would read as success.
  reportTrashFailure: (fileName: string) => void
  // Fired once the superseded Apple Music copy is gone (deleted, or already missing),
  // so App can refresh the library snapshot and confirm the outcome.
  onOldMusicCopyRemoved: () => void
  // Same fail-loud contract as reportTrashFailure, for the Apple Music removal. The
  // flag distinguishes the delete script REFUSING because the live track no longer
  // matches the confirmed label (nothing was deleted; the snapshot needs a refresh)
  // from an ordinary failure.
  reportOldCopyRemoveFailure: (mismatch: boolean) => void
  // The full list, so fill-all/clear-all can tell a filtered-visible subset from the
  // whole crate and say in the dialog that hidden rows survive.
  tracksRef: { current: TrackItem[] }
}

export interface ConfirmFlows {
  askTrash: (targets: TrackItem[]) => void
  askDeleteOriginal: (track: TrackItem) => void
  askRemoveOldMusicCopy: (track: TrackItem, stale: StaleLibraryCopy) => void
  askFillAll: (targets: TrackItem[], opts?: { fromSelection?: boolean }) => void
  askClearAll: (targets: TrackItem[]) => void
  askRemoveFromList: (targets: TrackItem[]) => void
  askConvertAll: (
    targets: TrackItem[],
    format?: OutputFormat,
    normalize?: NormalizeConfig,
    destination?: Destination,
    declick?: DeclickMode,
  ) => void
}

// The destructive/overwriting actions that confirm before firing: trash, delete original,
// fill-all, clear-all and in-place convert-all. Each builds its dialog copy and wires the
// onConfirm into the data layer; App only routes the resulting modal through useOverlays.
export function useConfirmFlows({
  settings,
  removeTrack,
  updateTrack,
  emptyTracks,
  deriveTracks,
  processAll,
  openConfirm,
  reportTrashFailure,
  onOldMusicCopyRemoved,
  reportOldCopyRemoveFailure,
  tracksRef,
}: Params): ConfirmFlows {
  const { t: tr } = useTranslation()

  // Right-click "Move to Trash": confirm first, then send each original file to the OS
  // Trash/Recycle Bin and drop its row only once that succeeds, so a failure leaves that
  // row untouched. Copy switches on platform because the destination differs, and on
  // count so a multi-selection reads "N files" instead of naming just one.
  function askTrash(targets: TrackItem[]): void {
    if (targets.length === 0) return
    const isWin = window.api.platform === 'win32'
    const count = targets.length
    openConfirm({
      title: tr(isWin ? 'confirm.trashTitleWin' : 'confirm.trashTitle', { count }),
      message: tr(isWin ? 'confirm.trashMessageWin' : 'confirm.trashMessage', {
        count,
        name: targets[0].fileName,
      }),
      confirmLabel: tr(isWin ? 'confirm.trashConfirmWin' : 'confirm.trashConfirm'),
      destructive: true,
      onConfirm: () => {
        for (const track of targets) {
          window.api
            .trashFile(track.inputPath)
            .then(() => removeTrack(track.id))
            // The user confirmed a destructive dialog; a silent failure here reads
            // as "the file is in the trash" when it isn't.
            .catch(() => reportTrashFailure(track.fileName))
        }
      },
    })
  }

  // Post-convert "Delete original": a real conversion leaves the source file beside the
  // converted copy, so this reclaims the disk. Confirm, send the original to the OS
  // Trash/Recycle Bin (recoverable), then mark the row so the button disappears — unlike
  // askTrash the row stays, because the converted output it points at is still there.
  function askDeleteOriginal(track: TrackItem): void {
    const isWin = window.api.platform === 'win32'
    openConfirm({
      title: tr(isWin ? 'confirm.trashTitleWin' : 'confirm.trashTitle'),
      message: tr(isWin ? 'confirm.deleteOriginalMessageWin' : 'confirm.deleteOriginalMessage', {
        name: track.fileName,
      }),
      confirmLabel: tr(isWin ? 'confirm.trashConfirmWin' : 'confirm.trashConfirm'),
      destructive: true,
      onConfirm: () => {
        window.api
          .trashFile(track.inputPath)
          .then(() => updateTrack(track.id, { originalTrashed: true }))
          // Same as askTrash: the user confirmed a destructive dialog, so a
          // failure must be said out loud, not swallowed.
          .catch(() => reportTrashFailure(track.fileName))
      },
    })
  }

  // Post-add "Remove the old copy": the freshly converted track is already in Apple
  // Music, so this deletes the library entry it superseded and sends that entry's file
  // to the OS Trash — the half of "replace the old rip" the add itself can't do. It acts
  // on the user's library off a scored hint (the stale-copy match), so it confirms
  // first — naming the matched entry by its own artist/title, since that label is the
  // only thing that lets the user catch a wrong match before it deletes. A 'missing'
  // result resolves the same success path: the goal is "the old copy is no longer
  // there", and it isn't.
  function askRemoveOldMusicCopy(track: TrackItem, stale: StaleLibraryCopy): void {
    openConfirm({
      title: tr('confirm.removeOldCopyTitle'),
      message: tr('confirm.removeOldCopyMessage', {
        name: track.meta.title || track.fileName,
        copy: stale.label,
      }),
      confirmLabel: tr('confirm.removeOldCopyConfirm'),
      destructive: true,
      onConfirm: () => {
        // The activity row names what was actually removed: the old copy itself.
        window.api
          .deleteAppleMusic(stale.persistentId, stale.label)
          .then((res) => {
            // The trashed file can BE a loaded row's source (Music's "copy files to
            // the Media folder" off + the user's own file added by hand): mark those
            // rows originalTrashed so the footer's delete-original link retires
            // instead of failing later on a file that's already in the Trash.
            if (res?.location) {
              for (const t of tracksRef.current) {
                if (t.inputPath === res.location) updateTrack(t.id, { originalTrashed: true })
              }
            }
            onOldMusicCopyRemoved()
          })
          // Same as askTrash: the user confirmed a destructive dialog, so a
          // failure must be said out loud, not swallowed. The sentinel travels as an
          // error-message substring because Electron IPC rejections carry only that.
          .catch((e: unknown) =>
            reportOldCopyRemoveFailure(String(e).includes('applemusic-delete-mismatch')),
          )
      },
    })
  }

  // Fills the given tracks' tags from their own file names — the mouse-driven counterpart
  // of the editor's per-track "Fill from filename", for cleaning a whole import at once.
  function deriveFrom(targets: TrackItem[]): void {
    const patches = deriveTagPatches(targets)
    if (patches.length) deriveTracks(patches)
  }

  // Fill-all and Clear-all both overwrite/discard work, so they ask first rather than firing
  // on the click; the dialog spells out exactly what changes. Targets is the visible (filtered)
  // set for the toolbar buttons, or the whole list for the palette's "Clear the list" — either
  // way the count in the copy matches what actually changes.
  function askFillAll(targets: TrackItem[], opts: { fromSelection?: boolean } = {}): void {
    const count = deriveTagPatches(targets).length
    const filtered = targets.length < tracksRef.current.length
    // A selection and a filter can produce the same count; only the caller knows which
    // scope it passed, and the dialog must name it ("selected" vs "visible").
    const messageKey = opts.fromSelection
      ? 'confirm.fillMessageSelected'
      : filtered
        ? 'confirm.fillMessageFiltered'
        : 'confirm.fillMessage'
    openConfirm({
      title: tr('confirm.fillTitle'),
      message: count > 0 ? tr(messageKey, { count }) : tr('confirm.fillNone'),
      confirmLabel: tr('confirm.fillConfirm'),
      confirmDisabled: count === 0,
      onConfirm: () => deriveFrom(targets),
    })
  }

  // Empties the given rows: the visible (filtered) set from the toolbar trash button, or the
  // whole list from the palette's "Clear the list". Emptying an MP3-filtered view via the
  // toolbar must not discard the hidden FLAC/WAV rows — the count in the copy says how many go.
  function askClearAll(targets: TrackItem[]): void {
    // A filter narrows what the toolbar button empties; the copy must say the hidden
    // rows stay, or confirming reads like the whole list is about to go.
    const filtered = targets.length < tracksRef.current.length
    openConfirm({
      title: tr('confirm.clearTitle'),
      message: tr(filtered ? 'confirm.clearMessageFiltered' : 'confirm.clearMessage', {
        count: targets.length,
      }),
      confirmLabel: tr('confirm.clearConfirm'),
      destructive: true,
      onConfirm: () => emptyTracks(targets),
    })
  }

  // A row's ✕ (and ⌫, and the context menu's Remove) acts on the whole selection when the
  // clicked row belongs to it — so one click on a hover-revealed target can discard dozens of
  // rows along with every staged edit on them, and a removal is not undoable. Asking only for
  // the expanded case is the point: a dialog on every single-row ✕ would be a tax on the
  // ordinary gesture and would train the user to dismiss it unread, which is precisely what
  // would let the lossy case through. Rare enough to be read.
  function askRemoveFromList(targets: TrackItem[]): void {
    if (targets.length <= 1) {
      for (const t of targets) removeTrack(t.id)
      return
    }
    openConfirm({
      title: tr('confirm.removeFromListTitle', { count: targets.length }),
      message: tr('confirm.removeFromListMessage', { count: targets.length }),
      confirmLabel: tr('confirm.removeFromListConfirm'),
      destructive: true,
      onConfirm: () => {
        for (const t of targets) removeTrack(t.id)
      },
    })
  }

  // Overwrite mode rewrites each source in place (the original is unlinked, not
  // trashed), so a batch run asks once before touching N files. The editor carries
  // the same warning per track; outside overwrite mode the batch stays one-click
  // because conversion only writes new files.
  function askConvertAll(
    targets: TrackItem[],
    format?: OutputFormat,
    normalize?: NormalizeConfig,
    destination?: Destination,
    declick?: DeclickMode,
  ): void {
    // The editor's one-shot destination pick decides whether this run rewrites
    // sources; only without one does the live setting. An override away from
    // overwrite needs no confirmation (the run only writes new files), and one
    // back onto it must still ask.
    const overwriting = destination ? destination === 'overwrite' : settings?.overwriteOriginal
    if (!overwriting) {
      void processAll(targets, format, normalize, destination, declick)
      return
    }
    openConfirm({
      title: tr('confirm.convertInPlaceTitle'),
      message: tr('confirm.convertInPlaceMessage', {
        count: eligibleForBatch(targets, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
          .length,
      }),
      confirmLabel: tr('confirm.convertInPlaceConfirm'),
      destructive: true,
      onConfirm: () => void processAll(targets, format, normalize, destination, declick),
    })
  }

  return {
    askTrash,
    askDeleteOriginal,
    askRemoveOldMusicCopy,
    askFillAll,
    askClearAll,
    askRemoveFromList,
    askConvertAll,
  }
}
