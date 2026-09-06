import type {
  BpmResult,
  KeyResult,
  LoudnessResult,
  SpectrumResult,
  TrackProperties,
  WaveformResult,
  WaveformScan,
} from './types'

// One table, both sides of the IPC: the main handlers register through
// handleAudio() and the preload invokes through invokeAudio(), each compiled
// against this map, so a channel typo, an argument drift or a missing REQUIRED
// field dies at tsc instead of at a user's screen.
//
// Know the limit: most analysis fields are OPTIONAL on purpose (analyses cached
// before a field existed must stay readable), and optional fields let a
// projection typecheck — exactly how the spectrogram handler once stranded the
// evidence and bits fields on the fresh route. The dual-route and passthrough
// tests in audioIpc.test.ts guard that half; this table guards the rest.
export interface AudioAnalysisIpc {
  'audio:spectrogram': {
    args: [inputPath: string, priority?: 'high' | 'low']
    result: SpectrumResult
  }
  'audio:cached-batch': {
    args: [paths: string[]]
    result: Record<string, { spectrogram?: SpectrumResult; waveformScan?: WaveformScan }>
  }
  'audio:loudness': {
    args: [inputPath: string, priority?: 'high' | 'low']
    result: LoudnessResult | null
  }
  'audio:clicks': {
    args: [inputPath: string, priority?: 'high' | 'low']
    result: { count: number; marks: number[]; scannedSec: number } | null
  }
  'audio:properties': {
    args: [inputPath: string]
    result: TrackProperties | null
  }
  'audio:bpm': {
    args: [inputPath: string, priority?: 'high' | 'low']
    result: BpmResult | null
  }
  'audio:key': {
    args: [inputPath: string, priority?: 'high' | 'low']
    result: KeyResult | null
  }
  'audio:waveform': {
    args: [inputPath: string, priority?: 'urgent' | 'high' | 'low']
    result: WaveformResult | null
  }
  'audio:waveform-scan': {
    args: [inputPath: string]
    result: WaveformScan | null
  }
  'audio:waveformWindow': {
    args: [inputPath: string, startSec: number, durSec: number, buckets: number]
    result: { peaks: number[]; rms: number[] } | null
  }
}
