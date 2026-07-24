import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// audio:cached-batch reads through the real analysisCache (peekAnalysis) against a
// throwaway temp dir, exactly like analysisCache.test.ts, so the test proves the real
// key derivation lines up between a live probe's cachedAnalysis write and the batch's
// peekAnalysis read — a mocked cache could hide a namespace/key drift the real IPC
// would ship with.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-audio-ipc-cache-'))
  return { app: { getPath: () => dir }, ipcMain: { handle: vi.fn() } }
})
vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
// Every ffmpeg export the module imports, stubbed to a value the live handlers never
// exercise here — the batch handler under test never calls any of them (peek-only).
vi.mock('./ffmpeg', () => ({
  buildSpectrum: vi.fn(),
  cacheableSpectrum: vi.fn(),
  detectTrackClicks: vi.fn(),
  extractCover: vi.fn(),
  extractCoverDataUrl: vi.fn(),
  generateSpectrogram: vi.fn(),
  measureBpm: vi.fn(),
  measureChannelScan: vi.fn(),
  measureKey: vi.fn(),
  measureLoudness: vi.fn(),
  measureWaveform: vi.fn(),
  measureWaveformWindow: vi.fn(),
  probeAudio: vi.fn(),
  probeDuration: vi.fn(),
  probeProperties: vi.fn(),
  readMeta: vi.fn(),
  readTags: vi.fn(),
  renderDeclickRepaired: vi.fn(),
  tagsFromProbe: vi.fn(),
  analyzeCutoff: vi.fn(),
  analyzeShelf: vi.fn(),
}))
vi.mock('./playback', () => ({ previewTempPath: vi.fn() }))
vi.mock('./settings', () => ({ recordStat: vi.fn() }))
vi.mock('./activity', () => ({
  activity: { track: (_kind: string, _label: string, fn: () => unknown) => fn() },
}))
vi.mock('./analysisCancel', () => ({
  analysisCancels: {
    run: (_path: string, job: (s: AbortSignal) => unknown) => job(new AbortController().signal),
  },
  isAbortError: () => false,
}))
vi.mock('./analysisLimiter', () => ({
  analysisLimiter: { run: (fn: () => unknown) => fn() },
}))

import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { cachedAnalysis } from './analysisCache'
import { registerAudioIpc } from './audioIpc'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => unknown {
  const call = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
    ([ch]) => ch === channel,
  )
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1]
}

const work = mkdtempSync(join(tmpdir(), 'surco-audio-ipc-src-'))
afterAll(() => {
  rmSync(app.getPath('userData'), { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})

let counter = 0
async function makeFile(): Promise<string> {
  const path = join(work, `track-${counter++}.aiff`)
  await writeFile(path, 'audio')
  return path
}

beforeEach(() => {
  vi.clearAllMocks()
  rmSync(join(app.getPath('userData'), 'analysis-cache'), { recursive: true, force: true })
  registerAudioIpc(() => {})
})

describe('audio:cached-batch', () => {
  // The hydration's whole point: a warm spectrogram entry surfaces without invoking
  // any compute (ffmpeg is fully mocked above — a call would throw as "not a function"
  // wired for use, proving this path never falls through to a live probe).
  it('returns the cached spectrogram for a warm entry, keyed by path', async () => {
    const file = await makeFile()
    await cachedAnalysis('spectrogram-mono-v13', file, async () => ({
      image: 'data:image/png;base64,x',
      cutoffHz: 20000,
      sampleRateHz: 44100,
      processed: false,
    }))

    const result = (await handlerFor('audio:cached-batch')({}, [file])) as Record<
      string,
      { spectrogram?: unknown; waveformScan?: unknown }
    >

    expect(result[file].spectrogram).toEqual({
      image: 'data:image/png;base64,x',
      cutoffHz: 20000,
      sampleRateHz: 44100,
      processed: false,
    })
  })

  // The channel-scan clip flags feed the attention filter's clipping bucket — the
  // second (and only other) family the list actually reads.
  it('returns the cached channel scan for a warm entry', async () => {
    const file = await makeFile()
    await cachedAnalysis('channelscan-v1', file, async () => ({ clipped: [false, true] }))

    const result = (await handlerFor('audio:cached-batch')({}, [file])) as Record<
      string,
      { spectrogram?: unknown; waveformScan?: unknown }
    >

    expect(result[file].waveformScan).toEqual({ clipped: [false, true] })
  })

  // A cold path (never analyzed) is simply absent from the response — never an entry
  // with undefined/null fields the renderer would have to special-case.
  it('omits a path with no cached entry for either family', async () => {
    const file = await makeFile()

    const result = (await handlerFor('audio:cached-batch')({}, [file])) as Record<string, unknown>

    expect(result[file]).toBeUndefined()
  })

  // The batch must never fall through to a live compute — no ffmpeg mock is wired to
  // resolve, so a heavy waveform-v5/loudness/bpm/key/properties/clicks entry (deliberately
  // NOT hydrated — see the handler's comment) must never even be looked up here.
  it('does not hydrate the heavy waveform peaks family', async () => {
    const file = await makeFile()
    await cachedAnalysis('waveform-v5', file, async () => ({
      peaks: [0.1],
      rms: [0.1],
      durationSec: 1,
    }))

    const result = (await handlerFor('audio:cached-batch')({}, [file])) as Record<
      string,
      { waveform?: unknown }
    >

    expect(result[file]?.waveform).toBeUndefined()
  })

  // One IPC round trip serves many paths at once — the whole point versus a probe
  // per track — and each track's hit/miss is independent.
  it('serves multiple paths in one call, each independently', async () => {
    const warm = await makeFile()
    const cold = await makeFile()
    await cachedAnalysis('spectrogram-mono-v13', warm, async () => ({
      image: 'x',
      cutoffHz: 1,
      sampleRateHz: 44100,
      processed: false,
    }))

    const result = (await handlerFor('audio:cached-batch')({}, [warm, cold])) as Record<
      string,
      unknown
    >

    expect(result[warm]).toBeDefined()
    expect(result[cold]).toBeUndefined()
  })
})
