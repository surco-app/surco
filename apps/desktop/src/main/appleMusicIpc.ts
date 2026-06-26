import { app, ipcMain } from 'electron'
import type { AppleMusicAddJob, AppleMusicUpdateJob, TrackMetadata } from '../shared/types'
import { activity } from './activity'
import {
  addToAppleMusic,
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
      ? activity.track('applemusic', 'Cargando biblioteca de Apple Music', dumpAppleMusicLibrary, {
          summary: (lib) => `${lib.length} pistas`,
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
    return activity.track('applemusic', `Añadiendo a Apple Music: ${trackLabel(job.meta)}`, async () => {
      const settings = getSettings()
      let prepared: Awaited<ReturnType<typeof prepareProcessedCover>>
      try {
        if (hasCoverSource(job)) {
          prepared = await prepareProcessedCover(job, {
            maxSize: settings.coverMaxSize,
            square: settings.coverSquare,
          })
        }
        return await addToAppleMusic(job.outputPath, job.meta, prepared?.path)
      } finally {
        if (prepared) await prepared.cleanup()
      }
    })
  })

  // Syncs the editor's metadata onto the library copy a previous add created — the
  // manual "update in Apple Music" action. When the user deleted that copy from
  // Music, the converted file (if one was kept) is imported afresh so the action
  // still ends with the song in the library; in "Apple Music only" mode there is no
  // file left to import, so the missing copy is surfaced as an error instead.
  ipcMain.handle('applemusic:update', async (_e, job: AppleMusicUpdateJob) => {
    if (process.platform !== 'darwin') return
    return activity.track(
      'applemusic',
      `Actualizando en Apple Music: ${trackLabel(job.meta)}`,
      async () => {
        const settings = getSettings()
        let prepared: Awaited<ReturnType<typeof prepareProcessedCover>>
        try {
          if (hasCoverSource(job)) {
            prepared = await prepareProcessedCover(job, {
              maxSize: settings.coverMaxSize,
              square: settings.coverSquare,
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
    )
  })

  ipcMain.handle('applemusic:reveal', (_e, persistentId: string) =>
    process.platform === 'darwin' ? revealInAppleMusic(persistentId) : undefined,
  )
}
