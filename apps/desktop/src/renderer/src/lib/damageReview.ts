import type {
  DamageFinding,
  DamageKind,
  DamageOutcome,
  DamageRepairItem,
} from '../../../shared/types'

export const damageKey = (f: DamageFinding): string => `damage:${f.id}`

const stageable = (f: DamageFinding): boolean => f.repair !== null && !f.pending

export function defaultStaged(findings: DamageFinding[]): Set<string> {
  return new Set(findings.filter((f) => stageable(f) && f.certainty === 'sure').map(damageKey))
}

export function repairsOf(
  findings: DamageFinding[],
  staged: ReadonlySet<string>,
  choice: (key: string) => string | null,
): DamageRepairItem[] {
  return findings.flatMap((f): DamageRepairItem[] => {
    const key = damageKey(f)
    if (!f.repair || !stageable(f) || !staged.has(key)) return []
    const to = choice(key)
    const repair = f.repair.target === 'genre' && to ? { ...f.repair, to } : f.repair
    return [{ id: f.id, repair }]
  })
}

const kindOf = (id: string): DamageKind => id.slice(0, id.indexOf('\0')) as DamageKind

export function summarizeDamage(items: DamageRepairItem[]): Partial<Record<DamageKind, number>> {
  const out: Partial<Record<DamageKind, number>> = {}
  for (const { id } of items) out[kindOf(id)] = (out[kindOf(id)] ?? 0) + 1
  return out
}

export function settleDamage(
  outcomes: DamageOutcome[],
  rescanned: DamageFinding[],
): DamageOutcome[] {
  const still = new Set(rescanned.map((f) => f.id))
  return outcomes.map((o) =>
    o.state === 'repaired' && still.has(o.id) ? { ...o, state: 'mismatch' } : o,
  )
}
