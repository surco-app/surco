import { beforeEach, describe, expect, it, vi } from 'vitest'

const openPath = vi.fn(async (_path: string) => '')
const trashItem = vi.fn(async (_path: string) => {})
const showItemInFolder = vi.fn((_path: string) => {})
const writeText = vi.fn((_text: string) => {})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  clipboard: { writeText: (text: string) => writeText(text) },
  shell: {
    openPath: (path: string) => openPath(path),
    trashItem: (path: string) => trashItem(path),
    showItemInFolder: (path: string) => showItemInFolder(path),
  },
}))
vi.mock('electron-log/main', () => ({
  default: { transports: { file: { getFile: () => ({ path: '/logs/main.log' }) } } },
}))

let keepsTrash = true
vi.mock('./trashSupport', () => ({ volumeKeepsTrash: () => keepsTrash }))

import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { setLibraryBackupRoot } from './libraryBackups'
import type { MediaAccess } from './mediaAccess'
import { configureBackupStore, configureOriginalKeeper } from './originalKeeper'
import { registerShellIpc } from './shellIpc'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => unknown {
  const call = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
    ([ch]) => ch === channel,
  )
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1]
}

function fakeMediaAccess(allowed: string[]): MediaAccess {
  return {
    allow: vi.fn(),
    allowAll: vi.fn(),
    isAllowed: (path) => allowed.includes(path),
  }
}

const unused = async () => false

beforeEach(() => {
  vi.clearAllMocks()
  keepsTrash = true
  configureOriginalKeeper(null)
})

// shell:open/trash/reveal take a renderer-supplied path straight into an OS call —
// a compromised renderer could trash or launch any file the OS user can touch,
// not just a track this app actually knows about. mediaAccess already tracks
// every path the app has handed the renderer as a real track or conversion
// output (see mediaAccess.ts), so it's the allowlist to reuse here too.
describe('registerShellIpc — path allowlist', () => {
  it('refuses to open a path the app never handed to the renderer', async () => {
    registerShellIpc(fakeMediaAccess(['/music/allowed.wav']), unused)
    const result = await handlerFor('shell:open')({}, '/etc/passwd')
    expect(openPath).not.toHaveBeenCalled()
    expect(result).toMatch(/^SURCO_ERR:pathNotAllowed/)
  })

  it('refuses to trash a path the app never handed to the renderer', async () => {
    registerShellIpc(fakeMediaAccess(['/music/allowed.wav']), unused)
    await expect(handlerFor('shell:trash')({}, '/Users/me/Desktop/important.docx')).rejects.toThrow(
      /^SURCO_ERR:pathNotAllowed/,
    )
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('refuses to reveal a path the app never handed to the renderer', async () => {
    registerShellIpc(fakeMediaAccess(['/music/allowed.wav']), unused)
    await handlerFor('shell:reveal')({}, '/Users/me/.ssh/id_rsa')
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('opens, trashes and reveals a path the app did hand to the renderer', async () => {
    registerShellIpc(fakeMediaAccess(['/music/allowed.wav']), unused)
    await handlerFor('shell:open')({}, '/music/allowed.wav')
    await handlerFor('shell:trash')({}, '/music/allowed.wav')
    await handlerFor('shell:reveal')({}, '/music/allowed.wav')
    expect(openPath).toHaveBeenCalledWith('/music/allowed.wav')
    expect(trashItem).toHaveBeenCalledWith('/music/allowed.wav')
    expect(showItemInFolder).toHaveBeenCalledWith('/music/allowed.wav')
  })
})

// The trash and clean-up dialogs say "deleted for good" before the user confirms, under
// "Never" on a disk with no Trash. The confirmation travels with the call, and without
// it main refuses rather than delete a file the dialog promised to keep.
describe('registerShellIpc — a delete for good', () => {
  const stash = vi.fn(async () => null)

  function nasFile(): string {
    const file = join(mkdtempSync(join(tmpdir(), 'surco-shell-trash-')), 'a.mp3')
    writeFileSync(file, 'audio')
    keepsTrash = false
    configureBackupStore({ stash, remove: async () => {} }, () => 'never')
    registerShellIpc(fakeMediaAccess([file]), unused)
    return file
  }

  it('refuses it when the user did not confirm a permanent delete', async () => {
    const file = nasFile()
    await expect(handlerFor('shell:trash')({}, file)).rejects.toThrow()
    await expect(handlerFor('shell:trash')({}, file, 'yes')).rejects.toThrow()
    expect(existsSync(file)).toBe(true)
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('hands the renderer the backup id of a file kept on a disk with no Trash, so Undo can put it back', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'surco-shell-trash-')), 'a.mp3')
    writeFileSync(file, 'audio')
    keepsTrash = false
    const entry = {
      id: 'backup-1',
      name: 'a.mp3',
      originalPath: file,
      storedPath: '',
      bytes: 0,
      trashedAt: 0,
      reason: 'deleted' as const,
    }
    configureBackupStore(
      { stash: vi.fn(async () => entry), remove: async () => {} },
      () => 'audioChanges',
    )
    registerShellIpc(fakeMediaAccess([file]), unused)
    expect(await handlerFor('shell:trash')({}, file, false)).toEqual({
      where: 'surco',
      id: 'backup-1',
    })
  })

  it('deletes the file when the user confirmed it under never on a disk with no Trash', async () => {
    const file = nasFile()
    await handlerFor('shell:trash')({}, file, true)
    expect(existsSync(file)).toBe(false)
    expect(trashItem).not.toHaveBeenCalled()
  })
})

// The automatic retirement after a format change: no dialog stands before it, so main asks
// the DJ libraries itself, right before the file goes.
describe('shell:retireSuperseded', () => {
  function file(): string {
    const path = join(mkdtempSync(join(tmpdir(), 'surco-shell-retire-')), 'a.mp3')
    writeFileSync(path, 'audio')
    return path
  }

  it('refuses a path the app never handed to the renderer', async () => {
    const path = file()
    registerShellIpc(fakeMediaAccess([]), unused)
    await expect(handlerFor('shell:retireSuperseded')({}, path)).rejects.toThrow(
      /^SURCO_ERR:pathNotAllowed/,
    )
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('leaves a file a DJ library still uses where it is', async () => {
    const path = file()
    const usedByLibrary = vi.fn(async () => true)
    registerShellIpc(fakeMediaAccess([path]), usedByLibrary)
    expect(await handlerFor('shell:retireSuperseded')({}, path, ['A', 'a.mp3'])).toBe('used')
    expect(usedByLibrary).toHaveBeenCalledWith(path, ['A', 'a.mp3'])
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('asks with no titles when the renderer sent something else', async () => {
    const path = file()
    const usedByLibrary = vi.fn(async () => true)
    registerShellIpc(fakeMediaAccess([path]), usedByLibrary)
    await handlerFor('shell:retireSuperseded')({}, path, 'A')
    expect(usedByLibrary).toHaveBeenCalledWith(path, [])
  })

  it('sends a file no library uses to the Trash', async () => {
    const path = file()
    registerShellIpc(fakeMediaAccess([path]), unused)
    expect(await handlerFor('shell:retireSuperseded')({}, path)).toBe('retired')
    expect(trashItem).toHaveBeenCalledWith(path)
  })

  it('deletes it for good under never on a disk with no Trash', async () => {
    const path = file()
    keepsTrash = false
    configureBackupStore({ stash: vi.fn(async () => null), remove: async () => {} }, () => 'never')
    registerShellIpc(fakeMediaAccess([path]), unused)
    expect(await handlerFor('shell:retireSuperseded')({}, path)).toBe('retired')
    expect(existsSync(path)).toBe(false)
  })
})

describe('backups:reveal', () => {
  // A DJ who never had a write go wrong has no copies yet: the button still opens the
  // folder rather than failing on one that does not exist.
  it('opens the library backups folder, creating it when there is none yet', async () => {
    const root = join(mkdtempSync(join(tmpdir(), 'surco-reveal-')), 'backups')
    setLibraryBackupRoot(root)
    registerShellIpc(fakeMediaAccess([]), unused)
    await handlerFor('backups:reveal')({})
    expect(existsSync(root)).toBe(true)
    expect(openPath).toHaveBeenCalledWith(root)
  })
})

describe('files:sameFile', () => {
  // A file opened through a symlinked folder has another path than the one Music or a DJ
  // program indexed for it: by the path text it looked like a separate copy, and Replace
  // put the file in place of itself.
  it('tells a file opened through a symlinked folder is the library copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-same-'))
    mkdirSync(join(dir, 'Music'))
    const real = join(dir, 'Music', 'Strobe.wav')
    writeFileSync(real, 'x')
    symlinkSync(join(dir, 'Music'), join(dir, 'Linked'))
    const opened = join(dir, 'Linked', 'Strobe.wav')
    registerShellIpc(fakeMediaAccess([opened]), unused)
    expect(await handlerFor('files:sameFile')({}, opened, real)).toBe(true)
  })

  it('tells two different files apart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-same-'))
    const a = join(dir, 'a.wav')
    const b = join(dir, 'b.wav')
    writeFileSync(a, 'x')
    writeFileSync(b, 'x')
    registerShellIpc(fakeMediaAccess([a]), unused)
    expect(await handlerFor('files:sameFile')({}, a, b)).toBe(false)
  })

  // Stat answers about any file on disk: only a path the app handed out may be asked about.
  it('answers nothing about a file the app never handed out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-same-'))
    const a = join(dir, 'a.wav')
    writeFileSync(a, 'x')
    registerShellIpc(fakeMediaAccess([]), unused)
    expect(await handlerFor('files:sameFile')({}, a, a)).toBe(false)
  })
})
