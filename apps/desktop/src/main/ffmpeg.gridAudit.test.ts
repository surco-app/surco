import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

const decodes: string[] = []
vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, out: { stdout: Buffer; stderr: string }) => void,
  ) => {
    decodes.push(args[args.indexOf('-i') + 1])
    cb(null, { stdout: Buffer.from(new Float32Array(11025).buffer), stderr: '' })
  },
}))

const runInWorker = vi.hoisted(() =>
  vi.fn(async () => ({ windows: [], total: 0, minutes: 1, fit: null })),
)
vi.mock('./worker', () => ({ runInWorker, signalWorkers: vi.fn() }))

import { measureGridAudit } from './ffmpeg'

function track(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'surco-audit-pcm-')), 'a.wav')
  writeFileSync(file, 'audio')
  return file
}

beforeEach(() => {
  decodes.length = 0
})

describe('measureGridAudit', () => {
  it('decodes a track once while its grid is being moved, so each nudge answers at once', async () => {
    const file = track()
    await measureGridAudit(file, [0, 500], 0, true)
    await measureGridAudit(file, [5, 505], 0, false)
    await measureGridAudit(file, [10, 510], 0, false)
    expect(decodes).toEqual([file])
    expect(runInWorker).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'gridAudit', beats: [10, 510], withFit: false }),
    )
  })

  it('decodes again once the file changes on disk, so a converted track is never judged on its old audio', async () => {
    const file = track()
    await measureGridAudit(file, [0, 500], 0, true)
    writeFileSync(file, 'other audio')
    utimesSync(file, new Date(), new Date(Date.now() + 5000))
    await measureGridAudit(file, [0, 500], 0, true)
    expect(decodes).toEqual([file, file])
  })
})
