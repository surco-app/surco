import { Copy, Disc3, Eraser, Globe, Tag, Type } from 'lucide-react'
import type React from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { editsInPlace, formatMatchesInput } from '../../../shared/format'
import { emptyMetadata } from '../../../shared/metadata'
import type {
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
import { useTrackProperties } from '../hooks/useTrackProperties'
import { useStableCallback } from '../hooks/useStableCallback'
import {
  type AppleMusicIndex,
  type StaleLibraryCopy,
  isInLibrary,
  staleLibraryCopy,
} from '../lib/appleMusicLibrary'
import { matchTargetOf } from '../lib/autoMatch'
import { deriveTagPatches } from '../lib/deriveTags'
import { DESTINATIONS, type Destination, fromDestination, toDestination } from '../lib/destination'
import { isNormalizeStale, isStale } from '../lib/dirty'
import { BULK_FIELDS } from '../lib/bulkEdit'
import { buildFieldSpecs } from '../lib/fieldSpecs'
import { FIELD_DEFS, missingRequired } from '../lib/fields'
import { genreChips as buildGenreChips } from '../lib/genre'
import { renderOutputName, titleFormatPatches } from '../lib/outputName'
import { librarySourceOf } from '../lib/librarySource'
import { isMacOS } from '../lib/platform'
import { isLowResCover, formatKHz } from '../lib/quality'
import {
  bestMatch,
  buildReleaseMeta,
  catalogNumberMatches,
  corroboratedTier,
  joinArtists,
  type ReleaseMetaPatch,
} from '../lib/release'
import { selectionStatus } from '../lib/selectionStatus'
import { matchStatKey } from '../lib/stats'
import { stripParentheticals } from '../lib/textClean'
import { useAppSettings } from '../lib/settingsContext'
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
  searchInputRef: React.RefObject<HTMLInputElement | null>
  // The whole multi-selection, when more than one track is picked. Its presence flips the
  // Discogs column to album-match mode (map every file to a tracklist entry at once) and
  // the convert action to "convert all"; the right-hand editor still shows `item`, the
  // primary track. Undefined/length<=1 means the ordinary single-track editor.
  selectedTracks?: TrackItem[]
  onApplyMatches?: (
    patches: { id: string; patch: ReleaseMetaPatch }[],
    provider: SearchProviderId,
  ) => void
  onProcessAll?: (format: OutputFormat) => void
  onAddAllToAppleMusic?: () => void
  // Multi-select writes: a field edited in the shared form goes to every selected track,
  // and a dropped/picked cover is stamped onto all of them.
  onChangeAllMeta?: (patch: Partial<TrackMetadata>) => void
  onApplyCoverAll?: (coverUrl: string, coverPath?: string) => void
  // Fills each track's tags from its own file name; applies to the primary in single view
  // and to the whole selection in multi.
  onDeriveTags?: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  // Rewrites the selection's titles from the settings' title format — App owns it so
  // the pass shares the ⌘K command's undo channel and its "changed n / changed
  // nothing" notices; the editor's T button is just a second trigger for it.
  onApplyTitleFormat?: () => void
  // Snapshots the given tracks' tags into App's ⌘Z stack before the clear button
  // overwrites them (derive is already recorded inside onDeriveTags).
  onRecordUndo?: (ids: string[]) => void
  onChange: (patch: Partial<TrackItem>) => void
  onProcess: (format: OutputFormat) => void
  // The explicit "re-encode this one" action: a same-format source rendered again
  // with the pinned bit depth/sample rate. Offered only when the source doesn't
  // meet the pins — the regular process button stays a metadata-only update.
  onReencode?: (format: OutputFormat) => void
  // Reports the format chosen in the split-button menu so the keyboard convert
  // shortcuts (⌘⏎ / ⌘⇧⏎) export in it too, instead of the Settings default.
  onFormatChange?: (format: OutputFormat) => void
  // Reports the destination chosen in the split-button menu, mirroring onFormatChange:
  // App pins it in a ref so every convert entry point sends this track where the
  // button says, not where Settings points.
  onDestinationChange?: (destination: Destination) => void
  // Reports the per-track normalization override so the keyboard convert shortcuts
  // and "convert all" apply it too, mirroring onFormatChange.
  onNormalizeChange?: (normalize: NormalizeConfig) => void
  onAddToAppleMusic: () => void
  // Trashes the source file after a real conversion; the converted output and the
  // track's row stay. Confirmation lives in App, so the button just signals intent.
  onTrashOriginal?: () => void
  // Removes the superseded Apple Music copy (the library entry the fresh add replaced).
  // Confirmation lives in App, so the link just signals intent; the copy's label rides
  // along so the dialog can name the entry it is about to delete.
  onRemoveOldMusicCopy?: (stale: StaleLibraryCopy) => void
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
  // Opens a Google search for the same name in the default browser — the one-click twin of
  // copy-then-paste. App owns the pattern and the hand-off, so the editor just signals intent.
  onSearchWeb: () => void
  // Opens the DJ-app collection export (rekordbox/Traktor/Serato/M3U8/Engine USB) — the
  // post-conversion step that used to live on the toolbar. App owns the modal.
  onExportCollection: () => void
}

// Memoized: App keeps every prop identity-stable (useStableCallback handlers, kept
// selectedTracks identity), so search keystrokes and progress ticks on other tracks
// skip this whole subtree.
export const Editor = memo(function Editor({
  item,
  libraryIndex,
  searchInputRef,
  selectedTracks,
  onApplyMatches,
  onProcessAll,
  onAddAllToAppleMusic,
  onChangeAllMeta,
  onApplyCoverAll,
  onDeriveTags,
  onApplyTitleFormat,
  onRecordUndo,
  onChange,
  onProcess,
  onReencode,
  onFormatChange,
  onDestinationChange,
  onNormalizeChange,
  onAddToAppleMusic,
  onTrashOriginal,
  onRemoveOldMusicCopy,
  onOpenSettings,
  onShowLoudnessHelp,
  onOpenRename,
  onRegenerateName,
  onCopyFilename,
  onSearchWeb,
  onExportCollection,
}: Props): React.JSX.Element {
  // Every Settings-derived value the editor reads comes from the shared context in one
  // pull — this used to be a 17-prop wall App re-plumbed for each field (see
  // settingsContext.tsx). Memoized upstream on the settings identity, so the memo()
  // above keeps the same "only re-render when settings actually change" contract.
  const {
    discogsToken,
    outputFormat,
    addToAppleMusic,
    addToEngineDj,
    overwriteOriginal,
    convertBesideOriginal,
    replaceLowResCover,
    autoApplyFilename,
    filenameFormat,
    titleFormat,
    groupingPresets,
    genrePresets,
    visibleFields,
    requiredFields,
    discogsFormats,
    discogsMaxResults,
    searchProviders,
    searchIgnoreWords,
    showSpectrum,
    showLoudness,
    keyNotation,
    normalize,
    outputBitDepth,
    outputSampleRate,
    editorSections,
  } = useAppSettings()
  const hasToken = discogsToken !== ''
  const isMulti = (selectedTracks?.length ?? 0) > 1
  const { t: tr } = useTranslation()
  // A refined search is persisted on the track, so flipping away and back re-seeds
  // the box (and its cached results) instead of reverting to the filename guess.
  // Memoized so the browser's probe closures don't churn identity on unrelated renders.
  const matchCleanup = useMemo(
    () => ({ titleFormat, ignoreWords: searchIgnoreWords }),
    [titleFormat, searchIgnoreWords],
  )
  const browser = useDiscogsBrowser(
    item,
    tr,
    (query) => onChange({ query }),
    searchProviders,
    discogsMaxResults,
    matchCleanup,
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
  // The chosen destination, same one-shot contract as the format: seeded from the
  // Settings booleans, updated only by the split-button menu, reset by the per-track
  // remount, never written back to Settings.
  const [destination, setDestination] = useState(() =>
    toDestination(
      addToAppleMusic,
      outputFormat === 'flac',
      overwriteOriginal,
      addToEngineDj,
      convertBesideOriginal,
    ),
  )
  // The facets the picked destination means, replacing the raw Settings reads below
  // so the in-place warnings, the button label and the membership badge all describe
  // the conversion the button will actually run.
  const picked = fromDestination(destination)
  // Overwrite is deliberately not offered as a one-shot pick (rewriting sources is a
  // Settings-level decision with its own confirmations); it stays listed only while
  // it IS the configured destination, so the current choice is always visible.
  const destinationChoices = DESTINATIONS.filter(
    (d) => (d !== 'overwrite' || overwriteOriginal) && (d !== 'appleMusic' || isMacOS()),
  )
  // Which library the membership badge reads — the conversion destination's. Null
  // (folder/beside/overwrite, or Apple Music off macOS) hides the badge entirely.
  const librarySource = librarySourceOf(
    { ...picked, outputFormat: format },
    isMacOS(),
  )
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
    onDestinationChange?.(destination)
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
  // The same guarded tier the sweep acts on (corroboratedTier), so the badge never reads
  // 'high' on a title-only hit the sweep would have flagged for review.
  const matchTier =
    match && release
      ? corroboratedTier(
          match.confidence,
          matchTargetOf(item),
          release,
          match.track,
          catalogNumberMatches(item.meta.catalogNumber, release),
        )
      : undefined
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
  // The file's own tags plus its probed length — the library matcher uses the duration to
  // tell two versions of one title apart, so pass it alongside title/artist.
  const ownTags = {
    title: item.meta.title,
    artist: item.meta.artist,
    durationSec: item.duration,
  }
  // isInLibrary normalizes and scans the Apple Music index, so memoize the verdict on
  // the exact tags it reads — a keystroke in an unrelated field must not re-run the
  // library lookup two or three times over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownTags is a fresh literal each render; its read surface (item.meta.title/artist, item.duration) is listed instead.
  const resolvedViaDiscogs = useMemo(
    () =>
      !!libraryIndex &&
      !item.musicPersistentId &&
      !isInLibrary(libraryIndex, ownTags) &&
      !!suggestedMeta &&
      isInLibrary(libraryIndex, suggestedMeta),
    [
      libraryIndex,
      item.musicPersistentId,
      item.meta.title,
      item.meta.artist,
      item.duration,
      suggestedMeta,
    ],
  )

  // Hint of whether the song is already in the destination's library — Apple Music or
  // the Engine DJ database, whichever conversions land in — so the user doesn't
  // re-import it. Read from the same session snapshot the list and quality filter use
  // (isInLibrary on item.meta); the editor additionally accepts a confident Discogs
  // suggestion, so opening the right release can flip a tag the raw filename couldn't match.
  // That Discogs-proven verdict is persisted (resolvedViaDiscogs, below) so the row and
  // filter agree with this badge. A track Surco itself added counts as owned even before
  // the snapshot lands — via its Apple Music persistent ID or its Engine add flag,
  // whichever library is active. 'idle' hides the badge when no library destination is
  // chosen and until the snapshot arrives. 'checking' covers the gap that used to flicker
  // "not in library": the raw tags don't match but Discogs is still resolving, so its
  // match could still flip this to 'yes' — only once that work settles without a match do
  // we commit to 'no'.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownTags is a fresh literal each render; its read surface (item.meta.title/artist, item.duration) is listed instead so an unrelated keystroke doesn't re-scan the library index.
  const inLibrary: 'idle' | 'yes' | 'no' | 'checking' = useMemo(():
    | 'idle'
    | 'yes'
    | 'no'
    | 'checking' => {
    if (!librarySource) return 'idle'
    const owned =
      librarySource === 'appleMusic'
        ? item.musicPersistentId || item.inLibraryResolved
        : item.engineDjAdded || item.inLibraryResolved
    if (owned) return 'yes'
    if (!libraryIndex) return 'idle'
    if (isInLibrary(libraryIndex, ownTags)) return 'yes'
    if (resolvedViaDiscogs) return 'yes'
    return discogsResolving ? 'checking' : 'no'
  }, [
    librarySource,
    item.musicPersistentId,
    item.engineDjAdded,
    item.inLibraryResolved,
    item.meta.title,
    item.meta.artist,
    item.duration,
    libraryIndex,
    resolvedViaDiscogs,
    discogsResolving,
  ])

  // The library entry this track's Apple Music add superseded: the snapshot still matches
  // the same song under a DIFFERENT persistent ID than the one the add returned — the old
  // rip. The footer offers deleting it, closing the "add the new copy, hunt down the old
  // one in Music" loop. Excluding the add's own ID is what keeps the offer from pointing
  // at the fresh copy once the snapshot refreshes and holds both. Memoized on the exact
  // tags it reads, same as the badge above.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownTags is a fresh literal each render; its read surface (item.meta.title/artist, item.duration) is listed instead so an unrelated keystroke doesn't re-scan the library index.
  const staleMusicCopy = useMemo(
    () =>
      librarySource === 'appleMusic' && libraryIndex && item.musicPersistentId
        ? staleLibraryCopy(libraryIndex, ownTags, item.musicPersistentId)
        : null,
    [
      librarySource,
      libraryIndex,
      item.musicPersistentId,
      item.meta.title,
      item.meta.artist,
      item.duration,
    ],
  )

  // Pin a Discogs-proven "owned" verdict onto the track so the list and filter read it too,
  // not just this badge. Only when it's newly proven and not already pinned, so the effect
  // settles in one write. onChange is App's updateTrack (a shallow merge), so this adds the
  // flag without disturbing the open edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onChange is identity-stable (App's useStableCallback); excluding it keeps this effect from re-firing on unrelated App renders.
  useEffect(() => {
    if (resolvedViaDiscogs && !item.inLibraryResolved) onChange({ inLibraryResolved: true })
  }, [resolvedViaDiscogs, item.inLibraryResolved])

  function selectTrack(track: ReleaseTrack): void {
    if (!release) return
    // The cover flag protects only the file's ORIGINAL embedded art. While the shown
    // cover is still that original (coverUrl === embeddedCover), keep it — unless the user
    // opted into replacing low-res art and this original is small, in which case the
    // release's larger image wins. Once a previous release (or the absence of any embedded
    // art) means the shown cover isn't the original, there's nothing of the user's to
    // protect, so a pick always takes the release image.
    const coverIsOriginal = !!item.coverUrl && item.coverUrl === item.embeddedCover
    onChange({
      ...buildReleaseMeta(item.meta, release, track, {
        url: item.coverUrl,
        path: item.coverPath,
        keep:
          coverIsOriginal &&
          !(
            replaceLowResCover &&
            effectiveCoverDims &&
            isLowResCover(effectiveCoverDims.w, effectiveCoverDims.h)
          ),
      }),
      // Mark the track matched so the sweep leaves this deliberate pick alone, even when
      // the source (Bandcamp) writes no Discogs id to guard it.
      matched: true,
      matchProvider: release.provider,
    })
    window.api.recordStat(matchStatKey(release.provider))
    // Applying a release is the cue to verify the tags, so move focus to the first field:
    // the keyboard flow continues ⌘2 → pick → Enter → edit without a manual ⌘3. The field's
    // input node persists across the re-render (stable key), so focusing it now sticks.
    document.querySelector<HTMLElement>('[data-testid="field-title"]')?.focus()
  }

  // Stable identity so the field specs below can memoize: the body still reads the
  // current item.meta on every call (useStableCallback mirrors the latest closure),
  // so a memoized Field keeps one onChange reference across keystrokes in other fields.
  const setField = useStableCallback((key: keyof TrackItem['meta'], value: string): void => {
    onChange({ meta: { ...item.meta, [key]: value } })
  })

  // What the per-field insert menu can offer: every visible text field of THIS
  // track. Bulk edits hold no single per-field value to insert, and compilation
  // is a '1' flag rather than text, so both stay out. Memoized so an unrelated
  // keystroke (changing item.meta) doesn't rebuild the spec tree below from scratch.
  const insertSources: InsertSource[] = useMemo(
    () =>
      isMulti
        ? []
        : FIELD_DEFS.filter((d) => visibleFields.includes(d.key) && d.key !== 'compilation').map(
            (d) => ({ key: d.key, label: tr(`fields.${d.key}`), value: item.meta[d.key] ?? '' }),
          ),
    [isMulti, visibleFields, item.meta, tr],
  )

  // "Without version" proposal for the album menu: strip the mix/label parenthetical
  // from the album, or from the title when the album is still empty (the common case
  // for a single release). Only set when stripping actually removes something, so the
  // menu offers the row only when there is a version to drop.
  const albumCleanSource = isMulti ? '' : (item.meta.album ?? '').trim() || (item.meta.title ?? '')
  const albumClean = stripParentheticals(albumCleanSource)
  const albumCleanResult = albumClean && albumClean !== albumCleanSource ? albumClean : undefined

  // The title rebuilt from the settings' title format, for the title menu's one-shot
  // rewrite. titleFormatPatches carries the shared no-op rules: nothing to offer when
  // the render is empty/unchanged OR the title already wears the pattern's prefix and
  // suffix — so the row can never stack "(B2) (B2) …" on a second apply.
  const titleFormatResult =
    isMulti || !titleFormat.trim()
      ? undefined
      : titleFormatPatches(titleFormat, [item])[0]?.meta.title

  // Fills tags from each file's own name (auto-detecting the common rip naming): the primary
  // track in single view, every selected track in multi. Merges, so only matched fields change.
  function deriveFromNames(): void {
    if (!onDeriveTags) return
    const targets = isMulti ? (selectedTracks ?? []) : [item]
    const patches = deriveTagPatches(targets)
    if (patches.length) onDeriveTags(patches)
  }

  // Empties every metadata field — the inverse of the fill controls (filename /
  // Discogs) — so a badly-labelled file can be retagged from scratch instead of
  // deleting fifteen values by hand. The blank comes from the metadata SSOT so a
  // newly-added field is cleared too, not silently left behind. Artwork is untouched:
  // the cover picker owns its own remove, and a wrong title rarely means a wrong cover.
  function clearAllMeta(): void {
    const blank = emptyMetadata()
    onRecordUndo?.((isMulti ? (selectedTracks ?? []) : [item]).map((t) => t.id))
    if (isMulti) onChangeAllMeta?.(blank)
    // Clearing the tags un-matches the track, so the sweep may fill it again — including
    // dropping any pending review flag so a retag is probed afresh, and the Discogs-proven
    // owned verdict so it re-resolves against whatever the retag matches.
    else
      onChange({
        meta: blank,
        matched: false,
        matchReview: false,
        matchProvider: undefined,
        inLibraryResolved: false,
      })
  }

  // Dialing a different normalization is an edit like any other: the file on disk
  // no longer matches the editor, so the convert button must return as "Update" —
  // Djotas's flow of re-applying another loudness without faking a tag edit.
  const stale = isStale(item) || isNormalizeStale(item, normalizeCfg)
  // A stale track is done but edited since, so it shows the convert button again
  // (as "Update") rather than the done/reveal state.
  const done = item.status === 'done' && !stale
  const exportedExt = item.outputPath?.split('.').pop()?.toLowerCase()
  // ALAC's extension is its container (.m4a), not its format name, so map it back.
  const exportedFormat =
    exportedExt === 'm4a' ? 'alac' : (FORMATS.find((f) => f === exportedExt) ?? null)
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
  // forces this for every format except ALAC, which always renders a fresh file
  // (see editsInPlace) — the shared helper keeps this warning honest against what
  // resolveOutputTarget actually does. Beside-original never edits in place (a
  // same-format export lands as a fresh "(n)" copy next to the source), so its rows
  // must not carry the in-place rename warning.
  const willEditInPlace =
    !picked.convertBesideOriginal && editsInPlace(format, item.inputPath, picked.overwriteOriginal)
  // Same-format exports never touch the audio (metadata-only, by design), so when the
  // quality pins ask for something the source isn't, the honest move is an explicit
  // offer: a passive line naming the gap plus a "Re-encode" action — never a silent
  // re-encode. Lossless formats only (re-encoding an MP3 onto itself just degrades it);
  // hidden in overwrite mode, whose contract is rewriting the source, not a fresh copy.
  const qualityPinned = outputSampleRate !== 'source' || outputBitDepth !== 'source'
  const reencodeCandidate =
    !isMulti &&
    !picked.overwriteOriginal &&
    qualityPinned &&
    format !== 'mp3' &&
    formatMatchesInput(format, item.inputPath)
  const sourceProps = useTrackProperties(item.inputPath, reencodeCandidate).data
  const rateMismatch =
    outputSampleRate !== 'source' &&
    !!sourceProps?.sampleRateHz &&
    sourceProps.sampleRateHz !== Number(outputSampleRate)
  const depthMismatch =
    outputBitDepth !== 'source' &&
    sourceProps?.bitDepth != null &&
    sourceProps.bitDepth !== Number(outputBitDepth)
  const reencode =
    reencodeCandidate && sourceProps && (rateMismatch || depthMismatch)
      ? {
          current: [
            rateMismatch ? formatKHz(sourceProps.sampleRateHz) : '',
            depthMismatch ? tr('editor.propBitDepthValue', { bits: sourceProps.bitDepth }) : '',
          ]
            .filter(Boolean)
            .join(' / '),
          target: [
            rateMismatch ? formatKHz(Number(outputSampleRate)) : '',
            depthMismatch
              ? tr('editor.propBitDepthValue', { bits: Number(outputBitDepth) })
              : '',
          ]
            .filter(Boolean)
            .join(' / '),
        }
      : undefined
  // Overwriting a lossless master (WAV/AIFF/FLAC) with MP3 is the one irreversible,
  // quality-losing case worth a sharper warning before the user commits to it.
  const lossyOverwrite =
    picked.overwriteOriginal && format === 'mp3' && !formatMatchesInput('mp3', item.inputPath)

  // One onChange per possible key, built once (setField/onChangeAllMeta never
  // change identity) and reused by every fieldSpecs rebuild below. Field.tsx is
  // memoized on this exact prop — closing over `key` inline inside
  // buildFieldSpecs would hand every field a fresh onChange on every keystroke
  // (fieldSpecs itself rebuilds every keystroke, since item.meta changed) and
  // defeat that memo, re-rendering every visible field instead of just the one
  // whose value moved.
  const singleOnChange = useMemo(
    () => new Map(FIELD_DEFS.map((def) => [def.key, (v: string) => setField(def.key, v)])),
    [setField],
  )
  const bulkOnChange = useMemo(
    () => new Map(BULK_FIELDS.map((key) => [key, (v: string) => onChangeAllMeta?.({ [key]: v })])),
    [onChangeAllMeta],
  )

  // Built once per real input change. setField and tr are identity-stable, so a
  // keystroke only rebuilds the specs because item.meta changed — and the form's
  // memoized fields re-render just for the keys whose value actually moved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: item.meta is the read surface buildFieldSpecs uses, not item's identity; the rest are listed explicitly so an unrelated item field doesn't rebuild the tree.
  const fieldSpecs = useMemo(
    () =>
      buildFieldSpecs({
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
        titleFormatResult,
        tr,
        singleOnChange,
        bulkOnChange,
      }),
    [
      isMulti,
      selectedTracks,
      visibleFields,
      requiredFields,
      item.meta,
      genreChips,
      groupingPresets,
      detectedBpm,
      detectedKey,
      keyNotation,
      insertSources,
      albumCleanResult,
      titleFormatResult,
      tr,
      singleOnChange,
      bulkOnChange,
    ],
  )

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

  // One-click "rewrite titles from the pattern" over the selection. Only present
  // when a title format is configured — without one there is nothing to apply.
  const titleFormatButton =
    onApplyTitleFormat && titleFormat.trim() !== '' ? (
      <button
        type="button"
        data-testid="apply-title-format-btn"
        aria-label={tr('editor.applyTitleFormat')}
        onClick={onApplyTitleFormat}
        className="press group relative flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
      >
        <Type className="h-3.5 w-3.5" aria-hidden="true" />
        <Tooltip label={tr('editor.applyTitleFormatHint')} align="end" />
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

  // The copy button's one-click twin: opens the search directly instead of leaving the
  // paste to the user. Icon-only like its neighbours.
  const searchWebButton = (
    <button
      type="button"
      data-testid="search-web-btn"
      aria-label={tr('editor.searchWeb')}
      onClick={onSearchWeb}
      className="press group relative flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
    >
      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
      <Tooltip label={tr('editor.searchWebHint')} align="end" />
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
                    {tr(librarySource === 'engineDj' ? 'editor.inLibraryEngine' : 'editor.inLibrary')}
                  </span>
                )}
                {!isMulti && inLibrary === 'no' && (
                  <span
                    data-testid="apple-music-status"
                    className="inline-flex items-center gap-1.5 rounded-full bg-good/15 px-2.5 py-1 text-xs font-medium text-good"
                  >
                    <Disc3 className="h-3.5 w-3.5" aria-hidden="true" />
                    {tr(
                      librarySource === 'engineDj'
                        ? 'editor.notInLibraryEngine'
                        : 'editor.notInLibrary',
                    )}
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
                {/* Two pairs, one divider: copy/search act on the file NAME (read-only,
                    hunt a better rip elsewhere); eraser/tag act on the metadata FIELDS.
                    Each pair packs tighter (gap-1.5) than the row (gap-3) so the
                    grouping reads at a glance. */}
                {!isMulti && (
                  <div className="flex items-center gap-1.5">
                    {copyFilenameButton}
                    {searchWebButton}
                  </div>
                )}
                {!isMulti && (
                  <div aria-hidden="true" className="h-5 w-px self-center bg-[var(--color-line)]" />
                )}
                <div className="flex items-center gap-1.5">
                  {clearButton}
                  {deriveButton}
                  {titleFormatButton}
                </div>
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

          {/* The sections below the metadata form render in the user's order
              (Settings → Editor); the form itself is the editor's fixed header. Each
              section keeps its own visibility conditions, so reordering never makes
              one appear where it wouldn't have. */}
          {editorSections
            .filter((s) => s.id !== 'form')
            .map(({ id }) => {
              switch (id) {
                case 'properties':
                  return (
                    !isMulti && (
                      <PropertiesSection
                        key={id}
                        item={item}
                        open={propertiesOpen}
                        onToggle={() => setSectionOpen('properties', !propertiesOpen)}
                      />
                    )
                  )
                case 'quality':
                  return (
                    !isMulti &&
                    (showSpectrum || showLoudness) && (
                      <QualitySection
                        key={id}
                        item={item}
                        showSpectrum={showSpectrum}
                        showLoudness={showLoudness}
                        open={spectrumOpen}
                        onToggle={() => setSectionOpen('quality', !spectrumOpen)}
                        onShowLoudnessHelp={onShowLoudnessHelp}
                      />
                    )
                  )
                case 'output':
                  // Overwrite mode pins the name to the original, so the File Name
                  // section is replaced by a notice of what the export will do.
                  if (!isMulti && overwriteOriginal) {
                    return (
                      <div
                        key={id}
                        data-testid="overwrite-notice"
                        className="mt-6 border-t border-[var(--color-line)] pt-5"
                      >
                        <p className="text-sm font-medium text-fg-muted">
                          {tr('editor.overwriteTitle')}
                        </p>
                        <p
                          className={`mt-2 text-xs ${lossyOverwrite ? 'text-danger' : 'text-fg-dim'}`}
                          data-testid="overwrite-hint"
                        >
                          {lossyOverwrite
                            ? tr('editor.overwriteLossyHint')
                            : willEditInPlace
                              ? tr('editor.overwriteHint')
                              : tr('editor.overwriteAlacHint')}
                        </p>
                      </div>
                    )
                  }
                  return (
                    !isMulti && (
                      <OutputNameSection
                        key={id}
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
                    )
                  )
                case 'normalize':
                  return (
                    <NormalizeSection
                      key={id}
                      value={normalizeCfg}
                      open={normalizeOpen}
                      onToggle={() => setSectionOpen('normalize', !normalizeOpen)}
                      onChange={(n) => {
                        setNormalizeCfg(n)
                        onNormalizeChange?.(n)
                      }}
                      item={item}
                      isMulti={isMulti}
                    />
                  )
                default:
                  return null
              }
            })}
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
          reencode={reencode}
          onReencode={() => onReencode?.(format)}
          addToAppleMusic={picked.addToAppleMusic}
          addToEngineDj={picked.addToEngineDj}
          destination={destination}
          destinations={destinationChoices}
          format={format}
          exportedFormat={exportedFormat}
          musicExt={musicExt}
          normalizeCfg={normalizeCfg}
          onOpenNormalize={() => setSectionOpen('normalize', true)}
          onSelectFormat={(f) => {
            setFormat(f)
            onFormatChange?.(f)
            // Music can't ingest FLAC: picking it while Apple Music is the destination
            // silently falls back to the output folder — the same pin Settings applies —
            // and the button label updates to say so.
            if (f === 'flac' && destination === 'appleMusic') {
              setDestination('folder')
              onDestinationChange?.('folder')
            }
          }}
          onSelectDestination={(d) => {
            setDestination(d)
            onDestinationChange?.(d)
          }}
          onExportCollection={onExportCollection}
          onProcess={isMulti ? (f) => onProcessAll?.(f) : onProcess}
          onAddToAppleMusic={isMulti ? onAddAllToAppleMusic : onAddToAppleMusic}
          onTrashOriginal={onTrashOriginal}
          staleMusicCopy={staleMusicCopy}
          onRemoveOldMusicCopy={onRemoveOldMusicCopy}
        />
      </div>
    </div>
  )
})
