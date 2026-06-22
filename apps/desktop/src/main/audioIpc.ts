import { ipcMain } from 'electron'
import log from 'electron-log/main'
import { cachedAnalysis } from './analysisCache'
import { analysisLimiter } from './analysisLimiter'
import {
  analyzeCutoff,
  analyzeShelf,
  buildSpectrum,
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
  readTags,
  tagsFromProbe,
} from './ffmpeg'

// The read-only audio analysis IPC: tags, duration, cover and the cached quality probes
// (spectrogram, loudness, properties, bpm, key, waveform). Self-contained — these handlers
// depend only on the ffmpeg helpers and the analysis cache/limiter, never on any window or
// session state — so they live apart from the stateful handlers in index.ts.
export function registerAudioIpc(): void {
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

  ipcMain.handle('audio:cover', (_e, inputPath: string) => extractCover(inputPath))
  ipcMain.handle('audio:coverFull', (_e, inputPath: string) => extractCoverDataUrl(inputPath))

  ipcMain.handle('audio:spectrogram', async (_e, inputPath: string) => {
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
        // (catches codec walls the biquad pass smears below its threshold).
        'spectrogram-mono-v8',
        inputPath,
        () =>
          analysisLimiter.run(
            () =>
              buildSpectrum(inputPath, {
                probe: probeAudio,
                spectrogram: generateSpectrogram,
                cutoff: analyzeCutoff,
                shelf: analyzeShelf,
              }),
            'low',
          ),
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
  })

  ipcMain.handle('audio:loudness', async (_e, inputPath: string) => {
    try {
      return await cachedAnalysis('loudness', inputPath, () =>
        analysisLimiter.run(() => measureLoudness(inputPath), 'low'),
      )
    } catch (err) {
      log.error('audio:loudness failed', err)
      return null
    }
  })

  ipcMain.handle('audio:properties', async (_e, inputPath: string) => {
    try {
      return await cachedAnalysis('properties', inputPath, () => probeProperties(inputPath))
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
        () => analysisLimiter.run(() => measureBpm(inputPath), 'low'),
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
        () => analysisLimiter.run(() => measureKey(inputPath), 'low'),
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
      return await cachedAnalysis('waveform', inputPath, () =>
        analysisLimiter.run(() => measureWaveform(inputPath), 'high'),
      )
    } catch (err) {
      log.error('audio:waveform failed', err)
      return null
    }
  })
}
