import { Eraser, Tag } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMatchesInput } from '../../../shared/format'
import type {
  DiscogsTrack,
  KeyNotation,
  NormalizeConfig,
  OutputFormat,
  TrackMetadata,
} from '../../../shared/types'
import { useAppleMusicLookup } from '../hooks/useAppleMusicLookup'
import { useBpm } from '../hooks/useBpm'
import { useDiscogsBrowser } from '../hooks/useDiscogsBrowser'
import { useKey } from '../hooks/useKey'
import { BULK_FIELDS, commonValue } from '../lib/bulkEdit'
import { smartDeriveTags } from '../lib/deriveTags'
import { isStale } from '../lib/dirty'
import { FIELD_DEFS, missingRequired } from '../lib/fields'
import { genrePresets as discogsGenres } from '../lib/genre'
import { isLowResCover } from '../lib/quality'
import {
  bestMatch,
  buildReleaseMeta,
  confidenceTier,
  joinArtists,
  type ReleaseMetaPatch,
} from '../lib/release'
import { selectionStatus } from '../lib/selectionStatus'
import type { TrackItem } from '../types'
import { ConvertFooter } from './ConvertFooter'
import { DiscogsPanel } from './DiscogsPanel'
import { FORMATS } from './ExportButton'
import type { InsertSource } from './FieldInsertMenu'
import { type FieldSpec, MetadataForm } from './MetadataForm'
import { NormalizeSection } from './NormalizeSection'
import { OutputNameSection } from './OutputNameSection'
import { PropertiesSection } from './PropertiesSection'
import { QualitySection } from './QualitySection'
import { SectionHeader } from './SectionHeader'
import { Tooltip } from './Tooltip'

// Only free-text fields make sense as insert TARGETS — composing into structured
// values (year, BPM, key, track numbers…) would produce garbage — but every
// visible field still feeds the menu as a source.
const INSERT_TARGET_FIELDS: ReadonlySet<keyof TrackMetadata> = new Set([
  'title',
  'artist',
  'albumArtist',
  'album',
  'comment',
])

interface Props {
  item: TrackItem
  hasToken: boolean
  outputFormat: OutputFormat
  addToAppleMusic: boolean
  // When set, exports rewrite the source file in place: the File Name section is hidden
  // and the rename shortcut disabled (App enforces the latter) because the name is
  // pinned to the original.
  overwriteOriginal: boolean
  groupingPresets: string[]
  genrePresets: string[]
  visibleFields: string[]
  requiredFields: string[]
  showSpectrum: boolean
  showLoudness: boolean
  // Which notation the key suggestion chip offers (Settings choice).
  keyNotation: KeyNotation
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
  // Opens the loudness-pills explainer. App owns the modal so it gates the global
  // shortcuts like every other dialog — a track-switch key pressed while it was
  // Editor-local used to remount the editor and silently destroy the open dialog.
  onShowLoudnessHelp: () => void
  // Opens the output-name pattern builder for this track (App owns the modal so the
  // ⌘⇧R shortcut and the menu can open it too).
  onOpenRename: () => void
  // Rebuilds this track's output name from the Settings naming pattern in one click.
  // App owns the format and writes the result, so the editor just signals intent.
  onRegenerateName: () => void
}

export function Editor({
  item,
  hasToken,
  outputFormat,
  addToAppleMusic,
  overwriteOriginal,
  groupingPresets,
  genrePresets,
  visibleFields,
  requiredFields,
  showSpectrum,
  showLoudness,
  keyNotation,
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
  onShowLoudnessHelp,
  onOpenRename,
  onRegenerateName,
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

  // Tempo detected from the audio, offered as a chip under the bpm field. Detection
  // can octave-fold (70 vs 140), so it stays a suggestion the user clicks to accept,
  // never a silent write. Disabled when the field is hidden and in multi-select,
  // where there is nowhere to suggest it.
  const { data: detectedBpm } = useBpm(item.inputPath, !isMulti && visibleFields.includes('bpm'))

  // Key detected from the audio, offered like the BPM above. It is the least
  // reliable analysis Surco runs (chroma profiles can pick a relative or
  // neighbouring key), which is exactly why it is a chip and never a write.
  const { data: detectedKey } = useKey(item.inputPath, !isMulti && visibleFields.includes('key'))

  // Which tracklist entry of the open release best matches the file. Shared by the
  // Discogs panel (which highlights it as the suggestion) and the Apple Music lookup
  // below. Fuzzy, so the filename's case and punctuation don't have to match Discogs
  // exactly. Memoized on its inputs so typing in unrelated fields doesn't re-run the
  // fuzzy match over the whole tracklist on every keystroke.
  const match = useMemo(
    () =>
      release
        ? bestMatch(release.tracklist, {
            title: item.meta.title,
            durationSec: item.duration,
            trackNumber: item.meta.trackNumber,
            artist: item.meta.artist,
          })
        : undefined,
    [release, item.meta.title, item.duration, item.meta.trackNumber, item.meta.artist],
  )
  const matchTier = match ? confidenceTier(match.confidence) : undefined
  // 'low' is too weak to trust, so it points at nothing — otherwise loading an
  // unrelated release still badges whichever mix shares an incidental word.
  const matchedTrack = matchTier && matchTier !== 'low' ? match?.track : undefined

  // Hint of whether the song is already in the Apple Music library, so the user doesn't
  // re-import it. Tracks the live title/artist (debounced, macOS-only) and reports
  // 'idle' off macOS, where the badge hides. The Discogs-suggested track joins as a
  // second candidate: the tags may still hold the filename's rough spelling while the
  // library stores the song under its canonical name, which the tags alone would miss.
  const inLibrary = useAppleMusicLookup(
    matchedTrack && release
      ? [
          { artist: item.meta.artist, title: item.meta.title },
          {
            artist:
              joinArtists(matchedTrack.artists) || joinArtists(release.artists) || item.meta.artist,
            title: matchedTrack.title,
          },
        ]
      : [{ artist: item.meta.artist, title: item.meta.title }],
  )

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

  // What the per-field insert menu can offer: every visible text field of THIS
  // track. Bulk edits hold no single per-field value to insert, and compilation
  // is a '1' flag rather than text, so both stay out.
  const insertSources: InsertSource[] = isMulti
    ? []
    : FIELD_DEFS.filter((d) => visibleFields.includes(d.key) && d.key !== 'compilation').map(
        (d) => ({ key: d.key, label: tr(`fields.${d.key}`), value: item.meta[d.key] ?? '' }),
      )

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

  // Empties every metadata field — the inverse of the fill controls (filename /
  // Discogs) — so a badly-labelled file can be retagged from scratch instead of
  // deleting fifteen values by hand. Artwork is untouched: the cover picker owns
  // its own remove, and a wrong title rarely means a wrong cover.
  function clearAllMeta(): void {
    const blank: TrackMetadata = {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
      discogsReleaseId: '',
      rating: '',
      composer: '',
      isrc: '',
      mixName: '',
      originalYear: '',
      compilation: '',
    }
    if (isMulti) onChangeAllMeta?.(blank)
    else onChange({ meta: blank })
  }

  const stale = isStale(item)
  // A stale track is done but edited since, so it shows the convert button again
  // (as "Update") rather than the done/reveal state.
  const done = item.status === 'done' && !stale
  const exportedExt = item.outputPath?.split('.').pop()?.toLowerCase()
  const exportedFormat = FORMATS.find((f) => f === exportedExt) ?? null
  // The post-convert actions (reveal + Apple Music) are reused in multi-select, just fed
  // aggregate values from selectionStatus.
  const multiTracks = selectedTracks ?? []
  const footerStatus = selectionStatus(item, selectedTracks, done)
  const musicExt = isMulti ? format : exportedFormat
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
  // user before they hit the button so the rename isn't a surprise. Overwrite mode
  // forces this for every format, replacing the source whatever the target.
  const willEditInPlace = overwriteOriginal || formatMatchesInput(format, item.inputPath)
  // Overwriting a lossless master (WAV/AIFF/FLAC) with MP3 is the one irreversible,
  // quality-losing case worth a sharper warning before the user commits to it.
  const lossyOverwrite =
    overwriteOriginal && format === 'mp3' && !formatMatchesInput('mp3', item.inputPath)

  // The bulk and single forms render the same tree; only where a field's value comes
  // from and where an edit goes differ, so each mode reduces to a list of specs the
  // form maps over.
  const fieldSpecs: FieldSpec[] =
    isMulti && selectedTracks
      ? BULK_FIELDS.map((key) => {
          const shared = commonValue(selectedTracks, key)
          return {
            key,
            label: tr(`fields.${key}`),
            value: shared ?? '',
            placeholder: shared === undefined ? tr('editor.multipleValues') : undefined,
            onChange: (v: string) => onChangeAllMeta?.({ [key]: v }),
            suggestions:
              key === 'genre' ? genreChips : key === 'grouping' ? groupingPresets : undefined,
            multiSuggestions: key === 'grouping',
          }
        })
      : visibleFields.flatMap((key) => {
          const def = FIELD_DEFS.find((d) => d.key === key)
          if (!def) return []
          return [
            {
              key: def.key,
              label: tr(`fields.${def.key}`),
              value: item.meta[def.key] ?? '',
              onChange: (v: string) => setField(def.key, v),
              insertSources: INSERT_TARGET_FIELDS.has(def.key) ? insertSources : undefined,
              wide: def.wide,
              invalid: requiredFields.includes(def.key) && !item.meta[def.key]?.trim(),
              suggestions:
                def.key === 'genre'
                  ? genreChips
                  : def.key === 'grouping'
                    ? groupingPresets
                    : def.key === 'bpm' && detectedBpm
                      ? // The tag layer stores whole beats per minute, so the chip
                        // offers the rounded figure.
                        [String(Math.round(detectedBpm.bpm))]
                      : def.key === 'key' && detectedKey
                        ? [keyNotation === 'camelot' ? detectedKey.camelot : detectedKey.name]
                        : undefined,
              multiSuggestions: def.key === 'grouping',
            },
          ]
        })

  // One-click "empty every tag", next to the fill button so set-and-clear read as a
  // pair. Icon-only (like the output-name pencil) because the Apple Music badge
  // already crowds the header; the tooltip and aria-label carry the name.
  const clearButton = (
    <button
      type="button"
      data-testid="clear-meta-btn"
      aria-label={tr('editor.clearMeta')}
      onClick={clearAllMeta}
      className="press group relative flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
    >
      <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
      <Tooltip label={tr('editor.clearMetaHint')} align="end" />
    </button>
  )

  // One-click "fill tags from the file name", shown in the form header. Icon-only
  // for the same reason as the clear button beside it.
  const deriveButton = onDeriveTags ? (
    <button
      type="button"
      data-testid="derive-btn"
      aria-label={tr('editor.deriveFromName')}
      onClick={deriveFromNames}
      className="press group relative flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
    >
      <Tag className="h-3.5 w-3.5" aria-hidden="true" />
      <Tooltip label={tr('editor.deriveFromNameHint')} align="end" />
    </button>
  ) : null

  return (
    <div className="flex h-full min-h-0">
      <DiscogsPanel
        browser={browser}
        matchedTrack={matchedTrack}
        matchTier={matchTier}
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
                {/* Badge first, button last: the badge comes and goes with the lookup, so
                    keeping the button at the row's end stops it shifting when the badge
                    (un)mounts. While the lookup runs a skeleton holds the badge's slot. */}
                {!isMulti && inLibrary === 'pending' && (
                  <span
                    data-testid="apple-music-skeleton"
                    aria-hidden="true"
                    className="h-6 w-44 animate-pulse rounded-full bg-[var(--color-panel-2)]"
                  />
                )}
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
                {clearButton}
                {deriveButton}
              </div>
            }
          />
          {formOpen && (
            <MetadataForm
              item={item}
              isMulti={isMulti}
              selectedTracks={selectedTracks}
              release={release}
              coverDims={coverDims}
              setCoverDims={setCoverDims}
              onChange={onChange}
              onApplyCoverAll={onApplyCoverAll}
              onRate={(v) => setField('rating', v)}
              fields={fieldSpecs}
            />
          )}

          {!isMulti && (
            <PropertiesSection
              item={item}
              open={propertiesOpen}
              onToggle={() => setPropertiesOpen((v) => !v)}
            />
          )}

          {!isMulti && (showSpectrum || showLoudness) && (
            <QualitySection
              item={item}
              showSpectrum={showSpectrum}
              showLoudness={showLoudness}
              open={spectrumOpen}
              onToggle={() => setSpectrumOpen((v) => !v)}
              onShowLoudnessHelp={onShowLoudnessHelp}
            />
          )}

          {!isMulti && !overwriteOriginal && (
            <OutputNameSection
              item={item}
              format={format}
              defaultOutputName={defaultOutputName}
              willEditInPlace={willEditInPlace}
              open={outputOpen}
              onToggle={() => setOutputOpen((v) => !v)}
              onChangeName={(outputName) => onChange({ outputName })}
              onRegenerateName={onRegenerateName}
              onOpenRename={onOpenRename}
            />
          )}

          {/* Overwrite mode pins the name to the original, so the File Name section is
              replaced by a notice of what the export will do to the source file. */}
          {!isMulti && overwriteOriginal && (
            <div
              data-testid="overwrite-notice"
              className="mt-6 border-t border-[var(--color-line)] pt-5"
            >
              <p className="text-sm font-medium text-fg-muted">{tr('editor.overwriteTitle')}</p>
              <p
                className={`mt-2 text-xs ${lossyOverwrite ? 'text-danger' : 'text-fg-dim'}`}
                data-testid="overwrite-hint"
              >
                {lossyOverwrite ? tr('editor.overwriteLossyHint') : tr('editor.overwriteHint')}
              </p>
            </div>
          )}

          <NormalizeSection
            value={normalizeCfg}
            open={normalizeOpen}
            onToggle={() => setNormalizeOpen((v) => !v)}
            onChange={(n) => {
              setNormalizeCfg(n)
              onNormalizeChange?.(n)
            }}
          />
        </div>

        <ConvertFooter
          item={item}
          isMulti={isMulti}
          selectedCount={multiTracks.length}
          status={footerStatus}
          stale={stale}
          done={done}
          incomplete={incomplete}
          willEditInPlace={willEditInPlace}
          addToAppleMusic={addToAppleMusic}
          format={format}
          exportedFormat={exportedFormat}
          musicExt={musicExt}
          normalizeCfg={normalizeCfg}
          onOpenNormalize={() => setNormalizeOpen(true)}
          onSelectFormat={(f) => {
            setFormat(f)
            onFormatChange?.(f)
          }}
          onProcess={isMulti ? (f) => onProcessAll?.(f) : onProcess}
          onAddToAppleMusic={isMulti ? onAddAllToAppleMusic : onAddToAppleMusic}
          onTrashOriginal={onTrashOriginal}
        />
      </div>
    </div>
  )
}
