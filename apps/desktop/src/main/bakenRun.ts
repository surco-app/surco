import { spawn } from 'node:child_process'
import { posix, win32 } from 'node:path'
import { createInterface } from 'node:readline'
import type { Stage } from './usbExportStage'

// Drives Surco's patched baken (vendor/baken/patches) through its --json lines: one object
// per line on stdout, and a `cancel` line on stdin. The human output is never read; it is a
// progress bar that vanishes off a terminal.

export interface BakenPlan {
  event: 'plan'
  volumeRoot: boolean
  tracks: { id: number; usbPath: string; size: number; onStick: boolean }[]
  spaceNeeded: number
  spaceAvailable: number | null
  warnings: string[]
  skipped: { name: string; reason: string }[]
  onelibraryFiles: string[]
}
export interface BakenStart {
  event: 'start'
  index: number
  usbPath: string
  size: number
}
export interface BakenWritten {
  event: 'written'
  index: number
  kept: boolean
}
export interface BakenFailed {
  event: 'failed'
  index: number
  message: string
}
export interface BakenDatabase {
  event: 'database'
}
export interface BakenReport {
  event: 'report'
  copied: number
  kept: number
  failures: { name: string; message: string }[]
  cancelled: boolean
  onelibraryWritten: boolean
  onelibraryError: string | null
  artwork: number
  pruned: number
  tracksInDatabase: number
}
export interface BakenError {
  event: 'error'
  kind: 'not-enough-space' | 'device-write' | 'device-not-found' | 'other'
  message: string
  needed?: number
  available?: number
}
export type BakenEvent =
  | BakenPlan
  | BakenStart
  | BakenWritten
  | BakenFailed
  | BakenDatabase
  | BakenReport
  | BakenError

const EVENTS = new Set(['plan', 'start', 'written', 'failed', 'database', 'report', 'error'])

export function parseBakenLine(line: string): BakenEvent | null {
  try {
    const v = JSON.parse(line) as { event?: unknown }
    return typeof v?.event === 'string' && EVENTS.has(v.event) ? (v as BakenEvent) : null
  } catch {
    return null
  }
}

export class BakenGuardError extends Error {}

export interface BakenArgsInput {
  stage: Stage
  device: string
  target: 'volume' | 'folder'
  prune: boolean
  settings: boolean
  dryRun: boolean
  platform: NodeJS.Platform
  home: string
  // ~/Library/Pioneer on macOS, %APPDATA%\Pioneer on Windows.
  pioneerDir: string
  // '/' on macOS, %SystemDrive%\ on Windows.
  systemRoot: string
}

// The last line of defence for the rules that matter most: nothing under the Pioneer folder
// is ever written or read by baken directly, the device is never the system root or the
// home folder, and a folder picked by hand is never pruned.
export function bakenArgs(input: BakenArgsInput): string[] {
  const { stage, device, target, prune, settings, dryRun, platform } = input
  const p = platform === 'win32' ? win32 : posix
  const norm = (x: string): string => {
    const r = p.resolve(x)
    return r.toLowerCase()
  }
  const inside = (path: string, dir: string): boolean => {
    const a = norm(path)
    const d = norm(dir)
    return a === d || a.startsWith(d.endsWith(p.sep) ? d : d + p.sep)
  }
  if (
    norm(device) === norm(input.systemRoot) ||
    norm(device) === norm(input.home) ||
    inside(device, input.pioneerDir) ||
    inside(input.pioneerDir, device)
  )
    throw new BakenGuardError(`refusing to export to ${device}`)
  for (const dir of [
    stage.dir,
    stage.xml,
    stage.anlzDir,
    stage.artworkDir,
    stage.settingsDir ?? stage.dir,
  ])
    if (inside(dir, input.pioneerDir) || inside(input.pioneerDir, dir))
      throw new BakenGuardError(`refusing to stage inside ${input.pioneerDir}`)
  return [
    'expressport',
    stage.xml,
    '--device',
    device,
    '--anlz-dir',
    stage.anlzDir,
    ...(settings && stage.settingsDir ? ['--settings-dir', stage.settingsDir] : ['--no-settings']),
    '--onelibrary',
    '--artwork',
    '--artwork-dir',
    stage.artworkDir,
    '--generate-analysis',
    // rekordbox 7.2.19's export leaves the name empty; the spike stick did the same.
    '--device-name',
    '',
    '--json',
    ...(prune && target === 'volume' ? ['--prune'] : []),
    ...(dryRun ? ['--dry-run'] : []),
  ]
}

export interface BakenHandle {
  // started: false when the process never ran (missing or not executable binary).
  done: Promise<{ code: number | null; stderr: string; started: boolean }>
  // Asks baken to stop before its next track; it then reports and exits on its own.
  cancel: () => void
}

export function runBaken(
  command: { file: string; prefixArgs: string[] },
  args: string[],
  onEvent: (e: BakenEvent) => void,
): BakenHandle {
  const child = spawn(command.file, [...command.prefixArgs, ...args], {
    env: { ...process.env, BAKEN_NO_UPDATE_CHECK: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let started = false
  child.on('spawn', () => {
    started = true
  })
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })
  // A cancel written after baken exited must not crash the main process.
  child.stdin.on('error', () => {})
  createInterface({ input: child.stdout }).on('line', (line) => {
    const e = parseBakenLine(line)
    if (e) onEvent(e)
  })
  const done = new Promise<{ code: number | null; stderr: string; started: boolean }>((res) => {
    child.on('error', (err) => res({ code: null, stderr: String(err), started }))
    child.on('close', (code) => res({ code, stderr, started }))
  })
  return {
    done,
    cancel: () => {
      if (child.stdin.writable) child.stdin.write('cancel\n')
    },
  }
}
