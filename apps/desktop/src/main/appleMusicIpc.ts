import { app, ipcMain, shell } from 'electron'
import type { AppleMusicAddJob, AppleMusicUpdateJob, TrackMetadata } from '../shared/types'
import { activity } from './activity'
import {
  addToAppleMusic,
  appleMusicLimiter,
  deleteFromAppleMusic,
  dumpAppleMusicLibrary,
  revealInAppleMusic,
  updateInAppleMusic,
} from './applemusic'
import { hasCoverSource, prepareProcessedCover } from './cover'
import { createMenuT } from './i18n'
import { getSettings } from './settings'

// "Artist - Title" for the activity row, falling back to whichever field exists so a
// half-tagged track still reads as something rather than a bare dash.
function trackLabel(meta: TrackMetadata): string {
  if (meta.artist && meta.title) return `${meta.artist} - ${meta.title}`
  return meta.title || meta.artist || 'pista'
}

// The Apple Music bridge IPC: library lookups and the on-demand add/update/reveal a track
// gets from the editor, palette or menu. The AppleScript bridge is macOS-only, so every
// handler short-circuits off macOS rather than spawning a missing osascript. Self-contained
// — no window or session state — so it lives apart from the stateful handlers in index.ts.
export function registerAppleMusicIpc(): void {
  // The whole-library snapshot the renderer matches the crate against to flag which
  // tracks are already owned; empty off macOS, where there is no library to read.
  ipcMain.handle('applemusic:library', () =>
    process.platform === 'darwin'
      ? activity.track('applemusic', 'activity.appleMusicLibrary', dumpAppleMusicLibrary, {
          summary: (lib) => ({
            detailKey: 'activity.trackCount',
            detailParams: { count: lib.length },
          }),
        })
      : [],
  )

  // Adds an already-converted track to Apple Music on demand — the tail of
  // process:track, but invoked by hand from the editor/palette/menu when the
  // automatic add is off. The processed cover is re-prepared from the same source
  // so the artwork written to the library matches the embedded one, then cleaned
  // up. macOS-only; the renderer never offers it elsewhere.
  ipcMain.handle('applemusic:add', async (_e, job: AppleMusicAddJob) => {
    if (process.platform !== 'darwin') return
    // Same one-at-a-time gate the conversion path uses, so a manual add can't race an
    // automatic one onto Music. The queue wait stays outside the timed activity.track.
    return appleMusicLimiter.run(() =>
      activity.track(
        'applemusic',
        'activity.appleMusicAdd',
        async () => {
          const settings = getSettings()
          let prepared: Awaited<ReturnType<typeof prepareProcessedCover>>
          try {
            if (hasCoverSource(job)) {
              prepared = await prepareProcessedCover(job, {
                maxSize: settings.coverMaxSize,
                square: settings.coverSquare,
                upscale: settings.coverUpscale,
              })
            }
            return await addToAppleMusic(job.outputPath, job.meta, prepared?.path)
          } finally {
            if (prepared) await prepared.cleanup()
          }
        },
        { labelParams: { track: trackLabel(job.meta) } },
      ),
    )
  })

  // Syncs the editor's metadata onto the library copy a previous add created — the
  // manual "update in Apple Music" action. When the user deleted that copy from
  // Music, the converted file (if one was kept) is imported afresh so the action
  // still ends with the song in the library; in "Apple Music only" mode there is no
  // file left to import, so the missing copy is surfaced as an error instead.
  ipcMain.handle('applemusic:update', async (_e, job: AppleMusicUpdateJob) => {
    if (process.platform !== 'darwin') return
    return appleMusicLimiter.run(() =>
      activity.track(
        'applemusic',
        'activity.appleMusicUpdate',
        async () => {
          const settings = getSettings()
          let prepared: Awaited<ReturnType<typeof prepareProcessedCover>>
          try {
            if (hasCoverSource(job)) {
              prepared = await prepareProcessedCover(job, {
                maxSize: settings.coverMaxSize,
                square: settings.coverSquare,
                upscale: settings.coverUpscale,
              })
            }
            const updated = await updateInAppleMusic(job.persistentId, job.meta, prepared?.path)
            if (updated) return updated
            if (!job.outputPath) {
              const t = createMenuT(app.getLocale())
              throw new Error(t('appleMusicGone'))
            }
            return await addToAppleMusic(job.outputPath, job.meta, prepared?.path)
          } finally {
            if (prepared) await prepared.cleanup()
          }
        },
        { labelParams: { track: trackLabel(job.meta) } },
      ),
    )
  })

  ipcMain.handle('applemusic:reveal', (_e, persistentId: string) =>
    process.platform === 'darwin' ? revealInAppleMusic(persistentId) : undefined,
  )

  // Removes the superseded library copy after a replace: the entry leaves Music and its
  // file goes to the OS Trash (recoverable, matching shell:trash's "never a hard delete").
  // The trash failing — the file was already removed by hand, or sits on an unmounted
  // volume — must not report the action failed: the library entry is already gone and
  // that removal can't roll back, so the outcome the user asked for stands. "missing"
  // (the copy vanished from Music since the snapshot) counts as done for the same reason.
  // `track` is the confirmed copy's own "artist - title" label: it names the activity
  // row AND is what the delete script verifies the live track against before deleting.
  ipcMain.handle('applemusic:delete', async (_e, persistentId: string, track: string) => {
    if (process.platform !== 'darwin') return
    return appleMusicLimiter.run(() =>
      activity.track(
        'applemusic',
        'activity.appleMusicDelete',
        async () => {
          const location = await deleteFromAppleMusic(persistentId, track)
          if (location === null) return { outcome: 'missing' as const }
          if (location) await shell.trashItem(location).catch(() => undefined)
          // The trashed path travels back so the renderer can mark any loaded row
          // whose source file this was (Music referencing the user's own file).
          return { outcome: 'deleted' as const, location: location || undefined }
        },
        { labelParams: { track } },
      ),
    )
  })
}
