import { useTranslation } from 'react-i18next'
import type { NormalizeConfig, OutputFormat, Settings, TrackMetadata } from '../../../shared/types'
import { eligibleForBatch } from '../lib/batch'
import { smartDeriveTags } from '../lib/deriveTags'
import { DEFAULT_REQUIRED_FIELDS } from '../lib/fields'
import type { TrackItem } from '../types'
import type { ConfirmModal } from './useOverlays'

interface Params {
  settings: Settings | null
  removeTrack: (id: string) => void
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  // Empties the given rows: App routes the whole-list case to clearTracks (start over,
  // drops the folder watch) and any subset to removeTracks, so a format filter or a
  // selection never sweeps in the hidden rows.
  emptyTracks: (targets: TrackItem[], scope: 'selected' | 'all') => void
  deriveTracks: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  processAll: (
    targets: TrackItem[],
    format?: OutputFormat,
    normalize?: NormalizeConfig,
  ) => Promise<void>
  openConfirm: (confirm: ConfirmModal) => void
  // A trash/delete IPC failure surfaced to the user — the action was confirmed, so a
  // silent failure would read as success.
  reportTrashFailure: (fileName: string) => void
}

export interface ConfirmFlows {
  askTrash: (targets: TrackItem[]) => void
  askDeleteOriginal: (track: TrackItem) => void
  askFillAll: (targets: TrackItem[], scope: 'selected' | 'all') => void
  askClearAll: (targets: TrackItem[], scope: 'selected' | 'all') => void
  askConvertAll: (targets: TrackItem[], format?: OutputFormat, normalize?: NormalizeConfig) => void
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

  // Fills the given tracks' tags from their own file names — the mouse-driven counterpart
  // of the editor's per-track "Fill from filename", for cleaning a whole import (or just the
  // selected rows) at once.
  function deriveFrom(targets: TrackItem[]): void {
    const patches = targets
      .map((t) => ({ id: t.id, meta: smartDeriveTags(t.fileName) }))
      .filter((p) => Object.keys(p.meta).length > 0)
    if (patches.length) deriveTracks(patches)
  }

  // Fill-all and Clear-all both overwrite/discard work, so they ask first rather than firing
  // on the click; the dialog spells out exactly what changes. Targets is the selection when
  // the user has one, else the whole list — App decides which, so the copy reads "selected"
  // vs "all" accordingly.
  function askFillAll(targets: TrackItem[], scope: 'selected' | 'all'): void {
    const count = targets.filter((t) => Object.keys(smartDeriveTags(t.fileName)).length > 0).length
    openConfirm({
      title: tr('confirm.fillTitle'),
      message:
        count > 0
          ? tr(scope === 'selected' ? 'confirm.fillMessageSelected' : 'confirm.fillMessage', {
              count,
            })
          : tr('confirm.fillNone'),
      confirmLabel: tr('confirm.fillConfirm'),
      confirmDisabled: count === 0,
      onConfirm: () => deriveFrom(targets),
    })
  }

  // Empties the list, but only the tracks in scope: the selection when the user has one,
  // else the visible (filtered) rows — App passes 'selected' vs 'all' so the copy and the
  // count match what actually gets removed. Emptying a MP3-filtered view must not discard
  // the hidden FLAC/WAV rows, and a selection must not take out the rest of the list.
  function askClearAll(targets: TrackItem[], scope: 'selected' | 'all'): void {
    openConfirm({
      title: tr('confirm.clearTitle'),
      message: tr(scope === 'selected' ? 'confirm.clearMessageSelected' : 'confirm.clearMessage', {
        count: targets.length,
      }),
      confirmLabel: tr('confirm.clearConfirm'),
      destructive: true,
      onConfirm: () => emptyTracks(targets, scope),
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
  ): void {
    if (!settings?.overwriteOriginal) {
      void processAll(targets, format, normalize)
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
      onConfirm: () => void processAll(targets, format, normalize),
    })
  }

  return { askTrash, askDeleteOriginal, askFillAll, askClearAll, askConvertAll }
}
