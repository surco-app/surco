import { posix, win32 } from 'node:path'

// baken writes the stick (export.pdb, exportLibrary.db, ANLZ, audio). It ships beside the
// app archive through electron-builder's extraResources, not inside app.asar, because a
// binary inside the archive cannot be executed (the same reason ffmpeg is unpacked).
export interface BakenEnv {
  platform: NodeJS.Platform
  packaged: boolean
  resourcesPath: string
  appPath: string
  exists: (path: string) => boolean
}

const NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: 'baken', win32: 'baken.exe' }

// macOS and Windows only; the platform's own path rules so a Windows path is built right
// even when this runs in a test on a Mac.
export function bakenPath(env: BakenEnv): string | null {
  const name = NAMES[env.platform]
  if (!name) return null
  const { join } = env.platform === 'win32' ? win32 : posix
  const dir = env.packaged
    ? join(env.resourcesPath, 'baken')
    : join(env.appPath, 'resources', 'baken')
  const file = join(dir, name)
  return env.exists(file) ? file : null
}

// What bakenRun spawns. Tests swap in node plus a fake baken script, so the runner takes a
// file and leading arguments rather than a bare path.
export function bakenCommand(env: BakenEnv): { file: string; prefixArgs: string[] } | null {
  const file = bakenPath(env)
  return file ? { file, prefixArgs: [] } : null
}
