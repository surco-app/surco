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
    opts: { maxSize: number; square: boolean },
  ) => Promise<PreparedCover | undefined>
  convertAudio: (
    input: string,
    output: string,
    format: OutputFormat,
    meta: TrackMetadata,
    coverPath?: string,
    normalize?: NormalizeConfig,
    removeCover?: boolean,
  ) => Promise<{ normalizeSkipped: boolean }>
  recordConversion: () => void
  removeRenamedOriginal: (inputPath: string, target: string) => Promise<void>
  addToAppleMusic: (target: string, meta: TrackMetadata, coverPath?: string) => Promise<string>
  updateInAppleMusic: (
    persistentId: string,
    meta: TrackMetadata,
    coverPath?: string,
  ) => Promise<string | null>
  // Marks a written file as streamable through surco://.
  allowMedia: (path: string) => void
  existsSync: (path: string) => boolean
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<unknown>
  mkdtemp: (prefix: string) => Promise<string>
  rm: (path: string, opts: { recursive: boolean; force: boolean }) => Promise<void>
  // Shown only on a real output collision; returns the user's choice. Encapsulates the
  // Electron message box so the branches below stay unit-testable.
  confirmConflict: (outputName: string) => Promise<'overwrite' | 'keepBoth' | 'skip'>
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
  try {
    if (deps.hasCoverSource(job)) {
      stage('cover')
      prepared = await deps.prepareProcessedCover(job, {
        maxSize: settings.coverMaxSize,
        square: settings.coverSquare,
      })
    }
    const coverPath = prepared?.path

    stage('converting')
    const format = job.format ?? settings.outputFormat
    const { outputPath, inPlace } = resolveOutputTarget(
      job.inputPath,
      sanitizeOutputName(job.outputName),
      format,
      settings.outputDir,
      settings.overwriteOriginal,
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
    if (musicOnly) {
      tmpDir = await deps.mkdtemp(join(tmpdir(), 'surco-'))
      target = join(tmpDir, basename(outputPath))
    } else if (
      isOutputConflict(outputPath, job.previousOutputPath, inPlace, deps.existsSync(outputPath))
    ) {
      const choice = await deps.confirmConflict(basename(outputPath))
      if (choice === 'skip') return { outputPath: '', inPlace, skipped: true }
      if (choice === 'keepBoth') target = uniqueOutputPath(outputPath, deps.existsSync)
    }

    // Create the target's folder (and any subfolders the file-name template asks for)
    // before writing; recursive so it's a no-op when the directory already exists.
    await deps.mkdir(dirname(target), { recursive: true })
    const { normalizeSkipped } = await deps.convertAudio(
      job.inputPath,
      target,
      format,
      job.meta,
      coverPath,
      job.normalize ?? settings.normalize,
      job.removeCover,
    )
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
    return { outputPath: target, inPlace, musicPersistentId, normalizeSkipped }
  } finally {
    if (prepared) await prepared.cleanup()
    if (tmpDir) await deps.rm(tmpDir, { recursive: true, force: true })
  }
}
