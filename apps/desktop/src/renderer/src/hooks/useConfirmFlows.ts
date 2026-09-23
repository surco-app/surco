import { useTranslation } from 'react-i18next'
import { batchKeepMp3, reencodesLossyInPlace } from '../../../shared/format'
import type {
  DeclickMode,
  FormatSetting,
  NormalizeConfig,
  Settings,
  TrackMetadata,
} from '../../../shared/types'
import type { StaleLibraryCopy } from '../lib/appleMusicLibrary'
import { eligibleForBatch } from '../lib/batch'
import { deriveTagPatches } from '../lib/deriveTags'
import type { Destination } from '../lib/destination'
import { DEFAULT_REQUIRED_FIELDS } from '../lib/fields'
import { declickFor, declickForJob, normalizeFor, normalizeForJob } from '../lib/reapply'
import type { SupersededFile } from '../lib/selectionStatus'
import { hasStagedEdits } from '../lib/sessionEdits'
import type { TrackItem } from '../types'
import type { ConfirmModal } from './useOverlays'

export interface CleanupOffer {
  originalPath: string | null
  superseded: SupersededFile[]
  staleMusicCopy: StaleLibraryCopy | null
}

export function cleanupCount(offer: CleanupOffer): number {
  return (offer.originalPath ? 1 : 0) + offer.superseded.length + (offer.staleMusicCopy ? 1 : 0)
}

// Whether a track's own filters (normalize, trim, declick) will actually reach the
// job — resolved through the same normalizeFor/declickFor precedence the conversion
// itself uses (the track's own dial, then the batch pick, then the Settings default
// processTrack falls back to), so a job with no picks of its own is checked against the
// filter the main process will actually run. Then normalizeForJob/declickForJob's skip
// of a filter already baked into an in-place export, so a track that reads its own
// prior export doesn't trip the warning for work that already happened and won't run
// again. Sharing the resolvers is what keeps this prediction and the conversion from
// disagreeing: reading only the pick here let a track carrying its own normalization
// convert in place as a lossy re-encode without the warning that exists to catch it.
function hasActiveFilters(
  track: TrackItem,
  normalize: NormalizeConfig | undefined,
  declick: DeclickMode | undefined,
  settings: Settings | null,
): boolean {
  const effectiveNormalize = normalizeForJob(
    track,
    normalizeFor(track, normalize, settings?.normalize),
  )
  const effectiveDeclick = declickForJob(track, declickFor(track, declick, settings?.declick))
  return (
    (effectiveNormalize !== undefined && effectiveNormalize.mode !== 'none') ||
    (effectiveDeclick !== undefined && effectiveDeclick !== 'off') ||
    track.trim !== undefined
  )
}

// Whether converting this track under the given format/overwrite would re-encode an
// MP3 over itself while an active filter forces planConversion off its stream-copy
// shortcut — the lossy generation loss BUG 2 exists to catch, whether the in-place
// write comes from 'source' resolving to the file's own format or from overwrite mode.
function risksLossyReencode(
  track: TrackItem,
  format: FormatSetting | undefined,
  overwriteOriginal: boolean | undefined,
  normalize: NormalizeConfig | undefined,
  declick: DeclickMode | undefined,
  settings: Settings | null,
  keepMp3: boolean,
): boolean {
  if (!format) return false
  return reencodesLossyInPlace(
    format,
    track.inputPath,
    overwriteOriginal ?? false,
    hasActiveFilters(track, normalize, declick, settings),
    'aiff',
    keepMp3,
  )
}

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
    format?: FormatSetting,
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

interface ConfirmFlows {
  askTrash: (targets: TrackItem[]) => void
  // The post-convert "clean up": the original, the files a replacement superseded and the
  // old Apple Music copy, offered together in one dialog that lists each. Async because the
  // wording depends on whether each file's volume keeps a Trash, which only the main
  // process can answer.
  askCleanUp: (track: TrackItem, offer: CleanupOffer) => Promise<void>
  askFillAll: (targets: TrackItem[], opts?: { fromSelection?: boolean }) => void
  askClearAll: (targets: TrackItem[]) => void
  askRemoveFromList: (targets: TrackItem[]) => void
  askConvertAll: (
    targets: TrackItem[],
    format?: FormatSetting,
    normalize?: NormalizeConfig,
    destination?: Destination,
    declick?: DeclickMode,
  ) => void
  // The single-track counterpart of askConvertAll: it decides overwrite the same way,
  // then runs the conversion the caller wired (donate nudge, re-encode) rather than the
  // batch path — so one convert and a batch convert confirm the same irreversible write.
  // track/format/normalize/declick are the same lossy-in-place check askConvertAll runs
  // per target — passed here because a single convert has only one track to check.
  askConvertOne: (
    run: () => void,
    opts?: {
      destination?: Destination
      track?: TrackItem
      format?: FormatSetting
      normalize?: NormalizeConfig
      declick?: DeclickMode
    },
  ) => void
}

// The destructive/overwriting actions that confirm before firing: trash, clean up,
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

  // Nothing here is automatic: three runs on 15/09 looked like a correct replacement and
  // were not, and an automatic delete in any of them would have destroyed the only copy.
  // So one confirmed dialog names every file it moves, to the OS Trash rather than a hard
  // delete. The old library copy goes first because its file can BE the listed original
  // (Music's "copy files to the Media folder" off): that removal already trashed it, and
  // a second trash would fail on a missing file. Each row is marked only once its own file
  // is gone, so a partial failure leaves the rest of the offer standing.
  async function askCleanUp(track: TrackItem, offer: CleanupOffer): Promise<void> {
    const { originalPath, superseded, staleMusicCopy } = offer
    const files = [...(originalPath ? [originalPath] : []), ...superseded.map((s) => s.path)]
    const count = cleanupCount(offer)
    const isWin = window.api.platform === 'win32'
    const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
    // A network volume may have no Trash, and the OS then deletes outright. Measured 15/09
    // on the user's NAS (smbfs, no .Trashes): a file was lost while the dialog promised it
    // was recoverable. Any such file drops the promise for the whole offer.
    const keeps = await Promise.all(files.map((path) => window.api.keepsTrash(path)))
    const message = tr(isWin ? 'confirm.cleanUpMessageWin' : 'confirm.cleanUpMessage', { count })
    const items = [
      ...(originalPath ? [tr('confirm.cleanUpOriginal', { name: baseName(originalPath) })] : []),
      ...superseded.map(({ path }) => tr('confirm.cleanUpSuperseded', { name: baseName(path) })),
      ...(staleMusicCopy ? [tr('confirm.cleanUpMusicCopy', { copy: staleMusicCopy.label })] : []),
    ]
    const trash = (path: string, patch: Partial<TrackItem>, id: string): void => {
      window.api
        .trashFile(path)
        .then(() => updateTrack(id, patch))
        .catch(() => reportTrashFailure(baseName(path)))
    }
    const trashFiles = (alreadyGone: string | undefined): void => {
      if (originalPath && originalPath !== alreadyGone)
        trash(originalPath, { originalTrashed: true }, track.id)
      for (const { path, trackId } of superseded) {
        if (path === alreadyGone) continue
        trash(path, { supersededTrashed: true }, trackId)
      }
    }
    openConfirm({
      title: tr(isWin ? 'confirm.trashTitleWin' : 'confirm.trashTitle', { count }),
      message: keeps.every(Boolean) ? message : `${message} ${tr('confirm.trashRemoteWarning')}`,
      items,
      confirmLabel: tr(isWin ? 'confirm.trashConfirmWin' : 'confirm.trashConfirm'),
      destructive: true,
      onConfirm: () => {
        if (!staleMusicCopy) {
          trashFiles(undefined)
          return
        }
        window.api.deleteAppleMusic(staleMusicCopy.persistentId, staleMusicCopy.label).then(
          (res) => {
            if (res?.location) {
              for (const t of tracksRef.current) {
                if (t.inputPath === res.location) updateTrack(t.id, { originalTrashed: true })
              }
            }
            onOldMusicCopyRemoved()
            trashFiles(res?.location)
          },
          // The sentinel travels as an error-message substring because Electron IPC
          // rejections carry only that.
          (e: unknown) => {
            reportOldCopyRemoveFailure(String(e).includes('applemusic-delete-mismatch'))
            trashFiles(undefined)
          },
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
  // rows along with every staged edit on them, and a removal is not undoable (useMetaUndo
  // filters to rows that still exist and never resurrects a deleted one). Not asking on the
  // ordinary gesture is the point: a dialog on every single-row ✕ would be a tax on it and
  // would train the user to dismiss it unread, which is precisely what would let the lossy
  // case through.
  //
  // So the question is what the removal COSTS, not how many rows it spans: a lone track
  // carrying an hour of tagging is the expensive case, and by count it went straight
  // through with nothing to say it had anything on it. A clean row still goes in one
  // click, whether it is one or one of many.
  function askRemoveFromList(targets: TrackItem[]): void {
    if (targets.length <= 1 && !targets.some(hasStagedEdits)) {
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
    format?: FormatSetting,
    normalize?: NormalizeConfig,
    destination?: Destination,
    declick?: DeclickMode,
  ): void {
    // The editor's one-shot destination pick decides whether this run rewrites
    // sources; only without one does the live setting. An override away from
    // overwrite needs no confirmation (the run only writes new files), and one
    // back onto it must still ask.
    const overwriting = destination ? destination === 'overwrite' : settings?.overwriteOriginal
    const keep = batchKeepMp3(
      format,
      settings?.outputFormat ?? 'aiff',
      settings?.keepMp3Sources ?? false,
    )
    // 'source' resolving to a track's own mp3 is in-place regardless of overwrite, so
    // the lossy re-encode risk is checked even when overwriting is off — it is the
    // one case where a non-overwrite run still rewrites the original. No explicit pick
    // falls back to the live setting, same as processAll resolves its pinned format.
    const lossyReencode = targets.some((t) =>
      risksLossyReencode(
        t,
        format ?? settings?.outputFormat,
        overwriting,
        normalize,
        declick,
        settings,
        keep,
      ),
    )
    if (!overwriting && !lossyReencode) {
      void processAll(targets, format, normalize, destination, declick)
      return
    }
    const count = eligibleForBatch(
      targets,
      settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS,
    ).length
    // The lossy-reencode wording explains the quality-loss reason and wins whenever it
    // applies, overwrite or not — a plain "originals are replaced" dialog would leave
    // out exactly the risk (a generational MP3 re-encode) the user needs to weigh.
    openConfirm(
      lossyReencode
        ? {
            title: tr('confirm.convertLossyReencodeTitle'),
            message: tr('confirm.convertLossyReencodeMessage', { count }),
            confirmLabel: tr('confirm.convertLossyReencodeConfirm'),
            destructive: true,
            onConfirm: () => void processAll(targets, format, normalize, destination, declick),
          }
        : {
            title: tr('confirm.convertInPlaceTitle'),
            message: tr('confirm.convertInPlaceMessage', { count }),
            confirmLabel: tr('confirm.convertInPlaceConfirm'),
            destructive: true,
            onConfirm: () => void processAll(targets, format, normalize, destination, declick),
          },
    )
  }

  // A single in-place convert unlinks its source just as a batch does, so it asks the
  // same question before firing. Reused by every entry point to single conversion (the
  // editor button and the process-current command) via the run callback, which carries
  // the donate nudge and re-encode the batch path doesn't. Away from overwrite it fires
  // straight through — only new files are written.
  function askConvertOne(
    run: () => void,
    opts: {
      destination?: Destination
      track?: TrackItem
      format?: FormatSetting
      normalize?: NormalizeConfig
      declick?: DeclickMode
    } = {},
  ): void {
    const overwriting = opts.destination
      ? opts.destination === 'overwrite'
      : settings?.overwriteOriginal
    // Same 'source'-resolves-to-mp3 case as askConvertAll: in place regardless of
    // overwrite, so it's checked even when overwriting is off.
    const lossyReencode = opts.track
      ? risksLossyReencode(
          opts.track,
          opts.format,
          overwriting,
          opts.normalize,
          opts.declick,
          settings,
          false,
        )
      : false
    if (!overwriting && !lossyReencode) {
      run()
      return
    }
    openConfirm(
      lossyReencode
        ? {
            title: tr('confirm.convertLossyReencodeTitle'),
            message: tr('confirm.convertLossyReencodeMessage', { count: 1 }),
            confirmLabel: tr('confirm.convertLossyReencodeConfirm'),
            destructive: true,
            onConfirm: run,
          }
        : {
            title: tr('confirm.convertInPlaceTitle'),
            message: tr('confirm.convertInPlaceMessage', { count: 1 }),
            confirmLabel: tr('confirm.convertInPlaceConfirm'),
            destructive: true,
            onConfirm: run,
          },
    )
  }

  return {
    askTrash,
    askCleanUp,
    askFillAll,
    askClearAll,
    askRemoveFromList,
    askConvertAll,
    askConvertOne,
  }
}
