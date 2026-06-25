import { Copy, Disc3, Eraser, Tag } from 'lucide-react'
import type React from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMatchesInput } from '../../../shared/format'
import { emptyMetadata } from '../../../shared/metadata'
import type {
  KeyNotation,
  NormalizeConfig,
  OutputFormat,
  ReleaseTrack,
  SearchProviderId,
  TrackMetadata,
} from '../../../shared/types'
import { useBpm } from '../hooks/useBpm'
import { useDiscogsBrowser } from '../hooks/useDiscogsBrowser'
import { useEditorSections } from '../hooks/useEditorSections'
import { useKey } from '../hooks/useKey'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { type AppleMusicIndex, isInLibrary } from '../lib/appleMusicLibrary'
import { matchTargetOf } from '../lib/autoMatch'
import { smartDeriveTags } from '../lib/deriveTags'
import { isStale } from '../lib/dirty'
import { buildFieldSpecs } from '../lib/fieldSpecs'
import { FIELD_DEFS, missingRequired } from '../lib/fields'
import { genreChips as buildGenreChips } from '../lib/genre'
import { renderOutputName } from '../lib/outputName'
import { isMacOS } from '../lib/platform'
import { isLowResCover } from '../lib/quality'
import {
  bestMatch,
  buildReleaseMeta,
  confidenceTier,
  joinArtists,
  type ReleaseMetaPatch,
} from '../lib/release'
import { selectionStatus } from '../lib/selectionStatus'
import { stripParentheticals } from '../lib/textClean'
import type { TrackItem } from '../types'
import { ConvertFooter } from './ConvertFooter'
import { DiscogsPanel } from './DiscogsPanel'
import { FORMATS } from './ExportButton'
import type { InsertSource } from './FieldInsertMenu'
import { MetadataForm } from './MetadataForm'
import { NormalizeSection } from './NormalizeSection'
import { OutputNameSection } from './OutputNameSection'
import { PropertiesSection } from './PropertiesSection'
import { QualitySection } from './QualitySection'
import { SectionHeader } from './SectionHeader'
import { Tooltip } from './Tooltip'

interface Props {
  item: TrackItem
  // The session snapshot of the Apple Music library (null until it lands / off macOS),
  // the same one the list and quality filter read, so the "already owned" badge can never
  // disagree with them. App owns it; the editor only reads.
  libraryIndex: AppleMusicIndex | null
  hasToken: boolean
  outputFormat: OutputFormat
  addToAppleMusic: boolean
  // When set, exports rewrite the source file in place: the File Name section is hidden
  // and the rename shortcut disabled (App enforces the latter) because the name is
  // pinned to the original.
  overwriteOriginal: boolean
  // Settings → Artwork: when on, applying a release replaces an existing low-res cover
  // with the release image; off keeps the file's own cover regardless of size.
  replaceLowResCover: boolean
  // Settings → Naming: when on, the output name is derived from filenameFormat as the
  // default (instead of the source file name) and the "Regenerate" button is hidden.
  autoApplyFilename: boolean
  filenameFormat: string
  groupingPresets: string[]
  genrePresets: string[]
  visibleFields: string[]
  requiredFields: string[]
  // The Discogs release formats search is restricted to (Settings), shown as a hint in
  // the Discogs column so an empty or thinned result set is explained, not a mystery.
  discogsFormats: string[]
  // How many search results to show (Settings → Search).
  discogsMaxResults: number
  // The catalog sources the editor search queries (Settings → Search).
  searchProviders: SearchProviderId[]
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
  onApplyCoverAll?: (coverUrl: string, coverPath?: string) => void
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
  onOpenSettings: (tab?: 'general' | 'search' | 'naming') => void
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
  // Copies the Settings-pattern file name to the clipboard so the user can paste the track
  // into a search box. App owns the pattern and clipboard, so the editor just signals intent.
  onCopyFilename: () => void
}

// Memoized: App keeps every prop identity-stable (useStableCallback handlers, kept
// selectedTracks identity), so search keystrokes and progress ticks on other tracks
// skip this whole subtree.
export const Editor = memo(function Editor({
  item,
  libraryIndex,
  hasToken,
  outputFormat,
  addToAppleMusic,
  overwriteOriginal,
  replaceLowResCover,
  autoApplyFilename,
  filenameFormat,
  groupingPresets,
  genrePresets,
  visibleFields,
  requiredFields,
  discogsFormats,
  discogsMaxResults,
  searchProviders,
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
  onCopyFilename,
}: Props): React.JSX.Element {
  const isMulti = (selectedTracks?.length ?? 0) > 1
  const { t: tr } = useTranslation()
  // A refined search is persisted on the track, so flipping away and back re-seeds
  // the box (and its cached results) instead of reverting to the filename guess.
  const browser = useDiscogsBrowser(
    item,
    tr,
    (query) => onChange({ query }),
    searchProviders,
    discogsMaxResults,
  )
  const { release, resolving: discogsResolving } = browser
  // Section fold state lives in a module-level store (not per-track useState), so folding
  // a section away persists as the user browses the crate instead of resetting on every
  // track switch — and the gated analyses below stay quiet until the section is reopened.
  const { open: sectionOpen, setOpen: setSectionOpen } = useEditorSections()
  const formOpen = sectionOpen.form
  const propertiesOpen = sectionOpen.properties
  const spectrumOpen = sectionOpen.quality
  const outputOpen = sectionOpen.output
  const normalizeOpen = sectionOpen.normalize
  // The chosen export format, seeded from the Settings default. The format menu
  // only updates this; conversion waits for a deliberate click on the main button.
  // The Editor remounts per track (key={track.id}), so each track starts from the
  // default rather than inheriting the last track's pick.
  const [format, setFormat] = useState(outputFormat)
  // Per-track normalization, seeded from the Settings default. Editing it both
  // updates the control and reports the override up so convert uses it.
  const [normalizeCfg, setNormalizeCfg] = useState(normalize)
  // Report the seeded picks up once on mount: App mirrors them in refs for the
  // keyboard convert shortcuts, and since this editor remounts per track, the mount
  // report IS the per-track reseed — one mechanism (the editor reporting) keeps the
  // mirror right by construction, with no selection-watching reset in App.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately mount-only — the change handlers report every later pick.
  useEffect(() => {
    onFormatChange?.(format)
    onNormalizeChange?.(normalizeCfg)
  }, [])
  // Natural pixel size of the shown artwork, read on load, so the user can tell
  // whether the Discogs cover is sharp enough or worth replacing. Null until loaded
  // and reset whenever the cover changes.
  const [coverDims, setCoverDims] = useState<{ w: number; h: number } | null>(null)
  // The shown embedded cover is a display thumbnail, so its measured size lies about
  // the art actually in the file — prefer the original dimensions probed at import.
  // Anything the user applied (Discogs URL, picked file) displays at native size, so
  // the measured dimensions are the truth there.
  const effectiveCoverDims =
    item.coverUrl === item.embeddedCover && item.embeddedCoverDims
      ? item.embeddedCoverDims
      : coverDims

  // Tempo detected from the audio, offered as a chip under the bpm field. Detection
  // can octave-fold (70 vs 140), so it stays a suggestion the user clicks to accept,
  // never a silent write. Disabled when the field is hidden and in multi-select,
  // where there is nowhere to suggest it.
  // The DSP probes wait for the selection to rest on this track (the editor remounts
  // per track), so j/k browsing doesn't enqueue a serial worker job per row passed.
  const probesSettled = useSettled(SELECTION_SETTLE_MS)
  const { data: detectedBpm } = useBpm(
    item.inputPath,
    probesSettled && !isMulti && visibleFields.includes('bpm') && formOpen,
  )

  // Key detected from the audio, offered like the BPM above. It is the least
  // reliable analysis Surco runs (chroma profiles can pick a relative or
  // neighbouring key), which is exactly why it is a chip and never a write.
  const { data: detectedKey } = useKey(
    item.inputPath,
    probesSettled && !isMulti && visibleFields.includes('key') && formOpen,
  )

  // Which tracklist entry of the open release best matches the file. Shared by the
  // Discogs panel (which highlights it as the suggestion) and the Apple Music lookup
  // below. Fuzzy, so the filename's case and punctuation don't have to match Discogs
  // exactly. Memoized on its inputs so typing in unrelated fields doesn't re-run the
  // fuzzy match over the whole tracklist on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the exact fields matchTargetOf reads, not item's identity — a new item object with the same title/duration/trackNumber/artist must not re-run the whole-tracklist match.
  const match = useMemo(
    () => (release ? bestMatch(release.tracklist, matchTargetOf(item)) : undefined),
    [release, item.meta.title, item.duration, item.meta.trackNumber, item.meta.artist],
  )
  const matchTier = match ? confidenceTier(match.confidence) : undefined
  // 'low' is too weak to trust, so it points at nothing — otherwise loading an
  // unrelated release still badges whichever mix shares an incidental word.
  const matchedTrack = matchTier && matchTier !== 'low' ? match?.track : undefined

  // The canonical artist/title of the confidently-suggested release. The file's own tag is
  // often messier than the spelling the user searched for, and the library is keyed by the
  // canonical name — so this bridges a tag the library can't recognise on its own. Only a
  // trusted match (matchedTrack already excludes 'low') feeds it, so an unrelated open
  // release can't manufacture a false "owned".
  const suggestedMeta =
    matchedTrack && release
      ? {
          title: matchedTrack.title,
          artist: joinArtists(matchedTrack.artists) || joinArtists(release.artists),
        }
      : undefined

  // Whether the confident Discogs suggestion is what proves this track is owned — the raw
  // tags didn't key-match the library but the release's canonical title/artist does. This is
  // the one verdict the list can't recompute on its own (it has no open release), so it gets
  // persisted below so the filter agrees with this badge.
  const resolvedViaDiscogs =
    !!libraryIndex &&
    !item.musicPersistentId &&
    !isInLibrary(libraryIndex, item.meta) &&
    !!suggestedMeta &&
    isInLibrary(libraryIndex, suggestedMeta)

  // Hint of whether the song is already in the Apple Music library, so the user doesn't
  // re-import it. Read from the same session snapshot the list and quality filter use
  // (isInLibrary on item.meta); the editor additionally accepts a confident Discogs
  // suggestion, so opening the right release can flip a tag the raw filename couldn't match.
  // That Discogs-proven verdict is persisted (resolvedViaDiscogs, below) so the row and
  // filter agree with this badge. A track Surco itself added (musicPersistentId) counts as
  // owned even before the snapshot lands; 'idle' hides the badge off macOS and until it arrives.
  // 'checking' covers the gap that used to flicker "not in library": the raw tags don't match
  // but Discogs is still resolving (the auto-search's debounce, request or release load), so
  // its match could still flip this to 'yes' — only once that work settles without a match do
  // we commit to 'no'.
  const inLibrary: 'idle' | 'yes' | 'no' | 'checking' = ((): 'idle' | 'yes' | 'no' | 'checking' => {
    if (!isMacOS()) return 'idle'
    if (item.musicPersistentId || item.inAppleMusicResolved) return 'yes'
    if (!libraryIndex) return 'idle'
    if (isInLibrary(libraryIndex, item.meta)) return 'yes'
    if (resolvedViaDiscogs) return 'yes'
    return discogsResolving ? 'checking' : 'no'
  })()

  // Pin a Discogs-proven "owned" verdict onto the track so the list and filter read it too,
  // not just this badge. Only when it's newly proven and not already pinned, so the effect
  // settles in one write. onChange is App's updateTrack (a shallow merge), so this adds the
  // flag without disturbing the open edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onChange is identity-stable (App's useStableCallback); excluding it keeps this effect from re-firing on unrelated App renders.
  useEffect(() => {
    if (resolvedViaDiscogs && !item.inAppleMusicResolved) onChange({ inAppleMusicResolved: true })
  }, [resolvedViaDiscogs, item.inAppleMusicResolved])

  function selectTrack(track: ReleaseTrack): void {
    if (!release) return
    // Keep the file's own cover. Only when the user opts into replacing low-res art
    // (Settings → Artwork) does a present-but-small cover get filled from the release;
    // otherwise the file's cover always wins so a correct sleeve isn't swapped for the
    // release's larger-but-generic image. A missing cover is always filled either way.
    onChange({
      ...buildReleaseMeta(item.meta, release, track, {
        url: item.coverUrl,
        path: item.coverPath,
        keep:
          !!item.coverUrl &&
          !(
            replaceLowResCover &&
            effectiveCoverDims &&
            isLowResCover(effectiveCoverDims.w, effectiveCoverDims.h)
          ),
      }),
      // Mark the track matched so the sweep leaves this deliberate pick alone, even when
      // the source (Bandcamp) writes no Discogs id to guard it.
      matched: true,
    })
    // Applying a release is the cue to verify the tags, so move focus to the first field:
    // the keyboard flow continues ⌘2 → pick → Enter → edit without a manual ⌘3. The field's
    // input node persists across the re-render (stable key), so focusing it now sticks.
    document.querySelector<HTMLElement>('[data-testid="field-title"]')?.focus()
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

  // "Without version" proposal for the album menu: strip the mix/label parenthetical
  // from the album, or from the title when the album is still empty (the common case
  // for a single release). Only set when stripping actually removes something, so the
  // menu offers the row only when there is a version to drop.
  const albumCleanSource = isMulti ? '' : (item.meta.album ?? '').trim() || (item.meta.title ?? '')
  const albumClean = stripParentheticals(albumCleanSource)
  const albumCleanResult = albumClean && albumClean !== albumCleanSource ? albumClean : undefined

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
  // deleting fifteen values by hand. The blank comes from the metadata SSOT so a
  // newly-added field is cleared too, not silently left behind. Artwork is untouched:
  // the cover picker owns its own remove, and a wrong title rarely means a wrong cover.
  function clearAllMeta(): void {
    const blank = emptyMetadata()
    if (isMulti) onChangeAllMeta?.(blank)
    // Clearing the tags un-matches the track, so the sweep may fill it again — including
    // dropping any pending review flag so a retag is probed afresh, and the Discogs-proven
    // owned verdict so it re-resolves against whatever the retag matches.
    else onChange({ meta: blank, matched: false, matchReview: false, inAppleMusicResolved: false })
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
  // convert: with the convert button disabled below, that click can't surface the
  // reason any more, so the field's amber dot and the button's own tooltip — which
  // names exactly what's missing — are what tell the user why. The tooltip reuses the
  // same phrasing the blocked-convert error would have shown.
  const missing = missingRequired(item.meta, requiredFields)
  const incomplete = missing.length > 0
  const incompleteReason = incomplete
    ? tr('editor.missingRequired', {
        fields: missing.map((key) => tr(`fields.${key}`)).join(', '),
      })
    : undefined
  // The user's default genres come first so they're always one click away even when a
  // release isn't matched; the release's own genres/styles follow, deduped case-insensitively
  // so a shared name (the user's "Electronic" vs a provider's "electronic") shows a single
  // pill in the user's casing.
  const genreChips = useMemo(() => buildGenreChips(genrePresets, release), [genrePresets, release])
  // Default to the file's own name so converting keeps it; the metadata-derived name is
  // opt-in via the "Regenerate from metadata" button below — unless auto-apply is on, where
  // it derives live from the pattern (falling back to the file name for sparse metadata).
  const defaultOutputName =
    (autoApplyFilename && renderOutputName(filenameFormat, item.meta)) || item.fileName
  // Exporting to the source's own format edits the original file in place (and
  // renames it on disk) rather than writing a copy to the output folder — warn the
  // user before they hit the button so the rename isn't a surprise. Overwrite mode
  // forces this for every format, replacing the source whatever the target.
  const willEditInPlace = overwriteOriginal || formatMatchesInput(format, item.inputPath)
  // Overwriting a lossless master (WAV/AIFF/FLAC) with MP3 is the one irreversible,
  // quality-losing case worth a sharper warning before the user commits to it.
  const lossyOverwrite =
    overwriteOriginal && format === 'mp3' && !formatMatchesInput('mp3', item.inputPath)

  const fieldSpecs = buildFieldSpecs({
    isMulti,
    selectedTracks,
    visibleFields,
    requiredFields,
    item,
    genreChips,
    groupingPresets,
    detectedBpm,
    detectedKey,
    keyNotation,
    insertSources,
    albumCleanResult,
    tr,
    setField,
    onChangeAllMeta,
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

  // Hands the Settings-pattern name to the clipboard so the user can paste the track into a
  // search box (Google, Soulseek) to chase a better rip. Icon-only like its neighbours.
  const copyFilenameButton = (
    <button
      type="button"
      data-testid="copy-filename-btn"
      aria-label={tr('editor.copyFilename')}
      onClick={onCopyFilename}
      className="press group relative flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
    >
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      <Tooltip label={tr('editor.copyFilenameHint')} align="end" />
    </button>
  )

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
        formatFilter={discogsFormats}
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
            onToggle={() => setSectionOpen('form', !formOpen)}
            right={
              <div className="flex items-center gap-3">
                {/* Badge first, button last: the badge appears once the snapshot resolves
                    a verdict, so keeping the button at the row's end stops it shifting when
                    the badge mounts. */}
                {!isMulti && inLibrary === 'yes' && (
                  <span
                    data-testid="apple-music-status"
                    className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 text-xs font-medium text-warn"
                  >
                    <Disc3 className="h-3.5 w-3.5" aria-hidden="true" />
                    {tr('editor.inLibrary')}
                  </span>
                )}
                {!isMulti && inLibrary === 'no' && (
                  <span
                    data-testid="apple-music-status"
                    className="inline-flex items-center gap-1.5 rounded-full bg-good/15 px-2.5 py-1 text-xs font-medium text-good"
                  >
                    <Disc3 className="h-3.5 w-3.5" aria-hidden="true" />
                    {tr('editor.notInLibrary')}
                  </span>
                )}
                {/* The in-between state: Discogs is still searching, so its match could yet
                    prove the track owned — show "Checking…" rather than flashing not-in-library
                    and then correcting it a second later. */}
                {!isMulti && inLibrary === 'checking' && (
                  <span
                    data-testid="apple-music-status"
                    className="inline-flex items-center gap-1.5 rounded-full bg-fg/10 px-2.5 py-1 text-xs font-medium text-fg-dim"
                  >
                    <Disc3 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {tr('editor.checkingLibrary')}
                  </span>
                )}
                {!isMulti && copyFilenameButton}
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
              coverDims={effectiveCoverDims}
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
              onToggle={() => setSectionOpen('properties', !propertiesOpen)}
            />
          )}

          {!isMulti && (showSpectrum || showLoudness) && (
            <QualitySection
              item={item}
              showSpectrum={showSpectrum}
              showLoudness={showLoudness}
              open={spectrumOpen}
              onToggle={() => setSectionOpen('quality', !spectrumOpen)}
              onShowLoudnessHelp={onShowLoudnessHelp}
            />
          )}

          {!isMulti && !overwriteOriginal && (
            <OutputNameSection
              item={item}
              format={format}
              defaultOutputName={defaultOutputName}
              autoApply={autoApplyFilename}
              willEditInPlace={willEditInPlace}
              open={outputOpen}
              onToggle={() => setSectionOpen('output', !outputOpen)}
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
            onToggle={() => setSectionOpen('normalize', !normalizeOpen)}
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
          incompleteReason={incompleteReason}
          willEditInPlace={willEditInPlace}
          addToAppleMusic={addToAppleMusic}
          format={format}
          exportedFormat={exportedFormat}
          musicExt={musicExt}
          normalizeCfg={normalizeCfg}
          onOpenNormalize={() => setSectionOpen('normalize', true)}
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
})
