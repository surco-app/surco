import { realpathSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { TrashEntry } from '../shared/types'
import type { DamageIpcDeps } from './damageIpc'
import { scanEngineDamage } from './engineDamage'
import { isEngineDjRunning } from './engineProcess'
import { type EngineRepoint, repointEngineTracks } from './engineRepoint'
import { headOffsetMs, probeAudio, probeDuration, proveDecodable } from './ffmpeg'
import { libraryGenresOf } from './libraryFileUse'
import {
  engineFlushDeps,
  type LibraryHost,
  rekordboxFlushDeps,
  type Sessions,
  traktorFlushDeps,
} from './libraryFlushes'
import { copyFolder, listCopies } from './libraryHistory'
import type { MediaAccess } from './mediaAccess'
import {
  type Rewritten,
  rewriteCueTree,
  rewriteTagFields,
  type TmpTracking,
} from './musicFieldWrite'
import type { RekordboxQueue } from './rekordboxQueue'
import { scanTraktorDamage } from './traktorCueDamageScan'
import type { NmlPatch } from './traktorNml'
import { bootVolumeName } from './traktorNmlLibrary'
import { holdInQueue, queuedNmlPatch } from './traktorPatchQueue'
import { isTraktorRunning } from './traktorProcess'
import { runInWorker } from './worker'

export interface DamageEnv {
  mediaAccess: MediaAccess
  tmp: TmpTracking
  hostFor: (sender: WebContents) => LibraryHost
  sessions: Sessions
  beginMoment: () => void
  backups: () => Promise<TrashEntry[]>
  traktorQueue?: Parameters<typeof holdInQueue>[0]
  engineQueue?: { enqueue: RekordboxQueue['enqueue']; applyQuietly: () => void }
  serial?: DamageIpcDeps['serial']
  followEngineSize?: Rewritten
  queued?: DamageIpcDeps['queued']
}

export function damageDeps(env: DamageEnv): DamageIpcDeps {
  return {
    scanDeps: (sender) => {
      const host = env.hostFor(sender)
      const libraries = {
        rekordbox: rekordboxFlushDeps(host).collectionPath,
        engine: engineFlushDeps(host).collectionPath,
        traktor: traktorFlushDeps(host, env.sessions.traktor).traktorNmlPath,
      }
      return {
        isAllowed: env.mediaAccess.isAllowed,
        readGenre: (path) =>
          runInWorker<{ raw: string; info?: string } | null>({ type: 'genreFrame', file: path }),
        libraryGenres: (paths) =>
          libraryGenresOf(paths, libraries, { realPath: (p: string) => realpathSync(p) }),
        ...(libraries.traktor && {
          traktor: (paths: string[]) =>
            scanTraktorDamage(paths, libraries.traktor, { backups: env.backups }),
        }),
        ...(libraries.engine && {
          engine: (paths: string[]) =>
            scanEngineDamage(paths, libraries.engine, {
              probe: async (path) => {
                const probe = await probeAudio(path).catch(() => null)
                const sampleRate = Number(probe?.sampleRate)
                return probe?.headerSeconds && sampleRate > 0
                  ? { sampleRate, durationSec: probe.headerSeconds }
                  : null
              },
              backups: env.backups,
              headOffsetMs,
              durationOf: (path) => probeDuration(path),
              copies: async () =>
                (await listCopies(join(libraries.engine, 'Database2', 'm.db'))).map((copy) => ({
                  takenAt: copy.takenAt,
                  dbPath: join(copyFolder(copy), 'm.db'),
                })),
            }),
        }),
      }
    },
    repairDeps: (sender) => {
      const host = env.hostFor(sender)
      const traktor = traktorFlushDeps(host, env.sessions.traktor)
      const queue = env.traktorQueue
      const engineQueue = env.engineQueue
      return {
        beginMoment: env.beginMoment,
        genre: {
          allowed: (path) => env.mediaAccess.isAllowed(path),
          exists: (path) =>
            access(path).then(
              () => true,
              () => false,
            ),
          rewrite: (file, changes) =>
            rewriteTagFields(file, changes, env.tmp, env.followEngineSize, 'setGenreFrame'),
        },
        rewriteTree: (file, addMs, expected) =>
          rewriteCueTree(file, addMs, expected, env.tmp, env.followEngineSize),
        traktor: {
          ...traktor,
          ensureTraktorClosed: async () => !(await isTraktorRunning().catch(() => true)),
          showBlockedDialog: () => {},
          bootVolume: bootVolumeName(),
          readCollection: () => readFile(traktor.traktorNmlPath, 'utf8').catch(() => null),
          ...(queue && {
            waiting: holdInQueue(queue, bootVolumeName).waiting,
            hold: async (patches: NmlPatch[], states: string[]) => {
              queue.enqueue(
                [],
                patches.map((p, i) => queuedNmlPatch(p, states[i])),
              )
              queue.applyQuietly()
            },
          }),
        },
        engine: {
          ...engineFlushDeps(host),
          ensureClosed: async () => !(await isEngineDjRunning().catch(() => true)),
          showBlockedDialog: () => {},
          countSamples: async (path) =>
            (await proveDecodable(path, undefined, undefined, undefined, true)).samples ?? null,
          repointTracks: (libraryDir, list: EngineRepoint[]) =>
            repointEngineTracks(
              libraryDir,
              list.map((r) => ({ ...r, realPath: (p: string) => realpathSync(p) })),
              { sessionBackup: (path) => env.sessions.engine.ensure(path) },
            ),
          ...(engineQueue && {
            enqueue: (repoints: EngineRepoint[]) => {
              engineQueue.enqueue([], repoints)
              engineQueue.applyQuietly()
            },
          }),
        },
      }
    },
    ...(env.serial && { serial: env.serial }),
    ...(env.queued && { queued: env.queued }),
  }
}
