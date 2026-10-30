import { mp3Head, mpeg1Info, mpeg1SampleRate } from './rekordboxTimeline'

const MPEG1_FRAME_SAMPLES = 1152
const DECODER_DELAY_SAMPLES = 529
const LIBMP3LAME_DELAY_SAMPLES = 576 + DECODER_DELAY_SAMPLES
const GAPLESS_SIGNATURES = ['LAME', 'Lavf', 'Lavc']

export interface Mp3Timing {
  sampleRate: number
  headerSamples: number
  gaplessDelay: number | null
}

export function mp3Timing(head: Buffer): Mp3Timing | null {
  const sampleRate = mpeg1SampleRate(head)
  if (sampleRate === null) return null
  const info = mpeg1Info(head)
  return {
    sampleRate,
    headerSamples: info ? MPEG1_FRAME_SAMPLES : 0,
    gaplessDelay:
      info && GAPLESS_SIGNATURES.includes(info.encoder) ? info.delay + DECODER_DELAY_SAMPLES : null,
  }
}

export async function mp3TimingOfFile(file: string): Promise<Mp3Timing | null> {
  const head = await mp3Head(file)
  return head ? mp3Timing(head) : null
}

// Measured in Traktor Pro 4.5.1 on 31/10/2026: Traktor plays an MP3 from its first frame,
// the Xing/Info one included, and trims no encoder delay. ffmpeg skips that header frame,
// and the delay too when the tag carries an encoder signature it trusts. The converted file
// holds what ffmpeg decoded, so a cue moves by what Traktor draws ahead of the output's
// audio minus what ffmpeg skipped from the source. An output's delay is the one its tag
// states, or libmp3lame's own when it states none. null stands for PCM. cueShiftFor
// subtracts the result from its shift.
export function automaticCueOffsetMs(source: Mp3Timing | null, output: Mp3Timing | null): number {
  const drawnAhead = output
    ? (output.headerSamples + (output.gaplessDelay ?? LIBMP3LAME_DELAY_SAMPLES)) / output.sampleRate
    : 0
  const skippedByFfmpeg = source
    ? (source.headerSamples + (source.gaplessDelay ?? 0)) / source.sampleRate
    : 0
  return (drawnAhead - skippedByFfmpeg) * 1000
}

export async function automaticCueOffsetOfFiles(input: string, output: string): Promise<number> {
  return automaticCueOffsetMs(await mp3TimingOfFile(input), await mp3TimingOfFile(output))
}
