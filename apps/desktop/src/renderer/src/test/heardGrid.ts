import type { GridAudit } from '../../../shared/gridAudit'
import type { GridFit } from '../../../shared/gridEdit'

export function auditHeard(fit: GridFit, beats: number[]): GridAudit {
  const period = 60000 / fit.bpm
  const windows: GridAudit['windows'] = []
  let total = 0
  for (let i = 0; i + 16 < beats.length; i += 8) {
    total++
    const ms = beats[i + 8]
    const near = (fit.phases ?? []).reduce<{ ms: number; firstMs: number } | null>(
      (a, p) => (a && Math.abs(a.ms - ms) <= Math.abs(p.ms - ms) ? a : p),
      null,
    )
    const first = near?.firstMs ?? fit.firstMs
    const off = first + Math.round((ms - first) / period) * period - ms
    windows.push({
      ms,
      offsetMs: Math.abs(off) > period / 4 ? off - Math.sign(off) * (period / 2) : off,
    })
  }
  const periodMs = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0
  return { windows, total, periodMs, heardPerMinute: 30 }
}
