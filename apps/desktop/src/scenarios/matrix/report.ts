import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { OutputFormat } from '../../shared/types'
import type { Verification } from '../../shared/verification'
import { scenarioRoot } from '../electronFake'
import type { Cell, CellState, FileDest, InvariantName, Origin, Programs } from './cells'
import type { Broken } from './oracle'

export interface CellOutcome {
  cell: Cell
  finalPath: string
  fileExists: boolean
  broken: Broken[]
  verdict: Verification | undefined
  statuses: Verification['status'][]
  openUntil?: number
  retry?: 'rerun-job' | 'rechecked'
}

export type Agreement = 'green' | 'honestBug' | 'falseOk' | 'falseAlarm'

const INVARIANTS: InvariantName[] = [
  'format',
  'pcm',
  'points',
  'cues',
  'playlists',
  'tags',
  'cover',
  'unique',
  'collateral',
]

const INVARIANT_NAME: Record<InvariantName, string> = {
  format: 'formato',
  pcm: 'pcm',
  points: 'apuntan',
  cues: 'cues',
  playlists: 'playlists',
  tags: 'tags',
  cover: 'carátula',
  unique: 'únicos',
  collateral: 'colateral',
}

const ORIGIN_SHORT: Record<Origin, string> = {
  wav16: 'WAV',
  wav24: 'WAV 24/96',
  aif: 'AIF',
  aiff: 'AIFF',
  flac: 'FLAC',
  alac: 'ALAC',
  aac: 'AAC',
  mp3x: 'MP3 Xing',
  mp3n: 'MP3 sin Xing',
  mp3j: 'MP3 con basura',
}
const TARGET_SHORT: Record<OutputFormat, string> = {
  aiff: 'AIFF',
  wav: 'WAV',
  flac: 'FLAC',
  alac: 'ALAC',
  mp3: 'MP3',
}
const DEST_SHORT: Record<FileDest, string> = {
  folder: 'carpeta',
  beside: 'junto al original',
  overwrite: 'sobre el original',
  appleMusic: 'Music',
  appleMusicCopy: 'Music y carpeta',
}
const PROGRAMS_SHORT: Record<Programs, string> = {
  rekordbox: 'rekordbox',
  engine: 'Engine',
  traktor: 'Traktor',
  music: 'Music',
  all: 'todos',
}
const STATE_SHORT: Record<CellState, string> = {
  closed: 'cerrado',
  open: 'abierto',
  retry: 'reintento',
}

const AGREEMENT_NAME: Record<Agreement, string> = {
  green: 'Celdas verdes',
  honestBug: 'Surco se equivoca y lo dice',
  falseOk: 'Surco se equivoca y dice ✓',
  falseAlarm: 'Falsa alarma',
}

const FILE_JUDGED: InvariantName[] = ['pcm', 'tags', 'cover']

const declaredOf = (cell: Cell) => new Set(cell.expectBroken?.map((b) => b.invariant))

function gateFailure(o: CellOutcome): string | null {
  const seen = o.statuses.join(' → ') || 'sin estados'
  if (o.cell.state === 'open') {
    const whileOpen = o.statuses.slice(0, o.openUntil ?? o.statuses.length)
    if (whileOpen.includes('ok')) return `veredicto ok antes de cerrar el programa (${seen})`
    if (!whileOpen.includes('pending'))
      return `con el programa abierto nunca quedó pendiente (${seen})`
  }
  if (o.cell.state === 'retry' && o.retry !== 'rechecked')
    return `Reintentar respondió ${o.retry ?? 'nada'}, se esperaba rechecked`
  return null
}

const namesExpectedKey = (o: CellOutcome): boolean =>
  !o.cell.expectedKey || !!o.verdict?.checks.some((c) => c.detail.key === o.cell.expectedKey)

function brokenAsDeclared(o: CellOutcome): boolean {
  const declared = declaredOf(o.cell)
  if (declared.size === 0) return !!o.cell.sabotage
  const seen = new Set(o.broken.map((b) => b.invariant))
  return [...seen].every((i) => declared.has(i)) && [...declared].every((i) => seen.has(i))
}

export function agreement(o: CellOutcome): Agreement {
  const expectsBreak = !!o.cell.sabotage || declaredOf(o.cell).size > 0
  if (!o.verdict) return o.broken.length > 0 ? 'honestBug' : 'falseAlarm'
  if (gateFailure(o)) {
    if (o.verdict.status === 'ok') return 'falseOk'
    return o.broken.length > 0 ? 'honestBug' : 'falseAlarm'
  }
  if (o.verdict.status === 'ok') return o.broken.length > 0 || expectsBreak ? 'falseOk' : 'green'
  if (o.broken.length === 0) return 'falseAlarm'
  return brokenAsDeclared(o) && namesExpectedKey(o) ? 'green' : 'honestBug'
}

function verdictKeys(v: Verification): string {
  const flagged = v.checks.filter((c) => c.state !== 'ok')
  return (flagged.length > 0 ? flagged : v.checks).map((c) => c.detail.key).join(', ')
}

function verdictLine(o: CellOutcome, kind: Agreement): string {
  const v = o.verdict
  if (!v) return 'veredicto ninguno, la autocomprobación no terminó'
  const gate = gateFailure(o)
  if (gate) return gate
  if (kind === 'falseOk')
    return 'veredicto ok, pero el resultado no cuadra (el verificador no lo vio)'
  const said = `veredicto ${v.status} (${verdictKeys(v)})`
  if (kind === 'falseAlarm') return `${said}, pero el resultado cuadra (falsa alarma)`
  if (!namesExpectedKey(o)) return `${said}, se esperaba ${o.cell.expectedKey}`
  return `${said}, Surco se equivoca y lo dice`
}

export function cellFailure(o: CellOutcome): string | null {
  const kind = agreement(o)
  if (kind === 'green') return null
  const seen = new Set(o.broken.map((b) => b.invariant))
  const lines = [
    ...o.broken.map((b) => `${INVARIANT_NAME[b.invariant].padEnd(10)} ${b.detail}`),
    ...(o.cell.expectBroken ?? [])
      .filter((b) => !seen.has(b.invariant))
      .map((b) => `${INVARIANT_NAME[b.invariant].padEnd(10)} se esperaba roto, ${b.why}`),
    ...(o.cell.sabotage && o.broken.length === 0 ? ['avería sin efecto en el resultado'] : []),
    verdictLine(o, kind),
  ]
  return [o.cell.name, ...lines.map((line) => `  ✗ ${line}`)].join('\n')
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const superscript = (n: number): string =>
  [...String(n)].map((digit) => SUPERSCRIPT[Number(digit)]).join('')

const applies = (o: CellOutcome, invariant: InvariantName): boolean =>
  !(invariant === 'cues' && o.cell.programs === 'music') &&
  !(FILE_JUDGED.includes(invariant) && !o.fileExists)

const pad = (n: number): string => String(n).padStart(2, '0')

export function renderReport(outcomes: CellOutcome[], at: Date): string {
  const notes: string[] = []
  const rows = outcomes.map((o) => {
    const marks = INVARIANTS.map((invariant) => {
      const details = o.broken.filter((b) => b.invariant === invariant).map((b) => b.detail)
      if (details.length === 0) return applies(o, invariant) ? '✓' : '–'
      notes.push(`${superscript(notes.length + 1)} ${details.join('; ')}`)
      return `✗${superscript(notes.length)}`
    })
    const kind = agreement(o)
    const agrees = o.verdict && (kind === 'green' || kind === 'honestBug') ? '✓' : '✗'
    const { cell } = o
    return `| ${[
      cell.id,
      `${ORIGIN_SHORT[cell.origin]}→${TARGET_SHORT[cell.target]}`,
      DEST_SHORT[cell.dest],
      PROGRAMS_SHORT[cell.programs],
      STATE_SHORT[cell.state],
      ...marks,
      o.verdict?.status ?? 'ninguno',
      agrees,
    ].join(' | ')} |`
  })
  const counts = (Object.keys(AGREEMENT_NAME) as Agreement[]).map((kind) => {
    const n = outcomes.filter((o) => agreement(o) === kind).length
    return `- ${AGREEMENT_NAME[kind]} ${n}${kind === 'green' ? ` de ${outcomes.length}` : ''}`
  })
  return [
    `# Matriz de resultados, ${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`,
    '',
    ...counts,
    '',
    '| Celda | Conversión | Fichero | Programas | Estado | Formato | PCM | Apuntan | Cues | Playlists | Tags | Carátula | Únicos | Colateral | Veredicto | Coincide |',
    `|${'---|'.repeat(16)}`,
    ...rows,
    '',
    ...notes,
    '',
  ].join('\n')
}

export function writeReport(outcomes: CellOutcome[]): string {
  const at = new Date()
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const path = process.env.SURCO_MATRIX_REPORT || join(scenarioRoot, `matriz-${day}.md`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, renderReport(outcomes, at))
  console.log(`Matriz de resultados en ${path}`)
  return path
}
