import { basename } from 'node:path'
import { ipcMain } from 'electron'
import log from 'electron-log/main'
import type { DeclickMode, SpectrumResult, WaveformScan } from '../shared/types'
import { activity } from './activity'
import { cachedAnalysis, peekAnalysis } from './analysisCache'
import { analysisCancels, isAbortError } from './analysisCancel'
import { analysisLimiter } from './analysisLimiter'
import {
  analyzeCutoff,
  analyzeShelf,
  buildSpectrum,
  cacheableSpectrum,
  detectTrackClicks,
  extractCover,
  extractCoverDataUrl,
  generateSpectrogram,
  measureBpm,
  measureChannelScan,
  measureKey,
  measureLoudness,
  measureWaveform,
  measureWaveformWindow,
  probeAudio,
  probeDuration,
  probeProperties,
  readMeta,
  readTags,
  renderDeclickRepaired,
  tagsFromProbe,
} from './ffmpeg'
import { previewTempPath } from './playback'
import { recordStat } from './settings'

// Reports one quality probe to the activity log, grouped under its track so a sweep's
// six probes per file fold onto a single "Analizando «file»" row rather than flooding
// the feed. Wrapped around the cache-miss work only (passed as cachedAnalysis' producer),
// so a cache hit — which does no ffmpeg — emits nothing. The file's base name titles the
// group: these handlers only have the path, not the parsed artist/title.
function probe<T>(labelKey: string, inputPath: string, fn: () => Promise<T>): Promise<T> {
  return activity.track('analyze', labelKey, fn, {
    group: inputPath,
    groupLabel: basename(inputPath),
  })
}

// A signal for the probe's ffmpeg decodes, but only for foreground ('urgent'/'high')
// requests — the selected/playing track the renderer can later disown
// (audio:cancelAnalysis) when the user browses away. 'low' background work (import
// auto-analyze, the "analyze all" sweep) gets a signal that never fires, so browsing
// across the rows a sweep is working through can never kill the sweep's own decodes.
function cancellable<T>(
  inputPath: string,
  priority: 'urgent' | 'high' | 'low',
  job: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return priority !== 'low'
    ? analysisCancels.run(inputPath, job)
    : job(new AbortController().signal)
}

// The cachedAnalysis namespaces of every probe family, shared by the live handlers below
// and the audio:cached-batch handler so the two can never drift onto different keys for
// the same family — a batch peek under a stale namespace would silently show as a
// permanent miss instead of the warm hit the live handler already wrote.
const SPECTROGRAM_NAMESPACE = 'spectrogram-mono-v13'
const LOUDNESS_NAMESPACE = 'loudness'
const CLICKS_NAMESPACE = 'clickcount-v2'
const PROPERTIES_NAMESPACE = 'properties'
const BPM_NAMESPACE = 'bpm'
const KEY_NAMESPACE = 'key'
const WAVEFORM_NAMESPACE = 'waveform-v5'
const CHANNELSCAN_NAMESPACE = 'channelscan-v1'

// The read-only audio analysis IPC: tags, duration, cover and the cached quality probes
// (spectrogram, loudness, properties, bpm, key, waveform). Self-contained — these handlers
// depend only on the ffmpeg helpers, the analysis cache/limiter and the stats tally, never
// on any window or session state — so they live apart from the stateful handlers in index.ts.
// allowMedia is the one exception: the declick audition renders a temp WAV the renderer
// must stream back through surco://, and the allowlist lives with the protocol in index.ts.
// The in-flight preview render, so a preset change (or an explicit cancel) can kill it.
// Deliberately NOT run through analysisLimiter like the probes around it: this is a
// full-length encode running for tens of seconds, and parking it in a limiter slot would
// stall the waveform and loudness reads the editor needs *while the user waits*.
let declickRender: { kill: (signal: string) => void } | null = null

export function registerAudioIpc(allowMedia: (path: string) => void): void {
  ipcMain.handle('audio:tags', async (_e, inputPath: string) => {
    try {
      return await readTags(inputPath)
    } catch (err) {
      // A file ffmpeg can't read at all (a malformed header the repair pass couldn't
      // fix) shouldn't reject the whole metadata read — that rejection also discarded
      // the duration and cover read alongside it. Degrade to empty tags so the row
      // keeps its name-parsed fields, and log one concise line rather than ffmpeg's
      // full stderr dump.
      log.warn('audio:tags failed; using empty tags', inputPath, String(err))
      return tagsFromProbe({})
    }
  })

  ipcMain.handle('audio:duration', (_e, inputPath: string) => probeDuration(inputPath))

  // Import reads tags, duration and cover together so a big drop spawns two processes
  // per track (one ffprobe + one ffmpeg) instead of four across three separate calls.
  // readMeta swallows a probe failure into an empty result, so it never rejects.
  ipcMain.handle('audio:meta', (_e, inputPath: string) => readMeta(inputPath))

  ipcMain.handle('audio:cover', (_e, inputPath: string) => extractCover(inputPath))
  ipcMain.handle('audio:coverFull', (_e, inputPath: string) => extractCoverDataUrl(inputPath))

  ipcMain.handle(
    'audio:spectrogram',
    async (_e, inputPath: string, priority: 'high' | 'low' = 'low') => {
      try {
        // Cache only a clean run: a cutoff failure yields a valid image but a null
        // cutoff, and we'd rather retry that next open than pin it for the file's life.
        const { image, cutoffHz, sampleRateHz, processed, hasKnee, upsampled } =
          await cachedAnalysis(
            // Namespace carries the palette and the cutoff-algorithm generation, so
            // changing either invalidates entries cached under the previous one — they
            // regenerate on next open instead of serving stale colors or verdicts. v7
            // switches the image to a grayscale intensity map (recolored per theme in the
            // renderer), so older colored entries regenerate. v8 adds the FFT-band knee
            // (catches codec walls the biquad pass smears below its threshold). v9 dropped the
            // 2× intensity gain. v10 restores the full 120 dB range (v9's 60 dB clip hid the
            // HF transients Spek shows reaching ~22 kHz) and moves the "dead = background" job
            // to the recolor ramp's Spek-style low-end fade. v11 renders the image 320 px tall
            // (was 280) to match the taller panel so it is not upscaled. v12 catches a fake 320
            // whose HF spikes hide its wall behind the top-edge knee guard — the cached verdict
            // changed (Good→Bad), so old entries must regenerate to pick it up. v13 reports
            // full-band high-rate audio (96 kHz) at the ~22 kHz probed ceiling instead of the
            // 48 kHz Nyquist, so cutoffHz changed for those files and old entries must regenerate.
            SPECTROGRAM_NAMESPACE,
            inputPath,
            () =>
              probe('activity.probeSpectrogram', inputPath, () =>
                cancellable(inputPath, priority, async (signal) => {
                  // buildSpectrum fans its three decodes out in parallel, so wrapping the whole
                  // call in one limiter slot let it run 3 ffmpeg under a budget meant for 1 — a
                  // quality sweep then put ~3× the intended decodes on the cores. Instead each
                  // pass takes its own slot, so the limiter counts them honestly and caps the
                  // real ffmpeg count; buildSpectrum holds no slot itself, so the passes still
                  // overlap when slots are free (no single-track latency hit) and none waits on a
                  // slot it's also holding (no deadlock).
                  const built = await buildSpectrum(inputPath, {
                    probe: probeAudio,
                    spectrogram: (i) =>
                      analysisLimiter.run(() => generateSpectrogram(i, signal), priority, signal),
                    cutoff: (i, sr) =>
                      analysisLimiter.run(() => analyzeCutoff(i, sr, signal), priority, signal),
                    shelf: (i, sr) =>
                      analysisLimiter.run(() => analyzeShelf(i, sr, signal), priority, signal),
                  })
                  // This producer only runs on a cache miss (disk cache hits return above, and
                  // the renderer's React Query cache dedups repeats), so bumping here counts
                  // each track's quality analysis exactly once for the Stats tab.
                  recordStat('analyzed')
                  // Log the pass failures here, on the live compute only. A cutoff failure
                  // still yields a usable spectrogram, so log it (with ffmpeg's stderr)
                  // rather than reject — the only trace when it breaks on a machine we
                  // can't reach, e.g. Windows. The shelf probe is a best-effort secondary
                  // signal: a failure just means no shelf verdict. An aborted pass is not
                  // a failure: the user browsed away. The errors are stripped from the
                  // cached value (see cacheableSpectrum), so a hit can never re-log them.
                  if (built.cutoffError && !isAbortError(built.cutoffError))
                    log.error('audio:spectrogram cutoff analysis failed', built.cutoffError)
                  if (built.shelfError && !isAbortError(built.shelfError))
                    log.error('audio:spectrogram shelf analysis failed', built.shelfError)
                  return cacheableSpectrum(built)
                }),
              ),
            (b) => !b.cutoffFailed,
          )
        return { image, cutoffHz, sampleRateHz, processed, hasKnee, upsampled }
      } catch (err) {
        if (!isAbortError(err)) log.error('audio:spectrogram failed', err)
        throw err
      }
    },
  )

  ipcMain.handle(
    'audio:loudness',
    async (_e, inputPath: string, priority: 'high' | 'low' = 'low') => {
      try {
        return await cachedAnalysis(LOUDNESS_NAMESPACE, inputPath, () =>
          probe('activity.probeLoudness', inputPath, () =>
            cancellable(inputPath, priority, (signal) =>
              analysisLimiter.run(() => measureLoudness(inputPath, signal), priority, signal),
            ),
          ),
        )
      } catch (err) {
        if (!isAbortError(err)) log.error('audio:loudness failed', err)
        return null
      }
    },
  )

  // The repair section's clicks: the count for the header pill, and the marks the wave
  // draws (and "jump to the next click" seeks to) — one detector pass, one cache entry,
  // so the number and the marks can never disagree. v2: the v1 entries hold a bare
  // count, and a stale hit would leave a track showing its pill with no marks.
  ipcMain.handle(
    'audio:clicks',
    async (_e, inputPath: string, priority: 'high' | 'low' = 'low') => {
      try {
        return await cachedAnalysis(CLICKS_NAMESPACE, inputPath, () =>
          probe('activity.probeClicks', inputPath, () =>
            analysisLimiter.run(() => detectTrackClicks(inputPath), priority),
          ),
        )
      } catch (err) {
        log.error('audio:clicks failed', err)
        return null
      }
    },
  )

  ipcMain.handle('audio:properties', async (_e, inputPath: string) => {
    try {
      return await cachedAnalysis(PROPERTIES_NAMESPACE, inputPath, () =>
        probe('activity.probeProperties', inputPath, () => probeProperties(inputPath)),
      )
    } catch (err) {
      log.error('audio:properties failed', err)
      return null
    }
  })

  ipcMain.handle('audio:bpm', async (_e, inputPath: string, priority: 'high' | 'low' = 'low') => {
    try {
      // Unlike a null loudness (a parse failure worth retrying), a null here is
      // a real measurement — beatless material, or a corrupt file whose decode
      // overruns its buffer ceiling on every attempt (see decodeAnalysisPcm) —
      // so it is cached too; only a transient decode error (which throws) is
      // left uncached for a later retry.
      return await cachedAnalysis(
        BPM_NAMESPACE,
        inputPath,
        () =>
          probe('activity.probeBpm', inputPath, () =>
            analysisLimiter.run(() => measureBpm(inputPath), priority),
          ),
        () => true,
      )
    } catch (err) {
      log.error('audio:bpm failed', err)
      return null
    }
  })

  ipcMain.handle('audio:key', async (_e, inputPath: string, priority: 'high' | 'low' = 'low') => {
    try {
      // Same caching contract as audio:bpm: a null (atonal material, or the
      // corrupt-file overrun) is a real measurement and is cached; only a
      // transient decode error retries.
      return await cachedAnalysis(
        KEY_NAMESPACE,
        inputPath,
        () =>
          probe('activity.probeKey', inputPath, () =>
            analysisLimiter.run(() => measureKey(inputPath), priority),
          ),
        () => true,
      )
    } catch (err) {
      log.error('audio:key failed', err)
      return null
    }
  })

  ipcMain.handle(
    'audio:waveform',
    async (_e, inputPath: string, priority: 'urgent' | 'high' | 'low' = 'low') => {
      try {
        // Default shouldCache applies: a null waveform means ffmpeg decoded
        // nothing, which is worth retrying later (e.g. a file mid-download), so
        // only real envelopes are pinned.
        // Priority rides in from the caller: the player asks 'high' (the one decode a user is
        // actively waiting on, having just hit play), while the "analyze all" sweep asks 'low'
        // so its whole-crate waveform decodes don't crowd the player out of the high lane.
        // v2: results grew the per-channel lanes (WaveformResult.channels); entries
        // cached before that would pin waves with no split view forever.
        // v3: buckets went 2048 → 8192 for the ×32 zoom; older entries would pin
        // the blocky low-resolution wave the deeper zoom exists to replace.
        // v4: the clip/channel scan split into its own probe (audio:waveform-scan);
        // v3 entries carry the now-removed clipped/channels, so a rename drops them.
        // v5: results grew per-bucket rms for the two-layer draw; v4 entries have
        // no rms, so a rename re-decodes them rather than draw a body-less wave.
        return await cachedAnalysis(WAVEFORM_NAMESPACE, inputPath, () =>
          probe('activity.probeWaveform', inputPath, () =>
            cancellable(inputPath, priority, (signal) =>
              analysisLimiter.run(() => measureWaveform(inputPath, signal), priority, signal),
            ),
          ),
        )
      } catch (err) {
        if (!isAbortError(err)) log.error('audio:waveform failed', err)
        return null
      }
    },
  )

  // The heavy native-rate clip/channel scan, split from audio:waveform so only the
  // player/compare strip pays for it. Its own cache namespace, so each entry always holds a
  // complete answer for its own contract — the peaks-only wave is never starved of marks,
  // and this is never served a wave with no scan.
  ipcMain.handle('audio:waveform-scan', async (_e, inputPath: string) => {
    try {
      return await cachedAnalysis(CHANNELSCAN_NAMESPACE, inputPath, () =>
        probe('activity.probeWaveform', inputPath, () =>
          analysisLimiter.run(() => measureChannelScan(inputPath), 'high'),
        ),
      )
    } catch (err) {
      log.error('audio:waveform-scan failed', err)
      return null
    }
  })

  // Batch hydration for the track list on load: one round trip that peeks the disk
  // cache for every dropped path and returns whatever is already warm, computing
  // nothing on a miss (see peekAnalysis) — a cold library must not spawn ffmpeg for
  // every row just because the list asked. Hydrates exactly the two families the list's
  // verdict dots and filter counts read (see tracksSnapshot.ts SNAPSHOT_FAMILIES /
  // useTracksView.ts on the renderer side): spectrogram (the quality verdict) and the
  // channel scan (the clipping attention flag). Deliberately EXCLUDES waveform-v5: its
  // peaks/rms payload is ~0.5 MB per track, feeds only the silence attention flag, and
  // that lazy probe already runs cheaply off the player/analyze-sweep paths — hydrating
  // it here would turn a big library's opening batch into a multi-MB read for a filter
  // bucket few tracks even hit. loudness/properties/bpm/key/clicks are editor-only detail
  // panels; tracksSnapshot never reads them, so they stay lazy too.
  ipcMain.handle('audio:cached-batch', async (_e, paths: string[]) => {
    const entries = await Promise.all(
      paths.map(async (path) => {
        const [spectrogram, waveformScan] = await Promise.all([
          peekAnalysis<SpectrumResult>(SPECTROGRAM_NAMESPACE, path),
          peekAnalysis<WaveformScan>(CHANNELSCAN_NAMESPACE, path),
        ])
        const hit: { spectrogram?: SpectrumResult; waveformScan?: WaveformScan } = {}
        if (spectrogram) hit.spectrogram = spectrogram
        if (waveformScan) hit.waveformScan = waveformScan
        return [path, hit] as const
      }),
    )
    const result: Record<string, { spectrogram?: SpectrumResult; waveformScan?: WaveformScan }> = {}
    for (const [path, hit] of entries) {
      if (hit.spectrogram || hit.waveformScan) result[path] = hit
    }
    return result
  })

  // The deep zoom's on-demand slice, disk-cached per quantized window: the renderer
  // snaps startSec/durSec to a viewport-sized grid (windowFor) and fixes buckets, so a
  // window's key is stable across scrolls and revisits — a bounded handful of entries
  // per track, not one per scroll pixel. Re-decoding them on every revisit was the one
  // waveform stage still paying full ffmpeg cost on a cache-warm library. No activity
  // row (it fires per scroll step — the feed would flood). Params are clamped: the
  // renderer is trusted UI, but a compromised renderer must not be able to ask for an
  // unbounded decode. 'high' like the full waveform — the user is looking right at it.
  ipcMain.handle(
    'audio:waveformWindow',
    async (_e, inputPath: string, startSec: number, durSec: number, buckets: number) => {
      try {
        if (!Number.isFinite(startSec) || !Number.isFinite(durSec) || !Number.isFinite(buckets))
          return null
        const start = Math.max(0, startSec)
        const dur = Math.min(600, Math.max(0.05, durSec))
        const count = Math.min(4096, Math.max(16, Math.floor(buckets)))
        // The clamped params ride in the namespace so each quantized window keys its own
        // entry; the shared path+mtime hash still invalidates every window when the file
        // changes. v1: peaks+rms at WAVEFORM_SAMPLE_RATE — bump on any decode-shape change.
        const ns = `waveform-window-v1 ${start} ${dur} ${count}`
        return await cachedAnalysis(ns, inputPath, () =>
          analysisLimiter.run(() => measureWaveformWindow(inputPath, start, dur, count), 'high'),
        )
      } catch (err) {
        log.error('audio:waveformWindow failed', err)
        return null
      }
    },
  )

  // The declick audition: a 20 s excerpt holding only what the chosen repair mode
  // would remove, served back through surco:// (hence the allowMedia). Not cached —
  // the render is a couple of seconds and the renderer replays the same temp WAV
  // until the track or the mode changes. 'high': the user is actively waiting on it.
  ipcMain.handle('audio:declickPreview', async (e, inputPath: string, mode: DeclickMode) => {
    // Only one preview render is ever in flight: a preset change supersedes the render
    // it invalidates rather than racing it, so the audio that lands always matches the
    // dials the user is looking at.
    declickRender?.kill('SIGKILL')
    try {
      const out = await renderDeclickRepaired(
        inputPath,
        previewTempPath('wav'),
        mode,
        (done) => {
          if (!e.sender.isDestroyed()) e.sender.send('audio:declickPreviewProgress', done)
        },
        (child) => {
          declickRender = child
        },
      )
      if (out) allowMedia(out.path)
      return out
    } catch (err) {
      log.error('audio:declickPreview failed', err)
      return null
    } finally {
      declickRender = null
    }
  })

  ipcMain.handle('audio:cancelDeclickPreview', () => {
    declickRender?.kill('SIGKILL')
    declickRender = null
  })

  // Fired when a track's selection-driven analyses lost their last consumer (the user
  // browsed to another row): every 'high' probe registered for the path aborts — queued
  // ones never take a limiter slot, running ones have their ffmpeg killed — so the slots
  // go to the track the user is looking at now. Background ('low') work never registers
  // and is untouched.
  ipcMain.handle('audio:cancelAnalysis', (_e, inputPath: string) => {
    log.debug('audio:cancelAnalysis', inputPath)
    analysisCancels.cancel(inputPath)
  })
}
