import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Verification } from '../../shared/verification'
import { scenarioDir } from '../fixtures'
import { CELLS, type Cell } from './cells'
import type { Broken } from './oracle'
import { agreement, type CellOutcome, cellFailure, renderReport, writeReport } from './report'

function cellOf(id: string): Cell {
  const cell = CELLS.find((c) => c.id === id)
  if (!cell) throw new Error(`no cell ${id}`)
  return cell
}

const ok: Verification = {
  status: 'ok',
  checks: [
    { place: 'file', state: 'ok', detail: { key: 'fileReencoded' } },
    { place: 'rekordbox', state: 'ok', detail: { key: 'rekordboxOk' } },
  ],
}

const mismatch = (key: Verification['checks'][number]['detail']['key']): Verification => ({
  status: 'mismatch',
  checks: [
    { place: 'file', state: 'ok', detail: { key: 'fileReencoded' } },
    { place: 'rekordbox', state: 'mismatch', detail: { key } },
  ],
})

const cuesMoved: Broken = {
  invariant: 'cues',
  detail: 'rekordbox: cues en 10025, 15025 ms, se esperaba 10000, 15000',
}

function outcome(
  id: string,
  broken: Broken[],
  verdict: Verification | undefined,
  statuses: Verification['status'][] = verdict ? [verdict.status] : [],
  more: Partial<CellOutcome> = {},
): CellOutcome {
  return {
    cell: cellOf(id),
    finalPath: '/x/flac Café Olé.aiff',
    fileExists: true,
    broken,
    verdict,
    statuses,
    ...more,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// Two questions per cell: is the result right, and does the self-check say so. The four
// answers are not equally bad; a DJ who sees ✓ on a broken track takes it to the gig.
describe('a matrix cell is judged by whether the oracle and the self-check agree', () => {
  it('calls a broken result with ok the worst case', () => {
    const o = outcome('C-flac-aiff', [cuesMoved], ok)
    expect(agreement(o)).toBe('falseOk')
    expect(cellFailure(o)).toContain('el verificador no lo vio')
    expect(cellFailure(o)).toContain(cuesMoved.detail)
  })

  it('calls a broken result the self-check flagged an honest bug', () => {
    const o = outcome('C-flac-aiff', [cuesMoved], mismatch('rekordboxCuesChanged'))
    expect(agreement(o)).toBe('honestBug')
    expect(cellFailure(o)).toContain(cuesMoved.detail)
  })

  it('calls a right result the self-check flagged a false alarm', () => {
    const o = outcome('C-flac-aiff', [], mismatch('rekordboxStillOld'))
    expect(agreement(o)).toBe('falseAlarm')
    expect(cellFailure(o)).toContain('rekordboxStillOld')
  })

  it('calls a right result with ok green, and green has nothing to report', () => {
    const o = outcome('C-flac-aiff', [], ok)
    expect(agreement(o)).toBe('green')
    expect(cellFailure(o)).toBeNull()
  })

  it('needs a verdict before calling anything green', () => {
    expect(agreement(outcome('C-flac-aiff', [], undefined))).toBe('falseAlarm')
  })

  // A sabotage proves the self-check sees one failure: green only when it is not ok and
  // names that failure, not some other one.
  it('calls a sabotage green only when the verdict names the expected key', () => {
    const broken: Broken[] = [{ invariant: 'points', detail: 'rekordbox: FolderPath viejo' }]
    expect(agreement(outcome('S-rekordboxStillOld', broken, mismatch('rekordboxStillOld')))).toBe(
      'green',
    )
    expect(
      agreement(outcome('S-rekordboxStillOld', broken, mismatch('rekordboxSizeDiffers'))),
    ).toBe('honestBug')
    expect(agreement(outcome('S-rekordboxStillOld', broken, ok))).toBe('falseOk')
  })

  it('calls a sabotage nobody saw the worst case', () => {
    expect(agreement(outcome('S-rekordboxStillOld', [], ok))).toBe('falseOk')
  })

  // A blind spot is declared broken in one invariant and has no key: today the self-check
  // says ok over it, and the matrix must keep it red until the self-check learns to look.
  it('keeps a known blind spot red while the self-check says ok over it', () => {
    const moved: Broken[] = [{ invariant: 'cues', detail: 'rekordbox: un cue movido 500 ms' }]
    expect(agreement(outcome('S-blindRekordboxCueMoved', moved, ok))).toBe('falseOk')
  })

  it('does not accept a declared failure that came with another one', () => {
    const broken: Broken[] = [
      { invariant: 'points', detail: 'rekordbox: FolderPath viejo' },
      { invariant: 'unique', detail: 'rekordbox: 0 filas vivas para el fichero final' },
      { invariant: 'tags', detail: 'título ausente' },
    ]
    expect(agreement(outcome('K08', broken, mismatch('rekordboxAmbiguous')))).toBe('honestBug')
    expect(agreement(outcome('K08', broken.slice(0, 2), mismatch('rekordboxAmbiguous')))).toBe(
      'green',
    )
  })

  // An ok shown while the program still held its library is a ✓ on a track no library
  // points at yet. Only the statuses emitted before the runner closed the program count.
  it('calls an ok emitted before the program closed the worst case', () => {
    const early = outcome('K14', [], ok, ['ok', 'pending', 'ok'], { openUntil: 2 })
    expect(agreement(early)).toBe('falseOk')
    expect(cellFailure(early)).toContain('antes de cerrar')
    expect(agreement(outcome('K14', [], ok, ['pending', 'ok'], { openUntil: 1 }))).toBe('green')
  })

  it('calls a lone ok given while the program was open the worst case', () => {
    expect(agreement(outcome('K14', [], ok, ['ok'], { openUntil: 1 }))).toBe('falseOk')
    expect(agreement(outcome('K14', [], ok, ['pending', 'ok'], { openUntil: 2 }))).toBe('falseOk')
  })

  it('accepts as many oks as the close brings once the program is closed', () => {
    expect(agreement(outcome('K14', [], ok, ['pending', 'ok', 'ok'], { openUntil: 1 }))).toBe(
      'green',
    )
  })

  // An open program that never made the track wait means Surco did not see it open: the
  // write either went through under the DJ or was never queued.
  it('needs the track to wait while the program is open', () => {
    const neverWaited = outcome('K14', [], ok, ['checking', 'ok'], { openUntil: 1 })
    expect(agreement(neverWaited)).toBe('falseOk')
    expect(cellFailure(neverWaited)).toContain('nunca quedó pendiente')
  })

  // Only rekordbox, Engine and Traktor hold a library Surco must wait on; Music is driven
  // while it runs, so a cell syncing only Music has no program to wait for (D21).
  it('asks nothing of the open state when the cell syncs only Music', () => {
    expect(agreement(outcome('D21', [], ok, ['checking', 'ok'], { openUntil: 2 }))).toBe('green')
  })

  it('does not call a missing verdict green, even over a declared blind spot', () => {
    const moved: Broken[] = [{ invariant: 'cues', detail: 'rekordbox: un cue movido 500 ms' }]
    const silent = outcome('S-blindRekordboxCueMoved', moved, undefined)
    expect(agreement(silent)).not.toBe('green')
    expect(cellFailure(silent)).toContain('veredicto ninguno')
  })

  // Reintentar after an unreadable library only has to read again: a rerun converts a
  // second time, and that is how cues get shifted twice.
  it('needs a retry that only rechecks', () => {
    const statuses: Verification['status'][] = ['mismatch', 'checking', 'ok']
    expect(agreement(outcome('K10', [], ok, statuses, { retry: 'rechecked' }))).toBe('green')
    const rerun = outcome('K10', [], ok, statuses, { retry: 'rerun-job' })
    expect(agreement(rerun)).toBe('falseOk')
    expect(cellFailure(rerun)).toContain('rerun-job')
    expect(agreement(outcome('K10', [], ok, statuses))).toBe('falseOk')
  })
})

const HEADER =
  '| Celda | Conversión | Fichero | Programas | Estado | Formato | PCM | Apuntan | Cues | Playlists | Tags | Carátula | Únicos | Colateral | Veredicto | Coincide |'

describe('the matrix report', () => {
  const outcomes = [
    outcome('C-flac-aiff', [cuesMoved], ok),
    outcome('C-wav16-flac', [], ok),
    outcome(
      'C-mp3n-aiff',
      [
        { invariant: 'tags', detail: "grouping: TIT1 'Peak Time', GRP1 ausente" },
        { invariant: 'tags', detail: "título: 'Cafe Ole'" },
        { invariant: 'collateral', detail: 'otra pista, rekordbox: sus filas cambiaron' },
      ],
      mismatch('fileTagDiffers'),
    ),
    outcome('C-aiff-wav', [], mismatch('rekordboxStillOld')),
  ]

  it('writes one row per cell with a footnote per broken invariant', () => {
    const report = renderReport(outcomes, new Date(2026, 9, 30, 18, 5))
    const lines = report.split('\n')
    const header = lines.indexOf(HEADER)
    expect(header).toBeGreaterThan(-1)
    expect(lines[header + 1]).toBe(`|${'---|'.repeat(16)}`)
    const rows = lines.slice(header + 2).filter((line) => line.startsWith('| '))
    expect(rows.map((row) => row.split(' | ')[0])).toEqual([
      '| C-flac-aiff',
      '| C-wav16-flac',
      '| C-mp3n-aiff',
      '| C-aiff-wav',
    ])
    expect(rows[0]).toBe(
      '| C-flac-aiff | FLAC→AIFF | carpeta | todos | cerrado | ✓ | ✓ | ✓ | ✗¹ | ✓ | ✓ | ✓ | ✓ | ✓ | ok | ✗ |',
    )
    expect(rows[2]).toContain('| ✗² |')
    expect(rows[2]).toContain('| ✗³ | mismatch | ✓ |')
    expect(rows[3]).toContain('| mismatch | ✗ |')
    const notes = lines.filter((line) => /^[¹²³⁴⁵⁶⁷⁸⁹⁰]+ /.test(line))
    expect(notes).toEqual([
      `¹ ${cuesMoved.detail}`,
      "² grouping: TIT1 'Peak Time', GRP1 ausente; título: 'Cafe Ole'",
      '³ otra pista, rekordbox: sus filas cambiaron',
    ])
  })

  it('counts the four outcomes above the table', () => {
    const report = renderReport(outcomes, new Date(2026, 9, 30, 18, 5))
    const top = report.slice(0, report.indexOf(HEADER))
    expect(top).toContain('30/10/2026')
    expect(top).toContain('Celdas verdes 1')
    expect(top).toContain('Surco se equivoca y lo dice 1')
    expect(top).toContain('Surco se equivoca y dice ✓ 1')
    expect(top).toContain('Falsa alarma 1')
    expect(report).not.toContain('—')
  })

  it('marks the file columns it could not judge when the file is missing', () => {
    const gone = outcome(
      'C-flac-aiff',
      [{ invariant: 'format', detail: 'formato: sin fichero' }],
      mismatch('rekordboxStillOld'),
      undefined,
      { fileExists: false },
    )
    const row = renderReport([gone], new Date(2026, 9, 30))
      .split('\n')
      .find((line) => line.startsWith('| C-flac-aiff'))
    expect(row).toBe(
      '| C-flac-aiff | FLAC→AIFF | carpeta | todos | cerrado | ✗¹ | – | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | mismatch | ✓ |',
    )
  })

  // Music keeps no cue points, so a Music-only cell has nothing to judge there; a ✓ would
  // claim a check that never ran.
  it('marks an invariant that does not apply to the cell', () => {
    const row = renderReport([outcome('D16', [], ok)], new Date(2026, 9, 30))
      .split('\n')
      .find((line) => line.startsWith('| D16'))
    expect(row).toBe(
      '| D16 | AIFF→WAV | Music | Music | cerrado | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ok | ✓ |',
    )
  })

  it('writes the report where SURCO_MATRIX_REPORT says and returns that path', () => {
    const path = join(scenarioDir('matriz-informe'), 'nueva carpeta', 'matriz.md')
    vi.stubEnv('SURCO_MATRIX_REPORT', path)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(writeReport(outcomes)).toBe(path)
    expect(readFileSync(path, 'utf8')).toContain(HEADER)
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(path))
  })
})
