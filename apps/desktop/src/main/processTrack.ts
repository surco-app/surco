import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type {
  NormalizeConfig,
  OutputFormat,
  ProcessJob,
  ProcessResult,
  ProcessStage,
  Settings,
  TrackMetadata,
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
    forceReencode?: boolean,
    onChild?: (child: { kill: (signal: string) => void }) => void,
    onTmp?: (path: string) => void,
  ) => Promise<{ normalizeSkipped: boolean }>
  // Lets a cancel reach the encode already in flight for this job, not just ones
  // not yet started. Registered around the convertAudio call and unregistered in
  // finally so a cancel after the job settles is a no-op.
  registerActiveConversion: (jobId: string, kill: (signal: string) => void) => void
  unregisterActiveConversion: (jobId: string) => void
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
  // Registers the written file in the user's Engine DJ library database, storing the
  // cover (when there is one) as the row's artwork.
  addToEngineDj: (target: string, meta: TrackMetadata, coverPath?: string) => Promise<void>
  // Marks a written file as streamable through surco://.
  allowMedia: (path: string) => void
  existsSync: (path: string) => boolean
  // Device+inode identity, so an in-place edit can tell "the target is the source
  // being rewritten" (fine) from "the target is an unrelated file" (a collision).
  isSameFile: (a: string, b: string) => Promise<boolean>
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<unknown>
  mkdtemp: (prefix: string) => Promise<string>
  rm: (path: string, opts: { recursive: boolean; force: boolean }) => Promise<void>
  // Shown only on a real output collision; returns the user's choice. Encapsulates the
  // Electron message box so the branches below stay unit-testable.
  confirmConflict: (outputName: string) => Promise<'overwrite' | 'keepBoth' | 'skip'>
  // Closes the race a concurrent batch opens: two jobs resolving to the same output
  // name both see existsSync() === false until one of them finishes writing, so a
  // path claimed by an in-flight job counts as taken even before it exists on disk.
  isPathReserved: (path: string) => boolean
  reservePath: (path: string) => void
  releasePath: (path: string) => void
  // Where a fresh library entry's file lives, and the rollback for an add that must
  // not stand — both only exercised by the "Apple Music only" copy verification below.
  appleMusicEntryLocation: (persistentId: string) => Promise<string>
  deleteAppleMusic: (persistentId: string) => Promise<unknown>
}

export async function runProcessTrack(
  job: ProcessJob,
  deps: ProcessTrackDeps,
): Promise<ProcessResult> {
  const { settings } = deps
  const stage = (s: ProcessStage): void => deps.sendProgress(s)

  let prepared: PreparedCover | undefined
  // Set only in "Apple Music only" mode (see below); cleaned up in finally so a failed
  // Apple Music add never leaves the temp conversion behind.
  let tmpDir: string | undefined
  // The path reserved via deps.reservePath, if any — released in finally regardless
  // of how the job ends.
  let reserved: string | undefined
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
    const format = job.format ?? settings.outputFormat
    const besideOriginal =
      (settings.convertBesideOriginal ?? false) && !(job.overwriteOriginal ?? settings.overwriteOriginal)
    const { outputPath, inPlace } = resolveOutputTarget(
      job.inputPath,
      sanitizeOutputName(job.outputName),
      format,
      settings.outputDir,
      job.overwriteOriginal ?? settings.overwriteOriginal,
      job.forceReencode ?? false,
      besideOriginal,
    )
    // "Apple Music only": the user wants the track in Apple Music and no copy left in
    // the output folder. Apple Music still imports a real path, so write the conversion
    // to a private temp dir (never the output folder — it can't collide with or clobber
    // anything there), hand it over, then remove it below.
    const musicOnly = isAppleMusicOnly(
      settings.addToAppleMusic,
      settings.keepOutputCopy,
      deps.platform,
      format,
      inPlace,
    )
    let target = outputPath
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
        p !== job.previousOutputPath && (deps.existsSync(p) || deps.isPathReserved(p))
      if ((await deps.isSameFile(job.inputPath, outputPath)) || taken(outputPath)) {
        target = uniqueOutputPath(outputPath, (p) => p === job.inputPath || taken(p))
      }
    } else if (
      isOutputConflict(
        outputPath,
        job.previousOutputPath,
        deps.existsSync(outputPath) || deps.isPathReserved(outputPath),
        inPlace && (await deps.isSameFile(job.inputPath, outputPath)),
      )
    ) {
      const choice = await deps.confirmConflict(basename(outputPath))
      if (choice === 'skip') return { outputPath: '', inPlace, skipped: true }
      if (choice === 'keepBoth')
        target = uniqueOutputPath(
          outputPath,
          (p) => deps.existsSync(p) || deps.isPathReserved(p),
        )
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
    let tmpPath: string | undefined
    try {
      ;({ normalizeSkipped } = await deps.convertAudio(
        job.inputPath,
        target,
        format,
        job.meta,
        coverPath,
        job.normalize ?? settings.normalize,
        job.removeCover,
        job.forceReencode,
        (child) => deps.registerActiveConversion(job.id, (signal) => child.kill(signal)),
        (path) => {
          tmpPath = path
          deps.trackTmp(path)
        },
      ))
    } finally {
      deps.unregisterActiveConversion(job.id)
      // convertAudio's own catch already deleted the file on a normal failure —
      // this only needs to keep the manifest honest so a later crash doesn't
      // sweep a path that's already gone (harmless either way, but tidy).
      if (tmpPath) deps.untrackTmp(tmpPath)
    }
    if (inPlace) await deps.removeRenamedOriginal(job.inputPath, target)
    deps.recordConversion()

    // A track that already has a library copy (musicPersistentId from a previous
    // add) gets its metadata and artwork synced onto that copy instead of being
    // imported again — re-converting an edited track must never duplicate it in
    // Music. Only when the user deleted the copy from the library does the fresh
    // file get imported, which also re-establishes the persistent ID.
    let musicPersistentId: string | undefined
    if (shouldAddToAppleMusic(settings.addToAppleMusic, deps.platform, format)) {
      stage('appleMusic')
      musicPersistentId = job.musicPersistentId
        ? ((await deps.updateInAppleMusic(job.musicPersistentId, job.meta, coverPath)) ??
          (await deps.addToAppleMusic(target, job.meta, coverPath)))
        : await deps.addToAppleMusic(target, job.meta, coverPath)
      // "Apple Music only" removes the temp conversion in the finally below — safe only
      // when Music COPIED the file into its Media folder. With "Copy files to the Media
      // folder when adding" off, the fresh entry still references the temp path, and
      // the cleanup would leave a library row that plays nothing. Verify where the
      // entry points; a temp reference rolls the add back and fails the job out loud.
      if (tmpDir && musicPersistentId) {
        const entryPath = await deps.appleMusicEntryLocation(musicPersistentId)
        if (entryPath.startsWith(tmpDir)) {
          await deps.deleteAppleMusic(musicPersistentId)
          throw new Error(
            'Música no copió el archivo a su carpeta multimedia, así que "Solo Apple Music" lo dejaría sin audio. Activa "Copiar archivos a la carpeta multimedia" en los ajustes de Música, o desactiva "Solo Apple Music".',
          )
        }
      }
    }

    // The Engine DJ destination points a library row at the file just written; a failed
    // registration throws and fails the job, like a failed Apple Music add — never a
    // silent "converted but not in the library".
    let addedToEngineDj: true | undefined
    if (settings.addToEngineDj) {
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
        await deps.addToEngineDj(target, job.meta, coverPath ?? extracted?.path)
        addedToEngineDj = true
      } finally {
        if (extracted) await extracted.cleanup()
      }
    }

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
      }

    // The conversion wrote a real file the renderer may play next — directly, or
    // as the track's new source after an in-place rename — so let surco:// serve it.
    deps.allowMedia(target)
    return { outputPath: target, inPlace, musicPersistentId, normalizeSkipped, addedToEngineDj }
  } finally {
    if (prepared) await prepared.cleanup()
    if (tmpDir) await deps.rm(tmpDir, { recursive: true, force: true })
    if (reserved) deps.releasePath(reserved)
  }
}
