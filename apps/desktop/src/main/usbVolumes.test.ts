import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUsbMemory } from './usbExportMemory'
import {
  type DiskutilInfo,
  darwinSource,
  filesystemOf,
  isUsbVolume,
  parsePlist,
  parseWindowsVolumes,
  readVolumes,
  schemeOf,
  stickHolder,
  volumeContaining,
  watchVolumes,
  windowsSource,
} from './usbVolumes'

afterEach(() => vi.useRealTimers())

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
const STICK = parsePlist(fixture('diskutil-usb-exfat.plist')) as DiskutilInfo
const WHOLE = parsePlist(fixture('diskutil-usb-whole.plist')) as DiskutilInfo
const INTERNAL = parsePlist(fixture('diskutil-internal.plist')) as DiskutilInfo
const WIN = JSON.parse(fixture('win32-volumes.json')) as unknown
const memory = async () => createUsbMemory(join(await mkdtemp(join(tmpdir(), 'mem-')), 'm.json'))
// Tests never touch a real stick: who wrote it is answered by a stand-in.
const holder = async () => ({ by: 'empty' as const, at: null })

describe('parsePlist', () => {
  it('reads dicts, arrays, strings, integers and booleans', () => {
    const xml = `<?xml version="1.0"?><plist version="1.0"><dict><key>A</key><string>x &amp; y</string><key>B</key><integer>42</integer><key>C</key><true/><key>D</key><array><string>p</string><false/></array><key>E</key><dict/></dict></plist>`
    expect(parsePlist(xml)).toEqual({ A: 'x & y', B: 42, C: true, D: ['p', false], E: {} })
  })

  it('reads the real diskutil output of the test stick', () => {
    expect(STICK.VolumeUUID).toBe('B10C96EF-51C2-344E-B78D-DAFC319D973E')
  })
})

describe('macOS: isUsbVolume', () => {
  it('takes the removable stick', () => {
    expect(isUsbVolume(STICK)).toBe(true)
  })

  // Measured on the real stick (Task 1): diskutil reports Removable and RemovableMedia false
  // for it, and only RemovableMediaOrExternalDevice and Ejectable true. A filter on the
  // first two would never list a real stick.
  it('takes the real stick although diskutil says Removable false', () => {
    expect(STICK.Removable).toBe(false)
    expect(STICK.RemovableMedia).toBe(false)
    expect(isUsbVolume(STICK)).toBe(true)
    expect(isUsbVolume({ ...STICK, RemovableMediaOrExternalDevice: false, Ejectable: false })).toBe(
      false,
    )
  })

  // Never the system disk; a network share never gets here (diskutil does not know it).
  it('refuses the internal disk and disk images', () => {
    expect(isUsbVolume(INTERNAL)).toBe(false)
    expect(isUsbVolume({ ...STICK, BusProtocol: 'Disk Image' })).toBe(false)
    expect(isUsbVolume({ ...STICK, Internal: true })).toBe(false)
  })

  it('needs a mount point under /Volumes and a UUID', () => {
    expect(isUsbVolume({ ...STICK, MountPoint: '' })).toBe(false)
    expect(isUsbVolume({ ...STICK, VolumeUUID: undefined })).toBe(false)
  })
})

describe('filesystemOf and schemeOf', () => {
  it('names the filesystems the players care about', () => {
    expect(filesystemOf(STICK)).toBe('exfat')
    expect(filesystemOf({ FilesystemType: 'msdos', FilesystemName: 'MS-DOS FAT32' })).toBe('fat32')
    expect(filesystemOf({ FilesystemType: 'hfs' })).toBe('hfs')
    expect(filesystemOf({ FilesystemType: 'apfs' })).toBe('apfs')
  })

  // GPT is the other thing a CDJ-2000 or NXS2 cannot read.
  it('names the partition scheme of the whole disk', () => {
    expect(['mbr', 'gpt']).toContain(schemeOf(WHOLE))
    expect(schemeOf({ Content: 'FDisk_partition_scheme' })).toBe('mbr')
    expect(schemeOf({ Content: 'GUID_partition_scheme' })).toBe('gpt')
    expect(schemeOf(null)).toBe('other')
  })
})

describe('macOS: darwinSource and readVolumes', () => {
  const deps = (infos: Record<string, DiskutilInfo | null>) => ({
    list: async () => Object.keys(infos).filter((k) => k.startsWith('/Volumes/')),
    info: async (target: string) => infos[target] ?? null,
  })

  // Two sticks with the same name mount as "Vicent" and "Vicent 1"; each is its own UUID.
  it('lists only the removable volumes, each by its UUID', async () => {
    const twin = {
      ...STICK,
      VolumeUUID: 'OTHER-UUID',
      MountPoint: '/Volumes/Vicent 1',
      VolumeName: 'Vicent',
    }
    const source = darwinSource(
      deps({
        '/Volumes/Surco': STICK,
        '/Volumes/Vicent 1': twin,
        '/Volumes/Macintosh HD': INTERNAL,
        '/Volumes/Public': null,
        [String(STICK.ParentWholeDisk)]: WHOLE,
      }),
    )
    const vols = await readVolumes(source, await memory(), holder)
    expect(vols.map((v) => [v.uuid, v.mountPoint])).toEqual([
      ['B10C96EF-51C2-344E-B78D-DAFC319D973E', '/Volumes/Surco'],
      ['OTHER-UUID', '/Volumes/Vicent 1'],
    ])
    expect(vols[0].filesystem).toBe('exfat')
    expect(vols[0].totalBytes).toBeGreaterThan(0)
  })

  it('reads the UUID at a mount point right now', async () => {
    expect(await darwinSource(deps({ '/Volumes/Surco': STICK })).idAt('/Volumes/Surco')).toBe(
      'B10C96EF-51C2-344E-B78D-DAFC319D973E',
    )
    expect(await darwinSource(deps({})).idAt('/Volumes/Surco')).toBeNull()
  })
})

describe('Windows: parseWindowsVolumes', () => {
  // A USB stick (DriveType 2) and a USB SSD (fixed, but on the USB bus) are offered; the
  // system disk, the CD drive and the mapped NAS share are not.
  it('keeps the removable volumes, by volume GUID, mounted at their drive root', () => {
    expect(parseWindowsVolumes(WIN)).toEqual([
      {
        uuid: '{6f1c2a7e-3b4d-11f0-9c2a-806e6f6e6963}',
        name: 'VICENT',
        mountPoint: 'E:\\',
        filesystem: 'fat32',
        partitionScheme: 'mbr',
        totalBytes: 31457280000,
        freeBytes: 22988390400,
      },
      {
        uuid: '{9a2d4c11-77e0-4b5a-8f3e-2c1d0e9f8a7b}',
        name: 'SSD SETS',
        mountPoint: 'F:\\',
        filesystem: 'exfat',
        partitionScheme: 'gpt',
        totalBytes: 500107862016,
        freeBytes: 300000000000,
      },
    ])
  })

  it('never offers a system or boot volume, even on USB', () => {
    const [, stick] = WIN as Record<string, unknown>[]
    expect(parseWindowsVolumes([{ ...stick, BootVolume: true }])).toEqual([])
    expect(parseWindowsVolumes([{ ...stick, SystemVolume: true }])).toEqual([])
  })

  // PowerShell gives an object, not an array, when there is one; garbage gives nothing.
  it('takes a single object and ignores what it cannot read', () => {
    const [, stick] = WIN as Record<string, unknown>[]
    expect(parseWindowsVolumes(stick)).toHaveLength(1)
    expect(parseWindowsVolumes(null)).toEqual([])
    expect(parseWindowsVolumes([{ DriveLetter: 'E:' }])).toEqual([])
  })

  it('names NTFS, which the players do not read', () => {
    const [, stick] = WIN as Record<string, unknown>[]
    expect(parseWindowsVolumes([{ ...stick, FileSystem: 'NTFS' }])[0].filesystem).toBe('ntfs')
  })

  it('asks for one drive letter when checking what is mounted there', async () => {
    const query = vi.fn(async (letter?: string) => (letter === 'E:' ? [(WIN as unknown[])[1]] : []))
    expect(await windowsSource(query).idAt('E:\\')).toBe('{6f1c2a7e-3b4d-11f0-9c2a-806e6f6e6963}')
    expect(query).toHaveBeenCalledWith('E:')
    expect(await windowsSource(query).idAt('G:\\')).toBeNull()
  })
})

describe('volumeContaining', () => {
  const vols = [
    {
      uuid: 'U1',
      name: 'SD',
      mountPoint: '/Volumes/SD',
      filesystem: 'fat32' as const,
      partitionScheme: 'mbr' as const,
      totalBytes: 1,
      freeBytes: 1,
    },
    {
      uuid: 'W1',
      name: 'VICENT',
      mountPoint: 'E:\\',
      filesystem: 'fat32' as const,
      partitionScheme: 'mbr' as const,
      totalBytes: 1,
      freeBytes: 1,
    },
  ]
  // "Otro destino" must be on a listed removable volume; the system disk never is.
  it('finds the removable volume a folder is on, or none', () => {
    expect(volumeContaining(vols, '/Volumes/SD/sets', 'darwin')?.uuid).toBe('U1')
    expect(volumeContaining(vols, '/Volumes/SDX/sets', 'darwin')).toBeNull()
    expect(volumeContaining(vols, '/Users/dj/Music', 'darwin')).toBeNull()
    expect(volumeContaining(vols, 'e:\\Sets', 'win32')?.uuid).toBe('W1')
    expect(volumeContaining(vols, 'C:\\Users\\dj', 'win32')).toBeNull()
  })
})

describe('stickHolder', () => {
  async function stick(files: string[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'stick-'))
    mkdirSync(join(root, 'PIONEER/rekordbox'), { recursive: true })
    for (const f of files) writeFileSync(join(root, 'PIONEER/rekordbox', f), 'x'.repeat(9))
    return root
  }

  it('is empty without export.pdb', async () => {
    expect(await stickHolder(await stick([]), null)).toEqual({ by: 'empty', at: null })
  })

  // baken always removes exportExt.pdb, rekordbox always writes it.
  it('is rekordbox when exportExt.pdb is there', async () => {
    expect((await stickHolder(await stick(['export.pdb', 'exportExt.pdb']), null)).by).toBe(
      'rekordbox',
    )
  })

  it('is Surco when export.pdb is the one Surco wrote, within FAT time resolution', async () => {
    const root = await stick(['export.pdb'])
    utimesSync(join(root, 'PIONEER/rekordbox/export.pdb'), 1000, 1000)
    expect((await stickHolder(root, { size: 9, mtimeMs: 1_001_500 })).by).toBe('surco')
    expect((await stickHolder(root, { size: 10, mtimeMs: 1_000_000 })).by).toBe('other')
  })
})

describe('watchVolumes on Windows', () => {
  // No /Volumes on Windows: the set of existing drive letters is checked every 2 s (a stat
  // per letter, cheap) and only a change reruns the PowerShell query.
  it('fires when a drive letter appears or goes', () => {
    vi.useFakeTimers()
    const present = new Set(['C:\\'])
    const onChange = vi.fn()
    const stop = watchVolumes('win32', onChange, {
      exists: (p) => present.has(p),
      intervalMs: 2000,
    })
    vi.advanceTimersByTime(2000)
    expect(onChange).not.toHaveBeenCalled()
    present.add('E:\\')
    vi.advanceTimersByTime(2000)
    expect(onChange).toHaveBeenCalledTimes(1)
    present.delete('E:\\')
    vi.advanceTimersByTime(2000)
    expect(onChange).toHaveBeenCalledTimes(2)
    stop()
  })
})
