export type PhraseKind = 'intro' | 'up' | 'down' | 'chorus' | 'outro'
export type FlowOrigin = 'drop' | 'first-beat' | 'last-beat' | PhraseKind
export type FlowDirection = 'back' | 'forward'
export type FlowRepeat = number | 'edge'
export type FlowCondition = 'always' | 'fits' | 'clear' | 'first'
export type FlowPlace = 'hot' | 'call' | 'both'
export type FlowColor = { fixed: number } | { each: number[] }

export interface CueRule {
  from: FlowOrigin
  direction: FlowDirection
  bars: number
  repeat: FlowRepeat
  when: FlowCondition
  place: FlowPlace
  color: FlowColor
}

export interface CueFlow {
  id: string
  name: string
  rules: CueRule[]
}

export interface FlowPhrase {
  ms: number
  kind: PhraseKind
}

export const MY_FLOW_ID = 'mine'
export const RULE_BARS = [0, 1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128]
export const MAX_RULE_REPEAT = 16
export const FLOW_ORIGINS: FlowOrigin[] = [
  'drop',
  'first-beat',
  'last-beat',
  'intro',
  'up',
  'down',
  'chorus',
  'outro',
]
export const FLOW_CONDITIONS: FlowCondition[] = ['always', 'fits', 'clear', 'first']
export const FLOW_PLACES: FlowPlace[] = ['hot', 'call', 'both']
const DIRECTIONS: FlowDirection[] = ['back', 'forward']

export const MY_FLOW: CueFlow = {
  id: MY_FLOW_ID,
  name: '',
  rules: [
    {
      from: 'drop',
      direction: 'back',
      bars: 16,
      repeat: 3,
      when: 'fits',
      place: 'both',
      color: { each: [1, 22, 42] },
    },
    {
      from: 'first-beat',
      direction: 'back',
      bars: 0,
      repeat: 1,
      when: 'first',
      place: 'both',
      color: { fixed: 32 },
    },
  ],
}

export const ONE_AT_32: CueFlow = {
  id: 'one-at-32',
  name: '',
  rules: [
    {
      from: 'drop',
      direction: 'back',
      bars: 32,
      repeat: 1,
      when: 'fits',
      place: 'hot',
      color: { fixed: 22 },
    },
  ],
}

export const CALLS_ONLY: CueFlow = { id: 'calls-only', name: '', rules: [] }

export const BUNDLED_FLOWS: CueFlow[] = [MY_FLOW, ONE_AT_32, CALLS_ONLY]

const HIGH_MOOD: Record<number, PhraseKind> = {
  1: 'intro',
  2: 'up',
  3: 'down',
  5: 'chorus',
  6: 'outro',
}
const OTHER_MOOD: Record<number, PhraseKind> = { 1: 'intro', 8: 'down', 9: 'chorus', 10: 'outro' }

export function phraseKindOf(mood: number, kind: number): PhraseKind | null {
  if (mood === 1) return HIGH_MOOD[kind] ?? null
  if (kind >= 2 && kind <= 7) return 'up'
  return OTHER_MOOD[kind] ?? null
}

const isColorIndex = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 62

function colorOf(value: unknown): FlowColor | null {
  if (!value || typeof value !== 'object') return null
  const c = value as { fixed?: unknown; each?: unknown }
  if (isColorIndex(c.fixed)) return { fixed: c.fixed }
  if (Array.isArray(c.each) && c.each.length > 0 && c.each.every(isColorIndex))
    return { each: [...c.each] }
  return null
}

function repeatOf(value: unknown): FlowRepeat | null {
  if (value === 'edge') return 'edge'
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_RULE_REPEAT
    ? value
    : null
}

function ruleOf(value: unknown): CueRule | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const color = colorOf(r.color)
  const repeat = repeatOf(r.repeat)
  const bars = r.bars
  if (
    !FLOW_ORIGINS.includes(r.from as FlowOrigin) ||
    !DIRECTIONS.includes(r.direction as FlowDirection) ||
    !FLOW_CONDITIONS.includes(r.when as FlowCondition) ||
    !FLOW_PLACES.includes(r.place as FlowPlace) ||
    typeof bars !== 'number' ||
    !Number.isInteger(bars) ||
    bars < 0 ||
    bars > 128 ||
    color === null ||
    repeat === null
  )
    return null
  return {
    from: r.from as FlowOrigin,
    direction: r.direction as FlowDirection,
    bars,
    repeat,
    when: r.when as FlowCondition,
    place: r.place as FlowPlace,
    color,
  }
}

export function normalizeCueFlows(value: unknown): CueFlow[] {
  if (!Array.isArray(value)) return structuredClone(BUNDLED_FLOWS)
  const seen = new Set<string>()
  const flows: CueFlow[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    if (typeof f.id !== 'string' || f.id === '' || seen.has(f.id) || !Array.isArray(f.rules))
      continue
    seen.add(f.id)
    flows.push({
      id: f.id,
      name: typeof f.name === 'string' ? f.name : '',
      rules: f.rules.flatMap((r) => {
        const rule = ruleOf(r)
        return rule ? [rule] : []
      }),
    })
  }
  return seen.has(MY_FLOW_ID) ? flows : [structuredClone(MY_FLOW), ...flows]
}

export function activeCueFlow(settings: { cueFlows?: CueFlow[]; activeCueFlow?: string }): CueFlow {
  const flows = settings.cueFlows ?? normalizeCueFlows(undefined)
  return (
    flows.find((f) => f.id === settings.activeCueFlow) ??
    flows.find((f) => f.id === MY_FLOW_ID) ??
    structuredClone(MY_FLOW)
  )
}

export function restoreMyFlow(flows: CueFlow[]): CueFlow[] {
  return flows.map((f) => (f.id === MY_FLOW_ID ? structuredClone(MY_FLOW) : f))
}
