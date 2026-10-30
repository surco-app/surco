import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import log from 'electron-log/main'
import { errorKeyOf, errorWithKey } from '../shared/errorKeys'
import { foldAccents } from '../shared/foldAccents'
import { editsInPlace, formatMatchesInput, resolveJobFormat } from '../shared/format'
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
import { createConcurrencyLimiter } from './analysisLimiter'
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
  isEngineDjRunning?: () => Promise<boolean>
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
  // Removes an empty folder; rejects when it still holds anything.
  rmdir: (path: string) => Promise<void>
  // The folder Music copies imports into ("media-folder-url"), undefined when unreadable.
  appleMusicMediaFolder?: () => Promise<string | undefined>
  // Whether any library entry plays this file, looked up by the names it may carry.
  // Rejects when Music could not be asked.
  appleMusicHoldsFile?: (path: string, titles: string[]) => Promise<boolean>
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
  // The same file read with the "artist - name" Music shows for the entry right now.
  appleMusicEntry: (persistentId: string) => Promise<{ path: string; label: string }>
  deleteAppleMusic: (persistentId: string, expectedLabel: string) => Promise<unknown>
  // Copies the superseded entry's normal playlists, play count, rating and favorite onto
  // the one that replaces it (see replaceAppleMusicCopy).
  carryAppleMusicHistory: (
    fromPid: string,
    toPid: string,
    expectedLabel: string,
  ) => Promise<'carried' | 'missing' | 'mismatch'>
  // Renames the superseded entry for the length of the add (marked) and back, each only
  // while the entry still carries the expected label (see replaceAppleMusicCopy).
  markAppleMusicReplacing: (
    persistentId: string,
    expectedLabel: string,
    marked: boolean,
  ) => Promise<'set' | 'missing' | 'mismatch'>
  // Corrects the recorded repoint once Music has copied the file into its Media folder.
  // The conversion only knows the temp path it wrote, which no longer exists when the
  // flush runs — the collection would be told to follow a file that is already gone.
  // False when Traktor's entry stays on the source: Music landed the file in another folder.
  redirectRepoint?: (currentTo: string, landedAt: string) => boolean
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
//
// Music answers an add whose name, artist and album match an entry it already has with that
// entry, importing nothing (measured 30/10, even across formats): carrying onto it and
// deleting it took the track out of Music. So the old entry is renamed for the length of the
// add and restored right after, before the label-checked carry and delete; an add that still
// answers with the old entry changes nothing and fails the step.
async function replaceAppleMusicCopy(
  job: ProcessJob,
  target: string,
  coverPath: string | undefined,
  deps: ProcessTrackDeps,
  // Set in "Apple Music only": the entry is checked before anything else (verifyMediaCopy).
  handedOver: { tmpDir?: string } | undefined,
  old: { persistentId?: string; label: string } = {
    persistentId: job.musicPersistentId,
    label: job.replacesLabel ?? metaLabel(job),
  },
): Promise<ReplacedCopy> {
  return replaceLock.run(() => replaceUnlocked(job, target, coverPath, deps, handedOver, old))
}

interface ReplacedCopy {
  added: string
  oldCopyKept?: 'mismatch' | 'error' | 'carry'
  landed?: MediaCopy
  // The old entry's name still ends with the replacing mark.
  nameLeftMarked?: true
}

// One replacement at a time across the jobs of a batch: Music only serializes each script,
// and another job's add landing between this one's rename and restore is the window where
// Music hands back a copy other than the one being replaced.
const replaceLock = createConcurrencyLimiter(1)

async function replaceUnlocked(
  job: ProcessJob,
  target: string,
  coverPath: string | undefined,
  deps: ProcessTrackDeps,
  handedOver: { tmpDir?: string } | undefined,
  old: { persistentId?: string; label: string },
): Promise<ReplacedCopy> {
  // Stays true when the rename throws: it may have landed before the script failed, and the
  // restore only touches an entry that still carries the mark.
  let marked = false
  let added: string
  let landed: MediaCopy | undefined
  try {
    if (old.persistentId) {
      marked = true
      marked = (await deps.markAppleMusicReplacing(old.persistentId, old.label, true)) === 'set'
    }
    added = await deps.addToAppleMusic(target, job.meta, coverPath)
    if (old.persistentId && added === old.persistentId)
      throw errorWithKey('appleMusicAddReturnedOld', added)
    landed = handedOver
      ? await verifyMediaCopy(
          added,
          handedOver.tmpDir,
          target,
          job,
          deps,
          old.persistentId ? 'appleMusicNoMediaCopyKept' : 'appleMusicNoMediaCopy',
        )
      : undefined
  } catch (e) {
    // A restore that fails leaves the mark in the name, never a lost entry, but only the DJ
    // can take it off, so the failure that reaches them names it (the cause is logged).
    if (marked && !(await restoreName(old, deps))) {
      log.warn('process:track Apple Music step failed', e)
      throw errorWithKey('appleMusicNameLeftMarked', old.label)
    }
    throw e
  }
  const nameLeftMarked = marked && !(await restoreName(old, deps))
  const retired = await retireOldEntry(old, added, landed, deps)
  return nameLeftMarked ? { ...retired, nameLeftMarked: true } : retired
}

// False when Music could not be asked to take the mark off the old entry's name.
function restoreName(
  old: { persistentId?: string; label: string },
  deps: ProcessTrackDeps,
): Promise<boolean> {
  if (!old.persistentId) return Promise.resolve(true)
  return deps.markAppleMusicReplacing(old.persistentId, old.label, false).then(
    () => true,
    (e) => {
      log.warn('process:track could not restore the old Music entry name', e)
      return false
    },
  )
}

async function retireOldEntry(
  old: { persistentId?: string; label: string },
  added: string,
  landed: MediaCopy | undefined,
  deps: ProcessTrackDeps,
): Promise<ReplacedCopy> {
  if (!old.persistentId) return { added, landed }
  try {
    const carried = await deps.carryAppleMusicHistory(old.persistentId, added, old.label)
    if (carried === 'mismatch') return { added, oldCopyKept: 'mismatch', landed }
  } catch (e) {
    log.warn('process:track kept the old Music entry it could not carry over', e)
    return { added, oldCopyKept: 'carry', landed }
  }
  try {
    await deps.deleteAppleMusic(old.persistentId, old.label)
    return { added, landed }
  } catch (e) {
    return {
      added,
      oldCopyKept: String(e).includes('applemusic-delete-mismatch') ? 'mismatch' : 'error',
      landed,
    }
  }
}

// Where Music copied the file, and whether Traktor's entry could follow it there.
interface MediaCopy {
  path: string
  traktorFollowed: boolean
}

// "Apple Music only" removes the temp conversion in the finally below — safe only when
// Music COPIED the file into its Media folder. With "Copy files to the Media folder when
// adding" off, the fresh entry still references the temp path, and the cleanup would leave
// a library row that plays nothing. Verify where the entry points; a temp reference rolls
// the add back and fails the job out loud. Written straight into the Media folder there is
// no temp to check, only where the entry points for the collections to follow.
async function verifyMediaCopy(
  persistentId: string,
  tmpDir: string | undefined,
  target: string,
  job: ProcessJob,
  deps: ProcessTrackDeps,
  errorKey: 'appleMusicNoMediaCopy' | 'appleMusicNoMediaCopyKept',
): Promise<MediaCopy> {
  const entryPath = await deps.appleMusicEntryLocation(persistentId)
  if (tmpDir && entryPath.startsWith(tmpDir)) {
    await deps.deleteAppleMusic(persistentId, metaLabel(job))
    throw errorWithKey(errorKey, entryPath)
  }
  // Music copied the file out of the temp dir, so this is where it actually lives.
  // The repoint recorded during the conversion still names the temp path, which the
  // cleanup below deletes — the flush would then refuse it as output-missing and
  // leave the collection on the old file, which is what the user hit.
  const traktorFollowed = entryPath ? deps.redirectRepoint?.(target, entryPath) !== false : true
  return { path: entryPath, traktorFollowed }
}

// Music files a copy under <Media>/Music/<album artist, else artist>/<album>/. A slash or
// colon in a tag would open another folder (Finder shows "/" as ":"), so both become "_"
// the way Music writes them, and the rest follows the output name's own rules.
function musicFolder(name: string | undefined, fallback: string): string {
  return sanitizeOutputName((name ?? '').replace(/[/:]/g, '_')).normalize('NFD') || fallback
}

// A conversion written into the Media folder that Music never took: the file goes, then each
// folder made for it while it is empty (another job of the run may have filed a track there).
// An add that failed may still have imported it (the 60 s wait for the tags, a refused field,
// an Apple Event timeout), so after one the file stays when an entry plays it, or when Music
// cannot say: deleting it would leave that entry playing nothing. Its name is the job's title,
// or the file name when Music read no tags (WAV).
async function removeUnheldMediaCopy(
  file: string,
  madeFrom: string | undefined,
  addTried: boolean,
  job: ProcessJob,
  deps: ProcessTrackDeps,
): Promise<void> {
  if (addTried) {
    const titles = [job.meta.title, basename(file, extname(file))].filter(Boolean)
    const held = await (deps.appleMusicHoldsFile?.(file, titles) ?? Promise.resolve(true)).catch(
      () => true,
    )
    if (held) {
      log.warn('process:track kept the Media folder copy a Music entry may play', file)
      return
    }
  }
  try {
    await deps.rm(file, { recursive: false, force: true })
  } catch (e) {
    log.warn('process:track could not remove the copy Music never took', file, e)
    return
  }
  if (!madeFrom) return
  for (let dir = dirname(file); dir.startsWith(madeFrom); dir = dirname(dir)) {
    try {
      await deps.rmdir(dir)
    } catch {
      return
    }
  }
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
  // "Apple Music only" written straight into Music's Media folder: removed in finally,
  // along with the folders made for it, unless Music now holds it.
  let mediaTarget: string | undefined
  let mediaDirsFrom: string | undefined
  let mediaHeld = false
  let mediaAddTried = false
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
    // where Music files its own copies, or else to a private temp dir (never the output
    // folder — it can't collide with or clobber anything there), hand it over, then remove
    // the temp below.
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
    // as free, both wrote it, and the folder kept one recording of the two. The check for
    // Engine DJ being open is held here for the same reason.
    const engineDjQueued =
      addToEngineDj &&
      !!deps.isEngineDjRunning &&
      (await deps.isEngineDjRunning().catch(() => true))
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
    // Music reads no tags from a WAV at import, so its own copy of a temp file landed in
    // "Unknown Artist/Unknown Album" and tagging the entry never moved it (measured 30/10).
    // A file already inside the Media folder is added where it is, so the conversion goes
    // straight to Music's layout. Only into a folder that is there (an unmounted NAS would
    // grow a stray /Volumes folder) and onto a name nobody holds; otherwise the temp dir,
    // unique per job (via mkdtemp), which can't collide with another job and needs no
    // reservation.
    if (musicOnly) {
      const media = await deps.appleMusicMediaFolder?.().catch(() => undefined)
      const filed =
        media && deps.existsSync(media)
          ? join(
              media,
              'Music',
              musicFolder(job.meta.albumArtist || job.meta.artist, 'Unknown Artist'),
              musicFolder(job.meta.album, 'Unknown Album'),
              basename(outputPath),
            )
          : undefined
      if (filed && !deps.existsSync(filed) && !deps.isPathReserved(filed)) {
        mediaTarget = filed
        target = filed
      } else {
        tmpDir = await deps.mkdtemp(join(tmpdir(), 'surco-'))
        target = join(tmpDir, basename(outputPath))
      }
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
    if (!musicOnly || mediaTarget) {
      deps.reservePath(target)
      reserved = target
    }

    // Create the target's folder (and any subfolders the file-name template asks for)
    // before writing; recursive so it's a no-op when the directory already exists.
    const madeFrom = await deps.mkdir(dirname(target), { recursive: true })
    if (mediaTarget && typeof madeFrom === 'string') mediaDirsFrom = madeFrom
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
    const retireOriginal = (): Promise<void> =>
      deps.removeRenamedOriginal(job.inputPath, target).catch((e) => {
        log.warn('process:track kept the original it could not retire', job.inputPath, e)
        originalKept = true
      })
    // The Music entry that plays the original is replaced below, and until then the original
    // is the file it plays: retired first, a replacement that failed or kept the old entry
    // left that entry playing a file that was gone. So it waits for the replacement.
    const replacesOwnEntry = !!existingMusicEntry && inPlace && !outputIsInput
    if (inPlace && !replacesOwnEntry) await retireOriginal()
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
    let supersededPath: string | undefined
    let musicLandedPath: string | undefined
    let appleMusicFailed: true | undefined
    let musicNameLeftMarked: true | undefined
    // The file in the Media folder is Music's once an add answers with an entry of its own;
    // one that answers with the entry being replaced imported nothing (see replaceAppleMusicCopy).
    const musicDeps: ProcessTrackDeps = mediaTarget
      ? {
          ...deps,
          addToAppleMusic: async (file, meta, cover) => {
            mediaAddTried = true
            const pid = await deps.addToAppleMusic(file, meta, cover)
            if (pid !== job.musicPersistentId && pid !== existingMusicEntry?.persistentId)
              mediaHeld = true
            return pid
          },
        }
      : deps
    const handedOver = musicOnly ? { tmpDir } : undefined
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
          const replaced = await replaceAppleMusicCopy(
            job,
            target,
            coverPath,
            musicDeps,
            handedOver,
          )
          musicPersistentId = replaced.added
          oldMusicCopyKept = replaced.oldCopyKept
          musicNameLeftMarked = replaced.nameLeftMarked
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
            musicDeps,
            handedOver,
            existingMusicEntry,
          )
          musicPersistentId = replaced.added
          oldMusicCopyKept = replaced.oldCopyKept
          musicNameLeftMarked = replaced.nameLeftMarked
          verified = true
        } else {
          // An entry in another format than the output can't be retagged into it: Music
          // keeps playing the old file. Compared by format, not path, since the file
          // written (a temp, or the output Music copies from) is never the entry's own.
          // Retired under the name Music shows: the job's tags may be edited or matched.
          // Only an entry that is gone falls back to update ?? add; a read that fails is a
          // failed Apple Music step, never a silent re-tag of the old file.
          const entry = job.musicPersistentId
            ? await deps.appleMusicEntry(job.musicPersistentId)
            : undefined
          if (entry?.path && !formatMatchesInput(format, entry.path)) {
            const replaced = await replaceAppleMusicCopy(
              job,
              target,
              coverPath,
              musicDeps,
              handedOver,
              {
                persistentId: job.musicPersistentId,
                label: entry.label,
              },
            )
            musicPersistentId = replaced.added
            oldMusicCopyKept = replaced.oldCopyKept
            musicNameLeftMarked = replaced.nameLeftMarked
            const isSource = entry.path.normalize('NFC') === job.inputPath.normalize('NFC')
            // The row was the file Music played, so it follows the entry to its new file.
            if (isSource && replaced.landed?.path) musicLandedPath = replaced.landed.path
            // Not offered when the in-place rename already retired it, or when Traktor's
            // entry is still on it.
            if (
              !replaced.oldCopyKept &&
              !(isSource && inPlace && !originalKept) &&
              replaced.landed?.traktorFollowed !== false
            )
              supersededPath = entry.path
            verified = true
          } else {
            musicPersistentId = job.musicPersistentId
              ? ((await deps.updateInAppleMusic(job.musicPersistentId, job.meta, coverPath)) ??
                (await musicDeps.addToAppleMusic(target, job.meta, coverPath)))
              : await musicDeps.addToAppleMusic(target, job.meta, coverPath)
          }
        }
        if (musicOnly && musicPersistentId && !verified)
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
        if (errorKeyOf(e instanceof Error ? e.message : '') === 'appleMusicNameLeftMarked')
          musicNameLeftMarked = true
        musicPersistentId = undefined
        appleMusicFailed = true
      }
    }

    if (replacesOwnEntry) {
      if (appleMusicFailed || oldMusicCopyKept) originalKept = true
      else await retireOriginal()
    }

    // Adding to Engine DJ points a library row at the file just written; a failed
    // registration fails the job — never a silent "converted but not in the library".
    // Returned rather than thrown: the file has landed and the original may be retired,
    // and an IPC error carries only its message, so a throw left the row on a path that
    // no longer exists and a staged trim set to cut the already cut file again.
    let addedToEngineDj: true | undefined
    let engineDjError: string | undefined
    if (addToEngineDj && !engineDjQueued) {
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
    if (supersededPath) deps.allowMedia(supersededPath)
    if (musicLandedPath) deps.allowMedia(musicLandedPath)
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
        supersededPath,
        musicLandedPath,
        originalKept,
        musicNameLeftMarked,
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
      ...(engineDjQueued ? { engineDjQueued: true as const } : {}),
      outputIdentity,
      oldMusicCopyKept,
      supersededPath,
      appleMusicFailed,
      originalKept,
      musicNameLeftMarked,
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
    if (mediaTarget && !mediaHeld)
      await removeUnheldMediaCopy(mediaTarget, mediaDirsFrom, mediaAddTried, job, deps)
    if (reserved) deps.releasePath(reserved)
  }
}
