import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

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
    await swallow(generateSpectrogram('/in.flac', 44100, signal))
    await swallow(analyzeCutoff('/in.flac', 44100, signal))
    await swallow(measureLoudness('/in.flac', signal))

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.opts?.signal, `${call.args.join(' ')} ran without the signal`).toBe(signal)
    }
  })

  // measureWaveform is deliberately not in the sweep above. Its envelope no longer has a
  // decode of its own: it rides the native scan, which is spawned inside the analysis
  // worker and so never reaches this execFile mock at all. What it still runs here is the
  // cheap ffprobe for the sample rate — metadata, milliseconds, nothing a browsed-past
  // track needs killed. Its cancellation is reference-counted instead, because the scan is
  // shared with audio:waveform-scan (see sharedScan.ts): the decode stops when the last
  // consumer leaves, not the first. What must hold here is that an already-aborted signal
  // never starts work at all.
  it('does not decode at all when the waveform signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await swallow(measureWaveform('/in.flac', controller.signal))
    expect(calls).toHaveLength(0)
  })
})
