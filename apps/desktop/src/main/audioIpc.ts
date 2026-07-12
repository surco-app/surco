import { basename } from 'node:path'
import { ipcMain } from 'electron'
import log from 'electron-log/main'
import { activity } from './activity'
import { cachedAnalysis } from './analysisCache'
import { analysisLimiter } from './analysisLimiter'
import {
  analyzeCutoff,
  analyzeShelf,
  buildSpectrum,
  countTrackClicks,
  extractCover,
  extractCoverDataUrl,
  generateSpectrogram,
  measureBpm,
  measureKey,
  measureLoudness,
  measureWaveform,
  probeAudio,
  probeDuration,
  probeProperties,
  readMeta,
  readTags,
  renderDeclickRemoved,
  tagsFromProbe,
} from './ffmpeg'
import type { DeclickMode } from '../shared/types'
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

// The read-only audio analysis IPC: tags, duration, cover and the cached quality probes
// (spectrogram, loudness, properties, bpm, key, waveform). Self-contained — these handlers
// depend only on the ffmpeg helpers, the analysis cache/limiter and the stats tally, never
// on any window or session state — so they live apart from the stateful handlers in index.ts.
// allowMedia is the one exception: the declick audition renders a temp WAV the renderer
// must stream back through surco://, and the allowlist lives with the protocol in index.ts.
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
        const {
          image,
          cutoffHz,
          sampleRateHz,
          processed,
          hasKnee,
          upsampled,
          cutoffError,
          shelfError,
        } = await cachedAnalysis(
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
          'spectrogram-mono-v13',
          inputPath,
          () =>
            probe('activity.probeSpectrogram', inputPath, async () => {
              // buildSpectrum fans its three decodes out in parallel, so wrapping the whole
              // call in one limiter slot let it run 3 ffmpeg under a budget meant for 1 — a
              // quality sweep then put ~3× the intended decodes on the cores. Instead each
              // pass takes its own slot, so the limiter counts them honestly and caps the
              // real ffmpeg count; buildSpectrum holds no slot itself, so the passes still
              // overlap when slots are free (no single-track latency hit) and none waits on a
              // slot it's also holding (no deadlock).
              const built = await buildSpectrum(inputPath, {
                probe: probeAudio,
                spectrogram: (i) => analysisLimiter.run(() => generateSpectrogram(i), priority),
                cutoff: (i, sr) => analysisLimiter.run(() => analyzeCutoff(i, sr), priority),
                shelf: (i, sr) => analysisLimiter.run(() => analyzeShelf(i, sr), priority),
              })
              // This producer only runs on a cache miss (disk cache hits return above, and
              // the renderer's React Query cache dedups repeats), so bumping here counts
              // each track's quality analysis exactly once for the Stats tab.
              recordStat('analyzed')
              return built
            }),
          (b) => b.cutoffError === undefined,
        )
        // A cutoff failure still yields a usable spectrogram, so log it (with ffmpeg's
        // stderr) rather than reject — this is the only trace when it breaks on a
        // machine we can't reach, e.g. Windows.
        if (cutoffError) log.error('audio:spectrogram cutoff analysis failed', cutoffError)
        // The shelf probe is a best-effort secondary signal: a failure just means no
        // shelf verdict, so log it but (unlike cutoff) don't refuse to cache the rest.
        if (shelfError) log.error('audio:spectrogram shelf analysis failed', shelfError)
        return { image, cutoffHz, sampleRateHz, processed, hasKnee, upsampled }
      } catch (err) {
        log.error('audio:spectrogram failed', err)
        throw err
      }
    },
  )

  ipcMain.handle('audio:loudness', async (_e, inputPath: string) => {
    try {
      return await cachedAnalysis('loudness', inputPath, () =>
        probe('activity.probeLoudness', inputPath, () =>
          analysisLimiter.run(() => measureLoudness(inputPath), 'low'),
        ),
      )
    } catch (err) {
      log.error('audio:loudness failed', err)
      return null
    }
  })

  // The repair section's "estimated audible clicks" readout: Surco's own event
  // detector (clickDetect.ts), cached like every per-path probe. 'low': it renders
  // a dim caption, never something the user sits waiting on.
  ipcMain.handle('audio:clicks', async (_e, inputPath: string) => {
    try {
      return await cachedAnalysis('clickcount-v1', inputPath, () =>
        probe('activity.probeClicks', inputPath, () =>
          analysisLimiter.run(() => countTrackClicks(inputPath), 'low'),
        ),
      )
    } catch (err) {
      log.error('audio:clicks failed', err)
      return null
    }
  })

  ipcMain.handle('audio:properties', async (_e, inputPath: string) => {
    try {
      return await cachedAnalysis('properties', inputPath, () =>
        probe('activity.probeProperties', inputPath, () => probeProperties(inputPath)),
      )
    } catch (err) {
      log.error('audio:properties failed', err)
      return null
    }
  })

  ipcMain.handle('audio:bpm', async (_e, inputPath: string) => {
    try {
      // Unlike a null loudness (a parse failure worth retrying), a null here is
      // a real measurement — beatless material — so it is cached too; only a
      // decode error (which throws) is left uncached for a later retry.
      return await cachedAnalysis(
        'bpm',
        inputPath,
        () =>
          probe('activity.probeBpm', inputPath, () =>
            analysisLimiter.run(() => measureBpm(inputPath), 'low'),
          ),
        () => true,
      )
    } catch (err) {
      log.error('audio:bpm failed', err)
      return null
    }
  })

  ipcMain.handle('audio:key', async (_e, inputPath: string) => {
    try {
      // Same caching contract as audio:bpm: a null (atonal material) is a real
      // measurement and is cached; only a decode error retries.
      return await cachedAnalysis(
        'key',
        inputPath,
        () =>
          probe('activity.probeKey', inputPath, () =>
            analysisLimiter.run(() => measureKey(inputPath), 'low'),
          ),
        () => true,
      )
    } catch (err) {
      log.error('audio:key failed', err)
      return null
    }
  })

  ipcMain.handle('audio:waveform', async (_e, inputPath: string) => {
    try {
      // Default shouldCache applies: a null waveform means ffmpeg decoded
      // nothing, which is worth retrying later (e.g. a file mid-download), so
      // only real envelopes are pinned.
      // 'high': the waveform is the one decode a user is actively waiting on (they
      // just hit play), so it jumps ahead of the editor's background passes.
      // v2: results grew the per-channel lanes (WaveformResult.channels); entries
      // cached before that would pin waves with no split view forever.
      return await cachedAnalysis('waveform-v2', inputPath, () =>
        probe('activity.probeWaveform', inputPath, () =>
          analysisLimiter.run(() => measureWaveform(inputPath), 'high'),
        ),
      )
    } catch (err) {
      log.error('audio:waveform failed', err)
      return null
    }
  })

  // The declick audition: a 20 s excerpt holding only what the chosen repair mode
  // would remove, served back through surco:// (hence the allowMedia). Not cached —
  // the render is a couple of seconds and the renderer replays the same temp WAV
  // until the track or the mode changes. 'high': the user is actively waiting on it.
  ipcMain.handle('audio:declickPreview', async (_e, inputPath: string, mode: DeclickMode) => {
    try {
      const out = await analysisLimiter.run(
        () => renderDeclickRemoved(inputPath, previewTempPath('wav'), mode),
        'high',
      )
      if (out) allowMedia(out.path)
      return out
    } catch (err) {
      log.error('audio:declickPreview failed', err)
      return null
    }
  })
}
