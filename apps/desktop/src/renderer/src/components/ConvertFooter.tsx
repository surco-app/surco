import { SlidersVertical } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig, OutputFormat } from '../../../shared/types'
import type { StaleLibraryCopy } from '../lib/appleMusicLibrary'
import { openFeedback } from '../lib/feedback'
import { isMacOS } from '../lib/platform'
import type { SelectionStatus } from '../lib/selectionStatus'
import type { TrackItem } from '../types'
import { ExportButton } from './ExportButton'
import { Tooltip } from './Tooltip'

interface ConvertFooterProps {
  item: TrackItem
  isMulti: boolean
  // Size of the multi-selection, for the "Convert all (N)" label and the done counts.
  selectedCount: number
  // The footer's aggregate view of the selection (done block, reveal, Apple Music).
  status: SelectionStatus
  stale: boolean
  done: boolean
  incomplete: boolean
  // Why the convert is blocked (the empty required fields), surfaced as the button's
  // tooltip. Single-track only; undefined when nothing is missing.
  incompleteReason?: string
  willEditInPlace: boolean
  // The explicit re-encode offer, resolved by the editor: the source's mismatching
  // figures vs the pinned ones ("96.0 kHz" → "48.0 kHz"). Undefined = no offer.
  reencode?: { current: string; target: string }
  onReencode?: () => void
  addToAppleMusic: boolean
  addToEngineDj: boolean
  format: OutputFormat
  exportedFormat: OutputFormat | null
  // The format whose Apple Music eligibility gates the add button: the pick in multi
  // mode (what will be written), the exported file's in single.
  musicExt: OutputFormat | null
  normalizeCfg: NormalizeConfig
  onOpenNormalize: () => void
  onSelectFormat: (format: OutputFormat) => void
  // Pre-resolved by the editor: converts the selection in multi mode, the open track
  // in single, so the footer never forks on it.
  onProcess: (format: OutputFormat) => void
  onAddToAppleMusic?: () => void
  onTrashOriginal?: () => void
  // The library copy this track's add superseded (the old rip the fresh copy replaces),
  // resolved by the editor from the library snapshot: its persistent ID plus the raw
  // label the confirm dialog names it by. Null when there is nothing to replace.
  staleMusicCopy?: StaleLibraryCopy | null
  onRemoveOldMusicCopy?: (stale: StaleLibraryCopy) => void
  // Opens the DJ-app collection export — offered once the export landed, since the
  // collection file references the converted copies.
  onExportCollection: () => void
}

// The editor's bottom bar: the error row, the normalization note, and either the
// convert split-button or — once everything selected is done — the outcome line with
// its inline file links (reveal/re-export/trash) and the Apple-Music/DJ-app row.
export function ConvertFooter({
  item,
  isMulti,
  selectedCount,
  status,
  stale,
  done,
  incomplete,
  incompleteReason,
  willEditInPlace,
  reencode,
  onReencode,
  addToAppleMusic,
  addToEngineDj,
  format,
  exportedFormat,
  musicExt,
  normalizeCfg,
  onOpenNormalize,
  onSelectFormat,
  onProcess,
  onAddToAppleMusic,
  onTrashOriginal,
  staleMusicCopy,
  onRemoveOldMusicCopy,
  onExportCollection,
}: ConvertFooterProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const {
    showDone,
    revealPath,
    inMusicLibraryOnly,
    canDeleteOriginal,
    musicAdding,
    musicAdded,
    musicError,
  } = status
  // The Apple Music slot plays three roles for a single track that has a library
  // copy (the persistent ID a previous add stored): out of sync it offers "Update"
  // — an "Add" would import a duplicate —, in sync it becomes the reveal that jumps
  // to the copy in Music, and it no longer needs an output file or a Music-friendly
  // format, since a sync touches only the existing library entry. Multi-select
  // keeps the plain add semantics: the sweep resolves add-vs-update per track.
  const hasMusicCopy = !isMulti && !!item.musicPersistentId
  const showInMusic = hasMusicCopy && musicAdded
  return (
    <div className="border-t border-[var(--color-line)] bg-[var(--color-ink)] px-6 py-3.5">
      {item.status === 'error' && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="truncate text-xs text-danger">{item.error}</p>
          <button
            type="button"
            data-testid="report-error"
            onClick={() => openFeedback(item.error)}
            className="shrink-0 text-xs text-fg-dim underline-offset-2 hover:text-fg hover:underline"
          >
            {tr('editor.reportError')}
          </button>
        </div>
      )}
      <div className="space-y-2">
        {normalizeCfg.mode !== 'none' && (
          <button
            type="button"
            data-testid="convert-normalize-note"
            onClick={onOpenNormalize}
            className="press group relative flex w-full items-center justify-center gap-1.5 text-xs text-[var(--color-accent)] hover:underline"
          >
            <SlidersVertical className="h-3.5 w-3.5" aria-hidden="true" />
            {tr(`normalize.mode.${normalizeCfg.mode}`)} ·{' '}
            {normalizeCfg.mode === 'loudness'
              ? `${normalizeCfg.targetLufs} LUFS`
              : `${normalizeCfg.peakDb} dBFS`}
            <Tooltip label={tr('normalize.title')} />
          </button>
        )}
        {showDone ? (
          // Two lines, ordered by what matters after an export. The first is
          // about the file just written: the confirmation plus its low-stakes
          // housekeeping (reveal, trash the source) as inline links. The
          // second holds the actions as equal quiet buttons: the destinations
          // (Apple Music, DJ-app export) and the re-export split-button, whose
          // chevron re-picks the format without converting on the spot.
          <>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <p data-testid="export-success" className="text-xs font-medium text-good">
                {inMusicLibraryOnly
                  ? isMulti
                    ? tr('editor.addedToAppleMusicCount', { count: selectedCount })
                    : tr('editor.addedToAppleMusic')
                  : isMulti
                    ? tr('editor.exportedCount', { count: selectedCount })
                    : tr('editor.exportedAs', { format: (exportedFormat ?? '').toUpperCase() })}
              </p>
              {revealPath && (
                <button
                  type="button"
                  data-testid="show-file"
                  onClick={() => window.api.reveal(revealPath)}
                  className="press text-xs text-fg-dim hover:text-fg"
                >
                  {tr('editor.showFile')}
                </button>
              )}
              {canDeleteOriginal && (
                <button
                  type="button"
                  data-testid="delete-original"
                  onClick={onTrashOriginal}
                  className="press text-xs text-fg-dim hover:text-danger"
                >
                  {tr('editor.deleteOriginal')}
                </button>
              )}
              {!isMulti && musicAdded && staleMusicCopy && (
                <button
                  type="button"
                  data-testid="remove-old-copy"
                  onClick={() => onRemoveOldMusicCopy?.(staleMusicCopy)}
                  className="press text-xs text-fg-dim hover:text-danger"
                >
                  {tr('editor.removeOldCopy')}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {isMacOS() &&
                (musicExt !== 'flac' || hasMusicCopy) &&
                (!inMusicLibraryOnly || hasMusicCopy) && (
                  <button
                    type="button"
                    data-testid="add-apple-music"
                    onClick={() => {
                      if (showInMusic && item.musicPersistentId)
                        void window.api.revealAppleMusic(item.musicPersistentId)
                      else onAddToAppleMusic?.()
                    }}
                    disabled={musicAdding || (musicAdded && !showInMusic)}
                    className="press flex-1 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2 text-xs font-medium hover:bg-[var(--color-line-strong)] disabled:opacity-60 disabled:hover:bg-[var(--color-panel-2)]"
                  >
                    {musicAdding
                      ? hasMusicCopy
                        ? tr('editor.appleMusicUpdating')
                        : tr('editor.appleMusicAdding')
                      : musicAdded
                        ? showInMusic
                          ? tr('editor.appleMusicShow')
                          : tr('editor.appleMusicAdded')
                        : hasMusicCopy
                          ? tr('editor.appleMusicUpdate')
                          : tr('editor.appleMusicAdd')}
                  </button>
                )}
              <button
                type="button"
                data-testid="export-collection"
                onClick={onExportCollection}
                className="press flex-1 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2 text-xs font-medium hover:bg-[var(--color-line-strong)]"
              >
                {tr('editor.exportCollection')}
              </button>
              <ExportButton
                quiet
                status={isMulti ? 'idle' : item.status}
                stale={false}
                done={false}
                outputFormat={format}
                exportedFormat={isMulti ? null : exportedFormat}
                withAppleMusic={false}
                withEngineDj={false}
                incomplete={false}
                inPlace={false}
                count={isMulti ? selectedCount : undefined}
                onProcess={onProcess}
                onSelectFormat={onSelectFormat}
              />
            </div>
            {musicError && <p className="text-xs text-danger">{musicError}</p>}
          </>
        ) : (
          <>
            {reencode && item.status !== 'processing' && (
              <div
                data-testid="reencode-offer"
                className="mb-2 flex items-center justify-between gap-3"
              >
                <p className="text-xs text-fg-dim">
                  {tr('editor.reencodeHint', { current: reencode.current, target: reencode.target })}
                </p>
                <button
                  type="button"
                  data-testid="reencode-action"
                  onClick={onReencode}
                  className="press shrink-0 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-line-strong)]"
                >
                  {tr('editor.reencodeAction', { target: reencode.target })}
                </button>
              </div>
            )}
            <ExportButton
              status={isMulti ? 'idle' : item.status}
              stale={!isMulti && stale}
              done={!isMulti && done}
              outputFormat={format}
              exportedFormat={isMulti ? null : exportedFormat}
              withAppleMusic={isMacOS() && format !== 'flac' && addToAppleMusic}
              withEngineDj={addToEngineDj}
              incomplete={!isMulti && incomplete}
              incompleteReason={incompleteReason}
              inPlace={!isMulti && willEditInPlace}
              count={isMulti ? selectedCount : undefined}
              onProcess={onProcess}
              onSelectFormat={onSelectFormat}
            />
          </>
        )}
      </div>
    </div>
  )
}
