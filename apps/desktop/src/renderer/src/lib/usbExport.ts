import type {
  UsbExportEvent,
  UsbFailure,
  UsbPlanTrack,
  UsbTrackFailure,
} from '../../../shared/types'

// The running USB export as the renderer sees it, folded from the main process's events.
// Held in lib/usbExportStore, outside React, so closing the modal never loses it and a byte
// tick repaints only what reads it.

export type RowState = 'queued' | 'copying' | 'done' | 'kept' | 'failed'

export interface ExportRow {
  track: UsbPlanTrack
  state: RowState
  bytes: number
  failure: UsbTrackFailure | null
}

export interface UsbExportState {
  phase: 'idle' | 'copying' | 'database' | 'done' | 'cancelled' | 'error'
  // Cancel was asked; baken is finishing the track it copies.
  cancelling: boolean
  rows: ExportRow[]
  targetName: string
  startedAt: number
  samples: { at: number; bytes: number }[]
  // syncFiles false: the stick plays, but rekordbox's .sync files could not be written.
  result: { tracks: number; failed: number; ms: number; syncFiles: boolean } | null
  reason: UsbFailure | null
}

export const IDLE_EXPORT: UsbExportState = {
  phase: 'idle',
  cancelling: false,
  rows: [],
  targetName: '',
  startedAt: 0,
  samples: [],
  result: null,
  reason: null,
}

export type UsbExportAction = UsbExportEvent | { type: 'reset' }

const SPEED_WINDOW_MS = 5000

export function bytesDone(s: UsbExportState): number {
  return s.rows.reduce(
    (sum, r) => sum + (r.state === 'done' ? r.track.size : r.state === 'copying' ? r.bytes : 0),
    0,
  )
}

export function bytesToCopy(s: UsbExportState): number {
  return s.rows.reduce(
    (sum, r) =>
      sum + (r.track.onStick || r.state === 'kept' || r.state === 'failed' ? 0 : r.track.size),
    0,
  )
}

const withRow = (s: UsbExportState, index: number, row: Partial<ExportRow>): ExportRow[] =>
  s.rows.map((r, i) => (i === index ? { ...r, ...row } : r))

function sampled(s: UsbExportState, now: number): UsbExportState {
  const samples = [...s.samples, { at: now, bytes: bytesDone(s) }].filter(
    (x) => now - x.at <= SPEED_WINDOW_MS,
  )
  return { ...s, samples }
}

export function usbExportReducer(
  s: UsbExportState,
  e: UsbExportAction,
  now: number,
): UsbExportState {
  switch (e.type) {
    case 'reset':
      return IDLE_EXPORT
    case 'started':
      return {
        ...IDLE_EXPORT,
        phase: 'copying',
        rows: e.tracks.map((track) => ({ track, state: 'queued', bytes: 0, failure: null })),
        targetName: e.targetName,
        startedAt: e.startedAt,
        samples: [{ at: now, bytes: 0 }],
      }
    case 'progress':
      return sampled({ ...s, rows: withRow(s, e.index, { state: 'copying', bytes: e.bytes }) }, now)
    case 'track':
      return sampled(
        {
          ...s,
          rows: withRow(s, e.index, {
            state: e.state,
            bytes: e.state === 'done' ? (s.rows[e.index]?.track.size ?? 0) : 0,
          }),
        },
        now,
      )
    case 'failed':
      return { ...s, rows: withRow(s, e.index, { state: 'failed', bytes: 0, failure: e.reason }) }
    case 'cancelling':
      return { ...s, cancelling: true }
    case 'database':
      return { ...s, phase: 'database' }
    case 'finished':
      if (e.outcome === 'done')
        return {
          ...s,
          phase: 'done',
          result: { tracks: e.tracks, failed: e.failed, ms: e.ms, syncFiles: e.syncFiles },
        }
      if (e.outcome === 'cancelled') return { ...s, phase: 'cancelled' }
      return { ...s, phase: 'error', reason: e.reason }
  }
}

export function isRunning(s: UsbExportState): boolean {
  return s.phase === 'copying' || s.phase === 'database'
}

// Separators are tracks on the stick but never a number the user reads, as in the tree.
export function exportCounts(s: UsbExportState): { done: number; total: number } {
  const real = s.rows.filter((r) => !r.track.separator)
  return {
    done: real.filter((r) => r.state === 'done' || r.state === 'kept' || r.state === 'failed')
      .length,
    total: real.length,
  }
}

export function speed(s: UsbExportState): number | null {
  if (s.samples.length < 2) return null
  const first = s.samples[0]
  const last = s.samples[s.samples.length - 1]
  const ms = last.at - first.at
  return ms > 0 ? ((last.bytes - first.bytes) * 1000) / ms : null
}

export function timeLeft(s: UsbExportState): number | null {
  const rate = speed(s)
  if (!rate || rate <= 0) return null
  return Math.round(((bytesToCopy(s) - bytesDone(s)) / rate) * 1000)
}

export function formatSpan(
  ms: number,
  tr: (k: string, o?: Record<string, unknown>) => string,
): string {
  const total = Math.round(ms / 1000)
  const min = Math.floor(total / 60)
  const sec = total % 60
  return min > 0 ? tr('usbExport.span.minSec', { min, sec }) : tr('usbExport.span.sec', { sec })
}

// One thin bar per value in a 100 × 16 box, mirrored around the middle like rekordbox's
// preview, never thinner than half a unit so silence still draws a line.
export function wavePath(bars: number[]): string {
  const w = 100 / bars.length
  return bars
    .map((v, i) => {
      const h = Math.max(0.5, v * 16)
      const y = (16 - h) / 2
      return `M${+(i * w).toFixed(2)} ${+y.toFixed(2)}h${+(w * 0.7).toFixed(2)}v${+h.toFixed(2)}h-${+(w * 0.7).toFixed(2)}Z`
    })
    .join('')
}

// A track rekordbox never analysed has no preview: a flat bar stands in for it.
export const FLAT_WAVE: number[] = Array.from({ length: 100 }, () => 0.12)
