import { SAME_POSITION_MS } from '../../../shared/cueRules'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import { cueLetter } from './rowCues'

export interface MarkInput {
  key: string
  ms: number
  kind: number
  color: number | null
}

export interface HotMark {
  key: string
  ms: number
  at: number
  kind: number
  letter: string
  colour: string
}

export interface CallMark {
  key: string
  ms: number
  at: number
  paired: boolean
}

export type MarkSize = 'row' | 'wave'

export const HOT_MARK_PX: Record<MarkSize, number> = { row: 12, wave: 14 }

export function placeCues(
  cues: MarkInput[],
  spanMs: number,
): { hot: HotMark[]; calls: CallMark[] } {
  if (!(spanMs > 0)) return { hot: [], calls: [] }
  const inside = cues.filter((c) => c.ms >= 0 && c.ms <= spanMs)
  const hotCues = inside.filter((c) => c.kind !== 0)
  const hot = hotCues.map((c) => ({
    key: c.key,
    ms: c.ms,
    at: (c.ms / spanMs) * 100,
    kind: c.kind,
    letter: cueLetter(c.kind),
    colour: hotCueColor(c.color),
  }))
  const calls = inside
    .filter((c, i) => c.kind === 0 && inside.findIndex((o) => o.kind === 0 && o.ms === c.ms) === i)
    .map((c) => {
      const pair = hotCues.find((h) => Math.abs(h.ms - c.ms) <= SAME_POSITION_MS)
      return {
        key: c.key,
        ms: c.ms,
        at: ((pair ? pair.ms : c.ms) / spanMs) * 100,
        paired: pair !== undefined,
      }
    })
  return { hot, calls }
}

export function markStyle(
  at: number,
  row: 'hot' | 'call',
  size: MarkSize,
): { left: string; top: string; transform: string } {
  return {
    left: `${at}%`,
    top: row === 'hot' ? '0px' : `${HOT_MARK_PX[size] + 1}px`,
    transform: 'translateX(-50%)',
  }
}
