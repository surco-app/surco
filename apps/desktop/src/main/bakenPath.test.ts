import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bakenCommand, bakenPath } from './bakenPath'

const mac = {
  resourcesPath: '/Applications/Surco.app/Contents/Resources',
  appPath: '/dev/surco/apps/desktop',
  exists: () => true,
}
const win = {
  resourcesPath: 'C:\\Program Files\\Surco\\resources',
  appPath: 'C:\\dev\\surco\\apps\\desktop',
  exists: () => true,
}

describe('bakenPath', () => {
  // electron-builder copies resources/baken next to app.asar (extraResources), outside the
  // archive: a binary inside app.asar cannot be executed, which is why ffmpeg is unpacked.
  it('finds the packaged binary beside the app archive', () => {
    expect(bakenPath({ ...mac, platform: 'darwin', packaged: true })).toBe(
      posix.join(mac.resourcesPath, 'baken', 'baken'),
    )
    expect(bakenPath({ ...win, platform: 'win32', packaged: true })).toBe(
      win32.join(win.resourcesPath, 'baken', 'baken.exe'),
    )
  })

  // In development the binary is where scripts/build-baken.mjs left it.
  it('finds the development binary in the desktop app folder', () => {
    expect(bakenPath({ ...mac, platform: 'darwin', packaged: false })).toBe(
      posix.join(mac.appPath, 'resources', 'baken', 'baken'),
    )
    expect(bakenPath({ ...win, platform: 'win32', packaged: false })).toBe(
      win32.join(win.appPath, 'resources', 'baken', 'baken.exe'),
    )
  })

  // Linux has no export: nothing there can offer the feature, even with a binary on disk.
  it('has no baken on Linux', () => {
    expect(bakenPath({ ...mac, platform: 'linux', packaged: true })).toBeNull()
  })

  // A build that skipped scripts/build-baken.mjs must say "missing piece", not spawn ENOENT
  // halfway through an export.
  it('answers null when the binary is not there', () => {
    expect(
      bakenPath({ ...mac, platform: 'darwin', packaged: true, exists: () => false }),
    ).toBeNull()
  })

  it('runs the binary itself, with no prefix arguments', () => {
    expect(bakenCommand({ ...mac, platform: 'darwin', packaged: true })).toEqual({
      file: posix.join(mac.resourcesPath, 'baken', 'baken'),
      prefixArgs: [],
    })
  })
})
