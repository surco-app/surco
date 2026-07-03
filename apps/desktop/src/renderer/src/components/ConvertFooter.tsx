import { Check, ChevronDown, SlidersVertical } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig, OutputFormat } from '../../../shared/types'
import { openFeedback } from '../lib/feedback'
import { isMacOS } from '../lib/platform'
import type { SelectionStatus } from '../lib/selectionStatus'
import type { TrackItem } from '../types'
import { ExportButton, FORMATS } from './ExportButton'
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
  // Opens the DJ-app collection export — offered once the export landed, since the
  // collection file references the converted copies.
  onExportCollection: () => void
}

// The editor's bottom bar: the error row, the normalization note, and either the
// convert split-button or — once everything selected is done — the outcome line with
// its quiet Apple-Music/DJ-app row and the demoted re-export/trash links.
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
  const [reexportOpen, setReexportOpen] = useState(false)
  const reexportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!reexportOpen) return
    const onDown = (e: MouseEvent): void => {
      if (reexportRef.current && !reexportRef.current.contains(e.target as Node))
        setReexportOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [reexportOpen])
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
          // The done state mirrors how often each next step happens: "Show file"
          // is the one thing most users want, so it keeps the only loud button;
          // Apple Music and the DJ-app export share one quiet row; re-export —
          // the rarest action — and the destructive trash demote to plain links.
          // Re-export is a menu that converts on pick: both clicks are
          // deliberate, so the two-step can't write a file by accident.
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
            </div>
            <div className="flex items-center justify-center gap-4">
              <div ref={reexportRef} className="relative">
                <button
                  type="button"
                  data-testid="reexport"
                  aria-expanded={reexportOpen}
                  onClick={() => setReexportOpen((v) => !v)}
                  className="press flex items-center gap-1 text-xs text-fg-dim hover:text-fg"
                >
                  {tr('editor.reexport')}
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-3 w-3 transition-transform ${reexportOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {reexportOpen && (
                  <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-lg">
                    {FORMATS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        data-testid={`reexport-format-${id}`}
                        aria-current={id === format ? 'true' : undefined}
                        onClick={() => {
                          setReexportOpen(false)
                          onSelectFormat(id)
                          onProcess(id)
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-panel)] ${
                          id === format ? 'font-medium text-[var(--color-accent)]' : ''
                        }`}
                      >
                        {tr(`settings.formats.${id}`)}
                        {id === exportedFormat && !isMulti && (
                          <Check
                            className="h-3.5 w-3.5 text-good"
                            strokeWidth={2.5}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
            </div>
            {musicError && <p className="text-xs text-danger">{musicError}</p>}
          </>
        ) : (
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
        )}
      </div>
    </div>
  )
}
