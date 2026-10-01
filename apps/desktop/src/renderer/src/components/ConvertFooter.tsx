import { ArrowUpRight, SlidersVertical } from 'lucide-react'
import type React from 'react'
import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormatSetting, NormalizeConfig, OutputFormat } from '../../../shared/types'
import { type CleanupOffer, cleanupCount } from '../hooks/useConfirmFlows'
import type { StaleLibraryCopy } from '../lib/appleMusicLibrary'
import type { Destination } from '../lib/destination'
import { openFeedback } from '../lib/feedback'
import { formatUpTo } from '../lib/numberFormat'
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
  // Whether this track would supersede a copy already in the library.
  replaces?: boolean
  done: boolean
  incomplete: boolean
  // Why the convert is blocked (the empty required fields), surfaced as the button's
  // tooltip. In multi it covers the whole selection; undefined when nothing is missing.
  incompleteReason?: string
  // The same block said short enough for the main button's face (a count past two missing
  // fields), since the full reason can list every required field.
  incompleteSummary?: string
  onBlockedPress?: () => void
  willEditInPlace: boolean
  tagsOnly: boolean
  addToAppleMusic: boolean
  addToEngineDj: boolean
  // The editor's one-shot destination pick and the choices its split-button menu
  // offers, pre-filtered by the editor (platform, configured overwrite).
  destination: Destination
  destinations: readonly Destination[]
  format: FormatSetting
  exportedFormat: OutputFormat | null
  // The format whose Apple Music eligibility gates the add button: the pick in multi
  // mode (what will be written), the exported file's in single.
  musicExt: FormatSetting | null
  normalizeCfg: NormalizeConfig
  onOpenNormalize: () => void
  onSelectFormat: (format: FormatSetting) => void
  onSelectDestination: (destination: Destination) => void
  // Pre-resolved by the editor: converts the selection in multi mode, the open track
  // in single, so the footer never forks on it.
  onProcess: (format: FormatSetting) => void
  // Cancels the in-flight single conversion; the primary button turns into a cancel while
  // it runs. Undefined in multi, where the toolbar batch pill owns the cancel.
  onCancel?: () => void
  onAddToAppleMusic?: () => void
  // The library copy this track's add superseded (the old rip the fresh copy replaces),
  // resolved by the editor from the library snapshot: its persistent ID plus the raw
  // label the confirm dialog names it by. Null when there is nothing to replace.
  staleMusicCopy?: StaleLibraryCopy | null
  // The file this conversion SUPERSEDED, once the replacement finished: it left Apple
  // Music and rekordbox now follows the new file, so nothing references it any more.
  // Null when the conversion replaced nothing, or the file is already trashed.
  supersededPath?: string | null
  // One quiet link for everything the conversion left behind: the original, the
  // superseded files (one per track in multi, from selectionStatus) and the old Apple
  // Music copy. App confirms with a dialog that lists each before anything moves.
  onCleanUp?: (offer: CleanupOffer) => void
  // Opens the DJ-app collection export — offered once the export landed, since the
  // collection file references the converted copies.
  onExportCollection: () => void
}

// The editor's bottom bar: the error row, the normalization note, and either the
// convert split-button or — once everything selected is done — the outcome with its
// inline links (reveal/clean up) beside the next steps (Apple Music, DJ app, re-export).
export function ConvertFooter({
  item,
  isMulti,
  selectedCount,
  status,
  stale,
  replaces,
  done,
  incomplete,
  incompleteReason,
  incompleteSummary,
  onBlockedPress,
  willEditInPlace,
  tagsOnly,
  addToAppleMusic,
  addToEngineDj,
  destination,
  destinations,
  format,
  exportedFormat,
  musicExt,
  normalizeCfg,
  onOpenNormalize,
  onSelectFormat,
  onSelectDestination,
  onProcess,
  onCancel,
  onAddToAppleMusic,
  staleMusicCopy,
  supersededPath,
  onCleanUp,
  onExportCollection,
}: ConvertFooterProps): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
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
  const musicCopyId = item.musicPersistentId
  const revealsInMusic = isMacOS() && showInMusic && !!musicCopyId
  const revealInMusic = (): void => {
    if (musicCopyId) void window.api.revealAppleMusic(musicCopyId)
  }
  const cleanup: CleanupOffer = {
    originalPath: canDeleteOriginal ? item.inputPath : null,
    superseded: isMulti
      ? status.superseded
      : supersededPath
        ? [{ trackId: item.id, path: supersededPath }]
        : [],
    staleMusicCopy: !isMulti && musicAdded && staleMusicCopy ? staleMusicCopy : null,
  }
  const cleanupFiles = cleanupCount(cleanup)
  // The footer swaps wholesale between the convert button and the done line — the
  // one state change every conversion ends on, and it used to snap. The keyed block
  // below rises in on a real swap only: the editor remounts this footer per track,
  // and stepping through a crate must not replay an entrance on every switch. Refs
  // survive re-renders but not that remount, which is exactly the boundary wanted.
  const prevShowDone = useRef(showDone)
  const swapped = useRef(false)
  const footerRef = useRef<HTMLDivElement>(null)
  // The swap unmounts the button a keyboard user just pressed and focus drops to <body>.
  // Whether focus was in here is read before the commit replaces the block, while the old
  // button still holds it, so only focus the footer itself owned is handed back.
  const refocus = useRef(false)
  if (prevShowDone.current !== showDone) {
    swapped.current = true
    prevShowDone.current = showDone
    refocus.current = footerRef.current?.contains(document.activeElement) ?? false
  }
  useLayoutEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    footerRef.current?.querySelector<HTMLButtonElement>('[data-testid="process-btn"]')?.focus()
  })
  return (
    <div
      ref={footerRef}
      className="border-t border-[var(--color-line)] bg-[var(--color-ink)] px-6 py-3.5"
    >
      {item.status === 'error' && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <p role="alert" className="truncate text-xs text-danger">
            {item.error}
          </p>
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
      <div
        key={String(showDone)}
        data-testid="footer-state"
        className={`space-y-2${swapped.current ? ' animate-footer-swap' : ''}`}
      >
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
              ? `${formatUpTo(normalizeCfg.targetLufs, 1, i18n.language)} LUFS`
              : `${formatUpTo(normalizeCfg.peakDb, 1, i18n.language)} dBFS`}
            <Tooltip label={tr('normalize.title')} />
          </button>
        )}
        {showDone ? (
          // One line when it fits, ordered by what matters after an export. On the left, the
          // outcome: the confirmation plus its low-stakes look-and-tidy links (reveal the file
          // or the synced library copy, trash what was left behind). On the right, what can
          // still come next: a pending Apple Music add or update (the only tinted one), the
          // DJ-app export and the re-export split-button, whose chevron re-picks the format
          // without converting on the spot.
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div
                data-testid="done-outcome"
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
              >
                <p
                  data-testid="export-success"
                  role="status"
                  className="text-xs font-medium text-good"
                >
                  {revealsInMusic && inMusicLibraryOnly ? (
                    <button
                      type="button"
                      data-testid="add-apple-music"
                      onClick={revealInMusic}
                      aria-label={`${tr('editor.addedToAppleMusic')} · ${tr('editor.appleMusicShow')}`}
                      className="press inline-flex items-center gap-1 hover:underline"
                    >
                      {tr('editor.addedToAppleMusic')}
                      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ) : inMusicLibraryOnly ? (
                    isMulti ? (
                      tr('editor.addedToAppleMusicCount', { count: selectedCount })
                    ) : (
                      tr('editor.addedToAppleMusic')
                    )
                  ) : isMulti ? (
                    tr('editor.exportedCount', { count: selectedCount })
                  ) : (
                    tr('editor.exportedAs', { format: (exportedFormat ?? '').toUpperCase() })
                  )}
                </p>
                {revealsInMusic && !inMusicLibraryOnly && (
                  <button
                    type="button"
                    data-testid="add-apple-music"
                    onClick={revealInMusic}
                    className="press inline-flex items-center gap-1 text-xs text-fg-dim hover:text-fg"
                  >
                    {tr('editor.appleMusicShow')}
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
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
                {cleanupFiles > 0 && (
                  <button
                    type="button"
                    data-testid="clean-up-previous"
                    onClick={() => onCleanUp?.(cleanup)}
                    className="press text-xs text-fg-dim hover:text-danger"
                  >
                    {tr('editor.cleanUpPrevious', { count: cleanupFiles })}
                  </button>
                )}
              </div>
              <div
                data-testid="done-actions"
                className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
              >
                {isMacOS() &&
                  !showInMusic &&
                  (musicExt !== 'flac' || hasMusicCopy) &&
                  (!inMusicLibraryOnly || hasMusicCopy) && (
                    <button
                      type="button"
                      data-testid="add-apple-music"
                      onClick={onAddToAppleMusic}
                      disabled={musicAdding || musicAdded}
                      className="press min-w-0 truncate whitespace-nowrap rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-row-selected)] disabled:opacity-60 disabled:hover:bg-[var(--color-accent-soft)]"
                    >
                      {musicAdding
                        ? hasMusicCopy
                          ? tr('editor.appleMusicUpdating')
                          : tr('editor.appleMusicAdding')
                        : musicAdded
                          ? tr('editor.appleMusicAdded')
                          : hasMusicCopy
                            ? tr('editor.appleMusicUpdate')
                            : tr('editor.appleMusicAdd')}
                    </button>
                  )}
                <button
                  type="button"
                  data-testid="export-collection"
                  onClick={onExportCollection}
                  className="press min-w-0 truncate whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
                  title={tr('editor.exportCollection')}
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
                  // A field emptied (or made required) after converting would send the
                  // re-export into the same silently-empty batch the main button gates
                  // against, so the quiet variant carries the identical block.
                  incomplete={incomplete}
                  incompleteReason={incompleteReason}
                  inPlace={false}
                  destination={destination}
                  destinations={destinations}
                  count={isMulti ? selectedCount : undefined}
                  onProcess={onProcess}
                  onSelectFormat={onSelectFormat}
                  onSelectDestination={onSelectDestination}
                />
              </div>
            </div>
            {musicError && (
              <p role="alert" className="text-xs text-danger">
                {musicError}
              </p>
            )}
          </>
        ) : (
          <ExportButton
            status={isMulti ? 'idle' : item.status}
            stage={isMulti ? undefined : item.stage}
            stale={!isMulti && stale}
            replaces={!isMulti && replaces}
            done={!isMulti && done}
            outputFormat={format}
            exportedFormat={isMulti ? null : exportedFormat}
            withAppleMusic={isMacOS() && format !== 'flac' && addToAppleMusic}
            withEngineDj={addToEngineDj}
            incomplete={incomplete}
            incompleteReason={incompleteReason}
            blockedLabel={incompleteSummary}
            onBlockedPress={onBlockedPress}
            inPlace={!isMulti && willEditInPlace}
            tagsOnly={tagsOnly}
            destination={destination}
            destinations={destinations}
            count={isMulti ? selectedCount : undefined}
            onProcess={onProcess}
            onCancel={onCancel}
            onSelectFormat={onSelectFormat}
            onSelectDestination={onSelectDestination}
          />
        )}
      </div>
    </div>
  )
}
