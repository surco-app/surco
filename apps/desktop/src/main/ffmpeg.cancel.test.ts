import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

// Capture every spawn so we can assert the cancellable analysis reads hand their
// AbortSignal to execFile — Node kills the child on abort, which is the only way a
// deselected track's decode ever stops burning cores.
const calls: Array<{ file: string; args: string[]; opts: { signal?: AbortSignal } | undefined }> =
  []

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    opts: { signal?: AbortSignal } | undefined,
    cb: (err: unknown, out: { stdout: string; stderr: string }) => void,
  ) => {
    calls.push({ file, args, opts })
    cb(null, { stdout: '{"streams":[{}],"format":{}}', stderr: '' })
  },
}))

import { analyzeCutoff, generateSpectrogram, measureLoudness, measureWaveform } from './ffmpeg'

beforeEach(() => {
  calls.length = 0
})

// Browsing tracks quickly leaves each abandoned row's analyses decoding to completion,
// holding limiter slots the newly selected track then waits behind. Cancellation only
// works end to end if the signal actually reaches the ffmpeg child: a signal consumed
// anywhere short of execFile stops nothing.
describe('cancellable analysis reads pass their AbortSignal to execFile', () => {
  const swallow = (p: Promise<unknown>): Promise<unknown> => p.catch(() => undefined)

  it('hands the signal to every decode of the selected-track probes', async () => {
    const signal = new AbortController().signal
    await swallow(generateSpectrogram('/in.flac', signal))
    await swallow(analyzeCutoff('/in.flac', 44100, signal))
    await swallow(measureLoudness('/in.flac', signal))
    await swallow(measureWaveform('/in.flac', signal))

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.opts?.signal, `${call.args.join(' ')} ran without the signal`).toBe(signal)
    }
  })
})
