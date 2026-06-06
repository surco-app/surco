import type { NormalizeConfig } from '../shared/types'

// loudnorm's loudness range target. Kept fixed (the EBU R128 default) rather than
// exposed as a knob — the user-facing choices are the integrated target and the
// true-peak ceiling, which is plenty of control without inviting a bad LRA.
const LOUDNORM_LRA = 11

export interface LoudnormMeasured {
  inputI: number
  inputTp: number
  inputLra: number
  inputThresh: number
  targetOffset: number
}

// First pass: measure the source so the second pass can normalize accurately
// (linear) instead of the default dynamic mode that pumps frame-by-frame.
export function loudnormArgs(input: string, cfg: NormalizeConfig): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    input,
    '-af',
    `loudnorm=I=${cfg.targetLufs}:TP=${cfg.truePeakDb}:LRA=${LOUDNORM_LRA}:print_format=json`,
    '-f',
    'null',
    '-',
  ]
}

// Pulls the measured figures out of the JSON block loudnorm prints to stderr. Any
// non-finite reading (e.g. "-inf" on near-silence) means we cannot build an
// accurate pass, so we bail and skip normalization rather than feed garbage.
export function parseLoudnorm(output: string): LoudnormMeasured | null {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const j = JSON.parse(output.slice(start, end + 1))
    const m = {
      inputI: Number(j.input_i),
      inputTp: Number(j.input_tp),
      inputLra: Number(j.input_lra),
      inputThresh: Number(j.input_thresh),
      targetOffset: Number(j.target_offset),
    }
    if (Object.values(m).some((v) => !Number.isFinite(v))) return null
    return m
  } catch {
    return null
  }
}

// Second pass: the chosen target plus the first pass's measurements, in linear
// mode so the whole track is shifted by a constant gain (dynamics preserved).
// loudnorm oversamples to 192 kHz for true-peak limiting and emits its output at
// that rate, so we resample back to the source rate — otherwise every normalized
// file would be written at 192 kHz, a sample-rate change the user never asked for.
export function loudnormFilter(
  cfg: NormalizeConfig,
  m: LoudnormMeasured,
  sampleRate?: number,
): string {
  const filter = [
    `loudnorm=I=${cfg.targetLufs}`,
    `TP=${cfg.truePeakDb}`,
    `LRA=${LOUDNORM_LRA}`,
    `measured_I=${m.inputI}`,
    `measured_TP=${m.inputTp}`,
    `measured_LRA=${m.inputLra}`,
    `measured_thresh=${m.inputThresh}`,
    `offset=${m.targetOffset}`,
    'linear=true',
  ].join(':')
  return sampleRate && sampleRate > 0 ? `${filter},aresample=${sampleRate}` : filter
}

// Peak mode: a single decode to find the loudest sample.
export function volumedetectArgs(input: string): string[] {
  return ['-hide_banner', '-nostats', '-i', input, '-af', 'volumedetect', '-f', 'null', '-']
}

export function parseMaxVolume(stderr: string): number | null {
  const m = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/)
  return m ? Number(m[1]) : null
}

// The constant gain that moves the loudest sample to the target ceiling.
export function peakGainDb(targetDb: number, maxVolumeDb: number): number {
  return targetDb - maxVolumeDb
}

export function volumeFilter(gainDb: number): string {
  return `volume=${gainDb}dB`
}
