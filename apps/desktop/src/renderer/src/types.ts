import type {
  DeclickMode,
  NormalizeConfig,
  OutputFormat,
  ProcessStage,
  Release,
  ReleaseTrack,
  SearchProviderId,
  SearchResult,
  SpectrumResult,
  TrackMetadata,
} from '../../shared/types'

export type TrackStatus = 'idle' | 'processing' | 'done' | 'error'

// Metadata copied from one track's context menu, to stamp onto another — the tags
// plus the cover the source row was showing, so a paste dresses the target whole.
export interface CopiedTags {
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
}

export interface TrackItem {
  id: string
  inputPath: string
  fileName: string
  query: string
  meta: TrackMetadata
  // The name shown in the track list. Frozen to the title (or file name) the file
  // had when it was imported and never changed afterward, so the list stays a stable
  // reference — editing metadata in the form on the right never renames the row.
  listLabel: string
  // True from the moment the file lands until its tags, duration and cover are read.
  // The row renders straight away (parsed from the file name) with a placeholder for
  // these fields, so a slow cloud/network drop shows progress instead of an empty list.
  loadingMeta?: boolean
  // Set when the metadata read failed outright (corrupt file, dropped mount): the row
  // shows only its file-name parse, and the warning mark tells that apart from a file
  // that genuinely carries no tags. Cleared by rebuilding the row (start over).
  metaReadFailed?: boolean
  // Total length in seconds, probed when the file is added. Undefined when the
  // probe failed or has not run yet, so the row simply omits the time.
  duration?: number
  coverUrl?: string
  coverPath?: string
  // The artwork embedded in the file itself, captured once when the file is added
  // and never overwritten by a release match. The cover picker offers it as a
  // choice distinct from the release's images; a file with no embedded art has
  // none, so it contributes no slot. Undefined when the file carries no cover.
  embeddedCover?: string
  // Original pixel size of the file's embedded art, probed at import. The stored
  // embeddedCover/coverUrl is a display thumbnail, so the real size travels
  // separately for the low-res checks and the editor's size pill.
  embeddedCoverDims?: { w: number; h: number }
  // Set when the user clears the artwork, so the conversion strips the embedded
  // cover instead of preserving it. Cleared again the moment a new cover is set.
  coverRemoved?: boolean
  // The spectrogram/cutoff verdict, not stored on the canonical track but merged in
  // from the React Query cache at the App boundary so the quality triage and the list
  // can read each track's verdict. Undefined until its analysis lands in the cache.
  spectrum?: SpectrumResult
  // True while this track's spectrum analysis is in flight (hover prefetch, editor
  // open or the toolbar sweep), merged in from the React Query fetch status like
  // spectrum above, so the row can show a placeholder instead of an empty slot.
  analyzing?: boolean
  // Set when a Discogs match was applied automatically (auto-match on import or the
  // toolbar sweep) rather than by the user clicking a suggestion, so the row can flag
  // it and the list can filter for the auto-filled tracks to spot-check them.
  autoMatched?: boolean
  // A release has been applied to this track — by hand (from any provider) or by the
  // sweep — so the auto-match sweep won't re-probe and overwrite it. Discogs picks are
  // also guarded by meta.discogsReleaseId; this covers providers that write no such id
  // (Bandcamp). Cleared when the track's metadata is cleared.
  matched?: boolean
  // A plausible but unconfirmed auto-match the sweep found ('review' tier): its metadata is
  // NOT applied — the row is flagged so the user can confirm it in the editor — and the sweep
  // won't re-probe it. Cleared when the track's metadata is cleared so a retag re-probes.
  matchReview?: boolean
  // The release/track behind a 'review' suggestion, kept so the user can accept it in one
  // action (a shortcut or a click) without the editor re-probing Discogs. Set alongside
  // matchReview; cleared when the suggestion is accepted or the metadata is cleared.
  reviewMatch?: { release: Release; track: ReleaseTrack; result: SearchResult }
  // The confidence (0–1) of the auto-match applied (autoMatched) or suggested (matchReview),
  // so the row can surface how strong the match was. Undefined for hand-picked matches.
  matchConfidence?: number
  // Which catalog the applied release came from (sweep, accepted review or a manual
  // apply), so the list can filter matches by source. Cleared with `matched` when the
  // metadata is cleared.
  matchProvider?: SearchProviderId
  // Whether another loaded row shares this track's folded artist+title — the same song
  // as two files. Merged in at the App boundary (like spectrum/inLibrary) from a
  // whole-list scan, so the duplicates filter is a plain per-track predicate.
  duplicate?: boolean
  // Whether this track's tags were found in the destination's library (Apple Music or
  // Engine DJ, whichever the conversion destination points at), merged in at the App
  // boundary from the session library snapshot (like spectrum) so the list can filter
  // "already owned" vs "missing". Undefined until the snapshot loads, with no library
  // destination, or before any candidate is filled — those rows sit in neither bucket.
  inLibrary?: boolean
  // A persisted "owned" verdict the raw tags alone couldn't reach: the editor and the
  // auto-match sweep both re-check the library against the confident Discogs match's
  // canonical title/artist, and when that matches they pin it here. The list merge ORs
  // this into inLibrary so the filter agrees with the editor's badge — otherwise a
  // file whose messy filename doesn't key-match the library would keep reading not-owned
  // in the list even after the editor flipped it to owned. Set once, never cleared back
  // to false (a clear-meta drops it so a retag re-resolves).
  inLibraryResolved?: boolean
  outputName?: string
  status: TrackStatus
  stage?: ProcessStage
  // The format this track is being / was last converted to, captured when the
  // run starts so the progress label reflects the user's pick rather than the
  // Settings default.
  format?: OutputFormat
  outputPath?: string
  // Snapshot of the editor (via trackSignature) taken when the track last
  // finished, so later edits flip it "stale" and bring back the convert button.
  processedSignature?: string
  // The normalization the last export actually applied, so dialing a different
  // target afterwards flips the track "stale" exactly like a metadata edit —
  // re-normalizing must not require touching a tag to earn the Update button.
  processedNormalize?: NormalizeConfig
  // The click repair the last export actually applied, same staleness contract
  // as processedNormalize.
  processedDeclick?: DeclickMode
  // Snapshot (via trackSignature) of the state some file already carries: stamped
  // from the pure file read when the import lands and re-stamped when a conversion
  // writes the tags out. The live state diverging from it means the user has staged
  // work that exists nowhere on disk — exactly what the session store must persist
  // and what makes the reopen offer refuse to expire on its own.
  diskSignature?: string
  error?: string
  // Tracks a manual "add to Apple Music" run, independent of status so the track
  // stays 'done' while it adds. 'error' carries the reason in musicError.
  musicStatus?: 'adding' | 'added' | 'error'
  musicError?: string
  // The persistent ID of this track's Apple Music library copy, returned by the
  // add. Later syncs update (and reveals select) that exact copy — without it a
  // re-add after editing would duplicate the song in the library.
  musicPersistentId?: string
  // Set when a conversion registered this track in the Engine DJ library — the Engine
  // counterpart of musicPersistentId's "Surco itself added it, owned by definition",
  // so the row reads in-library before the Engine snapshot refreshes.
  engineDjAdded?: boolean
  // Set once the user trashes the source file after a real conversion, so the
  // "delete original" action disappears — the converted output and this row stay.
  originalTrashed?: boolean
}
