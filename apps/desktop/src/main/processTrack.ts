import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import log from 'electron-log/main'
import { errorWithKey } from '../shared/errorKeys'
import { foldAccents } from '../shared/foldAccents'
import { editsInPlace, resolveJobFormat } from '../shared/format'
import type {
  DeclickConfig,
  LibraryPlaylistChoice,
  NormalizeConfig,
  OutputFormat,
  ProcessJob,
  ProcessResult,
  ProcessStage,
  RekordboxPlaylistTarget,
  Settings,
  TrackMetadata,
  TrimRange,
} from '../shared/types'
import { isAppleMusicOnly, shouldAddToAppleMusic } from './applemusic'
import type { CoverSource, PreparedCover } from './cover'
import {
  isOutputConflict,
  resolveOutputTarget,
  sanitizeOutputName,
  uniqueOutputPath,
} from './inplace'

// The conversion workflow, lifted out of the process:track IPC handler so it can be
// unit-tested without booting Electron. Every collaborator that touches Electron, the
// filesystem, the network or a child process arrives through deps; the pure decisions
// (output target, conflict, Apple Music gating) stay here where the tests reach them.
// The handler is left a thin adapter that wires the real implementations in.
export interface ProcessTrackDeps {
  settings: Settings
  platform: NodeJS.Platform
  // Emits a progress stage to the renderer for this job.
  sendProgress: (stage: ProcessStage) => void
  hasCoverSource: (job: CoverSource) => boolean
  prepareProcessedCover: (
    src: CoverSource,
    opts: { maxSize: number; square: boolean; upscale: boolean },
  ) => Promise<PreparedCover | undefined>
  convertAudio: (
    input: string,
    output: string,
    format: OutputFormat,
    meta: TrackMetadata,
    coverPath?: string,
    normalize?: NormalizeConfig,
    removeCover?: boolean,
    onChild?: (child: { kill: (signal: string) => void }) => void,
    onTmp?: (path: string) => void,
    declick?: DeclickConfig,
    trim?: TrimRange,
    clearExtras?: boolean,
    foreignRemoved?: string[],
    replacesPath?: string,
    keepOverwritten?: boolean,
  ) => Promise<{ normalizeSkipped: boolean; declickedSamples?: number }>
  // Lets a cancel reach the encode already in flight for this job, not just ones
  // not yet started. Registered around the convertAudio call and unregistered in
  // finally so a cancel after the job settles is a no-op.
  registerActiveConversion: (jobId: string, kill: (signal: string) => void) => void
  unregisterActiveConversion: (jobId: string) => void
  // Brackets the whole job for the close guard, which asks "is work in flight?" — a
  // question registerActiveConversion cannot answer, since the stream-copy shortcut
  // spawns no child and so never registers one. Bracketed around everything below,
  // released in finally however the job ends.
  beginJob: (jobId: string) => void
  endJob: (jobId: string) => void
  // The trail a crash or force-quit mid-encode leaves for the next launch to
  // sweep — trackTmp fires the instant convertAudio picks its temp path, untrackTmp
  // once the job settles normally (convertAudio's own catch already deleted the
  // file by then, so this just keeps the manifest honest).
  trackTmp: (path: string) => void
  untrackTmp: (path: string) => void
  recordConversion: () => void
  removeRenamedOriginal: (inputPath: string, target: string) => Promise<void>
  addToAppleMusic: (target: string, meta: TrackMetadata, coverPath?: string) => Promise<string>
  updateInAppleMusic: (
    persistentId: string,
    meta: TrackMetadata,
    coverPath?: string,
  ) => Promise<string | null>
  findAppleMusicEntry?: (
    path: string,
    meta: TrackMetadata,
  ) => Promise<{ persistentId: string; label: string } | undefined>
  // Registers the written file in the user's Engine DJ library database, storing the
  // cover (when there is one) as the row's artwork.
  // `replaces` is the file this conversion supersedes (the replaced Apple Music copy, else
  // the source), whose library row the add may move onto the new file.
  addToEngineDj: (
    target: string,
    meta: TrackMetadata,
    coverPath: string | undefined,
    replaces: string,
  ) => Promise<void>
  ensureEngineDjClosed?: () => Promise<boolean>
  isAllowed?: (path: string) => boolean
  // Marks a written file as streamable through surco://.
  allowMedia: (path: string) => void
  attachRekordboxPlaylists?: (
    to: string,
    playlists: RekordboxPlaylistTarget[],
    playlistsBase?: string[],
  ) => void
  attachLibraryPlaylists?: (
    to: string,
    library: 'traktor' | 'engine',
    choice: LibraryPlaylistChoice,
  ) => void
  existsSync: (path: string) => boolean
  // Device+inode identity, so an in-place edit can tell "the target is the source
  // being rewritten" (fine) from "the target is an unrelated file" (a collision).
  isSameFile: (a: string, b: string) => Promise<boolean>
  fileIdentity: (path: string) => Promise<string | undefined>
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<unknown>
  mkdtemp: (prefix: string) => Promise<string>
  rm: (path: string, opts: { recursive: boolean; force: boolean }) => Promise<void>
  // Shown only on a real output collision; returns the user's choice. Encapsulates the
  // Electron message box so the branches below stay unit-testable.
  // reservedOnly: nothing is on disk under that name yet, only another job's claim on it.
  confirmConflict: (
    outputName: string,
    reservedOnly: boolean,
  ) => Promise<'overwrite' | 'keepBoth' | 'skip'>
  // Closes the race a concurrent batch opens: two jobs resolving to the same output
  // name both see existsSync() === false until one of them finishes writing, so a
  // path claimed by an in-flight job counts as taken even before it exists on disk.
  isPathReserved: (path: string) => boolean
  reservePath: (path: string) => void
  releasePath: (path: string) => void
  // Where a fresh library entry's file lives, and the rollback for an add that must
  // not stand — both only exercised by the "Apple Music only" copy verification below.
  appleMusicEntryLocation: (persistentId: string) => Promise<string>
  deleteAppleMusic: (persistentId: string, expectedLabel: string) => Promise<unknown>
  // Copies the superseded entry's normal playlists, play count, rating and favorite onto
  // the one that replaces it (see replaceAppleMusicCopy).
  carryAppleMusicHistory: (
    fromPid: string,
    toPid: string,
    expectedLabel: string,
  ) => Promise<'carried' | 'missing' | 'mismatch'>
  // Corrects the recorded repoint once Music has copied the file into its Media folder.
  // The conversion only knows the temp path it wrote, which no longer exists when the
  // flush runs — the collection would be told to follow a file that is already gone.
  redirectRepoint?: (currentTo: string, landedAt: string) => void
}

// Imports the converted file and retires the copy it supersedes, returning the new
// entry's id so the rest of the job (and rekordbox) follows the file that now exists.
//
// Deleting the old entry would take with it what the DJ built on it, so in between its
// normal playlists, play count, played date, rating and favorite are copied onto the new
// one. The new entry goes to the END of each playlist: Music offers no way to insert at a
// position. Smart playlists are left alone, Music answers -54 to any attempt to put a
// track in one, and the successor carries the same grouping, genre and year, so their
// rules pick it up on their own. rekordbox needs no help either: its playlists link by
// track ID and the repoint rewrites the existing row's path, so the ID, its crates and
// its cues all survive untouched.
//
// Add first and delete last, so an add that fails destroys nothing. In "Apple Music only"
// the new entry is checked before anything else (see verifyMediaCopy): one left on the temp
// file is rolled back while the old entry is still whole. A copy that fails or is refused
// keeps the old entry: two copies in Music, nothing lost, and the DJ is told.
// Deleting removes the library row only, never the file: the superseded MP3 stays on disk
// for the user's own "trash original" to decide. A delete that fails after the add leaves
// a duplicate, not a failed conversion: the file is already converted and in Music.
async function replaceAppleMusicCopy(
  job: ProcessJob,
  target: string,
  coverPath: string | undefined,
  deps: ProcessTrackDeps,
  tmpDir: string | undefined,
  old: { persistentId?: string; label: string } = {
    persistentId: job.musicPersistentId,
    label: job.replacesLabel ?? metaLabel(job),
  },
): Promise<{ added: string; oldCopyKept?: 'mismatch' | 'error' | 'carry' }> {
  const added = await deps.addToAppleMusic(target, job.meta, coverPath)
  if (tmpDir)
    await verifyMediaCopy(
      added,
      tmpDir,
      target,
      job,
      deps,
      old.persistentId ? 'appleMusicNoMediaCopyKept' : 'appleMusicNoMediaCopy',
    )
  if (!old.persistentId) return { added }
  try {
    const carried = await deps.carryAppleMusicHistory(old.persistentId, added, old.label)
    if (carried === 'mismatch') return { added, oldCopyKept: 'mismatch' }
  } catch (e) {
    log.warn('process:track kept the old Music entry it could not carry over', e)
    return { added, oldCopyKept: 'carry' }
  }
  try {
    await deps.deleteAppleMusic(old.persistentId, old.label)
    return { added }
  } catch (e) {
    return {
      added,
      oldCopyKept: String(e).includes('applemusic-delete-mismatch') ? 'mismatch' : 'error',
    }
  }
}

// "Apple Music only" removes the temp conversion in the finally below — safe only when
// Music COPIED the file into its Media folder. With "Copy files to the Media folder when
// adding" off, the fresh entry still references the temp path, and the cleanup would leave
// a library row that plays nothing. Verify where the entry points; a temp reference rolls
// the add back and fails the job out loud.
async function verifyMediaCopy(
  persistentId: string,
  tmpDir: string,
  target: string,
  job: ProcessJob,
  deps: ProcessTrackDeps,
  errorKey: 'appleMusicNoMediaCopy' | 'appleMusicNoMediaCopyKept',
): Promise<void> {
  const entryPath = await deps.appleMusicEntryLocation(persistentId)
  if (entryPath.startsWith(tmpDir)) {
    await deps.deleteAppleMusic(persistentId, metaLabel(job))
    throw errorWithKey(errorKey, entryPath)
  }
  // Music copied the file out of the temp dir, so this is where it actually lives.
  // The repoint recorded during the conversion still names the temp path, which the
  // cleanup below deletes — the flush would then refuse it as output-missing and
  // leave the collection on the old file, which is what the user hit.
  if (entryPath) deps.redirectRepoint?.(target, entryPath)
}

function metaLabel(job: ProcessJob): string {
  return `${job.meta.artist} - ${job.meta.title}`
}

export async function runProcessTrack(
  job: ProcessJob,
  deps: ProcessTrackDeps,
): Promise<ProcessResult> {
  // Before any side effect: metadata that never came from the file (see ProcessJob.metaUnread)
  // would be written empty over whatever the file still carries.
  if (job.metaUnread) throw errorWithKey('sourceTagsUnread', job.inputPath)
  const { settings } = deps
  const stage = (s: ProcessStage): void => deps.sendProgress(s)
  if (deps.isAllowed && !deps.isAllowed(job.inputPath)) throw errorWithKey('pathNotAllowed')

  let prepared: PreparedCover | undefined
  // Set only in "Apple Music only" mode (see below); cleaned up in finally so a failed
  // Apple Music add never leaves the temp conversion behind.
  let tmpDir: string | undefined
  // The path reserved via deps.reservePath, if any — released in finally regardless
  // of how the job ends.
  let reserved: string | undefined
  deps.beginJob(job.id)
  try {
    if (deps.hasCoverSource(job)) {
      stage('cover')
      prepared = await deps.prepareProcessedCover(job, {
        maxSize: settings.coverMaxSize,
        square: settings.coverSquare,
        upscale: settings.coverUpscale,
      })
    }
    const coverPath = prepared?.path

    stage('converting')
    // job.format is always set by the renderer's job builder; this fallback only
    // guards the type, since settings.outputFormat may be 'source' and 'source' must
    // never reach the conversion pipeline.
    const format =
      job.format ??
      resolveJobFormat(settings.outputFormat, job.inputPath, 'aiff', settings.keepMp3Sources)
    // Every destination facet prefers the job's pin over the live setting (see the
    // ProcessJob comments): the editor's one-shot destination pick and the batch pin
    // both ride the job, so a Settings change can't redirect a conversion in flight.
    const addToAppleMusic = job.addToAppleMusic ?? settings.addToAppleMusic
    const keepOutputCopy = job.keepOutputCopy ?? settings.keepOutputCopy
    const addToEngineDj = settings.addToEngineDj
    const besideOriginal =
      (job.convertBesideOriginal ?? settings.convertBesideOriginal ?? false) &&
      !(job.overwriteOriginal ?? settings.overwriteOriginal)
    // macOS writes file names decomposed (NFD): Finder does, and an SMB NAS hands them
    // back that way. The name built from the tags is composed (NFC), and on such a NAS
    // the two spellings are different files: the rename over the source failed with
    // EEXIST or -83, and a temp named in NFC could not be found again to rename or
    // delete. APFS treats both as one name, so this changes nothing on a local disk.
    //
    // A name the source already has is kept untouched only when the write lands in the
    // source's own folder, the disk known to hold it: the output folder can be the very
    // disk the plain spelling is for. Its accents are kept only when the file itself keeps
    // the name (in place); a new file beside it is spelled the way the setting asks.
    const overwriteOriginal = job.overwriteOriginal ?? settings.overwriteOriginal
    const inPlaceWrite = !besideOriginal && editsInPlace(format, job.inputPath, overwriteOriginal)
    const currentName =
      besideOriginal || inPlaceWrite ? basename(job.inputPath, extname(job.inputPath)) : undefined
    const keepsName =
      inPlaceWrite && currentName?.normalize('NFC') === job.outputName.normalize('NFC')
    const outputName = sanitizeOutputName(
      settings.asciiFileNames && !keepsName ? foldAccents(job.outputName) : job.outputName,
      currentName,
    )
    const resolved = resolveOutputTarget(
      job.inputPath,
      deps.platform === 'darwin' ? outputName.normalize('NFD') : outputName,
      format,
      settings.outputDir,
      overwriteOriginal,
      besideOriginal,
    )
    const outputPath = resolved.outputPath
    let inPlace = resolved.inPlace
    // "Apple Music only": the user wants the track in Apple Music and no copy left in
    // the output folder. Apple Music still imports a real path, so write the conversion
    // to a private temp dir (never the output folder — it can't collide with or clobber
    // anything there), hand it over, then remove it below.
    const musicOnly = isAppleMusicOnly(
      addToAppleMusic,
      keepOutputCopy,
      addToEngineDj,
      deps.platform,
      format,
      inPlace,
    )
    let target = outputPath
    const existingMusicEntry =
      inPlace &&
      !job.musicPersistentId &&
      !job.replacesPath &&
      shouldAddToAppleMusic(addToAppleMusic, deps.platform, format)
        ? await deps.findAppleMusicEntry?.(job.inputPath, job.meta).catch(() => undefined)
        : undefined
    // Awaited before the conflict check reads the disk and the sibling claims, as the
    // beside branch does: with the wait between that read and reservePath, two in-place
    // jobs of one run (Song.flac and Song.wav, both becoming Song.aiff) each read the name
    // as free, both wrote it, and the folder kept one recording of the two. The wait for
    // Engine DJ to close is held here for the same reason.
    if (addToEngineDj && deps.ensureEngineDjClosed && !(await deps.ensureEngineDjClosed()))
      throw errorWithKey('engineDjOpen')
    // The previous output only counts as this track's own while it is still the file this
    // track wrote: another track can have been written over that path since.
    const ownPrevious =
      job.previousOutputPath &&
      job.previousOutputIdentity &&
      (await deps.fileIdentity(job.previousOutputPath)) === job.previousOutputIdentity
        ? job.previousOutputPath
        : undefined
    let keepOverwritten = false
    const outputIsInput =
      !musicOnly && !besideOriginal && inPlace && (await deps.isSameFile(job.inputPath, outputPath))
    // musicOnly writes to a private tmpDir unique per job (via mkdtemp below), so it
    // can't collide with another job and needs no reservation.
    if (musicOnly) {
      tmpDir = await deps.mkdtemp(join(tmpdir(), 'surco-'))
      target = join(tmpDir, basename(outputPath))
    } else if (besideOriginal) {
      // The mode's whole contract is "never touch an existing file", so a collision is
      // resolved silently with the same "(n)" suffix keep-both uses — prompting would
      // defeat the promise, overwriting would break it. Two exceptions shape `taken`:
      // the track's own previous copy stays overwritable (a re-export must land back
      // on its "(2)" instead of piling up "(3)", "(4)"…), and the source file is never
      // a valid target — not even via a stale previousOutputPath pointing at it after
      // a mode switch from overwrite.
      const taken = (p: string): boolean =>
        deps.isPathReserved(p) || (p !== ownPrevious && deps.existsSync(p))
      if ((await deps.isSameFile(job.inputPath, outputPath)) || taken(outputPath)) {
        target = uniqueOutputPath(outputPath, (p) => p === job.inputPath || taken(p))
      }
    } else if (
      isOutputConflict(
        outputPath,
        ownPrevious,
        deps.existsSync(outputPath) || deps.isPathReserved(outputPath),
        outputIsInput,
        deps.isPathReserved(outputPath),
      )
    ) {
      const choice = await deps.confirmConflict(basename(outputPath), !deps.existsSync(outputPath))
      if (choice === 'skip') return { outputPath: '', inPlace, skipped: true }
      // Stepping aside to a "(n)" name means the conversion no longer lands on the
      // source's own path, so this stopped being an in-place export: leaving inPlace
      // set would have removeRenamedOriginal unlink a source the user asked to keep.
      // besideOriginal makes the same promise the same way (see resolveOutputTarget).
      if (choice === 'keepBoth') {
        target = uniqueOutputPath(outputPath, (p) => deps.existsSync(p) || deps.isPathReserved(p))
        inPlace = false
      }
      // "Overwrite" is a decision about the file the user can see in the destination
      // folder. A reservation is not that file: it is a path another job in this same
      // run claimed and has not written yet, so there is nothing there to replace.
      // Overwriting it would aim both jobs at one destination and the second rename
      // would land on the first — a track silently lost from a run that still counts
      // it converted. The same holds when the file IS on disk but a sibling job already
      // claimed it: that job overwrites it, and a second overwrite would land on the
      // first. Step aside the way keep-both does; the file the user meant to overwrite
      // (if any) is still overwritten by whichever job owns that path. Read after the
      // prompt, since a sibling may have claimed the path while this one waited on it.
      else if (
        choice === 'overwrite' &&
        (!deps.existsSync(outputPath) || deps.isPathReserved(outputPath))
      ) {
        target = uniqueOutputPath(outputPath, (p) => deps.existsSync(p) || deps.isPathReserved(p))
        inPlace = false
      } else if (choice === 'overwrite') keepOverwritten = true
    }
    // Claimed for the rest of the job — including the convertAudio write, which is
    // exactly the window existsSync can't see yet (temp file + rename). Released in
    // finally so a thrown error still frees it for the next job or retry.
    if (!musicOnly) {
      deps.reservePath(target)
      reserved = target
    }

    // Create the target's folder (and any subfolders the file-name template asks for)
    // before writing; recursive so it's a no-op when the directory already exists.
    await deps.mkdir(dirname(target), { recursive: true })
    let normalizeSkipped: boolean
    let declickedSamples: number | undefined
    let tmpPath: string | undefined
    try {
      ;({ normalizeSkipped, declickedSamples } = await deps.convertAudio(
        job.inputPath,
        target,
        format,
        job.meta,
        coverPath,
        job.normalize ?? settings.normalize,
        job.removeCover,
        (child) => deps.registerActiveConversion(job.id, (signal) => child.kill(signal)),
        (path) => {
          tmpPath = path
          deps.trackTmp(path)
        },
        job.declick ?? settings.declick,
        job.trim,
        job.clearExtras,
        job.foreignRemoved,
        job.replacesPath,
        keepOverwritten,
      ))
    } catch (e) {
      // convertAudio deletes the temp on failure and says so when it couldn't: that is
      // the one case where the path must STAY listed, because the file is still on disk
      // and the manifest is the only thing that will ever lead a sweep back to it.
      // Untracking it here — which is what used to happen unconditionally — orphaned a
      // half-written file in the user's own folder, most likely on a network volume
      // where the delete is the operation that fails.
      if (tmpPath && !(e as { tmpSurvived?: boolean })?.tmpSurvived) deps.untrackTmp(tmpPath)
      tmpPath = undefined
      throw e
    } finally {
      deps.unregisterActiveConversion(job.id)
      // The success path: convertAudio renamed the temp into place, so nothing is left
      // to sweep and the manifest entry is stale.
      if (tmpPath) deps.untrackTmp(tmpPath)
    }
    const outputIdentity = musicOnly ? undefined : await deps.fileIdentity(target)
    if (job.rekordboxPlaylists)
      deps.attachRekordboxPlaylists?.(target, job.rekordboxPlaylists, job.rekordboxPlaylistsBase)
    if (job.traktorPlaylists)
      deps.attachLibraryPlaylists?.(target, 'traktor', {
        wanted: job.traktorPlaylists,
        base: job.traktorPlaylistsBase ?? [],
      })
    if (job.enginePlaylists)
      deps.attachLibraryPlaylists?.(target, 'engine', {
        wanted: job.enginePlaylists,
        base: job.enginePlaylistsBase ?? [],
      })
    // The new file has landed by now, so failing to retire the old one (a Windows lock
    // on the unlink that ends a copy into the trash) must not fail the job: the user
    // keeps both files and is told so.
    let originalKept: true | undefined
    if (inPlace)
      await deps.removeRenamedOriginal(job.inputPath, target).catch((e) => {
        log.warn('process:track kept the original it could not retire', job.inputPath, e)
        originalKept = true
      })
    // The file has landed and the original may be gone: a stats write that fails (a locked
    // or synced settings file) must not turn a finished conversion into a failed one.
    try {
      deps.recordConversion()
    } catch (e) {
      log.warn('process:track could not record the conversion stats', e)
    }

    // A track that already has a library copy (musicPersistentId from a previous
    // add) gets its metadata and artwork synced onto that copy instead of being
    // imported again — re-converting an edited track must never duplicate it in
    // Music. Only when the user deleted the copy from the library does the fresh
    // file get imported, which also re-establishes the persistent ID.
    let musicPersistentId: string | undefined
    let oldMusicCopyKept: ProcessResult['oldMusicCopyKept']
    let appleMusicFailed: true | undefined
    if (shouldAddToAppleMusic(addToAppleMusic, deps.platform, format)) {
      stage('appleMusic')
      try {
        // Replacing a DIFFERENT file, not re-converting our own earlier output. Updating an
        // entry only rewrites its tags — Music offers no way to repoint one at another file
        // — so the upgrade reported 14/09 left the library on the MP3 while claiming
        // success. The new file therefore has to be imported and the old entry retired.
        //
        // Add first and delete last: a failing add then destroys nothing. In between, the
        // old entry's normal playlists, play count and rating move to the new one (see
        // replaceAppleMusicCopy); its position inside each playlist does not.
        let verified = false
        if (job.replacesPath) {
          const replaced = await replaceAppleMusicCopy(job, target, coverPath, deps, tmpDir)
          musicPersistentId = replaced.added
          oldMusicCopyKept = replaced.oldCopyKept
          verified = true
        } else if (existingMusicEntry && inPlace && outputIsInput) {
          musicPersistentId =
            (await deps.updateInAppleMusic(existingMusicEntry.persistentId, job.meta, coverPath)) ??
            (await deps.addToAppleMusic(target, job.meta, coverPath))
        } else if (existingMusicEntry && inPlace) {
          const replaced = await replaceAppleMusicCopy(
            job,
            target,
            coverPath,
            deps,
            tmpDir,
            existingMusicEntry,
          )
          musicPersistentId = replaced.added
          oldMusicCopyKept = replaced.oldCopyKept
          verified = true
        } else {
          musicPersistentId = job.musicPersistentId
            ? ((await deps.updateInAppleMusic(job.musicPersistentId, job.meta, coverPath)) ??
              (await deps.addToAppleMusic(target, job.meta, coverPath)))
            : await deps.addToAppleMusic(target, job.meta, coverPath)
        }
        if (tmpDir && musicPersistentId && !verified)
          await verifyMediaCopy(
            musicPersistentId,
            tmpDir,
            target,
            job,
            deps,
            'appleMusicNoMediaCopy',
          )
      } catch (e) {
        if (musicOnly) throw e
        log.warn('process:track Apple Music step failed after the file was written', target, e)
        musicPersistentId = undefined
        appleMusicFailed = true
      }
    }

    // The Engine DJ destination points a library row at the file just written; a failed
    // registration fails the job — never a silent "converted but not in the library".
    // Returned rather than thrown: the file has landed and the original may be retired,
    // and an IPC error carries only its message, so a throw left the row on a path that
    // no longer exists and a staged trim set to cut the already cut file again.
    let addedToEngineDj: true | undefined
    let engineDjError: string | undefined
    if (addToEngineDj) {
      stage('engineDj')
      // Engine renders artwork from its own database, never from the file's tags, so
      // the row needs the image handed over: the job's processed cover when there is
      // one, else the art embedded in the file just written (carried over from the
      // source). Extraction failing (an artless file) must not block the add.
      let extracted: PreparedCover | undefined
      if (!coverPath) {
        extracted = await deps
          .prepareProcessedCover(
            { coverFromFile: target },
            {
              maxSize: settings.coverMaxSize,
              square: settings.coverSquare,
              upscale: settings.coverUpscale,
            },
          )
          .catch(() => undefined)
      }
      try {
        await deps.addToEngineDj(
          target,
          job.meta,
          coverPath ?? extracted?.path,
          job.replacesPath ?? job.inputPath,
        )
        addedToEngineDj = true
      } catch (e) {
        log.warn('process:track Engine DJ step failed after the file was written', target, e)
        engineDjError = e instanceof Error ? e.message : String(e)
      } finally {
        if (extracted) await extracted.cleanup()
      }
    }

    // The copy this replacement superseded, so the renderer can offer to trash it: the
    // shell guard rejects any path it was never handed, and this one lives in the user's
    // library folder, which a convert has no other reason to authorise.
    if (job.replacesPath) deps.allowMedia(job.replacesPath)
    // The add succeeded (a failure would have thrown above), and the temp dir is
    // cleaned up in finally — tell the renderer there is no file to reveal, only an
    // Apple Music entry.
    if (musicOnly)
      return {
        outputPath: '',
        inPlace,
        addedToMusicOnly: true,
        musicPersistentId,
        normalizeSkipped,
        declickedSamples,
        oldMusicCopyKept,
        originalKept,
      }

    // The conversion wrote a real file the renderer may play next — directly, or
    // as the track's new source after an in-place rename — so let surco:// serve it.
    deps.allowMedia(target)
    return {
      outputPath: target,
      inPlace,
      musicPersistentId,
      normalizeSkipped,
      declickedSamples,
      addedToEngineDj,
      engineDjError,
      outputIdentity,
      oldMusicCopyKept,
      appleMusicFailed,
      originalKept,
    }
  } catch (e) {
    // The toast is all the user sees and it is gone once dismissed; the log is what a
    // report attaches ("Send feedback" reads its error lines), so the failure goes there.
    log.error('process:track failed', job.inputPath, e)
    throw e
  } finally {
    deps.endJob(job.id)
    if (prepared) await prepared.cleanup()
    if (tmpDir) await deps.rm(tmpDir, { recursive: true, force: true })
    if (reserved) deps.releasePath(reserved)
  }
}
