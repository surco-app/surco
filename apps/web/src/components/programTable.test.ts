import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { CUE_PROGRAMS } from '../../../desktop/src/renderer/src/lib/cuePrograms'
import { DJ_PROGRAMS, isWritable, PROGRAM_CAN } from '../../../desktop/src/shared/djProgram'
import { createI18n, LANGUAGES } from '../i18n'
import de from '../i18n/locales/de.json'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import fr from '../i18n/locales/fr.json'
import ja from '../i18n/locales/ja.json'
import ptBR from '../i18n/locales/pt-BR.json'
import { type Cell, PROGRAM_TABLE, PROGRAMS, type ProgramId, type RowId } from '../lib/programTable'
import ProgramTable from './ProgramTable'

const LOCALES = [
  ['es', es],
  ['en', en],
  ['de', de],
  ['fr', fr],
  ['pt-BR', ptBR],
  ['ja', ja],
] as const

const rows = PROGRAM_TABLE.flatMap((group) => group.rows)
const cellOf = (row: RowId, program: ProgramId): Cell => {
  const found = rows.find((r) => r.id === row)
  if (!found) throw new Error(`no row ${row}`)
  return found.cells[program]
}

const escaped = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

function cellHtml(html: string, row: RowId, program: ProgramId): string {
  const start = html.indexOf(`data-testid="program-cell-${row}-${program}"`)
  expect(start, `${row} ${program}`).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</td>', start))
}

describe('DJ program table on the features page', () => {
  it('lists the programs in the order the app shows them', () => {
    expect(PROGRAMS.map((p) => p.id)).toEqual(DJ_PROGRAMS)
  })

  it.each(LOCALES)('%s names every group, row and note the table uses', (_, locale) => {
    const copy = locale.features.programs as {
      groups: Record<string, string>
      rows: Record<string, string>
      notes: Record<string, string>
    }
    for (const group of PROGRAM_TABLE) {
      expect(copy.groups[group.id], group.id).toBeTruthy()
      for (const row of group.rows) {
        expect(copy.rows[row.id], row.id).toBeTruthy()
        for (const cell of Object.values(row.cells))
          if (cell.note) expect(copy.notes[cell.note], cell.note).toBeTruthy()
      }
    }
  })

  it.each(LANGUAGES)('draws in %s exactly what the table says for every cell', (lng) => {
    const i18n = createI18n(lng)
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(ProgramTable)),
    )
    for (const row of rows)
      for (const program of PROGRAMS) {
        const cell = row.cells[program.id]
        const inner = cellHtml(html, row.id, program.id)
        expect(inner.includes('data-testid="program-yes"'), `${row.id} ${program.id}`).toBe(
          cell.yes,
        )
        expect(inner.includes('data-testid="program-no"'), `${row.id} ${program.id}`).toBe(
          !cell.yes,
        )
        expect(inner.includes('data-testid="program-note"'), `${row.id} ${program.id}`).toBe(
          Boolean(cell.note),
        )
        if (cell.note)
          expect(inner).toContain(escaped(i18n.t(`features.programs.notes.${cell.note}`)))
      }
  })
})

describe('DJ program table never promises what the app does not do', () => {
  it.each(DJ_PROGRAMS)('says Windows only where the app offers %s on Windows', (program) => {
    expect(cellOf('windows', program).yes).toBe(PROGRAM_CAN[program].windows)
  })

  it.each(DJ_PROGRAMS)('offers a USB from %s only where the app exports one', (program) => {
    expect(cellOf('usb', program).yes).toBe(PROGRAM_CAN[program].usb)
  })

  it.each(DJ_PROGRAMS)('says %s takes CALLs only where the editor writes them', (program) => {
    expect(cellOf('calls', program).yes).toBe(CUE_PROGRAMS[program].writesCalls)
  })

  it.each(DJ_PROGRAMS)(
    'says the grid is saved to %s only where the editor can change it',
    (program) => {
      expect(cellOf('grid', program).yes).toBe(CUE_PROGRAMS[program].fixedGrid === null)
    },
  )

  it.each(DJ_PROGRAMS)(
    'says %s follows the converted track only where Surco repoints its library',
    (program) => {
      expect(cellOf('follow', program).yes).toBe(isWritable(program))
    },
  )

  it.each(DJ_PROGRAMS)(
    'flags %s as not restorable from Backups when the Backups screen leaves it out',
    (program) => {
      expect(cellOf('copies', program).note === 'noRestore').toBe(!isWritable(program))
    },
  )
})
