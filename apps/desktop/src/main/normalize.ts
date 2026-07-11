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

// Prepends the click-repair stage (when active) to a measurement's own filter, so
// every gain below is sized on the audio the conversion will actually encode — a
// near-full-scale click would otherwise anchor a peak measurement and leave the
// whole track several dB short of its target.
function measured(filter: string, prefilter?: string): string {
  return prefilter ? `${prefilter},${filter}` : filter
}

// First pass: measure the source so the second pass can normalize accurately
// (linear) instead of the default dynamic mode that pumps frame-by-frame.
export function loudnormArgs(input: string, cfg: NormalizeConfig, prefilter?: string): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    input,
    '-af',
    measured(
      `loudnorm=I=${cfg.targetLufs}:TP=${cfg.truePeakDb}:LRA=${LOUDNORM_LRA}:print_format=json`,
      prefilter,
    ),
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
  // af_loudnorm honors linear=true only while measured_LRA ≤ the LRA target; past it,
  // the filter silently falls back to dynamic (pumping) mode AND misses the integrated
  // target (verified with ffmpeg: a −14 request on a 14-LU source came out at −11).
  // Raise the target to the measured range — in linear mode LRA compresses nothing (a
  // constant gain can't change range), it is purely the linear/dynamic gate. Ceiled
  // for a margin against float equality; 50 is the parameter's documented maximum.
  const lra = Math.min(50, Math.max(LOUDNORM_LRA, Math.ceil(m.inputLra)))
  const filter = [
    `loudnorm=I=${cfg.targetLufs}`,
    `TP=${cfg.truePeakDb}`,
    `LRA=${lra}`,
    `measured_I=${m.inputI}`,
    `measured_TP=${m.inputTp}`,
    `measured_LRA=${m.inputLra}`,
    `measured_thresh=${m.inputThresh}`,
    `offset=${m.targetOffset}`,
    'linear=true',
  ].join(':')
  return sampleRate && sampleRate > 0 ? `${filter},aresample=${sampleRate}` : filter
}

// Whether a constant (linear) gain can reach the target without the louder peaks
// breaking the true-peak ceiling. The boost needed is target − measured loudness; add
// it to the measured true peak and, if that still fits under the ceiling, linear
// normalization lands exactly on target with the dynamics untouched. When it doesn't —
// the loud club target on most material — loudnorm would clamp the gain to protect the
// ceiling and the track would come out several dB short, so we limit instead.
export function reachesTargetLinearly(cfg: NormalizeConfig, m: LoudnormMeasured): boolean {
  return m.inputTp + (cfg.targetLufs - m.inputI) <= cfg.truePeakDb
}

// The unreachable case: apply the full gain that lands on the target, then hold the
// peaks at the ceiling with a limiter. Only the overs that would have clipped get
// touched, so the body of the track keeps its dynamics while the integrated loudness
// reaches the chosen value — instead of stalling where a clamped linear gain leaves it.
// alimiter caps sample peaks, so we oversample around it (4×, the ITU-R BS.1770
// true-peak factor) to catch the inter-sample peaks a sample-peak limiter would miss,
// then restore the source rate — otherwise true peak would creep above the ceiling.
export function limitedLoudnormFilter(
  cfg: NormalizeConfig,
  m: LoudnormMeasured,
  sampleRate?: number,
): string {
  const gain = `volume=${(cfg.targetLufs - m.inputI).toFixed(2)}dB`
  const limit = 10 ** (cfg.truePeakDb / 20)
  const limiter = `alimiter=limit=${limit.toFixed(6)}:level=disabled`
  return sampleRate && sampleRate > 0
    ? `${gain},aresample=${sampleRate * 4},${limiter},aresample=${sampleRate}`
    : `${gain},${limiter}`
}

// Peak mode: a single decode to find the loudest sample.
export function volumedetectArgs(input: string, prefilter?: string): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    input,
    '-af',
    measured('volumedetect', prefilter),
    '-f',
    'null',
    '-',
  ]
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

// The per-channel measurement behind the Audacity-style peak options: astats
// reports each channel's mean (DC offset) and sample extremes. Decoded to float
// first — on integer formats astats prints raw code values (±32767-style), not
// the normalized levels the gain math needs.
export function astatsArgs(input: string, prefilter?: string): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    input,
    '-af',
    measured('aformat=sample_fmts=flt,astats', prefilter),
    '-f',
    'null',
    '-',
  ]
}

export interface ChannelStats {
  dc: number
  min: number
  max: number
}

// Reads the per-channel blocks astats prints to stderr. The trailing Overall
// block repeats the same field names with no "Channel:" header, so collection
// stops there — its figures must not overwrite the last channel's.
export function parseAstatsChannels(stderr: string): ChannelStats[] | null {
  const channels: ChannelStats[] = []
  let current: Partial<ChannelStats> | null = null
  for (const line of stderr.split('\n')) {
    if (/\bChannel:\s*\d+/.test(line)) {
      current = {}
      channels.push(current as ChannelStats)
      continue
    }
    if (/\bOverall\b/.test(line)) break
    if (!current) continue
    const dc = line.match(/DC offset:\s*(-?[\d.]+)/)
    if (dc) current.dc = Number(dc[1])
    const min = line.match(/Min level:\s*(-?[\d.]+)/)
    if (min) current.min = Number(min[1])
    const max = line.match(/Max level:\s*(-?[\d.]+)/)
    if (max) current.max = Number(max[1])
  }
  const complete = channels.every(
    (c) => Number.isFinite(c.dc) && Number.isFinite(c.min) && Number.isFinite(c.max),
  )
  return channels.length > 0 && complete ? channels : null
}

// Audacity's Normalize, as one -af-compatible filter: aeval rewrites every channel
// as (sample − mean) × gain, which a linear chain like channelsplit+amerge can't
// express per channel. With peakRemoveDc the mean is subtracted BEFORE the gain is
// sized, so the headroom a biased capture wastes becomes usable level; with
// peakPerChannel each channel takes the gain to put ITS OWN peak on the target,
// otherwise one shared gain (from the loudest channel) preserves the stereo image.
// A silent channel has no extent to scale, so the whole filter bails (null) and the
// caller skips normalization — the same contract as a failed measurement.
export function peakChannelFilter(
  cfg: NormalizeConfig,
  channels: ChannelStats[],
): string | null {
  const removeDc = cfg.peakRemoveDc === true
  const extents = channels.map((c) =>
    removeDc ? Math.max(Math.abs(c.max - c.dc), Math.abs(c.min - c.dc)) : Math.max(Math.abs(c.max), Math.abs(c.min)),
  )
  if (extents.some((e) => e <= 0)) return null
  const target = 10 ** (cfg.peakDb / 20)
  const shared = target / Math.max(...extents)
  const exprs = channels.map((c, i) => {
    const gain = (cfg.peakPerChannel === true ? target / extents[i] : shared).toFixed(6)
    return removeDc ? `(val(${i})-(${c.dc.toFixed(6)}))*${gain}` : `val(${i})*${gain}`
  })
  return `aeval=exprs=${exprs.join('|')}:c=same`
}
