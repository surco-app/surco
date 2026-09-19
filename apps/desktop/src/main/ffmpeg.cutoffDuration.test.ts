import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

const probes: string[][] = []
vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, out: { stdout: string; stderr: string }) => void,
  ) => {
    probes.push(args)
    cb(null, { stdout: '{"streams":[{}],"format":{"duration":"200.0"}}', stderr: '' })
  },
}))

const { measureBands } = vi.hoisted(() => ({
  measureBands: vi.fn(async (..._args: unknown[]) => new Map<string, number>()),
}))
vi.mock('./fftBands', () => ({ measureBands }))

import { analyzeCutoff } from './ffmpeg'

// The library sweep grades every flagged file a second time as if a second had been
// trimmed off it, to catch verdicts that sit on a threshold and flip with the probe
// grid (three user reports in four days were exactly that). Positioning the probes
// is the only thing the duration does, so the caller can hand one in and the file
// is never re-encoded or probed for it.
describe('analyzeCutoff with a given duration', () => {
  it('spreads the probes over the given duration instead of reading it off the file', async () => {
    await analyzeCutoff('/in.flac', 44100, undefined, 199)

    expect(measureBands).toHaveBeenCalledWith('/in.flac', expect.anything(), 44100, 199, undefined)
    expect(probes).toHaveLength(0)
  })
})
