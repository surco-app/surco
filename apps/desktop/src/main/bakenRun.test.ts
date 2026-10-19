import { writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type BakenArgsInput,
  type BakenEvent,
  BakenGuardError,
  bakenArgs,
  parseBakenLine,
  runBaken,
} from './bakenRun'
import type { Stage } from './usbExportStage'

const stage = (dir: string, settings: string | null = `${dir}/settings`): Stage => ({
  dir,
  xml: `${dir}/collection.xml`,
  anlzDir: `${dir}/USBANLZ`,
  artworkDir: `${dir}/artwork`,
  settingsDir: settings,
  included: [],
  missing: [],
  sizes: new Map(),
  waves: new Map(),
  covers: new Map(),
  masterIds: null,
})

const MAC: BakenArgsInput = {
  stage: stage('/tmp/s'),
  device: '/Volumes/Vicent 1',
  target: 'volume',
  prune: false,
  settings: true,
  dryRun: false,
  platform: 'darwin',
  home: '/Users/dj',
  pioneerDir: '/Users/dj/Library/Pioneer',
  systemRoot: '/',
}
const WIN: BakenArgsInput = {
  stage: stage('C:\\Users\\dj\\AppData\\Local\\Temp\\surco-usb-1'),
  device: 'E:\\',
  target: 'volume',
  prune: false,
  settings: true,
  dryRun: false,
  platform: 'win32',
  home: 'C:\\Users\\dj',
  pioneerDir: 'C:\\Users\\dj\\AppData\\Roaming\\Pioneer',
  systemRoot: 'C:\\',
}

describe('bakenArgs', () => {
  // baken left alone looks for rekordbox's analysis and settings in the Pioneer folder; Surco
  // always hands it the staged copies so it never goes there.
  it('always passes the staged analysis, artwork, OneLibrary and JSON', () => {
    expect(bakenArgs(MAC)).toEqual([
      'expressport',
      '/tmp/s/collection.xml',
      '--device',
      '/Volumes/Vicent 1',
      '--anlz-dir',
      '/tmp/s/USBANLZ',
      '--settings-dir',
      '/tmp/s/settings',
      '--onelibrary',
      '--artwork',
      '--artwork-dir',
      '/tmp/s/artwork',
      '--generate-analysis',
      '--device-name',
      '',
      '--json',
      '--keep-rekordbox-ext',
    ])
  })

  // exportExt.pdb holds rekordbox's My Tag rows, which baken cannot write; removing it
  // would lose them, on a dry run's plan as much as on the real one.
  it("passes the identity and keeps rekordbox's files", () => {
    const withIds = { ...stage('/tmp/s'), masterIds: '/tmp/s/master-ids.json' }
    const args = bakenArgs({ ...MAC, stage: withIds })
    expect(args[args.indexOf('--master-ids') + 1]).toBe('/tmp/s/master-ids.json')
    expect(bakenArgs({ ...MAC, dryRun: true })).toContain('--keep-rekordbox-ext')
    expect(bakenArgs(MAC)).not.toContain('--master-ids')
  })

  // My Settings are opt-in: unticked (or none staged), the player keeps its own.
  it('writes no settings unless asked and staged', () => {
    expect(bakenArgs({ ...MAC, settings: false })).toContain('--no-settings')
    expect(bakenArgs({ ...MAC, stage: stage('/tmp/s', null) })).toContain('--no-settings')
    expect(bakenArgs({ ...MAC, settings: false })).not.toContain('--settings-dir')
  })

  // Deleting music is the user's explicit choice, and never inside a folder picked by hand:
  // its Contents/ may be anything.
  it('prunes only a volume, only when asked', () => {
    expect(bakenArgs(MAC)).not.toContain('--prune')
    expect(bakenArgs({ ...MAC, prune: true })).toContain('--prune')
    expect(bakenArgs({ ...MAC, prune: true, target: 'folder' })).not.toContain('--prune')
    expect(bakenArgs({ ...MAC, dryRun: true })).toContain('--dry-run')
  })

  it('refuses rekordbox own folder, the home folder or the system root on macOS', () => {
    for (const device of [
      '/Users/dj/Library/Pioneer',
      '/Users/dj/Library/Pioneer/rekordbox',
      '/Users/dj',
      '/',
    ])
      expect(() => bakenArgs({ ...MAC, device })).toThrow(BakenGuardError)
    expect(() => bakenArgs({ ...MAC, stage: stage('/Users/dj/Library/Pioneer/x') })).toThrow(
      BakenGuardError,
    )
  })

  // Same rules with drive letters; Windows paths compare without case.
  it('refuses the Pioneer folder, the home folder and the system drive on Windows', () => {
    expect(bakenArgs(WIN)).toContain('E:\\')
    for (const device of [
      'C:\\',
      'c:\\',
      'C:\\Users\\dj',
      'c:\\users\\DJ\\AppData\\Roaming\\Pioneer\\rekordbox',
    ])
      expect(() => bakenArgs({ ...WIN, device })).toThrow(BakenGuardError)
    expect(() =>
      bakenArgs({ ...WIN, stage: stage('C:\\Users\\dj\\AppData\\Roaming\\Pioneer\\tmp') }),
    ).toThrow(BakenGuardError)
  })
  // APFS and NTFS ignore case, so a differently-cased spelling is the same folder.
  it('compares case-insensitively on macOS too', () => {
    for (const device of ['/users/dj/library/pioneer', '/USERS/DJ'])
      expect(() => bakenArgs({ ...MAC, device })).toThrow(BakenGuardError)
  })

  // baken writes <device>/PIONEER; a device above the Pioneer folder would reach it.
  it('refuses a device that contains the Pioneer folder', () => {
    expect(() => bakenArgs({ ...MAC, device: '/Users/dj/Library' })).toThrow(BakenGuardError)
    expect(() => bakenArgs({ ...WIN, device: 'C:\\Users\\dj\\AppData\\Roaming' })).toThrow(
      BakenGuardError,
    )
    expect(() => bakenArgs({ ...WIN, device: 'C:\\Users' })).toThrow(BakenGuardError)
  })

  it('refuses an identity file inside the rekordbox folder', () => {
    const s = { ...stage('/tmp/s'), masterIds: '/Users/dj/Library/Pioneer/master-ids.json' }
    expect(() => bakenArgs({ ...MAC, stage: s })).toThrow(BakenGuardError)
  })

  it('refuses an XML staged inside the Pioneer folder', () => {
    const s = { ...stage('/tmp/s'), xml: '/Users/dj/Library/Pioneer/collection.xml' }
    expect(() => bakenArgs({ ...MAC, stage: s })).toThrow(BakenGuardError)
  })
})

describe('parseBakenLine', () => {
  it('reads the events of the protocol', () => {
    expect(
      parseBakenLine('{"event":"start","index":0,"usbPath":"/Contents/a.wav","size":5}'),
    ).toEqual({
      event: 'start',
      index: 0,
      usbPath: '/Contents/a.wav',
      size: 5,
    })
    expect(parseBakenLine('{"event":"database"}')).toEqual({ event: 'database' })
  })

  // A stray line (a panic message, a future event) must not end the run.
  it('ignores what is not an event', () => {
    expect(parseBakenLine('thread main panicked')).toBeNull()
    expect(parseBakenLine('{"event":"later"}')).toBeNull()
    expect(parseBakenLine('')).toBeNull()
  })
})

describe('runBaken', () => {
  // A fake baken speaking the same lines, so the spawn, the line splitting and the cancel
  // request are exercised without the real binary or a stick.
  async function fake(body: string): Promise<{ file: string; prefixArgs: string[] }> {
    const script = join(await mkdtemp(join(tmpdir(), 'fake-baken-')), 'baken.cjs')
    writeFileSync(script, body)
    return { file: process.execPath, prefixArgs: [script] }
  }

  it('hands over each event in order and the exit status', async () => {
    const cmd = await fake(`
      const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
      out({ event: 'start', index: 0, usbPath: '/Contents/a.wav', size: 3 })
      process.stdout.write('{"event":"written","ind')
      setTimeout(() => { process.stdout.write('ex":0,"kept":false}\\n'); out({ event: 'database' }); process.exit(0) }, 20)
    `)
    const seen: BakenEvent[] = []
    const { code } = await runBaken(cmd, [], (e) => seen.push(e)).done
    expect(code).toBe(0)
    expect(seen.map((e) => e.event)).toEqual(['start', 'written', 'database'])
  })

  it('turns the update check off', async () => {
    const cmd = await fake(
      `process.stdout.write(JSON.stringify({ event: 'error', kind: 'other', message: process.env.BAKEN_NO_UPDATE_CHECK }) + '\\n')`,
    )
    const seen: BakenEvent[] = []
    await runBaken(cmd, [], (e) => seen.push(e)).done
    expect(seen[0]).toMatchObject({ message: '1' })
  })

  // Cancel is a line on stdin, which reaches a child process on Windows too (no SIGINT
  // there); baken answers with its report once the track in progress is done.
  it('asks for a cancel on stdin and waits for the report', async () => {
    const cmd = await fake(`
      require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
        if (l === 'cancel') { process.stdout.write(JSON.stringify({ event: 'report', cancelled: true }) + '\\n'); process.exit(0) }
      })
    `)
    const seen: BakenEvent[] = []
    const handle = runBaken(cmd, [], (e) => seen.push(e))
    handle.cancel()
    const { code } = await handle.done
    expect(code).toBe(0)
    expect(seen).toEqual([{ event: 'report', cancelled: true }])
  })

  // A cancel that lands during the last track still gets a normal report: it is a finished
  // run, and the runner just passes the event on.
  it('passes on a report that says cancelled false after a cancel', async () => {
    const cmd = await fake(`
      require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
        if (l === 'cancel') { process.stdout.write(JSON.stringify({ event: 'report', cancelled: false, copied: 1 }) + '\\n'); process.exit(0) }
      })
    `)
    const seen: BakenEvent[] = []
    const handle = runBaken(cmd, [], (e) => seen.push(e))
    handle.cancel()
    await handle.done
    expect(seen).toEqual([{ event: 'report', cancelled: false, copied: 1 }])
  })

  // baken sorts the keys of its lines, so the event name is rarely first.
  it('reads a line whose event key is not first', () => {
    expect(parseBakenLine('{"index":2,"kept":true,"event":"written"}')).toEqual({
      event: 'written',
      index: 2,
      kept: true,
    })
  })

  // A binary that cannot start (missing, not executable) says so instead of hanging.
  it('reports a process that never started', async () => {
    const { code, started } = await runBaken(
      { file: '/nonexistent/baken', prefixArgs: [] },
      [],
      () => {},
    ).done
    expect(code).toBeNull()
    expect(started).toBe(false)
  })
})
