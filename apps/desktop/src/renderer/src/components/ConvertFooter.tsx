import { SlidersVertical } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig, OutputFormat } from '../../../shared/types'
import { openFeedback } from '../lib/feedback'
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
  willEditInPlace: boolean
  addToAppleMusic: boolean
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
}

// The editor's bottom bar: the error row, the normalization note, and either the
// convert split-button or — once everything selected is done — the outcome line with
// its quiet re-export/Apple-Music/trash actions.
export function ConvertFooter({
  item,
  isMulti,
  selectedCount,
  status,
  stale,
  done,
  incomplete,
  willEditInPlace,
  addToAppleMusic,
  format,
  exportedFormat,
  musicExt,
  normalizeCfg,
  onOpenNormalize,
  onSelectFormat,
  onProcess,
  onAddToAppleMusic,
  onTrashOriginal,
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
          // A finished export led with four equal buttons, the loudest of which
          // (re-export) is the rarest next step. Now the outcome line confirms
          // the write and a single primary "Show file" carries the likely next
          // action; re-export and Apple Music drop to a quiet row, and trashing
          // the original — destructive and rare — is a plain link at the bottom.
          <>
            <p data-testid="export-success" className="text-center text-xs font-medium text-good">
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
                className="press w-full rounded-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
              >
                {tr('editor.showFile')}
              </button>
            )}
            <div className="flex gap-2">
              {window.api.platform === 'darwin' && musicExt !== 'flac' && !inMusicLibraryOnly && (
                <button
                  type="button"
                  data-testid="add-apple-music"
                  onClick={onAddToAppleMusic}
                  disabled={musicAdding || musicAdded}
                  className="press flex-1 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2 text-xs font-medium hover:bg-[var(--color-line-strong)] disabled:opacity-60 disabled:hover:bg-[var(--color-panel-2)]"
                >
                  {musicAdding
                    ? tr('editor.appleMusicAdding')
                    : musicAdded
                      ? tr('editor.appleMusicAdded')
                      : tr('editor.appleMusicAdd')}
                </button>
              )}
              <ExportButton
                quiet
                status={isMulti ? 'idle' : item.status}
                stale={false}
                done={false}
                outputFormat={format}
                exportedFormat={isMulti ? null : exportedFormat}
                withAppleMusic={false}
                incomplete={false}
                inPlace={false}
                count={isMulti ? selectedCount : undefined}
                onProcess={onProcess}
                onSelectFormat={onSelectFormat}
              />
            </div>
            {canDeleteOriginal && (
              <button
                type="button"
                data-testid="delete-original"
                onClick={onTrashOriginal}
                className="press mx-auto block text-xs text-fg-dim hover:text-danger"
              >
                {tr('editor.deleteOriginal')}
              </button>
            )}
            {musicError && <p className="text-xs text-danger">{musicError}</p>}
          </>
        ) : (
          <ExportButton
            status={isMulti ? 'idle' : item.status}
            stale={!isMulti && stale}
            done={!isMulti && done}
            outputFormat={format}
            exportedFormat={isMulti ? null : exportedFormat}
            withAppleMusic={
              window.api.platform === 'darwin' && format !== 'flac' && addToAppleMusic
            }
            incomplete={!isMulti && incomplete}
            inPlace={!isMulti && willEditInPlace}
            count={isMulti ? selectedCount : undefined}
            onProcess={onProcess}
            onSelectFormat={onSelectFormat}
          />
        )}
      </div>
    </div>
  )
}
