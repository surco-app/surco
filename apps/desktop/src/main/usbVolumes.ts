import { execFile } from 'node:child_process'
import { watch } from 'node:fs'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import { promisify } from 'node:util'
import type { UsbFilesystem, UsbHolder, UsbVolume } from '../shared/types'
import { syncedPlaylists } from './rekordboxStickSync'
import { targetKey, type UsbMemory } from './usbExportMemory'
import windowsVolumesScript from './windowsVolumes.ps1?raw'

// The sticks the export can write: mounted, removable, never the system disk, never a
// network share, never a disk image. macOS asks diskutil one volume at a time; Windows asks
// one PowerShell query. Both come out as RawVolume, keyed by a stable identifier.

export type RawVolume = Omit<UsbVolume, 'holder' | 'remembered' | 'stickPlaylists'>

export interface VolumeSource {
  list: () => Promise<RawVolume[]>
  // The identifier of whatever is mounted at that root now, asked again right before writing.
  idAt: (root: string) => Promise<string | null>
}

export type DiskutilInfo = Record<string, unknown>

// diskutil speaks XML plists. This reads the subset it uses (dict, array, key, string,
// integer, real, true, false) without a dependency or a call to plutil, so tests run on
// any CI runner.
export function parsePlist(xml: string): unknown {
  const tokens = [
    ...xml.matchAll(
      /<(\/?)(dict|array|key|string|integer|real|true|false|date|data)\s*(\/?)>([^<]*)/g,
    ),
  ]
  let i = 0
  const text = (raw: string): string =>
    raw
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
  const value = (): unknown => {
    const [, , tag, selfClosing, body] = tokens[i++]
    if (tag === 'true') return true
    if (tag === 'false') return false
    if (selfClosing) return tag === 'dict' ? {} : tag === 'array' ? [] : ''
    if (tag === 'dict') {
      const out: Record<string, unknown> = {}
      while (i < tokens.length && tokens[i][1] !== '/') {
        const key = text(tokens[i][4])
        i += 2
        out[key] = value()
      }
      i++
      return out
    }
    if (tag === 'array') {
      const out: unknown[] = []
      while (i < tokens.length && tokens[i][1] !== '/') out.push(value())
      i++
      return out
    }
    i++
    return tag === 'integer' || tag === 'real' ? Number(body) : text(body)
  }
  return tokens.length ? value() : null
}

export function isUsbVolume(info: DiskutilInfo): boolean {
  return (
    info.Internal === false &&
    typeof info.MountPoint === 'string' &&
    info.MountPoint.startsWith('/Volumes/') &&
    typeof info.VolumeUUID === 'string' &&
    info.BusProtocol !== 'Disk Image' &&
    (info.RemovableMediaOrExternalDevice === true || info.Ejectable === true)
  )
}

export function filesystemOf(info: DiskutilInfo): UsbFilesystem {
  const type = String(info.FilesystemType ?? '').toLowerCase()
  if (type === 'msdos') return 'fat32'
  if (type === 'exfat') return 'exfat'
  if (type === 'hfs') return 'hfs'
  if (type === 'apfs') return 'apfs'
  return 'other'
}

export function schemeOf(whole: DiskutilInfo | null): 'mbr' | 'gpt' | 'other' {
  const content = String(whole?.Content ?? '')
  if (content === 'FDisk_partition_scheme') return 'mbr'
  if (content === 'GUID_partition_scheme') return 'gpt'
  return 'other'
}

const numberOf = (v: unknown): number => (typeof v === 'number' ? v : 0)

export function darwinSource(deps: {
  list: () => Promise<string[]>
  info: (target: string) => Promise<DiskutilInfo | null>
}): VolumeSource {
  return {
    list: async () => {
      const out: RawVolume[] = []
      for (const mount of await deps.list()) {
        const info = await deps.info(mount)
        if (!info || !isUsbVolume(info)) continue
        const whole =
          typeof info.ParentWholeDisk === 'string' ? await deps.info(info.ParentWholeDisk) : null
        out.push({
          uuid: String(info.VolumeUUID),
          name: String(info.VolumeName ?? ''),
          mountPoint: String(info.MountPoint),
          filesystem: filesystemOf(info),
          partitionScheme: schemeOf(whole),
          totalBytes: numberOf(info.TotalSize),
          freeBytes: numberOf(info.APFSContainerFree ?? info.FreeSpace),
        })
      }
      return out
    },
    idAt: async (root) => {
      const info = await deps.info(root)
      return info && typeof info.VolumeUUID === 'string' ? info.VolumeUUID : null
    },
  }
}

const run = promisify(execFile)

export const DARWIN_DISKUTIL = {
  list: async (): Promise<string[]> =>
    (await readdir('/Volumes').catch(() => [])).map((n) => join('/Volumes', n)),
  info: async (target: string): Promise<DiskutilInfo | null> => {
    try {
      const { stdout } = await run('diskutil', ['info', '-plist', target])
      const info = parsePlist(stdout) as DiskutilInfo | null
      return info && info.Error !== true ? info : null
    } catch {
      return null
    }
  },
}

export interface WinVolume {
  DeviceID: string
  DriveLetter: string | null
  Label: string | null
  FileSystem: string | null
  Capacity: number
  FreeSpace: number
  DriveType: number
  SerialNumber: number
  BusType: string | null
  PartitionStyle: string | null
  SystemVolume: boolean
  BootVolume: boolean
}

const REMOVABLE_DRIVE = 2
const GUID = /Volume(\{[0-9a-f-]+\})/i

function winFilesystem(fs: string | null): UsbFilesystem {
  const f = (fs ?? '').toLowerCase()
  return f === 'fat32' ? 'fat32' : f === 'exfat' ? 'exfat' : f === 'ntfs' ? 'ntfs' : 'other'
}

// Removable = a stick (DriveType 2) or any disk on the USB bus (USB SSDs report as fixed),
// with a letter, never the system or boot volume. Network shares are DriveType 4 and not on
// a bus, so they never qualify.
export function parseWindowsVolumes(json: unknown): RawVolume[] {
  const items = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : []
  const objects = items.filter((v) => v && typeof v === 'object')
  return (objects as Partial<WinVolume>[]).flatMap((v) => {
    const guid = GUID.exec(String(v.DeviceID ?? ''))?.[1]
    const letter = String(v.DriveLetter ?? '')
    if (!guid || !/^[A-Z]:$/i.test(letter) || v.SystemVolume || v.BootVolume) return []
    if (v.DriveType !== REMOVABLE_DRIVE && String(v.BusType ?? '').toUpperCase() !== 'USB')
      return []
    return [
      {
        uuid: guid.toLowerCase(),
        name: String(v.Label ?? ''),
        mountPoint: `${letter.toUpperCase()}\\`,
        filesystem: winFilesystem(v.FileSystem ?? null),
        partitionScheme:
          v.PartitionStyle === 'MBR' ? 'mbr' : v.PartitionStyle === 'GPT' ? 'gpt' : 'other',
        totalBytes: numberOf(v.Capacity),
        freeBytes: numberOf(v.FreeSpace),
      },
    ]
  })
}

export function windowsSource(query: (letter?: string) => Promise<unknown>): VolumeSource {
  return {
    list: async () => parseWindowsVolumes(await query()),
    idAt: async (root) => {
      const letter = /^([A-Z]:)/i.exec(root)?.[1]?.toUpperCase()
      if (!letter) return null
      return parseWindowsVolumes(await query(letter))[0]?.uuid ?? null
    },
  }
}

// The script goes in as -EncodedCommand (UTF-16LE base64), so no quoting of the script or
// the letter can break it; the letter is validated before it is spliced in.
export async function powershellQuery(letter?: string): Promise<unknown> {
  const arg = letter && /^[A-Z]:$/i.test(letter) ? ` '${letter}'` : ''
  const command = `& {\n${windowsVolumesScript}\n}${arg}`
  try {
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, maxBuffer: 1 << 20 },
    )
    return JSON.parse(stdout.trim() || '[]')
  } catch {
    return []
  }
}

export function systemVolumeSource(platform: NodeJS.Platform): VolumeSource | null {
  if (platform === 'darwin') return darwinSource(DARWIN_DISKUTIL)
  if (platform === 'win32') return windowsSource(powershellQuery)
  return null
}

// FAT stores modification times in 2-second steps.
const FAT_RESOLUTION_MS = 2000

export async function stickHolder(
  root: string,
  pdb: { size: number; mtimeMs: number } | null,
): Promise<UsbHolder> {
  const dir = join(root, 'PIONEER', 'rekordbox')
  const current = await stat(join(dir, 'export.pdb')).catch(() => null)
  if (!current) return { by: 'empty', at: null }
  // Surco keeps exportExt.pdb and writes the .sync files itself, so only an export.pdb
  // that is no longer the one Surco wrote can be rekordbox's.
  if (
    pdb &&
    pdb.size === current.size &&
    Math.abs(pdb.mtimeMs - current.mtimeMs) <= FAT_RESOLUTION_MS
  )
    return { by: 'surco', at: current.mtimeMs }
  const ext = await stat(join(dir, 'exportExt.pdb')).catch(() => null)
  const sync = await stat(join(dir, 'playlists3.sync')).catch(() => null)
  if (ext || sync) return { by: 'rekordbox', at: current.mtimeMs }
  return { by: 'other', at: current.mtimeMs }
}

export async function readVolumes(
  source: VolumeSource,
  memory: UsbMemory,
  holder: typeof stickHolder = stickHolder,
  syncText: (root: string) => Promise<string | null> = (root) =>
    readFile(join(root, 'PIONEER', 'rekordbox', 'playlists3.sync'), 'utf8').catch(() => null),
): Promise<UsbVolume[]> {
  const out: UsbVolume[] = []
  for (const v of await source.list()) {
    const entry = memory.get(targetKey({ kind: 'volume', uuid: v.uuid }))
    const sync = await syncText(v.mountPoint)
    out.push({
      ...v,
      holder: await holder(v.mountPoint, entry?.pdb ?? null),
      stickPlaylists: sync === null ? null : syncedPlaylists(sync),
      remembered: entry
        ? {
            playlistIds: entry.playlistIds,
            prune: entry.prune,
            settings: entry.settings ?? false,
            at: entry.at,
          }
        : null,
    })
  }
  return out
}

// "Otro destino" has to be on one of the listed removable volumes; this finds which.
export function volumeContaining(
  volumes: RawVolume[],
  path: string,
  platform: NodeJS.Platform,
): RawVolume | null {
  const p = platform === 'win32' ? win32 : posix
  const norm = (x: string): string =>
    platform === 'win32' ? p.resolve(x).toLowerCase() : p.resolve(x)
  const target = norm(path)
  return (
    volumes.find((v) => {
      const root = norm(v.mountPoint)
      return target === root || target.startsWith(root.endsWith(p.sep) ? root : root + p.sep)
    }) ?? null
  )
}

const LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`)

// macOS adds and removes /Volumes entries as volumes mount and unmount (debounced: one mount
// fires several events). Windows has no such folder: the set of existing drive roots is
// compared every 2 s, and only a change reports.
export function watchVolumes(
  platform: NodeJS.Platform,
  onChange: () => void,
  deps: { exists: (p: string) => Promise<boolean>; intervalMs?: number } = {
    exists: (p) =>
      access(p).then(
        () => true,
        () => false,
      ),
  },
): () => void {
  if (platform === 'win32') {
    // Asynchronous, and one check at a time: a mapped drive whose NAS sleeps can hang a stat
    // for seconds, which must neither block the main thread nor stack up ticks.
    const snapshot = async (): Promise<string> =>
      (await Promise.all(LETTERS.map(async (l) => ((await deps.exists(l)) ? l : '')))).join('')
    let last: string | null = null
    let pending = true
    let stopped = false
    snapshot().then((now) => {
      last = now
      pending = false
    })
    const timer = setInterval(async () => {
      if (pending) return
      pending = true
      const now = await snapshot()
      pending = false
      if (stopped || now === last) return
      last = now
      onChange()
    }, deps.intervalMs ?? 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }
  let timer: NodeJS.Timeout | null = null
  const watcher = watch('/Volumes', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 500)
  })
  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}
