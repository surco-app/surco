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

import { ipcMain } from 'electron'
import type { MediaAccess } from './mediaAccess'
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

beforeEach(() => {
  vi.clearAllMocks()
})

// shell:open/trash/reveal take a renderer-supplied path straight into an OS call —
// a compromised renderer could trash or launch any file the OS user can touch,
// not just a track this app actually knows about. mediaAccess already tracks
// every path the app has handed the renderer as a real track or conversion
// output (see mediaAccess.ts), so it's the allowlist to reuse here too.
describe('registerShellIpc — path allowlist', () => {
  it('refuses to open a path the app never handed to the renderer', async () => {
    registerShellIpc(fakeMediaAccess(['/music/allowed.wav']))
    const result = await handlerFor('shell:open')({}, '/etc/passwd')
    expect(openPath).not.toHaveBeenCalled()
    expect(result).toMatch(/not allowed|no permitid/i)
  })

  it('refuses to trash a path the app never handed to the renderer', async () => {
    registerShellIpc(fakeMediaAccess(['/music/allowed.wav']))
    await expect(handlerFor('shell:trash')({}, '/Users/me/Desktop/important.docx')).rejects.toThrow()
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('refuses to reveal a path the app never handed to the renderer', async () => {
    registerShellIpc(fakeMediaAccess(['/music/allowed.wav']))
    await handlerFor('shell:reveal')({}, '/Users/me/.ssh/id_rsa')
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('opens, trashes and reveals a path the app did hand to the renderer', async () => {
    registerShellIpc(fakeMediaAccess(['/music/allowed.wav']))
    await handlerFor('shell:open')({}, '/music/allowed.wav')
    await handlerFor('shell:trash')({}, '/music/allowed.wav')
    await handlerFor('shell:reveal')({}, '/music/allowed.wav')
    expect(openPath).toHaveBeenCalledWith('/music/allowed.wav')
    expect(trashItem).toHaveBeenCalledWith('/music/allowed.wav')
    expect(showItemInFolder).toHaveBeenCalledWith('/music/allowed.wav')
  })
})
