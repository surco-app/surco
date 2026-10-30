import { access, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import log from 'electron-log/main'
import type {
  AppleMusicAddJob,
  AppleMusicPlaylist,
  AppleMusicUpdateJob,
  MusicFieldFix,
  MusicReviewField,
  TrackMetadata,
} from '../shared/types'
import { activity } from './activity'
import { createConcurrencyLimiter } from './analysisLimiter'
import { artworkDir, fetchAppleMusicArtwork } from './appleMusicArtwork'
import { loadLibraryCache, saveLibraryCache } from './appleMusicLibraryCache'
import { attachMissingArtwork } from './appleMusicPlaylistArt'
import { loadPlaylistCache, savePlaylistCache } from './appleMusicPlaylistCache'
import {
  dumpAppleMusicPlaylists,
  readAppleMusicEntry,
  readAppleMusicPlaylist,
  readLibraryPlaylist,
} from './appleMusicPlaylists'
import {
  addToAppleMusic,
  appleMusicEntryLocation,
  appleMusicLimiter,
  deleteFromAppleMusic,
  dumpAppleMusicLibrary,
  dumpMusicReview,
  musicFileEntries,
  revealInAppleMusic,
  setAppleMusicField,
  transferPlaylists,
  updateInAppleMusic,
} from './applemusic'
import { hasCoverSource, prepareProcessedCover } from './cover'
import { readMeta } from './ffmpeg'
import { createMenuT, resolveMenuLocale } from './i18n'
import { removeDuplicateCopyLogged } from './musicDuplicates'
import { prepareTagRewrite } from './musicFieldWrite'
import { applyMusicFixes } from './musicReviewApply'
import { musicReviewLog, setFieldLogged } from './musicReviewLog'
import { discardBackup, keepBeforeMusicRewrite } from './originalKeeper'
import { trashRecoverably } from './recoverableTrash'
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
export function registerAppleMusicIpc(
  deps: { trackTmp?: (path: string) => void; untrackTmp?: (path: string) => void } = {},
): void {
  // The whole-library snapshot the renderer matches the crate against to flag which
  // tracks are already owned; empty off macOS, where there is no library to read.
  // Each successful dump is persisted so the next session can seed its index from
  // disk while this (seconds-long on a big library) dump re-runs.
  ipcMain.handle('applemusic:library', () =>
    process.platform === 'darwin'
      ? activity.track(
          'applemusic',
          'activity.appleMusicLibrary',
          async () => {
            const lib = await dumpAppleMusicLibrary()
            saveLibraryCache(lib)
            return lib
          },
          {
            summary: (lib) => ({
              detailKey: 'activity.trackCount',
              detailParams: { count: lib.length },
            }),
          },
        )
      : [],
  )

  ipcMain.handle('applemusic:reviewDump', async () => {
    if (process.platform !== 'darwin') return []
    const entries = await appleMusicLimiter.run(() => dumpMusicReview())
    musicReviewLog.rememberTitles(entries)
    return entries
  })

  ipcMain.handle(
    'applemusic:fileEntries',
    (_e, candidates: { path: string; title: string }[], launch: boolean) =>
      process.platform === 'darwin'
        ? appleMusicLimiter.run(() => musicFileEntries(candidates, launch))
        : { consulted: false, entries: {} },
  )

  let fixesCancelled = false
  ipcMain.handle('applemusic:applyFixes', async (e, fixes: MusicFieldFix[]) => {
    if (process.platform !== 'darwin') return []
    fixesCancelled = false
    const { trackTmp, untrackTmp } = deps
    const group = musicReviewLog.beginRun()
    const outcomes = await applyMusicFixes(
      fixes,
      {
        setField: (pid, field, from, to) =>
          appleMusicLimiter.run(() => setAppleMusicField(pid, field, from, to)),
        locate: (pid) => appleMusicLimiter.run(() => appleMusicEntryLocation(pid)),
        exists: (path) =>
          access(path).then(
            () => true,
            () => false,
          ),
        prepare: (file) =>
          prepareTagRewrite(
            file,
            trackTmp && untrackTmp ? { track: trackTmp, untrack: untrackTmp } : undefined,
          ),
      },
      {
        isCancelled: () => fixesCancelled,
        onProgress: (progress) => {
          if (!e.sender.isDestroyed()) e.sender.send('applemusic:fixProgress', progress)
        },
        log: { track: activity.track, group, titleOf: musicReviewLog.titleOf },
      },
    )
    musicReviewLog.rememberRun(group, outcomes)
    return outcomes
  })
  ipcMain.handle('applemusic:cancelFixes', () => {
    fixesCancelled = true
  })
  ipcMain.handle(
    'applemusic:setField',
    (_e, pid: string, field: MusicReviewField, from: string, to: string, location?: string) =>
      process.platform === 'darwin'
        ? setFieldLogged(
            pid,
            field,
            () => appleMusicLimiter.run(() => setAppleMusicField(pid, field, from, to, location)),
            { track: activity.track, log: musicReviewLog },
          )
        : 'missing',
  )

  ipcMain.handle(
    'applemusic:removeDuplicate',
    (_e, req: { removePid: string; keepPid: string; label: string; keepLabel: string }) =>
      process.platform === 'darwin'
        ? appleMusicLimiter.run(() =>
            removeDuplicateCopyLogged(
              req,
              {
                locate: appleMusicEntryLocation,
                realpath: (p) => realpath(p).catch(() => null),
                transferPlaylists,
                deleteEntry: deleteFromAppleMusic,
              },
              { track: activity.track, rememberCopy: musicReviewLog.rememberCopy },
            ),
          )
        : { outcome: 'missing', playlists: 0, fileTrashed: false },
  )

  // The previous session's persisted snapshot — a plain file read, no osascript, no
  // activity row. Null (no cache yet) tells the renderer to just wait for the dump.
  ipcMain.handle('applemusic:libraryCached', () =>
    process.platform === 'darwin' ? loadLibraryCache() : null,
  )

  // The user's own playlists, to pick one as a source of tracks. Empty off macOS, where
  // there is no Music to ask — the renderer never offers the import there, but a handler
  // that shelled out anyway would turn a stray call into a spawn failure.
  const musicReads = createConcurrencyLimiter(1)
  let listing: Promise<AppleMusicPlaylist[]> | null = null
  let waitingPlaylist: AbortController | null = null

  ipcMain.handle('applemusic:playlists', () => {
    if (process.platform !== 'darwin') return []
    listing ??= activity
      .track(
        'applemusic',
        'activity.appleMusicPlaylists',
        () => musicReads.run(dumpAppleMusicPlaylists, 'high'),
        {
          summary: (rows) => ({
            detailKey: 'activity.playlistCount',
            detailParams: { count: rows.length },
          }),
        },
      )
      .finally(() => {
        listing = null
      })
    return listing
  })

  // The files one playlist holds, plus how many of its tracks have none — streaming rows
  // and undownloaded iCloud tracks. The count travels back so the app can say why fewer
  // rows arrived than the playlist claims, instead of leaving the user to discover the
  // gap by counting.
  // Where a library copy's file lives. The renderer needs it to tell rekordbox which path
  // a replacement supersedes: the collection indexes that file, not the one being
  // converted, which may sit in any download folder.
  ipcMain.handle('applemusic:entryLocation', (_e, persistentId: string) =>
    process.platform === 'darwin' ? appleMusicEntryLocation(persistentId) : '',
  )

  ipcMain.handle(
    'applemusic:playlistTracks',
    (_e, persistentId: string, from?: number, to?: number) =>
      process.platform === 'darwin'
        ? activity.track(
            'applemusic',
            'activity.appleMusicPlaylistTracks',
            () => {
              waitingPlaylist?.abort()
              const turn = new AbortController()
              waitingPlaylist = turn
              return musicReads.run(
                () => {
                  if (waitingPlaylist === turn) waitingPlaylist = null
                  return readAppleMusicPlaylist(persistentId, from, to)
                },
                'high',
                turn.signal,
              )
            },
            {
              summary: (out) => ({
                detailKey: 'activity.trackCount',
                detailParams: { count: out.paths.length },
              }),
            },
          )
        : { paths: [], missing: 0 },
  )

  // The whole playlist from the library database, outside the queue of reads Music serves
  // one at a time: it never asks Music, so it has no reason to wait behind cover fetches.
  // Null when the database cannot give it, and the renderer then asks Music.
  ipcMain.handle('applemusic:libraryPlaylistTracks', (_e, persistentId: string) =>
    process.platform === 'darwin'
      ? activity
          .track('applemusic', 'activity.appleMusicPlaylistTracks', async () => {
            const tracks = await readLibraryPlaylist(persistentId)
            savePlaylistCache(persistentId, tracks)
            return tracks
          })
          .catch((err: unknown) => {
            log.warn('library database read failed, asking Music', err)
            return null
          })
      : null,
  )

  // The playlist as last read whole, to show while it is read again. A plain file read.
  ipcMain.handle('applemusic:playlistCached', (_e, persistentId: string) =>
    process.platform === 'darwin' ? loadPlaylistCache(persistentId) : null,
  )

  ipcMain.handle('applemusic:artwork', async (_e, persistentIds: string[]) => {
    if (process.platform !== 'darwin') return {}
    const dir = await artworkDir()
    const jobs = persistentIds.map((persistentId) => ({
      persistentId,
      outPath: join(dir, `${persistentId}.jpg`),
    }))
    const fetched = await musicReads.run(() => fetchAppleMusicArtwork(jobs), 'low')
    const landed = new Map(fetched.map((c) => [c.path, c.url]))
    const covers: Record<string, { coverPath: string; coverUrl: string }> = {}
    for (const { persistentId, outPath } of jobs) {
      const url = landed.get(outPath)
      if (url) covers[persistentId] = { coverPath: outPath, coverUrl: url }
    }
    return covers
  })

  // What Music holds for a file loaded on its own rather than imported from a playlist:
  // the same fill and the same missing artwork the import gives, for the candidate entries
  // the renderer matched it to. Null when none of them is this very file.
  ipcMain.handle('applemusic:entryMeta', async (_e, path: string, persistentIds: string[]) => {
    if (process.platform !== 'darwin') return null
    const tracks = await attachMissingArtwork(await readAppleMusicEntry(path, persistentIds), {
      hasEmbedded: async (file) => Boolean((await readMeta(file)).cover),
      fetchArtwork: fetchAppleMusicArtwork,
      outDir: artworkDir,
    })
    return tracks.meta[path] ?? null
  })

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
            try {
              return await addToAppleMusic(job.outputPath, job.meta, prepared?.path)
            } catch (err) {
              // Failures surface to the user in AppleScript's own words ("Argument out of
              // range: index must be less than -1") — no file, no step, nothing to act on.
              // The renderer shows that; nothing recorded it, so a report arrived with no
              // trace behind it. Path first: in a batch the message alone names no culprit.
              log.error('applemusic:add failed', job.outputPath, err)
              throw err
            }
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
  // file left to import, so the missing copy is surfaced as an error instead. Music rewrites
  // the entry's file as it sets the tags, so that file is backed up first, under the setting
  // a conversion's tag-only rewrite follows.
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
            const location = await appleMusicEntryLocation(job.persistentId).catch(() => '')
            const kept = location ? await keepBeforeMusicRewrite(location) : null
            const updated = await updateInAppleMusic(job.persistentId, job.meta, prepared?.path)
            if (updated) return updated
            if (kept) await discardBackup(kept).catch(() => undefined)
            if (!job.outputPath) {
              const t = createMenuT(resolveMenuLocale(settings.language, app.getLocale()))
              throw new Error(t('appleMusicGone'))
            }
            try {
              return await addToAppleMusic(job.outputPath, job.meta, prepared?.path)
            } catch (err) {
              // Same blind spot on the re-import path an update falls back to.
              log.error('applemusic:update re-add failed', job.outputPath, err)
              throw err
            }
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
  // file goes to the OS Trash or Surco's trash (recoverable, matching shell:trash's
  // "never a hard delete").
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
          const trashed = location
            ? await trashRecoverably(location).then(
                () => true,
                () => false,
              )
            : false
          // The trashed path travels back so the renderer can mark any loaded row
          // whose source file this was (Music referencing the user's own file). A file
          // that stayed on disk is not reported, or its row would show as trashed.
          return { outcome: 'deleted' as const, location: trashed ? location : undefined }
        },
        { labelParams: { track } },
      ),
    )
  })
}
