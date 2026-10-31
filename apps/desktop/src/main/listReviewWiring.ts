import { access, realpath, stat } from 'node:fs/promises'
import type { WebContents } from 'electron'
import { activity } from './activity'
import {
  appleMusicLimiter,
  deleteFromAppleMusic,
  musicFileLocations,
  setAppleMusicField,
  transferPlaylists,
} from './applemusic'
import { duplicateLibraryDeps, type LibraryHost, type Sessions } from './libraryFlushes'
import type { ListReviewIpcDeps } from './listReviewIpc'
import type { MediaAccess } from './mediaAccess'
import { type Rewritten, rewriteTagFields } from './musicFieldWrite'
import { musicReviewLog } from './musicReviewLog'
import { trashRecoverably } from './recoverableTrash'
import { volumeKeepsTrash } from './trashSupport'

export interface ListReviewEnv {
  mediaAccess: MediaAccess
  tmp: { track: (path: string) => void; untrack: (path: string) => void }
  hostFor: (sender: WebContents) => LibraryHost
  sessions: Sessions
  followEngineSize?: Rewritten
}

export function listReviewDeps(env: ListReviewEnv): ListReviewIpcDeps {
  return {
    apply: {
      allowed: (path) => env.mediaAccess.isAllowed(path),
      exists: (path) =>
        access(path).then(
          () => true,
          () => false,
        ),
      rewrite: (file, changes) => rewriteTagFields(file, changes, env.tmp, env.followEngineSize),
      ...(process.platform === 'darwin' && {
        setMusicField: (pid, field, from, to, location) =>
          appleMusicLimiter.run(() => setAppleMusicField(pid, field, from, to, location)),
      }),
    },
    isAllowed: (path) => env.mediaAccess.isAllowed(path),
    removal: (sender) => ({
      replace: duplicateLibraryDeps(env.hostFor(sender), env.sessions),
      realpath: (path) => realpath(path).catch(() => null),
      identity: (path) =>
        stat(path, { bigint: true }).then(
          (s) => ({
            dev: s.dev,
            ino: s.ino,
            size: s.size,
            mtimeNs: s.mtimeNs,
            remote: !volumeKeepsTrash(path),
          }),
          () => null,
        ),
      trash: (path) => trashRecoverably(path),
      ...(process.platform === 'darwin' && {
        music: {
          transferPlaylists: (fromPid, toPid, label, keepLabel, locations) =>
            appleMusicLimiter.run(() =>
              transferPlaylists(fromPid, toPid, label, keepLabel, locations),
            ),
          deleteEntry: (pid, label, location) =>
            appleMusicLimiter.run(() => deleteFromAppleMusic(pid, label, location)),
          fileLocations: () => appleMusicLimiter.run(() => musicFileLocations()),
        },
      }),
    }),
    log: { track: activity.track, reviewLog: musicReviewLog },
  }
}
