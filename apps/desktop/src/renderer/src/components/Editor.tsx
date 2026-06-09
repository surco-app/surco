import {
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  SlidersVertical,
  Star,
  Tag,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { formatMatchesInput } from '../../../shared/format'
import type {
  DiscogsTrack,
  NormalizeConfig,
  OutputFormat,
  TrackMetadata,
} from '../../../shared/types'
import { useAppleMusicLookup } from '../hooks/useAppleMusicLookup'
import { useDiscogsBrowser } from '../hooks/useDiscogsBrowser'
import { useSpectrogram } from '../hooks/useSpectrogram'
import { useTrackLoudness } from '../hooks/useTrackLoudness'
import { useTrackProperties } from '../hooks/useTrackProperties'
import { BULK_FIELDS, commonValue } from '../lib/bulkEdit'
import { csvHas, toggleCsv } from '../lib/csv'
import { smartDeriveTags } from '../lib/deriveTags'
import { isStale } from '../lib/dirty'
import { openFeedback } from '../lib/feedback'
import { FIELD_DEFS, missingRequired } from '../lib/fields'
import { genrePresets as discogsGenres } from '../lib/genre'
import { formatKHz, isLowResCover, qualityVerdict } from '../lib/quality'
import { buildReleaseMeta, type ReleaseMetaPatch } from '../lib/release'
import type { TrackItem } from '../types'
import { CoverPicker } from './CoverPicker'
import { DiscogsPanel } from './DiscogsPanel'
import { LoudnessHelpModal } from './LoudnessHelpModal'
import { LoudnessReadout } from './LoudnessReadout'
import { NormalizeControls } from './NormalizeControls'
import { PropertiesReadout } from './PropertiesReadout'
import { Spectrogram } from './Spectrogram'
import { Tooltip } from './Tooltip'
import { WaveSpinner } from './WaveSpinner'

const FORMATS: OutputFormat[] = ['aiff', 'mp3', 'wav', 'flac']

interface Props {
  item: TrackItem
  hasToken: boolean
  outputFormat: OutputFormat
  addToAppleMusic: boolean
  groupingPresets: string[]
  genrePresets: string[]
  visibleFields: string[]
  requiredFields: string[]
  showSpectrum: boolean
  showLoudness: boolean
  // The Settings normalization default, seeding the per-track override control.
  normalize: NormalizeConfig
  searchInputRef: React.RefObject<HTMLInputElement | null>
  // The whole multi-selection, when more than one track is picked. Its presence flips the
  // Discogs column to album-match mode (map every file to a tracklist entry at once) and
  // the convert action to "convert all"; the right-hand editor still shows `item`, the
  // primary track. Undefined/length<=1 means the ordinary single-track editor.
  selectedTracks?: TrackItem[]
  onApplyMatches?: (patches: { id: string; patch: ReleaseMetaPatch }[]) => void
  onProcessAll?: (format: OutputFormat) => void
  onAddAllToAppleMusic?: () => void
  // Multi-select writes: a field edited in the shared form goes to every selected track,
  // and a dropped/picked cover is stamped onto all of them.
  onChangeAllMeta?: (patch: Partial<TrackMetadata>) => void
  onApplyCoverAll?: (coverUrl: string, coverPath: string) => void
  // Fills each track's tags from its own file name; applies to the primary in single view
  // and to the whole selection in multi.
  onDeriveTags?: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  onChange: (patch: Partial<TrackItem>) => void
  onProcess: (format: OutputFormat) => void
  // Reports the format chosen in the split-button menu so the keyboard convert
  // shortcuts (⌘⏎ / ⌘⇧⏎) export in it too, instead of the Settings default.
  onFormatChange?: (format: OutputFormat) => void
  // Reports the per-track normalization override so the keyboard convert shortcuts
  // and "convert all" apply it too, mirroring onFormatChange.
  onNormalizeChange?: (normalize: NormalizeConfig) => void
  onAddToAppleMusic: () => void
  // Trashes the source file after a real conversion; the converted output and the
  // track's row stay. Confirmation lives in App, so the button just signals intent.
  onTrashOriginal?: () => void
  onOpenSettings: (tab?: 'general' | 'naming') => void
  // Opens the output-name pattern builder for this track (App owns the modal so the
  // ⌘⇧R shortcut and the menu can open it too).
  onOpenRename: () => void
}

export function Editor({
  item,
  hasToken,
  outputFormat,
  addToAppleMusic,
  groupingPresets,
  genrePresets,
  visibleFields,
  requiredFields,
  showSpectrum,
  showLoudness,
  normalize,
  searchInputRef,
  selectedTracks,
  onApplyMatches,
  onProcessAll,
  onAddAllToAppleMusic,
  onChangeAllMeta,
  onApplyCoverAll,
  onDeriveTags,
  onChange,
  onProcess,
  onFormatChange,
  onNormalizeChange,
  onAddToAppleMusic,
  onTrashOriginal,
  onOpenSettings,
  onOpenRename,
}: Props): React.JSX.Element {
  const isMulti = (selectedTracks?.length ?? 0) > 1
  const { t: tr } = useTranslation()
  const browser = useDiscogsBrowser(item, tr)
  const { release } = browser
  const [formOpen, setFormOpen] = useState(true)
  // Read-only facts, folded by default so they don't push the editing fields down;
  // the user opens them when they want to inspect the source.
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [spectrumOpen, setSpectrumOpen] = useState(true)
  // The loudness help is hidden by default and toggled by the ⓘ button: the
  // figures need explaining once, but shouldn't clutter the panel on every edit.
  const [loudnessHelpOpen, setLoudnessHelpOpen] = useState(false)
  const [outputOpen, setOutputOpen] = useState(true)
  // Normalization is off by default and most users won't touch it, so its section
  // starts folded — unlike the always-on Metadata/Quality/File name sections.
  const [normalizeOpen, setNormalizeOpen] = useState(false)
  // The chosen export format, seeded from the Settings default. The format menu
  // only updates this; conversion waits for a deliberate click on the main button.
  // The Editor remounts per track (key={track.id}), so each track starts from the
  // default rather than inheriting the last track's pick.
  const [format, setFormat] = useState(outputFormat)
  // Per-track normalization, seeded from the Settings default. Editing it both
  // updates the control and reports the override up so convert uses it.
  const [normalizeCfg, setNormalizeCfg] = useState(normalize)
  // Natural pixel size of the shown artwork, read on load, so the user can tell
  // whether the Discogs cover is sharp enough or worth replacing. Null until loaded
  // and reset whenever the cover changes.
  const [coverDims, setCoverDims] = useState<{ w: number; h: number } | null>(null)

  // Spectrogram (and the lossless-cutoff verdict it implies) for the shown track. The
  // hover prefetch and the "analyze all" sweep warm the same cache keys, so an
  // already-warmed track shows instantly. Gated on the Quality toggle; a failed
  // analysis surfaces as analyzeError.
  const spectrumQuery = useSpectrogram(item.inputPath, showSpectrum)
  const spectrum = spectrumQuery.data
  const analyzing = spectrumQuery.isFetching
  const analyzeError = spectrumQuery.isError
    ? spectrumQuery.error instanceof Error
      ? spectrumQuery.error.message
      : tr('editor.analyzeError')
    : ''

  // EBU R128 loudness for the shown track. Keyed by input path, so it measures once
  // per file and reads the right figures on a track switch; gated on the Settings
  // toggle. A failed measure resolves null and the readout hides.
  const { data: loudness } = useTrackLoudness(item.inputPath, showLoudness)

  // Read-only technical facts for the shown track. Keyed by input path, so it probes
  // once per file and reads the right facts on a track switch; disabled in multi-select,
  // where the panel is hidden and there is no single source to inspect. A failed probe
  // surfaces as propertiesError, which the panel renders as "unavailable".
  const { data: properties, isError: propertiesError } = useTrackProperties(
    item.inputPath,
    !isMulti,
  )

  // Hint of whether the song is already in the Apple Music library, so the user doesn't
  // re-import it. Tracks the live title/artist (debounced, macOS-only) and reports
  // 'idle' off macOS, where the badge hides.
  const inLibrary = useAppleMusicLookup(item.meta.artist, item.meta.title)

  function selectTrack(track: DiscogsTrack): void {
    if (!release) return
    // Keep the file's own cover unless it's missing or measured as low-res, in which
    // case the release fills it. Keeping is the safe default — when the size hasn't
    // been measured yet (coverDims null) a present cover is left untouched rather
    // than overwritten with the release's often-smaller image.
    onChange(
      buildReleaseMeta(item.meta, release, track, {
        url: item.coverUrl,
        path: item.coverPath,
        keep: !!item.coverUrl && !(coverDims && isLowResCover(coverDims.w, coverDims.h)),
      }),
    )
  }

  function setField(key: keyof TrackItem['meta'], value: string): void {
    onChange({ meta: { ...item.meta, [key]: value } })
  }

  // Fills tags from each file's own name (auto-detecting the common rip naming): the primary
  // track in single view, every selected track in multi. Merges, so only matched fields change.
  function deriveFromNames(): void {
    if (!onDeriveTags) return
    const targets = isMulti ? (selectedTracks ?? []) : [item]
    const patches = targets
      .map((f) => ({ id: f.id, meta: smartDeriveTags(f.fileName) }))
      .filter((p) => Object.keys(p.meta).length > 0)
    if (patches.length) onDeriveTags(patches)
  }

  const stale = isStale(item)
  // A stale track is done but edited since, so it shows the convert button again
  // (as "Update") rather than the done/reveal state.
  const done = item.status === 'done' && !stale
  const exportedExt = item.outputPath?.split('.').pop()?.toLowerCase()
  const exportedFormat = FORMATS.find((f) => f === exportedExt) ?? null
  // The post-convert actions (reveal + Apple Music) are reused in multi-select, just fed
  // aggregate values: the block shows once every selected track is converted, reveal
  // opens the first output, and the Apple Music button reflects the whole selection.
  const multiTracks = selectedTracks ?? []
  const showDone = isMulti
    ? multiTracks.length > 0 && multiTracks.every((t) => t.status === 'done')
    : done
  const revealPath = isMulti ? multiTracks.find((t) => t.outputPath)?.outputPath : item.outputPath
  // A real conversion writes a separate file and leaves the source at its own path;
  // an in-place export rewrites the source, so inputPath === outputPath and there is
  // nothing distinct to trash. Single-track only, and gone once the original is trashed.
  const canDeleteOriginal =
    !isMulti && !!item.outputPath && item.outputPath !== item.inputPath && !item.originalTrashed
  const musicExt = isMulti ? format : exportedFormat
  const musicAdding = isMulti
    ? multiTracks.some((t) => t.musicStatus === 'adding')
    : item.musicStatus === 'adding'
  const musicAdded = isMulti
    ? multiTracks.length > 0 && multiTracks.every((t) => t.musicStatus === 'added')
    : item.musicStatus === 'added'
  const musicError = isMulti
    ? multiTracks.find((t) => t.musicStatus === 'error')?.musicError
    : item.musicError
  // Required fields are flagged the moment they are empty, not only after a failed
  // convert: with the button disabled below, the click that produced the error is
  // no longer reachable, so the red field is what tells the user why.
  const incomplete = missingRequired(item.meta, requiredFields).length > 0
  // The user's default genres come first so they're always one click away even
  // when a release isn't on Discogs; the release's own genres/styles follow,
  // deduped so a shared name shows a single pill.
  const genreChips = useMemo(
    () => Array.from(new Set([...genrePresets, ...discogsGenres(release)])),
    [genrePresets, release],
  )
  // Default to the file's own name so converting keeps it; the metadata-derived
  // name is opt-in via the "Regenerate from metadata" button below.
  const defaultOutputName = item.fileName
  // Exporting to the source's own format edits the original file in place (and
  // renames it on disk) rather than writing a copy to the output folder — warn the
  // user before they hit the button so the rename isn't a surprise.
  const willEditInPlace = formatMatchesInput(format, item.inputPath)

  // One-click "fill tags from the file name", shown in the File Name section (single) and
  // the form header (multi, where File Name is hidden).
  const deriveButton = onDeriveTags ? (
    <button
      type="button"
      data-testid="derive-btn"
      onClick={deriveFromNames}
      className="press group relative flex items-center gap-1.5 rounded-md text-xs text-fg-dim hover:text-fg"
    >
      <Tag className="h-3 w-3" aria-hidden="true" />
      {tr('editor.deriveFromName')}
      <Tooltip label={tr('editor.deriveFromNameHint')} align="start" />
    </button>
  ) : null

  return (
    <div className="flex h-full min-h-0">
      <DiscogsPanel
        browser={browser}
        item={item}
        hasToken={hasToken}
        isMulti={isMulti}
        selectedTracks={selectedTracks}
        onApplyMatches={onApplyMatches}
        selectTrack={selectTrack}
        searchInputRef={searchInputRef}
        onOpenSettings={onOpenSettings}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <SectionHeader
            title={
              isMulti
                ? tr('editor.editingMultiple', { count: selectedTracks?.length ?? 0 })
                : tr('editor.sectionForm')
            }
            open={formOpen}
            onToggle={() => setFormOpen((v) => !v)}
            right={
              <div className="flex items-center gap-3">
                {deriveButton}
                {!isMulti && inLibrary === 'yes' && (
                  <span
                    data-testid="apple-music-status"
                    className="rounded-full bg-warn/15 px-2.5 py-1 text-xs font-medium text-warn"
                  >
                    {tr('editor.inLibrary')}
                  </span>
                )}
                {!isMulti && inLibrary === 'no' && (
                  <span
                    data-testid="apple-music-status"
                    className="rounded-full bg-good/15 px-2.5 py-1 text-xs font-medium text-good"
                  >
                    {tr('editor.notInLibrary')}
                  </span>
                )}
              </div>
            }
          />
          {formOpen && (
            <div className="mt-4 @container">
              {!isMulti && (
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-xs font-medium text-fg-dim">{tr('fields.rating')}</span>
                  <StarRating
                    value={item.meta.rating ?? ''}
                    onChange={(v) => setField('rating', v)}
                  />
                </div>
              )}
              <div className="flex flex-col gap-5 @[26rem]:flex-row @[26rem]:gap-6">
                <CoverPicker
                  item={item}
                  isMulti={isMulti}
                  selectedTracks={selectedTracks}
                  release={release}
                  coverDims={coverDims}
                  setCoverDims={setCoverDims}
                  onChange={onChange}
                  onApplyCoverAll={onApplyCoverAll}
                />

                <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-3 @[26rem]:grid-cols-2">
                  {isMulti && selectedTracks
                    ? BULK_FIELDS.map((key) => {
                        const shared = commonValue(selectedTracks, key)
                        return (
                          <Field
                            key={key}
                            name={key}
                            label={tr(`fields.${key}`)}
                            value={shared ?? ''}
                            placeholder={
                              shared === undefined ? tr('editor.multipleValues') : undefined
                            }
                            onChange={(v) => onChangeAllMeta?.({ [key]: v })}
                            suggestions={
                              key === 'genre'
                                ? genreChips
                                : key === 'grouping'
                                  ? groupingPresets
                                  : undefined
                            }
                            multiSuggestions={key === 'grouping'}
                          />
                        )
                      })
                    : visibleFields.map((key) => {
                        const def = FIELD_DEFS.find((d) => d.key === key)
                        if (!def) return null
                        return (
                          <Field
                            key={def.key}
                            name={def.key}
                            label={tr(`fields.${def.key}`)}
                            value={item.meta[def.key] ?? ''}
                            onChange={(v) => setField(def.key, v)}
                            wide={def.wide}
                            invalid={
                              requiredFields.includes(def.key) && !item.meta[def.key]?.trim()
                            }
                            suggestions={
                              def.key === 'genre'
                                ? genreChips
                                : def.key === 'grouping'
                                  ? groupingPresets
                                  : undefined
                            }
                            multiSuggestions={def.key === 'grouping'}
                          />
                        )
                      })}
                </div>
              </div>
            </div>
          )}

          {!isMulti && (
            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <SectionHeader
                title={tr('editor.propertiesTitle')}
                open={propertiesOpen}
                onToggle={() => setPropertiesOpen((v) => !v)}
              />
              {propertiesOpen &&
                (properties ? (
                  <PropertiesReadout
                    properties={properties}
                    fileName={item.fileName}
                    inputPath={item.inputPath}
                    duration={item.duration}
                  />
                ) : (
                  (properties === null || propertiesError) && (
                    <p className="mt-3 text-xs text-fg-dim">{tr('editor.propertiesUnavailable')}</p>
                  )
                ))}
            </div>
          )}

          {!isMulti && (showSpectrum || showLoudness) && (
            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <SectionHeader
                title={tr('editor.qualityTitle')}
                open={spectrumOpen}
                onToggle={() => setSpectrumOpen((v) => !v)}
                right={
                  spectrum &&
                  spectrum.cutoffHz !== null &&
                  (qualityVerdict(spectrum.cutoffHz, spectrum.sampleRateHz) === 'good' ? (
                    <span
                      data-testid="quality-badge"
                      className="rounded-full bg-good/15 px-2.5 py-1 text-xs font-medium text-good"
                    >
                      {tr('editor.qualityGood')}
                    </span>
                  ) : (
                    <span
                      data-testid="quality-badge"
                      className="rounded-full bg-warn/15 px-2.5 py-1 text-xs font-medium text-warn"
                    >
                      {tr('editor.qualitySuspect')}
                    </span>
                  ))
                }
              />
              {spectrumOpen && (
                <div className="mt-3">
                  {showSpectrum &&
                    (analyzing ? (
                      <div className="flex h-28 items-center justify-center gap-3 text-xs text-fg-dim">
                        <WaveSpinner />
                        {tr('editor.analyzing')}
                      </div>
                    ) : analyzeError ? (
                      <p className="text-xs text-danger">{analyzeError}</p>
                    ) : spectrum ? (
                      <>
                        <Spectrogram spectrum={spectrum} />
                        {spectrum.cutoffHz !== null && (
                          <p className="mt-2 text-xs text-fg-dim">
                            {tr('editor.qualityCaption', {
                              cutoff: formatKHz(spectrum.cutoffHz),
                              nyquist: formatKHz(spectrum.sampleRateHz / 2),
                            })}
                          </p>
                        )}
                      </>
                    ) : null)}
                  {showLoudness && loudness && (
                    <LoudnessReadout
                      loudness={loudness}
                      onShowHelp={() => setLoudnessHelpOpen(true)}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {loudnessHelpOpen && <LoudnessHelpModal onClose={() => setLoudnessHelpOpen(false)} />}

          {!isMulti && (
            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <SectionHeader
                title={tr('editor.outputName')}
                open={outputOpen}
                onToggle={() => setOutputOpen((v) => !v)}
                right={
                  <button
                    type="button"
                    data-testid="regenerate-output-name"
                    onClick={onOpenRename}
                    className="press group relative flex items-center gap-1.5 rounded-md text-xs text-fg-dim hover:text-fg"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    {tr('editor.regenerate')}
                    <Tooltip label={tr('editor.regenerateHint')} align="end" />
                  </button>
                }
              />
              {outputOpen && (
                <label className="relative mt-3 block">
                  <input
                    data-testid="output-name"
                    value={item.outputName ?? defaultOutputName}
                    onChange={(e) => onChange({ outputName: e.target.value })}
                    className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-2 pr-14 pl-3 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-fg-dim">
                    .{format}
                  </span>
                </label>
              )}
              {outputOpen && (
                <p className="mt-2 text-xs text-fg-dim" data-testid="output-name-hint">
                  {willEditInPlace ? (
                    tr('editor.outputNameHintInPlace')
                  ) : (
                    <Trans
                      i18nKey="editor.outputNameHint"
                      components={[
                        <button
                          key="settings"
                          type="button"
                          data-testid="output-name-hint-settings"
                          onClick={() => onOpenSettings('naming')}
                          className="underline underline-offset-2 hover:no-underline"
                        />,
                      ]}
                    />
                  )}
                </p>
              )}
            </div>
          )}

          <div
            data-testid="editor-normalize"
            className="mt-6 border-t border-[var(--color-line)] pt-5"
          >
            <SectionHeader
              title={tr('normalize.title')}
              open={normalizeOpen}
              onToggle={() => setNormalizeOpen((v) => !v)}
              right={
                normalizeCfg.mode !== 'none' ? (
                  <span
                    data-testid="normalize-active-badge"
                    className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
                  >
                    {tr(`normalize.mode.${normalizeCfg.mode}`)}
                  </span>
                ) : undefined
              }
            />
            {normalizeOpen && (
              <div className="mt-3">
                <p className="mb-3 text-xs text-fg-dim">{tr('normalize.hint')}</p>
                <NormalizeControls
                  value={normalizeCfg}
                  onChange={(n) => {
                    setNormalizeCfg(n)
                    onNormalizeChange?.(n)
                  }}
                />
              </div>
            )}
          </div>
        </div>

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
                onClick={() => setNormalizeOpen(true)}
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
                <p
                  data-testid="export-success"
                  className="text-center text-xs font-medium text-good"
                >
                  {isMulti
                    ? tr('editor.exportedCount', { count: multiTracks.length })
                    : tr('editor.exportedAs', { format: (exportedFormat ?? '').toUpperCase() })}
                </p>
                <button
                  type="button"
                  data-testid="show-file"
                  onClick={() => revealPath && window.api.reveal(revealPath)}
                  className="press w-full rounded-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
                >
                  {tr('editor.showFile')}
                </button>
                <div className="flex gap-2">
                  {window.api.platform === 'darwin' && musicExt !== 'flac' && (
                    <button
                      type="button"
                      data-testid="add-apple-music"
                      onClick={isMulti ? onAddAllToAppleMusic : onAddToAppleMusic}
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
                    count={isMulti ? (selectedTracks?.length ?? 0) : undefined}
                    onProcess={isMulti ? (f) => onProcessAll?.(f) : onProcess}
                    onSelectFormat={(f) => {
                      setFormat(f)
                      onFormatChange?.(f)
                    }}
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
                count={isMulti ? (selectedTracks?.length ?? 0) : undefined}
                onProcess={isMulti ? (f) => onProcessAll?.(f) : onProcess}
                onSelectFormat={(f) => {
                  setFormat(f)
                  onFormatChange?.(f)
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ExportButtonProps {
  status: TrackItem['status']
  stale: boolean
  done: boolean
  outputFormat: OutputFormat
  exportedFormat: OutputFormat | null
  withAppleMusic: boolean
  incomplete: boolean
  // True when the chosen format is the source's own: the export edits the original in
  // place and renames it rather than writing a converted copy, so the button offers to
  // "Update" instead of promising a conversion.
  inPlace: boolean
  // When set, the button converts the whole selection in the chosen format and labels
  // itself "Convert all (N)" instead of the single-track convert; the format menu works
  // the same, it just applies to every selected track.
  count?: number
  // The demoted variant shown after a successful export: a bordered, muted control
  // that sits in the secondary row labelled "Re-export", rather than the prominent
  // accent button used to convert.
  quiet?: boolean
  onProcess: (format: OutputFormat) => void
  onSelectFormat: (format: OutputFormat) => void
}

// A split button: the body exports in the currently chosen format (seeded from
// Settings), the chevron opens a menu to switch which format that is. Picking a
// format only relabels the button — it never converts on the spot, so a misclick
// can't write a file; the deliberate click on the body is what exports. The control
// stays visible after a track is done so re-exporting to another format never
// means reloading the file or touching Settings.
function ExportButton({
  status,
  stale,
  done,
  outputFormat,
  exportedFormat,
  withAppleMusic,
  incomplete,
  inPlace,
  count,
  quiet,
  onProcess,
  onSelectFormat,
}: ExportButtonProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const processing = status === 'processing'
  // A track missing required tags cannot be converted, so the gate covers the
  // main action and the format menu alike.
  const blocked = processing || incomplete

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const label = processing
    ? tr('editor.processing')
    : quiet
      ? tr('editor.reexport')
      : count !== undefined
        ? tr(withAppleMusic ? 'editor.convertAllMusic' : 'editor.convertAll', {
            count,
            format: outputFormat.toUpperCase(),
          })
        : inPlace
          ? tr(withAppleMusic ? 'editor.updateMusic' : 'editor.update')
          : stale
            ? tr('editor.update')
            : done
              ? tr('editor.exportAgain')
              : tr(withAppleMusic ? 'editor.convert' : 'editor.convertNoMusic', {
                  format: outputFormat.toUpperCase(),
                })

  function pick(format: OutputFormat): void {
    setOpen(false)
    onSelectFormat(format)
  }

  return (
    <div ref={ref} className={`relative flex ${quiet ? 'flex-1' : ''}`}>
      <button
        type="button"
        data-testid="process-btn"
        onClick={() => onProcess(outputFormat)}
        disabled={blocked}
        className={
          quiet
            ? 'press flex-1 rounded-l-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2 text-xs font-medium hover:bg-[var(--color-line-strong)] disabled:opacity-50'
            : 'press flex-1 rounded-l-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'
        }
      >
        {label}
      </button>
      <button
        type="button"
        data-testid="process-format-toggle"
        aria-label={tr('editor.chooseFormat')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={blocked}
        className={
          quiet
            ? 'press flex w-9 items-center justify-center rounded-r-lg border border-l-0 border-[var(--color-line-strong)] bg-[var(--color-panel-2)] hover:bg-[var(--color-line-strong)] disabled:opacity-50'
            : 'press flex w-10 items-center justify-center rounded-r-lg border-l border-white/20 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'
        }
      >
        <ChevronDown
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-56 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-lg">
          {FORMATS.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`process-format-${id}`}
              aria-current={id === outputFormat ? 'true' : undefined}
              onClick={() => pick(id)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-panel)] ${
                id === outputFormat ? 'font-medium text-[var(--color-accent)]' : ''
              }`}
            >
              {tr(`settings.formats.${id}`)}
              {id === exportedFormat && (
                <Check className="h-3.5 w-3.5 text-good" strokeWidth={2.5} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface SectionHeaderProps {
  title: string
  open: boolean
  onToggle: () => void
  right?: React.ReactNode
}

function SectionHeader({ title, open, onToggle, right }: SectionHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-dim hover:text-fg-muted"
      >
        <ChevronRight
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {title}
      </button>
      {right}
    </div>
  )
}

// A 0–5 star picker. Clicking a star sets that many; clicking the highest filled
// star again clears the rating (back to none). Value is the "1"–"5"/"" string the
// rest of the app stores; the write path turns it into the Traktor POPM byte.
function StarRating({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const stars = Number(value) || 0
  return (
    <span data-testid="star-rating" className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= stars
        return (
          <button
            key={n}
            type="button"
            data-testid={`star-${n}`}
            aria-pressed={filled}
            aria-label={tr('editor.ratingStars', { count: n })}
            onClick={() => onChange(n === stars ? '' : String(n))}
            className={`press ${filled ? 'text-warn' : 'text-fg-faint hover:text-fg-dim'}`}
          >
            <Star
              className="h-4 w-4"
              fill={filled ? 'currentColor' : 'none'}
              strokeWidth={1.6}
              aria-hidden="true"
            />
          </button>
        )
      })}
    </span>
  )
}

interface FieldProps {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  wide?: boolean
  invalid?: boolean
  placeholder?: string
  suggestions?: string[]
  multiSuggestions?: boolean
}

function Field({
  name,
  label,
  value,
  onChange,
  wide,
  invalid,
  placeholder,
  suggestions,
  multiSuggestions,
}: FieldProps): React.JSX.Element {
  return (
    <label className={`block ${wide ? 'col-span-1 @[26rem]:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-fg-dim">{label}</span>
      <input
        data-testid={`field-${name}`}
        aria-invalid={invalid}
        title={value}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border bg-[var(--color-field)] px-3 py-2 text-sm outline-none ${
          invalid
            ? 'border-danger focus:border-danger'
            : 'border-[var(--color-line)] focus:border-[var(--color-accent)]'
        }`}
      />
      {suggestions && suggestions.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => {
            const on = multiSuggestions ? csvHas(value, s) : value === s
            return (
              <button
                key={s}
                type="button"
                data-testid={`chip-${s}`}
                onClick={() => onChange(multiSuggestions ? toggleCsv(value, s) : on ? '' : s)}
                className={`press rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  on
                    ? 'border-transparent bg-[var(--color-accent)] text-white'
                    : 'border-[var(--color-line-strong)] text-fg-muted hover:bg-[var(--color-panel-2)]'
                }`}
              >
                {s}
              </button>
            )
          })}
        </span>
      )}
    </label>
  )
}
